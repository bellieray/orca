import type { WorktreeLineage } from '../worktree/lineage-types'
import type { Worktree } from '../worktree/types'
import { getWorktreeHostIdentity } from '../worktree/host-qualified-identity'
import {
  filterWorkspaceRows,
  type WorkspaceRowFactReader,
  type WorkspaceRowFilters
} from '../workspace-view/workspace-row-filters'
import { getSidebarLineageParentsByIdentity } from './worktree-lineage-projection'

export type VisibleSidebarWorktreeInputs = {
  /** Every catalog row, one per host-qualified identity. */
  rows: readonly Worktree[]
  /** Non-archived rows by host identity, the lineage ancestors a visible child may pull in. */
  ancestorByIdentity: ReadonlyMap<string, Worktree>
  /** A row's place in the frozen sort order; unranked rows go last. */
  rankOf: (worktree: Worktree) => number | undefined
  filters: WorkspaceRowFilters
  facts: WorkspaceRowFactReader<Worktree>
  worktreeLineageById: Record<string, WorktreeLineage>
  filterRepoIds: readonly string[]
  /** Projects concealed from this desktop; unlike filterRepoIds they are never an active filter. */
  hiddenRepoIds?: readonly string[]
  injectLineageAncestors?: boolean
  preserveLineageParentOrder?: boolean
  forcedVisibleWorktreeIds?: readonly string[]
}

/** The sidebar's visible worktrees, in display order, before grouping. */
export function selectVisibleSidebarWorktrees({
  rows,
  ancestorByIdentity,
  rankOf,
  filters,
  facts,
  worktreeLineageById,
  filterRepoIds,
  hiddenRepoIds,
  injectLineageAncestors,
  preserveLineageParentOrder,
  forcedVisibleWorktreeIds
}: VisibleSidebarWorktreeInputs): Worktree[] {
  // Keep valid nonarchived ancestors despite ordinary filters so children retain their hierarchy.
  const selectedRepoIds = filterRepoIds.length > 0 ? new Set(filterRepoIds) : null

  const hiddenRepoIdSet = hiddenRepoIds && hiddenRepoIds.length > 0 ? new Set(hiddenRepoIds) : null
  const isInHiddenRepo = (worktree: Worktree): boolean =>
    hiddenRepoIdSet !== null && hiddenRepoIdSet.has(worktree.repoId)

  let all = filterWorkspaceRows(rows, filters, facts)
  if (hiddenRepoIdSet) {
    all = all.filter((worktree) => !isInHiddenRepo(worktree))
  }

  if (forcedVisibleWorktreeIds && forcedVisibleWorktreeIds.length > 0) {
    const includedIds = new Set(all.map((worktree) => worktree.id))
    for (const worktreeId of forcedVisibleWorktreeIds) {
      const worktree = includedIds.has(worktreeId)
        ? undefined
        : [...ancestorByIdentity.values()].find((candidate) => candidate.id === worktreeId)
      if (worktree && !isInHiddenRepo(worktree)) {
        includedIds.add(worktreeId)
        all.push(worktree)
      }
    }
  }

  // Append unranked/new rows until the next sortEpoch. Manual placement follows the parent, even if a hidden child ranks higher.
  if (injectLineageAncestors !== false && preserveLineageParentOrder) {
    all = addVisibleLineageAncestors(
      all,
      ancestorByIdentity,
      worktreeLineageById,
      selectedRepoIds,
      hiddenRepoIdSet
    )
  }
  all = all
    .map((worktree) => ({ worktree, rank: rankOf(worktree) ?? Infinity }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ worktree }) => worktree)

  return injectLineageAncestors === false || preserveLineageParentOrder
    ? all
    : addVisibleLineageAncestors(
        all,
        ancestorByIdentity,
        worktreeLineageById,
        selectedRepoIds,
        hiddenRepoIdSet
      )
}

function addVisibleLineageAncestors(
  worktrees: Worktree[],
  ancestorByIdentity: ReadonlyMap<string, Worktree>,
  lineageById: Record<string, WorktreeLineage>,
  selectedRepoIds: ReadonlySet<string> | null,
  hiddenRepoIds: ReadonlySet<string> | null
): Worktree[] {
  const result: Worktree[] = []
  const included = new Set<string>()
  // Use the same parent for ancestor injection and nesting.
  const parentByIdentity = getSidebarLineageParentsByIdentity(lineageById, ancestorByIdentity)

  const addWithAncestors = (worktree: Worktree): void => {
    const identity = getWorktreeHostIdentity(worktree)
    if (included.has(identity)) {
      return
    }
    const parent = parentByIdentity.get(identity)
    // Repository filters are hard boundaries; ordinary filters may retain ancestors.
    if (
      parent &&
      (!selectedRepoIds || selectedRepoIds.has(parent.repoId)) &&
      !hiddenRepoIds?.has(parent.repoId)
    ) {
      addWithAncestors(parent)
    }
    if (!included.has(identity)) {
      included.add(identity)
      result.push(worktree)
    }
  }

  for (const worktree of worktrees) {
    addWithAncestors(worktree)
  }
  return result
}

/** A feed view's project scope: its filter plus the projects concealed on this desktop (a phone sends none). */
export function getFeedRepoScope(view: {
  filters: { filterRepoIds: readonly string[]; hiddenRepoIds?: readonly string[] }
}): { filterRepoIds: readonly string[]; hiddenRepoIds?: readonly string[] } {
  return { filterRepoIds: view.filters.filterRepoIds, hiddenRepoIds: view.filters.hiddenRepoIds }
}
