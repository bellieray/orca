import { translate } from '@/i18n/i18n'
import { searchKeywords } from '../../settings-search-keywords'
import type { SettingsSearchEntry } from '../../settings-search'

export function connectedAccountsSearchEntry(repoDisplayName: string): SettingsSearchEntry {
  return {
    title: translate('connectedAccounts.title', 'Connected Accounts'),
    description: translate(
      'connectedAccounts.description',
      'Which Claude, GitHub, Firebase and AdMob accounts this project’s terminals and agents use.'
    ),
    keywords: searchKeywords([
      repoDisplayName,
      { key: 'connectedAccounts.keywordConnectedAccounts', fallback: 'connected accounts' },
      { key: 'connectedAccounts.keywordAccount', fallback: 'account' },
      { key: 'connectedAccounts.keywordClaude', fallback: 'claude' },
      { key: 'connectedAccounts.keywordGithub', fallback: 'github' },
      { key: 'connectedAccounts.keywordFirebase', fallback: 'firebase' },
      { key: 'connectedAccounts.keywordAdmob', fallback: 'admob' },
      { key: 'connectedAccounts.keywordRevenueCat', fallback: 'revenuecat' },
      { key: 'connectedAccounts.keywordEnv', fallback: 'environment variables' }
    ])
  }
}
