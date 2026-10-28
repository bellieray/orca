import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WORKTREE_ID_SEPARATOR, type ParsedWorktreeId } from '../../shared/worktree/id'
import type * as WorktreeIdModule from '../../shared/worktree/id'

const counter = vi.hoisted(() => ({ splitCalls: 0 }))
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

// Count per-row parsing to expose O(repos × rows) rescans.
vi.mock('../../shared/worktree/id', async (importOriginal) => {
  const actual = await importOriginal<typeof WorktreeIdModule>()
  return {
    ...actual,
    splitWorktreeId: (worktreeId: string): ParsedWorktreeId | null => {
      counter.splitCalls += 1
      return actual.splitWorktreeId(worktreeId)
    }
  }
})

const {
  getLocalRepoForRegisteredWorktree,
  getLocalGitOptionsForRegisteredWorktreeWithConnectedAccounts
} = await import('./local-worktree-runtime-options')
const { clearGitConfigEnvSupportCacheForTests } =
  await import('../connected-accounts/connected-accounts-git-env')

type TestRepo = { id: string; path: string; connectionId?: string }

const makeStore = (
  repos: readonly TestRepo[],
  worktreeIds: readonly string[]
): { store: never; metaScans: () => number } => {
  let metaScans = 0
  const meta = Object.fromEntries(worktreeIds.map((id) => [id, {}]))
  const store = {
    getRepos: () => repos,
    getAllWorktreeMeta: () => {
      metaScans += 1
      return meta
    }
  }
  return { store: store as never, metaScans: () => metaScans }
}

const worktreeId = (repoId: string, path: string): string =>
  `${repoId}${WORKTREE_ID_SEPARATOR}${path}`

beforeEach(() => {
  counter.splitCalls = 0
})

describe('getLocalRepoForRegisteredWorktree', () => {
  it('walks the worktree meta table once, not once per repo', () => {
    // Put the owner last to expose scans repeated for earlier repos.
    const repoCount = 10
    const rowCount = 200
    const repos = Array.from({ length: repoCount }, (_, i) => ({
      id: `repo-${i}`,
      path: `/repos/repo-${i}`
    }))
    const target = '/repos/repo-9/wt-last'
    const worktreeIds = Array.from({ length: rowCount }, (_, i) =>
      worktreeId(`repo-${i % repoCount}`, `/repos/wt-${i}`)
    )
    worktreeIds[rowCount - 1] = worktreeId(`repo-${repoCount - 1}`, target)
    const { store, metaScans } = makeStore(repos, worktreeIds)

    expect(getLocalRepoForRegisteredWorktree(store, target, target)?.id).toBe('repo-9')
    expect(metaScans()).toBe(1)
    expect(counter.splitCalls).toBe(rowCount)
  })

  it('never touches the meta table when a repo path matches directly', () => {
    const { store, metaScans } = makeStore([{ id: 'repo-a', path: '/repos/a' }], [])
    expect(getLocalRepoForRegisteredWorktree(store, '/repos/a', '/repos/a')?.id).toBe('repo-a')
    expect(metaScans()).toBe(0)
  })

  describe('equivalence with the per-repo scan', () => {
    const repos: TestRepo[] = [
      { id: 'first', path: '/repos/first' },
      { id: 'middle', path: '/repos/middle' },
      { id: 'last', path: '/repos/last' }
    ]

    it('finds a worktree owned by the first repo', () => {
      const { store } = makeStore(repos, [worktreeId('first', '/wt/one')])
      expect(getLocalRepoForRegisteredWorktree(store, '/wt/one', '/wt/one')?.id).toBe('first')
    })

    it('finds a worktree owned by the last repo', () => {
      const { store } = makeStore(repos, [worktreeId('last', '/wt/one')])
      expect(getLocalRepoForRegisteredWorktree(store, '/wt/one', '/wt/one')?.id).toBe('last')
    })

    it('returns undefined when no repo owns the worktree', () => {
      const { store } = makeStore(repos, [worktreeId('other', '/wt/elsewhere')])
      expect(getLocalRepoForRegisteredWorktree(store, '/wt/one', '/wt/one')).toBeUndefined()
    })

    it('keeps getRepos precedence when two repos both own the path', () => {
      const { store } = makeStore(repos, [
        worktreeId('last', '/wt/shared'),
        worktreeId('middle', '/wt/shared')
      ])
      // getRepos order decides, not the meta table's insertion order.
      expect(getLocalRepoForRegisteredWorktree(store, '/wt/shared', '/wt/shared')?.id).toBe(
        'middle'
      )
    })

    it('excludes an SSH repo even when it owns the registered worktree', () => {
      const { store } = makeStore(
        [{ id: 'remote', path: '/repos/remote', connectionId: 'm4air' }, ...repos],
        [worktreeId('remote', '/wt/one'), worktreeId('middle', '/wt/one')]
      )
      expect(getLocalRepoForRegisteredWorktree(store, '/wt/one', '/wt/one')?.id).toBe('middle')

      const onlyRemote = makeStore(
        [{ id: 'remote', path: '/repos/remote', connectionId: 'm4air' }],
        [worktreeId('remote', '/wt/one')]
      )
      expect(
        getLocalRepoForRegisteredWorktree(onlyRemote.store, '/wt/one', '/wt/one')
      ).toBeUndefined()
    })

    it('matches the resolved path spelling as well as the raw one', () => {
      const { store } = makeStore(repos, [worktreeId('middle', '/wt/one')])
      expect(getLocalRepoForRegisteredWorktree(store, '/wt/other', '/wt/one')?.id).toBe('middle')
    })

    it('returns undefined for a folder workspace that is not a registered worktree', () => {
      const { store } = makeStore(repos, [worktreeId('middle', '/wt/one')])
      expect(
        getLocalRepoForRegisteredWorktree(store, '/folders/notes', '/folders/notes')
      ).toBeUndefined()
    })

    it('tolerates a store without getRepos or getAllWorktreeMeta', () => {
      expect(getLocalRepoForRegisteredWorktree({} as never, '/wt/one', '/wt/one')).toBeUndefined()
      expect(
        getLocalRepoForRegisteredWorktree({ getRepos: () => repos } as never, '/wt/one', '/wt/one')
      ).toBeUndefined()
    })
  })
})

describe('getLocalGitOptionsForRegisteredWorktreeWithConnectedAccounts', () => {
  const WT = '/repos/bound/wt-feature'
  const boundRepo = {
    id: 'bound',
    path: '/repos/bound',
    ghAccount: { host: 'github.com', user: 'octo-personal' },
    connectedAccounts: {
      gitAuthor: { name: 'Octo Personal', email: 'octo@example.com' }
    }
  }
  const makeBindingStore = (repos: readonly object[]): never =>
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: git mock calls are untyped tuples; args is always the git argv array.
    ({
      getRepos: () => repos,
      getAllWorktreeMeta: () => ({ [worktreeId('bound', WT)]: {} }),
      getProjects: () => [],
      getSettings: () => ({})
    }) as never

  const networkGitCalls = (): unknown[][] =>
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: git mock calls are untyped tuples; args is always the git argv array.
    gitExecFileAsyncMock.mock.calls.filter(([args]) => !(args as string[]).includes('--version'))

  beforeEach(() => {
    clearGitConfigEnvSupportCacheForTests()
    resolveGhAccountTokenMock.mockReset()
    gitExecFileAsyncMock.mockReset()
    gitExecFileAsyncMock.mockResolvedValue({
      stdout: 'git version 2.45.0\n',
      stderr: ''
    })
  })

  it('push options for a bound repo carry the pinned credential helper and token', async () => {
    resolveGhAccountTokenMock.mockResolvedValue('gho_bound_token')
    const options = await getLocalGitOptionsForRegisteredWorktreeWithConnectedAccounts(
      makeBindingStore([boundRepo]),
      WT,
      WT
    )
    const env = options.env ?? {}
    expect(env.GH_TOKEN).toBe('gho_bound_token')
    expect(env.GH_HOST).toBe('github.com')
    const count = Number(env.GIT_CONFIG_COUNT)
    const helperValues: string[] = []
    for (let i = 0; i < count; i += 1) {
      if (env[`GIT_CONFIG_KEY_${i}`] === 'credential.https://github.com.helper') {
        helperValues.push(env[`GIT_CONFIG_VALUE_${i}`] ?? '')
      }
    }
    expect(helperValues).toEqual(['', '!gh auth git-credential'])
    expect(env.GIT_AUTHOR_EMAIL).toBe('octo@example.com')
    expect(env.GIT_COMMITTER_NAME).toBe('Octo Personal')
    // Merged onto process.env: git-spawn uses options.env as the whole child env.
    expect(env.PATH).toBe(process.env.PATH)
    expect(networkGitCalls()).toEqual([])
  })

  it('unbound repo options carry no env', async () => {
    const options = await getLocalGitOptionsForRegisteredWorktreeWithConnectedAccounts(
      makeBindingStore([{ id: 'bound', path: '/repos/bound' }]),
      WT,
      WT
    )
    expect(options).toEqual({})
    expect('env' in options).toBe(false)
    expect(resolveGhAccountTokenMock).not.toHaveBeenCalled()
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('unresolvable binding rejects before git runs', async () => {
    resolveGhAccountTokenMock.mockRejectedValue(new Error('no token'))
    await expect(
      getLocalGitOptionsForRegisteredWorktreeWithConnectedAccounts(
        makeBindingStore([boundRepo]),
        WT,
        WT
      )
    ).rejects.toThrow(
      'GitHub account octo-personal@github.com is not available: it is not signed in to gh on this machine. Fix: gh auth login --hostname github.com'
    )
    expect(networkGitCalls()).toEqual([])
  })

  it('a bound repo still applies to a worktree with no meta row (found via its git common dir)', async () => {
    resolveGhAccountTokenMock.mockResolvedValue('gho_bound_token')
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) =>
      args.includes('--git-common-dir')
        ? { stdout: '/repos/bound/.git\n', stderr: '' }
        : { stdout: 'git version 2.45.0\n', stderr: '' }
    )
    const options = await getLocalGitOptionsForRegisteredWorktreeWithConnectedAccounts(
      makeBindingStore([boundRepo]),
      '/custom/base/wt-external',
      '/custom/base/wt-external'
    )
    expect(options.env?.GH_TOKEN).toBe('gho_bound_token')
  })

  it('skips the common-dir lookup when no repo has a binding', async () => {
    const options = await getLocalGitOptionsForRegisteredWorktreeWithConnectedAccounts(
      makeBindingStore([{ id: 'bound', path: '/repos/bound' }]),
      '/custom/base/wt-external',
      '/custom/base/wt-external'
    )
    expect(options).toEqual({})
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
  })
})
