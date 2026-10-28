import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as GhAccountTokenModule from '../github/gh-account-token'
import type * as GitRunnerModule from '../git/runner'

vi.mock('../github/gh-account-token', async (importOriginal) => ({
  ...(await importOriginal<typeof GhAccountTokenModule>()),
  resolveGhAccountToken: vi.fn()
}))
vi.mock('../git/runner', async (importOriginal) => ({
  ...(await importOriginal<typeof GitRunnerModule>()),
  gitExecFileAsync: vi.fn()
}))

import {
  createGhBoundAccountUnavailableError,
  resolveGhAccountToken
} from '../github/gh-account-token'
import { gitExecFileAsync } from '../git/runner'
import { createGhMultiAccountUnsupportedError } from '../github/gh-capability-state'
import {
  CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED,
  buildBlockedGhEnvPatch,
  buildBoundGitEnvPatch,
  clearGitConfigEnvSupportCacheForTests,
  resolveGhSpawnEnv,
  resolveGitSupportsConfigEnv
} from './connected-accounts-git-env'

const HELPER = '!gh auth git-credential'
const binding = { host: 'github.com', user: 'octo' }
const author = { name: 'Octo', email: 'octo@example.com' }

function configPairs(env: Record<string, string>): [string, string][] {
  const count = Number(env.GIT_CONFIG_COUNT ?? '0')
  const pairs: [string, string][] = []
  for (let i = 0; i < count; i++) {
    pairs.push([env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]])
  }
  return pairs
}

function stubGitVersion(stdout: string): void {
  vi.mocked(gitExecFileAsync).mockResolvedValue({ stdout, stderr: '' })
}

beforeEach(() => {
  clearGitConfigEnvSupportCacheForTests()
  vi.mocked(gitExecFileAsync).mockReset()
  vi.mocked(resolveGhAccountToken).mockReset()
})

afterEach(() => {
  clearGitConfigEnvSupportCacheForTests()
})

describe('buildBoundGitEnvPatch', () => {
  it('bound env pins token, host and an https credential helper for that host', () => {
    const patch = buildBoundGitEnvPatch({ binding, token: 't', baseEnv: {} })
    expect(patch.GH_TOKEN).toBe('t')
    expect(patch.GH_HOST).toBe('github.com')
    expect(patch.GH_PROMPT_DISABLED).toBe('1')
    expect(configPairs(patch)).toEqual([
      ['credential.https://github.com.helper', ''],
      ['credential.https://github.com.helper', HELPER]
    ])
  })

  it('existing GIT_CONFIG_COUNT entries are preserved', () => {
    const patch = buildBoundGitEnvPatch({
      binding,
      token: 't',
      baseEnv: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'a', GIT_CONFIG_VALUE_0: 'b' }
    })
    expect(patch.GIT_CONFIG_KEY_0).toBe('a')
    expect(patch.GIT_CONFIG_VALUE_0).toBe('b')
    expect(patch.GIT_CONFIG_KEY_1).toBe('credential.https://github.com.helper')
    expect(patch.GIT_CONFIG_VALUE_1).toBe('')
    expect(patch.GIT_CONFIG_VALUE_2).toBe(HELPER)
    expect(patch.GIT_CONFIG_COUNT).toBe('3')
  })

  it('enterprise host uses GH_ENTERPRISE_TOKEN', () => {
    const patch = buildBoundGitEnvPatch({
      binding: { host: 'git.corp.example', user: 'octo' },
      token: 't',
      baseEnv: {}
    })
    expect(patch.GH_ENTERPRISE_TOKEN).toBe('t')
    expect(patch).not.toHaveProperty('GH_TOKEN')
    expect(patch.GH_HOST).toBe('git.corp.example')
    expect(configPairs(patch)[1]).toEqual(['credential.https://git.corp.example.helper', HELPER])
  })

  it('author sets both author and committer identity', () => {
    const patch = buildBoundGitEnvPatch({
      binding,
      token: 't',
      author: { name: 'N', email: 'n@example.com' },
      baseEnv: {}
    })
    expect(patch).toMatchObject({
      GIT_AUTHOR_NAME: 'N',
      GIT_AUTHOR_EMAIL: 'n@example.com',
      GIT_COMMITTER_NAME: 'N',
      GIT_COMMITTER_EMAIL: 'n@example.com'
    })
  })
})

describe('buildBlockedGhEnvPatch', () => {
  it('blocks gh with the sentinel and resets the git helper without re-enabling one', () => {
    const patch = buildBlockedGhEnvPatch(binding, {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'a',
      GIT_CONFIG_VALUE_0: 'b'
    })
    expect(patch.GH_TOKEN).toBe(CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED)
    expect(patch.GH_HOST).toBe('github.com')
    expect(configPairs(patch)).toEqual([
      ['a', 'b'],
      ['credential.https://github.com.helper', '']
    ])
    expect(Object.values(patch)).not.toContain(HELPER)
  })
})

describe('resolveGitSupportsConfigEnv', () => {
  it('parses Apple and Windows git version strings', async () => {
    stubGitVersion('git version 2.39.3 (Apple Git-145)\n')
    expect(await resolveGitSupportsConfigEnv()).toBe(true)
    clearGitConfigEnvSupportCacheForTests()
    stubGitVersion('git version 2.43.0.windows.1\n')
    expect(await resolveGitSupportsConfigEnv()).toBe(true)
    clearGitConfigEnvSupportCacheForTests()
    stubGitVersion('git version 2.30.9\n')
    expect(await resolveGitSupportsConfigEnv()).toBe(false)
  })

  it('caches the answer per execution host', async () => {
    stubGitVersion('git version 2.45.0\n')
    await resolveGitSupportsConfigEnv()
    await resolveGitSupportsConfigEnv()
    expect(gitExecFileAsync).toHaveBeenCalledTimes(1)
  })

  it('fails closed without caching when git cannot be probed', async () => {
    vi.mocked(gitExecFileAsync).mockRejectedValueOnce(new Error('spawn git ENOENT'))
    expect(await resolveGitSupportsConfigEnv()).toBe(false)
    stubGitVersion('git version 2.45.0\n')
    expect(await resolveGitSupportsConfigEnv()).toBe(true)
  })
})

describe('resolveGhSpawnEnv', () => {
  it('returns the bound patch when token and git are available', async () => {
    stubGitVersion('git version 2.45.0\n')
    vi.mocked(resolveGhAccountToken).mockResolvedValue('t')
    const result = await resolveGhSpawnEnv({ binding, author, cwd: '/repo', baseEnv: {} })
    expect('unresolved' in result).toBe(false)
    expect(result.env.GH_TOKEN).toBe('t')
    expect(resolveGhAccountToken).toHaveBeenCalledWith(binding, { cwd: '/repo' })
  })

  it('unresolved token blocks gh and git instead of falling back', async () => {
    stubGitVersion('git version 2.45.0\n')
    vi.mocked(resolveGhAccountToken).mockRejectedValue(
      createGhBoundAccountUnavailableError(binding)
    )
    const result = await resolveGhSpawnEnv({ binding, author, cwd: '/repo', baseEnv: {} })
    if (!('unresolved' in result)) {
      throw new Error('expected unresolved')
    }
    expect(result.unresolved.tool).toBe('github')
    expect(result.unresolved.account).toBe('octo@github.com')
    expect(result.unresolved.fixCommand).toBe('gh auth login --hostname github.com')
    expect(result.env.GH_TOKEN).toBe(CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED)
    expect(Object.values(result.env)).not.toContain(HELPER)
    expect(configPairs(result.env)).toEqual([['credential.https://github.com.helper', '']])
  })

  it('old gh asks for an upgrade instead of a login', async () => {
    stubGitVersion('git version 2.45.0\n')
    vi.mocked(resolveGhAccountToken).mockRejectedValue(createGhMultiAccountUnsupportedError())
    const result = await resolveGhSpawnEnv({ binding, author, cwd: '/repo', baseEnv: {} })
    if (!('unresolved' in result)) {
      throw new Error('expected unresolved')
    }
    expect(result.unresolved.fixCommand).toBeUndefined()
    expect(result.unresolved.reason).toContain('2.40+')
    expect(result.env.GH_TOKEN).toBe(CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED)
  })

  it('old git reports the binding unresolvable', async () => {
    stubGitVersion('git version 2.30.0\n')
    vi.mocked(resolveGhAccountToken).mockResolvedValue('t')
    const result = await resolveGhSpawnEnv({ binding, author, cwd: '/repo', baseEnv: {} })
    if (!('unresolved' in result)) {
      throw new Error('expected unresolved')
    }
    expect(result.unresolved.tool).toBe('git')
    expect(result.unresolved.reason).toBe('Git 2.31+ is required to pin the GitHub account for git')
    expect(result.env.GH_TOKEN).toBe(CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED)
    expect(Object.values(result.env)).not.toContain('t')
  })

  it('ambiguous inherited GIT_CONFIG indices are unresolved, not silently unpinned', async () => {
    stubGitVersion('git version 2.45.0\n')
    vi.mocked(resolveGhAccountToken).mockResolvedValue('t')
    const result = await resolveGhSpawnEnv({
      binding,
      author,
      cwd: '/repo',
      baseEnv: { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'a', GIT_CONFIG_VALUE_0: 'b' }
    })
    if (!('unresolved' in result)) {
      throw new Error('expected unresolved')
    }
    expect(result.unresolved.tool).toBe('git')
    expect(result.env.GH_TOKEN).toBe(CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED)
    expect(Object.values(result.env)).not.toContain('t')
    // Restarted protocol: the atomic merge drops the ambiguous indices and keeps the reset.
    expect(configPairs(result.env)).toEqual([['credential.https://github.com.helper', '']])
  })

  it.each([undefined, { name: 'Octo', email: '  ' }])(
    'a bound account without a commit author is unresolved, not the machine identity (%o)',
    async (missingAuthor) => {
      stubGitVersion('git version 2.45.0\n')
      vi.mocked(resolveGhAccountToken).mockResolvedValue('t')
      const result = await resolveGhSpawnEnv({
        binding,
        author: missingAuthor,
        cwd: '/repo',
        baseEnv: {}
      })
      if (!('unresolved' in result)) {
        throw new Error('expected unresolved')
      }
      expect(result.unresolved).toMatchObject({
        tool: 'git',
        fixCommand: 'Set the commit author in Connected Accounts'
      })
      expect(result.env.GH_TOKEN).toBe(CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED)
      expect(result.env.GIT_AUTHOR_EMAIL).toBeUndefined()
    }
  )
})
