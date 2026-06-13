# OpenCC Splash Claude-Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OpenCC's Codex-style REPL splash (rounded box + `>_` prompt) with Claude Code's horizontal layout (3-row ASCII mascot left, brand+version/model/cwd text right). Brand says "OpenCC".

**Architecture:** Add a new `ClaudeMascot` component rendering the 3-row sprite verbatim from upstream; rewrite `StartupHeader` to use a horizontal `<Box flexDirection="row">` with the mascot on the left and 3 text rows on the right; delete the now-unused `buildHeaderLine` / `buildDirectoryLine` / `buildModelLine` / `formatContextWindow` helpers from `StartupHeader.pure.ts`. Wire via `useTheme()` + `getTheme(themeName)` so dark/light/ansi/daltonized themes all resolve to the same orange. No state changes, no new dependencies.

**Tech Stack:** TypeScript, React (Ink), Bun test, React Compiler (`_c`), snapshot tests via `ink`'s `createRoot`. Theme values are `rgb()` strings or `ansi:*` tokens. Project uses Bun (`bun test`, `bun run build`, `bun run typecheck`).

**Spec:** `docs/superpowers/specs/2026-06-13-opencc-splash-claude-style-design.md`

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/utils/theme.ts` | Modify | Add `mascotPrimary` to `Theme` type + all 6 theme objects |
| `src/components/StartupHeader/ClaudeMascot.tsx` | Create | Pure 3-row mascot render, theme-aware color |
| `src/components/StartupHeader/ClaudeMascot.test.tsx` | Create | Snapshot test for mascot rows |
| `src/components/StartupHeader/StartupHeader.tsx` | Rewrite | Horizontal layout: mascot + 3 text rows |
| `src/components/StartupHeader/StartupHeader.pure.ts` | Modify | Keep `expandTilde` + `truncatePath`; delete 5 dead helpers |
| `src/components/StartupHeader/StartupHeader.test.tsx` | Rewrite | New snapshot tests for horizontal layout |
| `src/components/Messages.tsx` | No change | `<StartupHeader />` still wired in at line 64 |

---

## Task 1: Add `mascotPrimary` theme token

**Files:**
- Modify: `src/utils/theme.ts:5-90` (Theme type) and the 6 theme literal blocks at lines 115, 197, 278, 359, 440, 521

- [ ] **Step 1: Add `mascotPrimary` to `Theme` type**

In `src/utils/theme.ts`, after line 53 (`clawd_body: string`), add:

```ts
  /** Sunset orange used by the Claude-mascot character in the REPL splash. */
  mascotPrimary: string
```

- [ ] **Step 2: Add `mascotPrimary` to all 6 theme objects**

The 6 themes are `lightTheme` (line 115), `lightAnsiTheme` (line 197), `darkAnsiTheme` (line 278), `lightDaltonizedTheme` (line 359), `darkTheme` (line 440), `darkDaltonizedTheme` (line 521). In each one, add `mascotPrimary` next to `clawd_body`:

For `lightTheme`, `lightDaltonizedTheme`, `darkTheme`, `darkDaltonizedTheme` (the rgb-based themes), insert after `clawd_background`:
```ts
    mascotPrimary: 'rgb(217,119,87)', // Sunset orange — matches upstream Claude mascot
```

For `lightAnsiTheme`, `darkAnsiTheme` (the ansi-based themes), insert after `clawd_background`:
```ts
    mascotPrimary: 'ansi:redBright',
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: exit 0. (Theme type now requires `mascotPrimary`, all 6 literals updated.)

- [ ] **Step 4: Run theme tests if any**

Run: `bun test src/utils/theme.test.ts 2>/dev/null || true`
Expected: passes if a theme test exists; "no test" is fine — coverage comes from StartupHeader tests downstream.

- [ ] **Step 5: Commit**

```bash
git add src/utils/theme.ts
git commit -m "feat(theme): add mascotPrimary token (rgb(217,119,87) / ansi:redBright)"
```

---

## Task 2: Add `ClaudeMascot` component (TDD)

**Files:**
- Create: `src/components/StartupHeader/ClaudeMascot.tsx`
- Create: `src/components/StartupHeader/ClaudeMascot.test.tsx`

- [ ] **Step 1: Write the failing snapshot test**

Create `src/components/StartupHeader/ClaudeMascot.test.tsx`:

```tsx
// @ts-nocheck
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import { describe, expect, mock, test } from 'bun:test'
import React from 'react'
import { createRoot } from '../../ink.js'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { ClaudeMascot } from './ClaudeMascot.js'

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

async function renderMascot(): Promise<string> {
  const output: { buf: string } = { buf: '' }
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
  ;(stdout as unknown as { columns: number }).columns = 80
  stdout.on('data', chunk => { output.buf += chunk.toString() })
  const root = await createRoot({ stdout, stdin })
  await root.render(
    <ThemeProvider initialState="dark"><ClaudeMascot /></ThemeProvider>,
  )
  await new Promise(resolve => setTimeout(resolve, 200))
  root.unmount()
  return stripAnsi(extractLastFrame(output.buf))
}

describe('ClaudeMascot', () => {
  test('renders the 3-row Claude mascot sprite', async () => {
    const frame = await renderMascot()
    expect(frame).toContain('▐▛███▜▌')
    expect(frame).toContain('▝▜█████▛▘')
    expect(frame).toContain('▘▘')
    expect(frame).toContain('▝▝')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/StartupHeader/ClaudeMascot.test.tsx`
Expected: FAIL with "ClaudeMascot is not defined" or "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

Create `src/components/StartupHeader/ClaudeMascot.tsx`:

```tsx
// @ts-nocheck
import { Text } from '../../ink.js'
import { getTheme } from '../../utils/theme.js'
import { useTheme } from '../design-system/ThemeProvider.js'

// 3-row Claude Code mascot sprite (verbatim from upstream claude splash).
// Each row is a fixed string; do NOT edit characters — they are designed
// to compose with the brand text on the right at the default terminal
// font width.
const CLAUDE_MASCOT_ROWS = [
  ' ▐▛███▜▌ ',
  '▝▜█████▛▘',
  '  ▘▘ ▝▝',
] as const

export function ClaudeMascot() {
  const [themeName] = useTheme()
  const theme = getTheme(themeName)
  return (
    <>
      <Text color={theme.mascotPrimary}>{CLAUDE_MASCOT_ROWS[0]}</Text>
      <Text color={theme.mascotPrimary}>{CLAUDE_MASCOT_ROWS[1]}</Text>
      <Text color={theme.mascotPrimary}>{CLAUDE_MASCOT_ROWS[2]}</Text>
    </>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/StartupHeader/ClaudeMascot.test.tsx`
Expected: PASS, 1 test green.

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/StartupHeader/ClaudeMascot.tsx src/components/StartupHeader/ClaudeMascot.test.tsx
git commit -m "feat(splash): add ClaudeMascot component (3-row ASCII sprite)"
```

---

## Task 3: Rewrite `StartupHeader` to horizontal layout (TDD)

**Files:**
- Modify: `src/components/StartupHeader/StartupHeader.tsx`
- Modify: `src/components/StartupHeader/StartupHeader.test.tsx`

- [ ] **Step 1: Rewrite the snapshot tests**

Replace the contents of `src/components/StartupHeader/StartupHeader.test.tsx` with:

```tsx
// @ts-nocheck
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import { describe, expect, mock, test } from 'bun:test'
import React from 'react'
import { createRoot } from '../../ink.js'
import { TerminalSizeContext } from '../../ink/components/TerminalSizeContext.js'
import { AppStateProvider } from '../../state/AppState.js'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { StartupHeader } from './StartupHeader.js'

// user.test.ts leaks a cwd.js mock returning 'C:\\repo'. Override here so the
// rendered directory line shows the expected real path.
mock.module('../../utils/cwd.js', () => ({
  getCwd: () => '/Users/test/code/opencc',
  pwd: () => '/Users/test/code/opencc',
  runWithCwdOverride: (cwd: string, fn: () => unknown) => fn(),
}))

;(globalThis as { MACRO?: { VERSION?: string; DISPLAY_VERSION?: string } }).MACRO = {
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
  stdout.on('data', chunk => {
    output += chunk.toString()
  })
  return { stdout, stdin, getOutput: () => output }
}

async function renderHeader(columns: number): Promise<string> {
  const { stdout, stdin, getOutput } = createTestStreams(columns)
  const root = await createRoot({ stdout, stdin })
  await root.render(
    <AppStateProvider>
      <ThemeProvider initialState="dark">
        <TerminalSizeContext.Provider value={{ columns, rows: 24 }}>
          <StartupHeader />
        </TerminalSizeContext.Provider>
      </ThemeProvider>
    </AppStateProvider>,
  )
  await new Promise(resolve => setTimeout(resolve, 500))
  root.unmount()
  return stripAnsi(extractLastFrame(getOutput()))
}

describe('StartupHeader (Claude-style)', () => {
  test('renders mascot + brand + version + model + cwd at 80 cols', async () => {
    const frame = await renderHeader(80)
    expect(frame).toContain('▐▛███▜▌')  // mascot head
    expect(frame).toContain('▝▜█████▛▘') // mascot body
    expect(frame).toContain('OpenCC')
    expect(frame).toContain('v0.11.1-test')
    expect(frame).toContain('/Users/test/code/opencc')
  })

  test('does not render Codex-style artifacts', async () => {
    const frame = await renderHeader(80)
    expect(frame).not.toContain('>_')
    expect(frame).not.toContain('directory:')
    expect(frame).not.toContain('model:')
    expect(frame).not.toContain('/model to change')
  })

  test('falls back to (no model) when mainLoopModel is null', async () => {
    const frame = await renderHeader(80)
    expect(frame).toContain('(no model)')
  })

  test('truncates cwd at narrow terminal widths', async () => {
    const frame = await renderHeader(24)
    expect(frame).toContain('...')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/components/StartupHeader/StartupHeader.test.tsx`
Expected: FAIL — current StartupHeader renders Codex layout (box, `>_`, `model:`, etc.); new tests assert against mascot + horizontal layout, so multiple `expect(...).toContain(...)` fail.

- [ ] **Step 3: Rewrite StartupHeader.tsx**

Replace the contents of `src/components/StartupHeader/StartupHeader.tsx`:

```tsx
// @ts-nocheck
import { Box, Text } from '../../ink.js'
import * as React from 'react'
import { useMemo } from 'react'
import { useAppState } from '../../state/AppState.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { getCwd } from '../../utils/cwd.js'
import { getEffortSuffix } from '../../utils/effort.js'
import { renderModelSetting } from '../../utils/model/model.js'
import { expandTilde, truncatePath } from './StartupHeader.pure.js'
import { ClaudeMascot } from './ClaudeMascot.js'

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

export const StartupHeader: React.FC = React.memo(function StartupHeader() {
  const model = useMainLoopModel()
  const effortValue = useAppState(s => s.effortValue)
  const { columns } = useTerminalSize()
  const cwd = useMemo(() => safeGetCwd(), [])
  const expanded = useMemo(() => expandTilde(cwd), [cwd])
  const dirMax = Math.max(10, columns - 30)
  const dir = useMemo(() => truncatePath(expanded, dirMax), [expanded, dirMax])
  const modelDisplay = model ? safeRenderModel(model) : '(no model)'
  const effortSuffix = model ? getEffortSuffix(model, effortValue) : ''
  const version = MACRO.DISPLAY_VERSION ?? MACRO.VERSION ?? 'unknown'

  return (
    <Box alignSelf="flex-start" flexDirection="row" gap={1}>
      <ClaudeMascot />
      <Box flexDirection="column">
        <Text>
          <Text bold>OpenCC</Text> <Text dimColor>v{version}</Text>
        </Text>
        <Text dimColor>
          {modelDisplay}{effortSuffix}
        </Text>
        <Text dimColor>~ {dir}</Text>
      </Box>
    </Box>
  )
})
```

**Important:** Use bare `MACRO.DISPLAY_VERSION` (no optional chaining) — per `opencc-build-define-exact-match-gotcha`, Bun `define:` only matches bare identifiers. `MACRO?.DISPLAY_VERSION` would break the substitution → ReferenceError at runtime.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/components/StartupHeader/StartupHeader.test.tsx`
Expected: PASS, 4 tests green. The test "does not render Codex-style artifacts" verifies we removed all old remnants.

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Run ClaudeMascot test (regression)**

Run: `bun test src/components/StartupHeader/`
Expected: all tests pass (ClaudeMascot + StartupHeader).

- [ ] **Step 7: Commit**

```bash
git add src/components/StartupHeader/StartupHeader.tsx src/components/StartupHeader/StartupHeader.test.tsx
git commit -m "feat(splash): replace Codex-style with Claude-style horizontal layout

- Drop rounded box, >_ prompt prefix, model:/directory: labels, /model hint
- Add ClaudeMascot left, 3 text rows right (brand+version/model/cwd)
- billingType intentionally omitted per user decision 2026-06-13
- Use bare MACRO.DISPLAY_VERSION (define: substitution requires bare id)"
```

---

## Task 4: Delete unused pure helpers from `StartupHeader.pure.ts`

**Files:**
- Modify: `src/components/StartupHeader/StartupHeader.pure.ts`

- [ ] **Step 1: Verify all references are gone**

Run: `grep -rn "buildHeaderLine\|buildDirectoryLine\|buildModelLine\|formatContextWindow\|LABEL_COLUMN_WIDTH\|DEFAULT_HINT\|HINT_GAP" src/`
Expected: 0 hits. (If any hit exists, STOP — investigate before deleting.)

- [ ] **Step 2: Delete dead helpers**

In `src/components/StartupHeader/StartupHeader.pure.ts`, replace the entire file with:

```ts
// @ts-nocheck
import { homedir } from 'os'

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
  const first = parts[0] === '' ? '/' + (parts[1] ?? '') : parts[0]
  const last = parts[parts.length - 1]
  const candidate = `${first}/.../${last}`
  if (candidate.length <= maxWidth) return candidate
  return candidate.slice(0, maxWidth)
}
```

- [ ] **Step 3: Run StartupHeader tests (regression)**

Run: `bun test src/components/StartupHeader/`
Expected: all tests pass.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/StartupHeader/StartupHeader.pure.ts
git commit -m "chore(splash): delete unused pure helpers

buildHeaderLine / buildDirectoryLine / buildModelLine /
formatContextWindow / LABEL_COLUMN_WIDTH / DEFAULT_HINT / HINT_GAP
are no longer referenced after Claude-style rewrite."
```

---

## Task 5: Run smoke + TUI verification

**Files:**
- None (verification only)

- [ ] **Step 1: Build**

Run: `bun run build`
Expected: exit 0.

- [ ] **Step 2: Run smoke**

Run: `bun run smoke`
Expected: green (build + quick smoke test).

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: 0 fail. Any pre-existing failures unrelated to splash are OK (verify they're not from this PR).

- [ ] **Step 4: TUI verification (manual / agent)**

Run in a separate terminal (or dispatch `tui-func-verifier` agent):
```bash
script -q /tmp/opencc-splash.txt bun run dev
# then type a prompt and exit
```

Visual confirmation:
- Splash shows 3-row mascot on left in sunset orange
- Brand text "OpenCC" in bold, version dim
- Model row shows model name + effort (e.g. "MiniMax-M3 with high effort") — NO billingType
- Cwd row shows truncated path with `~`
- No rounded box, no `>_` prompt, no `model:`/`directory:` labels

Capture the output for the commit message (optional).

- [ ] **Step 5: Confirm clean working tree**

Run: `git status --short`
Expected: only the spec doc + plan doc already committed (no uncommitted code changes). All implementation was committed per-task in Tasks 1-4.

---

## Acceptance criteria

- [ ] `bun run build` → exit 0
- [ ] `bun run typecheck` → exit 0
- [ ] `bun run smoke` → green
- [ ] `bun test src/components/StartupHeader/` → all pass
- [ ] `bun test` → 0 new failures
- [ ] Live TUI shows Claude-style splash matching spec layout
- [ ] No Codex-style artifacts (`>_`, `model:`, `directory:`, `/model`, rounded box) remain
- [ ] Brand text says "OpenCC" (not "Claude Code", "OPEN CLAUDE", or other)
- [ ] billingType NOT rendered (per user decision 2026-06-13)
- [ ] All 4 spec deviations from Codex era (no `(1M)` suffix, no header outside box, no `printStartupScreen`, ACCENT) no longer apply — Codex style is fully replaced

## Risks & known gotchas

- **`opencc-splash-snapshot-test-pollution`** — Tests in this PR MUST use `mock.module()` for cwd (not module-scope mutation) because `user.test.ts` leaks a CWD mock returning `C:\\repo`. The test files above already follow this pattern.
- **`opencc-build-define-exact-match-gotcha`** — `MACRO?.DISPLAY_VERSION` (with `?.`) breaks Bun `define:` string substitution → ReferenceError at TUI runtime. Always use bare `MACRO.DISPLAY_VERSION ?? MACRO.VERSION ?? 'unknown'`.
- **Pixel alignment** — Mascot renders 3 separate `<Text>` children, NOT one `<Text>` with embedded newlines. Newlines in a single `<Text>` would inherit Ink's line-height and break pixel alignment with brand text rows.
- **`useTheme()` returns a tuple** — `const [themeName] = useTheme()`, then `getTheme(themeName)` to get colors. Don't destructure to a `theme` variable directly.

## Out of scope

- WelcomeV2 / onboarding screen — untouched
- Animations on the mascot (idle blink, hover reaction)
- VS Code extension splash, Web UI splash
