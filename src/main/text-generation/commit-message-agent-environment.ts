import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth-service'
import { applyClaudeEnvPatch } from '../claude-accounts/environment'
import { readShellStartupEnvVar } from '../pty/shell-startup-env'
import { parseWslUncPath } from '../../shared/wsl-paths'
import type { ClaudeRepoAccountOverride } from '../claude-accounts/claude-profile-repo-pointer'
import {
  CONNECTED_ACCOUNTS_NO_LAUNCH,
  isConnectedAccountsLaunchError,
  withConnectedAccountsClaudeRefusal,
  type ConnectedAccountsAgentLaunch,
  type ConnectedAccountsLaunchResolver
} from '../connected-accounts/connected-accounts-agent-launch'

export type CommitMessageAgentEnvironmentResolvers = {
  prepareForCodexLaunch?: (
    target?: CommitMessageAgentRuntimeTarget
  ) => string | null | Promise<string | null>
  prepareForClaudeLaunch?: (
    target?: CommitMessageAgentRuntimeTarget,
    override?: ClaudeRepoAccountOverride
  ) => Promise<ClaudeRuntimeAuthPreparation>
  /** The login-shell base env chats start from; a host-only source, never used for WSL. */
  resolveBaseEnvironment?: () => Promise<Record<string, string>>
}

export type CommitMessageAgentRuntimeTarget = {
  runtime?: 'host' | 'wsl'
  wslDistro?: string | null
}

function cloneProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }
  return env
}

// System-default routing strips only Orca-marked inherited CODEX_HOME overlays; preserve user overrides.
function withoutOrcaCodexHomeOverride(base: Record<string, string>): Record<string, string> {
  const env = { ...base }
  if (env.ORCA_CODEX_HOME && env.CODEX_HOME === env.ORCA_CODEX_HOME) {
    delete env.CODEX_HOME
  }
  delete env.ORCA_CODEX_HOME
  return env
}

function readInheritedOrShellEnvVar(
  name: string,
  sourceName: string | undefined,
  base: Record<string, string> | undefined
): string | undefined {
  // Prefer saved overlay source, then chat login-shell base, over inherited Orca values.
  return (
    (sourceName ? process.env[sourceName] : undefined) ??
    base?.[name] ??
    process.env[name] ??
    readShellStartupEnvVar(name, process.env.HOME, process.env.SHELL)
  )
}

function prepareShellConfigDirEnv(
  agentId: string,
  base: Record<string, string> | undefined
): { ok: true; env?: NodeJS.ProcessEnv } | null {
  const configVar =
    agentId === 'opencode' || agentId === 'opencode2'
      ? 'OPENCODE_CONFIG_DIR'
      : agentId === 'pi' || agentId === 'omp'
        ? 'PI_CODING_AGENT_DIR'
        : agentId === 'grok'
          ? 'GROK_HOME'
          : null
  if (!configVar) {
    return null
  }
  // Pi/OMP share a binary config var but need distinct source shadows or nested legacy overlays restore the wrong agent directory.
  const sourceVar =
    agentId === 'opencode' || agentId === 'opencode2'
      ? 'ORCA_OPENCODE_SOURCE_CONFIG_DIR'
      : agentId === 'pi'
        ? 'ORCA_PI_SOURCE_AGENT_DIR'
        : agentId === 'omp'
          ? 'ORCA_OMP_SOURCE_AGENT_DIR'
          : undefined

  const value = readInheritedOrShellEnvVar(configVar, sourceVar, base)
  if (!value) {
    return base ? { ok: true, env: base } : { ok: true }
  }

  // Recover GUI-missing auth/config exports while preferring original sources over nested PTY overlays.
  return { ok: true, env: { ...(base ?? cloneProcessEnv()), [configVar]: value } }
}

async function resolveHostBaseEnv(
  resolvers: CommitMessageAgentEnvironmentResolvers | undefined
): Promise<Record<string, string> | undefined> {
  if (!resolvers?.resolveBaseEnvironment) {
    return undefined
  }
  try {
    return { ...(await resolvers.resolveBaseEnvironment()) }
  } catch (error) {
    console.error('[commit-message] Failed to resolve the login-shell environment:', error)
    return undefined
  }
}

type PreparedAgentEnv = { ok: true; env?: NodeJS.ProcessEnv } | { ok: false; error: string }

/** `connectedAccounts` binds the run to the worktree's project accounts; an unresolved binding refuses it. */
export async function prepareLocalCommitMessageAgentEnv(
  agentId: string,
  resolvers: CommitMessageAgentEnvironmentResolvers | undefined,
  target?: CommitMessageAgentRuntimeTarget,
  connectedAccounts?: ConnectedAccountsLaunchResolver
): Promise<PreparedAgentEnv> {
  // Host agents need shell proxies/tokens; WSL resolves them in the guest.
  const hostBase = target?.runtime === 'wsl' ? undefined : await resolveHostBaseEnv(resolvers)
  let accounts: ConnectedAccountsAgentLaunch = CONNECTED_ACCOUNTS_NO_LAUNCH
  if (connectedAccounts) {
    try {
      accounts = await connectedAccounts(
        hostBase ?? cloneProcessEnv(),
        target?.runtime === 'wsl' ? 'wsl' : 'host'
      )
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  const prepared = await prepareAgentEnv(agentId, resolvers, target, hostBase, accounts)
  if (!prepared.ok || Object.keys(accounts.env).length === 0) {
    return prepared
  }
  // Bound tokens go last so the run cannot fall back to the machine's accounts.
  return { ok: true, env: { ...(prepared.env ?? hostBase ?? cloneProcessEnv()), ...accounts.env } }
}

async function prepareAgentEnv(
  agentId: string,
  resolvers: CommitMessageAgentEnvironmentResolvers | undefined,
  target: CommitMessageAgentRuntimeTarget | undefined,
  hostBase: Record<string, string> | undefined,
  accounts: ConnectedAccountsAgentLaunch
): Promise<PreparedAgentEnv> {
  // Shell-config agents short-circuit below; never put a Codex/Claude-style resolver agent on this path.
  const shellConfigEnv =
    target?.runtime === 'wsl' ? null : prepareShellConfigDirEnv(agentId, hostBase)
  if (shellConfigEnv) {
    return shellConfigEnv
  }
  if (!resolvers) {
    return { ok: true }
  }
  const base = hostBase ?? cloneProcessEnv()

  try {
    if (agentId === 'codex' && resolvers.prepareForCodexLaunch) {
      const codexHomePath = await resolvers.prepareForCodexLaunch(target)
      const wslCodexHome = codexHomePath ? parseWslUncPath(codexHomePath) : null
      if (target?.runtime === 'wsl') {
        const codexHomeForTarget = wslCodexHome?.linuxPath ?? null
        // Fallback still strips Orca overlays so system-default WSL cannot inherit managed CODEX_HOME.
        return {
          ok: true,
          env: codexHomeForTarget
            ? { ...withoutOrcaCodexHomeOverride(base), CODEX_HOME: codexHomeForTarget }
            : withoutOrcaCodexHomeOverride(base)
        }
      }
      if (codexHomePath && wslCodexHome) {
        // Host-binary generation cannot use a guest managed home without wsl.exe routing.
        return hostBase ? { ok: true, env: hostBase } : { ok: true }
      }
      return {
        ok: true,
        env: codexHomePath
          ? { ...base, CODEX_HOME: codexHomePath }
          : withoutOrcaCodexHomeOverride(base)
      }
    }

    if (agentId === 'claude' && resolvers.prepareForClaudeLaunch) {
      const prepare = resolvers.prepareForClaudeLaunch
      const override = accounts.claudeOverride
      const preparation = await withConnectedAccountsClaudeRefusal(
        override ? (accounts.claudeLabel ?? override.accountId) : null,
        // Unbound keeps the pre-binding call shape so default routing is unchanged.
        () => (override ? prepare(target, override) : prepare(target))
      )
      const env = applyClaudeEnvPatch({ ...base }, preparation.envPatch)
      return { ok: true, env }
    }
  } catch (error) {
    if (isConnectedAccountsLaunchError(error)) {
      return { ok: false, error: error.message }
    }
    console.error('[commit-message] Failed to prepare agent environment:', error)
    return {
      ok: false,
      error: 'Failed to prepare the selected agent account for commit message generation.'
    }
  }

  return hostBase ? { ok: true, env: hostBase } : { ok: true }
}
