# Hide projects from the sidebar

## Why

Owner works at an office and on personal projects in the same Orca. Coworkers glancing at the screen must not see personal projects. Hiding is a privacy screen on this desktop only.

## Behaviour (approved by owner)

1. Each project (Repo) header menu in the left sidebar gets "Hide project" / "Show project".
2. A hidden project and all its workspaces disappear from: the sidebar list (incl. empty-project placeholder headers), the Agents sidebar view, and the Cmd+J palette.
3. An eye icon button in the sidebar header row (next to the Bell button, `SidebarHeader.tsx`) toggles "reveal hidden projects". While revealed, hidden projects render in place but dimmed (opacity token from styleguide), and their header menu shows "Show project" which permanently unhides. Reveal is session UI state (not persisted) — app restart starts concealed. The icon only renders when at least one project is hidden.
4. Notifications from hidden projects: no desktop banner, no sound, not counted in the dock badge. **Phone (mobile push) keeps working unchanged.**
5. Unread markers are still written for hidden-project workspaces. The "Projects" header title shows a count badge (reuse `icon-superscript-count` / `options-filter-count-badge` style) = number of unread workspaces in hidden projects. The badge also shows while revealed; it drops as the user reads those workspaces.
6. Persistence: `hiddenRepoIds: string[]` in `PersistedUIState` (per-client UI state, like `filterRepoIds`). Not on `Repo`, not synced to other devices/mobile.

## Non-goals

- No change to mobile app, remote runtime hosts, or what the phone receives.
- Folder workspaces (they belong to project groups, not repos) are out of scope for v1; note it.
- No password/lock.

## Implementation map (facts from recon)

- Persisted UI: `src/shared/persisted-ui-state-types.ts` (add field), defaults `src/shared/constants.ts:~201`, writer `src/renderer/src/app-shell/use-persisted-ui-writer.ts:~146`, hydration `src/renderer/src/store/slices/ui/ui-slice-hydration-actions.ts:~89/152` (sanitize like `filterRepoIds`), write baseline `src/renderer/src/store/slices/persisted-ui-write-baseline.ts`. Also prune ids on repo removal (`src/renderer/src/store/repos/repo-removal.ts`, `src/main/persistence/loading-store/repo-lifecycle-ui-residue.ts`) the same way `filterRepoIds` is pruned. Check orcad migration client-state parsing for field allowlists.
- Store actions: next to `setFilterRepoIds` in `src/renderer/src/store/slices/ui/ui-slice-preference-actions.ts`: `setRepoHidden(repoId, hidden)`, plus non-persisted `revealHiddenRepos: boolean` + `setRevealHiddenRepos`.
- Row filtering: `src/shared/workspace-view/workspace-row-filters.ts` (`WorkspaceRowFilters`, predicate at ~:91-114). Prefer adding a `hiddenRepoIds` exclusion here so every consumer (sidebar, kanban, mute logic, lineage) gets it; make sure it is NOT counted as an "active filter" (`activeWorkspaceRowFilterKeys`, `sidebarHasActiveFilters`) and that reveal mode passes an empty list. Lineage ancestor injection (`src/shared/sidebar-list/visible-worktrees.ts`) must not pull hidden-repo ancestors back in.
- Project headers: `src/shared/sidebar-list/empty-project-placeholder-repos.ts`, `project-group-sections.ts`, `row-builders.ts` — skip hidden repos unless revealed; when revealed mark rows so `worktree-list/rows/SectionHeader.tsx` can dim them.
- Menu: `src/renderer/src/components/sidebar/worktree-list/rows/repo-header-project-actions.tsx` (items ~:132-180), handlers via `ctx.projectActions`.
- Header: `src/renderer/src/components/sidebar/SidebarHeader.tsx` (title :48-80, Bell :84-134).
- Agents view + Cmd+J: `src/renderer/src/components/activity/activity-scope-filter.ts`, `src/renderer/src/components/cmd-j/palette-filter.ts`.
- Desktop suppression keeping push: `src/main/notifications/notification-delivery-service.ts` already fans out to mobile before the `hostMuted` early return. Add `desktopSuppressed?: boolean` to `NotificationDispatchRequest` (`src/shared/notification-settings-types.ts`) and treat it like `hostMuted` (new result reason e.g. `'hidden-project'`; also skip tray attention). Set it in the renderer choke point `src/renderer/src/attention/agent-attention-notification-delivery.ts` (resolve worktreeId -> repoId from store; worktree id embeds repoId) — callers: `components/terminal-pane/use-notification-dispatch.ts:168`, `components/native-chat/structured-attention-dispatch.ts:105`. Sound is played only when `result.delivered`, so it follows.
- Do NOT route hidden repos through `isWorkspaceNotificationMutedBySidebarFilters` — that mute drops unread + push too.
- Dock badge: `src/renderer/src/lib/unread-badge-count-selector.ts` / `unread-badge-count.ts` — exclude hidden-repo workspaces (add `hiddenRepoIds` to the picked state + cache key).
- Projects badge count: new selector beside the dock one, counting unread worktrees in hidden repos.
- i18n: add strings via the repo's i18n system (`src/renderer/src/i18n`), English plus any locales the repo requires.

## Done when

- `pnpm tc` and `pnpm test` for touched areas pass; `pnpm check:changed --maxWorkers=2` passes.
- Focused unit tests: row filter excludes hidden repos and is not an active filter; delivery service suppresses desktop but still dispatches mobile when `desktopSuppressed`; dock count excludes hidden; projects badge counts hidden unread.
- Committed on branch `feat/hide-projects`.
