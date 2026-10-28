import { beforeEach, describe, expect, it, vi } from 'vitest'

const { gitExecFileAsyncMock } = vi.hoisted(() => ({
  gitExecFileAsyncMock: vi.fn()
}))

vi.mock('../runner', () => ({
  gitExecFileAsync: gitExecFileAsyncMock
}))

import { commitChanges } from './commit-changes'

describe('commitChanges', () => {
  beforeEach(() => {
    gitExecFileAsyncMock.mockReset()
    gitExecFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('passes the bound author env to git commit', async () => {
    const env = { PATH: '/usr/bin', GIT_AUTHOR_EMAIL: 'octo@example.com' }
    await expect(commitChanges('/repo', 'msg', { env })).resolves.toEqual({ success: true })
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(['commit', '-m', 'msg'], {
      cwd: '/repo',
      env
    })
  })

  it('adds no env for an unbound repo', async () => {
    await commitChanges('/repo', 'msg')
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(['commit', '-m', 'msg'], { cwd: '/repo' })
  })
})
