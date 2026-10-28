import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { Repo } from '../../shared/repo-types'
import type * as FirebaseToolsAccountStore from '../connected-accounts/firebase-tools-account-store'

const { handleMock, ghExecFileAsyncMock, writeFirebaseJsonMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  ghExecFileAsyncMock: vi.fn(),
  writeFirebaseJsonMock: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }))
vi.mock('../github/gh-utils', () => ({
  ghExecFileAsync: ghExecFileAsyncMock,
  acquire: vi.fn(async () => undefined),
  release: vi.fn()
}))
vi.mock('../connected-accounts/firebase-tools-account-store', async (importOriginal) => ({
  ...(await importOriginal<typeof FirebaseToolsAccountStore>()),
  writeConnectedAccountsFirebaseJson: writeFirebaseJsonMock
}))

import {
  clearConnectedAccountsPanesForTests,
  recordConnectedAccountsPane
} from '../connected-accounts/connected-accounts-pane-registry'
import { connectedAccountsFingerprint } from '../connected-accounts/connected-accounts-spawn-env'
import { registerConnectedAccountsHandlers } from './connected-accounts'

const gitRepo: Repo = {
  id: 'repo-1',
  path: '/work/app',
  displayName: 'app',
  badgeColor: '#000',
  addedAt: 0,
  connectedAccounts: { firebaseEmail: 'me@example.com' }
}

function setup(repos: Repo[]) {
  const settings = {} as GlobalSettings
  registerConnectedAccountsHandlers({
    getRepo: (id: string) => repos.find((repo) => repo.id === id),
    getSettings: () => settings
  })
  return (channel: string, args?: unknown): Promise<unknown> => {
    const call = handleMock.mock.calls.find(([name]) => name === channel)
    if (!call) {
      throw new Error(`no handler for ${channel}`)
    }
    return Promise.resolve(call[1]({}, args))
  }
}

describe('connected accounts IPC', () => {
  beforeEach(() => {
    handleMock.mockReset()
    ghExecFileAsyncMock.mockReset()
    writeFirebaseJsonMock.mockReset()
    clearConnectedAccountsPanesForTests()
  })

  it('bindFirebaseProject refuses folder repos', async () => {
    const invoke = setup([{ ...gitRepo, kind: 'folder' }])

    await expect(
      invoke('connectedAccounts:bindFirebaseProject', { repoId: 'repo-1' })
    ).rejects.toThrow(/git/i)
    expect(writeFirebaseJsonMock).not.toHaveBeenCalled()
  })

  it('bindFirebaseProject refuses SSH repos', async () => {
    const invoke = setup([{ ...gitRepo, connectionId: 'ssh-1' }])

    await expect(
      invoke('connectedAccounts:bindFirebaseProject', { repoId: 'repo-1' })
    ).rejects.toThrow(/local/i)
    expect(writeFirebaseJsonMock).not.toHaveBeenCalled()
  })

  it('bindFirebaseProject writes firebase.json into a local git repo', async () => {
    writeFirebaseJsonMock.mockResolvedValue(true)
    const invoke = setup([gitRepo])

    await expect(
      invoke('connectedAccounts:bindFirebaseProject', { repoId: 'repo-1' })
    ).resolves.toEqual({
      wrote: true
    })
    expect(writeFirebaseJsonMock).toHaveBeenCalledWith('/work/app')
  })

  it('staleSessionCount counts panes recorded with an older fingerprint', async () => {
    const invoke = setup([gitRepo])
    const current = connectedAccountsFingerprint(gitRepo, {} as GlobalSettings)
    expect(current).not.toBeNull()
    recordConnectedAccountsPane('pty-1', 'repo-1', 'a')
    recordConnectedAccountsPane('pty-2', 'repo-1', 'a')
    recordConnectedAccountsPane('pty-3', 'repo-1', current)
    recordConnectedAccountsPane('pty-4', 'repo-2', 'a')

    await expect(invoke('connectedAccounts:staleSessionCount', { repoId: 'repo-1' })).resolves.toBe(
      2
    )
  })

  it('staleSessionCount is 0 when every pane runs the current binding', async () => {
    const invoke = setup([gitRepo])
    recordConnectedAccountsPane(
      'pty-1',
      'repo-1',
      connectedAccountsFingerprint(gitRepo, {} as GlobalSettings)
    )

    await expect(invoke('connectedAccounts:staleSessionCount', { repoId: 'repo-1' })).resolves.toBe(
      0
    )
  })

  it('suggestGitAuthor builds the github.com noreply address through the bound gh runner', async () => {
    ghExecFileAsyncMock.mockResolvedValue({
      stdout: JSON.stringify({ login: 'octocat', id: 583231, name: 'The Octocat', email: null })
    })
    const invoke = setup([])

    await expect(
      invoke('connectedAccounts:suggestGitAuthor', { host: 'GitHub.com', user: 'octocat' })
    ).resolves.toEqual({
      name: 'The Octocat',
      email: '583231+octocat@users.noreply.github.com'
    })
    const [argv, options] = ghExecFileAsyncMock.mock.calls[0]
    expect(argv.slice(0, 4)).toEqual(['api', 'user', '--hostname', 'github.com'])
    expect(options).toMatchObject({
      host: 'github.com',
      ghAccount: { host: 'github.com', user: 'octocat' }
    })
  })

  it('suggestGitAuthor falls back to the login and uses the API email on GHES', async () => {
    ghExecFileAsyncMock.mockResolvedValue({
      stdout: JSON.stringify({ login: 'jdoe', id: 7, name: null, email: 'jdoe@corp.example' })
    })
    const invoke = setup([])

    await expect(
      invoke('connectedAccounts:suggestGitAuthor', { host: 'ghe.corp.example', user: 'jdoe' })
    ).resolves.toEqual({ name: 'jdoe', email: 'jdoe@corp.example' })
  })

  it('suggestGitAuthor fails clearly when a GHES account has no email', async () => {
    ghExecFileAsyncMock.mockResolvedValue({
      stdout: JSON.stringify({ login: 'jdoe', id: 7, name: 'J Doe', email: null })
    })
    const invoke = setup([])

    await expect(
      invoke('connectedAccounts:suggestGitAuthor', { host: 'ghe.corp.example', user: 'jdoe' })
    ).rejects.toThrow(/email/i)
  })

  it('suggestGitAuthor rejects an invalid binding without calling gh', async () => {
    const invoke = setup([])

    await expect(
      invoke('connectedAccounts:suggestGitAuthor', { host: '', user: 'octocat' })
    ).rejects.toThrow()
    expect(ghExecFileAsyncMock).not.toHaveBeenCalled()
  })
})
