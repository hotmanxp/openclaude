# Plugin Name Fuzzy Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When typing `/sup` in slash command search, find commands from plugins whose name starts with "sup" (e.g., `superpowers` plugin commands).

**Architecture:** Extend the existing Fuse-based command search with a new `pluginNameKey` search field. Plugin name prefix matches are sorted after command name prefix matches but before fuzzy matches.

**Tech Stack:** TypeScript, Fuse.js fuzzy search

---

## Files

- Modify: `src/utils/suggestions/commandSuggestions.ts`
- Test: `src/utils/suggestions/commandSuggestions.test.ts` (create if not exists)

---

## Task 1: Add pluginNameKey to CommandSearchItem type

**Files:**
- Modify: `src/utils/suggestions/commandSuggestions.ts:14-20`

- [ ] **Step 1: Add pluginNameKey field to CommandSearchItem type**

```typescript
type CommandSearchItem = {
  descriptionKey: string[]
  partKey: string[] | undefined
  commandName: string
  command: Command
  aliasKey: string[] | undefined
  pluginNameKey: string[] | undefined  // NEW
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck`
Expected: PASS (no errors related to this change)

- [ ] **Step 3: Commit**

```bash
git add src/utils/suggestions/commandSuggestions.ts
git commit -m "feat(suggestions): add pluginNameKey to CommandSearchItem type"
```

---

## Task 2: Populate pluginNameKey in getCommandFuse()

**Files:**
- Modify: `src/utils/suggestions/commandSuggestions.ts:35-51`

- [ ] **Step 1: Update commandData mapping to extract plugin name**

Find the existing mapping (around line 35-51):

```typescript
const commandData: CommandSearchItem[] = commands
  .filter(cmd => !cmd.isHidden)
  .map(cmd => {
    const commandName = getCommandName(cmd)
    const parts = commandName.split(SEPARATORS).filter(Boolean)

    return {
      descriptionKey: (cmd.description ?? '')
        .split(' ')
        .map(word => cleanWord(word))
        .filter(Boolean),
      partKey: parts.length > 1 ? parts : undefined,
      commandName,
      command: cmd,
      aliasKey: cmd.aliases,
    }
  })
```

Replace with:

```typescript
const commandData: CommandSearchItem[] = commands
  .filter(cmd => !cmd.isHidden)
  .map(cmd => {
    const commandName = getCommandName(cmd)
    const parts = commandName.split(SEPARATORS).filter(Boolean)
    const pluginName = cmd.pluginInfo?.pluginManifest?.name

    return {
      descriptionKey: (cmd.description ?? '')
        .split(' ')
        .map(word => cleanWord(word))
        .filter(Boolean),
      partKey: parts.length > 1 ? parts : undefined,
      commandName,
      command: cmd,
      aliasKey: cmd.aliases,
      pluginNameKey: pluginName ? [pluginName.toLowerCase()] : undefined,
    }
  })
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/utils/suggestions/commandSuggestions.ts
git commit -m "feat(suggestions): populate pluginNameKey from pluginInfo"
```

---

## Task 3: Add pluginNameKey to Fuse config

**Files:**
- Modify: `src/utils/suggestions/commandSuggestions.ts:53-76`

- [ ] **Step 1: Add pluginNameKey to Fuse keys array**

Find the existing keys config:

```typescript
const fuse = new Fuse(commandData, {
  includeScore: true,
  threshold: 0.3,
  location: 0,
  distance: 100,
  keys: [
    { name: 'commandName', weight: 3 },
    { name: 'partKey', weight: 2 },
    { name: 'aliasKey', weight: 2 },
    { name: 'descriptionKey', weight: 0.5 },
  ],
})
```

Replace with:

```typescript
const fuse = new Fuse(commandData, {
  includeScore: true,
  threshold: 0.3,
  location: 0,
  distance: 100,
  keys: [
    { name: 'commandName', weight: 3 },
    { name: 'partKey', weight: 2 },
    { name: 'aliasKey', weight: 2 },
    { name: 'pluginNameKey', weight: 1.5 },
    { name: 'descriptionKey', weight: 0.5 },
  ],
})
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/utils/suggestions/commandSuggestions.ts
git commit -m "feat(suggestions): add pluginNameKey to Fuse search keys"
```

---

## Task 4: Add prefix plugin name match to sort logic

**Files:**
- Modify: `src/utils/suggestions/commandSuggestions.ts:433-492`

- [ ] **Step 1: Extend precompute to include pluginNames array**

Find the withMeta precompute (around line 433):

```typescript
const withMeta = searchResults.map(r => {
  const name = r.item.commandName.toLowerCase()
  const aliases = r.item.aliasKey?.map(alias => alias.toLowerCase()) ?? []
  const usage =
    r.item.command.type === 'prompt'
      ? getSkillUsageScore(getCommandName(r.item.command))
      : 0
  return { r, name, aliases, usage }
})
```

Replace with:

```typescript
const withMeta = searchResults.map(r => {
  const name = r.item.commandName.toLowerCase()
  const aliases = r.item.aliasKey?.map(alias => alias.toLowerCase()) ?? []
  const pluginNames = r.item.pluginNameKey ?? []
  const usage =
    r.item.command.type === 'prompt'
      ? getSkillUsageScore(getCommandName(r.item.command))
      : 0
  return { r, name, aliases, pluginNames, usage }
})
```

- [ ] **Step 2: Add prefix plugin name match check in sort comparator**

Find the sort comparator (around line 443-492). After the prefix alias match check (after line 483), add:

```typescript
// Check for prefix plugin name match (new)
const aPrefixPlugin = a.pluginNames.some(name => name.startsWith(query))
const bPrefixPlugin = b.pluginNames.some(name => name.startsWith(query))
if (aPrefixPlugin && !bPrefixPlugin) return -1
if (bPrefixPlugin && !aPrefixPlugin) return 1
// Among prefix plugin matches, prefer shorter plugin names
if (aPrefixPlugin && bPrefixPlugin) {
  const aPluginLen = Math.min(...a.pluginNames.filter(n => n.startsWith(query)).map(n => n.length))
  const bPluginLen = Math.min(...b.pluginNames.filter(n => n.startsWith(query)).map(n => n.length))
  if (aPluginLen !== bPluginLen) return aPluginLen - bPluginLen
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/utils/suggestions/commandSuggestions.ts
git commit -m "feat(suggestions): add prefix plugin name match to sort order"
```

---

## Task 5: Write tests

**Files:**
- Create: `src/utils/suggestions/commandSuggestions.test.ts` (if it doesn't exist)

- [ ] **Step 1: Create test file with basic tests**

```typescript
import { describe, expect, test } from 'bun:test'
import { generateCommandSuggestions } from './commandSuggestions.js'
import type { Command } from '../../commands.js'

// Helper to create a mock command
function mockCommand(name: string, opts?: Partial<Command>): Command {
  return {
    type: 'local-jsx',
    name,
    description: 'Test command',
    ...opts,
  } as Command
}

// Helper to create a mock plugin command
function mockPluginCommand(name: string, pluginName: string): Command {
  return {
    type: 'prompt',
    name,
    description: 'Test command',
    source: 'plugin',
    pluginInfo: {
      pluginManifest: { name: pluginName },
      repository: 'test/repo',
    },
    getPromptForCommand: async () => [],
  } as unknown as Command
}

describe('generateCommandSuggestions', () => {
  test('finds commands by plugin name prefix', () => {
    const commands: Command[] = [
      mockPluginCommand('brainstorming', 'superpowers'),
      mockPluginCommand('writing-plans', 'superpowers'),
      mockPluginCommand('code-review', 'another-plugin'),
    ]

    const results = generateCommandSuggestions('/sup', commands)
    const names = results.map(r => {
      const cmd = r.metadata as Command
      return cmd.name
    })

    expect(names).toContain('brainstorming')
    expect(names).toContain('writing-plans')
    expect(names).not.toContain('code-review')
  })

  test('command name match takes priority over plugin name match', () => {
    const commands: Command[] = [
      mockPluginCommand('superman', 'other-plugin'),
      mockPluginCommand('brainstorming', 'superpowers'),
    ]

    const results = generateCommandSuggestions('/sup', commands)
    const names = results.map(r => {
      const cmd = r.metadata as Command
      return cmd.name
    })

    // /superman should appear first due to command name prefix match
    expect(names[0]).toBe('superman')
    expect(names).toContain('brainstorming')
  })
})
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/ethan/code/opencc && bun test src/utils/suggestions/commandSuggestions.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/utils/suggestions/commandSuggestions.test.ts
git commit -m "test: add plugin name fuzzy search tests"
```

---

## Task 6: Smoke test

- [ ] **Step 1: Run full smoke test**

Run: `cd /Users/ethan/code/opencc && bun run smoke`
Expected: PASS

- [ ] **Step 2: Commit any final changes**

```bash
git add -A && git commit -m "feat: add plugin name fuzzy search for slash commands"
```

---

## Spec Coverage Check

- [x] CommandSearchItem type extended with pluginNameKey
- [x] getCommandFuse() populates pluginNameKey from pluginInfo.pluginManifest.name
- [x] Fuse config includes pluginNameKey with weight 1.5
- [x] Sort order includes prefix plugin name match after prefix alias match
- [x] Prefix plugin name match uses case-insensitive startsWith
- [x] Tests verify plugin name prefix matching and command name priority

## Self-Review

1. All type references are consistent (`pluginNameKey` vs `pluginNames` in sort precompute)
2. No placeholder/TODO comments
3. Tests are runnable with `bun test`
4. Each task commits independently for easy rollback
