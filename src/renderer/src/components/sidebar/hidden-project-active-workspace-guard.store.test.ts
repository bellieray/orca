import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'
import { makeRepo, makeWorktree } from '../worktree-jump-palette-test-fixtures'
import { installHiddenProjectActiveWorkspaceGuard } from './hidden-project-active-workspace-guard'

const initialState = useAppStore.getInitialState()
const secret = { ...makeRepo(), id: 'secret', path: '/repos/secret' }
const work = { ...makeRepo(), id: 'work', path: '/repos/work' }
const hiddenWt = makeWorktree('secret::/w/a', 'A', { repoId: 'secret', path: '/w/a' })
const visibleWt = makeWorktree('work::/w/b', 'B', { repoId: 'work', path: '/w/b' })

function seed(lastVisited: Record<string, number>): void {
  useAppStore.setState({
    repos: [secret, work],
    worktreesByRepo: { secret: [hiddenWt], work: [visibleWt] },
    showSleepingWorkspaces: true,
    persistedUIReady: true,
    activeWorktreeId: hiddenWt.id,
    activeRepoId: 'secret',
    lastVisitedAtByWorktreeId: lastVisited,
    // Mirrors the real action: clearing keeps activeRepoId, switching follows the new repo.
    setActiveWorktree: (id) => {
      useAppStore.setState((s) => ({
        activeWorktreeId: id,
        activeRepoId: id ? getRepoIdFromWorktreeId(id) : s.activeRepoId
      }))
      return true
    }
  })
}

describe('installHiddenProjectActiveWorkspaceGuard', () => {
  let stop: () => void = () => {}
  beforeEach(() => useAppStore.setState(initialState, true))
  afterEach(() => {
    stop()
    useAppStore.setState(initialState, true)
  })

  it('moves workspace and project selection to the last visible workspace on hide', () => {
    seed({ [visibleWt.id]: 5 })
    stop = installHiddenProjectActiveWorkspaceGuard()
    expect(useAppStore.getState().activeWorktreeId).toBe(hiddenWt.id)

    // The state change setRepoHidden makes (its IPC persist is out of scope here).
    useAppStore.setState({ hiddenRepoIds: ['secret'] })

    expect(useAppStore.getState().activeWorktreeId).toBe(visibleWt.id)
    expect(useAppStore.getState().activeRepoId).toBe('work')
  })

  it('clears both to Landing when no visible workspace was visited', () => {
    seed({})
    useAppStore.setState({ hiddenRepoIds: ['secret'] })
    stop = installHiddenProjectActiveWorkspaceGuard()

    expect(useAppStore.getState().activeWorktreeId).toBeNull()
    expect(useAppStore.getState().activeRepoId).toBeNull()
  })
})
