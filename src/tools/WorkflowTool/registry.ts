// src/tools/WorkflowTool/registry.ts
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import type { Workflow } from './types.js'

export type RegistryOpts = {
  projectDir: string
  userDir: string
}

/**
 * Discovers and tracks workflows available to the WorkflowTool.
 *
 * Resolution order (later wins on name conflict):
 *   1. Bundled workflows (registered programmatically via `registerBundled`)
 *   2. User workflows from `<userDir>/.claude/workflows/*.js`
 *   3. Project workflows from `<projectDir>/.claude/workflows/*.js`
 *
 * Discovery is cold-scan: the directory is re-read on the first `list()`/`get()`
 * after the registry is empty, and can be forced with `reload()`.
 */
export class WorkflowRegistry {
  private workflows = new Map<string, Workflow>()

  constructor(private readonly opts: RegistryOpts) {}

  /** Cold scan: re-read all .js files in project + user dirs. */
  async reload(): Promise<void> {
    this.workflows.clear()
    for (const wf of await this.scanDir(join(this.opts.userDir, '.claude', 'workflows'), 'user')) {
      this.workflows.set(wf.name, wf)
    }
    for (const wf of await this.scanDir(join(this.opts.projectDir, '.claude', 'workflows'), 'project')) {
      this.workflows.set(wf.name, wf)
    }
  }

  /** Add a bundled workflow (e.g. /deep-research). */
  registerBundled(workflow: Workflow): void {
    this.workflows.set(workflow.name, workflow)
  }

  /** List all known workflows, sorted by name. */
  async list(): Promise<Workflow[]> {
    if (this.workflows.size === 0) await this.reload()
    return [...this.workflows.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Look up by name. */
  async get(name: string): Promise<Workflow | undefined> {
    if (this.workflows.size === 0) await this.reload()
    return this.workflows.get(name)
  }

  private async scanDir(dir: string, source: 'project' | 'user'): Promise<Workflow[]> {
    const out: Workflow[] = []
    if (!existsSync(dir)) return out
    let stat
    try {
      stat = statSync(dir)
    } catch {
      return out
    }
    if (!stat.isDirectory()) return out
    const entries = readdirSync(dir).filter(f => f.endsWith('.js'))
    for (const file of entries) {
      const fullPath = join(dir, file)
      try {
        const mod = await import(/* @vite-ignore */ pathToFileURL(fullPath).href)
        const run = mod.default ?? mod.workflow
        if (typeof run !== 'function') continue
        out.push({
          name: file.replace(/\.js$/, ''),
          source,
          path: fullPath,
          run: run as (args: string[]) => Promise<string>,
        })
      } catch {
        // Skip invalid workflow files
      }
    }
    return out
  }
}
