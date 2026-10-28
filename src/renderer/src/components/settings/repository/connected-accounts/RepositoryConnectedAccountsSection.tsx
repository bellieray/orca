import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { GhAccountBinding } from '../../../../../../shared/github/account-binding'
import type { Repo } from '../../../../../../shared/repo-types'
import type { RepoConnectedAccounts } from '../../../../../../shared/connected-accounts/connected-accounts-types'
import { normalizeRepoConnectedAccounts } from '../../../../../../shared/connected-accounts/connected-accounts-normalize'
import {
  getRepoExecutionHostId,
  getRepoRoutingConnectionId
} from '../../../../../../shared/execution-host'
import { isWslUncPath } from '../../../../../../shared/wsl-paths'
import { Input } from '../../../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/select'
import { SearchableSetting } from '../../SearchableSetting'
import { RepositoryGitHubAccountSection } from '../RepositoryGitHubAccountSection'
import { getRepositoryConnectedAccountsSectionId } from '../repository-settings-targets'
import { ConnectedAccountsAdmobProfilesEditor } from './ConnectedAccountsAdmobProfilesEditor'
import { ConnectedAccountsExtraEnvEditor } from './ConnectedAccountsExtraEnvEditor'
import { ConnectedAccountsFirebaseRow } from './ConnectedAccountsFirebaseRow'
import { ConnectedAccountsRow } from './ConnectedAccountsRow'
import { connectedAccountsSearchEntry } from './connected-accounts-search'
import { useAppStore } from '@/store/index'
import { translate } from '@/i18n/i18n'
import { readIpcErrorDetail } from '@/lib/ipc-error'

// Radix forbids empty item values; the sentinel means "use the machine's default login".
const CLAUDE_DEFAULT_VALUE = '__connected_accounts_claude_default__'

type ConnectedAccountsRepoUpdate = {
  ghAccount?: GhAccountBinding | null
  connectedAccounts?: RepoConnectedAccounts | null
}

type RepositoryConnectedAccountsSectionProps = {
  repo: Repo
  updateRepo: (repoId: string, updates: ConnectedAccountsRepoUpdate) => unknown
  forceVisible?: boolean
}

/** Mirrors main's connectedAccountsApplyToRepo so the UI never offers a binding spawn would ignore. */
function connectedAccountsBlockedReason(repo: Repo): string | null {
  if (getRepoRoutingConnectionId(repo) || getRepoExecutionHostId(repo) !== 'local') {
    return translate(
      'connectedAccounts.localOnly',
      'Account bindings apply to local launches only.'
    )
  }
  if (isWslUncPath(repo.path)) {
    return translate(
      'connectedAccounts.wslUnsupported',
      'Account bindings are not yet supported for WSL projects.'
    )
  }
  return null
}

export function RepositoryConnectedAccountsSection({
  repo,
  updateRepo,
  forceVisible
}: RepositoryConnectedAccountsSectionProps): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const claudeLabelId = useId()
  const admobLabelId = useId()
  const blockedReason = connectedAccountsBlockedReason(repo)
  const disabled = blockedReason !== null
  const bound = repo.connectedAccounts
  const claudeAccounts = settings?.claudeManagedAccounts ?? []

  const [staleCount, setStaleCount] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [authorDraft, setAuthorDraft] = useState({
    name: bound?.gitAuthor?.name ?? '',
    email: bound?.gitAuthor?.email ?? ''
  })
  const [authorError, setAuthorError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refreshStaleCount = useCallback(async () => {
    if (disabled) {
      return
    }
    try {
      const count = await window.api.connectedAccounts.staleSessionCount({ repoId: repo.id })
      if (mountedRef.current) {
        setStaleCount(count)
      }
    } catch {
      // A missing count only hides the advisory banner.
    }
  }, [disabled, repo.id])

  useEffect(() => {
    void refreshStaleCount()
  }, [refreshStaleCount])

  // Nested bindings replace the whole stored value, so merge onto the latest store row, not this render's prop.
  const saveConnectedAccounts = async (patch: Partial<RepoConnectedAccounts>) => {
    const hostId = getRepoExecutionHostId(repo)
    const latest =
      useAppStore
        .getState()
        .repos.find((entry) => entry.id === repo.id && getRepoExecutionHostId(entry) === hostId) ??
      repo
    const merged: Record<string, unknown> = { ...latest.connectedAccounts, ...patch }
    for (const key of Object.keys(patch)) {
      if (merged[key] === undefined) {
        delete merged[key]
      }
    }
    setSaveError(null)
    const result = await Promise.resolve(
      updateRepo(repo.id, { connectedAccounts: normalizeRepoConnectedAccounts(merged) })
    )
    if (result === false && mountedRef.current) {
      setSaveError(translate('connectedAccounts.saveFailed', 'Could not save the account binding.'))
    }
    await refreshStaleCount()
  }

  const suggestAuthorFor = async (binding: GhAccountBinding) => {
    setAuthorError(null)
    try {
      const author = await window.api.connectedAccounts.suggestGitAuthor(binding)
      if (!mountedRef.current) {
        return
      }
      setAuthorDraft(author)
      await saveConnectedAccounts({ gitAuthor: author })
    } catch (error) {
      if (mountedRef.current) {
        setAuthorError(
          translate(
            'connectedAccounts.gitAuthorSuggestFailed',
            'Could not look up a commit author ({{error}}). Enter one manually.',
            { error: readIpcErrorDetail(error) ?? String(error) }
          )
        )
      }
    }
  }

  // Return the inner promise untouched: the GitHub section reads `false` and the store echo.
  const updateGitHubBinding = (
    repoId: string,
    updates: { ghAccount?: GhAccountBinding | null }
  ): unknown => {
    const pending = Promise.resolve(updateRepo(repoId, updates))
    const requested = updates.ghAccount
    void pending.then((result) => {
      if (requested && !disabled && result !== false) {
        void suggestAuthorFor(requested)
      }
      void refreshStaleCount()
    })
    return pending
  }

  const commitAuthor = () => {
    const name = authorDraft.name.trim()
    const email = authorDraft.email.trim()
    if (!name && !email) {
      setAuthorError(null)
      if (bound?.gitAuthor) {
        void saveConnectedAccounts({ gitAuthor: undefined })
      }
      return
    }
    if (!name || !email) {
      setAuthorError(
        translate('connectedAccounts.gitAuthorIncomplete', 'Enter both a name and an email.')
      )
      return
    }
    setAuthorError(null)
    if (name !== bound?.gitAuthor?.name || email !== bound?.gitAuthor?.email) {
      void saveConnectedAccounts({ gitAuthor: { name, email } })
    }
  }

  const claudeBoundKnown = Boolean(
    bound?.claudeAccountId && claudeAccounts.some((account) => account.id === bound.claudeAccountId)
  )
  const authorDisabled = disabled || !repo.ghAccount
  const searchEntry = connectedAccountsSearchEntry(repo.displayName)

  return (
    <SearchableSetting
      id={getRepositoryConnectedAccountsSectionId(repo.id)}
      title={searchEntry.title}
      description={searchEntry.description}
      keywords={searchEntry.keywords}
      className="space-y-4"
      forceVisible={forceVisible}
    >
      <div className="space-y-1">
        <div className="text-sm font-semibold">{searchEntry.title}</div>
        <p className="text-xs text-muted-foreground">
          {translate(
            'connectedAccounts.longDescription',
            'Bindings apply to new terminals and agents in this project. “Default (machine)” keeps the login this computer already uses.'
          )}
        </p>
        {blockedReason ? <p className="text-xs text-muted-foreground">{blockedReason}</p> : null}
      </div>

      {staleCount > 0 ? (
        <div
          role="status"
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground"
        >
          {translate(
            'connectedAccounts.staleSessions',
            '{{count}} running sessions in this project still use the previous accounts. Restart them to apply.',
            { count: staleCount }
          )}
        </div>
      ) : null}

      <ConnectedAccountsRow
        title={translate('connectedAccounts.toolClaude', 'Claude')}
        labelId={claudeLabelId}
      >
        <Select
          value={bound?.claudeAccountId ?? CLAUDE_DEFAULT_VALUE}
          disabled={disabled}
          onValueChange={(value) =>
            void saveConnectedAccounts({
              claudeAccountId: value === CLAUDE_DEFAULT_VALUE ? undefined : value
            })
          }
        >
          <SelectTrigger size="sm" className="w-full" aria-labelledby={claudeLabelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CLAUDE_DEFAULT_VALUE}>
              {translate('connectedAccounts.defaultMachine', 'Default (machine)')}
            </SelectItem>
            {bound?.claudeAccountId && !claudeBoundKnown ? (
              <SelectItem value={bound.claudeAccountId} disabled>
                {translate('connectedAccounts.summaryMissing', '{{account}} (missing)', {
                  account: bound.claudeAccountId
                })}
              </SelectItem>
            ) : null}
            {claudeAccounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ConnectedAccountsRow>

      <div className="space-y-3">
        <RepositoryGitHubAccountSection repo={repo} updateRepo={updateGitHubBinding} forceVisible />
        <ConnectedAccountsRow
          title={translate('connectedAccounts.gitAuthorTitle', 'Commit author')}
          description={translate(
            'connectedAccounts.gitAuthorDescription',
            'Used for commits while a GitHub account is bound. SSH remotes: account binding applies to HTTPS only.'
          )}
        >
          <div className="flex items-center gap-2">
            <Input
              value={authorDraft.name}
              disabled={authorDisabled}
              placeholder={translate('connectedAccounts.gitAuthorName', 'Name')}
              aria-label={translate('connectedAccounts.gitAuthorName', 'Name')}
              aria-invalid={authorError && !authorDraft.name.trim() ? true : undefined}
              className="h-8 w-48 text-xs"
              onChange={(event) =>
                setAuthorDraft((draft) => ({ ...draft, name: event.target.value }))
              }
              onBlur={commitAuthor}
            />
            <Input
              value={authorDraft.email}
              disabled={authorDisabled}
              placeholder={translate('connectedAccounts.gitAuthorEmail', 'Email')}
              aria-label={translate('connectedAccounts.gitAuthorEmail', 'Email')}
              aria-invalid={authorError && !authorDraft.email.trim() ? true : undefined}
              className="h-8 min-w-0 flex-1 text-xs"
              onChange={(event) =>
                setAuthorDraft((draft) => ({ ...draft, email: event.target.value }))
              }
              onBlur={commitAuthor}
            />
          </div>
          {authorError ? <p className="text-xs text-destructive">{authorError}</p> : null}
        </ConnectedAccountsRow>
      </div>

      <ConnectedAccountsFirebaseRow
        repoId={repo.id}
        repoPath={repo.path}
        boundEmail={bound?.firebaseEmail}
        disabled={disabled}
        onBind={(email) => void saveConnectedAccounts({ firebaseEmail: email })}
      />

      <ConnectedAccountsRow
        title={translate('connectedAccounts.toolAdmob', 'AdMob')}
        labelId={admobLabelId}
      >
        <ConnectedAccountsAdmobProfilesEditor
          boundProfileId={bound?.admobProfileId}
          profiles={settings?.connectedAccountsAdmobProfiles ?? []}
          disabled={disabled}
          labelId={admobLabelId}
          onBind={(profileId) => void saveConnectedAccounts({ admobProfileId: profileId })}
          onSaveProfiles={(profiles) =>
            void updateSettings({ connectedAccountsAdmobProfiles: profiles })
          }
        />
      </ConnectedAccountsRow>

      <ConnectedAccountsRow
        title={translate('connectedAccounts.toolRevenueCat', 'RevenueCat')}
        description={translate(
          'connectedAccounts.revenueCatNote',
          'Follows the Claude account (claude.ai connector).'
        )}
      />

      <ConnectedAccountsRow
        title={translate('connectedAccounts.extraEnvTitle', 'Extra env vars')}
        description={translate(
          'connectedAccounts.extraEnvWarning',
          "Don't put secrets here: stored in plain settings and synced."
        )}
      >
        <ConnectedAccountsExtraEnvEditor
          entries={bound?.extraEnv ?? []}
          disabled={disabled}
          onCommit={(entries) =>
            void saveConnectedAccounts({ extraEnv: entries.length > 0 ? entries : undefined })
          }
        />
      </ConnectedAccountsRow>

      {saveError ? <p className="text-xs text-destructive">{saveError}</p> : null}
    </SearchableSetting>
  )
}
