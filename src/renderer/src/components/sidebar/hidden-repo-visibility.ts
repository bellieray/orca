import type { AppState } from '@/store/types'

type HiddenRepoState = Pick<AppState, 'hiddenRepoIds' | 'revealHiddenRepos'>

const NO_REPO_IDS: readonly string[] = []

/** The projects the sidebar, Agents view and palette leave out right now; none while revealed. */
export function selectConcealedRepoIds(state: HiddenRepoState): readonly string[] {
  return state.revealHiddenRepos ? NO_REPO_IDS : state.hiddenRepoIds
}

/** Drop concealed projects from header, placeholder and external-card candidates. */
export function withoutConcealedRepos<T extends { id: string }>(
  repos: readonly T[],
  concealedRepoIds: readonly string[] | undefined
): readonly T[] {
  if (!concealedRepoIds || concealedRepoIds.length === 0) {
    return repos
  }
  return repos.filter((repo) => !concealedRepoIds.includes(repo.id))
}

/** The hidden projects currently rendered dimmed; none while concealed. */
export function selectDimmedRepoIds(state: HiddenRepoState): readonly string[] {
  return state.revealHiddenRepos ? state.hiddenRepoIds : NO_REPO_IDS
}

/** Repos a default target may pick right now: every repo except concealed ones. */
export function selectUnconcealedActiveRepoId(
  state: HiddenRepoState & Pick<AppState, 'activeRepoId'>
): string | null {
  const id = state.activeRepoId
  return id && selectConcealedRepoIds(state).includes(id) ? null : id
}

export function selectUnconcealedRepos(state: HiddenRepoState & Pick<AppState, 'repos'>) {
  return withoutConcealedRepos(state.repos, selectConcealedRepoIds(state))
}
