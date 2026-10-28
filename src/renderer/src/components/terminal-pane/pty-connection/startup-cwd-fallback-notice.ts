import { writeTerminalOutput } from '@/lib/pane-manager/pane-terminal-output-scheduler'
import { STARTUP_CWD_FALLBACK_NOTICE } from '../../../../../shared/startup-cwd-fallback'
import { shouldWritePtyOutputForeground } from './foreground-output-scan'
import type { ConnectPanePtySession } from './connect-pane-pty-session'
import { formatConnectedAccountsTerminalNotice } from '../../../../../shared/connected-accounts/connected-accounts-terminal-notice'

export { STARTUP_CWD_FALLBACK_NOTICE }

/** Tells the pane its saved folder was gone, so its terminal started at the workspace root. */
export function writeStartupCwdFallbackNotice(
  session: ConnectPanePtySession,
  result: unknown
): void {
  if (!result || typeof result !== 'object' || !('startupCwdFallback' in result)) {
    return
  }
  if (!result.startupCwdFallback) {
    return
  }
  writeTerminalOutput(session.pane.terminal, STARTUP_CWD_FALLBACK_NOTICE, {
    foreground: shouldWritePtyOutputForeground(session.deps.isVisibleRef.current)
  })
}

/** Tells the pane its project's account binding could not be applied, so a tool may fail. */
export function writeConnectedAccountsWarningNotice(
  session: ConnectPanePtySession,
  result: unknown
): void {
  if (!result || typeof result !== 'object' || !('connectedAccountsWarning' in result)) {
    return
  }
  const warning = result.connectedAccountsWarning
  if (typeof warning !== 'string' || !warning) {
    return
  }
  writeTerminalOutput(session.pane.terminal, formatConnectedAccountsTerminalNotice(warning), {
    foreground: shouldWritePtyOutputForeground(session.deps.isVisibleRef.current)
  })
}
