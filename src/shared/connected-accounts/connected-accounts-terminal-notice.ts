/** The pane line for an unresolved project account binding; one bracketed line per account. */
export function formatConnectedAccountsTerminalNotice(warning: string): string {
  const lines = warning
    .split('\n')
    .filter(Boolean)
    .map((line) => `[${line}]`)
  return `\r\n${lines.join('\r\n')}\r\n`
}
