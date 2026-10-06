import { Box, Text } from '../ink.js'
import { useSyncExternalStore, type ReactNode } from 'react'
import {
  getModStatusSnapshot,
  getModStatusVersion,
  subscribeModStatus,
} from '../mods/engine.js'

/**
 * P2 pane/status slot (docs/mods-plan.md §3.3): renders persistent per-mod
 * status segments set via ctx.ui.status(). Hidden when no mod has status.
 */
export function ModStatusLine(): ReactNode {
  useSyncExternalStore(subscribeModStatus, getModStatusVersion)
  const snapshot = getModStatusSnapshot()
  const entries = Object.entries(snapshot)
  if (entries.length === 0) return null
  return (
    <Box flexDirection="column">
      {entries.map(([mod, text]) => (
        <Text key={mod} dimColor>
          ·[{mod}] {text}
        </Text>
      ))}
    </Box>
  )
}
