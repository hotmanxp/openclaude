export interface LspServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  rootUri?: string;
  workspaces?: string[];
}

export interface ScopedLspServerConfig {
  server: LspServerConfig;
  scopes?: string[];
}
