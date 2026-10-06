import type { ReactNode } from 'react'
import path from 'node:path'
import { Select } from '../../components/CustomSelect/select.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Box, Text } from '../../ink.js'
import type { HandoffEntry } from './handoffMod.js'

/**
 * Dialogs for the handoff mod's resume branch.
 *
 * Kept in its own module and pulled in with a dynamic import by
 * `handoffMod.tsx`: these components drag in the whole Ink/component graph,
 * and a static import from the mod back into that graph closes a cycle
 * through `mods/builtin.ts` (which imports the mod to declare the fixed
 * built-in manifest).
 */

export const PICKER_VISIBLE_OPTIONS = 10

export function HandoffPicker({
  entries,
  cwd,
  onPick,
  onCancel,
}: {
  entries: HandoffEntry[]
  cwd: string
  onPick: (entry: HandoffEntry) => void | Promise<void>
  onCancel: () => void
}): ReactNode {
  return (
    <Dialog
      title="Resume from a handoff document"
      subtitle={`${entries.length} document(s) in .agent_working_dir/handoff`}
      onCancel={onCancel}
      color="claude"
    >
      <Select
        options={entries.map(entry => ({
          label: entry.basename.replace(/\.md$/, ''),
          value: entry,
          description: `${entry.mtime} · ${path.relative(cwd, entry.fullPath)}`,
        }))}
        onChange={onPick}
        visibleOptionCount={PICKER_VISIBLE_OPTIONS}
      />
    </Dialog>
  )
}

export function HandoffEmpty({
  root,
  onDismiss,
}: {
  root: string
  onDismiss: () => void
}): ReactNode {
  return (
    <Dialog
      title="No handoff document to resume"
      subtitle={root}
      onCancel={onDismiss}
      color="claude"
      inputGuide={() => <Text dimColor>Esc to close</Text>}
    >
      <Box flexDirection="column">
        <Text>
          Nothing to resume — <Text dimColor>{root}</Text> is empty or does not
          exist.
        </Text>
        <Text dimColor>
          Run <Text>/handoff</Text> in a session with work in progress to write
          one, or pass a file explicitly: <Text>/handoff --pick my-task.md</Text>
        </Text>
      </Box>
    </Dialog>
  )
}
