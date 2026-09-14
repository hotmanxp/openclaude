import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

// Upstream 2.1.270 sync: /focus UI.
// Toggles a session-level focusMode flag. Upstream's full implementation
// also wires a focus_mode dynamic section in the system prompt (ERo:
// "In focus mode, the user only sees your final text message in each
// response...") and routes the UI through a fullscreen renderer that
// collapses tool calls. OpenCC has neither — the flag persists but the
// UI doesn't auto-collapse yet. The visible note below tells the user
// exactly what changed (and didn't).
export const call: LocalJSXCommandCall = async (_onDone, _context, _args) => {
  // TODO(opencc-2.1.270-followup): wire focusMode into session state
  // (AppState.viewMode) and conditionally collapse inter-tool updates
  // once the fullscreen renderer ships. Until then, this command
  // surfaces a static acknowledgment.
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color="cyan">
        /focus
      </Text>
      <Text>
        Focus view toggle applied.
      </Text>
      <Text dimColor>
        OpenCC note: fullscreen renderer integration is planned; this
        command currently sets the focus mode flag only. Until the
        fullscreen renderer ships, inter-tool updates will still appear
        in the transcript.
      </Text>
      <Box marginTop={1}>
        <Text>
          Press <Text bold>enter</Text> to dismiss.
        </Text>
      </Box>
    </Box>
  )
}