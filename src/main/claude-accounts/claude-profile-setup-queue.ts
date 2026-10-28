import { getClaudeAgentViewService } from '../claude/agent-view-service'
import { isAgentStatusHooksEnabledForAgent } from '../../shared/agent-status-hooks-setting'
import { CLAUDE_PROFILE_SETUP_FAILED_MESSAGE } from '../../shared/claude-profile-routing'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { probeRecentClaudeCliVersion } from '../claude/claude-hook-event-versions'
import { resolveClaudeCommand } from '../codex-cli/command'
import type { ClaudeProfileDescriptor } from './claude-profile-paths'
import type { ClaudeProfileSetupReport } from './claude-profile-setup'
import { runClaudeProfileSetupInWorker } from './claude-profile-setup-worker'

/** Runs account folder setup, reusing the in-flight run per account. */
export class ClaudeProfileSetupQueue {
  private readonly setups = new Map<string, Promise<ClaudeProfileSetupReport>>()
  constructor(
    private readonly args: {
      getSettings: () => Pick<GlobalSettings, 'agentStatusHooksEnabled' | 'disabledTuiAgents'>
      dataRoot: string
      userHome: () => string
      userConfigDir: () => string | undefined
      envReady: Promise<unknown>
      runSetup?: typeof runClaudeProfileSetupInWorker
    }
  ) {}

  setUp(profile: ClaudeProfileDescriptor): Promise<ClaudeProfileSetupReport> {
    const running = this.setups.get(profile.accountId)
    if (running) {
      return running
    }
    const run = this.runSetup(profile).finally(() => this.setups.delete(profile.accountId))
    this.setups.set(profile.accountId, run)
    return run
  }

  setUpInBackground(profile: ClaudeProfileDescriptor): void {
    this.setUp(profile).catch((error: unknown) => {
      console.warn('[claude-profile] Account setup failed:', error)
    })
  }

  /** Resolves the account home only when setup succeeds. */
  async prepare(profile: ClaudeProfileDescriptor): Promise<string> {
    const report = await this.setUp(profile).catch(() => null)
    if (report?.outcome !== 'prepared') {
      throw new Error(CLAUDE_PROFILE_SETUP_FAILED_MESSAGE)
    }
    return profile.home
  }

  /** Settles once any running setup for the account has finished. */
  async settled(accountId: string): Promise<void> {
    await this.setups.get(accountId)?.catch(() => {})
  }

  private async runSetup(profile: ClaudeProfileDescriptor): Promise<ClaudeProfileSetupReport> {
    await this.args.envReady
    const hooks = isAgentStatusHooksEnabledForAgent(this.args.getSettings(), 'claude')
    const claudeVersion = hooks ? await probeRecentClaudeCliVersion(resolveClaudeCommand()) : null
    const report = await (this.args.runSetup ?? runClaudeProfileSetupInWorker)({
      dataRoot: this.args.dataRoot,
      profile,
      userHome: this.args.userHome(),
      userConfigDir: this.args.userConfigDir(),
      hooks,
      claudeVersion: claudeVersion ?? undefined
    })
    if (report.outcome === 'prepared') {
      await getClaudeAgentViewService(this.args.dataRoot).prepareProfile(profile.home)
    }
    if (report.outcome === 'refused' || report.warnings.length > 0) {
      console.warn('[claude-profile] Account setup was incomplete:', report)
    }
    return report
  }
}
