// src/tools/WorkflowTool/registry.ts
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import chokidar, { type FSWatcher } from 'chokidar'
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
  private watchers: FSWatcher[] = []
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

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

  /**
   * Start watching project + user workflow directories for file changes.
   * Any add/change/unlink event triggers a debounced (100ms) `reload()`.
   * No-op if already watching.
   */
  startWatching(): void {
    if (this.watchers.length > 0) return  // already watching

    const dirs = [
      join(this.opts.projectDir, '.claude', 'workflows'),
      join(this.opts.userDir, '.claude', 'workflows'),
    ]
    for (const dir of dirs) {
      let stat
      try {
        stat = statSync(dir)
      } catch {
        continue
      }
      if (!stat.isDirectory()) continue
      const w = chokidar.watch(dir, {
        ignored: /(^|[\\/])\../,
        persistent: true,
        ignoreInitial: true,
      })
      w.on('add', () => this.scheduleReload())
      w.on('change', () => this.scheduleReload())
      w.on('unlink', () => this.scheduleReload())
      this.watchers.push(w)
    }
  }

  /** Stop all watchers and clear any pending debounced reload. */
  stopWatching(): void {
    for (const w of this.watchers) w.close()
    this.watchers = []
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  /** Debounce rapid file events: only call reload() after 100ms of quiet. */
  private scheduleReload(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.reload().catch(e => console.error('[workflow] Reload failed:', e))
    }, 100)
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
