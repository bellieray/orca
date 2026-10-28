import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'

/** A project's pinned Claude account, which replaces the global selection for that project only. */
export type ClaudeRepoAccountOverride = { repoId: string; accountId: string }

// Why non-absolute: the claude shell function refuses it instead of running the default account.
export const CLAUDE_REPO_POINTER_UNBOUND = '!unbound'

export function claudeRepoPointerPath(dataRoot: string, repoId: string): string {
  const key = createHash('sha256').update(repoId).digest('hex').slice(0, 16)
  return join(dataRoot, 'claude-profiles', 'by-repo', key)
}

/** Skip unchanged content so launches do not rewrite the pointer every time. */
export function writeClaudeProfilePointer(path: string, home: string): void {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== home) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileAtomically(path, home, { mode: 0o600 })
  }
}

/** Writes the sentinel when the bound account cannot run, so a terminal claude fails instead of using another account. */
export function writeClaudeRepoPointer(path: string, routedHome: () => string | null): void {
  let home = CLAUDE_REPO_POINTER_UNBOUND
  try {
    home = routedHome() ?? ''
  } catch {
    // Keep the sentinel.
  }
  writeClaudeProfilePointer(path, home)
}
