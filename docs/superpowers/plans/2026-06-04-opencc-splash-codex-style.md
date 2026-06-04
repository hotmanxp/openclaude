# OpenCC 启动画面 Codex 风格化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the REPL top bar (rendered by `Messages.tsx`'s `LogoHeader`) with a Codex-style borderless header + rounded box showing model (with context window) and directory.

**Architecture:** New self-contained `src/components/StartupHeader/` module with three layers — pure functions in `StartupHeader.pure.ts`, an Ink `React.memo` component in `StartupHeader.tsx`, and tests at two levels (`*.test.ts` for unit, `*.test.tsx` for snapshot). One-line wire-in at `src/components/Messages.tsx:63` changing `t1 = null` to `t1 = <StartupHeader />` inside the existing react-compiler sentinel block.

**Tech Stack:** Bun (runtime + test runner), React 19, Ink (terminal UI), `bun:test`, `PassThrough` streams for Ink snapshot testing. No new dependencies required.

**Spec:** `docs/superpowers/specs/2026-06-04-opencc-splash-codex-style-design.md`

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `src/components/StartupHeader/StartupHeader.pure.ts` | 6 pure functions: `expandTilde`, `truncatePath`, `formatContextWindow`, `buildHeaderLine`, `buildDirectoryLine`, `buildModelLine` |
| `src/components/StartupHeader/StartupHeader.test.ts` | Unit tests for all 6 pure functions (no React/Ink dependency) |
| `src/components/StartupHeader/StartupHeader.tsx` | `React.memo` Ink component — no props, reads from `useAppState`/`getCwd`/`getContextWindowForModel`/`useTerminalSize` |
| `src/components/StartupHeader/StartupHeader.test.tsx` | Snapshot tests using `createRoot` + `PassThrough` streams (matches `TextInput.test.tsx` pattern) |

### Modified files
| Path | Change |
|---|---|
| `src/components/Messages.tsx` | Line 63 inside the `t1` sentinel-init block: `t1 = null` → `t1 = <StartupHeader />`. Add import at top. |

### Read-only dependencies (do not modify)
- `src/utils/format.ts:133` `formatTokens`
- `src/utils/cwd.ts:26` `getCwd`
- `src/utils/context.ts:82` `getContextWindowForModel`
- `src/utils/model/model.ts:355` `renderModelSetting`
- `src/state/AppState.tsx:144` `useAppState`
- `src/hooks/useTerminalSize.ts:7` `useTerminalSize`
- `src/global.d.ts` `MACRO` global (built-time injected)

---

## Task 1: Pure helpers — `formatContextWindow` + `expandTilde` (TDD)

**Files:**
- Create: `src/components/StartupHeader/StartupHeader.pure.ts`
- Create: `src/components/StartupHeader/StartupHeader.test.ts`

The first task creates the module skeleton and ships two independent helpers with TDD coverage.

- [ ] **Step 1: Create the test file with failing tests for `formatContextWindow` and `expandTilde`**

Write `src/components/StartupHeader/StartupHeader.test.ts` with the contents below. Both `formatContextWindow` and `expandTilde` are imported from `./StartupHeader.pure.js` but don't exist yet, so the file fails to compile.

```ts
// @ts-nocheck
import { describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import {
  expandTilde,
  formatContextWindow,
} from './StartupHeader.pure.js'

describe('formatContextWindow', () => {
  test('formats millions compactly', () => {
    expect(formatContextWindow(1_000_000)).toBe('1M')
  })

  test('formats thousands compactly', () => {
    expect(formatContextWindow(200_000)).toBe('200K')
  })

  test('formats 128k as 128K', () => {
    expect(formatContextWindow(128_000)).toBe('128K')
  })

  test('returns 0 for 0', () => {
    expect(formatContextWindow(0)).toBe('0')
  })

  test('returns 0 for negative numbers (fallback)', () => {
    expect(formatContextWindow(-1)).toBe('0')
  })

  test('returns 0 for non-finite numbers', () => {
    expect(formatContextWindow(Number.NaN)).toBe('0')
    expect(formatContextWindow(Number.POSITIVE_INFINITY)).toBe('0')
  })
})

describe('expandTilde', () => {
  test('expands path under home', () => {
    const home = homedir()
    expect(expandTilde(`${home}/code/opencc`)).toBe('~/code/opencc')
  })

  test('returns home itself as ~', () => {
    const home = homedir()
    expect(expandTilde(home)).toBe('~')
  })

  test('returns non-home absolute paths unchanged', () => {
    expect(expandTilde('/var/log/app.log')).toBe('/var/log/app.log')
  })

  test('returns relative paths unchanged', () => {
    expect(expandTilde('relative/path')).toBe('relative/path')
  })

  test('returns empty string unchanged', () => {
    expect(expandTilde('')).toBe('')
  })

  test('does not match path that merely starts with home string but no separator', () => {
    const home = homedir()
    const trick = `${home}fake/file` // starts with home string, no separator
    expect(expandTilde(trick)).toBe(trick)
  })
})
```

- [ ] **Step 2: Run the test file to confirm it fails**

Run:
```bash
cd /Users/ethan/code/opencc && bun test src/components/StartupHeader/StartupHeader.test.ts 2>&1 | head -30
```

Expected: FAIL with "Cannot find module './StartupHeader.pure.js'" or TS2307 "cannot find" error. The whole file fails to load, so all tests are "failing" by absence.

- [ ] **Step 3: Create the pure module with `formatContextWindow` and `expandTilde` implementations**

Create `src/components/StartupHeader/StartupHeader.pure.ts`:

```ts
// @ts-nocheck
import { homedir } from 'os'
import { formatTokens } from '../../utils/format.js'

/**
 * Format a token count using compact notation (1M / 200K / etc.).
 * Falls back to '0' for any non-positive or non-finite input.
 */
export function formatContextWindow(tokens: number): string {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) {
    return '0'
  }
  return formatTokens(tokens)
}

/**
 * Replace the user's home directory prefix with `~`.
 * Returns the path unchanged if it is not under home, is relative,
 * is empty, or the home directory cannot be determined.
 */
export function expandTilde(path: string): string {
  if (!path) return path
  let home: string
  try {
    home = homedir()
  } catch {
    return path
  }
  if (!home) return path
  if (path === home) return '~'
  if (path.startsWith(home + '/')) {
    return '~' + path.slice(home.length)
  }
  return path
}
```

- [ ] **Step 4: Re-run the tests to confirm they pass**

Run:
```bash
cd /Users/ethan/code/opencc && bun test src/components/StartupHeader/StartupHeader.test.ts 2>&1 | tail -20
```

Expected: PASS — 12 tests passing (6 for `formatContextWindow`, 6 for `expandTilde`).

- [ ] **Step 5: Commit**

```bash
cd /Users/ethan/code/opencc
git add src/components/StartupHeader/
git commit -m "feat(splash): add formatContextWindow + expandTilde pure helpers"
```

---

## Task 2: Pure helper — `truncatePath` (TDD)

**Files:**
- Modify: `src/components/StartupHeader/StartupHeader.pure.ts`
- Modify: `src/components/StartupHeader/StartupHeader.test.ts`

Adds the path-truncation helper used to fit the directory line into narrow terminals.

- [ ] **Step 1: Add failing tests for `truncatePath` to the existing test file**

Append the following block to the bottom of `src/components/StartupHeader/StartupHeader.test.ts` (before the last `}` of the file is closed, i.e. as a new `describe` block):

```ts
import { truncatePath } from './StartupHeader.pure.js'

describe('truncatePath', () => {
  test('returns path unchanged when it already fits', () => {
    expect(truncatePath('~/code/opencc', 14)).toBe('~/code/opencc')
  })

  test('returns path unchanged when shorter than maxWidth', () => {
    expect(truncatePath('~/a', 14)).toBe('~/a')
  })

  test('returns path unchanged when maxWidth is below the truncation threshold (10)', () => {
    expect(truncatePath('x'.repeat(50), 5)).toBe('x'.repeat(50))
    expect(truncatePath('x'.repeat(50), 9)).toBe('x'.repeat(50))
  })

  test('elides middle segments when path is too long', () => {
    expect(truncatePath('~/code/opencc', 12)).toBe('~/.../opencc')
  })

  test('caps length at maxWidth for paths with no separators', () => {
    const long = 'x'.repeat(200)
    const result = truncatePath(long, 30)
    expect(result.length).toBeLessThanOrEqual(30)
  })

  test('keeps first and last segment when there are at least 3 parts', () => {
    expect(truncatePath('/a/b/c/d/e/f.txt', 12)).toBe('/a/.../f.txt')
  })
})
```

- [ ] **Step 2: Run only the new tests to confirm they fail**

Run:
```bash
cd /Users/ethan/code/opencc && bun test src/components/StartupHeader/StartupHeader.test.ts -t 'truncatePath' 2>&1 | tail -15
```

Expected: FAIL with "Cannot find name 'truncatePath'" (TS2304) or runtime ReferenceError.

- [ ] **Step 3: Add `truncatePath` to the pure module**

Append to the bottom of `src/components/StartupHeader/StartupHeader.pure.ts`:

```ts
/**
 * Truncate a path to fit `maxWidth` columns, keeping the first and last
 * segments and eliding the middle. Returns the path unchanged if it
 * already fits or if maxWidth is below the 10-char truncation threshold.
 */
export function truncatePath(path: string, maxWidth: number): string {
  if (maxWidth < 10) return path
  if (path.length <= maxWidth) return path
  const parts = path.split('/')
  if (parts.length <= 2) {
    return path.slice(0, maxWidth)
  }
  const first = parts[0]
  const last = parts[parts.length - 1]
  const candidate = `${first}/.../${last}`
  if (candidate.length <= maxWidth) return candidate
  return candidate.slice(0, maxWidth)
}
```

- [ ] **Step 4: Re-run the new tests to confirm they pass**

Run:
```bash
cd /Users/ethan/code/opencc && bun test src/components/StartupHeader/StartupHeader.test.ts -t 'truncatePath' 2>&1 | tail -10
```

Expected: PASS — 6 new `truncatePath` tests passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/ethan/code/opencc
git add src/components/StartupHeader/
git commit -m "feat(splash): add truncatePath pure helper"
```

---

## Task 3: Pure line builders — `buildHeaderLine` + `buildDirectoryLine` (TDD)

**Files:**
- Modify: `src/components/StartupHeader/StartupHeader.pure.ts`
- Modify: `src/components/StartupHeader/StartupHeader.test.ts`

Two simple line formatters that compose into the rendered output.

- [ ] **Step 1: Add failing tests for both builders**

Append to `src/components/StartupHeader/StartupHeader.test.ts`:

```ts
import {
  buildDirectoryLine,
  buildHeaderLine,
} from './StartupHeader.pure.js'

describe('buildHeaderLine', () => {
  test('renders default brand and version', () => {
    expect(buildHeaderLine('0.11.1')).toBe('>_ OpenCC (v0.11.1)')
  })

  test('accepts custom brand', () => {
    expect(buildHeaderLine('0.11.1', 'CustomBrand')).toBe('>_ CustomBrand (v0.11.1)')
  })
})

describe('buildDirectoryLine', () => {
  test('renders label padded to 24 columns then path', () => {
    expect(buildDirectoryLine('~/code/opencc')).toBe('directory:              ~/code/opencc')
  })

  test('preserves padding when path is empty', () => {
    const result = buildDirectoryLine('')
    expect(result.startsWith('directory:')).toBe(true)
    expect(result.length).toBe(24)
  })
})
```

(Note: 'directory:' is 10 chars; padEnd(24) gives 14 trailing spaces. So result = `'directory:' + ' '.repeat(14) + path'`. Adjust the test string if your local Node's padEnd semantics differ — verify by running.)

- [ ] **Step 2: Run new tests to confirm they fail**

Run:
```bash
cd /Users/ethan/code/opencc && bun test src/components/StartupHeader/StartupHeader.test.ts -t 'buildHeaderLine|buildDirectoryLine' 2>&1 | tail -10
```

Expected: FAIL — `buildHeaderLine` / `buildDirectoryLine` not yet exported.

- [ ] **Step 3: Add both builders to the pure module**

Append to `src/components/StartupHeader/StartupHeader.pure.ts`:

```ts
const LABEL_COLUMN_WIDTH = 24

/**
 * Build the top-line header shown above the model/directory box.
 * Default brand is 'OpenCC'.
 */
export function buildHeaderLine(version: string, brand: string = 'OpenCC'): string {
  return `>_ ${brand} (v${version})`
}

/**
 * Build the directory line: a 'directory:' label padded to 24 columns,
 * followed by the (already expanded and truncated) path.
 */
export function buildDirectoryLine(expandedPath: string): string {
  return 'directory:'.padEnd(LABEL_COLUMN_WIDTH) + expandedPath
}
```

- [ ] **Step 4: Re-run tests to confirm they pass**

Run:
```bash
cd /Users/ethan/code/opencc && bun test src/components/StartupHeader/StartupHeader.test.ts 2>&1 | tail -10
```

Expected: PASS — all tests in the file pass (the exact whitespace assertion in the directory test should match `'directory:'.padEnd(24) + '~/code/opencc'` which is `'directory:' + ' '.repeat(14) + '~/code/opencc'`, length 38).

- [ ] **Step 5: Commit**

```bash
cd /Users/ethan/code/opencc
git add src/components/StartupHeader/
git commit -m "feat(splash): add buildHeaderLine + buildDirectoryLine"
```

---

## Task 4: Pure line builder — `buildModelLine` (TDD)

**Files:**
- Modify: `src/components/StartupHeader/StartupHeader.pure.ts`
- Modify: `src/components/StartupHeader/StartupHeader.test.ts`

The most complex pure function — composes the model display, optional context window suffix, and the `/model to change` hint into a single aligned line.

- [ ] **Step 1: Add failing tests for `buildModelLine`**

Append to `src/components/StartupHeader/StartupHeader.test.ts`:

```ts
import { buildModelLine } from './StartupHeader.pure.js'

describe('buildModelLine', () => {
  test('renders default hint and 4-space gap between content and hint', () => {
    const result = buildModelLine('MiniMax-M3 high')
    // 'model:' + 16 spaces (padEnd 24) + 'MiniMax-M3 high' + 4 spaces + '/model to change'
    expect(result).toBe('model:                MiniMax-M3 high    /model to change')
  })

  test('accepts a custom hint', () => {
    expect(buildModelLine('x', 'custom hint')).toContain('custom hint')
    expect(buildModelLine('x', 'custom hint')).not.toContain('/model to change')
  })

  test('keeps label column width when model is empty', () => {
    const result = buildModelLine('')
    expect(result.startsWith('model:'.padEnd(24))).toBe(true)
    expect(result).toContain('/model to change')
  })

  test('appends (1M) when contextWindow is 1_000_000', () => {
    expect(buildModelLine('MiniMax-M3 high', undefined, 1_000_000)).toContain(' (1M)')
  })

  test('appends (200K) when contextWindow is 200_000', () => {
    expect(buildModelLine('x', undefined, 200_000)).toContain(' (200K)')
  })

  test('does not append suffix when contextWindow is 0', () => {
    expect(buildModelLine('x', undefined, 0)).not.toMatch(/\(\d/)
  })

  test('does not append suffix when contextWindow is undefined', () => {
    expect(buildModelLine('x')).not.toMatch(/\(\d/)
  })

  test('does not append suffix when contextWindow is null', () => {
    expect(buildModelLine('x', undefined, null)).not.toMatch(/\(\d/)
  })

  test('does not append suffix when contextWindow is negative', () => {
    expect(buildModelLine('x', undefined, -1)).not.toMatch(/\(\d/)
  })

  test('renders placeholder when modelDisplay is the (no model) marker', () => {
    const result = buildModelLine('(no model)', undefined, undefined)
    expect(result).toContain('(no model)')
    expect(result).toContain('/model to change')
  })
})
```

- [ ] **Step 2: Run new tests to confirm they fail**

Run:
```bash
cd /Users/ethan/code/opencc && bun test src/components/StartupHeader/StartupHeader.test.ts -t 'buildModelLine' 2>&1 | tail -10
```

Expected: FAIL — `buildModelLine` not yet exported.

- [ ] **Step 3: Add `buildModelLine` to the pure module**

Append to `src/components/StartupHeader/StartupHeader.pure.ts`:

```ts
const DEFAULT_HINT = '/model to change'
const HINT_GAP = '    ' // 4 spaces

/**
 * Build the model line: a 'model:' label padded to 24 columns, then the
 * model display, then an optional ' (N)' context window suffix, then
 * 4 spaces, then the hint.
 *
 * @param modelDisplay - pre-formatted model name (e.g. 'MiniMax-M3 high') or '(no model)'
 * @param hint - the hint suffix shown to the right (default '/model to change')
 * @param contextWindow - if a positive finite number, append ' (N)' using formatContextWindow
 */
export function buildModelLine(
  modelDisplay: string,
  hint: string = DEFAULT_HINT,
  contextWindow?: number | null,
): string {
  const label = 'model:'.padEnd(LABEL_COLUMN_WIDTH)
  let content = modelDisplay
  if (typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0) {
    content += ` (${formatContextWindow(contextWindow)})`
  }
  return `${label}${content}${HINT_GAP}${hint}`
}
```

- [ ] **Step 4: Re-run the full test file to confirm all pure tests pass**

Run:
```bash
cd /Users/ethan/code/opencc && bun test src/components/StartupHeader/StartupHeader.test.ts 2>&1 | tail -15
```

Expected: PASS — 28+ tests across all 6 pure functions, 0 fail.

- [ ] **Step 5: Commit**

```bash
cd /Users/ethan/code/opencc
git add src/components/StartupHeader/
git commit -m "feat(splash): add buildModelLine with context window suffix"
```

---

## Task 5: Create the Ink `StartupHeader.tsx` component

**Files:**
- Create: `src/components/StartupHeader/StartupHeader.tsx`

Build the actual UI component. Reads from `useAppState`, `getCwd`, `getContextWindowForModel`, `useTerminalSize`, and `renderModelSetting`. Memoized so re-renders only fire when model / cwd / columns change.

- [ ] **Step 1: Create the component file**

Create `src/components/StartupHeader/StartupHeader.tsx`:

```tsx
// @ts-nocheck
import { Box, Text } from '../../ink.js'
import * as React from 'react'
import { useMemo } from 'react'
import { useAppState } from '../../state/AppState.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { getCwd } from '../../utils/cwd.js'
import { getContextWindowForModel } from '../../utils/context.js'
import { renderModelSetting } from '../../utils/model/model.js'
import {
  buildDirectoryLine,
  buildHeaderLine,
  buildModelLine,
  expandTilde,
  truncatePath,
} from './StartupHeader.pure.js'

function safeGetCwd(): string {
  try {
    return getCwd()
  } catch {
    return process.cwd()
  }
}

function safeRenderModel(name: string): string {
  try {
    return renderModelSetting(name)
  } catch {
    return name
  }
}

function safeContextWindow(name: string): number | undefined {
  try {
    return getContextWindowForModel(name)
  } catch {
    return undefined
  }
}

export const StartupHeader: React.FC = React.memo(function StartupHeader() {
  const modelName = useAppState(s => s.mainLoopModel)
  const { columns } = useTerminalSize()
  const cwd = useMemo(() => safeGetCwd(), [])

  const expanded = useMemo(() => expandTilde(cwd), [cwd])
  // Reserve space for box border (2 chars) + label padding (24) + safety
  const dirMax = Math.max(10, columns - 30)
  const dir = useMemo(() => truncatePath(expanded, dirMax), [expanded, dirMax])
  const modelDisplay = modelName ? safeRenderModel(modelName) : '(no model)'
  const ctxWindow = modelName ? safeContextWindow(modelName) : undefined

  const header = useMemo(
    () => buildHeaderLine(MACRO?.DISPLAY_VERSION ?? MACRO?.VERSION ?? 'unknown'),
    [],
  )
  const modelLine = useMemo(
    () => buildModelLine(modelDisplay, '/model to change', ctxWindow),
    [modelDisplay, ctxWindow],
  )
  const dirLine = useMemo(() => buildDirectoryLine(dir), [dir])

  return (
    <Box flexDirection="column">
      <Text dimColor>{header}</Text>
      <Box
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        flexDirection="column"
      >
        <Text>{modelLine}</Text>
        <Text>{dirLine}</Text>
      </Box>
    </Box>
  )
})
```

Notes:
- `MACRO` is a build-time-injected global declared in `src/global.d.ts`. The `?.` defensive access keeps tests happy when the global is undefined.
- `useAppState(s => s.mainLoopModel)` returns `string | undefined`; if undefined we render `(no model)`.
- `useTerminalSize` requires `TerminalSizeContext` to be present in the React tree — `App` provides it in production. Tests must wrap with the provider (Task 6).

- [ ] **Step 2: Typecheck the new component**

Run:
```bash
cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | tail -20
```

Expected: PASS — no new type errors. The file uses `// @ts-nocheck` so the import paths and React Compiler output don't break typecheck.

- [ ] **Step 3: Commit**

```bash
cd /Users/ethan/code/opencc
git add src/components/StartupHeader/StartupHeader.tsx
git commit -m "feat(splash): add StartupHeader Ink component"
```

---

## Task 6: Add snapshot tests in `StartupHeader.test.tsx`

**Files:**
- Create: `src/components/StartupHeader/StartupHeader.test.tsx`

The plan spec calls these "ink snapshot" tests. The codebase pattern (per `src/components/TextInput.test.tsx` and `src/components/ThemePicker.test.tsx`) uses `bun:test` + `createRoot` + `PassThrough` streams + `extractLastFrame` to get the rendered string. We follow that exact pattern.

- [ ] **Step 1: Create the test file**

Create `src/components/StartupHeader/StartupHeader.test.tsx`:

```tsx
// @ts-nocheck
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import { afterEach, describe, expect, test } from 'bun:test'
import React from 'react'
import { createRoot } from '../../ink.js'
import { TerminalSizeContext } from '../../ink/components/TerminalSizeContext.js'
import { AppStateProvider, useAppStateStore } from '../../state/AppState.js'
import { StartupHeader } from './StartupHeader.js'

;(globalThis as { MACRO?: { VERSION?: string; DISPLAY_VERSION?: string } }).MACRO ??= {
  VERSION: '0.11.1-test',
}

const SYNC_START = '\x1B[?2026h'
const SYNC_END = '\x1B[?2026l'

function extractLastFrame(output: string): string {
  let lastFrame: string | null = null
  let cursor = 0
  while (cursor < output.length) {
    const start = output.indexOf(SYNC_START, cursor)
    if (start === -1) break
    const contentStart = start + SYNC_START.length
    const end = output.indexOf(SYNC_END, contentStart)
    if (end === -1) break
    const frame = output.slice(contentStart, end)
    if (frame.trim().length > 0) lastFrame = frame
    cursor = end + SYNC_END.length
  }
  return lastFrame ?? output
}

function createTestStreams(columns: number) {
  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = columns
  stdout.on('data', chunk => { output += chunk.toString() })
  return { stdout, stdin, getOutput: () => output }
}

async function renderHeader(
  columns: number,
  modelName: string | undefined,
): Promise<string> {
  const { stdout, stdin, getOutput } = createTestStreams(columns)
  const root = await createRoot({ stdout, stdin })
  await root.render(
    <AppStateProvider>
      <TerminalSizeContext.Provider value={{ columns, rows: 24 }}>
        <StartupHeaderSetter modelName={modelName} />
      </TerminalSizeContext.Provider>
    </AppStateProvider>,
  )
  // Allow the render to flush
  await new Promise(resolve => setTimeout(resolve, 50))
  root.unmount()
  return stripAnsi(extractLastFrame(getOutput()))
}

function StartupHeaderSetter({ modelName }: { modelName: string | undefined }) {
  // Set the model on mount so the rendered header reflects it
  if (modelName !== undefined) {
    useAppStateStore().setState({ mainLoopModel: modelName })
  }
  return <StartupHeader />
}

describe('StartupHeader', () => {
  let activeRoot: { unmount: () => void } | null = null
  afterEach(() => {
    activeRoot?.unmount()
    activeRoot = null
  })

  test('renders header line + model line + directory line at 80 cols', async () => {
    const frame = await renderHeader(80, 'claude-sonnet-4-6')
    expect(frame).toContain('>_ OpenCC (v0.11.1-test)')
    expect(frame).toContain('model:')
    expect(frame).toContain('directory:')
    expect(frame).toContain('/model to change')
  })

  test('appends (1M) when model has 1M context window', async () => {
    const frame = await renderHeader(80, 'claude-sonnet-4-6[1m]')
    expect(frame).toMatch(/\(1M\)/)
  })

  test('appends (200K) when model has 200K context window', async () => {
    const frame = await renderHeader(80, 'claude-sonnet-4-6')
    expect(frame).toMatch(/\(200K\)/)
  })

  test('falls back to (no model) when mainLoopModel is undefined', async () => {
    const frame = await renderHeader(80, undefined)
    expect(frame).toContain('(no model)')
  })

  test('truncates directory at narrow terminal widths', async () => {
    const frame = await renderHeader(24, 'claude-sonnet-4-6')
    expect(frame).toContain('...')
  })

  test('does not append (N) when context window is 0 or missing', async () => {
    const frame = await renderHeader(80, undefined)
    expect(frame).not.toMatch(/\(\d+[KM]\)/)
  })
})
```

- [ ] **Step 2: Run the snapshot tests**

Run:
```bash
cd /Users/ethan/code/opencc && bun test src/components/StartupHeader/StartupHeader.test.tsx 2>&1 | tail -30
```

Expected: PASS — 6 tests passing. If any fail with "TerminalSizeContext" or "useTerminalSize must be used within" errors, double-check the `TerminalSizeContext.Provider` wrapper in `renderHeader`.

- [ ] **Step 3: Commit**

```bash
cd /Users/ethan/code/opencc
git add src/components/StartupHeader/StartupHeader.test.tsx
git commit -m "test(splash): add Ink snapshot tests for StartupHeader"
```

---

## Task 7: Wire `StartupHeader` into `Messages.tsx`

**Files:**
- Modify: `src/components/Messages.tsx:63` (inside the `LogoHeader` `_c` sentinel block)
- Modify: `src/components/Messages.tsx` (add import at top)

The `LogoHeader` is generated by the React Compiler (`// @ts-nocheck` + `_c` cache sentinel). We only touch the `t1` value inside the sentinel-init branch — the rest of the memoization machinery stays intact.

- [ ] **Step 1: Add the import**

At the top of `src/components/Messages.tsx`, find the import block (currently lines 1-46) and add a new import **alphabetically among the other `./...` imports** (between `StatusNotices` and `StreamingMarkdown` works). Insert:

```ts
import { StartupHeader } from './StartupHeader/StartupHeader.js'
```

- [ ] **Step 2: Change the `t1` value in the sentinel-init block**

Locate lines 62-64 of `src/components/Messages.tsx`:

```tsx
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = null;
    $[0] = t1;
  } else {
```

Change `t1 = null;` to `t1 = <StartupHeader />;`. Result:

```tsx
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <StartupHeader />;
    $[0] = t1;
  } else {
```

Do NOT touch `$[0] = t1;`, the `else` branch, or any other line in the `_c` block. The React Compiler will regenerate the surrounding cache-sentinel logic on the next build.

- [ ] **Step 3: Typecheck**

Run:
```bash
cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 4: Run the full StartupHeader test suite**

Run:
```bash
cd /Users/ethan/code/opencc && bun test src/components/StartupHeader/ 2>&1 | tail -15
```

Expected: PASS — all unit + snapshot tests pass.

- [ ] **Step 5: Build the project (re-runs React Compiler on Messages.tsx)**

Run:
```bash
cd /Users/ethan/code/opencc && bun run build 2>&1 | tail -20
```

Expected: build succeeds. Confirm `dist/cli.mjs` was regenerated: `ls -la dist/cli.mjs` shows a recent mtime.

- [ ] **Step 6: Smoke test the CLI**

Run:
```bash
cd /Users/ethan/code/opencc && node dist/cli.mjs -p "what model are you using" 2>&1 | head -30
```

Expected: the CLI starts, prints the new splash header (header line + rounded box with model + directory), then continues with the prompt. The first paint should show:
- Line 1: `>_ OpenCC (vX.Y.Z)` (dim)
- Rounded box containing model + directory lines

(If the smoke test fails because of an unrelated issue, run `git diff src/components/Messages.tsx` to confirm only the intended 2 changes are present and try a narrower test — but the build step is the strongest signal that the change is sound.)

- [ ] **Step 7: Commit**

```bash
cd /Users/ethan/code/opencc
git add src/components/Messages.tsx
git commit -m "feat(splash): wire StartupHeader into REPL LogoHeader"
```

---

## Task 8: Final verification + push

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run:
```bash
cd /Users/ethan/code/opencc && bun test 2>&1 | tail -10
```

Expected: same pass count as `main-openccv2` baseline (1961+ pass, 0 fail as of 2026-06-04). The new module adds 34+ tests; the baseline should grow accordingly.

- [ ] **Step 2: Typecheck (strict mode)**

Run:
```bash
cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | tail -5
```

Expected: exit code 0.

- [ ] **Step 3: Smoke + hardening check**

Run:
```bash
cd /Users/ethan/code/opencc && bun run smoke 2>&1 | tail -10
```

Expected: smoke passes.

- [ ] **Step 4: Verify the file diff matches the plan's intent**

Run:
```bash
cd /Users/ethan/code/opencc && git log --oneline main-openccv2..HEAD
```

Expected: 6 new commits matching Task 1-7 commit messages, in order. No commits on `Messages.tsx` other than the one from Task 7.

Run:
```bash
cd /Users/ethan/code/opencc && git diff main-openccv2..HEAD --stat
```

Expected: 4 new files under `src/components/StartupHeader/`, 1 modified line in `src/components/Messages.tsx`, 1 added import line.

- [ ] **Step 5: Push the branch**

```bash
cd /Users/ethan/code/opencc && git push origin main-openccv2 2>&1 | tail -5
```

Expected: push succeeds. If push is rejected (non-fast-forward), investigate with `git fetch origin` + `git log --oneline origin/main-openccv2..HEAD` — do not force-push.

---

## Self-Review Checklist

Before considering this plan complete, verify:

- [ ] **Spec coverage:** Each spec requirement maps to a task:
  - Header line with brand/version → Task 3 (`buildHeaderLine`)
  - Rounded border, dimColor → Task 5 (component JSX)
  - Model line with hint + `(N)` context → Tasks 4 + 5
  - Directory line with `~` expansion + truncation → Tasks 1 + 2 + 3
  - Pure function / component split → Tasks 1-4 vs Task 5
  - Unit + snapshot tests → Tasks 1-4 unit, Task 6 snapshot
  - `Messages.tsx` one-line wire-in → Task 7
- [ ] **Placeholders:** No "TBD" or "add later" — every step has actual code.
- [ ] **Type consistency:** `formatContextWindow` called from `buildModelLine` (Task 4 references Task 1's export); `truncatePath` called from Task 5 with `(expanded, dirMax)`; `useAppState(s => s.mainLoopModel)` is the locked selector from `src/services/api/agentRouting.ts:17`.
- [ ] **No new deps:** no `package.json` changes; `ink-testing-library` was spec-aspirational but the plan uses the actual codebase pattern (`createRoot` + `PassThrough`).
- [ ] **No new files outside spec:** only the 4 files in the spec's "Integration point" table.
- [ ] **Frequent commits:** 7 commits across 7 tasks (8th task is verification only).
