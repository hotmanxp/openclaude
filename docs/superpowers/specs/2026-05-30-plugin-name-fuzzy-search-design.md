# Plugin Name Fuzzy Search for Slash Commands

## Status

Approved

## Background

When a user types `/sup`, the slash command search should find commands from plugins whose name starts with "sup" (e.g., the `superpowers` plugin's commands like `/brainstorming`, `/writing-plans`, etc.).

## Design

### Search Keys

The existing Fuse index is extended with one new search key:

| Key | Weight | Description |
|-----|--------|-------------|
| `commandName` | 3 | Full command name |
| `partKey` | 2 | Command name split by `[:_-]` |
| `aliasKey` | 2 | Command aliases |
| **`pluginNameKey`** | **1.5** | **Plugin name (from `pluginInfo.pluginManifest.name`)** |
| `descriptionKey` | 0.5 | Command description |

### Sort Order

Results are sorted by the following priority (highest to lowest):

1. Exact name match
2. Exact alias match
3. Prefix name match
4. Prefix alias match
5. **Prefix plugin name match** (new)
6. Fuzzy match (Fuse score)
7. Usage frequency (tiebreaker)

### Matching Logic

- Plugin name matching uses **prefix matching only** (`pluginName.startsWith(query)`)
- If both command name and plugin name match, **command name takes precedence** (higher weight in Fuse + priority in sort order)
- Plugin name is case-insensitive

### Implementation

#### File: `src/utils/suggestions/commandSuggestions.ts`

**`CommandSearchItem` type** — add `pluginNameKey`:

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

**`getCommandFuse()`** — populate `pluginNameKey` when building index:

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

**Fuse config** — add `pluginNameKey`:

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
    { name: 'pluginNameKey', weight: 1.5 },  // NEW
    { name: 'descriptionKey', weight: 0.5 },
  ],
})
```

**Sort logic** — add prefix plugin name match check after prefix alias match:

```typescript
// Check for prefix plugin name match (new)
const aPrefixPlugin = a.pluginNameKey?.some(name => name.startsWith(query))
const bPrefixPlugin = b.pluginNameKey?.some(name => name.startsWith(query))
if (aPrefixPlugin && !bPrefixPlugin) return -1
if (bPrefixPlugin && !aPrefixPlugin) return 1
```

**Precompute** — extend the sort precompute:

```typescript
const withMeta = searchResults.map(r => {
  const name = r.item.commandName.toLowerCase()
  const aliases = r.item.aliasKey?.map(alias => alias.toLowerCase()) ?? []
  const pluginNames = r.item.pluginNameKey ?? []
  const usage = r.item.command.type === 'prompt'
    ? getSkillUsageScore(getCommandName(r.item.command))
    : 0
  return { r, name, aliases, pluginNames, usage }
})
```

## Example

| Input | Matched Commands |
|-------|------------------|
| `/sup` | All commands from `superpowers` plugin (brainstorming, writing-plans, etc.) |
| `/brain` | `/brainstorming` (exact prefix name match) |
| `/plan` | `/writing-plans` (prefix name), any commands from plugin starting with "plan" |

## Testing

1. Type `/sup` → verify commands from `superpowers` plugin appear
2. Type `/brain` → verify `/brainstorming` appears (command name match takes priority)
3. Type `/superpowers` → exact plugin name match (if plugin name matches)
4. Verify existing command name search still works correctly
