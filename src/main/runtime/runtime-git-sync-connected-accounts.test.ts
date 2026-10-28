import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { Repo } from '../../shared/repo-types'
import type { ResolvedRuntimeGitWorktree } from './runtime-git-command-target'

const { resolveGhAccountTokenMock, gitExecFileAsyncMock } = vi.hoisted(() => ({
  resolveGhAccountTokenMock: vi.fn(),
  gitExecFileAsyncMock: vi.fn()
}))

vi.mock('../github/gh-account-token', () => ({
  resolveGhAccountToken: resolveGhAccountTokenMock
}))

vi.mock('../git/runner', () => ({
  gitExecFileAsync: gitExecFileAsyncMock
}))

const { RuntimeGitSyncCommands } = await import('./runtime-git-sync-commands')
const { clearGitConfigEnvSupportCacheForTests } =
  await import('../connected-accounts/connected-accounts-git-env')

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles and untyped mock call tuples carry only the members these git commands read.
const worktree = { id: 'wt-1', path: '/workspace/bound' } as ResolvedRuntimeGitWorktree
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles and untyped mock call tuples carry only the members these git commands read.
const boundRepo = {
  id: 'bound',
  path: '/workspace/bound',
  displayName: 'bound',
  badgeColor: '#000',
  addedAt: 0,
  ghAccount: { host: 'github.com', user: 'octo-personal' },
  connectedAccounts: { gitAuthor: { name: 'Octo', email: 'octo@example.com' } }
} as Repo

function commandsFor(repo: Repo | undefined): InstanceType<typeof RuntimeGitSyncCommands> {
  return new RuntimeGitSyncCommands({
    resolveRuntimeGitTarget: async () => ({ executionHostId: 'local', worktree, repo }),
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles and untyped mock call tuples carry only the members these git commands read.
    getRuntimeSettings: () => ({}) as GlobalSettings
  })
}

const callsFor = (subcommand: string): { env?: NodeJS.ProcessEnv }[] =>
  gitExecFileAsyncMock.mock.calls
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles and untyped mock call tuples carry only the members these git commands read.
    .filter(([args]) => (args as string[]).includes(subcommand))
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles and untyped mock call tuples carry only the members these git commands read.
    .map(([, options]) => options as { env?: NodeJS.ProcessEnv })

describe('runtime (CLI/mobile) git sync with a bound GitHub account', () => {
  beforeEach(() => {
    clearGitConfigEnvSupportCacheForTests()
    resolveGhAccountTokenMock.mockReset()
    gitExecFileAsyncMock.mockReset()
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args.includes('--version')) {
        return { stdout: 'git version 2.45.0\n', stderr: '' }
      }
      if (args[0] === 'rev-parse' || args[0] === 'config') {
        throw Object.assign(new Error('no upstream'), { code: 1 })
      }
      return { stdout: '', stderr: '' }
    })
  })

  it('a runtime push for a bound repo carries the pinned env', async () => {
    resolveGhAccountTokenMock.mockResolvedValue('gho_bound_token')
    await commandsFor(boundRepo).pushRuntimeGit('id:wt-1', true)
    const [push] = callsFor('push')
    expect(push?.env?.GH_TOKEN).toBe('gho_bound_token')
    expect(push?.env?.GIT_AUTHOR_EMAIL).toBe('octo@example.com')
    expect(push?.env?.PATH).toBe(process.env.PATH)
  })

  it('a runtime commit for a bound repo carries the bound author', async () => {
    resolveGhAccountTokenMock.mockResolvedValue('gho_bound_token')
    await commandsFor(boundRepo).commitRuntimeGit('id:wt-1', 'msg')
    const [commit] = callsFor('commit')
    expect(commit?.env?.GIT_COMMITTER_EMAIL).toBe('octo@example.com')
  })

  it('an unresolved binding rejects before git runs', async () => {
    resolveGhAccountTokenMock.mockRejectedValue(new Error('no token'))
    await expect(commandsFor(boundRepo).pushRuntimeGit('id:wt-1', true)).rejects.toThrow(
      'GitHub account octo-personal@github.com is not available: it is not signed in to gh on this machine. Fix: gh auth login --hostname github.com'
    )
    await expect(commandsFor(boundRepo).commitRuntimeGit('id:wt-1', 'msg')).rejects.toThrow(
      'is not available'
    )
    const nonProbe = gitExecFileAsyncMock.mock.calls.filter(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles and untyped mock call tuples carry only the members these git commands read.
      ([args]) => !(args as string[]).includes('--version')
    )
    expect(nonProbe).toEqual([])
  })

  it('an unbound repo push adds no env', async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles and untyped mock call tuples carry only the members these git commands read.
    await commandsFor({ ...boundRepo, ghAccount: undefined } as Repo).pushRuntimeGit(
      'id:wt-1',
      true
    )
    const [push] = callsFor('push')
    expect(push).toBeDefined()
    expect(push && 'env' in push).toBe(false)
    expect(resolveGhAccountTokenMock).not.toHaveBeenCalled()
  })
})
