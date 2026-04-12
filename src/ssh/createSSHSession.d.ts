// SSH session types
export type SSHSession = {
  id: string
  remoteCwd?: string
  // Add other properties as needed
}

export type SSHSessionManager = {
  createSession: (options: unknown) => Promise<SSHSession>
  // Add other methods as needed
}

// Missing exports expected by main.tsx
export class SSHSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SSHSessionError'
  }
}

export interface CreateSSHSessionOptions {
  host: string
  cwd: string
  localVersion: string
  permissionMode: string
  dangerouslySkipPermissions?: boolean
  extraCliArgs?: string[]
  onProgress?: (msg: string) => void
}

export interface CreateLocalSSHSessionOptions {
  cwd: string
  permissionMode: string
  dangerouslySkipPermissions?: boolean
}

export function createSSHSession(
  options: CreateSSHSessionOptions,
  isTTY?: boolean
): Promise<SSHSession> {
  throw new Error('SSHSession not available in external build')
}

export function createLocalSSHSession(
  options: CreateLocalSSHSessionOptions
): SSHSession {
  throw new Error('Local SSHSession not available in external build')
}
