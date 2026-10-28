import { describe, expect, it } from 'vitest'
import {
  isReservedConnectedAccountsEnvKey,
  isValidConnectedAccountsEnvKey,
  normalizeConnectedAccountsAdmobProfiles,
  normalizeRepoConnectedAccounts
} from './connected-accounts-normalize'

describe('normalizeRepoConnectedAccounts', () => {
  it('drops extra env entries with invalid or reserved keys', () => {
    const result = normalizeRepoConnectedAccounts(
      {
        extraEnv: [
          { key: 'FOO', value: '1' },
          { key: '1BAD', value: 'x' },
          { key: 'GH_TOKEN', value: 'x' },
          { key: 'path', value: 'x' }
        ]
      },
      'win32'
    )
    expect(result?.extraEnv).toEqual([{ key: 'FOO', value: '1' }])
  })

  it('keeps lowercase path on case-sensitive platforms', () => {
    const result = normalizeRepoConnectedAccounts(
      { extraEnv: [{ key: 'path', value: 'x' }] },
      'linux'
    )
    expect(result?.extraEnv).toEqual([{ key: 'path', value: 'x' }])
  })

  it('returns null for an all-empty binding', () => {
    expect(normalizeRepoConnectedAccounts({})).toBeNull()
    expect(normalizeRepoConnectedAccounts({ claudeAccountId: '  ' })).toBeNull()
    expect(normalizeRepoConnectedAccounts('nope')).toBeNull()
  })

  it('trims strings and keeps only populated fields', () => {
    expect(
      normalizeRepoConnectedAccounts({
        claudeAccountId: ' a ',
        firebaseEmail: ' me@example.com ',
        admobProfileId: '',
        gitAuthor: { name: ' N ', email: ' n@example.com ' }
      })
    ).toEqual({
      claudeAccountId: 'a',
      firebaseEmail: 'me@example.com',
      gitAuthor: { name: 'N', email: 'n@example.com' }
    })
  })

  it('rejects git author without an email', () => {
    const result = normalizeRepoConnectedAccounts({
      claudeAccountId: 'a',
      gitAuthor: { name: 'a', email: '' }
    })
    expect(result).toEqual({ claudeAccountId: 'a' })
    expect(result).not.toHaveProperty('gitAuthor')
  })
})

describe('connected accounts env key rules', () => {
  it('validates identifier shape', () => {
    expect(isValidConnectedAccountsEnvKey('FOO_1')).toBe(true)
    expect(isValidConnectedAccountsEnvKey('1FOO')).toBe(false)
    expect(isValidConnectedAccountsEnvKey('A-B')).toBe(false)
  })

  it('flags reserved prefixes and names, case-insensitively only on win32', () => {
    expect(isReservedConnectedAccountsEnvKey('ORCA_X', 'linux')).toBe(true)
    expect(isReservedConnectedAccountsEnvKey('CLAUDE_CONFIG_DIR', 'darwin')).toBe(true)
    expect(isReservedConnectedAccountsEnvKey('GITHUB_TOKEN', 'linux')).toBe(true)
    expect(isReservedConnectedAccountsEnvKey('home', 'linux')).toBe(false)
    expect(isReservedConnectedAccountsEnvKey('home', 'win32')).toBe(true)
    for (const key of [
      'FIREBASE_TOKEN',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'XDG_CONFIG_HOME',
      'ANTHROPIC_API_KEY'
    ]) {
      expect(isReservedConnectedAccountsEnvKey(key, 'linux')).toBe(true)
    }
    expect(isReservedConnectedAccountsEnvKey('anthropic_api_key', 'win32')).toBe(true)
  })
})

describe('normalizeConnectedAccountsAdmobProfiles', () => {
  it('drops profiles missing credentialsDir or publisherCode, and dedupes by id', () => {
    const profiles = normalizeConnectedAccountsAdmobProfiles([
      { id: 'a', name: 'A', credentialsDir: '/c/a', publisherCode: 'pub-1' },
      { id: 'a', name: 'A2', credentialsDir: '/c/a2', publisherCode: 'pub-2' },
      { id: 'b', name: 'B', credentialsDir: '', publisherCode: 'pub-3' },
      { id: 'c', name: 'C', credentialsDir: '/c/c', publisherCode: ' ' },
      null
    ])
    expect(profiles).toEqual([
      { id: 'a', name: 'A', credentialsDir: '/c/a', publisherCode: 'pub-1' }
    ])
  })

  it('returns an empty list for non-arrays', () => {
    expect(normalizeConnectedAccountsAdmobProfiles(undefined)).toEqual([])
  })
})
