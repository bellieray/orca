import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { ConnectedAccountsExtraEnvEntry } from '../../../../../../shared/connected-accounts/connected-accounts-types'
import {
  isReservedConnectedAccountsEnvKey,
  isValidConnectedAccountsEnvKey
} from '../../../../../../shared/connected-accounts/connected-accounts-normalize'
import { Button } from '../../../ui/button'
import { Input } from '../../../ui/input'
import { translate } from '@/i18n/i18n'
import { isWindowsDesktopClient } from '@/lib/windows-path-access'

type ExtraEnvDraftRow = { rowId: number; key: string; value: string }

type ConnectedAccountsExtraEnvEditorProps = {
  entries: ConnectedAccountsExtraEnvEntry[]
  disabled: boolean
  onCommit: (entries: ConnectedAccountsExtraEnvEntry[]) => void
}

function envKeyIdentity(key: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? key.toUpperCase() : key
}

function extraEnvRowError(
  row: ExtraEnvDraftRow,
  rows: ExtraEnvDraftRow[],
  platform: NodeJS.Platform
): string | null {
  const key = row.key.trim()
  if (!key) {
    return null
  }
  if (!isValidConnectedAccountsEnvKey(key)) {
    return translate(
      'connectedAccounts.extraEnvInvalidKey',
      'Use letters, digits and _, not starting with a digit.'
    )
  }
  if (isReservedConnectedAccountsEnvKey(key, platform)) {
    return translate('connectedAccounts.extraEnvReservedKey', '{{key}} is reserved.', { key })
  }
  const identity = envKeyIdentity(key, platform)
  const firstIndex = rows.findIndex(
    (entry) => envKeyIdentity(entry.key.trim(), platform) === identity
  )
  if (rows[firstIndex] !== row) {
    return translate('connectedAccounts.extraEnvDuplicateKey', 'Duplicate key.')
  }
  return null
}

/** Rows stay local drafts; only valid rows are persisted, so a blank new row survives the save. */
export function ConnectedAccountsExtraEnvEditor({
  entries,
  disabled,
  onCommit
}: ConnectedAccountsExtraEnvEditorProps): React.JSX.Element {
  const platform: NodeJS.Platform = isWindowsDesktopClient() ? 'win32' : 'linux'
  const [rows, setRows] = useState<ExtraEnvDraftRow[]>(() =>
    entries.map((entry, index) => ({ rowId: index, key: entry.key, value: entry.value }))
  )
  const [nextRowId, setNextRowId] = useState(entries.length)
  const [editing, setEditing] = useState(false)
  const entriesKey = JSON.stringify(entries)
  const [syncedKey, setSyncedKey] = useState(entriesKey)
  // Adopt env synced in while the section is open; unsaved (blank or invalid) rows stay.
  if (syncedKey !== entriesKey && !editing) {
    setSyncedKey(entriesKey)
    const unsaved = rows.filter((row) => !row.key.trim() || extraEnvRowError(row, rows, platform))
    setRows([
      ...entries.map((entry, index) => ({
        rowId: nextRowId + index,
        key: entry.key,
        value: entry.value
      })),
      ...unsaved
    ])
    setNextRowId(nextRowId + entries.length)
  }

  const commit = (nextRows: ExtraEnvDraftRow[]) => {
    onCommit(
      nextRows
        .filter((row) => row.key.trim() && !extraEnvRowError(row, nextRows, platform))
        .map((row) => ({ key: row.key.trim(), value: row.value }))
    )
  }

  const updateRow = (rowId: number, patch: Partial<ExtraEnvDraftRow>) => {
    setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)))
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const error = extraEnvRowError(row, rows, platform)
        const errorId = `connected-accounts-env-error-${row.rowId}`
        return (
          <div key={row.rowId} className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                value={row.key}
                disabled={disabled}
                placeholder={translate('connectedAccounts.extraEnvKeyPlaceholder', 'KEY')}
                aria-label={translate('connectedAccounts.extraEnvKeyLabel', 'Variable name')}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className="h-8 w-48 font-mono text-xs"
                onChange={(event) => updateRow(row.rowId, { key: event.target.value })}
                onFocus={() => setEditing(true)}
                onBlur={() => {
                  setEditing(false)
                  commit(rows)
                }}
              />
              <Input
                value={row.value}
                disabled={disabled}
                placeholder={translate('connectedAccounts.extraEnvValuePlaceholder', 'value')}
                aria-label={translate('connectedAccounts.extraEnvValueLabel', 'Variable value')}
                className="h-8 min-w-0 flex-1 font-mono text-xs"
                onChange={(event) => updateRow(row.rowId, { value: event.target.value })}
                onFocus={() => setEditing(true)}
                onBlur={() => {
                  setEditing(false)
                  commit(rows)
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                disabled={disabled}
                aria-label={translate('connectedAccounts.extraEnvRemove', 'Remove variable')}
                onClick={() => {
                  const nextRows = rows.filter((entry) => entry.rowId !== row.rowId)
                  setRows(nextRows)
                  commit(nextRows)
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            {error ? (
              <p id={errorId} className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )
      })}
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={disabled}
        onClick={() => {
          setRows((current) => [...current, { rowId: nextRowId, key: '', value: '' }])
          setNextRowId((id) => id + 1)
        }}
      >
        <Plus className="size-3.5" />
        {translate('connectedAccounts.extraEnvAdd', 'Add variable')}
      </Button>
    </div>
  )
}
