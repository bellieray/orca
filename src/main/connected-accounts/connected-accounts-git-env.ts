// Pins a project's GitHub account for gh, git HTTPS credentials and commit identity.
// Tokens only ever live in the returned child env: never log, persist or embed them in reasons.
import { gitExecFileAsync } from '../git/runner'
import { resolveGhAccountToken } from '../github/gh-account-token'
import { parseWslPath } from '../wsl'
import {
  appendGitConfigEnv,
  readValidGitConfigEnvCount
} from '../../shared/git-credential-prompt-env'
import { ghTokenEnvVarForHost, type GhAccountBinding } from '../../shared/github/account-binding'
import type { ConnectedAccountsGitAuthor } from '../../shared/connected-accounts/connected-accounts-types'
import type { ConnectedAccountsUnresolved } from './connected-accounts-static-env'

/** Non-empty bogus token: gh fails auth instead of reading the keyring's default account. */
export const CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED = 'orca-connected-accounts-unresolved'

// Why: bare `gh` keeps the value free of shell quoting; Git for Windows runs `!` helpers via its bundled sh.
const GH_CREDENTIAL_HELPER = '!gh auth git-credential'
const GIT_CONFIG_ENV_KEY_RE = /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/
const GIT_VERSION_TIMEOUT_MS = 10_000
const MIN_GIT_MAJOR = 2
// GIT_CONFIG_COUNT/KEY_n/VALUE_n landed in Git 2.31.
const MIN_GIT_MINOR = 31

type GhSpawnEnvResult =
  | { env: Record<string, string> }
  | { env: Record<string, string>; unresolved: ConnectedAccountsUnresolved }

function credentialHelperKey(host: string): string {
  return `credential.https://${host}.helper`
}

/** Full indexed-config protocol (inherited + new) so an atomic protocol merge keeps caller entries. */
function gitConfigPatch(
  baseEnv: Record<string, string>,
  entries: readonly (readonly [string, string])[]
): Record<string, string> {
  const merged = appendGitConfigEnv(baseEnv, entries)
  const patch: Record<string, string> = {}
  for (const [key, value] of Object.entries(merged)) {
    if (GIT_CONFIG_ENV_KEY_RE.test(key) && typeof value === 'string') {
      patch[key] = value
    }
  }
  return patch
}

function ghHostEnv(binding: GhAccountBinding, token: string): Record<string, string> {
  return {
    [ghTokenEnvVarForHost(binding.host)]: token,
    GH_HOST: binding.host,
    GH_PROMPT_DISABLED: '1'
  }
}

export function buildBoundGitEnvPatch(args: {
  binding: GhAccountBinding
  token: string
  author?: ConnectedAccountsGitAuthor
  baseEnv: Record<string, string>
}): Record<string, string> {
  const { binding, token, author, baseEnv } = args
  const helperKey = credentialHelperKey(binding.host)
  return {
    ...ghHostEnv(binding, token),
    // Empty value resets inherited helpers (osxkeychain/GCM) so only the bound gh token answers.
    ...gitConfigPatch(baseEnv, [
      [helperKey, ''],
      [helperKey, GH_CREDENTIAL_HELPER]
    ]),
    ...(author
      ? {
          GIT_AUTHOR_NAME: author.name,
          GIT_AUTHOR_EMAIL: author.email,
          GIT_COMMITTER_NAME: author.name,
          GIT_COMMITTER_EMAIL: author.email
        }
      : {})
  }
}

/** Fails gh and git HTTPS auth closed for the bound host instead of using the default account. */
export function buildBlockedGhEnvPatch(
  binding: GhAccountBinding,
  baseEnv: Record<string, string> = {}
): Record<string, string> {
  const resetEntry: [string, string] = [credentialHelperKey(binding.host), '']
  // Ambiguous inherited indices would make appendGitConfigEnv skip the reset; restart the protocol instead.
  const configBase = readValidGitConfigEnvCount(baseEnv) === null ? {} : baseEnv
  return {
    ...ghHostEnv(binding, CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED),
    ...gitConfigPatch(configBase, [resetEntry])
  }
}

const gitConfigEnvSupportCache = new Map<string, boolean>()

function gitExecutionHostKey(cwd: string | undefined): string {
  const wsl = cwd ? parseWslPath(cwd) : null
  return wsl ? `wsl:${wsl.distro.toLowerCase()}` : 'native'
}

function parseGitVersionSupportsConfigEnv(stdout: string): boolean {
  const match = /git version (\d+)\.(\d+)/.exec(stdout)
  if (!match) {
    return false
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > MIN_GIT_MAJOR || (major === MIN_GIT_MAJOR && minor >= MIN_GIT_MINOR)
}

/** Cached per execution host; probe failures answer false (fail closed) and are retried next time. */
export async function resolveGitSupportsConfigEnv(cwd?: string): Promise<boolean> {
  const key = gitExecutionHostKey(cwd)
  const cached = gitConfigEnvSupportCache.get(key)
  if (cached !== undefined) {
    return cached
  }
  try {
    const { stdout } = await gitExecFileAsync(['--version'], {
      cwd: cwd ?? process.cwd(),
      timeout: GIT_VERSION_TIMEOUT_MS
    })
    const supported = parseGitVersionSupportsConfigEnv(stdout)
    gitConfigEnvSupportCache.set(key, supported)
    return supported
  } catch {
    return false
  }
}

/** @internal — test-only */
export function clearGitConfigEnvSupportCacheForTests(): void {
  gitConfigEnvSupportCache.clear()
}

export async function resolveGhSpawnEnv(args: {
  binding: GhAccountBinding
  author?: ConnectedAccountsGitAuthor
  cwd: string
  baseEnv: Record<string, string>
}): Promise<GhSpawnEnvResult> {
  const { binding, author, cwd, baseEnv } = args
  const account = `${binding.user}@${binding.host}`
  const blocked = (unresolved: ConnectedAccountsUnresolved): GhSpawnEnvResult => ({
    env: buildBlockedGhEnvPatch(binding, baseEnv),
    unresolved
  })

  if (!(await resolveGitSupportsConfigEnv(cwd))) {
    return blocked({
      tool: 'git',
      account,
      reason: 'Git 2.31+ is required to pin the GitHub account for git'
    })
  }
  if (readValidGitConfigEnvCount(baseEnv) === null) {
    // appendGitConfigEnv would skip our helper and git would fall through to the keychain account.
    return blocked({
      tool: 'git',
      account,
      reason:
        'Inherited GIT_CONFIG_COUNT/KEY/VALUE variables are inconsistent; fix them to pin the GitHub account for git'
    })
  }

  let token: string
  try {
    token = await resolveGhAccountToken(binding, { cwd })
  } catch {
    // Fixed text only: gh stderr may echo auth material.
    return blocked({
      tool: 'github',
      account,
      fixCommand: `gh auth login --hostname ${binding.host}`,
      reason: `GitHub account ${account} is not signed in to gh on this machine`
    })
  }
  return { env: buildBoundGitEnvPatch({ binding, token, author, baseEnv }) }
}
