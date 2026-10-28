import type { Repo } from '../../../../../../shared/repo-types'
import type { ProjectExecutionRuntimeResolution } from '../../../../../../shared/project-execution-runtime'
import {
  getRepoExecutionHostId,
  getRepoRoutingConnectionId
} from '../../../../../../shared/execution-host'
import { isWslUncPath } from '../../../../../../shared/wsl-paths'
import { translate } from '@/i18n/i18n'

/** A repair-required runtime always prefers WSL; main refuses bound launches there too. Boolean so store selectors stay stable. */
export function projectRuntimeRunsInWsl(
  runtime: ProjectExecutionRuntimeResolution | undefined
): boolean {
  return runtime !== undefined && (runtime.status !== 'resolved' || runtime.runtime.kind === 'wsl')
}

/** Mirrors main's connectedAccountsRepoScope + WSL runtime refusal so the UI never offers a binding spawn refuses. */
export function connectedAccountsBlockedReason(repo: Repo, runtimeIsWsl: boolean): string | null {
  if (getRepoRoutingConnectionId(repo) || getRepoExecutionHostId(repo) !== 'local') {
    return translate(
      'connectedAccounts.localOnly',
      'Account bindings apply to local launches only.'
    )
  }
  if (isWslUncPath(repo.path) || runtimeIsWsl) {
    return translate(
      'connectedAccounts.wslUnsupported',
      'Account bindings are not yet supported for WSL projects.'
    )
  }
  return null
}
