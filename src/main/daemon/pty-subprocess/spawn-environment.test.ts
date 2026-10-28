import { describe, expect, it } from 'vitest'
import { buildBoundGitEnvPatch } from '../../connected-accounts/connected-accounts-git-env'
import { createDaemonPtyEnvironment } from './spawn-environment'

describe('createDaemonPtyEnvironment git config composition', () => {
  it('credential helper entries survive the daemon git guard append', () => {
    const patch = buildBoundGitEnvPatch({
      binding: { host: 'github.com', user: 'octo' },
      token: 't',
      baseEnv: {}
    })
    const env = createDaemonPtyEnvironment({
      sessionId: 's',
      cols: 80,
      rows: 24,
      env: { ...patch, ORCA_INTERNAL_TERMINAL_GIT_CREDENTIAL_GUARD_POLICY: 'guard' }
    })
    const pairs: [string, string][] = []
    for (let i = 0; i < Number(env.GIT_CONFIG_COUNT); i++) {
      pairs.push([env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]])
    }
    expect(pairs).toEqual([
      ['credential.https://github.com.helper', ''],
      ['credential.https://github.com.helper', '!gh auth git-credential'],
      ['credential.interactive', 'false'],
      ['credential.guiPrompt', 'false']
    ])
    expect(env.GIT_CONFIG_COUNT).toBe('4')
    expect(env.GH_TOKEN).toBe('t')
  })

  it('keeps inherited GIT_CONFIG entries ahead of the helper and guard entries', () => {
    const base = {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.autocrlf',
      GIT_CONFIG_VALUE_0: 'false'
    }
    const patch = buildBoundGitEnvPatch({
      binding: { host: 'github.com', user: 'octo' },
      token: 't',
      baseEnv: base
    })
    const env = createDaemonPtyEnvironment({
      sessionId: 's',
      cols: 80,
      rows: 24,
      env: { ...base, ...patch, ORCA_INTERNAL_TERMINAL_GIT_CREDENTIAL_GUARD_POLICY: 'guard' }
    })
    const pairs: [string, string][] = []
    for (let i = 0; i < Number(env.GIT_CONFIG_COUNT); i++) {
      pairs.push([env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]])
    }
    expect(pairs).toEqual([
      ['core.autocrlf', 'false'],
      ['credential.https://github.com.helper', ''],
      ['credential.https://github.com.helper', '!gh auth git-credential'],
      ['credential.interactive', 'false'],
      ['credential.guiPrompt', 'false']
    ])
  })
})
