import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionJournalIdentity } from '../../shared/agent-session-journal-types'
import type { Repo } from '../../shared/repo-types'
import { agentSessionRecordFixture } from '../native-chat/agent-session-record-test-fixture'
import { createCodexStructuredLaunchResolver } from './structured-agent-launch-composition.test-support'
import { resolveStructuredAgentConnectedAccounts } from './structured-agent-connected-accounts'
import { resolveClaudeStructuredLaunchHome } from '../claude/claude-structured-launch-home'

const WORKSPACE_ID = 'repo-1::/repos/personal'

function codexLaunch(
  resolveConnectedAccounts: Parameters<
    typeof createCodexStructuredLaunchResolver
  >[0]['resolveConnectedAccounts']
) {
  const record = agentSessionRecordFixture({
    sessionId: 's1',
    provider: 'codex',
    accountHome: { variable: 'CODEX_HOME', path: '/pinned/home' },
    location: { workspaceId: WORKSPACE_ID }
  })
  const resolveCommand = vi.fn(() => 'codex')
  const launch = createCodexStructuredLaunchResolver({
    store: { getRecord: () => record, pinLaunchDirectory: vi.fn() },
    resolveEnvironment: async () => ({ PATH: '/bin' }),
    resolveCommand,
    resolveLaunchArgs: () => [],
    resolveConnectedAccounts
  })({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a launch reads only the session id of its identity here.
    identity: { sessionId: 's1' } as AgentSessionJournalIdentity,
    spawnToken: 'spawn-token'
  })
  return { launch, resolveCommand }
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: partial repo fixture; resolution reads only routing and binding fields.
const boundRepo = {
  id: 'repo-1',
  path: '/repos/personal',
  kind: 'git',
  connectedAccounts: { claudeAccountId: 'removed-account' }
} as Repo

describe('native chat launches with Connected Accounts', () => {
  it('every structured agent gets the bound tool env', async () => {
    const resolve = vi.fn(async () => ({ env: { GH_TOKEN: 'gho_bound' } }))
    const { launch } = codexLaunch(resolve)
    expect((await launch).env.GH_TOKEN).toBe('gho_bound')
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ location: expect.objectContaining({ workspaceId: WORKSPACE_ID }) }),
      expect.objectContaining({ PATH: '/bin' })
    )
  })

  it('an unresolved binding refuses before the agent part runs', async () => {
    const { launch, resolveCommand } = codexLaunch(async () => {
      throw new Error('GitHub account octo@github.com is not available')
    })
    await expect(launch).rejects.toThrow('GitHub account octo@github.com is not available')
    expect(resolveCommand).not.toHaveBeenCalled()
  })

  it('a bound project whose Claude account is gone is refused pre-spawn', async () => {
    const record = agentSessionRecordFixture({
      sessionId: 's1',
      location: { workspaceId: WORKSPACE_ID }
    })
    const store = { getRepo: () => boundRepo, getSettings: () => ({ claudeManagedAccounts: [] }) }
    await expect(resolveStructuredAgentConnectedAccounts(store, record, {})).rejects.toMatchObject({
      name: 'AgentSessionPreSpawnError',
      message: expect.stringContaining(
        'Claude account removed-account is not available: the Claude account was removed from Orca'
      )
    })
  })

  it('a WSL chat in a bound project is refused, not run on the guest default', async () => {
    const record = agentSessionRecordFixture({
      sessionId: 's1',
      location: { workspaceId: WORKSPACE_ID, wslDistro: 'Ubuntu' }
    })
    const store = {
      getRepo: () => boundRepo,
      getSettings: () => ({
        claudeManagedAccounts: [
          {
            id: 'removed-account',
            email: 'me@example.com',
            managedAuthPath: '/accounts/personal',
            authMethod: 'subscription-oauth' as const,
            createdAt: 0,
            updatedAt: 0,
            lastAuthenticatedAt: 0
          }
        ]
      })
    }
    await expect(resolveStructuredAgentConnectedAccounts(store, record, {})).rejects.toThrow(
      'not supported for WSL projects yet'
    )
  })

  it('floating workspaces carry no binding', async () => {
    const record = agentSessionRecordFixture({
      sessionId: 's1',
      location: { workspaceId: 'floating-1' }
    })
    const getRepo = vi.fn()
    expect(
      await resolveStructuredAgentConnectedAccounts(
        { getRepo, getSettings: () => ({}) },
        record,
        {}
      )
    ).toEqual({ env: {} })
    expect(getRepo).not.toHaveBeenCalled()
  })

  it('the Claude launch home follows the bound account override', async () => {
    const override = { repoId: 'repo-1', accountId: 'personal' }
    const router = {
      prepareLaunch: vi.fn(async () => ({
        configDir: '/accounts/personal',
        runtime: 'host' as const,
        wslDistro: null,
        wslLinuxConfigDir: null,
        envPatch: { CLAUDE_CONFIG_DIR: '/accounts/personal' },
        provenance: 'profile:personal'
      })),
      systemDefaultHome: () => '/home/me/.claude'
    }
    const env: Record<string, string> = {}
    expect(await resolveClaudeStructuredLaunchHome(router, env, '/record/home', override)).toBe(
      '/accounts/personal'
    )
    expect(router.prepareLaunch).toHaveBeenCalledWith(override)
    expect(env.CLAUDE_CONFIG_DIR).toBe('/accounts/personal')
  })
})
