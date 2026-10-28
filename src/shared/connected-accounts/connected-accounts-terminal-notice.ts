/** The pane line for an unresolved project account binding; one bracketed line per account. */
export function formatConnectedAccountsTerminalNotice(warning: string): string {
  const lines = warning
    .split('\n')
    .filter(Boolean)
    .map((line) => `[${line}]`)
  return `\r\n${lines.join('\r\n')}\r\n`
}

// Matches main's formatConnectedAccountsUnresolved text; IPC drops error.code, so the toast matches on text.
const CONNECTED_ACCOUNTS_REFUSAL_LINE =
  /\b(?:Claude|GitHub|Git|Firebase|AdMob) account \S.* is not available: .+\. Fix: \S/

/** A launch refused for an unresolved account binding: user-fixable, so no issue link. */
export function isConnectedAccountsRefusalLine(line: string): boolean {
  return CONNECTED_ACCOUNTS_REFUSAL_LINE.test(line)
}
