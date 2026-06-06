// src/tools/WorkflowTool/constants.ts

export const WORKFLOW_TOOL_NAME = 'WorkflowTool'

/** Default limits — overridable via env vars (see below) */
export const WORKFLOW_DEFAULTS = {
  maxConcurrentAgents: 16,
  maxTotalAgents: 1000,
  defaultTimeoutMs: 30 * 60 * 1000,  // 30 min
} as const

/** Env vars (OpenCC convention: OPENCC_* for kill switches per AGENTS.md) */
export const WORKFLOW_ENV = {
  DISABLE: 'OPENCC_DISABLE_WORKFLOWS',
  TIMEOUT_MS: 'OPENCC_WORKFLOW_TIMEOUT_MS',
  MAX_AGENTS: 'OPENCC_WORKFLOW_MAX_AGENTS',
  KEYWORD: 'OPENCC_WORKFLOW_KEYWORD',  // custom trigger word (default: 'ultracode')
} as const
