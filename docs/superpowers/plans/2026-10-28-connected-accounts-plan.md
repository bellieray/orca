# Connected Accounts per Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin Claude, GitHub (gh + git), Firebase, AdMob and extra env vars per project, so every agent and terminal Orca starts in that project runs as the chosen accounts, and fails loudly instead of falling back to the machine default.

**Architecture:** A non-secret binding lives on `Repo.connectedAccounts` (next to the existing `Repo.ghAccount`). AdMob profiles live in global settings. At PTY spawn, one shared resolver `resolveConnectedAccountsSpawnEnv` runs in both spawn preflights. It turns the binding into an env patch: a per-repo Claude pointer file, `GH_TOKEN` plus git credential/author env, a per-directory firebase-tools active account, AdMob env, and extra env. It also returns the list of bindings it could not resolve. An agent launch with an unresolved binding is refused. A plain terminal opens with a warning, and the broken tool's env is left unset or blocked. Orca's own git push/pull/fetch/commit calls use the same git env builder.

**Tech Stack:** Electron main/preload/renderer, TypeScript, zod (rpc contract), React + shadcn primitives, vitest, i18next catalogs.

**Spec:** `docs/superpowers/specs/2026-10-28-connected-accounts-design.md`

**Branch base:** another agent is editing sidebar and notification files on `feat/hide-projects`. Start this work from `main` after that branch lands, or rebase onto it before Task 9. Task 9 touches `repo-header-project-actions.tsx` and `SectionHeader.tsx`.

## Recon findings the tasks rely on

- **Firebase (firebase-tools 15.34.1, checked in the local npx cache; the plugin runs `firebase-tools@latest`, so re-check on upgrade):**
  - There is no per-process account mechanism that `firebase mcp` honours. The MCP builds fresh options `{cwd: projectDir, isMCP: true}` in `resolveOptions()`. `command.prepare` reads `getInheritedOption(options, "account")`, which is always undefined there, so the global `--account` flag never reaches the MCP's auth.
  - `FIREBASE_TOKEN`/`--token` and `GOOGLE_APPLICATION_CREDENTIALS` only apply when there is no configstore user, and both are copied tokens, which the spec forbids.
  - Account resolution is `selectAccount(undefined, projectRoot)` → `activeAccounts[projectRoot] ?? global user`. `projectRoot` = `detectProjectRoot`, which walks **up** from `cwd` (stored MCP client root ‖ `PROJECT_ROOT` ‖ `process.cwd()`) to the first dir containing `firebase.json`. If none is found, it uses the global default.
  - Configstore path: `${XDG_CONFIG_HOME || ~/.config}/configstore/firebase-tools.json` on every OS. Keys: `user` + `tokens` (the global default), `additionalAccounts: [{user:{email}, tokens}]`, `activeAccounts: {[absDir]: email}`.
  - ⇒ This plan takes the spec's fallback path: write `activeAccounts[<firebase project root>]` per worktree, plus a "Bind Firebase to this project" button that writes `firebase.json` (`{}`) at the worktree root.
- **AdMob MCP env precedence:**
  - The Claude Code MCP docs (code.claude.com/docs/en/mcp) do not say whether a server's config `env` overrides inherited process env. The only merge rule they document is about scopes: "fields are not merged across scopes".
  - The user's `~/.claude.json` defines `admob` with hardcoded `CREDENTIALS_DIR` and `PUBLISHER_CODE`. Treat config `env` as winning.
  - The docs do document `${VAR:-default}` expansion inside `env`, including for user-scoped entries. So the fix shown in the UI is to change each value to `"${CREDENTIALS_DIR:-<old value>}"` / `"${PUBLISHER_CODE:-<old value>}"`. That works whichever way precedence goes. Task 10 step 3 checks it on a real launch.
- **Claude routing:** the `claude` shell functions (`src/shared/claude-shell-function.ts`) already re-read whatever file `ORCA_CLAUDE_PROFILE_POINTER` names. A per-repo pointer file therefore needs **no shell-function change**.
- **Spawn:** `resolvePtySpawnHostEnv` returns early for non-daemon spawns, so `buildPtyHostEnv` never sees `LocalPtyProvider` spawns. The injection point is the preflight, next to `withClaudeProfileTerminalEnv`. That call appears in `src/main/ipc/pty/ipc/spawn-preflight.ts:103` and `src/main/ipc/pty/runtime/spawn-preflight.ts:88`.
- **Daemon git config:** `src/main/daemon/pty-subprocess/spawn-environment.ts:54` appends indexed `GIT_CONFIG_*` guard entries after merging env. The credential entries must survive that append (Task 4 test).

## Global Constraints

- Orca stores **which account**, never tokens. "No tokens in persisted state or logs."
- "A bound project silently falls back to the global account" is a failure. An agent launch with an unresolved binding is refused, "with a clear error naming the account and the fix command". A plain terminal "still opens with a visible warning banner, and the broken binding's env is left unset". Restored sessions behave like plain terminals.
- Never write global tool config. Never run `firebase login:use` in a directory without `firebase.json`. Never copy firebase-tools' token store. Orca never edits MCP config files.
- Bindings apply "at PTY/agent spawn only. Already-running processes are not changed."
- Scope:
  - Local and daemon-local launches only.
  - SSH/remote repos and folder workspaces get the default.
  - WSL-runtime repos get the pickers disabled with a note, because skipping them at spawn would be a silent fallback.
  - No per-worktree overrides, no mobile UI, no Codex.
- New `Repo` fields are optional (mixed client/server versions). Every new repo field goes through all four whitelists: `repo-update-handler.ts`, `repo-update-params.ts`, `repo-sanitization.ts`, `repo-hydration.ts`.
- Extra env vars are non-secret in v1. The UI copy is: "don't put secrets here: stored in plain settings and synced".
- Cross-platform: no macOS-only paths in the env layer. Resolve the firebase configstore path through `XDG_CONFIG_HOME`/`os.homedir()`. Compare env keys case-insensitively on Windows.
- Git HTTPS pinning needs Git ≥ 2.31 (`GIT_CONFIG_COUNT`). On older git the GitHub binding counts as unresolvable, never silently skipped.
- Naming: every new file, IPC channel, i18n key and settings key carries `connected-accounts` / `connectedAccounts` (greppable). No `utils`/`helpers` names. Comments are one line and explain why.
- UI follows `docs/STYLEGUIDE.md` tokens and `components/ui/*` primitives.
- Each commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Qw6xjFiLLPNREeduKTH6sL
  ```

## Review Focus

1. **Worktree without `firebase.json`, or with it only in a subdirectory:**
   - `detectProjectRoot` finds no root, or a parent root, and the MCP silently uses the global account.
   - Expected: the binding counts as unresolvable for that worktree, and the agent launch is refused with "Bind Firebase to this project" as the fix. The `activeAccounts` key is the exact dir firebase-tools would detect, written per worktree path. Test in Task 5.
2. **gh user logged out after binding:**
   - Expected: the agent launch is refused, naming `user@host` and `gh auth login --hostname <host>`.
   - The terminal opens with a warning. `GH_TOKEN` is set to the block sentinel and ambient `GH_TOKEN` is stripped. Git gets no credential helper override and no fallback to the keychain account.
   - Test in Task 6.
3. **Git < 2.31 or daemon index collision:**
   - Expected: on old git the HTTPS override is reported unresolvable.
   - Through the daemon, the credential entries are still present after `spawn-environment.ts` appends its guard entries.
   - Test in Task 4.
4. **Extra env key colliding with reserved keys** (`ORCA_*`, `CLAUDE_CONFIG_DIR`, `GH_*`, `GIT_*`, `PATH`/`Path`, `CREDENTIALS_DIR`/`PUBLISHER_CODE` when an AdMob profile is bound), or an invalid env name:
   - Expected: the save is rejected with a per-row error, and resolution drops it defensively.
   - Test in Task 2.
5. **Token leakage:**
   - Expected: `GH_TOKEN` never lands in persisted session/terminal records, logs or the stale-binding fingerprint.
   - The firebase configstore rewrite preserves `tokens` byte-for-byte and never logs file contents.
   - Test in Tasks 5 and 6.

---

### Task 1: Binding data model and persistence

**Files:**
- Create: `src/shared/connected-accounts/connected-accounts-types.ts`
- Create: `src/shared/connected-accounts/connected-accounts-normalize.ts`
- Test: `src/shared/connected-accounts/connected-accounts-normalize.test.ts`
- Modify: `src/shared/repo-types.ts` (after `ghAccount`, ~line 66)
- Modify: `src/shared/global-settings-types.ts` (next to `claudeManagedAccounts`, ~line 306), `src/shared/default-global-settings.ts:184`
- Modify: `src/main/ipc/repos/repo-update-handler.ts` (Pick list ~35-60, normalization next to the `ghAccount` block ~92)
- Modify: `src/shared/rpc-contract/repo-update-params.ts` (~40-83)
- Modify: `src/main/persistence/tracking-repos/repo-sanitization.ts` (~83, ~151), `repo-hydration.ts` (~37-75), `repo-update-operations.ts` (~120, ~189: null clears)
- Test: extend `src/main/persistence/tracking-repos/` existing repo-update/hydration tests (the ones that cover `ghAccount`)

**Interfaces:**
- Produces:
  ```ts
  export type ConnectedAccountsGitAuthor = { name: string; email: string }
  export type ConnectedAccountsExtraEnvEntry = { key: string; value: string }
  export type RepoConnectedAccounts = {
    claudeAccountId?: string          // ClaudeManagedAccount.id
    firebaseEmail?: string
    admobProfileId?: string           // ConnectedAccountsAdmobProfile.id
    gitAuthor?: ConnectedAccountsGitAuthor   // used only when Repo.ghAccount is set
    extraEnv?: ConnectedAccountsExtraEnvEntry[]
  }
  export type ConnectedAccountsAdmobProfile = { id: string; name: string; credentialsDir: string; publisherCode: string }
  export function normalizeRepoConnectedAccounts(value: unknown): RepoConnectedAccounts | null   // null = empty/malformed
  export function normalizeConnectedAccountsAdmobProfiles(value: unknown): ConnectedAccountsAdmobProfile[]
  export function isValidConnectedAccountsEnvKey(key: string): boolean  // /^[A-Za-z_][A-Za-z0-9_]*$/
  export function isReservedConnectedAccountsEnvKey(key: string, platform: NodeJS.Platform): boolean
  ```
  - `Repo.connectedAccounts?: RepoConnectedAccounts`
  - `GlobalSettings.connectedAccountsAdmobProfiles: ConnectedAccountsAdmobProfile[]` (default `[]`)
  - Reserved: prefixes `ORCA_`, `GH_`, `GIT_`, `CLAUDE_`; exact `PATH`, `HOME`, `CREDENTIALS_DIR`, `PUBLISHER_CODE`, `GITHUB_TOKEN`. Comparison is case-insensitive on `win32`.

- [ ] **Step 1: Write failing tests** in `connected-accounts-normalize.test.ts`:
  - `drops extra env entries with invalid or reserved keys`: input `[{key:'FOO',value:'1'},{key:'1BAD',value:'x'},{key:'GH_TOKEN',value:'x'},{key:'path',value:'x'}]` with platform `win32` → `extraEnv` equals `[{key:'FOO',value:'1'}]`.
  - `returns null for an all-empty binding`: `normalizeRepoConnectedAccounts({})` → `null`; `({claudeAccountId:'  '})` → `null`.
  - `rejects git author without an email`: `{gitAuthor:{name:'a',email:''}}` → result has no `gitAuthor`.
  - `drops admob profiles missing credentialsDir or publisherCode`, and dedupes by `id`.
- [ ] **Step 2: Run** `pnpm test src/shared/connected-accounts/connected-accounts-normalize.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the types and normalizers. Trim strings; reject `\u0000`.
- [ ] **Step 4: Wire the four whitelists.**
  - Add `connectedAccounts?: RepoConnectedAccounts | null` to the update handler args. Null clears; malformed deletes the key, exactly like `ghAccount`.
  - Zod field: `connectedAccounts: z.unknown().optional().transform(v => v === undefined ? undefined : v === null ? null : normalizeRepoConnectedAccounts(v) ?? null)`.
  - Hydration spreads the normalized value only when it is non-null.
- [ ] **Step 5: Add a test** next to the existing ghAccount repo-update test: `persists, normalizes and clears connectedAccounts`. Update with `{claudeAccountId:'a', extraEnv:[{key:'GIT_DIR',value:'x'}]}` → the stored repo has `connectedAccounts` = `{claudeAccountId:'a'}`. Update with `null` → the key is absent after reload (hydrate).
- [ ] **Step 6: Run** `pnpm test src/shared/connected-accounts src/main/persistence/tracking-repos && pnpm tc`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(connected-accounts): add per-project binding model and persistence` (+ trailers).

### Task 2: Pure env resolution for AdMob and extra env

**Files:**
- Create: `src/main/connected-accounts/connected-accounts-static-env.ts`
- Test: `src/main/connected-accounts/connected-accounts-static-env.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `isReservedConnectedAccountsEnvKey`.
- Produces:
  ```ts
  export type ConnectedAccountsUnresolved = { tool: 'claude' | 'github' | 'git' | 'firebase' | 'admob'; account: string; fixCommand?: string; reason: string }
  export function resolveAdmobProfileEnv(profileId: string, profiles: ConnectedAccountsAdmobProfile[]):
    { env: Record<string, string> } | { unresolved: ConnectedAccountsUnresolved }
  export function resolveExtraEnv(entries: ConnectedAccountsExtraEnvEntry[] | undefined, platform: NodeJS.Platform): Record<string, string>
  ```

- [ ] **Step 1: Failing tests:**
  - `admob profile resolves to CREDENTIALS_DIR and PUBLISHER_CODE`: equals `{CREDENTIALS_DIR:'/c', PUBLISHER_CODE:'pub-1'}`.
  - `missing admob profile is unresolved, not empty`: returns `unresolved.tool === 'admob'` and `account === profileId`.
  - `extra env skips reserved keys at resolution time`: `[{key:'Path',value:'x'},{key:'FOO',value:'1'}]` on `win32` → `{FOO:'1'}`.
- [ ] **Step 2: Run** `pnpm test src/main/connected-accounts/connected-accounts-static-env.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Re-run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(connected-accounts): resolve admob and extra env` (+ trailers).

### Task 3: Per-project Claude routing

**Files:**
- Modify: `src/main/claude-accounts/claude-profile-router.ts` (`launchEnv` 265, `terminalEnv` 275, `prepareLaunch` 311 region, `preparation`)
- Modify: `src/main/claude-accounts/runtime-auth-service.ts:49` (`prepareForClaudeLaunch`)
- Modify: the `PrepareClaudeAuth` type (grep `type PrepareClaudeAuth`) and its implementers `src/main/orcad/orcad-account-services.ts:78`, `src/main/runtime/runtime-account-controller.ts:85`, `src/main/window/attach-main-window-services.ts:57`
- Modify: `src/main/claude-accounts/claude-profile-installed-router.ts` (`withClaudeProfileTerminalEnv` gains an optional override)
- Test: `src/main/claude-accounts/claude-profile-router.test.ts` (extend)

**Interfaces:**
- Consumes: `RepoConnectedAccounts.claudeAccountId`.
- Produces:
  ```ts
  export type ClaudeRepoAccountOverride = { repoId: string; accountId: string }
  // ClaudeProfileRouter
  repoPointerPath(repoId: string): string   // <dataRoot>/claude-profiles/by-repo/<sha256(repoId).slice(0,16)>
  terminalEnv(target?: ClaudeAccountSelectionTarget, override?: ClaudeRepoAccountOverride): ClaudeEnvPatch
  prepareLaunch(override?: ClaudeRepoAccountOverride): Promise<ClaudeRuntimeAuthPreparation>
  // runtime-auth-service
  prepareForClaudeLaunch(target?: ClaudeAccountSelectionTarget, override?: ClaudeRepoAccountOverride): Promise<ClaudeRuntimeAuthPreparation>
  // PrepareClaudeAuth = (target?, override?) => Promise<ClaudeRuntimeAuthPreparation>
  withClaudeProfileTerminalEnv(env, target, override?: ClaudeRepoAccountOverride)
  ```
  - Pointer content rules: the account home, or `''` when `coveredBySystemDefault(accountId)`. The global `selected-host` pointer is untouched.
  - An override whose `accountId` is not in `claudeManagedAccounts`, or whose folder is missing, throws `claudeProfileMissing()` from `prepareLaunch`. From `terminalEnv`, it returns `{ORCA_CLAUDE_PROFILE_POINTER: <repo pointer>}` with the pointer content set to a non-absolute sentinel `'!unbound'`. The shell function refuses non-absolute pointers (`return 1`), so a terminal `claude` run fails instead of using the default.

- [ ] **Step 1: Failing tests** in `claude-profile-router.test.ts`, using the file's existing temp dataRoot fixture:
  - `repo override writes its own pointer and leaves the global pointer alone`: with global selection A and override B, after `terminalEnv(undefined, {repoId:'r1', accountId:'B'})`:
    - the env's `ORCA_CLAUDE_PROFILE_POINTER === router.repoPointerPath('r1')`;
    - that file's content equals B's home;
    - `selected-host` still contains A's home.
  - `prepareLaunch with override routes CLAUDE_CONFIG_DIR to the bound account`: `envPatch.CLAUDE_CONFIG_DIR === accountHome('B')` and `provenance === 'profile:B'`.
  - `unknown override account refuses the agent launch`: `prepareLaunch({repoId:'r1', accountId:'gone'})` rejects with `CLAUDE_PROFILE_MISSING_MESSAGE`.
  - `unknown override account blocks terminal claude`: the repo pointer content is `'!unbound'`.
- [ ] **Step 2: Run** `pnpm test src/main/claude-accounts/claude-profile-router.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - Refactor `selectedProfile()` into `profileFor(override?)`.
  - `writePointer` becomes `writePointerAt(path, home)`.
  - Thread `override` through `prepareLaunch`, `launchEnv`, `preparation` and the setup path. One `setUp` cache is keyed by accountId already.
  - Thread the second param through the `PrepareClaudeAuth` implementers. Orcad passes it along; the runtime-account-controller stub ignores it.
- [ ] **Step 4: Run** `pnpm test src/main/claude-accounts && pnpm tc`. Expected: PASS, and the existing router tests are unchanged.
- [ ] **Step 5: Commit** `feat(connected-accounts): route Claude per project via repo pointer` (+ trailers).

### Task 4: GitHub token, git credential and author env (pure builder)

**Files:**
- Create: `src/main/connected-accounts/connected-accounts-git-env.ts`
- Test: `src/main/connected-accounts/connected-accounts-git-env.test.ts`
- Test: extend `src/main/daemon/pty-subprocess/spawn-environment.test.ts` (or the nearest existing test of `createDaemonPtyEnvironment`)

**Interfaces:**
- Consumes: `GhAccountBinding`, `ghTokenEnvVarForHost` (`src/shared/github/account-binding.ts`), `appendGitConfigEnv` (`src/shared/git-credential-prompt-env.ts:61`), `resolveGhAccountToken` and `createGhBoundAccountUnavailableError` (`src/main/github/gh-account-token.ts:110`), `stripAmbientGhTokenEnv` (`:197`).
- Produces:
  ```ts
  export const CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED = 'orca-connected-accounts-unresolved'
  export function buildBoundGitEnvPatch(args: { binding: GhAccountBinding; token: string; author?: ConnectedAccountsGitAuthor; baseEnv: Record<string,string> }): Record<string,string>
  export function buildBlockedGhEnvPatch(binding: GhAccountBinding): Record<string,string>
  export async function resolveGitSupportsConfigEnv(): Promise<boolean>   // cached `git --version` >= 2.31 via existing git command resolution
  export async function resolveGhSpawnEnv(args: { binding: GhAccountBinding; author?: ConnectedAccountsGitAuthor; cwd: string; baseEnv: Record<string,string> }):
    Promise<{ env: Record<string,string> } | { env: Record<string,string>; unresolved: ConnectedAccountsUnresolved }>
  ```
  - `buildBoundGitEnvPatch` sets `[ghTokenEnvVarForHost(host)]: token`, `GH_HOST: host`, `GH_PROMPT_DISABLED: '1'`.
  - It appends the git config entries `credential.https://<host>.helper` = `''` (reset) and then `credential.https://<host>.helper` = `!gh auth git-credential`. `gh` honours `GH_TOKEN`/`GH_ENTERPRISE_TOKEN`, so no askpass script is needed.
  - When `author` is given, it sets `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL`.
  - SSH remotes are unaffected in v1; the UI says so (Task 9).
  - Failure modes all produce `buildBlockedGhEnvPatch` plus `unresolved`:
    - the token cannot be resolved: tool `github`, fix `gh auth login --hostname <host>`;
    - git < 2.31: tool `git`, reason `Git 2.31+ is required to pin the GitHub account for git`.
  - `buildBlockedGhEnvPatch` sets the token var to the sentinel so `gh` fails auth instead of using the keyring default. It also sets the reset-only helper entry, so git cannot reach the keychain account.

- [ ] **Step 1: Failing tests:**
  - `bound env pins token, host and an https credential helper for that host`:
    - the patch has `GH_TOKEN==='t'` and `GH_HOST==='github.com'`;
    - the `GIT_CONFIG_KEY_n`/`VALUE_n` pairs include, in order, `['credential.https://github.com.helper','']` and `['credential.https://github.com.helper','!gh auth git-credential']`.
  - `existing GIT_CONFIG_COUNT entries are preserved`: base env `GIT_CONFIG_COUNT=1, KEY_0=a, VALUE_0=b` → `KEY_0==='a'` and the new entries start at index 1.
  - `enterprise host uses GH_ENTERPRISE_TOKEN`.
  - `author sets both author and committer identity`.
  - `unresolved token blocks gh and git instead of falling back`:
    - stub `resolveGhAccountToken` to throw `createGhBoundAccountUnavailableError`;
    - the result has `unresolved.fixCommand === 'gh auth login --hostname github.com'` and `env.GH_TOKEN === CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED`;
    - no `!gh auth git-credential` value is present.
  - `old git reports the binding unresolvable`: stub the version as 2.30 → `unresolved.tool === 'git'`.
  - Daemon test `credential helper entries survive the daemon git guard append`:
    - pass `createDaemonPtyEnvironment` an explicit env containing the patch plus `ORCA_INTERNAL_TERMINAL_GIT_CREDENTIAL_GUARD_POLICY=guard`;
    - the resulting env still has both credential entries, and `GIT_CONFIG_COUNT` covers guard + credential entries.
- [ ] **Step 2: Run** `pnpm test src/main/connected-accounts/connected-accounts-git-env.test.ts src/main/daemon/pty-subprocess`. Expected: FAIL.
- [ ] **Step 3: Implement.** If the daemon test fails because its append overwrites indexes, fix `spawn-environment.ts` to read the existing count via `appendGitConfigEnv`.
- [ ] **Step 4: Re-run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(connected-accounts): pin GitHub account for gh and git env` (+ trailers).

### Task 5: Firebase account store (list + per-directory bind)

**Files:**
- Create: `src/main/connected-accounts/firebase-tools-account-store.ts`
- Test: `src/main/connected-accounts/firebase-tools-account-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function firebaseToolsConfigstorePath(env: NodeJS.ProcessEnv, home: string): string   // join(env.XDG_CONFIG_HOME || join(home,'.config'), 'configstore','firebase-tools.json')
  export function listFirebaseToolsAccountEmails(path: string): string[]   // user.email + additionalAccounts[].user.email, deduped; [] when the file is missing
  export function findFirebaseProjectRoot(dir: string): string | null      // same walk-up as firebase-tools detectProjectRoot
  export function ensureFirebaseActiveAccount(args: { configstorePath: string; worktreePath: string; email: string }):
    { ok: true; projectRoot: string } | { ok: false; unresolved: ConnectedAccountsUnresolved }
  export function writeConnectedAccountsFirebaseJson(worktreePath: string): Promise<void>   // writes '{}\n' only if firebase.json is absent
  ```
  - `ensureFirebaseActiveAccount` behaviour:
    - It fails when the email is not in `listFirebaseToolsAccountEmails`. Fix: `npx -y firebase-tools@latest login:add`.
    - It fails when `findFirebaseProjectRoot(worktreePath)` is null, or is not `worktreePath` itself. Reason: `This worktree has no firebase.json at its root`; fix: the "Bind Firebase to this project" button.
    - Otherwise it reads the JSON, sets `activeAccounts[projectRoot] = email` only if it differs, and writes atomically (`writeFileAtomically`, mode preserved). Every other key is left byte-equivalent.
    - When `realpathSync(worktreePath) !== worktreePath`, it writes both keys.
    - It never logs file content.

- [ ] **Step 1: Failing tests** (temp dirs; set `XDG_CONFIG_HOME` in the env passed to the path function):
  - `lists default and additional account emails without exposing tokens`: the result equals `['work@x.com','me@y.com']`, and the result's JSON does not contain `refresh_token`.
  - `writes the per-directory active account and preserves tokens`: after the call, `activeAccounts[wt] === 'me@y.com'`; `user`, `tokens` and `additionalAccounts` deep-equal the input; the global `user.email` is unchanged.
  - `worktree without firebase.json is unresolved and the configstore is untouched`: file mtime and contents unchanged; `unresolved.tool === 'firebase'`.
  - `firebase.json only in a parent dir is unresolved`: the parent has `firebase.json`, the worktree is a child → `ok === false`.
  - `unknown email is unresolved with the login:add fix`.
  - `bind button writes firebase.json once`: a second call does not overwrite a pre-existing `{"hosting":{}}`.
- [ ] **Step 2: Run** `pnpm test src/main/connected-accounts/firebase-tools-account-store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Re-run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(connected-accounts): bind firebase-tools account per worktree` (+ trailers).

### Task 6: Spawn integration (agents + terminals, fail loud)

**Files:**
- Create: `src/main/connected-accounts/connected-accounts-spawn-env.ts`
- Test: `src/main/connected-accounts/connected-accounts-spawn-env.test.ts`
- Modify: `src/main/ipc/pty/ipc/spawn-preflight.ts:103-107`, `src/main/ipc/pty/runtime/spawn-preflight.ts:88-92`
- Modify: `src/main/ipc/pty/ipc/spawn-state.ts`, plus the runtime state type (add `connectedAccountsWarning?: string`)
- Modify: the spawn result type in `src/main/providers/pty-provider-contract.ts` and the renderer path that already carries `startupCwdFallback` → add an optional `connectedAccountsWarning?: string` and render it with the same mechanism (grep `startupCwdFallback` in `src/renderer/src`)
- Create: `src/main/connected-accounts/connected-accounts-pane-registry.ts` (stale-binding tracking)
- Test: extend `src/main/ipc/pty/pty-spawn-env-terminal-basics.test.ts` (the existing spawn-env harness)

**Interfaces:**
- Consumes: Tasks 2–5, `getRepoIdFromWorktreeId` (`src/shared/worktree/id.ts:27`), `isFolderRepo`, the repo `executionHostId`/`connectionId`, `claudeProfileMissing` pattern (`claude-profile-launch-errors.ts`).
- Produces:
  ```ts
  export type ConnectedAccountsSpawnEnv = {
    env: Record<string, string>           // patch merged after withClaudeProfileTerminalEnv; extra env merged last
    claudeOverride?: ClaudeRepoAccountOverride
    unresolved: ConnectedAccountsUnresolved[]
    fingerprint: string | null            // sha256 of non-secret binding values only; null when unbound
  }
  export async function resolveConnectedAccountsSpawnEnv(args: {
    repo: Repo | undefined; worktreePath: string | undefined; settings: GlobalSettings; baseEnv: Record<string,string>; platform: NodeJS.Platform
  }): Promise<ConnectedAccountsSpawnEnv>
  export function connectedAccountsFingerprint(repo: Repo, settings: GlobalSettings): string | null
  export function formatConnectedAccountsLaunchError(unresolved: ConnectedAccountsUnresolved[]): Error & { code: 'connected_accounts_unresolved' }
  // pane registry
  export function recordConnectedAccountsPane(ptyId: string, repoId: string, fingerprint: string | null): void
  export function forgetConnectedAccountsPane(ptyId: string): void
  export function countStaleConnectedAccountsPanes(repoId: string, currentFingerprint: string | null): number
  ```
  - The resolver returns `{env:{}, unresolved:[], fingerprint:null}` for: no repo, a folder repo, a non-local execution host, and a WSL runtime. WSL is blocked earlier in the UI (Task 9); at spawn it stays default.
  - Agent launch = `ctx.isClaudeLaunch || launchAgent !== undefined`, and not a pre-adopted/restored pane (`ctx.preAdoptedStablePane` or a caller-supplied `sessionId` reattach).
  - For an agent launch with `unresolved.length > 0`, throw `formatConnectedAccountsLaunchError`. Message per entry: `<Tool> account <account> is not available: <reason>. Fix: <fixCommand>`.
  - Otherwise set `ctx.connectedAccountsWarning` to the same text and continue with the blocked env.
  - `prepareClaudeAuth(target, claudeOverride)` receives the override.
  - Record the pane once a ptyId exists, and forget it on exit. Use the existing pty exit hook in `register-handlers.ts`.

- [ ] **Step 1: Failing unit tests** (resolver, with the Task 3–5 dependencies stubbed at their module boundary):
  - `unbound repo returns an empty patch and null fingerprint`.
  - `folder repo and ssh repo are left on machine defaults`.
  - `extra env is merged last and cannot override bound tool env`: extra `FOO=1`; the result `env.FOO==='1'`, and `GH_TOKEN` is still the resolved token.
  - `fingerprint changes when a binding changes and never contains token material`: change `firebaseEmail` → a different hash; stringify the inputs and confirm the token `'t'` is never hashed (the hash input builder excludes env values from gh).
  - `unresolved gh binding is reported with account and fix`.
- [ ] **Step 2: Failing spawn tests** in `pty-spawn-env-terminal-basics.test.ts`:
  - `agent launch in a project with an unresolvable binding is refused`: the spawn rejects with `code === 'connected_accounts_unresolved'`, and no provider spawn was called.
  - `plain terminal with an unresolvable binding opens with a warning and no fallback token`: the spawn succeeds; the result has `connectedAccountsWarning` containing `me@github.com`; the spawned env `GH_TOKEN === CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED`, and ambient `GH_TOKEN` from the process env is not present.
  - `bound terminal gets the per-repo Claude pointer`: the spawned env `ORCA_CLAUDE_PROFILE_POINTER` ends with `by-repo/<hash>`.
  - `spawn env with GH_TOKEN is not persisted`: after the spawn, the persisted terminal/session record for the pane (the same store write the harness already asserts on) contains no value equal to the token.
- [ ] **Step 3: Run** `pnpm test src/main/connected-accounts src/main/ipc/pty/pty-spawn-env-terminal-basics.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the resolver, the preflight wiring (same three lines in both preflight files), the warning field and the pane registry.
- [ ] **Step 5: Re-run, then** `pnpm test src/main/ipc/pty && pnpm tc`. Expected: PASS, and existing spawn tests are unchanged.
- [ ] **Step 6: Commit** `feat(connected-accounts): apply project bindings at agent and terminal spawn` (+ trailers).

### Task 7: Orca's own git calls use the bound account

**Files:**
- Modify: `src/main/git/git-runtime-options.ts` (add `env?: NodeJS.ProcessEnv` to `GitRuntimeOptions`; `gitOptionsForWorktree` forwards it)
- Modify: `src/main/ipc/local-worktree-runtime-options.ts` (`getLocalGitOptionsForRegisteredWorktree` adds the env from `resolveGhSpawnEnv` for the matched repo)
- Modify: `src/main/git/source-control/commit-changes.ts` (pass the author env)
- Test: `src/main/ipc/local-worktree-runtime-options.test.ts` (create if absent) and the existing `remote` tests

**Interfaces:**
- Consumes: `resolveGhSpawnEnv` (Task 4), `getLocalRepoForRegisteredWorktree`.
- Produces: `getLocalGitOptionsForRegisteredWorktree(store, worktreePath, resolvedPath)` becomes **async** and returns `GitRuntimeOptions & { env?: NodeJS.ProcessEnv }`. Update its callers in `src/main/ipc/filesystem/git-remote/*.ts`.
  - When the binding is unresolvable, it throws `formatConnectedAccountsLaunchError` (Orca's own push must fail loudly too).

- [ ] **Step 1: Failing tests:**
  - `push options for a bound repo carry the pinned credential helper and token`: the env contains `GH_TOKEN` and the credential helper entries.
  - `unbound repo options carry no env` (the existing behaviour stays).
  - `unresolvable binding rejects before git runs`.
- [ ] **Step 2: Run** `pnpm test src/main/ipc/local-worktree-runtime-options.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Merge the env onto `process.env` only inside `gitOptionsForWorktree`'s consumer, so unbound calls are byte-identical.
- [ ] **Step 4: Run** `pnpm test src/main/ipc src/main/git && pnpm tc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(connected-accounts): use bound GitHub account for Orca git push/pull/fetch/commit` (+ trailers).

### Task 8: IPC and preload for the settings section

**Files:**
- Create: `src/main/ipc/connected-accounts.ts` (registered next to `registerClaudeAccountHandlers`)
- Create: `src/preload/api/connected-accounts-bridge.ts`; modify `src/preload/api-types.ts`, `src/preload/index.ts`
- Test: `src/main/ipc/connected-accounts.test.ts`

**Interfaces:**
- Produces, as IPC channels and the `window.api.connectedAccounts.*` bridge:
  - `connectedAccounts:listFirebaseAccounts` → `string[]` (emails only).
  - `connectedAccounts:bindFirebaseProject({repoId})` → `{ wrote: boolean }`. Calls `writeConnectedAccountsFirebaseJson(repo.path)`. Rejected for folder/remote repos.
  - `connectedAccounts:suggestGitAuthor({host,user})` → `ConnectedAccountsGitAuthor`. One `gh api user --hostname <host>` via the bound-account gh runner; it returns `name ?? login` and `<id>+<login>@users.noreply.github.com` (github.com) or the API `email` (GHES). It is called only from the UI on bind, never at spawn.
  - `connectedAccounts:staleSessionCount({repoId})` → `number`, via `countStaleConnectedAccountsPanes(repoId, connectedAccountsFingerprint(repo, settings))`.

- [ ] **Step 1: Failing tests:**
  - `bindFirebaseProject refuses folder repos`.
  - `staleSessionCount counts panes recorded with an older fingerprint`: record 2 panes with fingerprint `a` → the binding changes → returns `2`. A pane recorded with the current fingerprint → `0`.
- [ ] **Step 2: Run** `pnpm test src/main/ipc/connected-accounts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the handlers and the bridge (`satisfies PreloadApi['connectedAccounts']`).
- [ ] **Step 4: Re-run, then** `pnpm tc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(connected-accounts): add IPC for account listing and firebase binding` (+ trailers).

### Task 9: Settings section, menu item, sidebar key icon

**Files:**
- Create: `src/renderer/src/components/settings/repository/connected-accounts/RepositoryConnectedAccountsSection.tsx`
- Create: `src/renderer/src/components/settings/repository/connected-accounts/ConnectedAccountsAdmobProfilesEditor.tsx`
- Create: `src/renderer/src/components/settings/repository/connected-accounts/ConnectedAccountsExtraEnvEditor.tsx`
- Create: `src/renderer/src/components/sidebar/worktree-list/rows/RepoConnectedAccountsIndicator.tsx`
- Modify: `src/renderer/src/components/settings/repository/repository-settings-targets.ts` (add `getRepositoryConnectedAccountsSectionId(repoId) => \`repo-${repoId}-connected-accounts\``)
- Modify: `src/renderer/src/components/settings/repository/RepositoryPane.tsx`
  - Render the new section in the `!isFolder` block where `RepositoryGitHubAccountSection` sits (~341).
  - The GitHub row embeds the existing `RepositoryGitHubAccountSection` instead of duplicating it. Remove the standalone render.
- Modify: `src/renderer/src/components/sidebar/worktree-list/rows/repo-header-project-actions.tsx:136` (new menu item after "Project Settings")
- Modify: `src/renderer/src/components/sidebar/worktree-list/rows/SectionHeader.tsx:338` (render the indicator for repo headers)

**Interfaces:**
- Consumes: Task 8 bridge; `settings.claudeManagedAccounts`; `updateRepo(repoId, {connectedAccounts, ghAccount})`; `updateSettings({connectedAccountsAdmobProfiles})`; `OnboardingInlineCommandTerminal` (`src/renderer/src/components/onboarding/OnboardingInlineCommandTerminal.tsx`) for "Add account"; `handleRunningClaudeSessionsAfterSwitch` is **not** reused (it is tied to the global selection).
- Produces:
  ```ts
  export function connectedAccountsSummary(repo: Repo, settings: GlobalSettings): string[]   // e.g. ['Claude: me@y.com','GitHub: me@github.com', ...]; [] when unbound
  ```
  - It lives in `src/renderer/src/components/settings/repository/connected-accounts/connected-accounts-summary.ts` and has a unit test.

- [ ] **Step 1: Failing test** `connected-accounts-summary.test.ts`:
  - `summary lists only bound tools with account labels`: a repo with `claudeAccountId` + `ghAccount` → `['Claude: <account email>', 'GitHub: me (github.com)']`.
  - `missing claude account is shown as missing, not dropped`: an unknown id → the entry contains `missing`.
- [ ] **Step 2: Run** `pnpm test src/renderer/src/components/settings/repository/connected-accounts`. Expected: FAIL.
- [ ] **Step 3: Implement** the summary, then the section. Section rows, in order:
  - **Claude** picker over `claudeManagedAccounts` + "Default (machine)".
  - **GitHub**: the embedded existing section, plus a commit-author name/email input prefilled by `suggestGitAuthor` on bind, plus a note "SSH remotes: account binding applies to HTTPS only".
  - **Firebase**:
    - picker over `listFirebaseAccounts` + "Add account", which opens the inline terminal with `npx -y firebase-tools@latest login:add` and refreshes on close;
    - when the repo root has no `firebase.json`, a "Bind Firebase to this project" button (`bindFirebaseProject`) with the note "Commit firebase.json so other worktrees get it".
  - **AdMob**:
    - profile picker + editor (name, credentials dir, publisher code);
    - a static note with the exact MCP config change: `"CREDENTIALS_DIR": "${CREDENTIALS_DIR:-<current value>}"`, `"PUBLISHER_CODE": "${PUBLISHER_CODE:-<current value>}"`.
  - **RevenueCat**: a read-only line "Follows the Claude account (claude.ai connector)".
  - **Extra env vars**: key/value list with per-row validation (`isValidConnectedAccountsEnvKey`, `isReservedConnectedAccountsEnvKey`) and the warning "Don't put secrets here: stored in plain settings and synced".
  - **Stale banner**:
    - when `staleSessionCount > 0` (polled on mount and after each save), show "{{count}} running sessions in this project still use the previous accounts. Restart them to apply.";
    - there is no restart button in v1.
  - **Every picker** has "Default (machine)" (Radix sentinel value, as in `RepositoryGitHubAccountSection`).
  - **Disabled states:**
    - for a remote repo (`connectionId`/non-local `executionHostId`), the pickers are disabled with "Account bindings apply to local launches only";
    - the same applies to a WSL project runtime, with "not yet supported for WSL projects".
  - Menu item: `KeyRound` icon, label "Connected Accounts", `onSelect={() => actions.onOpenRepoSettings(repo.id, getRepositoryConnectedAccountsSectionId(repo.id))}`.
  - Indicator: a `KeyRound` icon (size-3, muted token) with a `Tooltip` listing `connectedAccountsSummary`. It renders nothing when the summary is empty.
- [ ] **Step 4: Run** `pnpm test src/renderer/src/components/settings/repository && pnpm tc`. Expected: PASS.
- [ ] **Step 5: Visual check:** follow AGENTS.md "Electron UI Validation" (`ORCA_BACKGROUND_LAUNCH=1`, CDP screenshot of Settings → project → Connected Accounts, and of the sidebar tooltip). Expected: the section renders in light and dark mode; the key icon is visible on a bound project only.
- [ ] **Step 6: Commit** `feat(connected-accounts): add project Connected Accounts settings, menu item and sidebar indicator` (+ trailers).

### Task 10: i18n, real-launch proof, final gate

**Files:**
- Modify: `src/renderer/src/i18n/locales/en.json` (generated). The other locales fall back via i18next; no hand translation is required.

- [ ] **Step 1: Run** `pnpm sync:localization-catalog`, then `pnpm verify:localization-catalogs`.
  - Every new UI string uses `translate('connectedAccounts.<key>', '<English>')`.
  - Main-process error text uses `translateMain` if the error surfaces in the renderer (check how `CLAUDE_PROFILE_MISSING_MESSAGE` is surfaced and mirror it).
  - Expected: exit 0.
- [ ] **Step 2: Run** `pnpm check:changed --maxWorkers=2`. Expected: PASS.
- [ ] **Step 3: Real-launch proof** (manual, local; this is the "store proof" gate, not tests). Bind a personal project to Claude B, GitHub personal, Firebase personal and AdMob profile P. Start a Claude agent in a worktree and confirm each of these:
  - (a) `echo $ORCA_CLAUDE_PROFILE_POINTER` and `cat` of it → B's home;
  - (b) `gh api user -q .login` → the personal login;
  - (c) `git push` on an HTTPS remote succeeds as personal, with no keychain prompt; `git log -1 --format='%an <%ae>'` after a commit → the bound author;
  - (d) the Firebase MCP `firebase_get_environment` reports the personal account;
  - (e) after the user applies the `${VAR:-…}` change from the section, the AdMob MCP `get_account` returns P's publisher. Record here whether config `env` won before the change; that settles the precedence question;
  - (f) unbind gh login with `gh auth logout --user <personal>` → a new agent launch is refused with the fix text, and a plain terminal opens with the warning.
- [ ] **Step 4: Commit** `chore(connected-accounts): sync localization catalog` (+ trailers).

---

## Self-review notes

- **Spec coverage:**
  - per-tool pickers: T1, T3–T5, T9;
  - agents + terminals: T6;
  - no tokens stored: T1, T5, T6 tests;
  - key icon + tooltip: T9;
  - menu deep-link: T9;
  - banner: T6 registry, T8, T9;
  - "Default (machine)": T9;
  - GitHub covers git + author: T4, T7;
  - Firebase no-`firebase.json` path: T5, T8, T9;
  - unresolvable = refuse agent / warn terminal: T6;
  - extra env non-secret warning: T9;
  - AdMob profiles in settings + shown config change: T1, T9;
  - Codex, remote, mobile out of scope: Global Constraints.
- **Open, by design:**
  - restart of non-Claude agents is "tell the user" (spec allows);
  - SSH-remote git pinning is HTTPS-only with a UI note (the spec leaves this choice to the builder);
  - WSL projects are disabled in the UI rather than half-applied.
