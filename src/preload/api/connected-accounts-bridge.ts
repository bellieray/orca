import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const connectedAccountsApi = {
  listFirebaseAccounts: () => ipcRenderer.invoke('connectedAccounts:listFirebaseAccounts'),
  bindFirebaseProject: (args: { repoId: string }) =>
    ipcRenderer.invoke('connectedAccounts:bindFirebaseProject', args),
  suggestGitAuthor: (args: { host: string; user: string }) =>
    ipcRenderer.invoke('connectedAccounts:suggestGitAuthor', args),
  staleSessionCount: (args: { repoId: string }) =>
    ipcRenderer.invoke('connectedAccounts:staleSessionCount', args)
} satisfies PreloadApi['connectedAccounts']
