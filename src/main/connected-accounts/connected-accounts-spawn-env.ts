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

/** Only what binding resolution reads, so partial runtime-store settings can be passed. */
export type ConnectedAccountsSettings = Partial<
  Pick<GlobalSettings, 'claudeManagedAccounts' | 'connectedAccountsAdmobProfiles'>
>

const EMPTY: ConnectedAccountsSpawnEnv = { env: {}, unresolved: [], fingerprint: null }

/** Local, git-backed repos only; SSH/runtime-host/folder repos stay on machine defaults in v1. */
export type ConnectedAccountsRoutingRepo = Pick<
  Repo,
  'path' | 'kind' | 'connectionId' | 'executionHostId'
>

/** 'wsl' bindings cannot reach the guest in v1 (no WSLENV), so callers must refuse rather than ignore them. */
export function connectedAccountsRepoScope(
  repo: ConnectedAccountsRoutingRepo | undefined
): 'local' | 'wsl' | null {
  if (!repo || isFolderRepo(repo)) {
    return null
  }
  if (getRepoRoutingConnectionId(repo)) {
    return null
  }
  if (repo.executionHostId && repo.executionHostId !== 'local') {
    return null
  }
  return parseWslPath(repo.path) === null ? 'local' : 'wsl'
}

export function connectedAccountsApplyToRepo<T extends ConnectedAccountsRoutingRepo>(
  repo: T | undefined
): repo is T {
  return connectedAccountsRepoScope(repo) === 'local'
}

export const CONNECTED_ACCOUNTS_WSL_FIX =
  'Set this project to Default (machine) accounts in Connected Accounts'

export function connectedAccountsWslUnresolved(
  tool: ConnectedAccountsUnresolved['tool'],
  account: string
): ConnectedAccountsUnresolved {
  return {
    tool,
    account,
    reason: 'account bindings are not supported for WSL projects yet',
    fixCommand: CONNECTED_ACCOUNTS_WSL_FIX
  }
}

function wslUnresolvedForRepo(
  repo: Repo,
  settings: ConnectedAccountsSettings
): ConnectedAccountsUnresolved[] {
  const bound = repo.connectedAccounts
  return [
    ...(bound?.claudeAccountId
      ? [
          connectedAccountsWslUnresolved(
            'claude',
            claudeBoundAccountLabel(settings, bound.claudeAccountId)
          )
        ]
      : []),
    ...(repo.ghAccount
      ? [connectedAccountsWslUnresolved('github', `${repo.ghAccount.user}@${repo.ghAccount.host}`)]
      : []),
    ...(bound?.firebaseEmail
      ? [connectedAccountsWslUnresolved('firebase', bound.firebaseEmail)]
      : []),
    ...(bound?.admobProfileId
      ? [connectedAccountsWslUnresolved('admob', bound.admobProfileId)]
      : [])
  ]
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

export function connectedAccountsFingerprint(repo: Repo): string | null {
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
  return Object.assign(new Error(formatConnectedAccountsWarning(unresolved)), {
    code: 'connected_accounts_unresolved' as const
  })
}

export function claudeAccountMissingUnresolved(
  account: string,
  reason: string
): ConnectedAccountsUnresolved {
  return { tool: 'claude', account, reason, fixCommand: CONNECTED_ACCOUNTS_CLAUDE_FIX }
}

/** Email when the account is known, else its id, so the refusal always names the account. */
export function claudeBoundAccountLabel(
  settings: ConnectedAccountsSettings,
  accountId: string
): string {
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

// firebase-tools (and its MCP) checks FIREBASE_TOKEN before the signed-in user, so a bogus one fails auth closed.
const FIREBASE_BLOCKED_ENV = { FIREBASE_TOKEN: CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED }

export async function resolveConnectedAccountsSpawnEnv(args: {
  repo: Repo | undefined
  worktreePath: string | undefined
  settings: ConnectedAccountsSettings
  baseEnv: Record<string, string>
  platform: NodeJS.Platform
  /** A bound WSL runtime is unresolved: no WSLENV forwarding in v1, so the guest would use its default. */
  runtime?: 'host' | 'wsl'
  home?: string
}): Promise<ConnectedAccountsSpawnEnv> {
  const { repo, worktreePath, settings, baseEnv, platform } = args
  const scope = connectedAccountsRepoScope(repo)
  if (!repo || scope === null || !hasBinding(repo)) {
    return EMPTY
  }
  if (
    scope === 'wsl' ||
    args.runtime === 'wsl' ||
    (worktreePath !== undefined && parseWslPath(worktreePath) !== null)
  ) {
    return { env: {}, unresolved: wslUnresolvedForRepo(repo, settings), fingerprint: null }
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
    // The account is keyed per project root in the configstore; FIREBASE_TOKEN beats it, so clear inherited ones.
    const firebase = worktreePath
      ? ensureFirebaseActiveAccount({
          configstorePath: firebaseToolsConfigstorePath(baseEnv, args.home ?? homedir()),
          worktreePath,
          email: bound.firebaseEmail
        })
      : null
    if (firebase?.ok) {
      toolEnv = { ...toolEnv, FIREBASE_TOKEN: '' }
    } else {
      toolEnv = { ...toolEnv, ...FIREBASE_BLOCKED_ENV }
      unresolved.push(
        firebase?.unresolved ?? {
          tool: 'firebase',
          account: bound.firebaseEmail,
          reason: 'This terminal is not inside a worktree'
        }
      )
    }
  }

  return {
    // Extra env last; reserved keys (GH_*, GIT_*, CLAUDE_*, FIREBASE_TOKEN...) never reach it.
    env: { ...toolEnv, ...resolveExtraEnv(bound.extraEnv, platform) },
    ...(claudeOverride ? { claudeOverride } : {}),
    unresolved,
    fingerprint: connectedAccountsFingerprint(repo)
  }
}
