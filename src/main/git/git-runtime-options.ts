import type { GitAdmissionTier } from './command-runner/git-exec-options'

export type GitRuntimeOptions = {
  wslDistro?: string
  signal?: AbortSignal
  admissionTier?: GitAdmissionTier
  /** Full child env (already merged onto process.env); absent keeps the inherited env untouched. */
  env?: NodeJS.ProcessEnv
}

export function gitOptionsForWorktree(
  cwd: string,
  options: GitRuntimeOptions = {}
): {
  cwd: string
  wslDistro?: string
  signal?: AbortSignal
  admissionTier?: GitAdmissionTier
  env?: NodeJS.ProcessEnv
} {
  return {
    cwd,
    ...(options.wslDistro ? { wslDistro: options.wslDistro } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.admissionTier ? { admissionTier: options.admissionTier } : {}),
    ...(options.env ? { env: options.env } : {})
  }
}

/** Explicit read callers may use shell-free WSL without relying on argv classification. */
export function gitReadOptionsForWorktree(
  cwd: string,
  options: GitRuntimeOptions = {}
): {
  cwd: string
  wslDistro?: string
  signal?: AbortSignal
  admissionTier?: GitAdmissionTier
  env?: NodeJS.ProcessEnv
  preferWslDirectGit: true
} {
  return { ...gitOptionsForWorktree(cwd, options), preferWslDirectGit: true }
}
