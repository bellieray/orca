import {
  isReservedConnectedAccountsEnvKey,
  isValidConnectedAccountsEnvKey
} from '../../shared/connected-accounts/connected-accounts-normalize'
import type {
  ConnectedAccountsAdmobProfile,
  ConnectedAccountsExtraEnvEntry
} from '../../shared/connected-accounts/connected-accounts-types'

export type ConnectedAccountsUnresolved = {
  tool: 'claude' | 'github' | 'git' | 'firebase' | 'admob'
  account: string
  fixCommand?: string
  reason: string
}

export function resolveAdmobProfileEnv(
  profileId: string,
  profiles: ConnectedAccountsAdmobProfile[]
): { env: Record<string, string> } | { unresolved: ConnectedAccountsUnresolved } {
  const profile = profiles.find((candidate) => candidate.id === profileId)
  if (!profile) {
    return {
      unresolved: {
        tool: 'admob',
        account: profileId,
        reason: 'AdMob profile no longer exists in settings'
      }
    }
  }
  return { env: { CREDENTIALS_DIR: profile.credentialsDir, PUBLISHER_CODE: profile.publisherCode } }
}

export function resolveExtraEnv(
  entries: ConnectedAccountsExtraEnvEntry[] | undefined,
  platform: NodeJS.Platform
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const { key, value } of entries ?? []) {
    // Re-check here: saved data may have been validated on another platform.
    if (!isValidConnectedAccountsEnvKey(key) || isReservedConnectedAccountsEnvKey(key, platform)) {
      continue
    }
    env[key] = value
  }
  return env
}
