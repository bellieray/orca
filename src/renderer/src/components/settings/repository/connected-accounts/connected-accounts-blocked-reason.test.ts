import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../../../shared/repo-types'
import type { ProjectExecutionRuntimeResolution } from '../../../../../../shared/project-execution-runtime'
import {
  connectedAccountsBlockedReason,
  projectRuntimeRunsInWsl
} from './connected-accounts-blocked-reason'

const repo: Repo = {
  id: 'r1',
  path: 'C:\\work\\app',
  displayName: 'app',
  badgeColor: '#000',
  addedAt: 0
}

const wslRuntime: ProjectExecutionRuntimeResolution = {
  status: 'resolved',
  runtime: {
    kind: 'wsl',
    hostPlatform: 'wsl',
    distro: 'Ubuntu',
    projectId: 'r1',
    reason: 'project-override',
    cacheKey: 'r1:wsl:Ubuntu'
  }
}

describe('connectedAccountsBlockedReason', () => {
  it('blocks a Windows-path project whose runtime is WSL, not only \\\\wsl$ paths', () => {
    expect(projectRuntimeRunsInWsl(wslRuntime)).toBe(true)
    expect(projectRuntimeRunsInWsl(undefined)).toBe(false)
    expect(connectedAccountsBlockedReason(repo, true)).toContain('WSL')
    expect(connectedAccountsBlockedReason(repo, false)).toBeNull()
  })
})
