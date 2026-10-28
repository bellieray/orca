import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV,
  CLAUDE_USER_CONFIG_DIR_ENV
} from '../../shared/claude-profile-routing'
import { claudeProfileMissing, claudeProfileSetupFailed } from './claude-profile-launch-errors'
import type { GlobalSettings } from '../../shared/global-settings-types'
import {
  claudeRepoPointerPath,
  CLAUDE_REPO_POINTER_UNBOUND,
  publishClaudeRepoPointer,
  writeClaudeProfilePointer,
  writeClaudeRepoPointer,
  type ClaudeRepoAccountOverride
} from './claude-profile-repo-pointer'
import {
  claudeProfileMarkerPath,
  describeClaudeProfile,
  type ClaudeProfileDescriptor,
  readUserClaudeConfigDir,
  readUserClaudeConfigDirAsSet,
  resolveClaudeDefaultHome
} from './claude-profile-paths'
import type { runClaudeProfileSetupInWorker } from './claude-profile-setup-worker'
import { ClaudeProfileSetupQueue } from './claude-profile-setup-queue'
import type { ClaudeEnvPatch } from './environment'
import type { ClaudeRuntimeAuthPreparation } from './runtime-auth/runtime-auth-types'
import {
  findClaudeAccount,
  getSelectedClaudeAccountIdForTarget,
  type ClaudeAccountSelectionTarget
} from './runtime-selection'
import { wslClaudeProfilePointer } from './claude-profile-wsl-paths'
import { isDirectory, listClaudeProfileHomes } from './claude-profile-homes'
import {
  claudeStateFile,
  readClaudeFolderLogin,
  removeClaudeAccountFolder,
  isSameClaudeLogin,
  type ClaudeFolderLogin
} from './claude-account-folder'
import { resolveLoginShellEnvironment } from '../startup/login-shell-environment'

const REFRESH_WAIT_MS = 5_000

export type ClaudeProfileRouterSettings = Pick<
  GlobalSettings,
  | 'claudeManagedAccounts'
  | 'activeClaudeManagedAccountId'
  | 'activeClaudeManagedAccountIdsByRuntime'
  | 'agentStatusHooksEnabled'
  | 'disabledTuiAgents'
>

/** Mirror the settings selection to a pointer file for Claude in existing terminals. */
export class ClaudeProfileRouter {
  readonly pointerPath: string
  private readonly setups: ClaudeProfileSetupQueue
  private readonly repoOverrides = new Map<string, ClaudeRepoAccountOverride>()
  private env: NodeJS.ProcessEnv
  private readonly envReady: Promise<unknown>
  private envResolved: boolean
  constructor(
    private readonly args: {
      getSettings: () => ClaudeProfileRouterSettings
      dataRoot: string
      userHome?: string
      env?: NodeJS.ProcessEnv
      runSetup?: typeof runClaudeProfileSetupInWorker
      refreshWaitMs?: number
    }
  ) {
    this.pointerPath = join(args.dataRoot, 'claude-profiles', 'selected-host')
    this.env = args.env ?? process.env
    // Dock launches lack CLAUDE_CONFIG_DIR exported by shell startup files.
    this.envResolved = Boolean(args.env)
    this.envReady = args.env
      ? Promise.resolve()
      : resolveLoginShellEnvironment().then((env) => {
          this.env = env
          this.envResolved = true
          // Recompute routing using the resolved System default.
          try {
            this.writePointer()
            this.repoOverrides.forEach((override) => this.writeRepoPointer(override))
          } catch (error) {
            console.warn('[claude-profile] Could not update the Claude account pointer:', error)
          }
        })
    this.setups = new ClaudeProfileSetupQueue({
      getSettings: args.getSettings,
      dataRoot: args.dataRoot,
      userHome: () => this.userHome,
      userConfigDir: () => this.userConfigDir(),
      envReady: this.envReady,
      runSetup: args.runSetup
    })
  }

  private get userHome(): string {
    return this.args.userHome ?? homedir()
  }

  private profileFor(override?: ClaudeRepoAccountOverride): ClaudeProfileDescriptor | null {
    // A bound account removed from settings must never fall back to the global selection.
    if (override && !findClaudeAccount(this.args.getSettings(), override.accountId)) {
      throw claudeProfileMissing()
    }
    const id =
      override?.accountId ??
      getSelectedClaudeAccountIdForTarget(this.args.getSettings(), { runtime: 'host' })
    return id ? this.describe(id) : null
  }

  private routedProfile(override?: ClaudeRepoAccountOverride): ClaudeProfileDescriptor | null {
    const profile = this.profileFor(override)
    return profile && !this.coveredBySystemDefault(profile.accountId) ? profile : null
  }

  repoPointerPath(repoId: string): string {
    return claudeRepoPointerPath(this.args.dataRoot, repoId)
  }

  accountLogin(accountId: string): ClaudeFolderLogin | null {
    return readClaudeFolderLogin(claudeStateFile(this.accountHome(accountId), this.userHome))
  }

  systemDefaultLogin(maxAgeMs = 0): ClaudeFolderLogin | null {
    return readClaudeFolderLogin(claudeStateFile(this.userConfigDir(), this.userHome), maxAgeMs)
  }

  /** Reuse a matching System default login until a legacy account signs in separately. */
  coveredBySystemDefault(accountId: string): boolean {
    if (this.accountLogin(accountId)) {
      return false
    }
    const saved = findClaudeAccount(this.args.getSettings(), accountId)
    const systemDefault = this.systemDefaultLogin()
    return Boolean(saved && systemDefault && isSameClaudeLogin(saved, systemDefault))
  }

  systemDefaultHome(): string {
    return resolveClaudeDefaultHome(this.userHome, this.userConfigDir())
  }

  /** Never fall back from a missing folder: that would run the wrong account. */
  routedHome(override?: ClaudeRepoAccountOverride): string | null {
    const home = this.routedProfile(override)?.home ?? null
    if (home !== null && !isDirectory(home)) {
      throw claudeProfileMissing()
    }
    return home
  }

  /** Publish the pointer before starting background setup. */
  publish(): void {
    if (!this.writePointer()) {
      return
    }
    // Create missing or covered folders without a login so they can sign in separately.
    const profile = this.profileFor()
    if (profile) {
      this.setups.setUpInBackground(profile)
    }
  }

  private writePointer(override?: ClaudeRepoAccountOverride): boolean {
    if (override) {
      this.writeRepoPointer(override)
      return true
    }
    if (this.args.getSettings().claudeManagedAccounts.length === 0) {
      rmSync(this.pointerPath, { force: true })
      return false
    }
    writeClaudeProfilePointer(this.pointerPath, this.routedProfile()?.home ?? '')
    return true
  }

  /** Unlike the global pointer, a bound project's pointer is never removed: a missing file means System default. */
  private writeRepoPointer(override: ClaudeRepoAccountOverride): void {
    this.repoOverrides.set(override.repoId, override)
    writeClaudeRepoPointer(this.repoPointerPath(override.repoId), () => this.routedHome(override))
  }

  /** Initial setup must succeed; later refreshes may time out without blocking launch. */
  async prepareLaunch(override?: ClaudeRepoAccountOverride): Promise<ClaudeRuntimeAuthPreparation> {
    const selected = this.profileFor(override)
    // Only fallback routing needs the shell env; account setup waits for it separately.
    if (!selected || !this.accountLogin(selected.accountId)) {
      await this.envReady
    }
    // Login changes since publication can change the route.
    this.writePointer(override)
    const profile = this.routedProfile(override)
    if (!profile) {
      return this.preparation(override)
    }
    // A bound folder is never recreated empty: that would hide a lost login behind a new sign-in.
    if (override && !isDirectory(profile.home)) {
      throw claudeProfileMissing()
    }
    // A missing marker means initial setup has not completed.
    if (!existsSync(claudeProfileMarkerPath(profile))) {
      const report = await this.setups.setUp(profile).catch(() => null)
      if (report?.outcome !== 'prepared') {
        throw claudeProfileSetupFailed()
      }
      return this.preparation(override)
    }
    // Run with the previous setup if refreshing fails or exceeds the deadline.
    const refresh = this.setups.setUp(profile).catch((error: unknown) => {
      console.warn('[claude-profile] Account refresh failed:', error)
    })
    const waitMs = this.args.refreshWaitMs ?? REFRESH_WAIT_MS
    await Promise.race([refresh, new Promise((resolve) => setTimeout(resolve, waitMs).unref())])
    return this.preparation(override)
  }

  accountHome(accountId: string): string {
    return this.describe(accountId).home
  }

  prepareAccount(accountId: string): Promise<string> {
    return this.setups.prepare(this.describe(accountId))
  }

  /** Wait for setup before deleting so it cannot recreate the folder. */
  async removeAccount(accountId: string): Promise<void> {
    await this.setups.settled(accountId)
    await removeClaudeAccountFolder(this.args.dataRoot, accountId)
  }

  /** A legacy snapshot records copy-based account switching. */
  copiedLoginIntoSystemDefault(): boolean {
    return existsSync(join(this.args.dataRoot, 'claude-runtime-auth', 'system-default-auth.json'))
  }

  userConfigDir(): string | undefined {
    return readUserClaudeConfigDir(this.env)
  }

  private describe(accountId: string): ClaudeProfileDescriptor {
    return describeClaudeProfile(this.args.dataRoot, accountId, {
      executionHostId: 'local',
      runtime: 'host'
    })
  }

  launchEnv(override?: ClaudeRepoAccountOverride): ClaudeEnvPatch {
    const home = this.routedHome(override)
    return {
      [CLAUDE_PROFILE_POINTER_ENV]: override
        ? this.repoPointerPath(override.repoId)
        : this.pointerPath,
      // Preserve the user's inherited CLAUDE_CONFIG_DIR for System default.
      ...(home ? { CLAUDE_CONFIG_DIR: home, [CLAUDE_INJECTED_CONFIG_DIR_ENV]: home } : {})
    }
  }

  /** A broken account selection must not prevent opening a terminal. */
  terminalEnv(
    target?: ClaudeAccountSelectionTarget,
    override?: ClaudeRepoAccountOverride
  ): ClaudeEnvPatch {
    // Pass the pointer without waiting on the guest.
    if (target?.runtime === 'wsl') {
      // The guest cannot read the host repo pointer, so a bound pane carries the refusal itself.
      const wslPointer = `~/${wslClaudeProfilePointer(this.args.dataRoot)}`
      return { [CLAUDE_PROFILE_POINTER_ENV]: override ? CLAUDE_REPO_POINTER_UNBOUND : wslPointer }
    }
    // Save the user's value so the shell function can restore it on System default.
    const userConfigDir = readUserClaudeConfigDirAsSet(this.env)
    const base: ClaudeEnvPatch = {
      // Written before returning, even pre-resolve: the shell reads a missing pointer as System default.
      [CLAUDE_PROFILE_POINTER_ENV]: override
        ? publishClaudeRepoPointer(this.repoPointerPath(override.repoId), () =>
            this.writeRepoPointer(override)
          )
        : this.pointerPath,
      ...(userConfigDir ? { [CLAUDE_USER_CONFIG_DIR_ENV]: userConfigDir } : {})
    }
    // Defer routing until the shell env resolves; the shell function will read the updated pointer.
    if (!this.envResolved || base[CLAUDE_PROFILE_POINTER_ENV] === CLAUDE_REPO_POINTER_UNBOUND) {
      return base
    }
    try {
      this.writePointer(override)
      // Refresh without delaying terminal creation.
      const profile = this.routedProfile(override)
      if (profile) {
        this.setups.setUpInBackground(profile)
      }
      return { ...base, ...this.launchEnv(override) }
    } catch {
      return base
    }
  }

  preparation(override?: ClaudeRepoAccountOverride): ClaudeRuntimeAuthPreparation {
    const profile = this.routedProfile(override)
    const home = this.routedHome(override)
    return {
      configDir: home ?? this.systemDefaultHome(),
      runtime: 'host',
      wslDistro: null,
      wslLinuxConfigDir: null,
      envPatch: this.launchEnv(override),
      provenance: home ? `profile:${profile?.accountId}` : 'system'
    }
  }

  /** Compare pre-routing terminals against the selection; null means no account is selected. */
  systemDefaultRunsAnotherAccount(): boolean | null {
    const profile = this.profileFor()
    if (!profile) {
      return null
    }
    const selected =
      this.accountLogin(profile.accountId) ??
      findClaudeAccount(this.args.getSettings(), profile.accountId)
    const systemDefault = this.systemDefaultLogin(5_000)
    return !selected || !systemDefault || !isSameClaudeLogin(selected, systemDefault)
  }

  routesToAccount(): boolean {
    return this.routedProfile() !== null
  }

  /** Read usage from the same login the account would launch with. */
  accountUsagePreparation(accountId: string): ClaudeRuntimeAuthPreparation {
    if (this.coveredBySystemDefault(accountId)) {
      // Setting CLAUDE_CONFIG_DIR for System default changes its Keychain identity.
      return {
        configDir: this.systemDefaultHome(),
        envPatch: {},
        provenance: 'system'
      }
    }
    const home = this.accountHome(accountId)
    return {
      configDir: home,
      envPatch: { CLAUDE_CONFIG_DIR: home },
      provenance: `profile:${accountId}`
    }
  }

  accountHomes(): string[] {
    return listClaudeProfileHomes(this.args.dataRoot)
  }
}
