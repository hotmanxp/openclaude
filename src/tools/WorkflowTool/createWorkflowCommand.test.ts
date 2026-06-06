import { describe, expect, test, beforeEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getWorkflowCommands } from './createWorkflowCommand.js'

describe('getWorkflowCommands', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wf-cmds-'))
  })

  test('returns no user-workflow slash commands when none are registered', async () => {
    // The /workflows builtin is now a local-jsx command registered through
    // the standard src/commands/ scan path; getWorkflowCommands() is
    // strictly for user-workflow files.
    const cmds = await getWorkflowCommands(tmp)
    expect(cmds.find(c => c.name === 'workflows')).toBeUndefined()
  })

  test('returns a slash command for a freshly-written user workflow', async () => {
    const wfDir = join(tmp, '.claude', 'workflows')
    mkdirSync(wfDir, { recursive: true })
    // The registry loader does `mod.default ?? mod.workflow` and skips
    // anything that isn't a function — so the script body must export
    // a runnable function for the slash command to appear. The body
    // can also call __setMeta/phase (the runtime API) — that part is
    // exercised when the workflow actually runs, not at registration.
    // The runtime globals (__setMeta, phase, agent, parallel) only
    // exist inside the worker wrapper, so the import-time call site
    // must be inside the function body, not at the top level.
    writeFileSync(
      join(wfDir, 'sync-verify.js'),
      `export default async function () { __setMeta({ name: 'sync-verify', description: '...' }); phase('Sync'); return 'report' }\n`,
    )
    const cmds = await getWorkflowCommands(tmp)
    expect(cmds.find(c => c.name === 'sync-verify')).toBeDefined()
  })

  test('excludes bundled workflows from slash commands', async () => {
    const cmds = await getWorkflowCommands(tmp)
    // deep-research is bundled, should NOT appear as a slash command
    // (it has its own registration path via registerBundled)
    expect(cmds.find(c => c.name === 'deep-research')).toBeUndefined()
  })
})
