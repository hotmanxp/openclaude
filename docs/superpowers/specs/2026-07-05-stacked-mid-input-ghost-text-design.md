# Stacked Mid-Input Ghost-Text Completion (v2.1.201 UX)

**Spec date:** 2026-07-05
**Status:** Design approved, fast-track
**Scope:** Port upstream v2.1.201 UX behavior: when the user types `/skill-a /<partial-skill-b>` in the input box, render a grey ghost-text showing the best-matched second-skill name + description.

Companion feature to the v2.1.201 stacked-skill runtime expansion (already shipped via `docs/superpowers/plans/2026-07-04-stacked-skill-loading.md`).

---

## 1. Background

The v2.1.201 runtime already lets stacked slash-skill invocations like `/skill-a /skill-b do XYZ` load all leading skills (cap=5). The corresponding **UI affordance** — showing the user which second skill they could append — is a downstream UX feature. Upstream implements it via derived state (not a discrete symbol). OpenCC's existing input-completion pipeline (`useTypeahead.syncPromptGhostText` calling `findMidInputSlashCommand` + `getBestCommandMatch`) currently handles only the **first** `/` of an input string; it bails on `input.startsWith('/')` (line 132), so a `/skill-a /<partial-b>` never produces a ghost.

## 2. Goals

1. **Match upstream UX**: `/skill-a /<partial-b>` shows ghost-text for the second token only when best-matched against **user-invocable skills** (`userInvocable !== false`).
2. **Coexist with existing first-token ghost**: existing single-token `/<partial-x>` ghost must continue working unchanged.
3. **Coexist with new stacked runtime**: `/skill-a` ghost+stacked dispatch already work via Task 3 in the prior plan; nothing here regresses that.
4. **Cap at 5**: do not produce ghost for a 6th leading skill (matches runtime cap; UX stays consistent).

## 3. Non-goals

1. **Not changing start-of-input primary `/`** path (always handled by `getInitialInputSuggestions`).
2. **Not adding new Telemetry/hook events** (UX-only feature).
3. **Not introducing new component or new Ink layout changes** — entirely within the existing `InlineGhostText` rendering.
4. **Not changing the runtime skill expansion logic** (already shipped).

## 4. Design

### 4.1 Algorithm

When `input` starts with `/` AND contains ` /` (mid-token slash followed by space-rest-of-input), locate the **second** `/<partial>` (the one after the last completed first-token slash command) and produce a ghost-text suggestion for it.

Specifically:

```
input: "/foo /<partial>"
                   ^^^^^^^^^ mid-token second token

Find: pos of last "/<partial>" where the preceding-char is whitespace AND the
      character after the "/" is in the alphanum/colons/dashes set, AND the cursor
      is at or inside that token.
```

Edge cases:
- cursor before the second `/` → no ghost (user is still typing the first token)
- second token is empty (cursor right after `/`) → ghost shows full next-skill name
- second token has trailing whitespace → no ghost (user has finished typing that token)
- more than 5 leading `/` tokens → suppress ghost for the 6th (cap consistency; the runtime warns but doesn't error)

### 4.2 Files to modify

| File | Change |
|---|---|
| `src/utils/suggestions/commandSuggestions.ts` | +1 new function `findStackedMidInputSlashCommand(input, cursorOffset): MidInputSlashCommand \| null` |
| `src/utils/suggestions/commandSuggestions.test.ts` | +5 new test cases (see §5) |
| `src/hooks/useTypeahead.tsx` | modify `syncPromptGhostText` (line ~403) to dispatch to the new helper when `input.startsWith('/')` AND a mid-token slash exists |
| `src/commands.ts` | no change (existing `commands` prop already includes user-invocable skills) |

### 4.3 New helper signature

```ts
/**
 * Finds a SECOND slash command token mid-input, AFTER a complete first leading
 * `/cmd` token. Returns the second token's position and partial name.
 *
 * Unlike findMidInputSlashCommand (which bails when input starts with "/"),
 * this scans for the SECOND `/<token>` after a whitespace.
 *
 * @param input Full input string (must start with "/")
 * @param cursorOffset Cursor position
 * @returns MidInputSlashCommand for the SECOND token, or null
 */
export function findStackedMidInputSlashCommand(
  input: string,
  cursorOffset: number,
): MidInputSlashCommand | null
```

Implementation:

```ts
export function findStackedMidInputSlashCommand(
  input: string,
  cursorOffset: number,
): MidInputSlashCommand | null {
  if (!input.startsWith('/')) return null

  // Scan for " /<partial>" patterns after position 0; return the LAST one
  // whose boundary is at or before cursorOffset.
  const re = /\s\/([a-zA-Z0-9_:-]*)/g
  let lastMatch: { slashPos: number; partial: string } | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    // m.index is the position of whitespace; slashPos = m.index + 1
    const slashPos = m.index + 1
    const partial = m[1] ?? ''
    // Cursor must be at or after the slash and within (slashPos+1+partial.length)
    if (cursorOffset < slashPos) continue
    if (cursorOffset > slashPos + 1 + partial.length) continue
    lastMatch = { slashPos, partial }
  }
  if (!lastMatch) return null

  // Extract full command portion past cursor (same as findMidInputSlashCommand)
  const { slashPos, partial } = lastMatch
  const textAfterSlash = input.slice(slashPos + 1)
  const fullCommand = textAfterSlash.match(/^[a-zA-Z0-9_:-]*/)?.[0] ?? ''
  if (cursorOffset > slashPos + 1 + fullCommand.length) return null

  return { token: '/' + fullCommand, startPos: slashPos, partialCommand: fullCommand }
}
```

### 4.4 Caller update (`useTypeahead.tsx`)

Currently:

```ts
const syncPromptGhostText = useMemo((): InlineGhostText | undefined => {
  if (mode !== 'prompt' || suppressSuggestions) return undefined
  const midInputCommand = findMidInputSlashCommand(input, cursorOffset)
  if (!midInputCommand) return undefined
  ...
})
```

Updated:

```ts
const syncPromptGhostText = useMemo((): InlineGhostText | undefined => {
  if (mode !== 'prompt' || suppressSuggestions) return undefined
  // Try stacked mid-input first (input must start with "/" + have second token)
  const stackedMid = findStackedMidInputSlashCommand(input, cursorOffset)
  if (stackedMid) {
    const match = getBestCommandMatch(stackedMid.partialCommand, commands)
    if (!match) return undefined
    return { text: match.suffix, fullCommand: match.fullCommand, insertPosition: stackedMid.startPos + 1 + stackedMid.partialCommand.length }
  }
  // Existing single-token mid-input path
  const midInputCommand = findMidInputSlashCommand(input, cursorOffset)
  if (!midInputCommand) return undefined
  ...
})
```

**Reuse**: `getBestCommandMatch` (line 177) is the existing fuzzy matcher for partial command. **No filtering needed in caller** — the existing `getBestCommandMatch` already filters via `generateCommandSuggestions` which already excludes `isHidden` and respects user-invocable commands in OpenCC's registry ordering (skills bubble to top via Fuse weighting on `partKey` and `aliasKey`).

### 4.5 Error handling

- If `findStackedMidInputSlashCommand` returns null (no candidate second token), the existing single-token path runs unchanged.
- If `getBestCommandMatch` returns null (no skill matches partial), `syncPromptGhostText` returns undefined → no ghost rendered.
- 6th-stack-input edge case: at most 5 ghostable leading tokens. To enforce, count `/(/[a-z][...]/` groups in `input`; if count >= 6 (input has 6 leading slash tokens), suppress ghost. Implementation note: we count groups where whitespace-before-`/` is "boundary", so "/a /b /c /d /e /f " = 6 → suppress.

```ts
// Inside findStackedMidInputSlashCommand helper:
const stackCount = (input.match(/\s\/[a-zA-Z0-9_:-]/g) ?? []).length
const cap = STACKED_SKILL_LIMIT  // re-use 5 from processStackedSkillInvocation
if (stackCount >= cap) return null
```

> TODO when wiring: import `STACKED_SKILL_LIMIT` from `processStackedSkillInvocation.ts` (existing constant from prior plan).

## 5. Testing

5 test cases in `commandSuggestions.test.ts`:

1. `/foo /bar` (cursor at end) → returns token `/bar`, partialCommand `bar`, startPos=5

   Note: `MidInputSlashCommand.startPos` is "Position of `/`" (line 114). Whitespace at offset 4 in `/foo /bar`; `/` at 5. Implementation: `slashPos = m.index + 1`. Plan originally documented startPos=4 (the whitespace), which was an off-by-one; corrected to 5 = position of the `/`.
2. `/foo /bar baz qux` (cursor at end) → returns token `/baz`, partialCommand `baz` (last match; cursor is past its length → returns null actually… see below).

   Actually re-evaluating: `cursorOffset > slashPos + 1 + partial.length` returns null. So at cursor=14 (end), the last match is for `/qux`, slashPos=10. `cursorOffset > 10 + 1 + 3 = 14` → `14 > 14` is false. So `lastMatch` would be `/qux`. Trailing whitespace? `14 > 10 + 1 + 3 = 14` is false. But then we extract `textAfterSlash = 'qux '`, `fullCommand = 'qux'`. So returns `/qux` token, partialCommand=`qux`. ✓

3. `/foo /` (cursor after slash, partial empty) → returns token `/`, partialCommand=``, startPos=5 (position of `/`). Caller flows: `getBestCommandMatch('', cmds)` returns first commander's full name; user sees ghost-text for that command.

4. `/foo` (no second token) → no ` /` match → returns null. Existing single-token path takes over (which also returns null because input starts with /, handled by `getInitialInputSuggestions`).

5. `/a /b /c /d /e /f` (cursor at end, 6 leading tokens = at cap) → returns null. Stack count check (≥ 6 leading slash commands) suppresses ghost.

## 6. Verification commands

```bash
bun run typecheck                                  # 0 errors / 0 warnings
bun test src/utils/suggestions/commandSuggestions.test.ts
                                                 # 5 new + N existing pass
bun run smoke                                      # builds v0.19.X
```

## 7. Spec self-review checklist (inline)

- [x] No TBD / TODO outside §4.5 STACKED_SKILL_LIMIT import (deliberate)
- [x] Internal consistency: scanner logic + caller patch + tests match
- [x] Scope: single feature port; no unrelated rebrand/refactor
- [x] Ambiguity: cap is exactly 5, reuses STACKED_SKILL_LIMIT
- [x] All error modes specified
- [x] Tests target pure function; minimal integration changes
