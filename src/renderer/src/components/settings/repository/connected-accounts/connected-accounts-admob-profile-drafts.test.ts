import { describe, expect, it } from 'vitest'
import type { ConnectedAccountsAdmobProfile } from '../../../../../../shared/connected-accounts/connected-accounts-types'
import {
  admobProfilesToPersist,
  resyncAdmobProfileDrafts
} from './connected-accounts-admob-profile-drafts'

const saved: ConnectedAccountsAdmobProfile = {
  id: 'p1',
  name: 'Studio',
  credentialsDir: '/creds/studio',
  publisherCode: 'pub-1'
}

describe('admobProfilesToPersist', () => {
  it('keeps the saved profile when its draft is temporarily incomplete', () => {
    expect(admobProfilesToPersist([{ ...saved, credentialsDir: '' }], [saved])).toEqual([saved])
  })

  it('replaces a saved profile with its complete edit and adds complete new drafts', () => {
    const edited = { ...saved, name: 'Studio 2' }
    const added = { id: 'p2', name: 'Other', credentialsDir: '/c', publisherCode: 'pub-2' }
    const blank = { id: 'p3', name: '', credentialsDir: '', publisherCode: '' }
    expect(admobProfilesToPersist([edited, added, blank], [saved])).toEqual([edited, added])
  })

  it('drops a saved profile only when its draft row was removed', () => {
    expect(admobProfilesToPersist([], [saved])).toEqual([])
  })
})

describe('resyncAdmobProfileDrafts', () => {
  it('takes synced profiles and keeps unsaved local drafts', () => {
    const blank = { id: 'p3', name: 'half', credentialsDir: '', publisherCode: '' }
    const remote = { ...saved, name: 'Renamed elsewhere' }
    expect(resyncAdmobProfileDrafts([saved, blank], [remote])).toEqual([remote, blank])
  })
})
