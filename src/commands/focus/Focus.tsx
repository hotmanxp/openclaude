import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  getFocusModeState,
  setFocusModeState,
} from '../../bootstrap/state.js'
import { clearSystemPromptSections } from '../../constants/systemPromptSections.js'

// Upstream 2.1.270 sync: /focus UI.
// Toggles a session-level flag. As of the 2.1.280 alignment, the flag IS wired
// into the system prompt — the `focus_mode` section tells the model that only
// its final message is shown, so it stops narrating between tool calls.
// Still missing: the fullscreen renderer that actually collapses inter-tool
// updates in the transcript.
export const call: LocalJSXCommandCall = async (_onDone, _context, _args) => {
  const enabled = !getFocusModeState()
  setFocusModeState(enabled)
  // focus_mode is a cached system prompt section, so drop the section cache to
  // let the next turn recompute it. Same pattern as Enter/ExitWorktreeTool.
  clearSystemPromptSections()

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color="cyan">
        /focus
      </Text>
      <Text>
        Focus mode {enabled ? 'enabled' : 'disabled'}.
      </Text>
      <Text dimColor>
        {enabled
          ? 'The model now knows you only read its final message, so it will stop narrating between tool calls. OpenCC note: the transcript still shows inter-tool updates until the fullscreen renderer ships.'
          : 'Inter-tool updates and short progress notes are back to normal.'}
      </Text>
      <Box marginTop={1}>
        <Text>
          Press <Text bold>enter</Text> to dismiss.
        </Text>
      </Box>
    </Box>
  )
}