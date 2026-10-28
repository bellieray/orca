// Applies a project's Connected Accounts at PTY spawn: agents are refused on an unresolved
// binding; plain terminals open with a warning and the broken tool's env blocked (never the default).
import {
  getClaudeProfileRouter,
  withClaudeProfileTerminalEnv
} from '../../claude-accounts/claude-profile-installed-router'
import { CLAUDE_REPO_POINTER_UNBOUND } from '../../claude-accounts/claude-profile-repo-pointer'
import type { ClaudeAccountSelectionTarget } from '../../claude-accounts/runtime-selection'
import type { ClaudeRuntimeAuthPreparation } from '../../claude-accounts/runtime-auth-service'
import {
  claudeAccountMissingUnresolved,
  claudeBoundAccountLabel,
  formatConnectedAccountsLaunchError,
  formatConnectedAccountsWarning,
  resolveConnectedAccountsSpawnEnv
} from '../../connected-accounts/connected-accounts-spawn-env'
import type { ConnectedAccountsUnresolved } from '../../connected-accounts/connected-accounts-static-env'
import { recordConnectedAccountsPane } from '../../connected-accounts/connected-accounts-pane-registry'
import type { Store } from '../../persistence'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { CLAUDE_PROFILE_POINTER_ENV } from '../../../shared/claude-profile-routing'
import { getConnectionExecutionHostId } from '../../../shared/execution-host'
import { getRepoIdFromWorktreeId, splitWorktreeId } from '../../../shared/worktree/id'
import type { PrepareClaudeAuth } from './host-env/types'

export type ConnectedAccountsPane = { repoId: string; fingerprint: string | null }

export type ConnectedAccountsSpawnPreparation = {
  env: Record<string, string> | undefined
  warning?: string
  pane?: ConnectedAccountsPane
  prepareClaudeAuth: () => Promise<ClaudeRuntimeAuthPreparation | null>
}

function processEnvStrings(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value
    }
  }
  return env
}

function claudeFolderMissing(error: unknown): boolean {
  return (
    error instanceof Error && 'reason' in error && error.reason === 'claudeAccountFolderMissing'
  )
}

/** Replaces `withClaudeProfileTerminalEnv` + `prepareClaudeAuth` in both spawn preflights. */
export async function prepareConnectedAccountsSpawn(input: {
  env: Record<string, string> | undefined
  worktreeId: string | undefined
  connectionId: string | null | undefined
  target: ClaudeAccountSelectionTarget
  /** Fresh agent launch: refused on any unresolved binding. Restored/reattached panes act like terminals. */
  isAgentLaunch: boolean
  isClaudeLaunch: boolean
  store: Pick<Store, 'getRepo'> | undefined
  settings: GlobalSettings | undefined
  prepareClaudeAuth: PrepareClaudeAuth | undefined
}): Promise<ConnectedAccountsSpawnPreparation> {
  const { target } = input
  const repoId = input.worktreeId ? getRepoIdFromWorktreeId(input.worktreeId) : undefined
  const repo =
    repoId && input.settings && getConnectionExecutionHostId(input.connectionId) === 'local'
      ? input.store?.getRepo?.(repoId)
      : undefined
  // WSL runtimes are left on machine defaults, so no WSLENV forwarding is needed in v1.
  const resolved = input.settings
    ? await resolveConnectedAccountsSpawnEnv({
        repo,
        worktreePath: input.worktreeId
          ? splitWorktreeId(input.worktreeId)?.worktreePath
          : undefined,
        settings: input.settings,
        baseEnv: { ...processEnvStrings(), ...input.env },
        platform: process.platform,
        runtime: target.runtime === 'wsl' ? 'wsl' : 'host'
      })
    : { env: {}, unresolved: [], fingerprint: null }
  const override = resolved.claudeOverride
  const unresolved: ConnectedAccountsUnresolved[] = [...resolved.unresolved]
  const claudeEnv = withClaudeProfileTerminalEnv(input.env, target, override)
  const env = Object.keys(resolved.env).length > 0 ? { ...claudeEnv, ...resolved.env } : claudeEnv
  const claudeLabel = override ? claudeBoundAccountLabel(input.settings!, override.accountId) : ''
  if (override && !unresolved.some((entry) => entry.tool === 'claude')) {
    let folderMissing = env?.[CLAUDE_PROFILE_POINTER_ENV] === CLAUDE_REPO_POINTER_UNBOUND
    if (!folderMissing) {
      try {
        getClaudeProfileRouter()?.routedHome(override)
      } catch {
        folderMissing = true
      }
    }
    if (folderMissing) {
      unresolved.push(
        claudeAccountMissingUnresolved(claudeLabel, "the account's sign-in folder is missing")
      )
    }
  }
  if (input.isAgentLaunch && unresolved.length > 0) {
    throw formatConnectedAccountsLaunchError(unresolved)
  }
  const bound = repo && resolved.fingerprint !== null
  return {
    env,
    ...(unresolved.length > 0 ? { warning: formatConnectedAccountsWarning(unresolved) } : {}),
    ...(bound ? { pane: { repoId: repo.id, fingerprint: resolved.fingerprint } } : {}),
    prepareClaudeAuth: async () => {
      if (!input.isClaudeLaunch || !input.prepareClaudeAuth) {
        return null
      }
      try {
        return await input.prepareClaudeAuth(target, override)
      } catch (error) {
        if (override && claudeFolderMissing(error)) {
          throw formatConnectedAccountsLaunchError([
            claudeAccountMissingUnresolved(claudeLabel, "the account's sign-in folder is missing")
          ])
        }
        throw error
      }
    }
  }
}

export function recordConnectedAccountsSpawnedPane(
  ptyId: string,
  pane: ConnectedAccountsPane | undefined
): void {
  if (pane && ptyId) {
    recordConnectedAccountsPane(ptyId, pane.repoId, pane.fingerprint)
  }
}
