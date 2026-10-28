import type { GlobalSettings } from '../../../../../../shared/global-settings-types'
import type { Repo } from '../../../../../../shared/repo-types'
import { translate } from '@/i18n/i18n'

export type ConnectedAccountsSummarySettings = Pick<
  GlobalSettings,
  'claudeManagedAccounts' | 'connectedAccountsAdmobProfiles'
>

function missingLabel(account: string): string {
  return translate('connectedAccounts.summaryMissing', '{{account}} (missing)', { account })
}

/** One "Tool: account" line per bound service; [] when the project has no binding. */
export function connectedAccountsSummary(
  repo: Pick<Repo, 'connectedAccounts' | 'ghAccount'>,
  settings: ConnectedAccountsSummarySettings | null | undefined
): string[] {
  const bound = repo.connectedAccounts
  const lines: string[] = []
  if (bound?.claudeAccountId) {
    const email = (settings?.claudeManagedAccounts ?? []).find(
      (account) => account.id === bound.claudeAccountId
    )?.email
    lines.push(`Claude: ${email ?? missingLabel(bound.claudeAccountId)}`)
  }
  if (repo.ghAccount) {
    lines.push(`GitHub: ${repo.ghAccount.user} (${repo.ghAccount.host})`)
  }
  if (bound?.firebaseEmail) {
    lines.push(`Firebase: ${bound.firebaseEmail}`)
  }
  if (bound?.admobProfileId) {
    const name = (settings?.connectedAccountsAdmobProfiles ?? []).find(
      (profile) => profile.id === bound.admobProfileId
    )?.name
    lines.push(`AdMob: ${name ?? missingLabel(bound.admobProfileId)}`)
  }
  if (bound?.extraEnv && bound.extraEnv.length > 0) {
    const label = translate('connectedAccounts.summaryExtraEnv', 'Env')
    lines.push(`${label}: ${bound.extraEnv.map((entry) => entry.key).join(', ')}`)
  }
  return lines
}
