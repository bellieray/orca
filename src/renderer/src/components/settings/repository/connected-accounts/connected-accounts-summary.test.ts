import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../../../shared/repo-types'
import type { ClaudeManagedAccount } from '../../../../../../shared/managed-account-types'
import { connectedAccountsSummary } from './connected-accounts-summary'

const claudeAccount: ClaudeManagedAccount = {
  id: 'claude-1',
  email: 'me@y.com',
  managedAuthPath: '/tmp/claude-1',
  authMethod: 'subscription-oauth',
  createdAt: 1,
  updatedAt: 1,
  lastAuthenticatedAt: 1
}

function repo(overrides: Partial<Repo>): Repo {
  return {
    id: 'repo-1',
    path: '/tmp/repo',
    displayName: 'Repo',
    badgeColor: '#000',
    addedAt: 1,
    ...overrides
  }
}

const settings = { claudeManagedAccounts: [claudeAccount], connectedAccountsAdmobProfiles: [] }

describe('connectedAccountsSummary', () => {
  it('summary lists only bound tools with account labels', () => {
    expect(
      connectedAccountsSummary(
        repo({
          connectedAccounts: { claudeAccountId: 'claude-1' },
          ghAccount: { host: 'github.com', user: 'me' }
        }),
        settings
      )
    ).toEqual(['Claude: me@y.com', 'GitHub: me (github.com)'])
  })

  it('missing claude account is shown as missing, not dropped', () => {
    const summary = connectedAccountsSummary(
      repo({ connectedAccounts: { claudeAccountId: 'gone-id' } }),
      settings
    )
    expect(summary).toHaveLength(1)
    expect(summary[0]).toContain('gone-id')
    expect(summary[0]).toContain('missing')
  })

  it('is empty for an unbound project', () => {
    expect(connectedAccountsSummary(repo({}), settings)).toEqual([])
  })
})
