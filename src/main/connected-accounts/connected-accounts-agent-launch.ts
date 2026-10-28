// Connected Accounts for agent launches outside a PTY (native chat, commit/PR text generation):
// any unresolved binding refuses the launch, exactly like a fresh agent spawn in a terminal.
import { getClaudeProfileRouter } from '../claude-accounts/claude-profile-installed-router'
import type { ClaudeRepoAccountOverride } from '../claude-accounts/claude-profile-repo-pointer'
import type { Repo } from '../../shared/repo-types'
import {
  claudeAccountMissingUnresolved,
  claudeBoundAccountLabel,
  formatConnectedAccountsLaunchError,
  resolveConnectedAccountsSpawnEnv,
  type ConnectedAccountsSettings
} from './connected-accounts-spawn-env'

export type ConnectedAccountsAgentLaunch = {
  /** Merge over the launch env last: it carries tokens, never log or persist it. */
  env: Record<string, string>
  claudeOverride?: ClaudeRepoAccountOverride
  /** The bound Claude account's email (or id) for refusal text. */
  claudeLabel?: string
}

export const CONNECTED_ACCOUNTS_NO_LAUNCH: ConnectedAccountsAgentLaunch = { env: {} }

const CLAUDE_FOLDER_MISSING_REASON = "the account's sign-in folder is missing"

/** True when the bound Claude account's sign-in folder is gone (the router throws for it). */
export function claudeBoundFolderMissing(override: ClaudeRepoAccountOverride): boolean {
  try {
    getClaudeProfileRouter()?.routedHome(override)
    return false
  } catch {
    return true
  }
}

export function claudeFolderMissingError(error: unknown): boolean {
  return (
    error instanceof Error && 'reason' in error && error.reason === 'claudeAccountFolderMissing'
  )
}

/** Throws the Connected Accounts launch error on any unresolved binding; unbound repos get an empty patch. */
export async function resolveConnectedAccountsAgentLaunch(args: {
  repo: Repo | undefined
  worktreePath: string | undefined
  settings: ConnectedAccountsSettings
  baseEnv: Record<string, string>
  runtime?: 'host' | 'wsl'
  home?: string
}): Promise<ConnectedAccountsAgentLaunch> {
  const resolved = await resolveConnectedAccountsSpawnEnv({
    ...args,
    platform: process.platform
  })
  const unresolved = [...resolved.unresolved]
  const override = resolved.claudeOverride
  const claudeLabel = override ? claudeBoundAccountLabel(args.settings, override.accountId) : ''
  if (
    override &&
    !unresolved.some((entry) => entry.tool === 'claude') &&
    claudeBoundFolderMissing(override)
  ) {
    unresolved.push(claudeAccountMissingUnresolved(claudeLabel, CLAUDE_FOLDER_MISSING_REASON))
  }
  if (unresolved.length > 0) {
    throw formatConnectedAccountsLaunchError(unresolved)
  }
  return {
    env: resolved.env,
    ...(override ? { claudeOverride: override, claudeLabel } : {})
  }
}

/** Runs a bound Claude launch, turning the router's missing-folder error into the refusal text. */
export async function withConnectedAccountsClaudeRefusal<T>(
  /** The bound account's label (claudeBoundAccountLabel); null when the project has no Claude binding. */
  boundLabel: string | null,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (boundLabel !== null && claudeFolderMissingError(error)) {
      throw formatConnectedAccountsLaunchError([
        claudeAccountMissingUnresolved(boundLabel, CLAUDE_FOLDER_MISSING_REASON)
      ])
    }
    throw error
  }
}

/** Resolves a launch against the caller's own base env (GIT_CONFIG_* indices are built on it). */
export type ConnectedAccountsLaunchResolver = (
  baseEnv: Record<string, string>,
  runtime: 'host' | 'wsl'
) => Promise<ConnectedAccountsAgentLaunch>

/** For one-shot agent runs tied to a worktree (commit/PR text, naming); undefined when no repo is known. */
export function connectedAccountsLaunchResolver(
  repo: Repo | undefined,
  worktreePath: string,
  settings: ConnectedAccountsSettings
): ConnectedAccountsLaunchResolver | undefined {
  return repo
    ? (baseEnv, runtime) =>
        resolveConnectedAccountsAgentLaunch({ repo, worktreePath, settings, baseEnv, runtime })
    : undefined
}

export function isConnectedAccountsLaunchError(error: unknown): error is Error {
  return error instanceof Error && 'code' in error && error.code === 'connected_accounts_unresolved'
}
