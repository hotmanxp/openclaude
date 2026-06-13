# OpenCC Splash — Claude Code style

**Date:** 2026-06-13
**Status:** DESIGN (brainstorming approved, plan pending)
**Replaces:** `2026-06-04-opencc-splash-codex-style-design.md` (Codex style splash)

## Goal

Replace the current Codex-style splash (rounded box + `>_` prompt + 3 stacked label lines) with Claude Code's signature horizontal layout: 3-row ASCII mascot on the left, brand/version + model + cwd text on the right. Brand text changes from `OpenCC` (Codex style) to `OpenCC` rendered with Claude's typography (bold + dimColor for version). The mascot character is the upstream Claude Code sprite.

## Why

User asked on 2026-06-13: "将启动画面改为和claude一样（保留OpenCC）". The Codex-style splash was a deliberate choice in the 2026-06-04 redesign (15 commits, 6 design iterations, locked in commit `8662f69f`). This spec supersedes that decision; the user has changed their mind about the direction.

## Final layout (visual target)

```
 ▐▛███▜▌   OpenCC v0.16.1
▝▜█████▛▘  MiniMax-M3 with high effort
  ▘▘ ▝▝   ~ /code/opencc
```

billingType is **NOT** rendered. Only model name + effort suffix. User decision 2026-06-13.

- Mascot left: 3-row ASCII sprite in `theme.mascotPrimary` (default `#d97757`)
- Text right: 3 rows in default theme color, brand bold, secondary text dim
- No border, no rounded box, no `>_` prompt prefix
- Layout uses Ink `<Box flexDirection="row" gap={1} alignSelf="flex-start">`

## Files

| File | Change |
|---|---|
| `src/components/StartupHeader/ClaudeMascot.tsx` | **NEW** — pure 3-row mascot component |
| `src/components/StartupHeader/StartupHeader.tsx` | **REWRITE** — horizontal layout, drop rounded box + `>_` prefix |
| `src/components/StartupHeader/StartupHeader.pure.ts` | **KEEP** `expandTilde` + `truncatePath`; **DELETE** `buildHeaderLine` / `buildDirectoryLine` / `buildModelLine` / `formatContextWindow` / `LABEL_COLUMN_WIDTH` / `DEFAULT_HINT` / `HINT_GAP` (no longer called) |
| `src/components/StartupHeader/StartupHeader.test.tsx` | **REWRITE** snapshots for new layout |
| `src/components/StartupHeader/ClaudeMascot.test.tsx` | **NEW** — mascot snapshot |
| `src/utils/theme.ts` | **ADD** `mascotPrimary: '#d97757'` token (matches existing `clawd_body` value; named `mascotPrimary` so the role is explicit, not "Clawd-specific") |
| `src/components/Messages.tsx` | **NO CHANGE** — `<StartupHeader />` is still wired in at line 64 |

## Components

### `ClaudeMascot.tsx` (NEW)

```ts
// @ts-nocheck
import { Text } from '../../ink.js'
import { useTheme } from '../../hooks/useTheme.js'

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
  const theme = useTheme()
  return (
    <>
      <Text color={theme.mascotPrimary}>{CLAUDE_MASCOT_ROWS[0]}</Text>
      <Text color={theme.mascotPrimary}>{CLAUDE_MASCOT_ROWS[1]}</Text>
      <Text color={theme.mascotPrimary}>{CLAUDE_MASCOT_ROWS[2]}</Text>
    </>
  )
}
```

Note: each row is its own `<Text>` (not one `<Text>` with newlines) because Ink renders `<Text>` children without line-height spacing — exactly what pixel alignment requires.

### `StartupHeader.tsx` (REWRITE)

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
import { formatModelAndBilling, getLogoDisplayData, truncatePath } from '../../utils/logoV2Utils.js'
import { renderModelSetting } from '../../utils/model/model.js'
import { ClaudeMascot } from './ClaudeMascot.js'
import { expandTilde } from './StartupHeader.pure.js'

export const StartupHeader: React.FC = React.memo(function StartupHeader() {
  const model = useMainLoopModel()
  const effortValue = useAppState(s => s.effortValue)
  const { columns } = useTerminalSize()
  const cwd = useMemo(() => {
    try { return getCwd() } catch { return process.cwd() }
  }, [])
  const expandedCwd = useMemo(() => expandTilde(cwd), [cwd])
  const { version, billingType } = getLogoDisplayData()
  const effortSuffix = getEffortSuffix(model, effortValue)
  const modelDisplay = model ? safeRenderModel(model) : '(no model)'
  const dirMax = Math.max(10, columns - 30)
  const truncatedCwd = truncatePath(expandedCwd, dirMax)
  // ... rest similar
})
```

(Full implementation in the plan doc; this spec only defines the shape.)

## Data flow

| Source | Field | Displayed as |
|---|---|---|
| `MACRO.DISPLAY_VERSION` | version | `OpenCC v{version}` (brand bold, version dim) |
| `useMainLoopModel()` + `renderModelSetting` | model name | `{modelDisplay}` |
| `useAppState(s => s.effortValue)` + `getEffortSuffix` | effort | "with {effortSuffix}" |
| `getCwd()` + `expandTilde()` + `truncatePath()` | cwd | `~ /path` |

**No billing field** — per user decision 2026-06-13, billingType is intentionally omitted from the splash. Only model name + effort suffix appears on the model row.

The model + effort suffix is rendered as a single string (`"{modelDisplay} with {effortSuffix}"`), no `formatModelAndBilling()` helper needed — that helper combines model + billing and is no longer relevant here.

## Theme

Add to `src/utils/theme.ts`:

```ts
mascotPrimary: '#d97757'
```

This is the same value as `clawd_body` but named to reflect its role (any mascot, not Clawd-specific). Both default to the same value — they could share an alias in a future cleanup, but for now a separate key keeps theme roles explicit.

## Error handling

- `safeGetCwd()` / `safeRenderModel()` / `safeContextWindow()` — keep existing pattern from `StartupHeader.tsx` for backwards-compat (fallback to `process.cwd()` / model name / undefined if any helper throws)
- `useTheme()` — falls through to default theme if no `<ThemeProvider>` ancestor (Ink fallback chain)

## Testing

### Unit (snapshot)

**`ClaudeMascot.test.tsx`** (NEW):
- Renders `<ClaudeMascot />` inside `<ThemeProvider>` with `mascotPrimary: '#ff0000'`
- Asserts 3 `<Text>` rows with exact sprite content + red color
- Pure happy-path; no async / state

**`StartupHeader.test.tsx`** (REWRITE):
- Isolated cwd mock (per `opencc-splash-snapshot-test-pollution` gotcha: use `mock.module()` with `initialState`, NOT module-scope mutation)
- Mocks `useMainLoopModel`, `useAppState(s => s.effortValue)`, `useTerminalSize`
- Renders `<StartupHeader />` inside `<ThemeProvider>`
- Asserts 3 mascot rows + 3 text rows with `OpenCC`, version, model+effort+billing, cwd
- 2-3 test cases: default model + effort, no effort, long cwd (truncated)

### Manual

- `bun run typecheck` → green
- `bun run smoke` → green
- `tui-func-verifier` agent runs `bun run dev` in PTY, captures splash, compares against reference image
- Verification command: `bunx tui-func-verifier --task "verify OpenCC splash matches Claude-style spec"`

## Risks & known gotchas

- **`opencc-splash-snapshot-test-pollution`** — previous redesign needed isolated cwd mock; new tests must use the same `mock.module()` pattern, not module-scope mutation
- **`opencc-build-define-exact-match-gotcha`** — `MACRO?.DISPLAY_VERSION` breaks Bun `define:` substitution → ReferenceError at runtime. Use bare `MACRO.DISPLAY_VERSION ?? MACRO.VERSION ?? 'unknown'`
- **Pixel alignment** — mascot rows render as separate `<Text>` children (not one block with `\n`) so Ink doesn't add line-height spacing. Do not refactor to single `<Text>` with newlines.
- **`claude` color token already exists** — no risk of conflict; we're adding `mascotPrimary` as a new role, not renaming `clawd_body`

## Migration

1. Write new `ClaudeMascot.tsx`
2. Write `ClaudeMascot.test.tsx`
3. Add `mascotPrimary` to theme
4. Rewrite `StartupHeader.tsx` (drop rounded box, drop `>_`, drop label/hint rows)
5. Delete unused pure helpers from `StartupHeader.pure.ts`
6. Rewrite `StartupHeader.test.tsx` snapshots
7. Run `bun run smoke` → expect green
8. Run `tui-func-verifier` → confirm visual match
9. Single PR / single commit (or 2 commits: theme + mascot, then startup)

## Out of scope

- Animations on the mascot (idle blink, hover reaction) — could be added later, but not part of this spec
- WelcomeV2 / onboarding screen changes — untouched
- VS Code extension splash — separate
- Web UI splash — separate

## Spec supersedes

This spec replaces the visual decisions in `2026-06-04-opencc-splash-codex-style-design.md`. Codex-style deviations (do not remove `(1M)` context suffix, do not move header back out of box, do not restore `printStartupScreen()`, do not change ACCENT color) are NO LONGER LOCKED. ACCENT color `rgb(240,148,100)` is no longer used in the splash — it may still appear elsewhere in the codebase.
