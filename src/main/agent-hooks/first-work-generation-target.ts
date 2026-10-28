import type { CommitMessageGenerationTarget } from '../text-generation/commit-message-text-generation'
import {
  prepareLocalCommitMessageAgentEnv,
  type CommitMessageAgentEnvironmentResolvers
} from '../text-generation/commit-message-agent-environment'
import type { ConnectedAccountsLaunchResolver } from '../connected-accounts/connected-accounts-agent-launch'

export async function resolveGenerationTarget(
  worktreePath: string,
  agentId: string,
  deps: { getAgentEnvResolvers: () => CommitMessageAgentEnvironmentResolvers | undefined },
  /** The worktree's project accounts; an unresolved binding skips generation (null). */
  connectedAccounts?: ConnectedAccountsLaunchResolver
): Promise<CommitMessageGenerationTarget | null> {
  const localEnv = await prepareLocalCommitMessageAgentEnv(
    agentId,
    deps.getAgentEnvResolvers(),
    undefined,
    connectedAccounts
  )
  if (!localEnv.ok) {
    return null
  }
  return { kind: 'local', cwd: worktreePath, ...(localEnv.env ? { env: localEnv.env } : {}) }
}
