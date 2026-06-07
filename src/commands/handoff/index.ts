import path from 'node:path'
import fs from 'node:fs/promises'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { Command } from '../../commands.js'
import type { ToolUseContext } from '../../Tool.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import {
  renderGeneratePrompt,
  type TaskListEntry,
} from './prompts/generate.js'
import { renderPickupPrompt } from './prompts/pickup.js'
import { listHandoffs, getLatestHandoff } from './handoff.js'

const HANDON_DIR_PARTS = ['.agent_working_dir', 'handoff']
function handoffRoot(cwd: string): string {
  return path.join(cwd, ...HANDON_DIR_PARTS)
}

// Test seam: HANDON_TEST_CWD overrides getOriginalCwd() for unit tests.
// This keeps production behavior unchanged (reads real cwd) while letting
// tests inject a temp dir.
function getCwd(): string {
  const testCwd = process.env.HANDON_TEST_CWD
  if (testCwd) return testCwd
  return getOriginalCwd()
}

const handoff: Command = {
  type: 'prompt',
  name: 'handoff',
  description:
    'Hand off the current session: generate a handoff document (when many messages) or resume the latest handoff (when few messages).',
  argumentHint: '[--pick <filename>]',
  progressMessage: 'preparing handoff',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(
    args: string,
    context: ToolUseContext,
  ): Promise<ContentBlockParam[]> {
    const cwd = getCwd()
    const N = (context.messages ?? []).length
    const appState = context.getAppState()
    const root = handoffRoot(cwd)
    const today = new Date().toISOString().slice(0, 10)
    const pickArg = /--pick\s+(\S+)/.exec(args)?.[1]

    if (N <= 3) {
      // ---- PICKUP ----
      const rootExists = !!(await fs.stat(root).catch(() => null))
      const all = rootExists ? await listHandoffs(root) : []
      let pickPath: string | null = null
      let pickContent: string | null = null
      let errorNote: string | null = null

      if (pickArg) {
        const candidate = path.join(
          root,
          pickArg.endsWith('.md') ? pickArg : `${pickArg}.md`,
        )
        if (await fs.stat(candidate).catch(() => null)) {
          pickPath = candidate
          pickContent = await fs.readFile(candidate, 'utf8').catch(() => null)
        } else {
          errorNote = `Specified file \`${path.basename(candidate)}\` does not exist`
        }
      } else if (all.length > 0) {
        pickPath = await getLatestHandoff(root)
        pickContent = pickPath
          ? await fs.readFile(pickPath, 'utf8').catch(() => null)
          : null
      } else {
        errorNote = rootExists
          ? `Directory \`${root}\` is empty, no handoff document to resume`
          : `Directory \`${root}\` does not exist`
      }

      const text = await renderPickupPrompt({
        pickPath,
        pickContent,
        errorNote,
        cwd,
        root,
        availableFiles: all.map(p => path.basename(p)),
      })
      return [{ type: 'text', text }]
    } else {
      // ---- GENERATE ----
      const taskList: TaskListEntry[] = Object.values(
        (appState.tasks ?? {}) as Record<string, TaskListEntry>,
      ).map(t => ({
        id: t.id,
        type: t.type,
        status: t.status,
        description: t.description,
      }))
      const text = await renderGeneratePrompt({
        cwd,
        root,
        today,
        messageCount: N,
        taskList,
      })
      return [{ type: 'text', text }]
    }
  },
}

export default handoff
