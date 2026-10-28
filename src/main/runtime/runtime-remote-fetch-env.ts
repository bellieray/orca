import type { LocalGitExecOptions } from '../git/repo-default-base-ref'

/** Best-effort bound-account env for a repo's network fetch; undefined keeps the machine default. */
export type RemoteFetchEnvResolver = (
  repoPath: string,
  gitOptions: LocalGitExecOptions
) => Promise<NodeJS.ProcessEnv | undefined>

/** Never throws: a failed resolution falls back to the inherited env so background fetches still run. */
export async function remoteFetchEnvOptions(
  resolve: RemoteFetchEnvResolver | undefined,
  repoPath: string,
  gitOptions: LocalGitExecOptions
): Promise<{ env?: NodeJS.ProcessEnv }> {
  if (!resolve) {
    return {}
  }
  try {
    const env = await resolve(repoPath, gitOptions)
    return env ? { env } : {}
  } catch {
    return {}
  }
}
