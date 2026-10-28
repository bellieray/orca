// Applies a project's bound GitHub account to Orca's own git children (push/pull/fetch/commit).
// Tokens only ever live in the returned env: never log or persist it.
import type { Repo } from '../../shared/repo-types'
import { resolveGhSpawnEnv } from './connected-accounts-git-env'
import {
  connectedAccountsApplyToRepo,
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
  | { kind: 'unresolved'; unresolved: ConnectedAccountsUnresolved }

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
  // WSL runtimes stay on machine defaults in v1, matching agent/terminal spawn.
  if (!connectedAccountsApplyToRepo(repo) || !repo.ghAccount || wslDistro) {
    return { kind: 'none' }
  }
  const baseEnv = processEnvStrings()
  const gh = await resolveGhSpawnEnv({
    binding: repo.ghAccount,
    author: repo.connectedAccounts?.gitAuthor,
    cwd,
    baseEnv
  })
  if ('unresolved' in gh) {
    return { kind: 'unresolved', unresolved: gh.unresolved }
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
 * For background/best-effort read fetches: the bound env when it resolves, otherwise undefined
 * (machine default) with one warning per repo+account so a broken binding does not spam logs.
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
    return undefined
  }
  if (resolved.kind === 'bound') {
    return resolved.env
  }
  if (resolved.kind === 'unresolved') {
    const key = `${repo?.id ?? repo?.path}::${resolved.unresolved.account}`
    if (!warnedUnresolvedFetches.has(key)) {
      warnedUnresolvedFetches.add(key)
      console.warn(
        `[connected-accounts] background fetch uses the machine default account: ${formatConnectedAccountsUnresolved(resolved.unresolved)}`
      )
    }
  }
  return undefined
}

/** @internal — test-only */
export function clearConnectedAccountsFetchWarningsForTests(): void {
  warnedUnresolvedFetches.clear()
}
