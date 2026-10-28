import { readFileSync, realpathSync, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import type { ConnectedAccountsUnresolved } from './connected-accounts-static-env'

const FIREBASE_LOGIN_ADD_COMMAND = 'npx -y firebase-tools@latest login:add'
// configstore writes the file with tab indentation; match it so firebase-tools sees no format drift.
const CONFIGSTORE_INDENT = '\t'

type ConfigstoreData = Record<string, unknown>

export function firebaseToolsConfigstorePath(env: NodeJS.ProcessEnv, home: string): string {
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'configstore', 'firebase-tools.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readConfigstore(path: string): ConfigstoreData | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function emailOf(account: unknown): string | null {
  if (!isRecord(account) || !isRecord(account.user)) {
    return null
  }
  const email = account.user.email
  return typeof email === 'string' && email ? email : null
}

function collectAccountEmails(data: ConfigstoreData): string[] {
  const emails: string[] = []
  const additional = Array.isArray(data.additionalAccounts) ? data.additionalAccounts : []
  for (const account of [data, ...additional]) {
    const email = emailOf(account)
    if (email && !emails.includes(email)) {
      emails.push(email)
    }
  }
  return emails
}

export function listFirebaseToolsAccountEmails(path: string): string[] {
  const data = readConfigstore(path)
  return data ? collectAccountEmails(data) : []
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

// Mirrors firebase-tools detectProjectRoot (no --config): path.resolve walk-up to the nearest firebase.json.
export function findFirebaseProjectRoot(dir: string): string | null {
  let current = resolve(dir)
  while (!isFile(resolve(current, './firebase.json'))) {
    const parent = dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
  return current
}

function unresolved(
  email: string,
  reason: string,
  fixCommand?: string
): { ok: false; unresolved: ConnectedAccountsUnresolved } {
  return { ok: false, unresolved: { tool: 'firebase', account: email, reason, fixCommand } }
}

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

export function ensureFirebaseActiveAccount(args: {
  configstorePath: string
  worktreePath: string
  email: string
}): { ok: true; projectRoot: string } | { ok: false; unresolved: ConnectedAccountsUnresolved } {
  const { configstorePath, worktreePath, email } = args
  const data = readConfigstore(configstorePath)
  if (!data || !collectAccountEmails(data).includes(email)) {
    return unresolved(
      email,
      `Firebase account ${email} is not logged in to firebase-tools`,
      FIREBASE_LOGIN_ADD_COMMAND
    )
  }

  const projectRoot = findFirebaseProjectRoot(worktreePath)
  if (projectRoot === null || projectRoot !== resolve(worktreePath)) {
    return unresolved(email, 'This worktree has no firebase.json at its root')
  }

  // The child's cwd may be the realpath (macOS /tmp, Windows subst), so firebase-tools may key on either.
  const keys = [projectRoot]
  const real = realpathOrNull(projectRoot)
  if (real !== null && real !== projectRoot) {
    keys.push(real)
  }

  const activeAccounts = isRecord(data.activeAccounts) ? { ...data.activeAccounts } : {}
  const stale = keys.filter((key) => activeAccounts[key] !== email)
  if (stale.length === 0) {
    return { ok: true, projectRoot }
  }
  for (const key of stale) {
    activeAccounts[key] = email
  }

  try {
    const mode = statSync(configstorePath).mode & 0o777
    writeFileAtomically(
      configstorePath,
      JSON.stringify({ ...data, activeAccounts }, undefined, CONFIGSTORE_INDENT),
      { mode }
    )
  } catch {
    return unresolved(email, 'Could not update the firebase-tools account config')
  }
  return { ok: true, projectRoot }
}

export async function writeConnectedAccountsFirebaseJson(worktreePath: string): Promise<void> {
  try {
    // 'wx' makes the "only if absent" check atomic.
    await writeFile(join(worktreePath, 'firebase.json'), '{}\n', { flag: 'wx' })
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
      throw error
    }
  }
}
