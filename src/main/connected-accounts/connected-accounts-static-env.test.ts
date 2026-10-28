import { describe, expect, it } from 'vitest'
import { resolveAdmobProfileEnv, resolveExtraEnv } from './connected-accounts-static-env'

const profiles = [{ id: 'p1', name: 'Main', credentialsDir: '/c', publisherCode: 'pub-1' }]

describe('resolveAdmobProfileEnv', () => {
  it('admob profile resolves to CREDENTIALS_DIR and PUBLISHER_CODE', () => {
    expect(resolveAdmobProfileEnv('p1', profiles)).toEqual({
      env: { CREDENTIALS_DIR: '/c', PUBLISHER_CODE: 'pub-1' }
    })
  })

  it('missing admob profile is unresolved, not empty', () => {
    const result = resolveAdmobProfileEnv('gone', profiles)
    expect('unresolved' in result && result.unresolved.tool).toBe('admob')
    expect('unresolved' in result && result.unresolved.account).toBe('gone')
  })
})

describe('resolveExtraEnv', () => {
  it('extra env skips reserved keys at resolution time', () => {
    expect(
      resolveExtraEnv(
        [
          { key: 'Path', value: 'x' },
          { key: 'FOO', value: '1' }
        ],
        'win32'
      )
    ).toEqual({ FOO: '1' })
  })

  it('extra env drops invalid keys and tolerates undefined', () => {
    expect(resolveExtraEnv([{ key: '1BAD', value: 'x' }], 'linux')).toEqual({})
    expect(resolveExtraEnv(undefined, 'linux')).toEqual({})
  })
})
