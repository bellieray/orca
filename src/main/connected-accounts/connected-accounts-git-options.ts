// Applies a project's bound GitHub account to Orca's own git children (push/pull/fetch/commit).
// Tokens only ever live in the returned env: never log or persist it.
import type { Repo } from '../../shared/repo-types'
import { buildBlockedGhEnvPatch, resolveGhSpawnEnv } from './connected-accounts-git-env'
import {
  connectedAccountsRepoScope,
  connectedAccountsWslUnresolved,
  formatConnectedAccountsLaunchError,
  formatConnectedAccountsUnresolved,
  type ConnectedAccountsRoutingRepo
} from './connected-accounts-spawn-env'
import type { ConnectedAccountsUnresolved } from './connected-accounts-static-env'

export type ConnectedAccountsGitRepo = ConnectedAccountsRoutingRepo &
  Partial<Pick<Repo, 'id' | 'ghAccount' | 'connectedAccounts'>>

type GitEnvResolution =
  | { kind: 'none' }
  | { kind: 'bound'; env: NodeJS.ProcessEnv }
  | { kind: 'unresolved'; unresolved: ConnectedAccountsUnresolved; env?: NodeJS.ProcessEnv }

function ghAccountLabel(binding: NonNullable<Repo['ghAccount']>): string {
  return `${binding.user}@${binding.host}`
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

async function resolveConnectedAccountsGitEnv(
  repo: ConnectedAccountsGitRepo | undefined,
  cwd: string,
  wslDistro: string | undefined
): Promise<GitEnvResolution> {
  const scope = connectedAccountsRepoScope(repo)
  if (!repo?.ghAccount || scope === null) {
    return { kind: 'none' }
  }
  if (scope === 'wsl' || wslDistro) {
    // No env reaches git inside WSL in v1, so a bound WSL project fails loud instead of using the guest default.
    return {
      kind: 'unresolved',
      unresolved: connectedAccountsWslUnresolved('github', ghAccountLabel(repo.ghAccount))
    }
  }
  const baseEnv = processEnvStrings()
  const gh = await resolveGhSpawnEnv({
    binding: repo.ghAccount,
    author: repo.connectedAccounts?.gitAuthor,
    cwd,
    baseEnv
  })
  if ('unresolved' in gh) {
    return { kind: 'unresolved', unresolved: gh.unresolved, env: { ...baseEnv, ...gh.env } }
  }
  // git-spawn uses options.env as the whole child env, and the GIT_CONFIG_* indices were built on this base.
  return { kind: 'bound', env: { ...baseEnv, ...gh.env } }
}

/**
 * For user-initiated push/pull/fetch/commit. Unbound repos get `baseOptions` back untouched (no `env`);
 * an unresolvable binding throws before any git child runs.
 */
export async function resolveConnectedAccountsGitOptions<T extends { wslDistro?: string }>(
  repo: ConnectedAccountsGitRepo | undefined,
  cwd: string,
  baseOptions: T
): Promise<T & { env?: NodeJS.ProcessEnv }> {
  const resolved = await resolveConnectedAccountsGitEnv(repo, cwd, baseOptions.wslDistro)
  if (resolved.kind === 'unresolved') {
    throw formatConnectedAccountsLaunchError([resolved.unresolved])
  }
  return resolved.kind === 'bound' ? { ...baseOptions, env: resolved.env } : baseOptions
}

const warnedUnresolvedFetches = new Set<string>()

/**
 * For background/best-effort read fetches: the bound env when it resolves, otherwise an env that
 * fails gh/git auth closed (polling tolerates the git_error), never the machine default account.
 */
export async function resolveConnectedAccountsFetchEnv(
  repo: ConnectedAccountsGitRepo | undefined,
  cwd: string,
  wslDistro?: string
): Promise<NodeJS.ProcessEnv | undefined> {
  let resolved: GitEnvResolution
  try {
    resolved = await resolveConnectedAccountsGitEnv(repo, cwd, wslDistro)
  } catch {
    if (connectedAccountsRepoScope(repo) !== 'local' || !repo?.ghAccount) {
      return undefined
    }
    const baseEnv = processEnvStrings()
    resolved = {
      kind: 'unresolved',
      unresolved: {
        tool: 'github',
        account: ghAccountLabel(repo.ghAccount),
        reason: 'the account could not be resolved'
      },
      env: { ...baseEnv, ...buildBlockedGhEnvPatch(repo.ghAccount, baseEnv) }
    }
  }
  if (resolved.kind === 'bound') {
    return resolved.env
  }
  if (resolved.kind === 'unresolved') {
    const key = `${repo?.id ?? repo?.path}::${resolved.unresolved.account}`
    if (!warnedUnresolvedFetches.has(key)) {
      warnedUnresolvedFetches.add(key)
      console.warn(
        `[connected-accounts] background fetch is blocked for the bound account: ${formatConnectedAccountsUnresolved(resolved.unresolved)}`
      )
    }
    // WSL has no env to block with (undefined); push/commit refuse there instead.
    return resolved.env
  }
  return undefined
}

/** @internal — test-only */
export function clearConnectedAccountsFetchWarningsForTests(): void {
  warnedUnresolvedFetches.clear()
}
