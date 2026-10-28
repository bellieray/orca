import type { SourceControlAiSettingsInput } from '../../shared/source-control-ai'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../shared/execution-host'
import type { Repo } from '../../shared/repo-types'
import type { GitPushTarget, GitWorktreeInfo, Worktree } from '../../shared/worktree/types'
import type { GitRuntimeOptions } from '../git/git-runtime-options'
import { getWorktreeSharedLinkPaths } from '../git/worktree-shared-directories'
import {
  ExecutionHostNotDispatchableError,
  resolveGitRouteForHost
} from '../providers/execution-host-provider-dispatch'
import type { createLocalGitProvider, LocalGitProvider } from '../providers/local-git-provider'
import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'
import type { PullRequestLinkedIssueMeta } from '../source-control/pull-request-linked-issue'
import { normalizeRuntimeRelativePath } from './runtime-relative-paths'
import { resolveConnectedAccountsGitOptions } from '../connected-accounts/connected-accounts-git-options'

export type ResolvedRuntimeGitWorktree = Worktree & { git: GitWorktreeInfo }

export type RuntimeGitTarget = {
  worktree: ResolvedRuntimeGitWorktree
  /** Repo display/settings metadata may come from another host; only executionHostId decides routing. */
  repo?: Repo
  /** Required execution host: resolution must refuse unknown routes, never conflate unresolved/runtime/local as absent connectionId (#11163). */
  executionHostId: ExecutionHostId
  /** Only consulted when `executionHostId` is `local`; see `localGitOptionsForTarget`. */
  localGitOptions?: GitRuntimeOptions
}

export type RuntimeGitCommandHost = {
  resolveRuntimeGitTarget(selector: string): Promise<RuntimeGitTarget>
  getRuntimeSettings(): SourceControlAiSettingsInput
  getCommitMessageAgentEnvironment?(): CommitMessageAgentEnvironmentResolvers | undefined
  /** `undefined` keeps cached metadata; `null` is the authoritative unlinked answer. */
  getWorktreeLinkedIssue?(worktreeId: string): number | null | undefined
  getWorktreeLinkedIssueMeta?(worktreeId: string): PullRequestLinkedIssueMeta | null | undefined
  /** Persist lazily created push remotes for orphan cleanup (#17842); sync materialization skips Store to avoid ownership/refspec side effects (#17828). */
  persistMaterializedPushTarget?(
    worktree: Pick<Worktree, 'id' | 'hostId'>,
    pushTarget: GitPushTarget
  ): void
}

/** Dispatch only hosts this process serves. runtime:<env> targets belong to that server's nested SSH namespace; local lookup could dial a same-named wrong host. */
export type RuntimeGitRoute =
  | { kind: 'local'; createProvider: typeof createLocalGitProvider }
  /** An SSH target this process does not serve; it fails or reports unavailable, never runs here. */
  | { kind: 'ssh'; connectionId: string }

export function runtimeGitRouteForTarget(target: RuntimeGitTarget): RuntimeGitRoute {
  const route = resolveGitRouteForHost(target.executionHostId)
  switch (route.kind) {
    case 'local':
      return { kind: 'local', createProvider: route.createProvider }
    case 'ssh':
      return { kind: 'ssh', connectionId: route.connectionId }
    case 'runtime':
      throw new ExecutionHostNotDispatchableError(route.hostId)
  }
}

/** The local route for work this process runs itself; `ssh:` and `runtime:` hosts throw. */
export function requireLocalRuntimeGitRoute(
  target: RuntimeGitTarget
): Extract<RuntimeGitRoute, { kind: 'local' }> {
  const route = runtimeGitRouteForTarget(target)
  if (route.kind === 'ssh') {
    throw new SshHostNotServedError(route.connectionId)
  }
  return route
}

/** A provider for the target's own host; an `ssh:` host and a `runtime:` host both throw. */
export function requireRuntimeGitProvider(target: RuntimeGitTarget): LocalGitProvider {
  return requireLocalRuntimeGitRoute(target).createProvider({
    ...localGitOptionsForTarget(target),
    getSharedLinkPaths: () => (target.repo ? getWorktreeSharedLinkPaths(target.repo) : [])
  })
}

/** Push/pull/fetch/commit: also pins the repo's bound GitHub account; rejects before git when unresolvable. */
export async function requireRuntimeGitProviderWithConnectedAccounts(
  target: RuntimeGitTarget
): Promise<LocalGitProvider> {
  const route = requireLocalRuntimeGitRoute(target)
  const options = await localGitOptionsWithConnectedAccountsForTarget(target)
  return route.createProvider({
    ...options,
    getSharedLinkPaths: () => (target.repo ? getWorktreeSharedLinkPaths(target.repo) : [])
  })
}

/** Local targets only: remote hosts never inherit this machine's account env. */
export async function localGitOptionsWithConnectedAccountsForTarget(
  target: RuntimeGitTarget
): Promise<GitRuntimeOptions> {
  const options = localGitOptionsForTarget(target)
  if (target.executionHostId !== LOCAL_EXECUTION_HOST_ID) {
    return options
  }
  return resolveConnectedAccountsGitOptions(target.repo, target.worktree.path, options)
}

export function localGitOptionsForTarget(target: RuntimeGitTarget): GitRuntimeOptions {
  // WSL routing describes *this* machine; no remote host may inherit it.
  return target.executionHostId === LOCAL_EXECUTION_HOST_ID ? (target.localGitOptions ?? {}) : {}
}

export function normalizeRuntimeGitRelativePath(filePath: string): string {
  const relativePath = normalizeRuntimeRelativePath(filePath)
  if (relativePath === '') {
    // Why: an empty Git pathspec can mutate the whole worktree.
    throw new Error('invalid_relative_path')
  }
  return relativePath
}
