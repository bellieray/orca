// Applies a project's Connected Accounts to native-chat (structured) agent launches, which bypass the PTY preflight.
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { Repo } from '../../shared/repo-types'
import { splitWorktreeId } from '../../shared/worktree/id'
import {
  CONNECTED_ACCOUNTS_NO_LAUNCH,
  connectedAccountsLaunchResolver,
  resolveConnectedAccountsAgentLaunch,
  type ConnectedAccountsAgentLaunch,
  type ConnectedAccountsLaunchResolver
} from '../connected-accounts/connected-accounts-agent-launch'
import type { ConnectedAccountsSettings } from '../connected-accounts/connected-accounts-spawn-env'
import { AgentSessionPreSpawnError } from '../native-chat/agent-session-wire/structured-agent-session-adapter-errors'

export type StructuredAgentConnectedAccountsStore = {
  getRepo: (repoId: string) => Repo | undefined
  getSettings: () => ConnectedAccountsSettings
}

/** Floating and folder workspaces have no repo binding; an unresolved binding refuses before any child spawns. */
export async function resolveStructuredAgentConnectedAccounts(
  store: StructuredAgentConnectedAccountsStore,
  record: Pick<AgentSessionRecord, 'location'>,
  baseEnv: Record<string, string>
): Promise<ConnectedAccountsAgentLaunch> {
  const parsed = splitWorktreeId(record.location.workspaceId)
  const repo = parsed ? store.getRepo(parsed.repoId) : undefined
  if (!parsed || !repo) {
    return CONNECTED_ACCOUNTS_NO_LAUNCH
  }
  try {
    return await resolveConnectedAccountsAgentLaunch({
      repo,
      worktreePath: parsed.worktreePath,
      settings: store.getSettings(),
      baseEnv,
      runtime: record.location.wslDistro ? 'wsl' : 'host'
    })
  } catch (error) {
    throw new AgentSessionPreSpawnError(error)
  }
}

/** For one-shot runs about a chat (its name): the chat's workspace decides the accounts. */
export function connectedAccountsLaunchForWorkspace(
  store: StructuredAgentConnectedAccountsStore,
  workspaceId: string,
  workspacePath: string
): ConnectedAccountsLaunchResolver | undefined {
  const parsed = splitWorktreeId(workspaceId)
  return connectedAccountsLaunchResolver(
    parsed ? store.getRepo(parsed.repoId) : undefined,
    workspacePath,
    store.getSettings()
  )
}

/** The native-chat host dep; the store is read per launch so binding edits apply to the next start. */
export function structuredAgentConnectedAccountsDeps(
  getStore: () => StructuredAgentConnectedAccountsStore
): {
  resolveConnectedAccounts: (
    record: AgentSessionRecord,
    baseEnv: Record<string, string>
  ) => Promise<ConnectedAccountsAgentLaunch>
} {
  return {
    resolveConnectedAccounts: (record, baseEnv) =>
      resolveStructuredAgentConnectedAccounts(getStore(), record, baseEnv)
  }
}
