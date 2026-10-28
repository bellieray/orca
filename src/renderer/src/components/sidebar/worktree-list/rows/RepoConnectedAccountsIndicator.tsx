import React from 'react'
import { KeyRound } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { Repo } from '../../../../../../shared/repo-types'
import { connectedAccountsSummary } from '@/components/settings/repository/connected-accounts/connected-accounts-summary'
import {
  handleRepoHeaderActionPointerDown,
  stopRepoHeaderKeyboardToggle
} from './header-event-guards'

const EMPTY_CLAUDE_ACCOUNTS: never[] = []
const EMPTY_ADMOB_PROFILES: never[] = []

/** Key icon on a project header with per-project account bindings; nothing when unbound. */
export function RepoConnectedAccountsIndicator({ repo }: { repo: Repo }): React.JSX.Element | null {
  const accountSettings = useAppStore(
    useShallow((state) => ({
      claudeManagedAccounts: state.settings?.claudeManagedAccounts ?? EMPTY_CLAUDE_ACCOUNTS,
      connectedAccountsAdmobProfiles:
        state.settings?.connectedAccountsAdmobProfiles ?? EMPTY_ADMOB_PROFILES
    }))
  )
  const summary = connectedAccountsSummary(repo, accountSettings)
  if (summary.length === 0) {
    return null
  }
  const title = translate('connectedAccounts.title', 'Connected Accounts')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          data-repo-header-action=""
          className="inline-flex shrink-0 items-center text-muted-foreground"
          aria-label={`${title}: ${summary.join(', ')}`}
          onKeyDown={stopRepoHeaderKeyboardToggle}
          onPointerDown={handleRepoHeaderActionPointerDown}
        >
          <KeyRound className="size-3" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="max-w-72">
        <div className="space-y-0.5">
          <div className="font-medium">{title}</div>
          {summary.map((line) => (
            <div key={line} className="break-words">
              {line}
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
