// src/tools/WorkflowTool/singleton.ts
import { homedir } from 'os'
import { WorkflowRegistry } from './registry.js'
import { initBundledWorkflows } from './bundled/index.js'

const instances = new Map<string, WorkflowRegistry>()

/**
 * Lazily-initialized per-project WorkflowRegistry.
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
 *
 * One registry per projectDir so two callers running in different project
 * directories (e.g. a sub-shell or a test that switches cwd) get isolated
 * workflow maps. Construct + bundled-register is cheap (one Map.set +
 * one shallow object spread per projectDir), so the per-cwd cache is
 * fine to grow during a long session.
 */
export function getWorkflowRegistry(projectDir?: string): WorkflowRegistry {
  const dir = projectDir ?? process.cwd()
  const existing = instances.get(dir)
  if (existing) return existing
  const instance = new WorkflowRegistry({
    projectDir: dir,
    userDir: homedir(),
  })
  initBundledWorkflows(instance)
  instances.set(dir, instance)
  return instance
}
