// src/tools/WorkflowTool/registry.test.ts
import { describe, expect, test, beforeEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { WorkflowRegistry } from './registry.js'

describe('WorkflowRegistry user script loading', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wf-reg-user-'))
  })

  test('loads a freshly-written sample.js from project .claude/workflows', async () => {
    const wfDir = join(tmp, '.claude', 'workflows')
    mkdirSync(wfDir, { recursive: true })
    writeFileSync(
      join(wfDir, 'sample.js'),
      `export default async function () { return 'hello' }`,
    )
    const r = new WorkflowRegistry({ projectDir: tmp, userDir: tmp })
    const all = await r.list()
    expect(all.find(w => w.name === 'sample')).toBeDefined()
  })
})

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

describe('WorkflowRegistry hot-reload', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wf-reg-watch-'))
  })

  test('newly created workflow appears in list after add event', async () => {
    const r = new WorkflowRegistry({ projectDir: tmp, userDir: tmp })
    r.startWatching()
    const initial = await r.list()
    expect(initial.length).toBe(0)

    // Add a workflow file
    const wfDir = join(tmp, '.claude', 'workflows')
    mkdirSync(wfDir, { recursive: true })
    writeFileSync(
      join(wfDir, 'late.js'),
      'export default async function() { return "late"; }',
    )

    // Wait for chokidar to fire (with 100ms debounce + scan)
    await new Promise(res => setTimeout(res, 500))
    const after = await r.list()
    expect(after.length).toBe(1)
    expect(after[0]!.name).toBe('late')

    r.stopWatching()
  })
})
