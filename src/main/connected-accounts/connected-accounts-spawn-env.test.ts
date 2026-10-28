import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { GlobalSettings } from '../../shared/global-settings-types'

const { resolveGhSpawnEnvMock, ensureFirebaseMock } = vi.hoisted(() => ({
  resolveGhSpawnEnvMock: vi.fn(),
  ensureFirebaseMock: vi.fn()
}))

vi.mock('./connected-accounts-git-env', () => ({
  CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED: 'orca-connected-accounts-unresolved',
  resolveGhSpawnEnv: resolveGhSpawnEnvMock
}))
vi.mock('./firebase-tools-account-store', () => ({
  ensureFirebaseActiveAccount: ensureFirebaseMock,
  firebaseToolsConfigstorePath: () => '/home/me/.config/configstore/firebase-tools.json'
}))

import {
  connectedAccountsFingerprint,
  connectedAccountsFingerprintInput,
  formatConnectedAccountsLaunchError,
  resolveConnectedAccountsSpawnEnv
} from './connected-accounts-spawn-env'
import {
  clearConnectedAccountsPanesForTests,
  countStaleConnectedAccountsPanes,
  forgetConnectedAccountsPane,
  recordConnectedAccountsPane
} from './connected-accounts-pane-registry'

const settings = {
  claudeManagedAccounts: [{ id: 'claude-1', email: 'me@claude.ai' }],
  connectedAccountsAdmobProfiles: []
} as unknown as GlobalSettings

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/work/app',
    displayName: 'app',
    badgeColor: '#000',
    addedAt: 0,
    ...overrides
  }
}

const bound = repo({
  ghAccount: { host: 'github.com', user: 'me' },
  connectedAccounts: { firebaseEmail: 'me@example.com', extraEnv: [{ key: 'FOO', value: '1' }] }
})

function resolve(target: Repo | undefined) {
  return resolveConnectedAccountsSpawnEnv({
    repo: target,
    worktreePath: '/work/app',
    settings,
    baseEnv: {},
    platform: 'linux'
  })
}

beforeEach(() => {
  resolveGhSpawnEnvMock.mockReset()
  resolveGhSpawnEnvMock.mockResolvedValue({ env: { GH_TOKEN: 't', GH_HOST: 'github.com' } })
  ensureFirebaseMock.mockReset()
  ensureFirebaseMock.mockReturnValue({ ok: true, projectRoot: '/work/app' })
  clearConnectedAccountsPanesForTests()
})

describe('resolveConnectedAccountsSpawnEnv', () => {
  it('unbound repo returns an empty patch and null fingerprint', async () => {
    expect(await resolve(repo())).toEqual({ env: {}, unresolved: [], fingerprint: null })
    expect(await resolve(undefined)).toEqual({ env: {}, unresolved: [], fingerprint: null })
  })

  it('folder repo and ssh repo are left on machine defaults', async () => {
    const empty = { env: {}, unresolved: [], fingerprint: null }
    expect(await resolve({ ...bound, kind: 'folder' })).toEqual(empty)
    expect(await resolve({ ...bound, connectionId: 'ssh-1' })).toEqual(empty)
    expect(await resolve({ ...bound, executionHostId: 'ssh:box' })).toEqual(empty)
    expect(
      await resolveConnectedAccountsSpawnEnv({
        repo: bound,
        worktreePath: '/work/app',
        settings,
        baseEnv: {},
        platform: 'linux',
        runtime: 'wsl'
      })
    ).toEqual(empty)
    expect(resolveGhSpawnEnvMock).not.toHaveBeenCalled()
  })

  it('extra env is merged last and cannot override bound tool env', async () => {
    const result = await resolve({
      ...bound,
      connectedAccounts: {
        extraEnv: [
          { key: 'FOO', value: '1' },
          { key: 'GH_TOKEN', value: 'hijack' }
        ]
      }
    })
    expect(result.env.FOO).toBe('1')
    expect(result.env.GH_TOKEN).toBe('t')
    expect(result.unresolved).toEqual([])
  })

  it('fingerprint changes when a binding changes and never contains token material', async () => {
    const first = connectedAccountsFingerprint(bound, settings)
    const changed = connectedAccountsFingerprint(
      {
        ...bound,
        connectedAccounts: { ...bound.connectedAccounts, firebaseEmail: 'b@example.com' }
      },
      settings
    )
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(changed).not.toBe(first)
    const resolved = await resolve(bound)
    expect(resolved.fingerprint).toBe(first)
    expect(resolved.env.GH_TOKEN).toBe('t')
    // The hash input is built from bindings only, never from the resolved gh env.
    expect(JSON.parse(connectedAccountsFingerprintInput(bound)).flat(3)).not.toContain('t')
    expect(connectedAccountsFingerprintInput(bound)).not.toContain('GH_TOKEN')
  })

  it('unresolved gh binding is reported with account and fix', async () => {
    resolveGhSpawnEnvMock.mockResolvedValue({
      env: { GH_TOKEN: 'orca-connected-accounts-unresolved' },
      unresolved: {
        tool: 'github',
        account: 'me@github.com',
        fixCommand: 'gh auth login --hostname github.com',
        reason: 'it is not signed in to gh on this machine'
      }
    })
    const result = await resolve(bound)
    expect(result.env.GH_TOKEN).toBe('orca-connected-accounts-unresolved')
    const error = formatConnectedAccountsLaunchError(result.unresolved)
    expect(error.code).toBe('connected_accounts_unresolved')
    expect(error.message).toBe(
      'GitHub account me@github.com is not available: it is not signed in to gh on this machine. Fix: gh auth login --hostname github.com'
    )
  })

  it('keeps the Claude override for an account removed from settings and reports it', async () => {
    const result = await resolve(repo({ connectedAccounts: { claudeAccountId: 'gone' } }))
    expect(result.claudeOverride).toEqual({ repoId: 'repo-1', accountId: 'gone' })
    expect(formatConnectedAccountsLaunchError(result.unresolved).message).toContain(
      'Claude account gone is not available'
    )
    expect(formatConnectedAccountsLaunchError(result.unresolved).message).toContain(
      'Open Connected Accounts'
    )
  })

  it('blocks AdMob env when the profile is missing', async () => {
    const result = await resolve(repo({ connectedAccounts: { admobProfileId: 'gone' } }))
    expect(result.env.CREDENTIALS_DIR).toBe('orca-connected-accounts-unresolved')
    expect(result.unresolved[0]).toMatchObject({ tool: 'admob', account: 'gone' })
  })
})

describe('connected accounts pane registry', () => {
  it('counts panes recorded with an older fingerprint', () => {
    recordConnectedAccountsPane('p1', 'repo-1', 'a')
    recordConnectedAccountsPane('p2', 'repo-1', 'a')
    recordConnectedAccountsPane('p3', 'repo-2', 'a')
    expect(countStaleConnectedAccountsPanes('repo-1', 'b')).toBe(2)
    expect(countStaleConnectedAccountsPanes('repo-1', 'a')).toBe(0)
    forgetConnectedAccountsPane('p1')
    expect(countStaleConnectedAccountsPanes('repo-1', 'b')).toBe(1)
  })
})
