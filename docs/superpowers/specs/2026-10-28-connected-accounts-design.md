# Connected Accounts per project — design

## Intent

The owner is a solo indie developer who also works at a company, using one Orca for both. Several tools on the machine are signed into more than one account (work and personal). Agents silently use whatever account the tool started with. Real incident: the Firebase MCP created a Firebase project under the **work** Google account while working on a personal app. The MCP keeps the credential it loaded at process start, so switching accounts mid-session doesn't help. The account has to be fixed **before** the agent process starts. Orca starts every agent and terminal in a known project, so it is the right place to pin accounts per project.

Success: open a personal project, start an agent, and every account-bearing tool (Claude, GitHub, Firebase, AdMob, plus anything added later) acts as the account chosen for that project. No manual `login:use` / `gh auth switch` dance, and the binding is visible at a glance.

## Goals

- Per project (Repo), choose:
  - Claude account (from Orca's existing managed Claude accounts).
  - GitHub account (from `gh`'s logged-in accounts).
  - Firebase account (from firebase-tools' logged-in accounts).
  - AdMob credentials profile.
  - Free-form extra env vars.
- Apply the choices to **agents and plain terminals** started in any worktree of that project.
- Orca stores **which account**, not tokens. Every tool already stores its own credentials; Orca only points the tool at the right one at launch.
- Show the binding in the sidebar: a key icon on the project header, with a tooltip listing the bound accounts.

## Non-goals

- No new secret storage for tool tokens.
- No per-worktree overrides (project level only).
- No mobile UI.
- Remote/SSH execution hosts: v1 applies bindings to local (and daemon-local) launches only. Remote launches keep current behaviour, and the UI says so when the project runs remotely.
- RevenueCat gets no dedicated picker. It is a claude.ai connector, so its account follows the chosen Claude account. The UI shows this as a read-only line.

## Anti-goals (a failure even if it "works")

- A bound project silently falls back to the global account. If a bound account can't be resolved at launch (for example a gh user who is no longer logged in), the launch must fail loudly with a clear error, not quietly use the default.
- Changing a binding silently rewires already-running agents in a way the user can't see.
- Writing to global tool config. For example, `firebase login:use` in a directory without `firebase.json` changes the GLOBAL default. That is forbidden.

## Decided

- **Entry point:** a new item "Connected Accounts" in the project's 3-dot menu (`repo-header-project-actions.tsx`).
  - The owner approved this rather than burying it inside Project Settings.
  - Builder's call, which the owner should check: the item deep-links into the existing Settings page, project pane, at a new "Connected Accounts" section (`openSettingsTarget({pane:'repo', repoId, sectionId})`). This is how "Project Settings" already opens. I first proposed a dialog; recon showed project settings live in the Settings page, so reuse it.
- **Section layout** (approved mockup): one row per tool.
  - Claude: account picker.
  - GitHub: account picker.
  - Firebase: account picker, plus "Add account".
  - AdMob: profile picker.
  - RevenueCat: read-only line, "follows Claude account".
  - Extra env vars: key/value list.
  - A banner when agents in this project are running with the old binding.
  - Every picker has a "Default (machine)" option, meaning today's behaviour.
- **Persistence:** on `Repo`, next to the existing `ghAccount` field, so it follows the same whitelists (repo-update handler, zod `repo-update-params.ts`, sanitization, hydration).
- **GitHub:** reuse the existing `Repo.ghAccount` binding. Today it only feeds Orca's own `gh` calls. Extend it so PTYs get `GH_TOKEN` (or `GH_ENTERPRISE_TOKEN`) resolved at spawn time via the existing `main/github/gh-account-token.ts`.
- **Claude:** per-project override of the global managed account. Today `claude-profile-router` uses one global pointer file that the `claude` shell function re-reads on every run. A per-project binding needs a pointer per binding (or per repo), so terminals in different projects resolve different accounts. Agent launches go through `prepareLaunch` with the project's account.
- **Firebase:** firebase-tools stores accounts in `~/.config/configstore/firebase-tools.json` (`user`, `additionalAccounts`, `activeAccounts` keyed by project directory).
  - Bind by setting the per-directory active account for the worktree path. Only do this when that directory is a Firebase project (has `firebase.json`), or via an equivalent per-process mechanism; never touch the global default.
  - Builder: verify against the firebase-tools source which mechanism the Firebase MCP actually honours at start, and pick one that is per-process or per-directory.
  - "Add account" runs `firebase login:add` in a terminal.
- **AdMob:** a local stdio MCP whose account is chosen by env `CREDENTIALS_DIR` + `PUBLISHER_CODE`. A profile is a named pair of these values; binding injects them as env. Caveat for the builder: MCP servers defined in `~/.claude.json` with explicit `env` may override inherited env. Verify which wins. If config `env` wins, document the needed config change (remove the hardcoded values from the MCP config).
- **Extra env vars:** plain key/value pairs merged into the launch env last, for future tools.
- **When applied:** at PTY/agent spawn only. Already-running processes are not changed. The banner offers "restart agents" (reuse any existing restart affordance; otherwise just tell the user).
- **Where in code:** spawn preflight / `buildPtyHostEnv` (`main/ipc/pty/...`) knows `args.worktreeId`; resolve worktree to repo there. Both `ipc/spawn-preflight.ts` and `runtime/spawn-preflight.ts` exist and both need it.

## Settled after builder check

- **GitHub covers git too (owner's decision).** The bound GitHub account applies to `gh`/API **and** to `git` push/fetch and the commit author.
  - HTTPS remotes: the credential comes from the bound account's token (for example a per-process credential helper or `GIT_ASKPASS` fed by `gh auth token --user <login>`). It must not be the keychain default.
  - SSH remotes: let the builder decide whether to support a per-account SSH key via `GIT_SSH_COMMAND`, or to show "SSH remote: account binding applies to HTTPS only" in the UI.
  - Commit author: set `GIT_AUTHOR_NAME/EMAIL` + `GIT_COMMITTER_NAME/EMAIL` from the bound account. The email is the account's primary or noreply address, editable in the section.
  - Reuse `src/main/git/command-runner/git-process-env.ts` / `git-ssh-policy-env.ts` patterns.
  - Real incident this prevents: git used the wrong account's credential and got a 403 even though `gh` was on the right account.
- **Firebase without `firebase.json` (my call):** first look for a per-process mechanism the Firebase MCP honours, such as a global `--account`-style option, an env var, or the MCP's own config. If none exists, the section offers a "Bind Firebase to this project" button. It writes a minimal `firebase.json` into the repo, then sets the per-directory active account. Copying firebase-tools' token store is not allowed.
- **Unresolvable binding (my call):** an agent launch is refused, with a clear error naming the account and the fix command. A plain terminal still opens with a visible warning banner, and the broken binding's env is left unset. A bound tool must never fall back to the global default, so set e.g. `GH_TOKEN` to an empty/invalid sentinel only if that is what it takes to block the fallback. Restored sessions behave like plain terminals.
- **Extra env vars are non-secret in v1 (my call).** The UI warns "don't put secrets here: stored in plain settings and synced". No encrypted store in v1.
- **AdMob profiles (my call):** created and edited in the same section (name, credentials dir, publisher code) and stored in Orca settings, not on the repo. Orca never edits MCP config files. If config-defined `env` overrides inherited env, the section shows the exact change the user must make.
- **Codex accounts: out of v1 (my call).** The owner only uses Claude.

## Left to the builder

- The exact pointer-file scheme for per-project Claude routing, and how it coexists with the global switch.
- How to list accounts per tool: gh via `gh auth status`, Firebase via its configstore, Claude via managed accounts, AdMob profiles stored in Orca settings.
- Error UX when a bound account is missing at launch.
- Test scope: focused tests for env resolution per tool and for "bound but unresolvable fails loudly"; no low-value UI tests.
- i18n strings via the repo's i18n system.

## Constraints

- Follow AGENTS.md: cross-platform (no macOS-only assumptions in the env layer; Firebase and gh paths differ on Windows), folder workspaces (bindings are repo-level, so folder workspaces get the default), remote hosts (see non-goals), mixed client/server versions (new Repo fields must be optional).
- No tokens in persisted state or logs.
