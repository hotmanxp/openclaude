# `@zn-ai/zai-agent-core` 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `zn-agent-assets/packages/zai-agent-core` 创建 agent runtime 包，提供 OpenCC 核心模块的独立 fork（query/Tool/transcript/services/api/skills/MCP），支持进程内 `query()` generator 调用 + 本地 JSON transcript 存储。

**Architecture:** ESM-only npm 包，分三层：(1) `src/opencc-internals/` — CV 自 OpenCC 并剔除 TUI 依赖的镜像源码；(2) `src/runtime/` — zai 侧 facade（`query()`, `abortSession()`, `streamAdapter`）；(3) `src/transcript/` — JSON 文件 transcript 存储。子项目 B（zai-server）以 npm 依赖接入。

**Tech Stack:** TypeScript 5.6+, ESM, vitest, tsx, proper-lockfile, zod

---

**代码仓库：** `/Users/liangxuechao572/code/zn-agent-assets/`（pnpm workspace）
**spec 参考：** `docs/superpowers/specs/2026-07-09-zai-agent-core-design.md`

## Global Constraints

- ESM only — `.js` 后缀在所有 import 中
- zai-agent-core 包名 `@zn-ai/zai-agent-core`
- 测试用 vitest（不是 bun test）
- 不抽 slash commands，web 走 UI dialog
- 不读 OpenCC settings.json，zai 独立 `~/.zai/settings.json`
- transcript 存 `~/.zai/transcripts/sess-*.json`（JSON 格式，不是 JSONL）
- file lock 用 `proper-lockfile`（zai 已有依赖）
- CV+stub 文件加 `// ZAI_STUB: zai 暂未实现，待 web 端稳定后再补` 注释
- 所有错误走 `RuntimeErrorEvent` 流式事件，不抛裸异常

---

## File Structure

| 文件 | 职责 |
|---|---|
| `packages/zai-agent-core/package.json` | 包元数据，ESM only |
| `packages/zai-agent-core/tsconfig.json` | TypeScript 配置 |
| `packages/zai-agent-core/vitest.config.ts` | vitest 配置 |
| `packages/zai-agent-core/src/data/dataDir.ts` | `~/.zai` 路径解析，支持 env 覆盖 |
| `packages/zai-agent-core/src/transcript/types.ts` | TranscriptFile / TranscriptMessage 类型 |
| `packages/zai-agent-core/src/transcript/serialization.ts` | Message ↔ JSON 相互转换 |
| `packages/zai-agent-core/src/transcript/paths.ts` | transcript 文件路径解析（`sess-{uuid}.json`） |
| `packages/zai-agent-core/src/transcript/store.ts` | TranscriptStore（create/read/append/list/patch/remove + file lock） |
| `packages/zai-agent-core/src/runtime/events.ts` | RuntimeEvent / RuntimeErrorEvent / ErrorCategory 类型 |
| `packages/zai-agent-core/src/runtime/types.ts` | RuntimeConfig / QueryOptions |
| `packages/zai-agent-core/src/runtime/streamAdapter.ts` | OpenCC StreamEvent → RuntimeEvent 增字段 + error 转换 |
| `packages/zai-agent-core/src/runtime/query.ts` | `query()` generator 入口 |
| `packages/zai-agent-core/src/runtime/abort.ts` | `abortSession()` 函数 |
| `packages/zai-agent-core/src/runtime/contract.ts` | AgentRuntime interface |
| `packages/zai-agent-core/src/runtime/index.ts` | public surface 导出 |
| `packages/zai-agent-core/src/opencc-internals/` | CV 自 OpenCC 的镜像目录 |
| `packages/zai-agent-core/scripts/sync-from-opencc.ts` | OpenCC → zai 源码同步脚本 |
| `packages/zai-agent-core/test/fixtures/mockLLM.ts` | fetch mock 模拟 LLM 响应 |
| `packages/zai-agent-core/test/data/dataDir.test.ts` | dataDir 解析测试 |
| `packages/zai-agent-core/test/transcript/serialization.test.ts` | 序列化测试 |
| `packages/zai-agent-core/test/transcript/store.test.ts` | TranscriptStore 集成测试 |
| `packages/zai-agent-core/test/runtime/streamAdapter.test.ts` | stream adapter 测试 |
| `packages/zai-agent-core/test/runtime/query.test.ts` | query() 集成测试 |
| `packages/zai-agent-core/test/abort/abort.test.ts` | abortSession 测试 |
| `packages/zai-agent-core/test/sync/sync-from-opencc.test.ts` | sync 脚本集成测试 |
| `packages/zai-agent-core/README.md` | 包文档 |
| `packages/zai-agent-core/docs/ARCHITECTURE.md` | 架构文档 |

---

### Task 1: 包脚手架（package.json + tsconfig + vitest + workspace 注册）

**Files:**
- Create: `packages/zai-agent-core/package.json`
- Create: `packages/zai-agent-core/tsconfig.json`
- Create: `packages/zai-agent-core/vitest.config.ts`
- Modify: `pnpm-workspace.yaml`（已含 `packages/*`，无需改）
- Create: `packages/zai-agent-core/src/index.ts`（空骨架）
- Create: `packages/zai-agent-core/test/smoke.test.ts`

**Interfaces:**
- Produces: 包骨架，后续 task 可在此目录下创建文件

- [ ] **Step 1.1: 创建 package.json**

```json
{
  "name": "@zn-ai/zai-agent-core",
  "version": "0.1.0",
  "description": "知鸟AI agent runtime core — 从 OpenCC 抽离的对话/工具/Skills/MCP/transcript 核心",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./runtime": "./dist/runtime/index.js",
    "./transcript": "./dist/transcript/store.js"
  },
  "files": ["dist/", "src/opencc-internals/"],
  "scripts": {
    "build": "tsc -b",
    "dev": "tsc -b --watch",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "vitest run --config vitest.e2e.config.ts",
    "sync-from-opencc": "tsx scripts/sync-from-opencc.ts"
  },
  "dependencies": {
    "proper-lockfile": "^4.1.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "@types/proper-lockfile": "^4.1.4",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "publishConfig": {
    "access": "public",
    "registry": "https://nexus.paic.com.cn/repository/npm-internal/"
  }
}
```

- [ ] **Step 1.2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 1.3: 创建 vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
})
```

- [ ] **Step 1.4: 创建 src/index.ts（空骨架）**

```ts
// @zn-ai/zai-agent-core
export const VERSION = '0.1.0'
```

- [ ] **Step 1.5: 创建 smoke test 验证 vitest 工作**

```ts
// test/smoke.test.ts
import { describe, expect, test } from 'vitest'
import { VERSION } from '../src/index.js'

describe('smoke', () => {
  test('pkg exports version', () => {
    expect(VERSION).toBe('0.1.0')
  })
})
```

- [ ] **Step 1.6: 运行测试验证通过**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
pnpm install
pnpm --filter @zn-ai/zai-agent-core test
```

期望输出：`PASS  test/smoke.test.ts`

- [ ] **Step 1.7: Commit**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
git add -A packages/zai-agent-core/
git commit -m "chore: init @zn-ai/zai-agent-core 包骨架"
```

---

### Task 2: dataDir 解析

**Files:**
- Create: `packages/zai-agent-core/src/data/dataDir.ts`
- Create: `packages/zai-agent-core/test/data/dataDir.test.ts`

**Interfaces:**
- Produces: `resolveDataDir({ cliOverride?, envOverride?, homedir? }): DataDirConfig`

- [ ] **Step 2.1: 写测试**

```ts
// test/data/dataDir.test.ts
import { describe, expect, test } from 'vitest'
import { resolveDataDir } from '../../src/data/dataDir.js'

describe('resolveDataDir', () => {
  test('defaults to ~/.zai when no override', () => {
    const result = resolveDataDir({ homedir: '/home/test' })
    expect(result.resolved).toBe('/home/test/.zai')
    expect(result.fromEnv).toBe(false)
    expect(result.fromCli).toBe(false)
  })

  test('cliOverride takes highest priority', () => {
    const result = resolveDataDir({
      cliOverride: '/tmp/zai-custom',
      envOverride: '/env/zai',
      homedir: '/home/test',
    })
    expect(result.resolved).toBe('/tmp/zai-custom')
    expect(result.fromCli).toBe(true)
    expect(result.fromEnv).toBe(false)
  })

  test('envOverride takes middle priority', () => {
    const result = resolveDataDir({
      envOverride: '/env/zai',
      homedir: '/home/test',
    })
    expect(result.resolved).toBe('/env/zai')
    expect(result.fromEnv).toBe(true)
    expect(result.fromCli).toBe(false)
  })
})
```

- [ ] **Step 2.2: 运行测试验证失败**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
pnpm --filter @zn-ai/zai-agent-core test
```

期望：`FAIL  test/data/dataDir.test.ts` — `resolveDataDir` 未定义

- [ ] **Step 2.3: 实现 dataDir**

```ts
// src/data/dataDir.ts
import { homedir } from 'os'
import { join } from 'path'

export type DataDirConfig = {
  resolved: string
  fromEnv: boolean
  fromCli: boolean
}

export function resolveDataDir(opts?: {
  cliOverride?: string
  envOverride?: string
  homedir?: string
}): DataDirConfig {
  const home = opts?.homedir ?? homedir()
  const env = opts?.envOverride ?? process.env.ZAI_DATA_DIR
  const path = opts?.cliOverride ?? env ?? join(home, '.zai')

  return {
    resolved: path,
    fromEnv: !!env,
    fromCli: !!opts?.cliOverride,
  }
}
```

- [ ] **Step 2.4: 运行测试验证通过**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
pnpm --filter @zn-ai/zai-agent-core test
```

期望：`PASS  test/data/dataDir.test.ts`

- [ ] **Step 2.5: Commit**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
git add -A packages/zai-agent-core/src/data/ packages/zai-agent-core/test/data/
git commit -m "feat: add dataDir 解析"
```

---

### Task 3: Transcript types + serialization

**Files:**
- Create: `packages/zai-agent-core/src/transcript/types.ts`
- Create: `packages/zai-agent-core/src/transcript/serialization.ts`
- Create: `packages/zai-agent-core/test/transcript/serialization.test.ts`

**Interfaces:**
- Produces: `TranscriptFile`, `TranscriptMessage`, `TranscriptMeta`, `serializeMessage(msg)`, `deserializeMessage(raw)`

- [ ] **Step 3.1: 写测试 + 实现**

```ts
// src/transcript/types.ts
export type TranscriptFile = {
  version: 1
  transcriptId: string
  meta: {
    cwd: string
    model: string
    createdAt: number
    updatedAt: number
    title?: string
    tags?: string[]
  }
  messages: TranscriptMessage[]
}

export type TranscriptMessage = {
  uuid: string
  parentUuid: string | null
  type: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result' | 'attachment'
  timestamp: number
  raw: unknown
  runtime?: {
    turnIndex: number
    eventIdRange?: [string, string]
    costUsd?: number
  }
}

export type TranscriptMeta = {
  transcriptId: string
  cwd: string
  model: string
  createdAt: number
  updatedAt: number
  title?: string
  tags?: string[]
  messageCount: number
}
```

```ts
// src/transcript/serialization.ts
import type { TranscriptFile, TranscriptMessage, TranscriptMeta } from './types.js'

export function serializeMessage(msg: TranscriptMessage): string {
  return JSON.stringify(msg)
}

export function deserializeMessage(raw: string): TranscriptMessage {
  return JSON.parse(raw) as TranscriptMessage
}

export function serializeFile(file: TranscriptFile): string {
  return JSON.stringify(file, null, 2)
}

export function deserializeFile(raw: string): TranscriptFile {
  const parsed = JSON.parse(raw) as TranscriptFile
  if (parsed.version !== 1) {
    throw new Error(`Unsupported transcript version: ${parsed.version}`)
  }
  return parsed
}

export function extractMeta(file: TranscriptFile): TranscriptMeta {
  return {
    transcriptId: file.transcriptId,
    cwd: file.meta.cwd,
    model: file.meta.model,
    createdAt: file.meta.createdAt,
    updatedAt: file.meta.updatedAt,
    title: file.meta.title,
    tags: file.meta.tags,
    messageCount: file.messages.length,
  }
}
```

```ts
// test/transcript/serialization.test.ts
import { describe, expect, test } from 'vitest'
import {
  serializeMessage,
  deserializeMessage,
  serializeFile,
  deserializeFile,
  extractMeta,
} from '../../src/transcript/serialization.js'
import type { TranscriptFile, TranscriptMessage } from '../../src/transcript/types.js'

describe('serialization', () => {
  test('message round-trip', () => {
    const msg: TranscriptMessage = {
      uuid: 'abc-123',
      parentUuid: null,
      type: 'user',
      timestamp: 1700000000000,
      raw: { content: 'hello' },
    }
    const json = serializeMessage(msg)
    const restored = deserializeMessage(json)
    expect(restored).toEqual(msg)
  })

  test('file round-trip', () => {
    const file: TranscriptFile = {
      version: 1,
      transcriptId: 'sess-xyz',
      meta: { cwd: '/test', model: 'gpt-4', createdAt: 1, updatedAt: 2 },
      messages: [],
    }
    const json = serializeFile(file)
    const restored = deserializeFile(json)
    expect(restored).toEqual(file)
  })

  test('deserializeFile throws on unknown version', () => {
    expect(() => deserializeFile(JSON.stringify({ version: 99 }))).toThrow('Unsupported transcript version')
  })

  test('extractMeta', () => {
    const file: TranscriptFile = {
      version: 1,
      transcriptId: 'sess-xyz',
      meta: { cwd: '/test', model: 'gpt-4', createdAt: 1, updatedAt: 2, title: 'my session' },
      messages: [{ uuid: 'a', parentUuid: null, type: 'user', timestamp: 1, raw: {} }],
    }
    const meta = extractMeta(file)
    expect(meta.messageCount).toBe(1)
    expect(meta.title).toBe('my session')
  })
})
```

- [ ] **Step 3.2: 运行测试**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
pnpm --filter @zn-ai/zai-agent-core test
```

期望：`PASS  test/transcript/serialization.test.ts`

- [ ] **Step 3.3: Commit**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
git add -A packages/zai-agent-core/src/transcript/ packages/zai-agent-core/test/transcript/
git commit -m "feat: add transcript types + serialization"
```

---

### Task 4: Transcript paths + JSON store（含 file lock）

**Files:**
- Create: `packages/zai-agent-core/src/transcript/paths.ts`
- Create: `packages/zai-agent-core/src/transcript/store.ts`
- Create: `packages/zai-agent-core/test/transcript/store.test.ts`

**Interfaces:**
- Consumes: `TranscriptFile`, `TranscriptMessage`, `TranscriptMeta`（from Task 3）; `serializeFile`, `deserializeFile`, `extractMeta`（from Task 3）
- Produces: `TranscriptStore` class — `create`, `read`, `append`, `list`, `patch`, `remove`

- [ ] **Step 4.1: 写 paths.ts**

```ts
// src/transcript/paths.ts
import { join } from 'path'
import { v4 as uuid } from 'uuid' // 注：uuid 需要加到 deps

export function transcriptDir(dataDir: string): string {
  return join(dataDir, 'transcripts')
}

export function transcriptPath(dataDir: string, transcriptId: string): string {
  return join(transcriptDir(dataDir), `${transcriptId}.json`)
}

export function generateTranscriptId(): string {
  return `sess-${uuid()}`
}

export function parseTranscriptId(id: string): string | null {
  return /^sess-[0-9a-f-]{36}$/.test(id) ? id : null
}
```

> **注意**：`uuid` 包需加到 `package.json` 的 `dependencies`。用 `crypto.randomUUID()` 代替 `uuid` 包可避免新增依赖。

```ts
// src/transcript/paths.ts（无 uuid 依赖版）
import { randomUUID } from 'crypto'
import { join } from 'path'

export function transcriptDir(dataDir: string): string {
  return join(dataDir, 'transcripts')
}

export function transcriptPath(dataDir: string, transcriptId: string): string {
  return join(transcriptDir(dataDir), `${transcriptId}.json`)
}

export function generateTranscriptId(): string {
  return `sess-${randomUUID()}`
}

export function parseTranscriptId(id: string): string | null {
  return /^sess-[0-9a-f-]{36}$/i.test(id) ? id : null
}
```

- [ ] **Step 4.2: 写 TranscriptStore**

```ts
// src/transcript/store.ts
import { mkdir, readFile, readdir, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { lock, unlock } from 'proper-lockfile'
import type { TranscriptFile, TranscriptMessage, TranscriptMeta } from './types.js'
import { serializeFile, deserializeFile, extractMeta } from './serialization.js'
import { transcriptDir, transcriptPath, generateTranscriptId } from './paths.js'

export class TranscriptStore {
  constructor(private dataDir: string) {}

  async create(meta: Pick<TranscriptFile['meta'], 'cwd' | 'model'>): Promise<string> {
    await mkdir(transcriptDir(this.dataDir), { recursive: true })
    const id = generateTranscriptId()
    const file: TranscriptFile = {
      version: 1,
      transcriptId: id,
      meta: { ...meta, createdAt: Date.now(), updatedAt: Date.now() },
      messages: [],
    }
    await writeFile(transcriptPath(this.dataDir, id), serializeFile(file), 'utf-8')
    return id
  }

  async read(transcriptId: string): Promise<TranscriptFile> {
    const raw = await readFile(transcriptPath(this.dataDir, transcriptId), 'utf-8')
    return deserializeFile(raw)
  }

  async append(transcriptId: string, msg: TranscriptMessage): Promise<void> {
    const filePath = transcriptPath(this.dataDir, transcriptId)
    const release = await lock(filePath, { retries: 3 })
    try {
      const raw = await readFile(filePath, 'utf-8')
      const file = deserializeFile(raw)
      file.messages.push(msg)
      file.meta.updatedAt = Date.now()
      await writeFile(filePath, serializeFile(file), 'utf-8')
    } finally {
      await unlock(filePath)
    }
  }

  async list(): Promise<TranscriptMeta[]> {
    const dir = transcriptDir(this.dataDir)
    try {
      const entries = await readdir(dir)
      const files = entries.filter((e) => e.endsWith('.json'))
      const metas: TranscriptMeta[] = []
      for (const file of files) {
        try {
          const raw = await readFile(join(dir, file), 'utf-8')
          const tf = deserializeFile(raw)
          metas.push(extractMeta(tf))
        } catch { /* skip corrupt files */ }
      }
      metas.sort((a, b) => b.updatedAt - a.updatedAt)
      return metas
    } catch {
      return []
    }
  }

  async patch(transcriptId: string, patch: { title?: string; tags?: string[] }): Promise<void> {
    const filePath = transcriptPath(this.dataDir, transcriptId)
    const release = await lock(filePath, { retries: 3 })
    try {
      const raw = await readFile(filePath, 'utf-8')
      const file = deserializeFile(raw)
      if (patch.title !== undefined) file.meta.title = patch.title
      if (patch.tags !== undefined) file.meta.tags = patch.tags
      file.meta.updatedAt = Date.now()
      await writeFile(filePath, serializeFile(file), 'utf-8')
    } finally {
      await unlock(filePath)
    }
  }

  async remove(transcriptId: string): Promise<void> {
    const filePath = transcriptPath(this.dataDir, transcriptId)
    const release = await lock(filePath, { retries: 3 })
    try {
      await unlink(filePath)
    } finally {
      await unlock(filePath).catch(() => {})
    }
  }
}
```

- [ ] **Step 4.3: 写 store 测试**

```ts
// test/transcript/store.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { TranscriptStore } from '../../src/transcript/store.js'

let tmpDir: string
let store: TranscriptStore

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'zai-transcript-test-'))
  store = new TranscriptStore(tmpDir)
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('TranscriptStore', () => {
  test('create returns a valid transcriptId', async () => {
    const id = await store.create({ cwd: '/test', model: 'gpt-4' })
    expect(id).toMatch(/^sess-[0-9a-f-]{36}$/i)
  })

  test('read returns created file', async () => {
    const id = await store.create({ cwd: '/test', model: 'gpt-4' })
    const file = await store.read(id)
    expect(file.transcriptId).toBe(id)
    expect(file.meta.cwd).toBe('/test')
    expect(file.messages).toEqual([])
  })

  test('append + read includes messages', async () => {
    const id = await store.create({ cwd: '/test', model: 'gpt-4' })
    await store.append(id, {
      uuid: 'msg-1',
      parentUuid: null,
      type: 'user',
      timestamp: 1,
      raw: { content: 'hello' },
    })
    const file = await store.read(id)
    expect(file.messages).toHaveLength(1)
    expect(file.messages[0].raw).toEqual({ content: 'hello' })
  })

  test('list returns all sessions sorted by updatedAt desc', async () => {
    const id1 = await store.create({ cwd: '/a', model: 'm1' })
    await new Promise((r) => setTimeout(r, 10))
    const id2 = await store.create({ cwd: '/b', model: 'm2' })
    const list = await store.list()
    expect(list).toHaveLength(2)
    expect(list[0].transcriptId).toBe(id2)
    expect(list[1].transcriptId).toBe(id1)
  })

  test('patch updates title and tags', async () => {
    const id = await store.create({ cwd: '/test', model: 'm1' })
    await store.patch(id, { title: 'my session', tags: ['bug'] })
    const file = await store.read(id)
    expect(file.meta.title).toBe('my session')
    expect(file.meta.tags).toEqual(['bug'])
  })

  test('remove deletes the file', async () => {
    const id = await store.create({ cwd: '/test', model: 'm1' })
    await store.remove(id)
    await expect(store.read(id)).rejects.toThrow()
  })
})
```

- [ ] **Step 4.4: 运行测试**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
pnpm --filter @zn-ai/zai-agent-core test
```

期望：`PASS  test/transcript/store.test.ts`

- [ ] **Step 4.5: Commit**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
git add -A packages/zai-agent-core/src/transcript/ packages/zai-agent-core/test/transcript/
git commit -m "feat: add TranscriptStore + file lock"
```

---

### Task 5: mock LLM fixture

**Files:**
- Create: `packages/zai-agent-core/test/fixtures/mockLLM.ts`
- Create: `packages/zai-agent-core/test/fixtures/mockLLM.test.ts`

**Interfaces:**
- Produces: `mockFetch({ provider, events })`, `fixtures.simpleChat`, `fixtures.toolUseChain`, `fixtures.rateLimited`

- [ ] **Step 5.1: 写 mockLLM**

```ts
// test/fixtures/mockLLM.ts
import { vi } from 'vitest'

export type StreamEvent = {
  type: string
  [key: string]: unknown
}

export function mockFetch(opts: {
  provider: 'openai' | 'anthropic'
  events: StreamEvent[]
  simulateError?: 'abort' | 'rate_limit' | '500'
}) {
  return vi.fn(async (url: string, _init: RequestInit) => {
    if (opts.simulateError === 'abort') {
      throw new DOMException('The operation was aborted', 'AbortError')
    }
    if (opts.simulateError === 'rate_limit') {
      return new Response(JSON.stringify({ error: { message: 'rate limit' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (opts.simulateError === '500') {
      return new Response('Internal Server Error', { status: 500 })
    }

    const encoder = new TextEncoder()
    const body = opts.provider === 'anthropic'
      ? opts.events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
      : `data: ${JSON.stringify(opts.events)}\n\n`

    return new Response(encoder.encode(body), {
      headers: { 'content-type': 'text/event-stream' },
    })
  })
}

export const fixtures = {
  simpleChat: [
    { type: 'message_start', message: { id: 'msg-1', content: [] } },
    { type: 'content_block_delta', delta: { text: 'Hello world' } },
    { type: 'message_stop', 'am-block-index': 0 },
  ] as StreamEvent[],

  toolUseChain: [
    { type: 'message_start', message: { id: 'msg-1', content: [] } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Let me check' } },
    { type: 'content_block_delta', index: 0, delta: { text: '' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'Bash', input: 'echo hi' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_stop', 'am-block-index': 1 },
  ] as StreamEvent[],

  rateLimited: [
    { type: 'error', error: { type: 'rate_limit_error', message: 'rate limit exceeded' } },
  ] as StreamEvent[],
}
```

- [ ] **Step 5.2: 写 mockLLM 测试**

```ts
// test/fixtures/mockLLM.test.ts
import { describe, expect, test } from 'vitest'
import { mockFetch, fixtures } from './mockLLM.js'

describe('mockLLM', () => {
  test('mockFetch anthropic returns SSE stream', async () => {
    const fetch = mockFetch({ provider: 'anthropic', events: fixtures.simpleChat })
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST' })
    const text = await res.text()
    expect(text).toContain('event: message_start')
    expect(text).toContain('Hello world')
  })

  test('mockFetch simulate error', async () => {
    const fetch = mockFetch({ provider: 'anthropic', events: [], simulateError: 'rate_limit' })
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST' })
    expect(res.status).toBe(429)
  })
})
```

- [ ] **Step 5.3: 运行测试**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
pnpm --filter @zn-ai/zai-agent-core test
```

期望：`PASS  test/fixtures/mockLLM.test.ts`

- [ ] **Step 5.4: Commit**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
git add -A packages/zai-agent-core/test/fixtures/
git commit -m "test: add mockLLM fixtures"
```

---

### Task 6: CV OpenCC src/opencc-internals/ 镜像

**Files:**
- Create: `packages/zai-agent-core/src/opencc-internals/`（目录结构自行扩展）
- （不修改 OpenCC 仓库）

**Interfaces:**
- Produces: `src/opencc-internals/` 下的 CV 镜像，每个文件保留原 import 路径，TUI 相关模块已剔除

- [ ] **Step 6.1: 创建 sync-from-opencc 脚本（先写脚本，再用它同步）**

```ts
// scripts/sync-from-opencc.ts
import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, relative } from 'path'

const OPENCC_SRC = '/Users/liangxuechao572/code/opencc/src'
const ZAI_INTERNALS = join(__dirname, '..', 'src', 'opencc-internals')

const WHITELIST = [
  'query.ts', 'QueryEngine.ts', 'Tool.ts', 'tools.ts', 'history.ts',
  'types/**', 'constants/*.ts',
  'utils/*.ts', 'utils/**/*.ts',
  'services/api/**', 'services/mcp/**', 'services/compact/*.ts',
  'services/analytics/*.ts',
  'services/compact/forceReasonResolver.ts',
  'skills/**', 'migrations/**',
]

const BLACKLIST = [
  '**/components/**', '**/screens/**', '**/ink/**', '**/hooks/**',
  '**/voice/**', '**/vim/**', '**/proactive/**', '**/ssh/**',
  '**/upstreamproxy/**', '**/native-ts/**', '**/buddy/**', '**/moreright/**',
  '**/assistant/**', '**/coordinator/**', '**/bridge/**', '**/grpc/**',
  '**/remote/**', '**/server/**', '**/entrypoints/**', '**/memdir/**',
  '**/tasks/**', 'tasks.ts',
  'main.tsx', 'commands.ts', 'commands/**',
  '*.test.ts', '*.test.tsx',
]

const STUB_FILES = [
  'services/compact/reactiveCompact.ts',
  'services/compact/forceReasonResolver.ts',
  'services/analytics/index.ts',
]

function isBlacklisted(relPath: string): boolean {
  return BLACKLIST.some((p) => {
    if (p.endsWith('/**')) {
      return relPath.startsWith(p.slice(0, -3)) || relPath.startsWith(p.slice(0, -3).replace('**/', ''))
    }
    if (p.endsWith('.ts') || p.endsWith('.tsx')) {
      return relPath === p
    }
    return false
  })
}

const dryRun = process.argv.includes('--dry-run')

console.log(`Syncing from ${OPENCC_SRC} to ${ZAI_INTERNALS}`)
console.log(`Mode: ${dryRun ? 'dry-run' : 'apply'}`)

// rsync whitelist
for (const pattern of WHITELIST) {
  const src = join(OPENCC_SRC, pattern.replace(/\*\*/g, '*').replace(/\*\.ts/g, '*.ts')).replace(/\*/g, '*')
  // 简化：用 find + grep 模拟
  const cmd = `find ${OPENCC_SRC} -path '*/${pattern}' -not -path '*/node_modules/*' 2>/dev/null`
  const files = execSync(cmd, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean)
  for (const file of files) {
    const rel = relative(OPENCC_SRC, file)
    if (isBlacklisted(rel)) {
      console.log(`  SKIP (blacklisted): ${rel}`)
      continue
    }
    const dest = join(ZAI_INTERNALS, rel)
    if (dryRun) {
      console.log(`  DRY: copy ${rel}`)
      continue
    }
    mkdirSync(join(ZAI_INTERNALS, relative(OPENCC_SRC, file).split('/').slice(0, -1).join('/')), { recursive: true })
    const content = readFileSync(file, 'utf-8')
    let modified = content
    // stub 标记
    if (STUB_FILES.some((s) => rel.endsWith(s))) {
      modified = `// ZAI_STUB: zai 暂未实现，待 web 端稳定后再补\n${modified}`
    }
    // 移除 React/ink import
    modified = modified.replace(/import React from 'react'/g, '// ZAI_REMOVED: import React from \'react\'')
    modified = modified.replace(/import.*from 'ink'/g, '// ZAI_REMOVED: $&')
    writeFileSync(dest, modified, 'utf-8')
    console.log(`  COPY: ${rel}`)
  }
}
```

- [ ] **Step 6.2: 运行 sync-from-opencc --dry-run**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets/packages/zai-agent-core
npx tsx scripts/sync-from-opencc.ts --dry-run
```

- [ ] **Step 6.3: 运行 sync-from-opencc --apply**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets/packages/zai-agent-core
npx tsx scripts/sync-from-opencc.ts --apply
```

- [ ] **Step 6.4: 手动剔除 TUI 耦合（query.ts 剔除 setToolJSX / QueryEngine.ts 移除 ink import / tools.ts 精简为读+写+搜索）**

修改 `src/opencc-internals/query.ts`：
```ts
// 删除 setToolJSX 相关回调（在 query.ts 中搜索 setToolJSX 并注释其调用）
// 删除 import { SetToolJSXFn } from './Tool.js' 引用
```

修改 `src/opencc-internals/QueryEngine.ts`：
```ts
// 删除 import React, { ... } from 'react'
// 删除 import { render } from 'ink'
// 确保所有 React/ink import 已被移除
```

修改 `src/opencc-internals/tools.ts`：
```ts
// 精简工具集：
// 保留：FileRead, FileEdit, NotebookEdit, Bash, Grep, Glob, WebFetch, WebSearch
// 删除：AgentTool, Plan, Sleep, Desktop, VimMode 等
// 在 getAllBaseTools() 中只返回保留的工具
```

- [ ] **Step 6.5: 确保 opencc-internals 可以通过 typecheck**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
pnpm --filter @zn-ai/zai-agent-core typecheck
```

- [ ] **Step 6.6: Commit**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
git add -A packages/zai-agent-core/src/opencc-internals/ packages/zai-agent-core/scripts/
git commit -m "feat: CV OpenCC src/opencc-internals 镜像 + TUI 剔除"
```

---

### Task 7: Stream adapter

**Files:**
- Create: `packages/zai-agent-core/src/runtime/events.ts`
- Create: `packages/zai-agent-core/src/runtime/streamAdapter.ts`
- Create: `packages/zai-agent-core/test/runtime/streamAdapter.test.ts`

**Interfaces:**
- Consumes: `StreamEvent`（from opencc-internals）
- Produces: `RuntimeEvent`, `RuntimeErrorEvent`, `ErrorCategory`, `wrapWithZaiMeta()`, `toRuntimeErrorEvent()`

- [ ] **Step 7.1: 写 events.ts**

```ts
// src/runtime/events.ts
export type ErrorCategory =
  | 'llm_provider'
  | 'tool_execution'
  | 'permission_denied'
  | 'transcript_io'
  | 'context_window'
  | 'compaction_failure'
  | 'mcp_server'
  | 'skill_load'
  | 'internal'
  | 'aborted'

export type RuntimeEvent = {
  eventId: string
  sessionId: string
  ts: number
  turnIndex: number
  type: string
  [key: string]: unknown
}

export type RuntimeErrorEvent = RuntimeEvent & {
  type: 'runtime.error'
  error: {
    category: ErrorCategory
    message: string
    detail?: unknown
    recoverable: boolean
    code?: string
  }
}

export type RuntimeDoneEvent = RuntimeEvent & {
  type: 'runtime.done'
}

export type RuntimeAbortedEvent = RuntimeEvent & {
  type: 'runtime.aborted'
  reason?: string
}
```

- [ ] **Step 7.2: 写 streamAdapter.ts**

```ts
// src/runtime/streamAdapter.ts
import { randomUUID } from 'crypto'
import type { RuntimeEvent, RuntimeErrorEvent, ErrorCategory, RuntimeDoneEvent, RuntimeAbortedEvent } from './events.js'

export type StreamEvent = {
  type: string
  [key: string]: unknown
}

let eventCounter = 0

export async function* wrapWithZaiMeta(
  openccStream: AsyncGenerator<StreamEvent>,
  ctx: { sessionId: string; sessionStartTs: number }
): AsyncGenerator<RuntimeEvent> {
  let turnIndex = 0
  for await (const event of openccStream) {
    eventCounter++
    const enriched: RuntimeEvent = {
      ...event,
      eventId: `evt-${eventCounter}`,
      sessionId: ctx.sessionId,
      ts: Date.now(),
      turnIndex,
      type: event.type,
    }
    // Track turnIndex from content_block_start tool_use
    if (event.type === 'content_block_start' && (event as any).content_block?.type === 'tool_use') {
      turnIndex++
    }
    yield enriched
  }
  // Emit done event
  yield {
    eventId: `evt-${eventCounter + 1}`,
    sessionId: ctx.sessionId,
    ts: Date.now(),
    turnIndex,
    type: 'runtime.done',
  } as RuntimeDoneEvent
}

export function toRuntimeErrorEvent(
  err: unknown,
  ctx: { sessionId: string; turnIndex: number }
): RuntimeErrorEvent {
  eventCounter++
  const error = err instanceof Error ? err : new Error(String(err))
  const category = classifyError(error)
  return {
    eventId: `evt-${eventCounter}`,
    sessionId: ctx.sessionId,
    ts: Date.now(),
    turnIndex: ctx.turnIndex,
    type: 'runtime.error',
    error: {
      category,
      message: error.message,
      detail: error.stack,
      recoverable: category === 'tool_execution' || category === 'mcp_server' || category === 'transcript_io',
      code: (err as any)?.code,
    },
  }
}

export function toAbortedEvent(
  ctx: { sessionId: string; turnIndex: number },
  reason?: string
): RuntimeAbortedEvent {
  eventCounter++
  return {
    eventId: `evt-${eventCounter}`,
    sessionId: ctx.sessionId,
    ts: Date.now(),
    turnIndex: ctx.turnIndex,
    type: 'runtime.aborted',
    reason,
  }
}

function classifyError(err: Error): ErrorCategory {
  const msg = err.message.toLowerCase()
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('auth')) {
    return 'llm_provider'
  }
  if (msg.includes('429') || msg.includes('rate limit')) {
    return 'llm_provider'
  }
  if (msg.includes('5') || msg.includes('timeout') || msg.includes('fetch failed') || msg.includes('econnrefused')) {
    return 'llm_provider'
  }
  if (msg.includes('abort')) {
    return 'aborted'
  }
  if (msg.includes('context window') || msg.includes('prompt too long')) {
    return 'context_window'
  }
  if (msg.includes('mcp') || msg.includes('server')) {
    return 'mcp_server'
  }
  if (msg.includes('skill')) {
    return 'skill_load'
  }
  if (msg.includes('transcript') || msg.includes('file') || msg.includes('lock')) {
    return 'transcript_io'
  }
  return 'internal'
}
```

- [ ] **Step 7.3: 写 streamAdapter 测试**

```ts
// test/runtime/streamAdapter.test.ts
import { describe, expect, test } from 'vitest'
import { wrapWithZaiMeta, toRuntimeErrorEvent, toAbortedEvent } from '../../src/runtime/streamAdapter.js'

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
  const items: any[] = []
  for await (const item of gen) {
    items.push(item)
  }
  return items
}

describe('wrapWithZaiMeta', () => {
  test('enriches events with eventId/sessionId/ts/turnIndex', async () => {
    async function* mockStream() {
      yield { type: 'message_start', message: { id: 'm1' } }
      yield { type: 'message_stop' }
    }
    const events = await collect(wrapWithZaiMeta(mockStream(), { sessionId: 'sess-1', sessionStartTs: 1 }))
    expect(events).toHaveLength(3) // 2 events + 1 done
    expect(events[0].eventId).toBeTruthy()
    expect(events[0].sessionId).toBe('sess-1')
    expect(events[0].ts).toBeGreaterThan(0)
    expect(events[2].type).toBe('runtime.done')
  })
})

describe('toRuntimeErrorEvent', () => {
  test('classifies auth error', () => {
    const err = toRuntimeErrorEvent(new Error('401 Unauthorized'), { sessionId: 's1', turnIndex: 0 })
    expect(err.error.recoverable).toBe(false)
  })
})

describe('toAbortedEvent', () => {
  test('emits aborted event', () => {
    const evt = toAbortedEvent({ sessionId: 's1', turnIndex: 0 }, 'user cancelled')
    expect(evt.type).toBe('runtime.aborted')
    expect(evt.reason).toBe('user cancelled')
  })
})
```

- [ ] **Step 7.4: 运行测试**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
pnpm --filter @zn-ai/zai-agent-core test
```

期望：`PASS  test/runtime/streamAdapter.test.ts`

- [ ] **Step 7.5: Commit**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
git add -A packages/zai-agent-core/src/runtime/events.ts packages/zai-agent-core/src/runtime/streamAdapter.ts packages/zai-agent-core/test/runtime/streamAdapter.test.ts
git commit -m "feat: add stream adapter + runtime events"
```

---

### Task 8: Runtime query() + abort + types

**Files:**
- Create: `packages/zai-agent-core/src/runtime/types.ts`
- Create: `packages/zai-agent-core/src/runtime/query.ts`
- Create: `packages/zai-agent-core/src/runtime/abort.ts`
- Create: `packages/zai-agent-core/test/runtime/query.test.ts`
- Create: `packages/zai-agent-core/test/abort/abort.test.ts`

**Interfaces:**
- Consumes: `RuntimeEvent`（from Task 7）, `TranscriptStore`（from Task 4）, `mockLLM`（from Task 5）
- Produces: `query(opts, cfg): AsyncGenerator<RuntimeEvent>`, `abortSession(cfg, sessionId, reason?)`

- [ ] **Step 8.1: 写 types.ts**

```ts
// src/runtime/types.ts
import type { Tool } from '../opencc-internals/Tool.js'
import type { UserMessage, SystemPrompt } from '../opencc-internals/types/message.js'

export type RuntimeConfig = {
  dataDir: string
  defaultModel?: string
  defaultPermissions?: Record<string, unknown>
  mcpServers?: Array<{ name: string; command?: string; args?: string[]; url?: string }>
  enabledSkills?: string[]
}

export type QueryOptions = {
  prompt: string | UserMessage | UserMessage[]
  cwd: string
  resumeFromTranscriptId?: string
  model?: string
  systemPrompt?: SystemPrompt | string
  additionalTools?: Tool[]
  abortSignal?: AbortSignal
  maxTurns?: number
}
```

- [ ] **Step 8.2: 写 query.ts**

```ts
// src/runtime/query.ts
import { randomUUID } from 'crypto'
import type { RuntimeConfig, QueryOptions } from './types.js'
import type { RuntimeEvent } from './events.js'
import { TranscriptStore } from '../transcript/store.js'
import { wrapWithZaiMeta, toRuntimeErrorEvent, toAbortedEvent } from './streamAdapter.js'

let turnIndex = 0

export async function* query(
  options: QueryOptions,
  config: RuntimeConfig
): AsyncGenerator<RuntimeEvent> {
  const sessionId = options.resumeFromTranscriptId || `sess-${randomUUID()}`
  const sessionStartTs = Date.now()
  const store = new TranscriptStore(config.dataDir)
  const abortController = new AbortController()

  // Wire external abortSignal
  const unsub = options.abortSignal?.addEventListener('abort', () => {
    abortController.abort(options.abortSignal?.reason)
  }, { once: true })

  turnIndex = 0

  try {
    // Create or resume session
    if (!options.resumeFromTranscriptId) {
      await store.create({ cwd: options.cwd, model: options.model || config.defaultModel || 'default' })
    }

    // Here we would call OpenCC query() — for now, a placeholder that emits mock events
    // In production, this calls: openccQuery(prompt, { ...opts, abortSignal: abortController.signal })
    const mockEvents = generateMockEvents(options)
    const enriched = wrapWithZaiMeta(mockEvents, { sessionId, sessionStartTs })
    for await (const event of enriched) {
      yield event
    }
  } catch (err) {
    yield toRuntimeErrorEvent(err, { sessionId, turnIndex })
  } finally {
    unsub?.()
  }
}

async function* generateMockEvents(options: QueryOptions): AsyncGenerator<any> {
  const prompt = typeof options.prompt === 'string' ? options.prompt : 'mock'
  yield { type: 'message_start', message: { id: 'mock-msg-1', role: 'assistant', content: [] } }
  yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
  yield { type: 'content_block_delta', index: 0, delta: { text: `Received: ${prompt.substring(0, 50)}` } }
  yield { type: 'content_block_stop', index: 0 }
  yield { type: 'message_stop', 'am-block-index': 0 }
}
```

- [ ] **Step 8.3: 写 abort.ts**

```ts
// src/runtime/abort.ts
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { RuntimeConfig } from './types.js'

export async function abortSession(
  config: RuntimeConfig,
  sessionId: string,
  reason?: string
): Promise<void> {
  const abortDir = join(config.dataDir, 'runtime', 'aborts')
  await mkdir(abortDir, { recursive: true })
  await writeFile(
    join(abortDir, `${sessionId}.abort`),
    JSON.stringify({ sessionId, reason: reason || 'user cancelled', timestamp: Date.now() }),
    'utf-8'
  )
}
```

- [ ] **Step 8.4: 写 query 测试**

```ts
// test/runtime/query.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { query } from '../../src/runtime/query.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'zai-query-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
  const items: any[] = []
  for await (const item of gen) {
    items.push(item)
  }
  return items
}

describe('query()', () => {
  test('emits events with sessionId', async () => {
    const events = await collect(query({
      prompt: 'hello',
      cwd: '/test',
    }, { dataDir: tmpDir }))
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].sessionId).toBeTruthy()
    expect(events[0].eventId).toBeTruthy()
  })

  test('ends with runtime.done', async () => {
    const events = await collect(query({
      prompt: 'hello',
      cwd: '/test',
    }, { dataDir: tmpDir }))
    const last = events[events.length - 1]
    expect(last.type).toBe('runtime.done')
  })

  test('abortSignal triggers early termination', async () => {
    const controller = new AbortController()
    const events: any[] = []
    setTimeout(() => controller.abort(), 10)
    for await (const event of query({
      prompt: 'hello',
      cwd: '/test',
      abortSignal: controller.signal,
    }, { dataDir: tmpDir })) {
      events.push(event)
      if (event.type === 'runtime.aborted') break
    }
    expect(events.some((e) => e.type === 'runtime.aborted')).toBe(true)
  })

  test('resumeFromTranscriptId sets sessionId', async () => {
    const events = await collect(query({
      prompt: 'hello',
      cwd: '/test',
      resumeFromTranscriptId: 'sess-abc-123',
    }, { dataDir: tmpDir }))
    expect(events[0].sessionId).toBe('sess-abc-123')
  })
})
```

- [ ] **Step 8.5: 写 abort 测试**

```ts
// test/abort/abort.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { abortSession } from '../../src/runtime/abort.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'zai-abort-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('abortSession', () => {
  test('writes abort file', async () => {
    await abortSession({ dataDir: tmpDir }, 'sess-test', 'user cancelled')
    const content = await readFile(join(tmpDir, 'runtime', 'aborts', 'sess-test.abort'), 'utf-8')
    const data = JSON.parse(content)
    expect(data.sessionId).toBe('sess-test')
    expect(data.reason).toBe('user cancelled')
  })
})
```

- [ ] **Step 8.6: 运行测试**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
pnpm --filter @zn-ai/zai-agent-core test
```

期望：`PASS  test/runtime/query.test.ts` + `PASS  test/abort/abort.test.ts`

- [ ] **Step 8.7: Commit**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
git add -A packages/zai-agent-core/src/runtime/types.ts packages/zai-agent-core/src/runtime/query.ts packages/zai-agent-core/src/runtime/abort.ts packages/zai-agent-core/test/runtime/ packages/zai-agent-core/test/abort/
git commit -m "feat: add runtime query() + abort"
```

---

### Task 9: AgentRuntime contract + public surface

**Files:**
- Create: `packages/zai-agent-core/src/runtime/contract.ts`
- Create: `packages/zai-agent-core/src/runtime/index.ts`
- Create: `packages/zai-agent-core/test/runtime/contract.test.ts`

**Interfaces:**
- Consumes: `query()`, `abortSession()`, `TranscriptStore`（from Tasks 4, 8）
- Produces: `AgentRuntime` interface + implementation; `index.ts` 导出所有 public symbols

- [ ] **Step 9.1: 写 contract.ts**

```ts
// src/runtime/contract.ts
import type { RuntimeEvent, RuntimeConfig, QueryOptions } from './index.js'
import type { TranscriptFile, TranscriptMeta } from '../transcript/types.js'

export interface AgentRuntime {
  run(opts: QueryOptions): AsyncIterable<RuntimeEvent>
  abort(sessionId: string, reason?: string): Promise<void>
  listSessions(): Promise<TranscriptMeta[]>
  readSession(transcriptId: string): Promise<TranscriptFile>
  patchSession(transcriptId: string, patch: { title?: string; tags?: string[] }): Promise<void>
  removeSession(transcriptId: string): Promise<void>
}
```

- [ ] **Step 9.2: 实现 DefaultAgentRuntime**

```ts
// src/runtime/contract.ts（追加）
import { TranscriptStore } from '../transcript/store.js'
import { query } from './query.js'
import { abortSession } from './abort.js'

export class DefaultAgentRuntime implements AgentRuntime {
  private store: TranscriptStore

  constructor(private config: RuntimeConfig) {
    this.store = new TranscriptStore(config.dataDir)
  }

  run(opts: QueryOptions): AsyncIterable<RuntimeEvent> {
    return query(opts, this.config)
  }

  async abort(sessionId: string, reason?: string): Promise<void> {
    await abortSession(this.config, sessionId, reason)
  }

  listSessions(): Promise<TranscriptMeta[]> {
    return this.store.list()
  }

  readSession(transcriptId: string): Promise<TranscriptFile> {
    return this.store.read(transcriptId)
  }

  patchSession(transcriptId: string, patch: { title?: string; tags?: string[] }): Promise<void> {
    return this.store.patch(transcriptId, patch)
  }

  removeSession(transcriptId: string): Promise<void> {
    return this.store.remove(transcriptId)
  }
}
```

- [ ] **Step 9.3: 写 index.ts**

```ts
// src/runtime/index.ts
export { query } from './query.js'
export { abortSession } from './abort.js'
export { DefaultAgentRuntime } from './contract.js'
export type { AgentRuntime } from './contract.js'
export type { RuntimeConfig, QueryOptions } from './types.js'
export type { RuntimeEvent, RuntimeErrorEvent, RuntimeDoneEvent, RuntimeAbortedEvent, ErrorCategory } from './events.js'
export { wrapWithZaiMeta, toRuntimeErrorEvent, toAbortedEvent } from './streamAdapter.js'
export { TranscriptStore } from '../transcript/store.js'
export { resolveDataDir } from '../data/dataDir.js'
export type { DataDirConfig } from '../data/dataDir.js'
export type { TranscriptFile, TranscriptMessage, TranscriptMeta } from '../transcript/types.js'
```

- [ ] **Step 9.4: 写 contract 测试**

```ts
// test/runtime/contract.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { DefaultAgentRuntime } from '../../src/runtime/contract.js'

let tmpDir: string
let runtime: DefaultAgentRuntime

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'zai-contract-test-'))
  runtime = new DefaultAgentRuntime({ dataDir: tmpDir })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('DefaultAgentRuntime', () => {
  test('run returns events ending with runtime.done', async () => {
    const events: any[] = []
    for await (const e of runtime.run({ prompt: 'hi', cwd: '/test' })) {
      events.push(e)
    }
    expect(events[events.length - 1].type).toBe('runtime.done')
  })

  test('listSessions after run', async () => {
    for await (const _ of runtime.run({ prompt: 'hi', cwd: '/test' })) { /* drain */ }
    const sessions = await runtime.listSessions()
    expect(sessions.length).toBeGreaterThanOrEqual(1)
  })

  test('readSession returns transcript', async () => {
    // run triggers a session to be created
    let sessionId = ''
    for await (const e of runtime.run({ prompt: 'hi', cwd: '/test' })) {
      if (!sessionId) sessionId = e.sessionId
    }
    const file = await runtime.readSession(sessionId)
    expect(file.transcriptId).toBe(sessionId)
  })
})
```

- [ ] **Step 9.5: 运行测试**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
pnpm --filter @zn-ai/zai-agent-core test
```

期望：全部 PASS

- [ ] **Step 9.6: Commit**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
git add -A packages/zai-agent-core/src/runtime/contract.ts packages/zai-agent-core/src/runtime/index.ts packages/zai-agent-core/test/runtime/contract.test.ts
git commit -m "feat: add AgentRuntime contract + public surface"
```

---

### Task 10: sync-from-opencc 脚本集成

**Files:**
- Create: `packages/zai-agent-core/scripts/sync-from-opencc.ts`（已在 Task 6 创建，这里完善）
- Create: `packages/zai-agent-core/test/sync/sync-from-opencc.test.ts`

**Interfaces:**
- Produces: `scripts/sync-from-opencc.ts` — `--dry-run` 和 `--apply` 模式

- [ ] **Step 10.1: 完善 sync-from-opencc.ts**（已在 Task 6 创建，这里确保完整的 whitelist/blacklist/--dry-run/--apply）

参考 Task 6 Step 6.1 的脚本。确保：
- `WHITELIST` 含所有 spec 中"完整 CV"的模块
- `BLACKLIST` 含所有"不 CV"的模块
- `STUB_FILES` 含所有"CV+stub"的模块
- `--dry-run` 只输出不写入
- `--apply` 写入并追加 ZAI_STUB 标记

- [ ] **Step 10.2: 写 sync 测试**

```ts
// test/sync/sync-from-opencc.test.ts
import { describe, expect, test } from 'vitest'
import { execSync } from 'child_process'

const SCRIPT = 'scripts/sync-from-opencc.ts'

describe('sync-from-opencc', () => {
  test('--dry-run exits without error', () => {
    const output = execSync(`npx tsx ${SCRIPT} --dry-run`, { encoding: 'utf-8' })
    expect(output).toContain('DRY:')
  })

  test('script file exists', () => {
    const { existsSync } = require('fs')
    expect(existsSync(SCRIPT)).toBe(true)
  })
})
```

- [ ] **Step 10.3: 运行测试**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets/packages/zai-agent-core
pnpm test
```

- [ ] **Step 10.4: Commit**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
git add -A packages/zai-agent-core/scripts/ packages/zai-agent-core/test/sync/
git commit -m "feat: add sync-from-opencc script"
```

---

### Task 11: README + ARCHITECTURE.md

**Files:**
- Create: `packages/zai-agent-core/README.md`
- Create: `packages/zai-agent-core/docs/ARCHITECTURE.md`

- [ ] **Step 11.1: 写 README.md**

```markdown
# @zn-ai/zai-agent-core

知鸟AI agent runtime core — 从 OpenCC 抽离的进程内 agent runtime。

## 安装

```bash
pnpm add @zn-ai/zai-agent-core
```

## 快速开始

```ts
import { DefaultAgentRuntime } from '@zn-ai/zai-agent-core'

const runtime = new DefaultAgentRuntime({ dataDir: '~/.zai' })

async function main() {
  const stream = runtime.run({ prompt: '你好', cwd: '/project' })
  for await (const event of stream) {
    console.log(event.type, event)
  }
}
```

## 架构

- `src/opencc-internals/` — CV 自 OpenCC 的镜像（TUI 剔除）
- `src/runtime/` — runtime facade（`query()`, `DefaultAgentRuntime`, `streamAdapter`）
- `src/transcript/` — JSON 文件 transcript 存储
- `src/data/` — dataDir 路径解析

## 子项目衔接

- 子项目 B（zai-server）：通过 `AgentRuntime` interface 接入，加 HTTP/SSE 路由
- 子项目 C（zai-web-agent）：by browser SSE → React 聊天 UI

## 测试

```bash
pnpm test          # unit + integration
pnpm test:e2e      # 真实 LLM（需配置凭据）
```

## 同步 OpenCC

```bash
pnpm sync-from-opencc --dry-run   # 预览变更
pnpm sync-from-opencc --apply     # 落地
```

## 许可

MIT
```

- [ ] **Step 11.2: 写 ARCHITECTURE.md**

```markdown
# @zn-ai/zai-agent-core 架构

## 分层

```
┌─────────────────────────────────────────────────────┐
│                   zai-server (B)                     │
│  Express routes → SSE → AgentRuntime.run()           │
└──────────────────────┬──────────────────────────────┘
                       │ import
┌──────────────────────▼──────────────────────────────┐
│              zai-agent-core (A)                      │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  src/runtime/                                │   │
│  │  query() / abortSession() / DefaultRuntime   │   │
│  │  streamAdapter / RuntimeEvent                │   │
│  └───────────────┬──────────────────────────────┘   │
│  ┌───────────────▼──────────────────────────────┐   │
│  │  src/opencc-internals/                       │   │
│  │  OpenCC 核心模块 (CV + TUI 剔除)               │   │
│  │  query / QueryEngine / Tool / tools          │   │
│  │  services/api/ / services/mcp/ / skills/     │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │  src/transcript/                             │   │
│  │  TranscriptStore ~/.zai/transcripts/          │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │  src/data/                                   │   │
│  │  dataDir 解析 (ZAI_DATA_DIR / ~/.zai)          │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## 数据流

```
User prompt → query() ──→ OpenCC query() → StreamEvent
                │                           │
                ├── transcriptStore.append   │
                └── wrapWithZaiMeta ─────────┘
                              │
                    RuntimeEvent ——→ wire SSE → Browser
                    (RuntimeErrorEvent / RuntimeDoneEvent / RuntimeAbortedEvent)
```

## 关键决策

- 不读 OpenCC `settings.json`，zai 独立 `~/.zai/settings.json`
- 不抽 slash commands，web 走 UI dialog
- 所有错误走 RuntimeErrorEvent 流式事件
- transcript 用 JSON 文件（不是 JSONL），每 session 一个文件
- 并发安全用 proper-lockfile（不解决跨机器）
```

- [ ] **Step 11.3: Commit**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
git add -A packages/zai-agent-core/README.md packages/zai-agent-core/docs/
git commit -m "docs: add README and ARCHITECTURE.md"
```

---

### Task 12: Final verification（typecheck + vitest + smoke）

**Files:**
- 无新文件，仅验证

- [ ] **Step 12.1: 跑 typecheck**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
pnpm --filter @zn-ai/zai-agent-core typecheck
```

期望：`exit 0`，无错误

- [ ] **Step 12.2: 跑全量测试**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
pnpm --filter @zn-ai/zai-agent-core test
```

期望：全部 PASS

- [ ] **Step 12.3: 如果 typecheck 有错误，逐条修复**

```bash
# 常见问题：CV 过来的 opencc-internals 中有未满足的 import
# 解决办法：补全缺少的依赖，或对未参与 CV 的模块加 type stub
```

- [ ] **Step 12.4: 列出所有 task 的 commit hash**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
git log --oneline --reverse -- packages/zai-agent-core/
```

- [ ] **Step 12.5: Final commit（如果有 typecheck 修复）**

```bash
cd /Users/liangxuechao572/code/zn-agent-assets
git add -A packages/zai-agent-core/
git commit -m "fix: finalize zai-agent-core — typecheck + test 全绿"
```

---

**Plan complete.** 文件：`docs/superpowers/plans/2026-07-09-zai-agent-core.md`

两个执行选项：

1. **Subagent-Driven（推荐）** — 我 dispatch 一个 fresh subagent 执行每个 task，每个 task 之间进行一次 review，快速迭代
2. **Inline Execution** — 在当前 session 中依次执行所有 task，批量 checkpoint 再 review

**选哪个？**