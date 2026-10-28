import { describe, expect, it } from 'vitest'
import { withoutConcealedProjectGroups } from './concealed-project-groups'

const group = (id: string, parentGroupId: string | null = null) => ({ id, parentGroupId })

describe('withoutConcealedProjectGroups', () => {
  const groups = [group('work'), group('personal'), group('side', 'personal'), group('empty')]
  const repos = [
    { id: 'office', projectGroupId: 'work' },
    { id: 'secret-a', projectGroupId: 'personal' },
    { id: 'secret-b', projectGroupId: 'side' },
    { id: 'loose', projectGroupId: null }
  ]

  it('drops a group subtree whose projects are all hidden and keeps the rest', () => {
    expect(
      withoutConcealedProjectGroups(groups, {
        repos,
        folderWorkspaces: [],
        hiddenRepoIds: ['secret-a', 'secret-b']
      }).map((g) => g.id)
    ).toEqual(['work', 'empty'])
  })

  it('keeps a group while any project in its subtree is still shown', () => {
    expect(
      withoutConcealedProjectGroups(groups, {
        repos,
        folderWorkspaces: [],
        hiddenRepoIds: ['secret-a']
      }).map((g) => g.id)
    ).toEqual(['work', 'personal', 'side', 'empty'])
  })

  it('keeps a group that holds folder workspaces', () => {
    expect(
      withoutConcealedProjectGroups(groups, {
        repos,
        folderWorkspaces: [{ projectGroupId: 'side' }],
        hiddenRepoIds: ['secret-a', 'secret-b']
      }).map((g) => g.id)
    ).toEqual(['work', 'personal', 'side', 'empty'])
  })

  it('returns the input untouched when nothing is hidden', () => {
    expect(
      withoutConcealedProjectGroups(groups, { repos, folderWorkspaces: [], hiddenRepoIds: [] })
    ).toBe(groups)
  })
})
