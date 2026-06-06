// src/tools/WorkflowTool/registry.test.ts
import { describe, expect, test, beforeEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { WorkflowRegistry } from './registry.js'

describe('WorkflowRegistry', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wf-reg-'))
  })

  test('lists empty when no workflows', async () => {
    const r = new WorkflowRegistry({ projectDir: tmp, userDir: tmp })
    const all = await r.list()
    expect(all).toEqual([])
  })

  test('discovers project workflows from .claude/workflows/', async () => {
    const wfDir = join(tmp, '.claude', 'workflows')
    mkdirSync(wfDir, { recursive: true })
    writeFileSync(
      join(wfDir, 'foo.js'),
      `export default async function (args) { return 'foo:' + args; }`,
    )
    const r = new WorkflowRegistry({ projectDir: tmp, userDir: tmp })
    const all = await r.list()
    expect(all.length).toBe(1)
    expect(all[0]!.name).toBe('foo')
    expect(all[0]!.source).toBe('project')
  })

  test('project overrides user on name conflict', async () => {
    const projectDir = join(tmp, 'project')
    const userDir = join(tmp, 'user')
    mkdirSync(join(projectDir, '.claude', 'workflows'), { recursive: true })
    mkdirSync(join(userDir, '.claude', 'workflows'), { recursive: true })
    writeFileSync(join(projectDir, '.claude', 'workflows', 'foo.js'), `export default async function() { return 'project'; }`)
    writeFileSync(join(userDir, '.claude', 'workflows', 'foo.js'), `export default async function() { return 'user'; }`)
    const r = new WorkflowRegistry({ projectDir, userDir })
    const all = await r.list()
    expect(all.length).toBe(1)
    expect(all[0]!.source).toBe('project')
  })

  test('registerBundled adds a workflow', async () => {
    const r = new WorkflowRegistry({ projectDir: tmp, userDir: tmp })
    r.registerBundled({
      name: 'deep-research',
      source: 'bundled',
      path: '<bundled>',
      run: async () => '',
    })
    const all = await r.list()
    expect(all.find(w => w.name === 'deep-research')).toBeDefined()
  })
})
