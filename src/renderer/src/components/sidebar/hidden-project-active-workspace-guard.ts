import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { getIndexedRepoMap } from '@/store/worktree-repo-index'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import { getPaletteWorktreeExecutionHostId } from '@/lib/palette-repo-resolution'
import { getWorktreeVisitTimestamp } from '@/lib/worktree-visit-recency'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'
import type { Worktree } from '../../../../shared/worktree/types'
import { computeVisibleWorktrees } from './compute-visible-worktrees'
import { selectConcealedRepoIds } from './hidden-repo-visibility'
import { buildVisibleWorktreeOptionsFromState } from './visible-worktree-options-from-state'

export type ConcealedActiveWorkspaceFallback =
  | { kind: 'keep' }
  | { kind: 'switch'; worktree: Worktree }
  | { kind: 'clear' }

type GuardState = Pick<
  AppState,
  | 'activeWorktreeId'
  | 'hiddenRepoIds'
  | 'revealHiddenRepos'
  | 'persistedUIReady'
  | 'lastVisitedAtByWorktreeId'
>

export function isActiveWorkspaceConcealed(state: GuardState): boolean {
  const activeId = state.activeWorktreeId
  if (!activeId || activeId.startsWith('folder:')) {
    return false
  }
  const concealed = selectConcealedRepoIds(state)
  return concealed.length > 0 && concealed.includes(getRepoIdFromWorktreeId(activeId))
}

/** Office privacy: a concealed project's workspace must not stay on screen; move to the most recently visited visible workspace, else to Landing. */
export function pickConcealedActiveWorkspaceFallback(
  state: GuardState,
  visibleWorktrees: readonly Worktree[]
): ConcealedActiveWorkspaceFallback {
  // Not gated on workspaceSessionReady: terminal reconnect flips it late, and the restored workspace would paint meanwhile.
  if (!state.persistedUIReady) {
    return { kind: 'keep' }
  }
  if (!isActiveWorkspaceConcealed(state)) {
    return { kind: 'keep' }
  }
  const concealed = selectConcealedRepoIds(state)
  let best: Worktree | null = null
  let bestVisitedAt = 0
  for (const worktree of visibleWorktrees) {
    const visitedAt = getWorktreeVisitTimestamp(state.lastVisitedAtByWorktreeId, worktree) ?? 0
    if (
      visitedAt > bestVisitedAt &&
      worktree.id !== state.activeWorktreeId &&
      !worktree.isArchived &&
      !concealed.includes(worktree.repoId)
    ) {
      best = worktree
      bestVisitedAt = visitedAt
    }
  }
  return best ? { kind: 'switch', worktree: best } : { kind: 'clear' }
}

function navigateAwayFromConcealedWorkspace(state: AppState): void {
  if (!isActiveWorkspaceConcealed(state)) {
    return
  }
  const worktreesByRepo = selectWorktreesByRepo(state)
  const ids = Object.values(worktreesByRepo)
    .flat()
    .map((worktree) => worktree.id)
  const visible = computeVisibleWorktrees(
    worktreesByRepo,
    ids,
    buildVisibleWorktreeOptionsFromState(state, getIndexedRepoMap(state.repos))
  )
  const fallback = pickConcealedActiveWorkspaceFallback(state, visible)
  if (fallback.kind === 'switch') {
    // Navigation only: the hidden workspace's terminals keep running.
    if (
      state.setActiveWorktree(
        fallback.worktree.id,
        getPaletteWorktreeExecutionHostId(fallback.worktree)
      )
    ) {
      return
    }
  }
  if (fallback.kind !== 'keep') {
    state.setActiveWorktree(null)
  }
}

/** Runs on hide, on reveal-off and as soon as persisted UI state (hidden list + restored selection) is ready at startup. */
export function installHiddenProjectActiveWorkspaceGuard(): () => void {
  navigateAwayFromConcealedWorkspace(useAppStore.getState())
  return useAppStore.subscribe((state, previous) => {
    if (
      state.activeWorktreeId === previous.activeWorktreeId &&
      state.hiddenRepoIds === previous.hiddenRepoIds &&
      state.revealHiddenRepos === previous.revealHiddenRepos &&
      state.persistedUIReady === previous.persistedUIReady
    ) {
      return
    }
    navigateAwayFromConcealedWorkspace(state)
  })
}

export function useHiddenProjectActiveWorkspaceGuard(): void {
  useEffect(() => installHiddenProjectActiveWorkspaceGuard(), [])
}
