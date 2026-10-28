import { describe, expect, it, vi } from 'vitest'
import { createTestStore } from './store-test-helpers'
import {
  installReposRuntimeRoutingHarness,
  localRepo,
  reposUpdate
} from './repos-runtime-routing-fixture'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }
}))

installReposRuntimeRoutingHarness()

describe('repo connectedAccounts updates', () => {
  it('stores, sanitizes and null-clears a local connectedAccounts binding', async () => {
    reposUpdate.mockResolvedValue(undefined)
    const store = createTestStore()
    store.setState({ repos: [localRepo] })

    await store
      .getState()
      .updateRepo(localRepo.id, { connectedAccounts: { claudeAccountId: ' claude-1 ' } })
    expect(store.getState().repos[0]?.connectedAccounts).toEqual({ claudeAccountId: 'claude-1' })

    await store
      .getState()
      .updateRepo(localRepo.id, { connectedAccounts: { extraEnv: [{ key: 'PATH', value: 'x' }] } })
    expect(reposUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ updates: { connectedAccounts: null } })
    )
    expect(store.getState().repos[0]).not.toHaveProperty('connectedAccounts')
  })
})
