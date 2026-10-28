import type { AppState } from '@/store/types'
import type { NotificationDispatchRequest } from '../../../shared/notification-settings-types'
import { getRepoIdFromWorktreeId } from '../../../shared/worktree/id'

/** Hidden stays hidden while revealed: the reveal is a glance, not consent to banners. */
export function withHiddenProjectDesktopSuppression(
  request: NotificationDispatchRequest,
  state: Pick<AppState, 'hiddenRepoIds'>
): NotificationDispatchRequest {
  if (
    !request.worktreeId ||
    request.worktreeId.startsWith('folder:') ||
    !state.hiddenRepoIds.includes(getRepoIdFromWorktreeId(request.worktreeId))
  ) {
    return request
  }
  return { ...request, desktopSuppressed: true }
}
