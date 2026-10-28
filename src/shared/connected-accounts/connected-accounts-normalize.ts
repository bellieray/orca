import type {
  ConnectedAccountsAdmobProfile,
  ConnectedAccountsExtraEnvEntry,
  ConnectedAccountsGitAuthor,
  ConnectedAccountsGlobalSettings,
  RepoConnectedAccounts
} from './connected-accounts-types'

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const RESERVED_ENV_PREFIXES = ['ORCA_', 'GH_', 'GIT_', 'CLAUDE_']
const RESERVED_ENV_KEYS = ['PATH', 'HOME', 'CREDENTIALS_DIR', 'PUBLISHER_CODE', 'GITHUB_TOKEN']

export function isValidConnectedAccountsEnvKey(key: string): boolean {
  return ENV_KEY_RE.test(key)
}

export function isReservedConnectedAccountsEnvKey(key: string, platform: NodeJS.Platform): boolean {
  // Windows env names are case-insensitive, so `path` shadows `PATH` there.
  const candidate = platform === 'win32' ? key.toUpperCase() : key
  return (
    RESERVED_ENV_KEYS.includes(candidate) ||
    RESERVED_ENV_PREFIXES.some((prefix) => candidate.startsWith(prefix))
  )
}

// Shared code also loads in the sandboxed renderer, where `process` may be absent.
function currentPlatform(): NodeJS.Platform {
  return typeof process === 'undefined' ? 'linux' : process.platform
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.includes('\u0000')) {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function normalizeGitAuthor(value: unknown): ConnectedAccountsGitAuthor | undefined {
  const record = asRecord(value)
  if (!record) {
    return undefined
  }
  const name = trimmedString(record.name)
  const email = trimmedString(record.email)
  return name && email ? { name, email } : undefined
}

function normalizeExtraEnv(
  value: unknown,
  platform: NodeJS.Platform
): ConnectedAccountsExtraEnvEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const entries: ConnectedAccountsExtraEnvEntry[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    const record = asRecord(raw)
    const key = record ? trimmedString(record.key) : undefined
    // Env values may be intentionally empty or padded, so only reject NUL.
    const envValue =
      record && typeof record.value === 'string' && !record.value.includes('\u0000')
        ? record.value
        : undefined
    if (
      !key ||
      envValue === undefined ||
      !isValidConnectedAccountsEnvKey(key) ||
      isReservedConnectedAccountsEnvKey(key, platform)
    ) {
      continue
    }
    const identity = platform === 'win32' ? key.toUpperCase() : key
    if (seen.has(identity)) {
      continue
    }
    seen.add(identity)
    entries.push({ key, value: envValue })
  }
  return entries.length > 0 ? entries : undefined
}

export function normalizeRepoConnectedAccounts(
  value: unknown,
  platform: NodeJS.Platform = currentPlatform()
): RepoConnectedAccounts | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }
  const claudeAccountId = trimmedString(record.claudeAccountId)
  const firebaseEmail = trimmedString(record.firebaseEmail)
  const admobProfileId = trimmedString(record.admobProfileId)
  const gitAuthor = normalizeGitAuthor(record.gitAuthor)
  const extraEnv = normalizeExtraEnv(record.extraEnv, platform)
  const normalized: RepoConnectedAccounts = {
    ...(claudeAccountId ? { claudeAccountId } : {}),
    ...(firebaseEmail ? { firebaseEmail } : {}),
    ...(admobProfileId ? { admobProfileId } : {}),
    ...(gitAuthor ? { gitAuthor } : {}),
    ...(extraEnv ? { extraEnv } : {})
  }
  return Object.keys(normalized).length > 0 ? normalized : null
}

export function normalizeConnectedAccountsAdmobProfiles(
  value: unknown
): ConnectedAccountsAdmobProfile[] {
  if (!Array.isArray(value)) {
    return []
  }
  const profiles: ConnectedAccountsAdmobProfile[] = []
  const seenIds = new Set<string>()
  for (const raw of value) {
    const record = asRecord(raw)
    if (!record) {
      continue
    }
    const id = trimmedString(record.id)
    const name = trimmedString(record.name)
    const credentialsDir = trimmedString(record.credentialsDir)
    const publisherCode = trimmedString(record.publisherCode)
    if (!id || !name || !credentialsDir || !publisherCode || seenIds.has(id)) {
      continue
    }
    seenIds.add(id)
    profiles.push({ id, name, credentialsDir, publisherCode })
  }
  return profiles
}

/** Settings-write boundary: returns only the connected-accounts keys present in `updates`, normalized. */
export function sanitizeConnectedAccountsSettingsUpdates(
  updates: Partial<ConnectedAccountsGlobalSettings>
): Partial<ConnectedAccountsGlobalSettings> {
  return 'connectedAccountsAdmobProfiles' in updates
    ? {
        connectedAccountsAdmobProfiles: normalizeConnectedAccountsAdmobProfiles(
          updates.connectedAccountsAdmobProfiles
        )
      }
    : {}
}
