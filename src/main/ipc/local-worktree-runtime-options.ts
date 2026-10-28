import { resolve } from 'node:path'
import type { RuntimeStore } from '../runtime/runtime-store-contract'
import {
  getLocalProjectWorktreeGitOptions,
  type LocalProjectWorktreeGitOptions
} from '../project-runtime-git-options'
import { splitWorktreeId } from '../../shared/worktree/id'
import type { Repo } from '../../shared/repo-types'
import { resolveGhSpawnEnv } from '../connected-accounts/connected-accounts-git-env'
import {
  connectedAccountsApplyToRepo,
  formatConnectedAccountsLaunchError
} from '../connected-accounts/connected-accounts-spawn-env'

function comparableLocalPath(value: string): string {
  const normalized = resolve(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function getCandidateLocalWorktreePaths(
  worktreePath: string,
  resolvedWorktreePath: string
): Set<string> {
  return new Set([worktreePath, resolvedWorktreePath].map(comparableLocalPath))
}

function collectRepoIdsWithRegisteredWorktreeMeta(
  store: RuntimeStore,
  candidatePaths: Set<string>
): Set<string> {
  const worktreeMeta =
    typeof store.getAllWorktreeMeta === 'function' ? store.getAllWorktreeMeta() : {}
  const repoIds = new Set<string>()
  for (const worktreeId of Object.keys(worktreeMeta)) {
    const parsed = splitWorktreeId(worktreeId)
    if (parsed && candidatePaths.has(comparableLocalPath(parsed.worktreePath))) {
      repoIds.add(parsed.repoId)
    }
  }
  return repoIds
}

export function getLocalRepoForRegisteredWorktree(
  store: RuntimeStore,
  worktreePath: string,
  resolvedWorktreePath: string
): Repo | undefined {
  if (typeof store.getRepos !== 'function') {
    return undefined
  }

  const candidatePaths = getCandidateLocalWorktreePaths(worktreePath, resolvedWorktreePath)
  // Lazily scan meta once, not once per repo, on frequent IPC paths.
  let repoIdsWithMeta: Set<string> | undefined
  return store
    .getRepos()
    .find(
      (repo) =>
        !repo.connectionId &&
        (candidatePaths.has(comparableLocalPath(repo.path)) ||
          (repoIdsWithMeta ??= collectRepoIdsWithRegisteredWorktreeMeta(store, candidatePaths)).has(
            repo.id
          ))
    )
}

/** Reuse a resolved repo without scanning worktree metadata again. */
export function getLocalGitOptionsForRepo(
  store: RuntimeStore,
  repo: Repo | undefined
): LocalProjectWorktreeGitOptions {
  if (!repo || typeof store.getProjects !== 'function' || typeof store.getSettings !== 'function') {
    return {}
  }
  // Match project Git/terminal runtime even for Windows-spelled paths.
  return getLocalProjectWorktreeGitOptions(store, repo)
}

export function getLocalGitOptionsForRegisteredWorktree(
  store: RuntimeStore,
  worktreePath: string,
  resolvedWorktreePath: string
): LocalProjectWorktreeGitOptions {
  if (typeof store.getProjects !== 'function' || typeof store.getSettings !== 'function') {
    return {}
  }

  return getLocalGitOptionsForRepo(
    store,
    getLocalRepoForRegisteredWorktree(store, worktreePath, resolvedWorktreePath)
  )
}

export type LocalWorktreeGitOptionsWithConnectedAccounts = LocalProjectWorktreeGitOptions & {
  env?: NodeJS.ProcessEnv
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

/**
 * For Orca's own push/pull/fetch/commit: adds the project's bound GitHub account and git author.
 * Unbound, WSL or remote repos get exactly the plain options (no `env`), so their git runs unchanged.
 * Throws before any git child runs when the binding cannot be resolved; never logs the token.
 */
export async function getLocalGitOptionsForRegisteredWorktreeWithConnectedAccounts(
  store: RuntimeStore,
  worktreePath: string,
  resolvedWorktreePath: string
): Promise<LocalWorktreeGitOptionsWithConnectedAccounts> {
  if (typeof store.getProjects !== 'function' || typeof store.getSettings !== 'function') {
    return {}
  }
  const repo = getLocalRepoForRegisteredWorktree(store, worktreePath, resolvedWorktreePath)
  const options = getLocalGitOptionsForRepo(store, repo)
  if (!connectedAccountsApplyToRepo(repo) || !repo.ghAccount || options.wslDistro) {
    return options
  }
  const baseEnv = processEnvStrings()
  const gh = await resolveGhSpawnEnv({
    binding: repo.ghAccount,
    author: repo.connectedAccounts?.gitAuthor,
    cwd: resolvedWorktreePath,
    baseEnv
  })
  if ('unresolved' in gh) {
    throw formatConnectedAccountsLaunchError([gh.unresolved])
  }
  // GIT_CONFIG_* indices were computed against this same base, so merge onto it, not a bare patch.
  return { ...options, env: { ...baseEnv, ...gh.env } }
}
