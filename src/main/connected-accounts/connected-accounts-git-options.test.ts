import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'

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

const { resolveConnectedAccountsFetchEnv, clearConnectedAccountsFetchWarningsForTests } =
  await import('./connected-accounts-git-options')
const { clearGitConfigEnvSupportCacheForTests } = await import('./connected-accounts-git-env')
const { RuntimeRemoteFetchController } = await import('../runtime/runtime-remote-fetch-controller')
const { fetchPrHeadTrackingRef } = await import('../github/pr-head-tracking-ref')

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: partial repo fixture; the suite only reads the connected-accounts fields.
const boundRepo = {
  id: 'bound',
  path: '/repos/bound',
  ghAccount: { host: 'github.com', user: 'octo-personal' }
} as Repo

describe('best-effort fetch env for bound repos', () => {
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    clearGitConfigEnvSupportCacheForTests()
    clearConnectedAccountsFetchWarningsForTests()
    resolveGhAccountTokenMock.mockReset()
    gitExecFileAsyncMock.mockReset()
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) =>
      args.includes('--version')
        ? { stdout: 'git version 2.45.0\n', stderr: '' }
        : { stdout: '', stderr: '' }
    )
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
  })

  it('returns the bound env when the account resolves', async () => {
    resolveGhAccountTokenMock.mockResolvedValue('gho_bound_token')
    const env = await resolveConnectedAccountsFetchEnv(boundRepo, '/repos/bound')
    expect(env?.GH_TOKEN).toBe('gho_bound_token')
  })

  it('skips env and warns once (without the token) when unresolved', async () => {
    resolveGhAccountTokenMock.mockRejectedValue(new Error('no token'))
    expect(await resolveConnectedAccountsFetchEnv(boundRepo, '/repos/bound')).toBeUndefined()
    expect(await resolveConnectedAccountsFetchEnv(boundRepo, '/repos/bound')).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('octo-personal@github.com')
  })

  it('returns undefined for unbound repos without resolving anything', async () => {
    const env = await resolveConnectedAccountsFetchEnv({ ...boundRepo, ghAccount: undefined }, '/r')
    expect(env).toBeUndefined()
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('the remote fetch controller passes the resolved env to git fetch', async () => {
    const controller = new RuntimeRemoteFetchController(async () => ({ GH_TOKEN: 'gho_x' }))
    vi.spyOn(controller, 'getCanonicalFetchKey').mockResolvedValue('k')
    await controller.getOrStartRemoteFetch('/repos/bound', 'origin')
    const fetchCall = gitExecFileAsyncMock.mock.calls.find(([args]) => args[0] === 'fetch')
    expect(fetchCall?.[1]).toMatchObject({ cwd: '/repos/bound', env: { GH_TOKEN: 'gho_x' } })
  })

  it('the remote fetch controller adds no env without a resolver', async () => {
    const controller = new RuntimeRemoteFetchController()
    vi.spyOn(controller, 'getCanonicalFetchKey').mockResolvedValue('k')
    await controller.getOrStartRemoteFetch('/repos/bound', 'origin')
    const fetchCall = gitExecFileAsyncMock.mock.calls.find(([args]) => args[0] === 'fetch')
    expect(fetchCall?.[1]).not.toHaveProperty('env')
  })

  it('PR head fetch uses the bound env, and still fetches on an unresolved binding', async () => {
    resolveGhAccountTokenMock.mockResolvedValueOnce('gho_bound_token')
    await fetchPrHeadTrackingRef(boundRepo, 'origin', 'feature')
    resolveGhAccountTokenMock.mockRejectedValueOnce(new Error('no token'))
    await fetchPrHeadTrackingRef(boundRepo, 'origin', 'feature')
    const fetches = gitExecFileAsyncMock.mock.calls.filter(([args]) => args[0] === 'fetch')
    expect(fetches).toHaveLength(2)
    expect(fetches[0]?.[1].env?.GH_TOKEN).toBe('gho_bound_token')
    expect(fetches[1]?.[1]).not.toHaveProperty('env')
  })
})
