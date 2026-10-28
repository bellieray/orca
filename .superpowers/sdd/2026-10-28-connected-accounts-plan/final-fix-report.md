# Final-review fix report — Connected Accounts

Range: `108da1646f5..f4c0f6da195` (6 commits; f4c0f6d aligns async/call-shape tests found by gate run 1). Gate results at the bottom.

## 1. Native chat + commit/PR text generation ignored bindings — FIXED (5abea6c)

Verified true: `resolveClaudeStructuredLaunchHome` called `router.prepareLaunch()` with no override, and `prepareLocalCommitMessageAgentEnv` called `prepareForClaudeLaunch(target)` with none.

- New `src/main/connected-accounts/connected-accounts-agent-launch.ts`: `resolveConnectedAccountsAgentLaunch` wraps `resolveConnectedAccountsSpawnEnv`, adds the bound-folder check and throws `formatConnectedAccountsLaunchError` on any unresolved binding. The PTY preflight (`spawn-connected-accounts.ts`) now reuses its folder-missing helpers.
- Native chat: `structured-agent-launch-composition.ts` has a new `resolveConnectedAccounts` source and a `basis.connectedAccounts()`. It resolves once, before the agent part (so it refuses pre-spawn), and merges the bound env for **every** structured agent (Claude, Codex, ACP, pi). The Claude part passes the override to `router.prepareLaunch(override)`. It is wired from `workspace-process-listing.ts` through `src/main/runtime/structured-agent-connected-accounts.ts`, which looks up the repo from the record's `workspaceId`; floating and folder IDs get no binding, and `wslDistro` is treated as the wsl runtime. The refusal is an `AgentSessionPreSpawnError`.
- Text generation: `prepareLocalCommitMessageAgentEnv(agent, resolvers, target, connectedAccounts?)` resolves bindings on its own base env and refuses with the binding text. Claude runs on the bound account, a missing folder maps to the refusal text, and the bound env is merged last. The three resolver wiring sites now forward the override: `main-window-core-services.ts`, `main-process-runtime-service.ts`, and orcad, which already did.
- Covered callers: IPC commit and PR generation, runtime commit and PR generation (`connectedAccountsLaunchForTarget`), first-work branch rename, and structured chat naming.
- Not covered: they run no project work, or have no project. They stay on the machine account.
  - Model discovery (IPC/runtime `discover…Models`): only lists models.
  - Jira issue summary: no repo.
  - Folder workspace title rename: folder workspaces have no binding.
  - Claude/Codex at-rest command and model-catalog probes, and rate-limit fetch: account-level probes.
- Known gap: the native-chat UI shows the generic "stopped before it finished starting" text for a binding refusal, and the full refusal text goes to the log. A dedicated refusal reason needs a new wire reason plus copy in every locale, which I left as a follow-up. A missing bound Claude folder still shows the existing `claudeAccountFolderMissing` copy, because the router throws it.
- Tests:
  - `structured-agent-connected-accounts.test.ts`: bound env reaches Codex chat; an unresolved binding refuses before the part runs; a removed Claude account is refused pre-spawn; a WSL chat is refused; floating has no binding; the launch home follows the override.
  - `commit-message-agent-environment.test.ts` › "with Connected Accounts" (3 cases).

## 2. gh bound, no commit author → machine identity — FIXED (e003e7e)

Verified true. `resolveGhSpawnEnv` returns an unresolved `git` entry with the fix "Set the commit author in Connected Accounts" when the author is missing or blank, and blocks the gh/git env. Nothing is filled in automatically. Because `resolveGhSpawnEnv` feeds the PTY spawn and Orca's git options, this refuses agents, warns terminals and blocks Orca commit/push. Test: `connected-accounts-git-env.test.ts` › "a bound account without a commit author is unresolved…" (missing and blank).

## 3. Firebase is env-blockable — FIXED (a4e1a84)

Verified in installed firebase-tools 15.34.1 (`lib/requireAuth.js`: FIREBASE_TOKEN is checked before the user; `lib/mcp/index.js:217` calls requireAuth).

- Every unresolved Firebase branch sets `FIREBASE_TOKEN=orca-connected-accounts-unresolved`: not in a worktree, not logged in, no firebase.json, and configstore write failure.
- A resolved binding sets `FIREBASE_TOKEN=''`, so an inherited token cannot override the per-directory account.
- The "no env to set" comment is gone. The spec has no Known-limits entry and the UI copy no such caveat, so nothing else needed removing. The terminal warning line now describes a blocked tool.
- Tests: `connected-accounts-spawn-env.test.ts` › "an unresolved Firebase binding blocks firebase-tools with a sentinel token" and "a resolved Firebase binding clears an inherited FIREBASE_TOKEN".

## 4. WSL runtime loses bindings silently — FIXED (a4e1a84 main, cb79f7d UI)

Verified true.

- New `connectedAccountsRepoScope` returns `'local' | 'wsl' | null`; SSH, runtime-host and folder repos still return null, so they keep EMPTY.
- A bound repo on a WSL path or runtime gets one unresolved entry per bound tool, with the fix "Set this project to Default (machine) accounts in Connected Accounts". Its env stays empty, because no WSLENV forwarding exists.
- Git options: `wslDistro` or a WSL path with gh bound returns unresolved, so push/commit throw.
- UI: the new `connected-accounts-blocked-reason.ts` also blocks when the project runtime resolves to WSL or is repair-required (which always prefers WSL), using a boolean store selector. A blocked project with bindings gets a "Clear account bindings" button (en+tr). Without it, a refused project could never drop its bindings, because the pickers are disabled. GitHub can be cleared in its own section.
- Caveat: background fetches on WSL cannot be env-blocked (no env reaches git in the guest), so they keep the guest default and log one warning. Push, commit and agents refuse.
- Tests: spawn-env "a bound project on a WSL runtime or WSL path is unresolved…"; git-options "push/commit on a WSL runtime refuses…"; `connected-accounts-blocked-reason.test.ts`.

## 5. Unbound network fetches — FIXED (00351781)

Partly false as written. On the IPC push path, the reviewer's `worktree-remote.ts:756` already got the bound env: sync and branch-mutation handlers pass the `...WithConnectedAccounts` options, and `{cwd, ...gitOptions}` spreads `env`.

- The real unbound callers were `runtime-git-sync-commands.ts` (plain `localGitOptionsForTarget`) and `runtime-terminal-spawn-push-target-materialization.ts`. Both now pass the bound or blocked env, and the materialize option type declares `env`.
- At `:1112`, only the no-runtime branch was plain. The runtime branch already used the fetch-env resolver. That branch now uses `resolveConnectedAccountsFetchEnv`.
- No new unit test: the env path is the one item 6's tests cover.

## 6. Background fetch fell back to the machine default — FIXED (a4e1a84)

An unresolved binding now returns the full env (process env + `buildBlockedGhEnvPatch`), so git still has PATH. The resolver-throw path also blocks when gh is bound. One log line remains, with new text. Tests: git-options "blocks the fetch (not the machine account)…" and "PR head fetch uses the bound env, and a blocked env…".

## 7. Repo lookup by path misses worktrees with no meta — real, FIXED (5abea6c)

Reproduced: the test failed before the fix.

- `getLocalRepoForWorktreeWithBindings` falls back to `git rev-parse --git-common-dir` and matches `<common>` or its parent against `repo.path`, with realpath. It runs only when the direct lookup misses and some repo has bindings.
- Used by `...WithConnectedAccounts`, the fetch-env-for-path resolver and the text-generation resolver.
- Tests: `local-worktree-runtime-options.test.ts` › "a bound repo still applies to a worktree with no meta row…" and "skips the common-dir lookup when no repo has a binding".

## Minors — all FIXED

- Firebase text dedupe: the reason is now "it is not logged in to firebase-tools" (a4e1a84).
- Reserved extra-env keys: added `FIREBASE_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`, `XDG_CONFIG_HOME` and the `ANTHROPIC_` prefix. `CLAUDE_CONFIG_DIR` was already covered by `CLAUDE_`. The check lives in the shared normalize, so the UI hint follows; it is case-insensitive on win32 (cb79f7d, normalize test).
- Stale-sessions banner: en, tr and the runtime catalog are updated (cb79f7d).
- Daemon env-merge test: added a case with a non-empty inherited `GIT_CONFIG_*` (cb79f7d).

## Gate

- `pnpm tc`: exit 0.
- `pnpm check:changed --maxWorkers=2` (run 2, on f4c0f6d): 27/28 checks pass. Ratchet and localization checks are green. The unit-test failures are only the known pre-existing ones: session-search-indexer, persisted-profile-state (2), runtime-failed-local-worktree-removal, zsh-deferred-startup-line-init.live-shell (2).
- Run 1 also caught 5 test regressions caused by this branch: 3 push-target materialization tests that are now async, the naming target 4th argument, and the model-discovery unbound prepare call shape. All are fixed in f4c0f6d.
