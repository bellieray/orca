import { realpathSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { gitExecFileAsync } from '../git/runner'
import type { RuntimeStore } from '../runtime/runtime-store-contract'
import {
  getLocalProjectWorktreeGitOptions,
  type LocalProjectWorktreeGitOptions
} from '../project-runtime-git-options'
import { splitWorktreeId } from '../../shared/worktree/id'
import { getRepoRoutingConnectionId } from '../../shared/execution-host'
import type { Repo } from '../../shared/repo-types'
import {
  resolveConnectedAccountsFetchEnv,
  resolveConnectedAccountsGitOptions
} from '../connected-accounts/connected-accounts-git-options'
import {
  CONNECTED_ACCOUNTS_NO_LAUNCH,
  connectedAccountsLaunchResolver,
  type ConnectedAccountsLaunchResolver
} from '../connected-accounts/connected-accounts-agent-launch'

const GIT_COMMON_DIR_TIMEOUT_MS = 10_000

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

function realOrResolved(path: string): string {
  try {
    return comparableLocalPath(realpathSync(path))
  } catch {
    return comparableLocalPath(path)
  }
}

/**
 * Like getLocalRepoForRegisteredWorktree, but a worktree with no meta row (added outside Orca, custom
 * base path) still finds its bound repo through git's common dir, so its git never uses the default account.
 */
export async function getLocalRepoForWorktreeWithBindings(
  store: RuntimeStore,
  worktreePath: string,
  resolvedWorktreePath: string
): Promise<Repo | undefined> {
  const direct = getLocalRepoForRegisteredWorktree(store, worktreePath, resolvedWorktreePath)
  if (direct || typeof store.getRepos !== 'function') {
    return direct
  }
  const bound = store
    .getRepos()
    .filter(
      (repo) => !getRepoRoutingConnectionId(repo) && (repo.ghAccount || repo.connectedAccounts)
    )
  if (bound.length === 0) {
    return undefined
  }
  let commonDir: string
  try {
    const { stdout } = await gitExecFileAsync(['rev-parse', '--git-common-dir'], {
      cwd: resolvedWorktreePath,
      timeout: GIT_COMMON_DIR_TIMEOUT_MS
    })
    commonDir = resolve(resolvedWorktreePath, stdout.trim())
  } catch {
    return undefined
  }
  // A normal repo's common dir is <main worktree>/.git; a bare repo's is the repo path itself.
  const candidates = new Set([realOrResolved(commonDir)])
  if (basename(commonDir) === '.git') {
    candidates.add(realOrResolved(dirname(commonDir)))
  }
  return bound.find((repo) => candidates.has(realOrResolved(repo.path)))
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
  const repo = await getLocalRepoForWorktreeWithBindings(store, worktreePath, resolvedWorktreePath)
  return resolveConnectedAccountsGitOptions(
    repo,
    resolvedWorktreePath,
    getLocalGitOptionsForRepo(store, repo)
  )
}

/** Best-effort bound env for a background fetch of a registered local repo/worktree path; never throws. */
export async function resolveConnectedAccountsFetchEnvForPath(
  store: RuntimeStore | null | undefined,
  repoPath: string,
  wslDistro?: string
): Promise<NodeJS.ProcessEnv | undefined> {
  if (!store) {
    return undefined
  }
  const repo = await getLocalRepoForWorktreeWithBindings(store, repoPath, repoPath)
  return resolveConnectedAccountsFetchEnv(repo, repoPath, wslDistro)
}

/** Project accounts for a one-shot agent run (commit/PR text, model listing) in a local worktree. */
export function connectedAccountsLaunchForWorktree(
  store: RuntimeStore,
  worktreePath: string,
  resolvedWorktreePath: string
): ConnectedAccountsLaunchResolver {
  return async (baseEnv, runtime) => {
    const repo = await getLocalRepoForWorktreeWithBindings(
      store,
      worktreePath,
      resolvedWorktreePath
    )
    const resolveLaunch = connectedAccountsLaunchResolver(
      repo,
      resolvedWorktreePath,
      typeof store.getSettings === 'function' ? store.getSettings() : {}
    )
    return resolveLaunch ? resolveLaunch(baseEnv, runtime) : CONNECTED_ACCOUNTS_NO_LAUNCH
  }
}
