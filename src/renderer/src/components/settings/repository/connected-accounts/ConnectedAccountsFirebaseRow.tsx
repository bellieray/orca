import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '../../../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/select'
import { translate } from '@/i18n/i18n'
import { joinPath } from '@/lib/path'
import { readIpcErrorDetail } from '@/lib/ipc-error'
import { ConnectedAccountsRow } from './ConnectedAccountsRow'

const OnboardingInlineCommandTerminal = lazy(() =>
  import('../../../onboarding/OnboardingInlineCommandTerminal').then((module) => ({
    default: module.OnboardingInlineCommandTerminal
  }))
)

const FIREBASE_DEFAULT_VALUE = '__connected_accounts_firebase_default__'
const FIREBASE_ADD_ACCOUNT_COMMAND = 'npx -y firebase-tools@latest login:add'

type ConnectedAccountsFirebaseRowProps = {
  repoId: string
  repoPath: string
  boundEmail: string | undefined
  disabled: boolean
  onBind: (email: string | undefined) => void
}

export function ConnectedAccountsFirebaseRow({
  repoId,
  repoPath,
  boundEmail,
  disabled,
  onBind
}: ConnectedAccountsFirebaseRowProps): React.JSX.Element {
  const labelId = useId()
  const [accounts, setAccounts] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [hasFirebaseJson, setHasFirebaseJson] = useState<boolean | null>(null)
  const [binding, setBinding] = useState(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refreshAccounts = useCallback(async () => {
    if (disabled) {
      return
    }
    try {
      const next = await window.api.connectedAccounts.listFirebaseAccounts()
      if (mountedRef.current) {
        setAccounts(next)
        setError(null)
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(readIpcErrorDetail(err) ?? String(err))
      }
    }
  }, [disabled])

  const refreshFirebaseJson = useCallback(async () => {
    if (disabled) {
      return
    }
    try {
      const exists = await window.api.fs.pathExists({
        filePath: joinPath(repoPath, 'firebase.json')
      })
      if (mountedRef.current) {
        setHasFirebaseJson(exists)
      }
    } catch {
      if (mountedRef.current) {
        setHasFirebaseJson(null)
      }
    }
  }, [disabled, repoPath])

  useEffect(() => {
    void refreshAccounts()
    void refreshFirebaseJson()
  }, [refreshAccounts, refreshFirebaseJson])

  const bindProject = async () => {
    setBinding(true)
    setError(null)
    try {
      await window.api.connectedAccounts.bindFirebaseProject({ repoId })
    } catch (err) {
      if (mountedRef.current) {
        setError(readIpcErrorDetail(err) ?? String(err))
      }
    } finally {
      if (mountedRef.current) {
        setBinding(false)
      }
      await refreshFirebaseJson()
    }
  }

  const boundKnown = Boolean(boundEmail && accounts.includes(boundEmail))

  return (
    <ConnectedAccountsRow
      title={translate('connectedAccounts.toolFirebase', 'Firebase')}
      labelId={labelId}
    >
      <div className="flex items-center gap-2">
        <Select
          value={boundEmail ?? FIREBASE_DEFAULT_VALUE}
          disabled={disabled}
          onValueChange={(value) => onBind(value === FIREBASE_DEFAULT_VALUE ? undefined : value)}
        >
          <SelectTrigger size="sm" className="min-w-0 flex-1" aria-labelledby={labelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FIREBASE_DEFAULT_VALUE}>
              {translate('connectedAccounts.defaultMachine', 'Default (machine)')}
            </SelectItem>
            {boundEmail && !boundKnown ? (
              <SelectItem value={boundEmail} disabled>
                {translate('connectedAccounts.summaryMissing', '{{account}} (missing)', {
                  account: boundEmail
                })}
              </SelectItem>
            ) : null}
            {accounts.map((email) => (
              <SelectItem key={email} value={email}>
                {email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          disabled={disabled}
          aria-label={translate('connectedAccounts.firebaseRefresh', 'Refresh Firebase accounts')}
          title={translate('connectedAccounts.firebaseRefresh', 'Refresh Firebase accounts')}
          onClick={() => void refreshAccounts()}
        >
          <RefreshCw className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled || terminalOpen}
          onClick={() => setTerminalOpen(true)}
        >
          <Plus className="size-3.5" />
          {translate('connectedAccounts.firebaseAddAccount', 'Add account')}
        </Button>
      </div>
      {hasFirebaseJson === false && !disabled ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={binding}
            onClick={() => void bindProject()}
          >
            {translate('connectedAccounts.firebaseBindProject', 'Bind Firebase to this project')}
          </Button>
          <p className="text-xs text-muted-foreground">
            {translate(
              'connectedAccounts.firebaseCommitNote',
              'Commit firebase.json so other worktrees get it.'
            )}
          </p>
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {terminalOpen ? (
        <div className="space-y-2">
          <Suspense
            fallback={
              <p className="text-xs text-muted-foreground">
                {translate('connectedAccounts.firebaseTerminalLoading', 'Loading terminal…')}
              </p>
            }
          >
            <OnboardingInlineCommandTerminal
              command={FIREBASE_ADD_ACCOUNT_COMMAND}
              title={translate('connectedAccounts.firebaseTerminalTitle', 'Firebase sign-in')}
              ariaLabel={translate(
                'connectedAccounts.firebaseTerminalLabel',
                'Firebase sign-in terminal'
              )}
              description={translate(
                'connectedAccounts.firebaseTerminalDescription',
                'Press Enter to run the command and sign in with the account to add.'
              )}
              autoScrollIntoView={false}
              terminalTopMarginPx={8}
              worktreeId="connected-accounts-firebase-sign-in"
              onCommandFinished={() => void refreshAccounts()}
              onTerminalExit={() => void refreshAccounts()}
            />
          </Suspense>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              setTerminalOpen(false)
              void refreshAccounts()
            }}
          >
            {translate('connectedAccounts.firebaseTerminalClose', 'Close terminal')}
          </Button>
        </div>
      ) : null}
    </ConnectedAccountsRow>
  )
}
