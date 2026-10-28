// Which binding each live pane started with, so the UI can count panes still on old accounts.
type PaneRecord = { repoId: string; fingerprint: string | null }

const panes = new Map<string, PaneRecord>()

export function recordConnectedAccountsPane(
  ptyId: string,
  repoId: string,
  fingerprint: string | null
): void {
  panes.set(ptyId, { repoId, fingerprint })
}

export function forgetConnectedAccountsPane(ptyId: string): void {
  panes.delete(ptyId)
}

export function countStaleConnectedAccountsPanes(
  repoId: string,
  currentFingerprint: string | null
): number {
  let count = 0
  for (const pane of panes.values()) {
    if (pane.repoId === repoId && pane.fingerprint !== currentFingerprint) {
      count++
    }
  }
  return count
}

/** @internal — test-only */
export function clearConnectedAccountsPanesForTests(): void {
  panes.clear()
}
