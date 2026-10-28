import { describe, expect, it, vi } from 'vitest'
import { spawnMock } from './pty-ipc-mock-registry'
import { setupPtyIpcSuite } from './pty-ipc-test-harness'
import { registerPtyHandlers } from './register-handlers'
import { composeWorktreeId } from '../../../shared/worktree/id'
import {
  buildBlockedGhEnvPatch,
  CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED
} from '../../connected-accounts/connected-accounts-git-env'
import { installClaudeProfileRouter } from '../../claude-accounts/claude-profile-installed-router'
import { claudeRepoPointerPath } from '../../claude-accounts/claude-profile-repo-pointer'
import { CLAUDE_PROFILE_POINTER_ENV } from '../../../shared/claude-profile-routing'
import type { Repo } from '../../../shared/repo-types'

const { connectedAccountsGhMock } = vi.hoisted(() => ({ connectedAccountsGhMock: vi.fn() }))
vi.mock('../../connected-accounts/connected-accounts-git-env', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveGhSpawnEnv: connectedAccountsGhMock
}))

vi.mock('electron', () => import('./pty-ipc-mock-registry').then((m) => m.electronModuleMock()))
vi.mock('fs', () => import('./pty-ipc-mock-registry').then((m) => m.fsModuleMock()))
vi.mock('node-pty', () => import('./pty-ipc-mock-registry').then((m) => m.nodePtyModuleMock()))
vi.mock('node:child_process', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).childProcessModuleMock(await importOriginal())
)
vi.mock('../../opencode/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.openCodeHookServiceModuleMock())
)
vi.mock('../../mimo/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.mimoHookServiceModuleMock())
)
vi.mock('../../agent-hooks/server', () =>
  import('./pty-ipc-mock-registry').then((m) => m.agentHookServerModuleMock())
)
vi.mock('../../pi/titlebar-extension-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.piTitlebarExtensionModuleMock())
)
vi.mock('../../pwsh', () => import('./pty-ipc-mock-registry').then((m) => m.pwshModuleMock()))
vi.mock('../../wsl', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).wslModuleMock(await importOriginal())
)
vi.mock('../../telemetry/client', () =>
  import('./pty-ipc-mock-registry').then((m) => m.telemetryClientModuleMock())
)
vi.mock('../../telemetry/classify-error', () =>
  import('./pty-ipc-mock-registry').then((m) => m.classifyErrorModuleMock())
)
vi.mock('../../cli/linux-terminal-orca-cli-shim', () =>
  import('./pty-ipc-mock-registry').then((m) => m.linuxCliShimModuleMock())
)
vi.mock('../../memory/pty-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.ptyRegistryModuleMock())
)
vi.mock('../../agent-hooks/migration-unsupported-pty-state', () =>
  import('./pty-ipc-mock-registry').then((m) => m.migrationUnsupportedPtyModuleMock())
)
vi.mock('../../codex/codex-pane-account-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexPaneAccountRegistryModuleMock())
)
vi.mock('../../codex/codex-state-db-backfill-recovery', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexBackfillRecoveryModuleMock())
)

describe('connected accounts at spawn', () => {
  const { handlers, mainWindow } = setupPtyIpcSuite()
  const ACCOUNT_TOKEN = 'gho_connectedAccountsSecret123'
  const worktreeId = composeWorktreeId('repo-ca', '/tmp/connected-accounts-wt')
  const ghBinding = { host: 'github.com', user: 'me' }

  function boundRepo(connectedAccounts?: Repo['connectedAccounts']): Repo {
    return {
      id: 'repo-ca',
      path: '/tmp/connected-accounts-wt',
      displayName: 'ca',
      badgeColor: '#000',
      addedAt: 0,
      ghAccount: ghBinding,
      ...(connectedAccounts ? { connectedAccounts } : {})
    }
  }

  function recordingStore(repo: Repo) {
    const calls: unknown[] = []
    const store = new Proxy(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles implement only the members the spawn path reads.
      { getRepo: (id: string) => (id === repo.id ? repo : undefined) } as Record<string, unknown>,
      {
        get(target, key) {
          if (key in target) {
            // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles implement only the members the spawn path reads.
            return target[key as string]
          }
          if (key === 'then' || typeof key === 'symbol') {
            return undefined
          }
          return (...args: unknown[]) => {
            calls.push([key, args])
            return undefined
          }
        }
      }
    )
    return { store, calls }
  }

  async function spawnBound(repo: Repo, extra: Record<string, unknown> = {}) {
    const { store, calls } = recordingStore(repo)
    handlers.clear()
    registerPtyHandlers(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles implement only the members the spawn path reads.
      mainWindow as never,
      undefined,
      undefined,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles implement only the members the spawn path reads.
      (() => ({ claudeManagedAccounts: [], connectedAccountsAdmobProfiles: [] })) as never,
      undefined,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles implement only the members the spawn path reads.
      store as never
    )
    spawnMock.mockClear()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles implement only the members the spawn path reads.
    const result = (await handlers.get('pty:spawn')!(null, {
      cols: 80,
      rows: 24,
      cwd: '/tmp/connected-accounts-wt',
      worktreeId,
      ...extra
    })) as Record<string, unknown>
    return { result, calls }
  }

  function unresolvedGh() {
    connectedAccountsGhMock.mockResolvedValue({
      env: buildBlockedGhEnvPatch(ghBinding),
      unresolved: {
        tool: 'github',
        account: 'me@github.com',
        fixCommand: 'gh auth login --hostname github.com',
        reason: 'it is not signed in to gh on this machine'
      }
    })
  }

  it('agent launch in a project with an unresolvable binding is refused', async () => {
    unresolvedGh()
    await expect(spawnBound(boundRepo(), { command: 'claude' })).rejects.toMatchObject({
      code: 'connected_accounts_unresolved',
      message: expect.stringContaining('me@github.com')
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('plain terminal with an unresolvable binding opens with a warning and no fallback token', async () => {
    unresolvedGh()
    const previous = process.env.GH_TOKEN
    process.env.GH_TOKEN = 'ambient-token'
    try {
      const { result } = await spawnBound(boundRepo())
      expect(String(result.connectedAccountsWarning)).toContain('me@github.com')
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles implement only the members the spawn path reads.
      const env = spawnMock.mock.calls.at(-1)![2].env as Record<string, string>
      expect(env.GH_TOKEN).toBe(CONNECTED_ACCOUNTS_GH_TOKEN_BLOCKED)
      expect(Object.values(env)).not.toContain('ambient-token')
    } finally {
      if (previous === undefined) {
        delete process.env.GH_TOKEN
      } else {
        process.env.GH_TOKEN = previous
      }
    }
  })

  it('bound terminal gets the per-repo Claude pointer', async () => {
    connectedAccountsGhMock.mockResolvedValue({ env: { GH_TOKEN: ACCOUNT_TOKEN } })
    const overrides: unknown[] = []
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles implement only the members the spawn path reads.
    installClaudeProfileRouter({
      terminalEnv: (_target: unknown, override?: { repoId: string }) => {
        overrides.push(override)
        return {
          [CLAUDE_PROFILE_POINTER_ENV]: override
            ? claudeRepoPointerPath('/tmp/orca-data', override.repoId)
            : '/tmp/orca-data/claude-profiles/selected-host'
        }
      },
      routedHome: () => '/tmp/orca-data/claude-profiles/a'
    } as never)
    try {
      await spawnBound(boundRepo({ claudeAccountId: 'claude-1' }))
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles implement only the members the spawn path reads.
      const env = spawnMock.mock.calls.at(-1)![2].env as Record<string, string>
      expect(env[CLAUDE_PROFILE_POINTER_ENV]).toMatch(/by-repo[\\/][0-9a-f]{16}$/)
      expect(overrides).toEqual([{ repoId: 'repo-ca', accountId: 'claude-1' }])
    } finally {
      installClaudeProfileRouter(undefined)
    }
  })

  it('spawn env with GH_TOKEN is not persisted', async () => {
    connectedAccountsGhMock.mockResolvedValue({ env: { GH_TOKEN: ACCOUNT_TOKEN } })
    const { result, calls } = await spawnBound(boundRepo())
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test doubles implement only the members the spawn path reads.
    const env = spawnMock.mock.calls.at(-1)![2].env as Record<string, string>
    expect(env.GH_TOKEN).toBe(ACCOUNT_TOKEN)
    expect(result.connectedAccountsWarning).toBeUndefined()
    expect(JSON.stringify(calls)).not.toContain(ACCOUNT_TOKEN)
    expect(JSON.stringify(result)).not.toContain(ACCOUNT_TOKEN)
  })
})
