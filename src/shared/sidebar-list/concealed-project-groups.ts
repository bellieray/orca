type GroupNode = { id: string; parentGroupId: string | null }

/** Drop project groups whose projects are all concealed so their names do not leak; groups with no projects or with folder workspaces stay. */
export function withoutConcealedProjectGroups<G extends GroupNode>(
  projectGroups: readonly G[],
  scope: {
    repos: readonly { id: string; projectGroupId?: string | null }[]
    folderWorkspaces: readonly { projectGroupId: string }[]
    hiddenRepoIds: readonly string[] | undefined
  }
): readonly G[] {
  const { repos, folderWorkspaces, hiddenRepoIds } = scope
  if (!hiddenRepoIds || hiddenRepoIds.length === 0) {
    return projectGroups
  }
  const hidden = new Set(hiddenRepoIds)
  const groupIds = new Set(projectGroups.map((group) => group.id))
  const childIdsByParentId = new Map<string, string[]>()
  for (const group of projectGroups) {
    if (group.parentGroupId && groupIds.has(group.parentGroupId)) {
      const children = childIdsByParentId.get(group.parentGroupId) ?? []
      children.push(group.id)
      childIdsByParentId.set(group.parentGroupId, children)
    }
  }
  const tallyByGroupId = new Map<string, { repos: number; shown: number }>()
  const tallyOf = (groupId: string) => {
    let tally = tallyByGroupId.get(groupId)
    if (!tally) {
      tally = { repos: 0, shown: 0 }
      tallyByGroupId.set(groupId, tally)
    }
    return tally
  }
  for (const repo of repos) {
    if (repo.projectGroupId && groupIds.has(repo.projectGroupId)) {
      const tally = tallyOf(repo.projectGroupId)
      tally.repos += 1
      tally.shown += hidden.has(repo.id) ? 0 : 1
    }
  }
  for (const folderWorkspace of folderWorkspaces) {
    if (groupIds.has(folderWorkspace.projectGroupId)) {
      tallyOf(folderWorkspace.projectGroupId).shown += 1
    }
  }

  const concealed = new Set<string>()
  const visit = (groupId: string, seen: Set<string>): { repos: number; shown: number } => {
    const total = { ...tallyOf(groupId) }
    for (const childId of childIdsByParentId.get(groupId) ?? []) {
      if (seen.has(childId)) {
        continue
      }
      seen.add(childId)
      const child = visit(childId, seen)
      total.repos += child.repos
      total.shown += child.shown
    }
    if (total.repos > 0 && total.shown === 0) {
      concealed.add(groupId)
    }
    return total
  }
  for (const group of projectGroups) {
    if (!group.parentGroupId || !groupIds.has(group.parentGroupId)) {
      visit(group.id, new Set([group.id]))
    }
  }
  if (concealed.size === 0) {
    return projectGroups
  }
  // A concealed group's whole subtree goes: its children hold no shown project either.
  const isUnderConcealed = (group: G): boolean => {
    const seen = new Set<string>()
    let current: string | null = group.id
    while (current && !seen.has(current)) {
      if (concealed.has(current)) {
        return true
      }
      seen.add(current)
      current = projectGroups.find((candidate) => candidate.id === current)?.parentGroupId ?? null
    }
    return false
  }
  return projectGroups.filter((group) => !isUnderConcealed(group))
}
