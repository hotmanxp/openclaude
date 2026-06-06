// src/tools/WorkflowTool/singleton.ts
import { homedir } from 'os'
import { WorkflowRegistry } from './registry.js'
import { initBundledWorkflows } from './bundled/index.js'

let instance: WorkflowRegistry | null = null

/**
 * Lazily-initialized singleton WorkflowRegistry.
 *
 * Discovery is cold-scan (see WorkflowRegistry.reload()), so instantiating
 * the registry at startup is cheap — directories are only read on the
 * first .get()/.list() call. Bundled workflows (currently /deep-research)
 * are registered at construction time so they're always available even
 * before any disk scan runs.
 *
 * projectDir defaults to process.cwd() so workflows in the current project
 * take precedence over user-dir workflows (see registry.ts resolution order).
 * userDir defaults to homedir() — `~/.claude/workflows/*.js`.
 */
export function getWorkflowRegistry(): WorkflowRegistry {
  if (instance) return instance
  instance = new WorkflowRegistry({
    projectDir: process.cwd(),
    userDir: homedir(),
  })
  initBundledWorkflows(instance)
  return instance
}
