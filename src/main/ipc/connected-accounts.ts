import { ipcMain } from 'electron'
import { homedir } from 'node:os'
import type { ConnectedAccountsGitAuthor } from '../../shared/connected-accounts/connected-accounts-types'
import { normalizeGhAccountBinding } from '../../shared/github/account-binding'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { Repo } from '../../shared/repo-types'
import { isFolderRepo } from '../../shared/repo-kind'
import { countStaleConnectedAccountsPanes } from '../connected-accounts/connected-accounts-pane-registry'
import {
  connectedAccountsApplyToRepo,
  connectedAccountsFingerprint
} from '../connected-accounts/connected-accounts-spawn-env'
import {
  firebaseToolsConfigstorePath,
  listFirebaseToolsAccountEmails,
  writeConnectedAccountsFirebaseJson
} from '../connected-accounts/firebase-tools-account-store'
import { acquire, ghExecFileAsync, release } from '../github/gh-utils'

type ConnectedAccountsStore = {
  getRepo: (repoId: string) => Repo | undefined
  getSettings: () => GlobalSettings
}

const GH_USER_TIMEOUT_MS = 15_000

function requireRepo(store: ConnectedAccountsStore, args: { repoId: string }): Repo {
  const repo = store.getRepo(args.repoId)
  if (!repo) {
    throw new Error('Project not found')
  }
  return repo
}

async function bindFirebaseProject(
  store: ConnectedAccountsStore,
  args: { repoId: string }
): Promise<{ wrote: boolean }> {
  const repo = requireRepo(store, args)
  if (isFolderRepo(repo)) {
    throw new Error('Firebase binding needs a Git project, not a folder')
  }
  if (!connectedAccountsApplyToRepo(repo)) {
    throw new Error('Firebase binding is only available for local projects')
  }
  return { wrote: await writeConnectedAccountsFirebaseJson(repo.path) }
}

function staleSessionCount(store: ConnectedAccountsStore, args: { repoId: string }): number {
  const repo = store.getRepo(args.repoId)
  const fingerprint = repo ? connectedAccountsFingerprint(repo) : null
  return countStaleConnectedAccountsPanes(args.repoId, fingerprint)
}

type GhUserResponse = { login?: unknown; id?: unknown; name?: unknown; email?: unknown }

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// Runs once from the UI on bind; the runner injects the bound token into that child only.
async function suggestGitAuthor(args: {
  host: string
  user: string
}): Promise<ConnectedAccountsGitAuthor> {
  const binding = normalizeGhAccountBinding(args)
  if (!binding) {
    throw new Error('Invalid GitHub account')
  }
  await acquire()
  let stdout: string
  try {
    const result = await ghExecFileAsync(
      ['api', 'user', '--hostname', binding.host, '--jq', '{login,id,name,email}'],
      {
        encoding: 'utf-8',
        host: binding.host,
        ghAccount: binding,
        timeout: GH_USER_TIMEOUT_MS,
        idempotent: true
      }
    )
    stdout = result.stdout
  } finally {
    release()
  }
  const profile: GhUserResponse = JSON.parse(stdout)
  const login = nonEmptyString(profile.login)
  if (!login) {
    throw new Error('GitHub did not return an account')
  }
  const name = nonEmptyString(profile.name) ?? login
  if (binding.host === 'github.com') {
    if (typeof profile.id !== 'number') {
      throw new Error('GitHub did not return an account id')
    }
    return { name, email: `${profile.id}+${login}@users.noreply.github.com` }
  }
  const email = nonEmptyString(profile.email)
  if (!email) {
    throw new Error(`${binding.host} did not return an email for ${login}; enter one manually`)
  }
  return { name, email }
}

export function registerConnectedAccountsHandlers(store: ConnectedAccountsStore): void {
  ipcMain.handle('connectedAccounts:listFirebaseAccounts', () =>
    listFirebaseToolsAccountEmails(firebaseToolsConfigstorePath(process.env, homedir()))
  )
  ipcMain.handle('connectedAccounts:bindFirebaseProject', (_event, args: { repoId: string }) =>
    bindFirebaseProject(store, args)
  )
  ipcMain.handle(
    'connectedAccounts:suggestGitAuthor',
    (_event, args: { host: string; user: string }) => suggestGitAuthor(args)
  )
  ipcMain.handle('connectedAccounts:staleSessionCount', (_event, args: { repoId: string }) =>
    staleSessionCount(store, args)
  )
}
