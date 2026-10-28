export type ConnectedAccountsGitAuthor = { name: string; email: string }

export type ConnectedAccountsExtraEnvEntry = { key: string; value: string }

/** Which account a project uses per service; never credentials. */
export type RepoConnectedAccounts = {
  /** ClaudeManagedAccount.id */
  claudeAccountId?: string
  firebaseEmail?: string
  /** ConnectedAccountsAdmobProfile.id */
  admobProfileId?: string
  /** Applied only when Repo.ghAccount is set. */
  gitAuthor?: ConnectedAccountsGitAuthor
  extraEnv?: ConnectedAccountsExtraEnvEntry[]
}

export type ConnectedAccountsAdmobProfile = {
  id: string
  name: string
  credentialsDir: string
  publisherCode: string
}

export type ConnectedAccountsGlobalSettings = {
  /** Named AdMob credential folders a project can pin via Repo.connectedAccounts.admobProfileId. */
  connectedAccountsAdmobProfiles: ConnectedAccountsAdmobProfile[]
}
