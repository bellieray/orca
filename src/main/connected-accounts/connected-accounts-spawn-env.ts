// Turns a project's account bindings into a child env patch for agents and terminals.
// Tokens only ever live in `env`: never log, persist or hash it (the fingerprint reads bindings only).
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { getRepoRoutingConnectionId } from '../../shared/execution-host'
import { isFolderRepo } from '../../shared/repo-kind'
import type { Repo } from '../../shared/repo-types'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { ClaudeRepoAccountOverride } from '../claude-accounts/claude-profile-repo-pointer'
import { parseWslPath } from '../wsl'
import {
  resolveAdmobProfileEnv,
  resolveExtraEnv,
  type ConnectedAccountsUnresolved
} from './connected-accounts-static-env'
import {
  CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED,
  resolveGhSpawnEnv
} from './connected-accounts-git-env'
import {
  ensureFirebaseActiveAccount,
  firebaseToolsConfigstorePath
} from './firebase-tools-account-store'

export type ConnectedAccountsSpawnEnv = {
  /** Merged after withClaudeProfileTerminalEnv; extra env is already merged last. */
  env: Record<string, string>
  claudeOverride?: ClaudeRepoAccountOverride
  unresolved: ConnectedAccountsUnresolved[]
  /** sha256 of non-secret binding values only; null when unbound or left on machine defaults. */
  fingerprint: string | null
}

export const CONNECTED_ACCOUNTS_DEFAULT_FIX = 'Open Connected Accounts'
export const CONNECTED_ACCOUNTS_CLAUDE_FIX = 'Open Connected Accounts and re-add the Claude account'

const TOOL_LABELS: Record<ConnectedAccountsUnresolved['tool'], string> = {
  claude: 'Claude',
  github: 'GitHub',
  git: 'Git',
  firebase: 'Firebase',
  admob: 'AdMob'
}

const EMPTY: ConnectedAccountsSpawnEnv = { env: {}, unresolved: [], fingerprint: null }

/** Local, git-backed repos only; WSL/SSH/runtime-host/folder repos stay on machine defaults in v1. */
export type ConnectedAccountsRoutingRepo = Pick<
  Repo,
  'path' | 'kind' | 'connectionId' | 'executionHostId'
>

export function connectedAccountsApplyToRepo<T extends ConnectedAccountsRoutingRepo>(
  repo: T | undefined
): repo is T {
  if (!repo || isFolderRepo(repo)) {
    return false
  }
  if (getRepoRoutingConnectionId(repo)) {
    return false
  }
  if (repo.executionHostId && repo.executionHostId !== 'local') {
    return false
  }
  return parseWslPath(repo.path) === null
}

function hasBinding(repo: Repo): boolean {
  const bound = repo.connectedAccounts
  return Boolean(
    repo.ghAccount ||
    bound?.claudeAccountId ||
    bound?.firebaseEmail ||
    bound?.admobProfileId ||
    (bound?.extraEnv && bound.extraEnv.length > 0)
  )
}

/** The exact (stable-ordered) values the fingerprint hashes; exported so tests can prove no secret is in it. */
export function connectedAccountsFingerprintInput(repo: Repo): string {
  const bound = repo.connectedAccounts
  return JSON.stringify([
    repo.ghAccount ? [repo.ghAccount.host, repo.ghAccount.user] : null,
    bound?.claudeAccountId ?? null,
    bound?.firebaseEmail ?? null,
    bound?.admobProfileId ?? null,
    repo.ghAccount && bound?.gitAuthor ? [bound.gitAuthor.name, bound.gitAuthor.email] : null,
    (bound?.extraEnv ?? []).map(({ key, value }) => [key, value])
  ])
}

export function connectedAccountsFingerprint(repo: Repo, _settings: GlobalSettings): string | null {
  if (!connectedAccountsApplyToRepo(repo) || !hasBinding(repo)) {
    return null
  }
  return createHash('sha256').update(connectedAccountsFingerprintInput(repo)).digest('hex')
}

export function formatConnectedAccountsUnresolved(entry: ConnectedAccountsUnresolved): string {
  const fix = entry.fixCommand ?? CONNECTED_ACCOUNTS_DEFAULT_FIX
  return `${TOOL_LABELS[entry.tool]} account ${entry.account} is not available: ${entry.reason}. Fix: ${fix}`
}

export function formatConnectedAccountsWarning(unresolved: ConnectedAccountsUnresolved[]): string {
  return unresolved.map(formatConnectedAccountsUnresolved).join('\n')
}

export function formatConnectedAccountsLaunchError(
  unresolved: ConnectedAccountsUnresolved[]
): Error & { code: 'connected_accounts_unresolved' } {
  const error = new Error(formatConnectedAccountsWarning(unresolved)) as Error & {
    code: 'connected_accounts_unresolved'
  }
  error.code = 'connected_accounts_unresolved'
  return error
}

export function claudeAccountMissingUnresolved(
  account: string,
  reason: string
): ConnectedAccountsUnresolved {
  return { tool: 'claude', account, reason, fixCommand: CONNECTED_ACCOUNTS_CLAUDE_FIX }
}

/** Email when the account is known, else its id, so the refusal always names the account. */
export function claudeBoundAccountLabel(settings: GlobalSettings, accountId: string): string {
  return (
    (settings.claudeManagedAccounts ?? []).find((account) => account.id === accountId)?.email ??
    accountId
  )
}

// Why a sentinel path: an empty value lets the AdMob tooling read its own default folder.
const ADMOB_BLOCKED_ENV = {
  CREDENTIALS_DIR: CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED,
  PUBLISHER_CODE: CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED
}

export async function resolveConnectedAccountsSpawnEnv(args: {
  repo: Repo | undefined
  worktreePath: string | undefined
  settings: GlobalSettings
  baseEnv: Record<string, string>
  platform: NodeJS.Platform
  /** WSL runtimes stay on machine defaults (the UI blocks binding them); no WSLENV forwarding in v1. */
  runtime?: 'host' | 'wsl'
  home?: string
}): Promise<ConnectedAccountsSpawnEnv> {
  const { repo, worktreePath, settings, baseEnv, platform } = args
  if (
    !connectedAccountsApplyToRepo(repo) ||
    !hasBinding(repo) ||
    args.runtime === 'wsl' ||
    (worktreePath !== undefined && parseWslPath(worktreePath) !== null)
  ) {
    return EMPTY
  }
  const bound = repo.connectedAccounts ?? {}
  const unresolved: ConnectedAccountsUnresolved[] = []
  let toolEnv: Record<string, string> = {}

  let claudeOverride: ClaudeRepoAccountOverride | undefined
  if (bound.claudeAccountId) {
    // Always pass the override: dropping it would route the project to the global account.
    claudeOverride = { repoId: repo.id, accountId: bound.claudeAccountId }
    const known = (settings.claudeManagedAccounts ?? []).some(
      (account) => account.id === bound.claudeAccountId
    )
    if (!known) {
      unresolved.push(
        claudeAccountMissingUnresolved(
          bound.claudeAccountId,
          'the Claude account was removed from Orca'
        )
      )
    }
  }

  if (repo.ghAccount) {
    const gh = await resolveGhSpawnEnv({
      binding: repo.ghAccount,
      author: bound.gitAuthor,
      cwd: worktreePath ?? repo.path,
      baseEnv
    })
    toolEnv = { ...toolEnv, ...gh.env }
    if ('unresolved' in gh) {
      unresolved.push(gh.unresolved)
    }
  }

  if (bound.admobProfileId) {
    const admob = resolveAdmobProfileEnv(
      bound.admobProfileId,
      settings.connectedAccountsAdmobProfiles ?? []
    )
    if ('env' in admob) {
      toolEnv = { ...toolEnv, ...admob.env }
    } else {
      toolEnv = { ...toolEnv, ...ADMOB_BLOCKED_ENV }
      unresolved.push(admob.unresolved)
    }
  }

  if (bound.firebaseEmail) {
    // firebase-tools keys its account per project root in the configstore, so there is no env to set.
    const firebase = worktreePath
      ? ensureFirebaseActiveAccount({
          configstorePath: firebaseToolsConfigstorePath(baseEnv, args.home ?? homedir()),
          worktreePath,
          email: bound.firebaseEmail
        })
      : null
    if (!firebase) {
      unresolved.push({
        tool: 'firebase',
        account: bound.firebaseEmail,
        reason: 'This terminal is not inside a worktree'
      })
    } else if (!firebase.ok) {
      unresolved.push(firebase.unresolved)
    }
  }

  return {
    // Extra env last; reserved keys (GH_*, GIT_*, CLAUDE_*, CREDENTIALS_DIR...) never reach it.
    env: { ...toolEnv, ...resolveExtraEnv(bound.extraEnv, platform) },
    ...(claudeOverride ? { claudeOverride } : {}),
    unresolved,
    fingerprint: connectedAccountsFingerprint(repo, settings)
  }
}
