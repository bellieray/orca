import { gitExecFileAsync } from '../git/runner'
import {
  githubPullRequestHeadLocalRef,
  isSafeReviewHeadFetchRemote,
  isValidReviewHeadNumber,
  REVIEW_HEAD_FETCH_TIMEOUT_MS
} from '../../shared/review-head-tracking-ref'
import { getReviewHeadRemoteComponent } from '../git/review-head-remote-identity'
import {
  SSH_GIT_RECONNECT_MESSAGE,
  SshHostNotServedError
} from '../providers/ssh-host-not-served-error'
import { getRepoRoutingConnectionId } from '../../shared/execution-host'
import type { Repo } from '../../shared/repo-types'
import {
  resolveConnectedAccountsFetchEnv,
  type ConnectedAccountsGitRepo
} from '../connected-accounts/connected-accounts-git-options'

type LocalGitExecOptions = {
  cwd: string
  wslDistro?: string
}

type PrHeadFetchRepo = { path: string } & Pick<Repo, 'connectionId' | 'executionHostId'> &
  Partial<Omit<ConnectedAccountsGitRepo, 'path' | 'connectionId' | 'executionHostId'>>

/** Best-effort: the bound GitHub account when it resolves, else the machine default. */
async function boundFetchEnv(
  repo: PrHeadFetchRepo,
  options: LocalGitExecOptions
): Promise<{ env?: NodeJS.ProcessEnv }> {
  const env = await resolveConnectedAccountsFetchEnv(repo, options.cwd, options.wslDistro)
  return env ? { env } : {}
}

export async function fetchPrHeadTrackingRef(
  repo: PrHeadFetchRepo,
  remote: string,
  branch: string,
  options: { localGitExecOptions?: LocalGitExecOptions } = {}
): Promise<void> {
  const sshTargetId = getRepoRoutingConnectionId(repo)
  if (sshTargetId) {
    throw new SshHostNotServedError(sshTargetId, SSH_GIT_RECONNECT_MESSAGE)
  }
  const localGitExecOptions = options.localGitExecOptions ?? { cwd: repo.path }
  await gitExecFileAsync(
    ['fetch', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`],
    {
      ...localGitExecOptions,
      ...(await boundFetchEnv(repo, localGitExecOptions)),
      timeout: REVIEW_HEAD_FETCH_TIMEOUT_MS
    }
  )
}

export async function fetchGitHubPullRequestHeadRef(
  repo: PrHeadFetchRepo,
  remote: string,
  prNumber: number,
  options: { localGitExecOptions?: LocalGitExecOptions } = {}
): Promise<string> {
  if (!isValidReviewHeadNumber(prNumber)) {
    throw new Error(`Invalid pull request number: ${String(prNumber)}`)
  }
  if (!isSafeReviewHeadFetchRemote(remote)) {
    throw new Error('Pull request fetch remote must not start with "-".')
  }
  const sshTargetId = getRepoRoutingConnectionId(repo)
  if (sshTargetId) {
    throw new SshHostNotServedError(sshTargetId, SSH_GIT_RECONNECT_MESSAGE)
  }
  const localGitExecOptions = options.localGitExecOptions ?? { cwd: repo.path }
  const remoteComponent = await getReviewHeadRemoteComponent(remote, localGitExecOptions)
  // Return the written ref so callers do not recompute its remote identity.
  const localRef = githubPullRequestHeadLocalRef(remoteComponent, prNumber)
  await gitExecFileAsync(
    ['fetch', '--no-tags', remote, `+refs/pull/${prNumber}/head:${localRef}`],
    {
      ...localGitExecOptions,
      ...(await boundFetchEnv(repo, localGitExecOptions)),
      timeout: REVIEW_HEAD_FETCH_TIMEOUT_MS
    }
  )
  return localRef
}
