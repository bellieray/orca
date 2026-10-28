import type { GitForkSyncExpectedUpstream, GitForkSyncResult } from '../../shared/git-fork-sync'
import type { GitUpstreamStatus } from '../../shared/git-status-types'
import type { GitPushTarget } from '../../shared/worktree/types'
import { materializeWorktreePushTargetRemote } from '../ipc/worktree-remote'
import type { LocalGitProvider } from '../providers/local-git-provider'
import {
  localGitOptionsWithConnectedAccountsForTarget,
  requireRuntimeGitProvider,
  requireRuntimeGitProviderWithConnectedAccounts,
  type RuntimeGitCommandHost,
  type RuntimeGitTarget
} from './runtime-git-command-target'

export class RuntimeGitSyncCommands {
  constructor(private readonly host: RuntimeGitCommandHost) {}

  /** Materialize on the worktree host without Store ownership/refspec side effects; persist new push remotes via the resolved worktree's host callback (#17828). */
  private async prepareRemoteSync(
    target: RuntimeGitTarget,
    pushTarget: GitPushTarget | undefined
  ): Promise<{ provider: LocalGitProvider; pushTarget: GitPushTarget | undefined }> {
    const provider = await requireRuntimeGitProviderWithConnectedAccounts(target)
    // Only a not-yet-created fork remote fetches; skip a second account resolution otherwise.
    const materialized =
      pushTarget?.remoteUrl && !pushTarget.remoteCreated
        ? await materializeWorktreePushTargetRemote(
            target.worktree.path,
            pushTarget,
            undefined,
            target.repo?.id,
            // Its fork fetch hits the network: same bound account as the push itself.
            await localGitOptionsWithConnectedAccountsForTarget(target)
          )
        : pushTarget
    if (materialized?.remoteCreated) {
      this.host.persistMaterializedPushTarget?.(target.worktree, materialized)
    }
    return { provider, pushTarget: materialized }
  }

  async abortRuntimeGitMerge(worktreeSelector: string): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    await requireRuntimeGitProvider(target).abortMerge(target.worktree.path)
    return { ok: true }
  }

  async abortRuntimeGitRebase(worktreeSelector: string): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    await requireRuntimeGitProvider(target).abortRebase(target.worktree.path)
    return { ok: true }
  }

  async getRuntimeGitUpstreamStatus(
    worktreeSelector: string,
    pushTarget?: GitPushTarget
  ): Promise<GitUpstreamStatus> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    return requireRuntimeGitProvider(target).getUpstreamStatus(target.worktree.path, pushTarget)
  }

  async fetchRuntimeGit(
    worktreeSelector: string,
    pushTarget?: GitPushTarget
  ): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const sync = await this.prepareRemoteSync(target, pushTarget)
    await sync.provider.fetchRemote(target.worktree.path, sync.pushTarget)
    return { ok: true }
  }

  async syncRuntimeGitForkDefaultBranch(
    worktreeSelector: string,
    expectedUpstream: GitForkSyncExpectedUpstream
  ): Promise<GitForkSyncResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = await requireRuntimeGitProviderWithConnectedAccounts(target)
    return provider.syncForkDefaultBranch(target.worktree.path, expectedUpstream)
  }

  async pullRuntimeGit(
    worktreeSelector: string,
    pushTarget?: GitPushTarget
  ): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const sync = await this.prepareRemoteSync(target, pushTarget)
    await sync.provider.pullBranch(target.worktree.path, sync.pushTarget)
    return { ok: true }
  }

  async fastForwardRuntimeGit(
    worktreeSelector: string,
    pushTarget?: GitPushTarget
  ): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const sync = await this.prepareRemoteSync(target, pushTarget)
    await sync.provider.fastForwardBranch(target.worktree.path, sync.pushTarget)
    return { ok: true }
  }

  async rebaseRuntimeGitFromBase(worktreeSelector: string, baseRef: string): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = await requireRuntimeGitProviderWithConnectedAccounts(target)
    await provider.rebaseFromBase(target.worktree.path, baseRef)
    return { ok: true }
  }

  async pushRuntimeGit(
    worktreeSelector: string,
    publish?: boolean,
    pushTarget?: GitPushTarget,
    forceWithLease?: boolean
  ): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const sync = await this.prepareRemoteSync(target, pushTarget)
    await sync.provider.pushBranch(target.worktree.path, publish === true, sync.pushTarget, {
      forceWithLease: forceWithLease === true
    })
    return { ok: true }
  }

  async commitRuntimeGit(
    worktreeSelector: string,
    message: string
  ): Promise<{ success: boolean; error?: string }> {
    if (message.trim().length === 0) {
      throw new Error('Commit message is required')
    }
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = await requireRuntimeGitProviderWithConnectedAccounts(target)
    return provider.commit(target.worktree.path, message)
  }
}
