import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { ConnectedAccountsAdmobProfile } from '../../../../../../shared/connected-accounts/connected-accounts-types'
import { Button } from '../../../ui/button'
import { Input } from '../../../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/select'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  admobProfilesToPersist,
  resyncAdmobProfileDrafts
} from './connected-accounts-admob-profile-drafts'

// Radix forbids empty item values; the sentinel means "use the machine's AdMob setup".
const ADMOB_DEFAULT_VALUE = '__connected_accounts_admob_default__'

const ADMOB_MCP_CONFIG_SNIPPET =
  '"CREDENTIALS_DIR": "${CREDENTIALS_DIR:-<current value>}",\n"PUBLISHER_CODE": "${PUBLISHER_CODE:-<current value>}"'

type ConnectedAccountsAdmobProfilesEditorProps = {
  boundProfileId: string | undefined
  profiles: ConnectedAccountsAdmobProfile[]
  disabled: boolean
  labelId: string
  onBind: (profileId: string | undefined) => void
  onSaveProfiles: (profiles: ConnectedAccountsAdmobProfile[]) => void
}

/** Profiles are global; incomplete drafts stay local because settings normalization drops them. */
export function ConnectedAccountsAdmobProfilesEditor({
  boundProfileId,
  profiles,
  disabled,
  labelId,
  onBind,
  onSaveProfiles
}: ConnectedAccountsAdmobProfilesEditorProps): React.JSX.Element {
  const [drafts, setDrafts] = useState<ConnectedAccountsAdmobProfile[]>(profiles)
  const [editing, setEditing] = useState(false)
  const profilesKey = JSON.stringify(profiles)
  const [syncedKey, setSyncedKey] = useState(profilesKey)
  // Adopt profile edits synced in while the section is open, unless a field is mid-edit.
  if (syncedKey !== profilesKey && !editing) {
    setSyncedKey(profilesKey)
    setDrafts(resyncAdmobProfileDrafts(drafts, profiles))
  }
  const boundInProfiles = Boolean(
    boundProfileId && profiles.some((profile) => profile.id === boundProfileId)
  )

  const commit = (nextDrafts: ConnectedAccountsAdmobProfile[]) => {
    onSaveProfiles(admobProfilesToPersist(nextDrafts, profiles))
  }

  const updateDraft = (id: string, patch: Partial<ConnectedAccountsAdmobProfile>) => {
    setDrafts((current) =>
      current.map((profile) => (profile.id === id ? { ...profile, ...patch } : profile))
    )
  }

  const fieldLabels = {
    name: translate('connectedAccounts.admobProfileName', 'Name'),
    credentialsDir: translate('connectedAccounts.admobCredentialsDir', 'Credentials folder'),
    publisherCode: translate('connectedAccounts.admobPublisherCode', 'Publisher code')
  }

  return (
    <div className="space-y-3">
      <Select
        value={boundProfileId ?? ADMOB_DEFAULT_VALUE}
        disabled={disabled}
        onValueChange={(value) => onBind(value === ADMOB_DEFAULT_VALUE ? undefined : value)}
      >
        <SelectTrigger size="sm" className="w-full" aria-labelledby={labelId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ADMOB_DEFAULT_VALUE}>
            {translate('connectedAccounts.defaultMachine', 'Default (machine)')}
          </SelectItem>
          {boundProfileId && !boundInProfiles ? (
            <SelectItem value={boundProfileId} disabled>
              {translate('connectedAccounts.summaryMissing', '{{account}} (missing)', {
                account: boundProfileId
              })}
            </SelectItem>
          ) : null}
          {profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              {profile.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="space-y-2">
        {drafts.map((profile) => (
          <div key={profile.id} className="flex items-center gap-2">
            {(['name', 'credentialsDir', 'publisherCode'] as const).map((field) => (
              <Input
                key={field}
                value={profile[field]}
                disabled={disabled}
                placeholder={fieldLabels[field]}
                aria-label={fieldLabels[field]}
                className={
                  field === 'credentialsDir'
                    ? 'h-8 min-w-0 flex-1 font-mono text-xs'
                    : 'h-8 w-36 text-xs'
                }
                onChange={(event) => updateDraft(profile.id, { [field]: event.target.value })}
                onFocus={() => setEditing(true)}
                onBlur={() => {
                  setEditing(false)
                  commit(drafts)
                }}
              />
            ))}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              disabled={disabled}
              aria-label={translate('connectedAccounts.admobRemoveProfile', 'Remove profile')}
              onClick={() => {
                const nextDrafts = drafts.filter((entry) => entry.id !== profile.id)
                setDrafts(nextDrafts)
                commit(nextDrafts)
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled}
          onClick={() =>
            setDrafts((current) => [
              ...current,
              { id: createBrowserUuid(), name: '', credentialsDir: '', publisherCode: '' }
            ])
          }
        >
          <Plus className="size-3.5" />
          {translate('connectedAccounts.admobAddProfile', 'Add profile')}
        </Button>
      </div>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          {translate(
            'connectedAccounts.admobMcpConfigNote',
            'For the AdMob MCP server to follow this project, change its env in the MCP config to:'
          )}
        </p>
        <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs select-text">
          {ADMOB_MCP_CONFIG_SNIPPET}
        </pre>
      </div>
    </div>
  )
}
