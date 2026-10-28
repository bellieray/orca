import type { ConnectedAccountsAdmobProfile } from '../../../../../../shared/connected-accounts/connected-accounts-types'

export function isCompleteAdmobProfile(profile: ConnectedAccountsAdmobProfile): boolean {
  return Boolean(
    profile.name.trim() && profile.credentialsDir.trim() && profile.publisherCode.trim()
  )
}

/** Half-edited drafts of saved profiles keep the saved value; only a removed row deletes one. */
export function admobProfilesToPersist(
  drafts: ConnectedAccountsAdmobProfile[],
  saved: ConnectedAccountsAdmobProfile[]
): ConnectedAccountsAdmobProfile[] {
  const savedById = new Map(saved.map((profile) => [profile.id, profile]))
  return drafts.flatMap((draft) => {
    if (isCompleteAdmobProfile(draft)) {
      return [draft]
    }
    const savedProfile = savedById.get(draft.id)
    return savedProfile ? [savedProfile] : []
  })
}

/** Adopts profiles synced from settings while keeping new drafts that were never saved. */
export function resyncAdmobProfileDrafts(
  drafts: ConnectedAccountsAdmobProfile[],
  saved: ConnectedAccountsAdmobProfile[]
): ConnectedAccountsAdmobProfile[] {
  const savedIds = new Set(saved.map((profile) => profile.id))
  return [
    ...saved,
    ...drafts.filter((draft) => !savedIds.has(draft.id) && !isCompleteAdmobProfile(draft))
  ]
}
