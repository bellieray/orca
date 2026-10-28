import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../../../shared/worktree/types'
import { pickConcealedActiveWorkspaceFallback } from './hidden-project-active-workspace-guard'

const wt = (id: string, repoId: string, isArchived = false): Worktree =>
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fallback reads only id, repoId and isArchived.
  ({ id, repoId, isArchived }) as unknown as Worktree

const base: Parameters<typeof pickConcealedActiveWorkspaceFallback>[0] = {
  activeWorktreeId: 'secret::/w/a',
  hiddenRepoIds: ['secret'],
  revealHiddenRepos: false,
  persistedUIReady: true,
  lastVisitedAtByWorktreeId: { 'work::/w/old': 10, 'work::/w/new': 20, 'secret::/w/b': 99 }
}
const visible = [
  wt('work::/w/old', 'work'),
  wt('work::/w/new', 'work'),
  wt('secret::/w/b', 'secret')
]

describe('pickConcealedActiveWorkspaceFallback', () => {
  it('switches to the most recently visited visible workspace', () => {
    const result = pickConcealedActiveWorkspaceFallback(base, visible)
    expect(result).toEqual({ kind: 'switch', worktree: visible[1] })
  })

  it('falls back to Landing when no visible workspace was visited', () => {
    expect(pickConcealedActiveWorkspaceFallback(base, [wt('work::/w/x', 'work')])).toEqual({
      kind: 'clear'
    })
  })

  it('keeps the active workspace while hidden projects are revealed', () => {
    expect(
      pickConcealedActiveWorkspaceFallback({ ...base, revealHiddenRepos: true }, visible)
    ).toEqual({
      kind: 'keep'
    })
  })

  it('keeps a visible active workspace and waits for persisted UI state', () => {
    expect(
      pickConcealedActiveWorkspaceFallback({ ...base, activeWorktreeId: 'work::/w/new' }, visible)
    ).toEqual({ kind: 'keep' })
    expect(
      pickConcealedActiveWorkspaceFallback({ ...base, persistedUIReady: false }, visible)
    ).toEqual({ kind: 'keep' })
  })
})
