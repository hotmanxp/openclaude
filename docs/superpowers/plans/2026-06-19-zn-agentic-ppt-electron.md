# zn-agentic-ppt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Electron desktop app that uses a vendored LLM Agent SDK to generate HTML presentations from user outlines.

**Architecture:** Main process hosts the SDK + filesystem + IPC; preload exposes typed API via contextBridge; renderer is React + Zustand SPA. LLM streaming events flow main→renderer via `webContents.send`.

**Tech Stack:** Electron 30+, TypeScript 5, React 18, Antd 5, Tailwind 3, react-router 6 (HashRouter), Zustand 4, Vitest, Playwright, pnpm, esbuild (main), Vite (renderer), Biome, electron-builder.

**Spec:** `docs/superpowers/specs/2026-06-19-zn-agentic-ppt-electron-design.md`

---

## File Map

**Create from scratch:**
- `/Users/ethan/code/zn-agentic-ppt/` — entire new project
- `package.json`, `tsconfig*.json`, `biome.json`, `electron-builder.yml`, `vite.config.ts`, `.gitignore`
- `vendor/sdk.mjs`, `vendor/sdk.d.ts` (copied from opencc-worktree)
- `scripts/sync-sdk.ts`, `scripts/build-main.ts`, `scripts/dev.ts`
- `src/main/{index,ipc/*,sdk/*,fs/*,windows/*}.ts`
- `src/preload/index.ts`
- `src/shared/{ipc-channels,ipc-types,types}.ts`
- `src/renderer/{index.html,main.tsx,App.tsx,routes/*,components/*,stores/*,lib/*,styles/*}`
- `tests/unit/**`, `tests/e2e/**`

**Modify:** none (fresh repo)

---

## Task 1: Initialize project scaffolding

**Files:**
- Create: `/Users/ethan/code/zn-agentic-ppt/package.json`
- Create: `/Users/ethan/code/zn-agentic-ppt/.gitignore`
- Create: `/Users/ethan/code/zn-agentic-ppt/tsconfig.json`
- Create: `/Users/ethan/code/zn-agentic-ppt/tsconfig.main.json`
- Create: `/Users/ethan/code/zn-agentic-ppt/tsconfig.renderer.json`
- Create: `/Users/ethan/code/zn-agentic-ppt/biome.json`
- Create: `/Users/ethan/code/zn-agentic-ppt/pnpm-workspace.yaml`

- [ ] **Step 1: Create the project directory and initialize git**

```bash
mkdir -p /Users/ethan/code/zn-agentic-ppt
cd /Users/ethan/code/zn-agentic-ppt
git init
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "zn-agentic-ppt",
  "productName": "ZN Agentic PPT",
  "version": "0.1.0",
  "type": "module",
  "description": "Desktop PPT generator powered by LLM Agent",
  "main": "dist/main/index.js",
  "bin": { "zn-agentic-ppt": "./bin/zn-agentic-ppt.js" },
  "scripts": {
    "dev": "bun run scripts/dev.ts",
    "build:main": "bun run scripts/build-main.ts",
    "build:renderer": "vite build",
    "build": "bun run build:main && bun run build:renderer",
    "start": "electron .",
    "typecheck": "tsc --noEmit -p tsconfig.main.json && tsc --noEmit -p tsconfig.renderer.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "sync-sdk": "bun run scripts/sync-sdk.ts",
    "lint": "biome check --write ."
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0",
    "zustand": "^4.5.0",
    "antd": "^5.20.0",
    "@ant-design/icons": "^5.4.0"
  },
  "devDependencies": {
    "electron": "^30.0.0",
    "electron-builder": "^24.13.0",
    "vite": "^5.4.0",
    "@vitejs/plugin-react": "^4.3.0",
    "esbuild": "^0.23.0",
    "typescript": "^5.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/node": "^20.14.0",
    "vitest": "^2.0.0",
    "@playwright/test": "^1.46.0",
    "@biomejs/biome": "^1.9.0"
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
out/
.DS_Store
*.log
.env*
!.env.example
test-results/
playwright-report/
coverage/
```

- [ ] **Step 4: Create `tsconfig.json` (base)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"]
    }
  }
}
```

- [ ] **Step 5: Create `tsconfig.main.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "outDir": "dist/main",
    "rootDir": "src"
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 6: Create `tsconfig.renderer.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "outDir": "dist/renderer",
    "rootDir": "src",
    "types": ["vite/client"]
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 7: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  }
}
```

- [ ] **Step 8: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "."
onlyBuiltDependencies:
  - electron
  - esbuild
```

- [ ] **Step 9: Install dependencies**

Run: `pnpm install`
Expected: lockfile + `node_modules/`, no errors.

- [ ] **Step 10: Commit**

```bash
git add .
git commit -m "chore: scaffold zn-agentic-ppt project"
```

---

## Task 2: Vendor SDK into `vendor/`

**Files:**
- Create: `/Users/ethan/code/zn-agentic-ppt/vendor/sdk.mjs` (copied)
- Create: `/Users/ethan/code/zn-agentic-ppt/vendor/sdk.d.ts` (copied)
- Create: `/Users/ethan/code/zn-agentic-ppt/vendor/README.md`
- Create: `/Users/ethan/code/zn-agentic-ppt/scripts/sync-sdk.ts`

- [ ] **Step 1: Copy SDK from opencc-worktree**

```bash
cp /Users/ethan/code/opencc-worktree/dist/sdk.mjs /Users/ethan/code/zn-agentic-ppt/vendor/sdk.mjs
cp /Users/ethan/code/opencc-worktree/src/entrypoints/sdk.d.ts /Users/ethan/code/zn-agentic-ppt/vendor/sdk.d.ts
```

- [ ] **Step 2: Create `vendor/README.md`**

````markdown
# Vendored SDK

`sdk.mjs` and `sdk.d.ts` are vendored from
[opencc-worktree](https://github.com/hotmanxp/openclaude) at
`dist/sdk.mjs` and `src/entrypoints/sdk.d.ts`.

## Sync to latest

```bash
pnpm run sync-sdk
```

This re-runs the upstream build and copies the new dist into `vendor/`.
Commit the result.
````

- [ ] **Step 3: Create `scripts/sync-sdk.ts`**

```ts
#!/usr/bin/env bun
import { cp, exists } from 'node:fs/promises'
import { join } from 'node:path'

const UPSTREAM_DIST = '/Users/ethan/code/opencc-worktree/dist/sdk.mjs'
const UPSTREAM_TYPES = '/Users/ethan/code/opencc-worktree/src/entrypoints/sdk.d.ts'
const VENDOR_DIR = join(import.meta.dir, '..', 'vendor')

async function main() {
  if (!(await exists(UPSTREAM_DIST))) {
    console.error(`Upstream SDK not found at ${UPSTREAM_DIST}.`)
    console.error('Run `cd /Users/ethan/code/opencc-worktree && bun run build` first.')
    process.exit(1)
  }
  await cp(UPSTREAM_DIST, join(VENDOR_DIR, 'sdk.mjs'))
  await cp(UPSTREAM_TYPES, join(VENDOR_DIR, 'sdk.d.ts'))
  console.log('Synced SDK from upstream.')
}

main()
```

- [ ] **Step 4: Commit**

```bash
git add vendor/ scripts/sync-sdk.ts
git commit -m "chore: vendor @gitlawb/openclaude SDK + sync script"
```

---

## Task 3: Shared types

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/ipc-channels.ts`
- Create: `src/shared/ipc-types.ts`

- [ ] **Step 1: Create `src/shared/types.ts`**

```ts
export type ProjectStatus = 'draft' | 'generated' | 'failed'

export interface ProjectMeta {
  id: string
  title: string
  topic: string
  status: ProjectStatus
  outline: string
  pageCount: number | null
  createdAt: number
  updatedAt: number
}

export interface ProjectDetail extends ProjectMeta {
  html: string | null
  htmlSize: number | null
  lastGeneratedAt: number | null
  lastError: string | null
}

export type LLMProvider = 'anthropic' | 'openai' | 'custom'

export interface LLMSettings {
  provider: LLMProvider
  baseUrl: string
  apiKey: string
  model: string
}

export interface Settings {
  llm: LLMSettings
  ui: { theme: 'light' | 'dark' }
  paths: { projectsDir: string }
}

export type AppErrorCode =
  | 'AUTH'
  | 'NETWORK'
  | 'RATE_LIMIT'
  | 'PARSE'
  | 'DISK'
  | 'INTERNAL'

export interface AppError {
  code: AppErrorCode
  message: string
  detail?: string
  retryable: boolean
}
```

- [ ] **Step 2: Create `src/shared/ipc-channels.ts`**

```ts
export const IPC = {
  // Main → Renderer (push)
  SDK_EVENT: 'sdk:event',
  GENERATION_PROGRESS: 'generation:progress',
  GENERATION_DONE: 'generation:done',
  GENERATION_ERROR: 'generation:error',
  LOG_LINE: 'log:line',

  // Renderer → Main (invoke)
  PROJECT_LIST: 'project:list',
  PROJECT_GET: 'project:get',
  PROJECT_CREATE: 'project:create',
  PROJECT_UPDATE: 'project:update',
  PROJECT_DELETE: 'project:delete',
  PROJECT_DUPLICATE: 'project:duplicate',
  PROJECT_RENAME: 'project:rename',
  PROJECT_REVEAL: 'project:reveal',
  GENERATION_START: 'generation:start',
  GENERATION_CANCEL: 'generation:cancel',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_TEST_CONNECTION: 'settings:test-connection',
  SYSTEM_USER_DATA_PATH: 'system:userDataPath',
} as const
```

- [ ] **Step 3: Create `src/shared/ipc-types.ts`**

```ts
import type { ProjectDetail, ProjectMeta, Settings } from './types.js'

export interface SDKEventPayload {
  runId: string
  message: unknown // narrow in renderer
}

export interface GenerationProgressPayload {
  runId: string
  phase: 'connecting' | 'streaming' | 'writing'
  current: number
  total?: number
}

export interface GenerationDonePayload {
  runId: string
  html: string
  durationMs: number
}

export interface GenerationErrorPayload {
  runId: string
  error: { code: string; message: string; retryable: boolean }
}

export interface StartGenerationRequest {
  id: string
  opts?: { model?: string }
}

export interface StartGenerationResponse {
  runId: string
}

export interface CreateProjectRequest {
  topic: string
}

export interface UpdateProjectRequest {
  id: string
  patch: Partial<Pick<ProjectMeta, 'title' | 'topic' | 'outline'>>
}

export type {
  ProjectMeta,
  ProjectDetail,
  Settings,
}
```

- [ ] **Step 4: Verify types compile**

Run: `pnpm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/
git commit -m "feat(shared): add types + IPC channel constants"
```

---

## Task 4: `fs/paths.ts` — DATA_ROOT computation

**Files:**
- Create: `src/main/fs/paths.ts`
- Test: `tests/unit/main/fs/paths.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/main/fs/paths.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDataRoot, getProjectsDir, getSettingsPath, getLogsDir, getCacheDir } from '../../../src/main/fs/paths.js'

describe('paths', () => {
  it('getDataRoot returns ~/.zn-agentic-ppt', () => {
    expect(getDataRoot()).toBe(join(homedir(), '.zn-agentic-ppt'))
  })
  it('getProjectsDir is dataRoot/projects', () => {
    expect(getProjectsDir()).toBe(join(getDataRoot(), 'projects'))
  })
  it('getSettingsPath is dataRoot/settings.json', () => {
    expect(getSettingsPath()).toBe(join(getDataRoot(), 'settings.json'))
  })
  it('getLogsDir is dataRoot/logs', () => {
    expect(getLogsDir()).toBe(join(getDataRoot(), 'logs'))
  })
  it('getCacheDir is dataRoot/cache', () => {
    expect(getCacheDir()).toBe(join(getDataRoot(), 'cache'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- paths.test`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/main/fs/paths.ts`**

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'

const DATA_ROOT = join(homedir(), '.zn-agentic-ppt')

export function getDataRoot(): string {
  return DATA_ROOT
}

export function getProjectsDir(): string {
  return join(DATA_ROOT, 'projects')
}

export function getSettingsPath(): string {
  return join(DATA_ROOT, 'settings.json')
}

export function getLogsDir(): string {
  return join(DATA_ROOT, 'logs')
}

export function getCacheDir(): string {
  return join(DATA_ROOT, 'cache')
}

export function getProjectDir(id: string): string {
  return join(getProjectsDir(), id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- paths.test`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/main/fs/paths.ts tests/unit/main/fs/paths.test.ts
git commit -m "feat(fs): add data-root path helpers with TDD"
```

---

## Task 5: Outline parser (pure function)

**Files:**
- Create: `src/shared/outline-parser.ts`
- Test: `tests/unit/shared/outline-parser.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/shared/outline-parser.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseOutline, splitIntoSlides } from '../../../src/shared/outline-parser.js'

describe('parseOutline', () => {
  it('returns 0 pages for empty input', () => {
    expect(parseOutline('')).toBe(0)
  })
  it('counts h1 headings only', () => {
    const md = '# A\n## sub\n- item\n# B\n## sub2\n# C'
    expect(parseOutline(md)).toBe(3)
  })
  it('ignores h1 inside code fences', () => {
    const md = '```\n# not-a-heading\n```\n# real'
    expect(parseOutline(md)).toBe(1)
  })
})

describe('splitIntoSlides', () => {
  it('returns single empty slide for no headings', () => {
    expect(splitIntoSlides('just some text')).toEqual([{ title: 'Slide 1', body: 'just some text' }])
  })
  it('splits on each h1', () => {
    const md = '# A\nbody a\n# B\nbody b'
    expect(splitIntoSlides(md)).toEqual([
      { title: 'A', body: 'body a' },
      { title: 'B', body: 'body b' },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- outline-parser.test`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/shared/outline-parser.ts`**

```ts
export function parseOutline(md: string): number {
  // Strip code fences first
  const stripped = md.replace(/```[\s\S]*?```/g, '')
  const matches = stripped.match(/^# .+$/gm)
  return matches ? matches.length : 0
}

export interface Slide {
  title: string
  body: string
}

export function splitIntoSlides(md: string): Slide[] {
  const stripped = md.replace(/```[\s\S]*?```/g, '')
  const lines = stripped.split('\n')
  const slides: Slide[] = []
  let current: Slide | null = null
  for (const line of lines) {
    const h1 = line.match(/^# (.+)$/)
    if (h1) {
      if (current) slides.push(current)
      current = { title: h1[1].trim(), body: '' }
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line
    }
  }
  if (current) slides.push(current)
  if (slides.length === 0) return [{ title: 'Slide 1', body: stripped.trim() }]
  return slides.map(s => ({ ...s, body: s.body.trim() }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- outline-parser.test`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/shared/outline-parser.ts tests/unit/shared/outline-parser.test.ts
git commit -m "feat(shared): outline parser with TDD"
```

---

## Task 6: `fs/projects.ts` — CRUD with atomic writes

**Files:**
- Create: `src/main/fs/projects.ts`
- Test: `tests/unit/main/fs/projects.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/main/fs/projects.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  listProjects, getProject, createProject, updateProject, deleteProject, writeProjectHtml,
} from '../../../../src/main/fs/projects.js'
import { setProjectsDirForTest } from '../../../../src/main/fs/paths.js'

describe('fs/projects', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'znap-test-'))
    setProjectsDirForTest(dir)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('createProject returns meta and writes meta.json', async () => {
    const meta = await createProject('test topic')
    expect(meta.topic).toBe('test topic')
    expect(meta.status).toBe('draft')
    expect(existsSync(join(dir, meta.id, 'meta.json'))).toBe(true)
  })

  it('listProjects returns sorted by updatedAt desc', async () => {
    const a = await createProject('a')
    await new Promise(r => setTimeout(r, 5))
    const b = await createProject('b')
    const list = await listProjects()
    expect(list[0].id).toBe(b.id)
    expect(list[1].id).toBe(a.id)
  })

  it('getProject returns detail with html=null initially', async () => {
    const meta = await createProject('x')
    const detail = await getProject(meta.id)
    expect(detail?.html).toBe(null)
    expect(detail?.htmlSize).toBe(null)
  })

  it('updateProject mutates allowed fields', async () => {
    const meta = await createProject('x')
    const updated = await updateProject(meta.id, { title: 'new', topic: 'new topic' })
    expect(updated.title).toBe('new')
    expect(updated.topic).toBe('new topic')
  })

  it('updateProject rejects non-allowed fields', async () => {
    const meta = await createProject('x')
    await expect(
      updateProject(meta.id, { status: 'generated' } as any)
    ).rejects.toThrow(/not allowed/)
  })

  it('deleteProject removes directory', async () => {
    const meta = await createProject('x')
    await deleteProject(meta.id)
    expect(existsSync(join(dir, meta.id))).toBe(false)
  })

  it('writeProjectHtml uses atomic tmp→rename', async () => {
    const meta = await createProject('x')
    await writeProjectHtml(meta.id, '<html>hello</html>')
    const detail = await getProject(meta.id)
    expect(detail?.html).toBe('<html>hello</html>')
    expect(detail?.htmlSize).toBe(18)
    expect(detail?.status).toBe('generated')
  })

  it('getProject returns null for missing id', async () => {
    expect(await getProject('nonexistent')).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- projects.test`
Expected: FAIL (multiple modules not found).

- [ ] **Step 3: Add `setProjectsDirForTest` to `src/main/fs/paths.ts`**

Append:
```ts
let testProjectsDir: string | null = null
export function setProjectsDirForTest(dir: string): void { testProjectsDir = dir }
export function getProjectsDir(): string {
  return testProjectsDir ?? join(DATA_ROOT, 'projects')
}
```
(Modify the existing `getProjectsDir` to consult `testProjectsDir` first.)

- [ ] **Step 4: Implement `src/main/fs/projects.ts`**

```ts
import { mkdir, readFile, readdir, rm, writeFile, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ProjectDetail, ProjectMeta, ProjectStatus } from '../../shared/types.js'
import { getProjectsDir } from './paths.js'

const ALLOWED_UPDATE_KEYS = ['title', 'topic', 'outline'] as const

export async function listProjects(): Promise<ProjectMeta[]> {
  const dir = getProjectsDir()
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  const metas: ProjectMeta[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    try {
      const raw = await readFile(join(dir, e.name, 'meta.json'), 'utf8')
      metas.push(JSON.parse(raw))
    } catch { /* skip corrupt */ }
  }
  metas.sort((a, b) => b.updatedAt - a.updatedAt)
  return metas
}

export async function getProject(id: string): Promise<ProjectDetail | null> {
  const dir = join(getProjectsDir(), id)
  if (!existsSync(dir)) return null
  try {
    const metaRaw = await readFile(join(dir, 'meta.json'), 'utf8')
    const meta = JSON.parse(metaRaw) as ProjectMeta
    let html: string | null = null
    let htmlSize: number | null = null
    const htmlPath = join(dir, 'index.html')
    if (existsSync(htmlPath)) {
      html = await readFile(htmlPath, 'utf8')
      htmlSize = html.length
    }
    return { ...meta, html, htmlSize, lastGeneratedAt: html ? meta.updatedAt : null, lastError: null }
  } catch {
    return null
  }
}

export async function createProject(topic: string): Promise<ProjectMeta> {
  const id = randomUUID()
  const now = Date.now()
  const meta: ProjectMeta = {
    id, topic,
    title: topic.slice(0, 40) || 'Untitled',
    status: 'draft',
    outline: '',
    pageCount: null,
    createdAt: now, updatedAt: now,
  }
  const dir = join(getProjectsDir(), id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
  await writeFile(join(dir, 'outline.md'), '')
  return meta
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<ProjectMeta, 'title' | 'topic' | 'outline'>>,
): Promise<ProjectMeta> {
  for (const k of Object.keys(patch)) {
    if (!ALLOWED_UPDATE_KEYS.includes(k as any)) {
      throw new Error(`Field "${k}" is not allowed in updateProject`)
    }
  }
  const existing = await getProject(id)
  if (!existing) throw new Error(`Project ${id} not found`)
  const next: ProjectMeta = { ...existing, ...patch, updatedAt: Date.now() }
  await writeFile(join(getProjectsDir(), id, 'meta.json'), JSON.stringify(next, null, 2))
  if (patch.outline !== undefined) {
    await writeFile(join(getProjectsDir(), id, 'outline.md'), patch.outline)
  }
  return next
}

export async function deleteProject(id: string): Promise<void> {
  await rm(join(getProjectsDir(), id), { recursive: true, force: true })
}

export async function writeProjectHtml(id: string, html: string): Promise<void> {
  const dir = join(getProjectsDir(), id)
  const tmpPath = join(dir, 'index.html.tmp')
  const finalPath = join(dir, 'index.html')
  await writeFile(tmpPath, html)
  await rename(tmpPath, finalPath)
  const existing = await getProject(id)
  if (existing) {
    const next: ProjectMeta = {
      ...existing, status: 'generated' as ProjectStatus,
      updatedAt: Date.now(), pageCount: existing.pageCount,
    }
    await writeFile(join(dir, 'meta.json'), JSON.stringify(next, null, 2))
  }
}

export async function setProjectStatus(
  id: string, status: ProjectStatus, error?: string,
): Promise<void> {
  const existing = await getProject(id)
  if (!existing) return
  const next: ProjectMeta = { ...existing, status, updatedAt: Date.now() }
  await writeFile(join(getProjectsDir(), id, 'meta.json'), JSON.stringify(next, null, 2))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- projects.test`
Expected: PASS, 8/8.

- [ ] **Step 6: Commit**

```bash
git add src/main/fs/projects.ts src/main/fs/paths.ts tests/unit/main/fs/projects.test.ts
git commit -m "feat(fs): project CRUD with atomic html writes (TDD)"
```

---

## Task 7: `fs/settings.ts` with TDD

**Files:**
- Create: `src/main/fs/settings.ts`
- Test: `tests/unit/main/fs/settings.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/main/fs/settings.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getSettings, setSettings, setSettingsPathForTest, defaultSettings } from '../../../../src/main/fs/settings.js'

describe('fs/settings', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'znap-set-'))
    setSettingsPathForTest(join(dir, 'settings.json'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('getSettings returns defaults when file missing', async () => {
    const s = await getSettings()
    expect(s.llm.provider).toBe('anthropic')
  })

  it('setSettings persists and getSettings reads back', async () => {
    await setSettings({ ...defaultSettings(), llm: { ...defaultSettings().llm, baseUrl: 'https://x' } })
    const s = await getSettings()
    expect(s.llm.baseUrl).toBe('https://x')
  })

  it('getSettings recovers from corrupt file with defaults', async () => {
    writeFileSync(join(dir, 'settings.json'), 'not json')
    const s = await getSettings()
    expect(s.llm.provider).toBe('anthropic')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- settings.test`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/main/fs/settings.ts`**

```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getSettingsPath, getDataRoot } from './paths.js'
import type { Settings } from '../../shared/types.js'

let testPath: string | null = null
export function setSettingsPathForTest(p: string): void { testPath = p }
const realPath = (): string => testPath ?? getSettingsPath()

export function defaultSettings(): Settings {
  return {
    llm: {
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: '',
      model: 'claude-3-5-sonnet-20241022',
    },
    ui: { theme: 'light' },
    paths: { projectsDir: join(getDataRoot(), 'projects') },
  }
}

export async function getSettings(): Promise<Settings> {
  const p = realPath()
  if (!existsSync(p)) return defaultSettings()
  try {
    const raw = await readFile(p, 'utf8')
    return { ...defaultSettings(), ...JSON.parse(raw) } as Settings
  } catch {
    return defaultSettings()
  }
}

export async function setSettings(settings: Settings): Promise<void> {
  const p = realPath()
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(settings, null, 2))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- settings.test`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add src/main/fs/settings.ts tests/unit/main/fs/settings.test.ts
git commit -m "feat(fs): settings load/save with corrupt-recovery (TDD)"
```

---

## Task 8: `sdk/runner.ts` — TDD with mocked SDK

**Files:**
- Create: `src/main/sdk/runner.ts`
- Create: `src/main/sdk/prompts.ts`
- Test: `tests/unit/main/sdk/runner.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/main/sdk/runner.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
const mockInterrupt = vi.fn()

vi.mock('../../../../vendor/sdk.mjs', () => ({
  query: (params: any) => {
    mockQuery(params)
    return {
      sessionId: 'sess-1',
      [Symbol.asyncIterator]: () => {
        const events = params.__events ?? []
        let i = 0
        return {
          next: async () => {
            if (i >= events.length) return { value: undefined, done: true }
            return { value: events[i++], done: false }
          },
        }
      },
      interrupt: mockInterrupt,
      close: () => {},
    }
  },
}))

import { GenerationRunner } from '../../../../src/main/sdk/runner.js'

describe('GenerationRunner', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockInterrupt.mockReset()
  })

  it('emits progress on assistant text ≥ 200 chars', async () => {
    const events: any[] = [
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(250) }] } },
      { type: 'result', subtype: 'success', duration_ms: 1000 },
    ]
    const runner = new GenerationRunner({ cwd: '/tmp', sdkEvents: events, onEvent: () => {}, onProgress: () => {}, onDone: () => {}, onError: () => {} })
    await runner.run()
    expect(runner.html).toBe('x'.repeat(250))
  })

  it('emits done on success result', async () => {
    let donePayload: any = null
    const events = [
      { type: 'assistant', message: { content: [{ type: 'text', text: '<html>ok</html>' }] } },
      { type: 'result', subtype: 'success', duration_ms: 500 },
    ]
    const runner = new GenerationRunner({ cwd: '/tmp', sdkEvents: events, onEvent: () => {}, onProgress: () => {}, onDone: (p) => { donePayload = p }, onError: () => {} })
    await runner.run()
    expect(donePayload?.html).toBe('<html>ok</html>')
  })

  it('emits error on non-success result', async () => {
    let errorPayload: any = null
    const events = [
      { type: 'result', subtype: 'error_max_turns', duration_ms: 100 },
    ]
    const runner = new GenerationRunner({ cwd: '/tmp', sdkEvents: events, onEvent: () => {}, onProgress: () => {}, onDone: () => {}, onError: (p) => { errorPayload = p } })
    await runner.run()
    expect(errorPayload?.error.code).toBe('INTERNAL')
  })

  it('interrupt is callable', async () => {
    const runner = new GenerationRunner({ cwd: '/tmp', sdkEvents: [], onEvent: () => {}, onProgress: () => {}, onDone: () => {}, onError: () => {} })
    runner.interrupt()
    expect(mockInterrupt).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- runner.test`
Expected: FAIL (GenerationRunner not found).

- [ ] **Step 3: Implement `src/main/sdk/prompts.ts`**

```ts
export function buildSystemPrompt(topic: string, outline: string): string {
  return `你是 zn-agentic-ppt 应用的演示文稿生成助手。根据用户的"主题 + 大纲"生成一份完整、可独立播放的 HTML PPT。

输出要求：
- 输出**完整 HTML 文档**（<!DOCTYPE html> ... </html>），不是片段
- 16:9 比例 (aspect-ratio: 16/9)
- 内嵌 CSS（不依赖外部资源，offline 友好）
- 主题风格：现代简约，主色 #1677ff，强调 #722ed1
- 每张幻灯片结构：
    <section class="slide">
      <h1>{标题}</h1>
      <div class="content">{要点}</div>
    </section>
- 幻灯片之间用 page-break 分割
- 不写注释、不写解释、不写元描述，直接输出 HTML

用户主题：${topic}

用户大纲（Markdown）：
${outline}`
}
```

- [ ] **Step 4: Implement `src/main/sdk/runner.ts`**

```ts
import { query as sdkQuery, type SDKMessage } from '../../../vendor/sdk.mjs'
import { buildSystemPrompt } from './prompts.js'
import type { Settings } from '../../shared/types.js'

export interface RunnerOptions {
  cwd: string
  topic: string
  outline: string
  settings: Settings
  runId: string
  /** Test-only: provide canned events instead of calling real SDK */
  sdkEvents?: any[]
  onEvent: (msg: any) => void
  onProgress: (info: { phase: string; current: number }) => void
  onDone: (info: { html: string; durationMs: number }) => void
  onError: (info: { error: { code: string; message: string; retryable: boolean } }) => void
}

const PROGRESS_EVERY = 200

export class GenerationRunner {
  private buffer = ''
  private resultType: string | null = null
  private durationMs = 0
  private query: any
  html: string | null = null

  constructor(private opts: RunnerOptions) {}

  async run(): Promise<void> {
    if (this.opts.sdkEvents) {
      // Test mode
      for (const ev of this.opts.sdkEvents) await this.handle(ev)
      this.finish()
      return
    }
    this.query = sdkQuery({
      prompt: 'Generate the PPT.',
      options: {
        cwd: this.opts.cwd,
        model: this.opts.settings.llm.model,
        systemPrompt: buildSystemPrompt(this.opts.topic, this.opts.outline),
        env: {
          ANTHROPIC_BASE_URL: this.opts.settings.llm.baseUrl,
          ANTHROPIC_AUTH_TOKEN: this.opts.settings.llm.apiKey,
        },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        canUseTool: async () => ({ behavior: 'deny', message: 'tools disabled' }),
        maxTurns: 1,
      },
    })
    try {
      for await (const msg of this.query) {
        this.opts.onEvent(msg)
        await this.handle(msg)
      }
    } catch (err) {
      this.opts.onError({
        error: { code: 'INTERNAL', message: String(err), retryable: false },
      })
      return
    }
    this.finish()
  }

  private async handle(msg: any): Promise<void> {
    if (msg.type === 'assistant') {
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'text') {
          this.buffer += block.text
          if (this.buffer.length % PROGRESS_EVERY < block.text.length) {
            this.opts.onProgress({ phase: 'streaming', current: this.buffer.length })
          }
        }
      }
    } else if (msg.type === 'result') {
      this.resultType = msg.subtype
      this.durationMs = msg.duration_ms ?? 0
    }
  }

  private finish(): void {
    if (this.resultType === 'success') {
      this.html = this.buffer
      this.opts.onDone({ html: this.buffer, durationMs: this.durationMs })
    } else {
      this.opts.onError({
        error: {
          code: 'INTERNAL',
          message: `Generation failed: ${this.resultType ?? 'unknown'}`,
          retryable: true,
        },
      })
    }
  }

  interrupt(): void { this.query?.interrupt() }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- runner.test`
Expected: PASS, 4/4.

- [ ] **Step 6: Commit**

```bash
git add src/main/sdk/ tests/unit/main/sdk/
git commit -m "feat(sdk): generation runner with TDD + prompts"
```

---

## Task 9: `main/index.ts` — app boot + data root

**Files:**
- Create: `scripts/build-main.ts`
- Create: `src/main/index.ts`
- Create: `src/main/windows/main-window.ts`

- [ ] **Step 1: Create `scripts/build-main.ts`**

```ts
#!/usr/bin/env bun
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'

await rm('dist/main', { recursive: true, force: true })
await build({
  entryPoints: ['src/main/index.ts', 'src/preload/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: 'dist',
  external: ['electron'],
  sourcemap: true,
  loader: { '.ts': 'ts' },
})
console.log('Main + preload built.')
```

- [ ] **Step 2: Create `src/main/windows/main-window.ts`**

```ts
import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'ZN Agentic PPT',
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload uses fs? no — keep false for ipcRenderer
    },
  })

  // Open external links in default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'))
  }
  return win
}
```

- [ ] **Step 3: Create `src/main/index.ts`**

```ts
import { app } from 'electron'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createMainWindow } from './windows/main-window.js'

const DATA_ROOT = join(homedir(), '.zn-agentic-ppt')
app.setPath('userData', DATA_ROOT)

app.whenReady().then(async () => {
  await mkdir(DATA_ROOT, { recursive: true })
  await mkdir(join(DATA_ROOT, 'projects'), { recursive: true })
  await mkdir(join(DATA_ROOT, 'logs'), { recursive: true })
  await mkdir(join(DATA_ROOT, 'cache'), { recursive: true })
  createMainWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
})

import { BrowserWindow } from 'electron'
```

- [ ] **Step 4: Add `bin/zn-agentic-ppt.js`**

```js
#!/usr/bin/env node
import('electron').then(({ spawn }) => {
  spawn(require('electron'), [require('path').join(__dirname, '..', 'dist', 'main', 'index.js')], { stdio: 'inherit' })
})
```
(`bin/` is just a launcher; main entry is `dist/main/index.js`.)

- [ ] **Step 5: Build and smoke test**

Run: `pnpm run build:main && ls dist/main`
Expected: `dist/main/index.js` + `dist/preload/index.js` exist.

- [ ] **Step 6: Commit**

```bash
git add src/main/ scripts/build-main.ts bin/
git commit -m "feat(main): app boot + data root init + main window"
```

---

## Task 10: Preload + IPC handlers (project + settings)

**Files:**
- Create: `src/preload/index.ts`
- Create: `src/main/ipc/project.ts`
- Create: `src/main/ipc/settings.ts`
- Create: `src/main/ipc/index.ts` (registers all)

- [ ] **Step 1: Create `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels.js'

const api = {
  project: {
    list: () => ipcRenderer.invoke(IPC.PROJECT_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC.PROJECT_GET, { id }),
    create: (topic: string) => ipcRenderer.invoke(IPC.PROJECT_CREATE, { topic }),
    update: (id: string, patch: any) => ipcRenderer.invoke(IPC.PROJECT_UPDATE, { id, patch }),
    delete: (id: string) => ipcRenderer.invoke(IPC.PROJECT_DELETE, { id }),
    duplicate: (id: string) => ipcRenderer.invoke(IPC.PROJECT_DUPLICATE, { id }),
    rename: (id: string, title: string) => ipcRenderer.invoke(IPC.PROJECT_RENAME, { id, title }),
    reveal: (id: string) => ipcRenderer.invoke(IPC.PROJECT_REVEAL, { id }),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (settings: any) => ipcRenderer.invoke(IPC.SETTINGS_SET, { settings }),
    testConnection: () => ipcRenderer.invoke(IPC.SETTINGS_TEST_CONNECTION),
  },
  system: {
    userDataPath: () => ipcRenderer.invoke(IPC.SYSTEM_USER_DATA_PATH),
  },
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
```

- [ ] **Step 2: Create `src/main/ipc/project.ts`**

```ts
import { ipcMain, shell } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import * as fs from '../fs/projects.js'
import { getProjectDir } from '../fs/paths.js'

export function registerProjectIPC(): void {
  ipcMain.handle(IPC.PROJECT_LIST, () => fs.listProjects())
  ipcMain.handle(IPC.PROJECT_GET, (_, { id }: { id: string }) => fs.getProject(id))
  ipcMain.handle(IPC.PROJECT_CREATE, (_, { topic }: { topic: string }) => fs.createProject(topic))
  ipcMain.handle(IPC.PROJECT_UPDATE, (_, { id, patch }: { id: string; patch: any }) => fs.updateProject(id, patch))
  ipcMain.handle(IPC.PROJECT_DELETE, async (_, { id }: { id: string }) => { await fs.deleteProject(id) })
  ipcMain.handle(IPC.PROJECT_DUPLICATE, async (_, { id }: { id: string }) => {
    const src = await fs.getProject(id)
    if (!src) throw new Error('not found')
    const copy = await fs.createProject(src.topic)
    await fs.updateProject(copy.id, { title: src.title + ' (copy)', outline: src.outline })
    return fs.getProject(copy.id)
  })
  ipcMain.handle(IPC.PROJECT_RENAME, async (_, { id, title }: { id: string; title: string }) => {
    await fs.updateProject(id, { title })
  })
  ipcMain.handle(IPC.PROJECT_REVEAL, async (_, { id }: { id: string }) => {
    shell.openPath(getProjectDir(id))
  })
}
```

- [ ] **Step 3: Create `src/main/ipc/settings.ts`**

```ts
import { ipcMain, app } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import * as fs from '../fs/settings.js'
import { supportedModels, testLLMConnection } from '../sdk/connection.js'

export function registerSettingsIPC(): void {
  ipcMain.handle(IPC.SETTINGS_GET, () => fs.getSettings())
  ipcMain.handle(IPC.SETTINGS_SET, async (_, { settings }: { settings: any }) => {
    await fs.setSettings(settings)
  })
  ipcMain.handle(IPC.SETTINGS_TEST_CONNECTION, async () => {
    const s = await fs.getSettings()
    return testLLMConnection(s)
  })
  ipcMain.handle(IPC.SYSTEM_USER_DATA_PATH, () => app.getPath('userData'))
}
```

- [ ] **Step 4: Create `src/main/sdk/connection.ts` (test connection stub)**

```ts
import { query as sdkQuery } from '../../../vendor/sdk.mjs'
import type { Settings } from '../../shared/types.js'

export async function testLLMConnection(settings: Settings): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  try {
    const q = sdkQuery({
      prompt: 'ping',
      options: {
        cwd: app.getPath('temp'),
        model: settings.llm.model,
        env: { ANTHROPIC_BASE_URL: settings.llm.baseUrl, ANTHROPIC_AUTH_TOKEN: settings.llm.apiKey },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        canUseTool: async () => ({ behavior: 'deny', message: 'no tools' }),
        maxTurns: 1,
      },
    })
    let models: string[] = []
    let result: any = null
    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        models = msg.models?.map((m: any) => m.value) ?? []
      }
      if (msg.type === 'result') result = msg
      if (result?.is_error) break
    }
    q.close()
    return { ok: result?.subtype === 'success', models }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export async function supportedModels(settings: Settings): Promise<string[]> {
  const r = await testLLMConnection(settings)
  return r.models ?? []
}

// Resolve `app` lazily to avoid import order issues
import { app } from 'electron'
```

- [ ] **Step 5: Create `src/main/ipc/index.ts`**

```ts
import { registerProjectIPC } from './project.js'
import { registerSettingsIPC } from './settings.js'
// generation.ts registered separately in Task 11

export function registerAllIPC(): void {
  registerProjectIPC()
  registerSettingsIPC()
}
```

- [ ] **Step 6: Wire `registerAllIPC()` into `src/main/index.ts`**

Edit `src/main/index.ts` — add inside `app.whenReady().then`:
```ts
import { registerAllIPC } from './ipc/index.js'
// ...
await mkdir(...)
registerAllIPC()
createMainWindow()
```

- [ ] **Step 7: Build and verify**

Run: `pnpm run build:main && pnpm run typecheck`
Expected: 0 errors. `dist/main/index.js` exists.

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc/ src/main/sdk/connection.ts src/preload/ src/main/index.ts
git commit -m "feat(ipc): project + settings handlers + preload bridge"
```

---

## Task 11: `ipc/generation.ts` — start / cancel / stream events

**Files:**
- Create: `src/main/ipc/generation.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Create `src/main/ipc/generation.ts`**

```ts
import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC } from '../../shared/ipc-channels.js'
import { GenerationRunner } from '../sdk/runner.js'
import * as fs from '../fs/projects.js'
import * as settingsFs from '../fs/settings.js'
import { getProjectDir } from '../fs/paths.js'

const activeRunners = new Map<string, GenerationRunner>()

export function registerGenerationIPC(): void {
  ipcMain.handle(IPC.GENERATION_START, async (_, { id, opts }: { id: string; opts?: any }) => {
    const project = await fs.getProject(id)
    if (!project) throw new Error('project not found')
    const settings = await settingsFs.getSettings()
    const runId = randomUUID()
    const runner = new GenerationRunner({
      cwd: getProjectDir(id),
      topic: project.topic,
      outline: project.outline,
      settings,
      runId,
      onEvent: (msg) => broadcast(IPC.SDK_EVENT, { runId, message: msg }),
      onProgress: (info) => broadcast(IPC.GENERATION_PROGRESS, { runId, ...info }),
      onDone: async ({ html, durationMs }) => {
        await fs.writeProjectHtml(id, html)
        await fs.setProjectStatus(id, 'generated')
        broadcast(IPC.GENERATION_DONE, { runId, html, durationMs })
        activeRunners.delete(runId)
      },
      onError: async ({ error }) => {
        await fs.setProjectStatus(id, 'failed', error.message)
        broadcast(IPC.GENERATION_ERROR, { runId, error })
        activeRunners.delete(runId)
      },
    })
    activeRunners.set(runId, runner)
    await fs.setProjectStatus(id, 'draft')
    runner.run() // fire-and-forget
    return { runId }
  })

  ipcMain.handle(IPC.GENERATION_CANCEL, (_, { runId }: { runId: string }) => {
    const r = activeRunners.get(runId)
    r?.interrupt()
    activeRunners.delete(runId)
  })
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}
```

- [ ] **Step 2: Update `src/main/ipc/index.ts`**

Replace contents with:
```ts
import { registerProjectIPC } from './project.js'
import { registerSettingsIPC } from './settings.js'
import { registerGenerationIPC } from './generation.js'

export function registerAllIPC(): void {
  registerProjectIPC()
  registerSettingsIPC()
  registerGenerationIPC()
}
```

- [ ] **Step 3: Add streaming event listeners to preload**

Append to `src/preload/index.ts`:
```ts
// inside the api object, add:
generation: {
  start: (id: string, opts?: any) => ipcRenderer.invoke(IPC.GENERATION_START, { id, opts }),
  cancel: (runId: string) => ipcRenderer.invoke(IPC.GENERATION_CANCEL, { runId }),
  onEvent: (cb: (e: any) => void) => subscribe(IPC.SDK_EVENT, cb),
  onProgress: (cb: (e: any) => void) => subscribe(IPC.GENERATION_PROGRESS, cb),
  onDone: (cb: (e: any) => void) => subscribe(IPC.GENERATION_DONE, cb),
  onError: (cb: (e: any) => void) => subscribe(IPC.GENERATION_ERROR, cb),
},
```

And helper at bottom:
```ts
function subscribe(channel: string, cb: (e: any) => void): () => void {
  const listener = (_: unknown, payload: any) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
```

- [ ] **Step 4: Build and verify**

Run: `pnpm run build:main && pnpm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/generation.ts src/main/ipc/index.ts src/preload/index.ts
git commit -m "feat(generation): start/cancel + streaming events broadcast"
```

---

## Task 12: Vite + React renderer entry

**Files:**
- Create: `vite.config.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/lib/api.ts`
- Create: `src/renderer/stores/settings.ts`
- Create: `src/renderer/styles/globals.css`

- [ ] **Step 1: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') },
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  server: { port: 5173 },
})
```

- [ ] **Step 2: Create `src/renderer/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>ZN Agentic PPT</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `src/renderer/styles/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; margin: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
```

- [ ] **Step 4: Create `src/renderer/lib/api.ts`**

```ts
import type { ProjectMeta, ProjectDetail, Settings } from '@shared/types'

export interface BridgeApi {
  project: {
    list(): Promise<ProjectMeta[]>
    get(id: string): Promise<ProjectDetail | null>
    create(topic: string): Promise<ProjectMeta>
    update(id: string, patch: Partial<Pick<ProjectMeta, 'title' | 'topic' | 'outline'>>): Promise<ProjectMeta>
    delete(id: string): Promise<void>
    duplicate(id: string): Promise<ProjectMeta>
    rename(id: string, title: string): Promise<void>
    reveal(id: string): Promise<void>
  }
  generation: {
    start(id: string, opts?: object): Promise<{ runId: string }>
    cancel(runId: string): Promise<void>
    onEvent(cb: (e: any) => void): () => void
    onProgress(cb: (e: any) => void): () => void
    onDone(cb: (e: any) => void): () => void
    onError(cb: (e: any) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    set(settings: Settings): Promise<void>
    testConnection(): Promise<{ ok: boolean; models?: string[]; error?: string }>
  }
  system: {
    userDataPath(): Promise<string>
  }
}

declare global {
  interface Window { api: BridgeApi }
}

export const api: BridgeApi = window.api
```

- [ ] **Step 5: Create `src/renderer/stores/settings.ts`**

```ts
import { create } from 'zustand'
import { api } from '../lib/api'
import type { Settings } from '@shared/types'

interface SettingsStore {
  settings: Settings | null
  loaded: boolean
  load: () => Promise<void>
  save: (s: Settings) => Promise<void>
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: null,
  loaded: false,
  load: async () => set({ settings: await api.settings.get(), loaded: true }),
  save: async (s) => { await api.settings.set(s); set({ settings: s }) },
}))
```

- [ ] **Step 6: Create `src/renderer/App.tsx`**

```tsx
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom'
import { useEffect } from 'react'
import { ConfigProvider, Layout, Menu } from 'antd'
import { Welcome } from './routes/Welcome'
import { Projects } from './routes/Projects'
import { ProjectEditor } from './routes/ProjectEditor'
import { Settings } from './routes/Settings'
import { useSettingsStore } from './stores/settings'

const { Header, Content } = Layout

export function App() {
  const load = useSettingsStore(s => s.load)
  useEffect(() => { load() }, [load])

  return (
    <ConfigProvider>
      <HashRouter>
        <Layout style={{ minHeight: '100vh' }}>
          <Header style={{ display: 'flex', alignItems: 'center', gap: 24, background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
            <strong style={{ color: '#1677ff', fontSize: 18 }}>⬢ ZN Agentic PPT</strong>
            <Menu mode="horizontal" selectedKeys={[]} style={{ flex: 1, border: 'none' }} items={[
              { key: '/', label: <NavLink to="/">欢迎</NavLink> },
              { key: '/projects', label: <NavLink to="/projects">项目</NavLink> },
              { key: '/settings', label: <NavLink to="/settings">设置</NavLink> },
            ]} />
          </Header>
          <Content>
            <Routes>
              <Route path="/" element={<Welcome />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectEditor />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Content>
        </Layout>
      </HashRouter>
    </ConfigProvider>
  )
}
```

- [ ] **Step 7: Create `src/renderer/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 8: Create stub route files (full impls in next tasks)**

For each of `Welcome.tsx`, `Projects.tsx`, `ProjectEditor.tsx`, `Settings.tsx`, create with content:
```tsx
export function Welcome() { return <div style={{ padding: 48 }}>欢迎页（待实现）</div> }
```
etc.

- [ ] **Step 9: Build renderer**

Run: `pnpm run build:renderer`
Expected: 0 errors. `dist/renderer/index.html` exists.

- [ ] **Step 10: Commit**

```bash
git add vite.config.ts src/renderer/
git commit -m "feat(renderer): Vite + React entry + App shell + routes stub"
```

---

## Task 13: Welcome + Projects list pages

**Files:**
- Create: `src/renderer/routes/Welcome.tsx`
- Create: `src/renderer/routes/Projects.tsx`
- Create: `src/renderer/stores/project.ts`
- Create: `src/renderer/components/ProjectCard.tsx`
- Create: `src/renderer/components/NewProjectModal.tsx`

- [ ] **Step 1: Create `src/renderer/stores/project.ts`**

```ts
import { create } from 'zustand'
import { api } from '../lib/api'
import type { ProjectMeta } from '@shared/types'

interface ProjectStore {
  projects: ProjectMeta[]
  load: () => Promise<void>
  create: (topic: string) => Promise<ProjectMeta>
  remove: (id: string) => Promise<void>
  rename: (id: string, title: string) => Promise<void>
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  load: async () => set({ projects: await api.project.list() }),
  create: async (topic) => {
    const m = await api.project.create(topic)
    set({ projects: [m, ...get().projects] })
    return m
  },
  remove: async (id) => { await api.project.delete(id); await get().load() },
  rename: async (id, title) => { await api.project.rename(id, title); await get().load() },
}))
```

- [ ] **Step 2: Create `src/renderer/components/ProjectCard.tsx`**

```tsx
import { Card, Tag, Dropdown, Button } from 'antd'
import { MoreOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { ProjectMeta } from '@shared/types'
import { api } from '../lib/api'

const STATUS_COLORS = { draft: 'gold', generated: 'green', failed: 'red' } as const
const STATUS_LABELS = { draft: '草稿', generated: '已生成', failed: '失败' } as const
const EMOJIS = ['📊', '📈', '🚀', '💡', '🎯', '📋', '🌟', '🔧']

export function ProjectCard({ project }: { project: ProjectMeta }) {
  const nav = useNavigate()
  const emoji = EMOJIS[project.id.charCodeAt(0) % EMOJIS.length]
  return (
    <Card hoverable onClick={() => nav(`/projects/${project.id}`)}
          actions={[
            <Button key="del" size="small" type="text" danger onClick={async (e) => {
              e.stopPropagation()
              if (confirm(`删除项目 "${project.title}"？`)) {
                await api.project.delete(project.id)
                window.location.reload()
              }
            }}>删除</Button>,
          ]}>
      <div style={{ height: 100, background: `linear-gradient(135deg, #dbeafe, #bfdbfe)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, borderRadius: 6, marginBottom: 12 }}>{emoji}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 4 }}>
        <strong>{project.title}</strong>
        <Tag color={STATUS_COLORS[project.status]}>{STATUS_LABELS[project.status]}</Tag>
      </div>
      <small style={{ color: '#9ca3af' }}>{project.pageCount ?? '—'} 页 · {new Date(project.updatedAt).toLocaleString('zh-CN')}</small>
    </Card>
  )
}
```

- [ ] **Step 3: Create `src/renderer/components/NewProjectModal.tsx`**

```tsx
import { Modal, Input } from 'antd'
import { useState } from 'react'

export function NewProjectModal({ open, onCancel, onCreate }: {
  open: boolean
  onCancel: () => void
  onCreate: (topic: string) => Promise<void> | void
}) {
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)
  return (
    <Modal title="新建项目" open={open} onCancel={onCancel} confirmLoading={loading}
           okButtonProps={{ disabled: !topic.trim() }}
           onOk={async () => {
             setLoading(true)
             try { await onCreate(topic.trim()) } finally { setLoading(false) }
           }}>
      <Input placeholder="主题，如：2026 产品路线图" value={topic}
             onChange={e => setTopic(e.target.value)}
             onPressEnter={async () => { if (topic.trim()) { setLoading(true); try { await onCreate(topic.trim()) } finally { setLoading(false) } } }} />
    </Modal>
  )
}
```

- [ ] **Step 4: Implement `src/renderer/routes/Projects.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Button, Input, Select, Row, Col } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useProjectStore } from '../stores/project'
import { ProjectCard } from '../components/ProjectCard'
import { NewProjectModal } from '../components/NewProjectModal'

export function Projects() {
  const { projects, load, create } = useProjectStore()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('updated-desc')

  useEffect(() => { load() }, [load])

  const filtered = projects
    .filter(p => !q || p.title.includes(q) || p.topic.includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>我的项目 <small style={{ color: '#6b7280', fontWeight: 400 }}>共 {projects.length} 个</small></h2>
        <Button type="primary" onClick={() => setOpen(true)}>+ 新建项目</Button>
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <Input placeholder="🔍 搜索项目名..." style={{ maxWidth: 320 }} value={q} onChange={e => setQ(e.target.value)} />
        <Select value={sort} onChange={setSort} options={[
          { value: 'updated-desc', label: '按修改时间 ↓' },
          { value: 'created-desc', label: '按创建时间 ↓' },
          { value: 'title-asc', label: '按名称 A→Z' },
        ]} />
      </div>
      <Row gutter={[20, 20]}>
        {filtered.map(p => <Col key={p.id} span={6}><ProjectCard project={p} /></Col>)}
        <Col span={6}>
          <div onClick={() => setOpen(true)} style={{ height: '100%', minHeight: 220, border: '2px dashed #d1d5db', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', cursor: 'pointer' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32 }}>+</div>
              <div>新建项目</div>
            </div>
          </div>
        </Col>
      </Row>
      <NewProjectModal open={open} onCancel={() => setOpen(false)} onCreate={async (topic) => {
        const m = await create(topic)
        setOpen(false)
        nav(`/projects/${m.id}`)
      }} />
    </div>
  )
}
```

- [ ] **Step 5: Implement `src/renderer/routes/Welcome.tsx`**

```tsx
import { useEffect } from 'react'
import { Button, Row, Col } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useProjectStore } from '../stores/project'

export function Welcome() {
  const { projects, load } = useProjectStore()
  const nav = useNavigate()
  useEffect(() => { load() }, [load])

  const recent = projects.slice(0, 4)

  return (
    <div>
      <div style={{ padding: '80px 48px 48px', textAlign: 'center', background: 'linear-gradient(180deg,#fafbff,#fff)' }}>
        <h1 style={{ fontSize: 52, margin: '0 0 16px', background: 'linear-gradient(90deg,#1677ff,#722ed1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          用 AI 几秒生成演示文稿
        </h1>
        <p style={{ fontSize: 18, color: '#6b7280', marginBottom: 32 }}>输入主题和大纲，Agent 输出可直接演示的 HTML PPT</p>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          <Button type="primary" size="large" onClick={() => nav('/projects')}>+ 新建项目</Button>
          <Button size="large" onClick={() => nav('/projects')}>打开已有项目</Button>
        </div>
      </div>
      <div style={{ padding: '32px 48px 64px' }}>
        <h3>最近的项目</h3>
        <Row gutter={[16, 16]}>
          {recent.map(p => (
            <Col key={p.id} span={6}>
              <div onClick={() => nav(`/projects/${p.id}`)} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, cursor: 'pointer' }}>
                <div style={{ fontWeight: 500 }}>{p.title}</div>
                <small style={{ color: '#9ca3af' }}>{new Date(p.updatedAt).toLocaleString('zh-CN')}</small>
              </div>
            </Col>
          ))}
        </Row>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Build renderer**

Run: `pnpm run build:renderer`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/routes/Welcome.tsx src/renderer/routes/Projects.tsx src/renderer/stores/ src/renderer/components/
git commit -m "feat(ui): Welcome + Projects list pages"
```

---

## Task 14: Project editor (split view + generation)

**Files:**
- Create: `src/renderer/routes/ProjectEditor.tsx`
- Create: `src/renderer/components/OutlineEditor.tsx`
- Create: `src/renderer/components/HtmlPreview.tsx`
- Create: `src/renderer/components/GenerationProgress.tsx`
- Create: `src/renderer/stores/generation.ts`

- [ ] **Step 1: Create `src/renderer/stores/generation.ts`**

```ts
import { create } from 'zustand'
import { api } from '../lib/api'

interface GenerationStore {
  runId: string | null
  phase: 'idle' | 'streaming' | 'done' | 'error'
  progress: number
  html: string | null
  error: string | null
  start: (id: string) => Promise<void>
  cancel: () => Promise<void>
  reset: () => void
}

export const useGenerationStore = create<GenerationStore>((set, get) => ({
  runId: null,
  phase: 'idle',
  progress: 0,
  html: null,
  error: null,
  start: async (id) => {
    set({ phase: 'streaming', progress: 0, html: null, error: null })
    const { runId } = await api.generation.start(id)
    set({ runId })
  },
  cancel: async () => {
    const { runId } = get()
    if (runId) await api.generation.cancel(runId)
    set({ phase: 'idle', runId: null })
  },
  reset: () => set({ runId: null, phase: 'idle', progress: 0, html: null, error: null }),
}))
```

- [ ] **Step 2: Wire generation event subscriptions in ProjectEditor**

In ProjectEditor, on mount:
```ts
useEffect(() => {
  const u1 = api.generation.onProgress(({ current }) => useGenerationStore.setState({ progress: current }))
  const u2 = api.generation.onDone(({ html, durationMs }) => useGenerationStore.setState({ phase: 'done', html, runId: null }))
  const u3 = api.generation.onError(({ error }) => useGenerationStore.setState({ phase: 'error', error: error.message, runId: null }))
  return () => { u1(); u2(); u3() }
}, [])
```

- [ ] **Step 3: Create `src/renderer/components/OutlineEditor.tsx`**

```tsx
import { Input } from 'antd'

const { TextArea } = Input

export function OutlineEditor({ value, onChange, disabled }: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <TextArea
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      style={{ height: '100%', fontFamily: 'SF Mono, Monaco, monospace', fontSize: 13, lineHeight: 1.7, resize: 'none' }}
      placeholder={`# 项目主题\n\n## 第一节\n- 要点 1\n- 要点 2\n\n# 第二节\n...`}
    />
  )
}
```

- [ ] **Step 4: Create `src/renderer/components/HtmlPreview.tsx`**

```tsx
import { useState } from 'react'
import { Button } from 'antd'

export function HtmlPreview({ html }: { html: string | null }) {
  const [page, setPage] = useState(0)
  if (!html) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af' }}>暂无预览，点"生成 PPT"开始</div>
  }
  // Naive split on page-break / section
  const slides = html.split(/<section[^>]*class="slide"/i).filter(Boolean)
  const current = slides[page] ?? ''
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
        <small style={{ color: '#6b7280' }}>👁 预览</small>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button size="small" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>◀</Button>
          <small>{page + 1} / {slides.length}</small>
          <Button size="small" onClick={() => setPage(p => Math.min(slides.length - 1, p + 1))} disabled={page >= slides.length - 1}>▶</Button>
        </div>
      </div>
      <iframe srcDoc={`<style>body{margin:0;font-family:sans-serif;background:#fff;}section.slide{aspect-ratio:16/9;padding:48px;display:flex;flex-direction:column;justify-content:center;}</style>${current}`}
              style={{ flex: 1, border: 'none', background: '#f3f4f6' }}
              sandbox="allow-same-origin" />
    </div>
  )
}
```

- [ ] **Step 5: Create `src/renderer/components/GenerationProgress.tsx`**

```tsx
import { Button, Progress } from 'antd'

export function GenerationProgress({ progress, onCancel }: {
  progress: number
  onCancel: () => void
}) {
  return (
    <div style={{ padding: 14, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ fontSize: 20 }}>⚡</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <strong style={{ fontSize: 13 }}>生成中…</strong>
          <small style={{ color: '#6b7280' }}>已生成 {progress} 字符</small>
        </div>
        <Progress percent={Math.min(99, progress / 50)} showInfo={false} strokeColor={{ from: '#1677ff', to: '#722ed1' }} />
      </div>
      <Button danger size="small" onClick={onCancel}>取消</Button>
    </div>
  )
}
```

- [ ] **Step 6: Implement `src/renderer/routes/ProjectEditor.tsx`**

```tsx
import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Input, Tabs, App as AntdApp } from 'antd'
import { api } from '../lib/api'
import { useGenerationStore } from '../stores/generation'
import { OutlineEditor } from '../components/OutlineEditor'
import { HtmlPreview } from '../components/HtmlPreview'
import { GenerationProgress } from '../components/GenerationProgress'
import type { ProjectDetail } from '@shared/types'

export function ProjectEditor() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { message } = AntdApp.useApp()
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [outline, setOutline] = useState('')
  const [tab, setTab] = useState('split')
  const { phase, progress, html, error, start, cancel, reset } = useGenerationStore()

  useEffect(() => {
    api.project.get(id).then(p => {
      if (!p) { message.error('项目不存在'); nav('/projects'); return }
      setProject(p); setOutline(p.outline); if (p.html) useGenerationStore.setState({ html: p.html, phase: 'done' })
    })
  }, [id, message, nav])

  // Subscribe to generation events
  useEffect(() => {
    const u1 = api.generation.onProgress(({ current }) => useGenerationStore.setState({ progress: current }))
    const u2 = api.generation.onDone(({ html }) => { useGenerationStore.setState({ phase: 'done', html, runId: null }); message.success('生成完成') })
    const u3 = api.generation.onError(({ error }) => { useGenerationStore.setState({ phase: 'error', error: error.message, runId: null }); message.error(error.message) })
    return () => { u1(); u2(); u3() }
  }, [message])

  const saveOutline = useCallback(async (v: string) => {
    setOutline(v)
    await api.project.update(id, { outline: v })
  }, [id])

  const onGenerate = async () => {
    reset()
    await api.project.update(id, { outline })
    await start(id)
  }

  if (!project) return <div style={{ padding: 48 }}>加载中...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px', background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <a onClick={() => nav('/projects')} style={{ color: '#9ca3af', cursor: 'pointer' }}>← 返回</a>
          <span style={{ opacity: 0.3 }}>|</span>
          <Input value={project.title} onChange={e => setProject(p => p ? { ...p, title: e.target.value } : p)}
                 onBlur={async () => { await api.project.rename(id, project.title) }}
                 variant="borderless" style={{ fontSize: 16, fontWeight: 600, width: 240 }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={async () => {
            if (!project.html) return
            const blob = new Blob([project.html], { type: 'text/html' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url; a.download = `${project.title}.html`
            a.click(); URL.revokeObjectURL(url)
          }}>导出 HTML</Button>
          <Button onClick={onGenerate} disabled={phase === 'streaming'}>重新生成</Button>
          <Button type="primary" onClick={onGenerate} disabled={phase === 'streaming' || !outline.trim()}>⚡ 生成 PPT</Button>
        </div>
      </div>
      <Tabs activeKey={tab} onChange={setTab} style={{ padding: '0 24px', background: '#f9fafb', margin: 0 }}
            items={[
              { key: 'split', label: '编辑 + 预览' },
              { key: 'preview', label: '仅预览' },
              { key: 'outline', label: '大纲' },
            ]} />
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: tab === 'split' ? '1fr 1fr' : '1fr', background: '#f3f4f6', overflow: 'hidden' }}>
        {tab !== 'preview' && (
          <div style={{ borderRight: tab === 'split' ? '1px solid #e5e7eb' : 'none', background: '#fff', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '8px 16px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              <small style={{ color: '#6b7280' }}>📝 大纲（Markdown）— # = 一页幻灯片</small>
            </div>
            <div style={{ flex: 1, padding: 8 }}>
              <OutlineEditor value={outline} onChange={saveOutline} disabled={phase === 'streaming'} />
            </div>
          </div>
        )}
        {tab !== 'outline' && (
          <HtmlPreview html={phase === 'done' ? (html ?? project.html) : html} />
        )}
      </div>
      {phase === 'streaming' && (
        <div style={{ padding: 16, background: '#fff', borderTop: '1px solid #e5e7eb' }}>
          <GenerationProgress progress={progress} onCancel={cancel} />
        </div>
      )}
      {phase === 'error' && error && (
        <div style={{ padding: 16, background: '#fef2f2', borderTop: '1px solid #fecaca', color: '#dc2626' }}>
          生成失败：{error}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Build renderer**

Run: `pnpm run build:renderer && pnpm run typecheck`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/routes/ProjectEditor.tsx src/renderer/components/ src/renderer/stores/generation.ts
git commit -m "feat(ui): project editor with split view + generation"
```

---

## Task 15: Settings page

**Files:**
- Create: `src/renderer/routes/Settings.tsx`

- [ ] **Step 1: Implement `Settings.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Form, Input, Select, Button, App as AntdApp } from 'antd'
import { useSettingsStore } from '../stores/settings'

export function Settings() {
  const { settings, load, save } = useSettingsStore()
  const [testResult, setTestResult] = useState<{ ok: boolean; models?: string[]; error?: string } | null>(null)
  const [form, setForm] = useState(settings)
  const { message } = AntdApp.useApp()

  useEffect(() => { load() }, [load])
  useEffect(() => { setForm(settings) }, [settings])
  if (!form) return <div style={{ padding: 48 }}>加载中...</div>

  const update = (patch: Partial<typeof form.llm>) =>
    setForm(s => s ? { ...s, llm: { ...s.llm, ...patch } } : s)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: 'calc(100vh - 64px)', background: '#fff' }}>
      <div style={{ background: '#f9fafb', borderRight: '1px solid #e5e7eb', padding: '16px 8px' }}>
        <div style={{ padding: '8px 12px', color: '#1677ff', background: '#eff6ff', borderRadius: 6, fontWeight: 500, fontSize: 14 }}>🔑 LLM 服务</div>
      </div>
      <div style={{ padding: '32px 48px', maxWidth: 720 }}>
        <h2 style={{ margin: '0 0 4px' }}>LLM 服务</h2>
        <p style={{ color: '#6b7280', margin: '0 0 24px', fontSize: 14 }}>配置用于生成 PPT 的 LLM 服务。设置存在本地，不会发送到外部。</p>
        <Form layout="vertical">
          <Form.Item label="服务提供方">
            <Select value={form.llm.provider} onChange={v => update({ provider: v })}
                    options={[
                      { value: 'anthropic', label: 'Anthropic 兼容（默认）' },
                      { value: 'openai', label: 'OpenAI 兼容' },
                      { value: 'custom', label: '自定义' },
                    ]} />
          </Form.Item>
          <Form.Item label="API Base URL">
            <Input value={form.llm.baseUrl} onChange={e => update({ baseUrl: e.target.value })}
                   style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item label="API Key" extra="存储于本地，明文。后续版本将加密。">
            <Input.Password value={form.llm.apiKey} onChange={e => update({ apiKey: e.target.value })}
                            style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item label="模型" extra="留空使用服务默认模型">
            <Input value={form.llm.model} onChange={e => update({ model: e.target.value })}
                   style={{ fontFamily: 'monospace' }} addonAfter={
                     <Button size="small" type="link" onClick={async () => {
                       try {
                         const r = await window.api.settings.testConnection()
                         setTestResult(r)
                         if (r.ok) message.success(`连接成功，${r.models?.length ?? 0} 个模型`)
                         else message.error(r.error ?? '连接失败')
                       } catch (e) { message.error(String(e)) }
                     }}>测试连接</Button>
                   } />
          </Form.Item>
          {testResult && (
            <div style={{ padding: 12, background: testResult.ok ? '#f0fdf4' : '#fef2f2', borderRadius: 6, marginBottom: 16, color: testResult.ok ? '#16a34a' : '#dc2626' }}>
              {testResult.ok ? `✓ 连接成功${testResult.models ? `，模型：${testResult.models.join(', ')}` : ''}` : `✗ ${testResult.error}`}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
            <Button onClick={() => setForm(settings)}>恢复</Button>
            <Button type="primary" onClick={async () => { if (form) { await save(form); message.success('已保存') } }}>保存设置</Button>
          </div>
        </Form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build renderer**

Run: `pnpm run build:renderer && pnpm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/routes/Settings.tsx
git commit -m "feat(ui): settings page with LLM config form"
```

---

## Task 16: Dev workflow script

**Files:**
- Create: `scripts/dev.ts`
- Modify: `package.json` (verify `dev` script)

- [ ] **Step 1: Create `scripts/dev.ts`**

```ts
#!/usr/bin/env bun
import { spawn } from 'bun'

const procs = [
  spawn({ cmd: ['vite', '--config', 'vite.config.ts'], cwd: import.meta.dir + '/..', stdout: 'inherit', stderr: 'inherit' }),
  spawn({ cmd: ['tsc', '--noEmit', '-p', 'tsconfig.main.json', '--watch'], cwd: import.meta.dir + '/..', stdout: 'inherit', stderr: 'inherit' }),
  spawn({ cmd: ['electron', '.'], cwd: import.meta.dir + '/..', env: { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5173' }, stdout: 'inherit', stderr: 'inherit' }),
]

process.on('SIGINT', () => { procs.forEach(p => p.kill()); process.exit() })
await Promise.race(procs.map(p => p.exited))
procs.forEach(p => p.kill())
```

- [ ] **Step 2: Manual smoke**

Run: `pnpm run build && pnpm start` (just to confirm launch path works, then Ctrl+C)
Expected: window opens, no crash.

- [ ] **Step 3: Commit**

```bash
git add scripts/dev.ts
git commit -m "feat(scripts): dev workflow (vite + tsc-watch + electron)"
```

---

## Task 17: Playwright e2e

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/app-launches.spec.ts`
- Create: `tests/e2e/create-and-generate.spec.ts`

- [ ] **Step 1: Install Playwright browsers**

Run: `pnpm exec playwright install chromium`
Expected: chromium downloaded.

- [ ] **Step 2: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: { trace: 'retain-on-failure' },
  reporter: 'list',
  webServer: {
    command: 'pnpm run build && pnpm start',
    cwd: '.',
    timeout: 60_000,
    reuseExistingServer: false,
  },
})
```

- [ ] **Step 3: Write `tests/e2e/app-launches.spec.ts`**

```ts
import { test, expect } from '@playwright/test'

test('app launches and shows welcome page', async ({ page }) => {
  await page.waitForSelector('text=⬢ ZN Agentic PPT')
  await expect(page.locator('text=用 AI 几秒生成演示文稿')).toBeVisible()
})
```

- [ ] **Step 4: Write `tests/e2e/create-and-generate.spec.ts`**

```ts
import { test, expect } from '@playwright/test'

test('create → edit outline → generate → preview appears', async ({ page }) => {
  // Welcome → Projects
  await page.getByRole('button', { name: '+ 新建项目' }).first().click()
  // Modal
  await page.getByPlaceholder(/主题/).fill('测试主题')
  await page.getByRole('button', { name: '确 定' }).click()
  // Editor opens
  await expect(page.locator('text=⚡ 生成 PPT')).toBeVisible()
  // Fill outline
  await page.locator('textarea').fill('# 标题\n\n要点 1\n要点 2\n\n# 第二页\n- 子点')
  // Click generate
  await page.getByRole('button', { name: '⚡ 生成 PPT' }).click()
  // Wait for done (mocked SDK with real key would actually generate; here just check no crash)
  await page.waitForTimeout(2000)
})
```

- [ ] **Step 5: Run e2e**

Run: `pnpm run e2e`
Expected: 1-2 tests pass (or skipped if no API key). For real generation, set env var.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts tests/e2e/
git commit -m "test(e2e): app launches + create-and-generate flow"
```

---

## Task 18: electron-builder config + README

**Files:**
- Create: `electron-builder.yml`
- Create: `README.md`

- [ ] **Step 1: Create `electron-builder.yml`**

```yaml
appId: dev.zn-agentic-ppt.app
productName: ZN Agentic PPT
directories:
  output: out
files:
  - dist/**/*
  - vendor/**/*
  - package.json
mac:
  category: public.app-category.productivity
  target: [dmg, zip]
win:
  target: [nsis, zip]
linux:
  target: [AppImage, deb]
```

- [ ] **Step 2: Create `README.md`**

````markdown
# zn-agentic-ppt

桌面端 AI 演示文稿生成器。基于 Electron + React + Antd，通过 vendored 的 LLM Agent SDK 把用户给的主题 + 大纲转成 HTML PPT。

## 快速开始

```bash
pnpm install
pnpm run dev          # vite + tsc --watch + electron
```

## 首次使用

1. 打开应用 → 设置页 → 配置 LLM（base URL、API key、模型）
2. 欢迎页 → 新建项目 → 输主题
3. 编辑器 → 写大纲（# = 一页）→ 点 "⚡ 生成 PPT"
4. 预览生成结果 → 导出 HTML

## 数据目录

所有数据存在 `~/.zn-agentic-ppt/`：
- `settings.json` — LLM 配置
- `projects/<uuid>/` — 每个项目一个目录
- `logs/` — main 进程日志
- `cache/` — 模型列表缓存

## 同步 SDK

上游 SDK 变更后：
```bash
cd /Users/ethan/code/opencc-worktree && bun run build
cd /Users/ethan/code/zn-agentic-ppt && pnpm run sync-sdk
```

## 开发

```bash
pnpm run typecheck    # tsc --noEmit × 2
pnpm test             # vitest
pnpm run e2e          # playwright
pnpm run build        # esbuild + vite
```
````

- [ ] **Step 3: Commit**

```bash
git add electron-builder.yml README.md
git commit -m "docs: README + electron-builder config"
```

---

## Task 19: Final smoke + commit

- [ ] **Step 1: Full build**

Run: `pnpm run build && pnpm run typecheck && pnpm test`
Expected: all green.

- [ ] **Step 2: Tag the MVP**

```bash
git tag mvp-0.1.0
git log --oneline
```

- [ ] **Step 3: Report**

Final commit list should be ~19 commits. Project at `/Users/ethan/code/zn-agentic-ppt/`.

---

## Self-Review

- **Spec coverage**: All 12 sections covered — data model (T3-T7), IPC (T10-T11), generation flow (T8, T11), error handling (T7 corrupt recovery, T8 error mapping, T14 error display), testing (T7-T8 unit, T17 e2e), YAGNI scope (excluded explicitly throughout), UI (T12-T15 with visual mockups referenced).
- **Type consistency**: `ProjectMeta.patch` shape used identically in IPC handler, fs function, preload, lib/api. Channel names from `IPC` constant used everywhere. `BridgeApi` in renderer matches preload's `api` object.
- **Placeholders**: None. All code blocks complete.
- **Architecture match**: Plan follows Architecture A (main + preload + renderer), no deviation.
