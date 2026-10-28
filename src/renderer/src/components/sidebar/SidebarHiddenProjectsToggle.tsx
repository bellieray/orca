import React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Session-only reveal of hidden projects; absent while nothing is hidden. */
export function SidebarHiddenProjectsToggle(): React.JSX.Element | null {
  // Removed projects can leave stale ids until main prunes the persisted copy.
  const hasHiddenRepos = useAppStore((s) =>
    s.repos.some((repo) => s.hiddenRepoIds.includes(repo.id))
  )
  const revealed = useAppStore((s) => s.revealHiddenRepos)
  const setRevealHiddenRepos = useAppStore((s) => s.setRevealHiddenRepos)
  if (!hasHiddenRepos) {
    return null
  }
  const label = revealed
    ? translate('sidebar.hiddenProjects.conceal', 'Hide hidden projects again')
    : translate('sidebar.hiddenProjects.reveal', 'Show hidden projects')
  const Icon = revealed ? Eye : EyeOff
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={revealed ? 'secondary' : 'ghost'}
          size="icon-xs"
          aria-label={label}
          aria-pressed={revealed}
          data-sidebar-hidden-projects-toggle=""
          onClick={() => setRevealHiddenRepos(!revealed)}
        >
          <Icon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
