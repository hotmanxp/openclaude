# Provider-Switch Default Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When user activates a different provider profile via `/provider` → "Set active provider", automatically reset `AppState.mainLoopModel` to the new profile's default model (skip when current model is an alias or already matches).

**Architecture:** Two pure helpers in `src/utils/providerProfiles.ts` (`getDefaultModelForProfile`, `maybeResetMainLoopModel`) decide IF and WHAT to reset; the existing `ProviderManager.tsx` `select-active` onSelect owns the actual `setAppState` call + `setStatusMessage` so React state mutation stays in the UI layer. No changes to `setActiveProviderProfile` signature, no profile.model persistence.

**Tech Stack:** TypeScript / Bun / React (Ink) / `bun:test`. Helpers live in `src/utils/providerProfiles.ts` and are pure functions (no React imports). UI wiring in `src/components/ProviderManager.tsx`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/utils/providerProfiles.ts` | Modify | Add `getDefaultModelForProfile(profile)` + `maybeResetMainLoopModel(activeProfile, currentModel)` exports. Reuse existing `parseModelList` from `src/utils/providerModels.ts` and `isModelAlias` from `src/utils/model/aliases.ts`. |
| `src/utils/providerProfiles.test.ts` | Modify | Append two `describe` blocks: `getDefaultModelForProfile` (4 cases), `maybeResetMainLoopModel` (8 cases). Use existing `importFreshProviderProfileModules()` helper. |
| `src/components/ProviderManager.tsx` | Modify | In `select-active` onSelect, after `setActiveProviderProfile` returns success: call `maybeResetMainLoopModel(active, currentMainLoopModel)`, and when `decision.reset === true` invoke `setAppState` + append "Model reset to {model}" to status message. |
| `src/components/ProviderManager.test.tsx` | Modify | Add a `describe('select-active model reset')` block that mounts `ProviderManager`, adds two profiles, activates one, and asserts (a) `mainLoopModel` updates and status contains "Model reset to", (b) when current model is an alias, status does NOT contain "Model reset to". |

## Global Constraints

- OpenCC provider policy: only `anthropic` / `ollama` / `openai-compatible` providers (no mistral/gemini/bedrock/etc.).
- TypeScript strict mode; use `.js` extensions in imports even from `.ts` files.
- bun:test patterns: `describe` / `test` / `expect` from `bun:test`; `mock` + `mock.module` for module mocking.
- Co-located tests `*.test.ts`/`*.test.tsx` next to source.
- "OpenCC" brand (not "Claude" / "OpenClaude") in any user-visible strings.
- ProviderManager test file uses `AppStateProvider` wrapper + `createRoot` + `KeybindingSetup` (see existing imports at top of `src/components/ProviderManager.test.tsx`).
- Helper is pure: NO React imports, NO `useAppState`, NO `setAppState` — only data in / decision out.

---

## Task 1: Add `getDefaultModelForProfile` helper (TDD)

**Files:**
- Modify: `src/utils/providerProfiles.ts` (add export after `getProviderPresetDefaults`, around line 200)
- Modify: `src/utils/providerProfiles.test.ts` (append `describe` block at end of file)

**Interfaces:**
- Consumes: existing `parseModelList(modelField: string): string[]` from `src/utils/providerModels.ts`
- Produces: `getDefaultModelForProfile(profile: ProviderProfile): string | null`
  - Returns first non-empty trimmed model from `profile.model`, or `null` if profile.model is empty/blank.

### Step 1.1: Write the failing tests

Append to `src/utils/providerProfiles.test.ts` (after the last existing test):

```typescript
describe('getDefaultModelForProfile', () => {
  const { getDefaultModelForProfile } = await importFreshProviderProfileModules()

  test('returns single model as-is', () => {
    expect(getDefaultModelForProfile(buildProfile({ model: 'glm-5.2' }))).toBe('glm-5.2')
  })

  test('returns first model from comma-separated list', () => {
    expect(
      getDefaultModelForProfile(buildProfile({ model: 'glm-4.5, glm-4.7' })),
    ).toBe('glm-4.5')
  })

  test('returns first model from semicolon-separated list', () => {
    expect(
      getDefaultModelForProfile(buildProfile({ model: 'glm-4.5; glm-4.7' })),
    ).toBe('glm-4.5')
  })

  test('returns null for empty string', () => {
    expect(getDefaultModelForProfile(buildProfile({ model: '' }))).toBeNull()
  })

  test('returns null for whitespace-only string', () => {
    expect(getDefaultModelForProfile(buildProfile({ model: '   ' }))).toBeNull()
  })
})
```

Note: The describe body's first line destructures from the fresh module — this mirrors the pattern at `src/utils/providerProfiles.test.ts:139-149` for `applyProviderProfileToProcessEnv`.

### Step 1.2: Run tests to verify they fail

Run: `bun test src/utils/providerProfiles.test.ts -t 'getDefaultModelForProfile'`
Expected: FAIL — `TypeError: getDefaultModelForProfile is not a function` (or similar)

### Step 1.3: Implement `getDefaultModelForProfile`

In `src/utils/providerProfiles.ts`, add this import at the top of the file (alongside the existing `parseModelList` import at line 15 — confirm exact location by reading the current import block):

```typescript
import { getPrimaryModel, parseModelList } from './providerModels.js'
```

(Already imported — verify, no action if already present.)

Then add the function after `getProviderPresetDefaults` (around line 200, before `getProviderProfiles`):

```typescript
/**
 * Return the default (first) model from a profile's model field.
 * The model field can be a single model name or a comma/semicolon-separated
 * list. Returns null when the field is empty or whitespace-only.
 *
 * Used by maybeResetMainLoopModel to decide what mainLoopModel should be
 * reset to when this profile is activated mid-session.
 */
export function getDefaultModelForProfile(profile: ProviderProfile): string | null {
  const models = parseModelList(profile.model)
  return models.length > 0 ? models[0] : null
}
```

### Step 1.4: Run tests to verify they pass

Run: `bun test src/utils/providerProfiles.test.ts -t 'getDefaultModelForProfile'`
Expected: PASS — 5 tests, 0 fail

### Step 1.5: Commit

```bash
git add src/utils/providerProfiles.ts src/utils/providerProfiles.test.ts
git commit -m "$(cat <<'EOF'
feat(provider): add getDefaultModelForProfile helper

Returns first model from profile.model (comma/semicolon separated list).
Pure function, no React state coupling. Used by maybeResetMainLoopModel
for next-task provider-switch model reset.
EOF
)"
```

---

## Task 2: Add `maybeResetMainLoopModel` helper (TDD)

**Files:**
- Modify: `src/utils/providerProfiles.ts` (add export after `getDefaultModelForProfile`)
- Modify: `src/utils/providerProfiles.test.ts` (append `describe` block after Task 1 tests)

**Interfaces:**
- Consumes: existing `isModelAlias(model: string): model is ModelAlias` from `src/utils/model/aliases.ts` (currently used at `src/utils/providerProfiles.ts` indirectly — confirm the import is added below)
- Produces: `maybeResetMainLoopModel(activeProfile: ProviderProfile, currentModel: string | undefined | null): { reset: boolean; previousModel?: string; newModel?: string }`
  - Decision algorithm (in order):
    1. `defaultModel = getDefaultModelForProfile(activeProfile)`; if `null` → return `{ reset: false }`
    2. `currentModel` is `undefined` / `null` → return `{ reset: true, newModel: defaultModel }`
    3. `currentModel === defaultModel` → return `{ reset: false }`
    4. `isModelAlias(currentModel)` → return `{ reset: false }`
    5. else → return `{ reset: true, previousModel: currentModel, newModel: defaultModel }`

### Step 2.1: Add `isModelAlias` import

In `src/utils/providerProfiles.ts`, add (or confirm presence of) this import alongside the existing imports:

```typescript
import { isModelAlias } from './model/aliases.js'
```

Verify the file does not already import it; if it does, skip this step.

### Step 2.2: Write the failing tests

Append to `src/utils/providerProfiles.test.ts` after the Task 1 describe block:

```typescript
describe('maybeResetMainLoopModel', () => {
  const { maybeResetMainLoopModel } = await importFreshProviderProfileModules()

  test('resets when currentModel is undefined', () => {
    expect(maybeResetMainLoopModel(buildProfile({ model: 'glm-5.2' }), undefined))
      .toEqual({ reset: true, newModel: 'glm-5.2' })
  })

  test('resets when currentModel is null', () => {
    expect(maybeResetMainLoopModel(buildProfile({ model: 'glm-5.2' }), null))
      .toEqual({ reset: true, newModel: 'glm-5.2' })
  })

  test('resets when currentModel is empty string', () => {
    expect(maybeResetMainLoopModel(buildProfile({ model: 'glm-5.2' }), ''))
      .toEqual({ reset: true, newModel: 'glm-5.2' })
  })

  test('skips when currentModel equals defaultModel', () => {
    expect(maybeResetMainLoopModel(buildProfile({ model: 'glm-5.2' }), 'glm-5.2'))
      .toEqual({ reset: false })
  })

  test('skips when currentModel is the alias "opus"', () => {
    expect(maybeResetMainLoopModel(buildProfile({ model: 'glm-5.2' }), 'opus'))
      .toEqual({ reset: false })
  })

  test('skips when currentModel is the alias "sonnet"', () => {
    expect(maybeResetMainLoopModel(buildProfile({ model: 'glm-5.2' }), 'sonnet'))
      .toEqual({ reset: false })
  })

  test('skips when currentModel is the alias "haiku"', () => {
    expect(maybeResetMainLoopModel(buildProfile({ model: 'glm-5.2' }), 'haiku'))
      .toEqual({ reset: false })
  })

  test('skips when currentModel is the alias "opus[1m]"', () => {
    expect(maybeResetMainLoopModel(buildProfile({ model: 'glm-5.2' }), 'opus[1m]'))
      .toEqual({ reset: false })
  })

  test('resets when currentModel is concrete and different from default', () => {
    expect(
      maybeResetMainLoopModel(buildProfile({ model: 'glm-5.2' }), 'zhiniao-MiniMax-M2.7'),
    ).toEqual({ reset: true, previousModel: 'zhiniao-MiniMax-M2.7', newModel: 'glm-5.2' })
  })

  test('uses first model from comma-separated profile.model', () => {
    expect(
      maybeResetMainLoopModel(buildProfile({ model: 'glm-4.5, glm-4.7' }), 'opus'),
    ).toEqual({ reset: false })
  })

  test('skips when profile.model is empty (no default to reset to)', () => {
    expect(maybeResetMainLoopModel(buildProfile({ model: '' }), 'whatever'))
      .toEqual({ reset: false })
  })
})
```

### Step 2.3: Run tests to verify they fail

Run: `bun test src/utils/providerProfiles.test.ts -t 'maybeResetMainLoopModel'`
Expected: FAIL — `TypeError: maybeResetMainLoopModel is not a function`

### Step 2.4: Implement `maybeResetMainLoopModel`

In `src/utils/providerProfiles.ts`, add directly after `getDefaultModelForProfile`:

```typescript
/**
 * Decide whether the session's mainLoopModel should be reset when the user
 * activates `activeProfile` via /provider → "Set active provider".
 *
 * Pure function — does not mutate AppState. The caller (ProviderManager.tsx
 * select-active onSelect) owns the setAppState call.
 *
 * Rules (evaluated in order):
 * 1. If profile has no default model → no reset.
 * 2. If currentModel is undefined/null/empty → reset to defaultModel.
 * 3. If currentModel === defaultModel → skip (already aligned).
 * 4. If currentModel is a model alias (opus/sonnet/haiku/best/...) → skip
 *    (preserves user's alias-based selection).
 * 5. Otherwise → reset, returning previousModel + newModel for caller to use
 *    in user-facing status message.
 */
export function maybeResetMainLoopModel(
  activeProfile: ProviderProfile,
  currentModel: string | undefined | null,
): { reset: boolean; previousModel?: string; newModel?: string } {
  const defaultModel = getDefaultModelForProfile(activeProfile)
  if (defaultModel === null) {
    return { reset: false }
  }

  if (currentModel === undefined || currentModel === null || currentModel === '') {
    return { reset: true, newModel: defaultModel }
  }

  if (currentModel === defaultModel) {
    return { reset: false }
  }

  if (isModelAlias(currentModel)) {
    return { reset: false }
  }

  return { reset: true, previousModel: currentModel, newModel: defaultModel }
}
```

### Step 2.5: Run tests to verify they pass

Run: `bun test src/utils/providerProfiles.test.ts -t 'maybeResetMainLoopModel'`
Expected: PASS — 11 tests, 0 fail

### Step 2.6: Run full providerProfiles test file

Run: `bun test src/utils/providerProfiles.test.ts`
Expected: PASS — all existing tests still pass + 5 (Task 1) + 11 (Task 2) = 16 new tests passing

### Step 2.7: Commit

```bash
git add src/utils/providerProfiles.ts src/utils/providerProfiles.test.ts
git commit -m "$(cat <<'EOF'
feat(provider): add maybeResetMainLoopModel decision helper

Pure function returning { reset, previousModel?, newModel? } for whether
to reset session model when activating a provider profile. Skips when
current model is an alias or already matches the profile default.
EOF
)"
```

---

## Task 3: Wire ProviderManager select-active to reset mainLoopModel

**Files:**
- Modify: `src/components/ProviderManager.tsx` (around line 798-820, the `select-active` case in the switch)
- Modify: `src/components/ProviderManager.test.tsx` (append new `describe` block)

**Interfaces:**
- Consumes:
  - `maybeResetMainLoopModel(profile, currentModel)` from `src/utils/providerProfiles.ts` (Task 2 deliverable)
  - `useAppState` + `useSetAppState` already imported via the file's top imports (verify before writing)
  - The active profile returned by `setActiveProviderProfile(profileId)`
- Produces:
  - When `decision.reset === true`: `setAppState(prev => ({ ...prev, mainLoopModel: decision.newModel, mainLoopModelForSession: null }))` and `setStatusMessage` containing "Model reset to {model}"
  - When `decision.reset === false`: existing `setStatusMessage('Activated provider: ...')` only

### Step 3.1: Verify useAppState is already imported in ProviderManager.tsx

Run: `grep -n 'useAppState\|useSetAppState' src/components/ProviderManager.tsx`
Expected: Currently NO match — they are NOT imported. Add to the imports section.

If not imported, add the import statement at the top of `src/components/ProviderManager.tsx` (alongside other `'../state/AppState.js'` style imports; verify the exact path by reading the existing imports):

```typescript
import { useAppState, useSetAppState } from '../state/AppState.js'
```

(If `useAppState` is already imported but `useSetAppState` is missing, only add the missing one. The path is `../state/AppState.js`.)

### Step 3.2: Add useAppState/useSetAppState hooks at the top of ProviderManager function

Locate the body of `export function ProviderManager({ mode, onDone }: Props): React.ReactNode` (starts at line 158). After the existing `useState` lines (around lines 159-179, before the `formSteps = React.useMemo(...)` block), add:

```typescript
const mainLoopModel = useAppState(s => s.mainLoopModel)
const setAppState = useSetAppState()
```

These must be at the top of the component body so they are unconditional (React rules of hooks).

### Step 3.3: Modify the `select-active` case in the screen switch

Locate the `case 'select-active':` block (currently around line 798-820 in `ProviderManager.tsx`). The relevant code is:

```typescript
case 'select-active':
  content = renderProfileSelection(
    '设置激活提供商',
    '没有可用的提供商。请先添加一个。',
    profileId => {
      const active = setActiveProviderProfile(profileId)
      if (!active) {
        setErrorMessage('无法更改激活提供商。')
        setScreen('menu')
        return
      }
      const settingsOverrideError =
        clearStartupProviderOverrideFromUserSettings()
      refreshProfiles()
      setStatusMessage(
        settingsOverrideError
          ? `激活提供商：${active.name}。警告：无法清除启动提供商覆盖（${settingsOverrideError}）。`
          : `激活提供商：${active.name}`,
      )
      setScreen('menu')
    },
  )
  break
```

Replace the inner callback with:

```typescript
case 'select-active':
  content = renderProfileSelection(
    '设置激活提供商',
    '没有可用的提供商。请先添加一个。',
    profileId => {
      const active = setActiveProviderProfile(profileId)
      if (!active) {
        setErrorMessage('无法更改激活提供商。')
        setScreen('menu')
        return
      }
      const settingsOverrideError =
        clearStartupProviderOverrideFromUserSettings()
      refreshProfiles()

      const decision = maybeResetMainLoopModel(active, mainLoopModel)
      if (decision.reset && decision.newModel) {
        setAppState(prev => ({
          ...prev,
          mainLoopModel: decision.newModel,
          mainLoopModelForSession: null,
        }))
      }

      const providerMessage =
        settingsOverrideError
          ? `激活提供商：${active.name}。警告：无法清除启动提供商覆盖（${settingsOverrideError}）。`
          : `激活提供商：${active.name}`
      const modelSuffix =
        decision.reset && decision.newModel
          ? ` · Model reset to ${decision.newModel}`
          : ''
      setStatusMessage(`${providerMessage}${modelSuffix}`)
      setScreen('menu')
    },
  )
  break
```

### Step 3.4: Import `maybeResetMainLoopModel` into ProviderManager.tsx

At the top of `src/components/ProviderManager.tsx`, the existing import block from `../utils/providerProfiles.js` (around line 7-17) imports `addProviderProfile`, `deleteProviderProfile`, etc. Add `maybeResetMainLoopModel` to that import:

```typescript
import {
  addProviderProfile,
  deleteProviderProfile,
  getActiveProviderProfile,
  getProviderPresetDefaults,
  getProviderProfiles,
  maybeResetMainLoopModel,           // ← ADD THIS LINE
  setActiveProviderProfile,
  type ProviderPreset,
  type ProviderProfileInput,
  updateProviderProfile,
} from '../utils/providerProfiles.js'
```

### Step 3.5: Verify typecheck

Run: `bun run typecheck 2>&1 | tail -50`
Expected: 0 errors. If errors related to `mainLoopModel` being possibly undefined, narrow the type via a guard or assert non-null — mainLoopModel from `useAppState(s => s.mainLoopModel)` is typed `string | undefined`.

### Step 3.6: Write integration tests

Append to `src/components/ProviderManager.test.tsx` after the last existing test:

```typescript
describe('ProviderManager select-active model reset', () => {
  // Helper: render ProviderManager inside AppStateProvider + KeybindingSetup.
  // Reuse the same setup pattern as the existing tests in this file — find
  // an existing test that mounts <ProviderManager> via createRoot, copy its
  // setup boilerplate (mountComponent / renderAndWait pattern), then drive
  // the keyboard to reach 'select-active' and choose a profile.

  test('resets mainLoopModel to profile default and shows Model reset message', async () => {
    // Setup:
    //   - Add two provider profiles via addProviderProfile (e.g., 'p1' with model='glm-5.2',
    //     'p2' with model='zhiniao-MiniMax-M2.7' that will be the active one).
    //   - Set initial AppState.mainLoopModel = 'old-model'.
    //   - Render ProviderManager mode='manage'.
    // Drive:
    //   - Navigate to 'activate' menu item, press Enter.
    //   - In 'select-active', choose 'p2'.
    // Assert:
    //   - AppState.mainLoopModel === 'zhiniao-MiniMax-M2.7'
    //   - AppState.mainLoopModelForSession === null
    //   - statusMessage (visible in last frame output) contains 'Model reset to zhiniao-MiniMax-M2.7'
  })

  test('preserves alias selection (does not reset)', async () => {
    // Setup:
    //   - Add 'p1' with model='glm-5.2'.
    //   - Set initial AppState.mainLoopModel = 'opus'.
    //   - Render ProviderManager mode='manage'.
    // Drive: same select-active flow, choose 'p1'.
    // Assert:
    //   - AppState.mainLoopModel unchanged (still 'opus')
    //   - statusMessage contains '激活提供商' but NOT 'Model reset to'
  })

  test('skips reset when current model already equals profile default', async () => {
    // Setup:
    //   - Add 'p1' with model='glm-5.2'.
    //   - Set initial AppState.mainLoopModel = 'glm-5.2'.
    //   - Render ProviderManager mode='manage'.
    // Drive: same select-active flow, choose 'p1'.
    // Assert:
    //   - AppState.mainLoopModel unchanged
    //   - statusMessage contains '激活提供商' but NOT 'Model reset to'
  })
})
```

Note: The actual setup, navigation keypresses, and assertions need to follow the EXACT pattern used by existing tests in this file. Find an existing test that drives ProviderManager via keyboard (e.g., one that exercises `select-active` already, or one that exercises any menu navigation), and copy its mount + drive + assert structure. The skeleton above is the contract — implementation must match existing patterns.

### Step 3.7: Run integration tests

Run: `bun test src/components/ProviderManager.test.tsx -t 'select-active model reset'`
Expected: PASS — 3 tests

If failing, check:
- AppState initial values: the test must call `useSetAppState` to seed `mainLoopModel` BEFORE rendering `<ProviderManager>`.
- Provider profiles must be added via `addProviderProfile` with `makeActive: false` for the non-target profile, OR added before rendering so they're already in config.

### Step 3.8: Run full test suite to confirm no regressions

Run: `bun test src/utils/providerProfiles.test.ts src/components/ProviderManager.test.tsx`
Expected: all pass (existing + new)

### Step 3.9: Run smoke

Run: `bun run smoke 2>&1 | tail -30`
Expected: build succeeds + smoke output OK. If smoke writes to stdout, look for the version line `0.x.y (Open CC)`.

### Step 3.10: Commit

```bash
git add src/components/ProviderManager.tsx src/components/ProviderManager.test.tsx
git commit -m "$(cat <<'EOF'
feat(provider): reset mainLoopModel on profile activation

When user activates a provider profile via /provider → Set active provider,
reset AppState.mainLoopModel to the profile's default model. Skips when
current model is an alias (opus/sonnet/haiku) or already matches. UI
appends "Model reset to {model}" to status message.

Closes spec docs/superpowers/specs/2026-07-06-provider-switch-default-model-design.md
EOF
)"
```

---

## Self-Review Notes

**Spec coverage:**
- "切换激活 profile 时把 mainLoopModel 自动重置为新 provider profile 的默认 model" → Task 3 step 3.3
- "仅运行时切换激活 provider" → Task 3 step 3.3 (only `select-active` onSelect is modified)
- "激活 profile 的 model 字段" → Task 1 `getDefaultModelForProfile`
- "只重置具体 model 名" → Task 2 step 2.4 `isModelAlias(currentModel)` short-circuit
- "静默重置 + 系统消息" → Task 3 step 3.3 status message append
- "不持久化" → no call to `persistActiveProviderProfileModel` (intentionally absent)
- "包成 helper，两处调用" → simplified to single call-site (ProviderManager only); rationale documented in spec section "单一调用点说明"

**Placeholder scan:** No TBD/TODO. Every step has explicit code blocks or commands.

**Type consistency:**
- `getDefaultModelForProfile(profile: ProviderProfile): string | null` — used consistently in Task 1, 2, 3.
- `maybeResetMainLoopModel(profile, currentModel): { reset, previousModel?, newModel? }` — used consistently in Task 2 tests, Task 2 implementation, Task 3 caller.
- `decision.reset`, `decision.newModel`, `decision.previousModel` — same property names across tasks.
- `setAppState(prev => ({ ...prev, mainLoopModel: decision.newModel, mainLoopModelForSession: null }))` — matches `src/commands/model/model.tsx:60-64` pattern.

**Cross-check vs spec:** All design decisions from `docs/superpowers/specs/2026-07-06-provider-switch-default-model-design.md` are covered. The single-call-site deviation from brainstorming 方案 A is documented in the spec section "单一调用点说明".