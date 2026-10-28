import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ensureFirebaseActiveAccount,
  findFirebaseProjectRoot,
  firebaseToolsConfigstorePath,
  listFirebaseToolsAccountEmails,
  writeConnectedAccountsFirebaseJson
} from './firebase-tools-account-store'

const STORE = {
  user: { email: 'work@x.com', name: 'W' },
  tokens: { refresh_token: 'rt-default', access_token: 'at-default', expires_at: 1700000000000 },
  additionalAccounts: [
    {
      user: { email: 'me@y.com' },
      tokens: { refresh_token: 'rt-extra', access_token: 'at-extra', expires_at: 1700000000001 }
    },
    { user: { email: 'work@x.com' }, tokens: { refresh_token: 'rt-dup' } }
  ],
  activeAccounts: { '/other/dir': 'work@x.com' },
  unrelated: { keep: ['me', 1, null] }
}

describe('firebase-tools account store', () => {
  let root: string
  let configstorePath: string
  let worktree: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'orca-fb-store-')))
    const xdg = join(root, 'xdg')
    configstorePath = firebaseToolsConfigstorePath({ XDG_CONFIG_HOME: xdg }, join(root, 'home'))
    mkdirSync(join(xdg, 'configstore'), { recursive: true })
    worktree = join(root, 'wt')
    mkdirSync(worktree)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function writeStore(value: unknown = STORE): void {
    writeFileSync(configstorePath, JSON.stringify(value, undefined, '\t'), { mode: 0o600 })
  }

  it('resolves the configstore path from XDG_CONFIG_HOME or the home directory', () => {
    expect(firebaseToolsConfigstorePath({ XDG_CONFIG_HOME: '/xdg' }, '/h')).toBe(
      join('/xdg', 'configstore', 'firebase-tools.json')
    )
    expect(firebaseToolsConfigstorePath({}, '/h')).toBe(
      join('/h', '.config', 'configstore', 'firebase-tools.json')
    )
  })

  it('lists default and additional account emails without exposing tokens', () => {
    writeStore()
    const emails = listFirebaseToolsAccountEmails(configstorePath)
    expect(emails).toEqual(['work@x.com', 'me@y.com'])
    expect(JSON.stringify(emails)).not.toContain('refresh_token')
  })

  it('returns no accounts when the configstore is missing or unreadable', () => {
    expect(listFirebaseToolsAccountEmails(join(root, 'nope.json'))).toEqual([])
    writeFileSync(configstorePath, '{not json')
    expect(listFirebaseToolsAccountEmails(configstorePath)).toEqual([])
  })

  it('writes the per-directory active account and preserves tokens', () => {
    writeStore()
    writeFileSync(join(worktree, 'firebase.json'), '{}')
    const result = ensureFirebaseActiveAccount({
      configstorePath,
      worktreePath: worktree,
      email: 'me@y.com'
    })
    expect(result).toEqual({ ok: true, projectRoot: worktree })
    const after = JSON.parse(readFileSync(configstorePath, 'utf-8'))
    expect(after.activeAccounts[worktree]).toBe('me@y.com')
    expect(after.activeAccounts['/other/dir']).toBe('work@x.com')
    expect(after.user).toEqual(STORE.user)
    expect(after.tokens).toEqual(STORE.tokens)
    expect(after.additionalAccounts).toEqual(STORE.additionalAccounts)
    expect(after.unrelated).toEqual(STORE.unrelated)
    expect(after.user.email).toBe('work@x.com')
  })

  it('keeps the file mode and does not rewrite when already bound', () => {
    writeStore()
    chmodSync(configstorePath, 0o600)
    writeFileSync(join(worktree, 'firebase.json'), '{}')
    const args = { configstorePath, worktreePath: worktree, email: 'me@y.com' }
    ensureFirebaseActiveAccount(args)
    if (process.platform !== 'win32') {
      expect(statSync(configstorePath).mode & 0o777).toBe(0o600)
    }
    const past = new Date(1_000_000_000_000)
    utimesSync(configstorePath, past, past)
    ensureFirebaseActiveAccount(args)
    expect(statSync(configstorePath).mtimeMs).toBe(past.getTime())
  })

  it('writes both keys when the worktree path is a symlink', () => {
    if (process.platform === 'win32') {
      return
    }
    writeStore()
    writeFileSync(join(worktree, 'firebase.json'), '{}')
    const link = join(root, 'wt-link')
    symlinkSync(worktree, link)
    const result = ensureFirebaseActiveAccount({
      configstorePath,
      worktreePath: link,
      email: 'me@y.com'
    })
    expect(result.ok).toBe(true)
    const after = JSON.parse(readFileSync(configstorePath, 'utf-8'))
    expect(after.activeAccounts[link]).toBe('me@y.com')
    expect(after.activeAccounts[worktree]).toBe('me@y.com')
  })

  it('worktree without firebase.json is unresolved and the configstore is untouched', () => {
    writeStore()
    const before = readFileSync(configstorePath, 'utf-8')
    const past = new Date(1_000_000_000_000)
    utimesSync(configstorePath, past, past)
    const result = ensureFirebaseActiveAccount({
      configstorePath,
      worktreePath: worktree,
      email: 'me@y.com'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.unresolved.tool).toBe('firebase')
      expect(result.unresolved.account).toBe('me@y.com')
      expect(result.unresolved.reason).toBe('This worktree has no firebase.json at its root')
    }
    expect(readFileSync(configstorePath, 'utf-8')).toBe(before)
    expect(statSync(configstorePath).mtimeMs).toBe(past.getTime())
  })

  it('firebase.json only in a parent dir is unresolved', () => {
    writeStore()
    writeFileSync(join(root, 'firebase.json'), '{}')
    expect(findFirebaseProjectRoot(worktree)).toBe(root)
    const before = readFileSync(configstorePath, 'utf-8')
    const result = ensureFirebaseActiveAccount({
      configstorePath,
      worktreePath: worktree,
      email: 'me@y.com'
    })
    expect(result.ok).toBe(false)
    expect(readFileSync(configstorePath, 'utf-8')).toBe(before)
  })

  it('unknown email is unresolved with the login:add fix', () => {
    writeStore()
    writeFileSync(join(worktree, 'firebase.json'), '{}')
    const result = ensureFirebaseActiveAccount({
      configstorePath,
      worktreePath: worktree,
      email: 'ghost@z.com'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.unresolved.fixCommand).toBe('npx -y firebase-tools@latest login:add')
      expect(result.unresolved.tool).toBe('firebase')
    }
  })

  it('bind button writes firebase.json once', async () => {
    expect(await writeConnectedAccountsFirebaseJson(worktree)).toBe(true)
    expect(readFileSync(join(worktree, 'firebase.json'), 'utf-8')).toBe('{}\n')
    writeFileSync(join(worktree, 'firebase.json'), '{"hosting":{}}')
    expect(await writeConnectedAccountsFirebaseJson(worktree)).toBe(false)
    expect(readFileSync(join(worktree, 'firebase.json'), 'utf-8')).toBe('{"hosting":{}}')
  })
})
