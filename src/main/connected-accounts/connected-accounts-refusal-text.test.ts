import { describe, expect, it } from 'vitest'
import { isConnectedAccountsRefusalLine } from '../../shared/connected-accounts/connected-accounts-terminal-notice'
import { formatConnectedAccountsUnresolved } from './connected-accounts-spawn-env'

describe('connected-accounts refusal text contract', () => {
  it('every unresolved line main formats is recognized by the renderer toast', () => {
    for (const tool of ['claude', 'github', 'git', 'firebase', 'admob'] as const) {
      const line = formatConnectedAccountsUnresolved({
        tool,
        account: 'me@example.com',
        reason: 'it is not signed in on this machine'
      })
      expect(isConnectedAccountsRefusalLine(line)).toBe(true)
    }
  })
})
