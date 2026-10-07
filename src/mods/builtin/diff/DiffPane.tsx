import React, { useEffect, useMemo, useSyncExternalStore } from 'react'
import { Box, Text } from '../../../ink.js'
import { useTerminalSize } from '../../../hooks/useTerminalSize.js'
import { CURSOR_RESERVE, MIN_PATH_WIDTH } from './constants.js'
import { DiffStatsCell } from './DiffFileList.jsx'
import { diffTitle, listEmptyMessage, tooNarrowMessage } from './presentation.js'
import { buildRows, noteFor, windowRows } from './rows.js'
import { diffMinColumns, diffPollIntervalMs } from './settings.js'
import { getDiffSnapshot, refreshDiff, subscribeToDiff } from './store.js'
import { plural, sanitize, truncateTail } from './text.js'

/**
 * The live diff pane — upstream's "the diff panel as a plugin pane: the
 * changed files and their hunks beside the transcript, refreshed as Claude
 * edits".
 *
 * It reads the same store the dialog does, so opening one does not disturb
 * the other: the pane polls, the dialog refreshes on open.
 */
export function DiffPane(): React.ReactNode {
  const snapshot = useSyncExternalStore(subscribeToDiff, getDiffSnapshot)
  const { columns } = useTerminalSize()

  useEffect(() => {
    void refreshDiff()
    const timer = setInterval(() => void refreshDiff(), diffPollIntervalMs())
    return () => clearInterval(timer)
  }, [])

  const rows = useMemo(
    () => buildRows(snapshot.data, snapshot.bodies),
    [snapshot.data, snapshot.bodies],
  )

  if (columns < diffMinColumns()) {
    return <Text dimColor={true}>{tooNarrowMessage()}</Text>
  }

  const { title, subtitle } = diffTitle(snapshot.data)
  const selected = rows[0]?.path ?? null
  const { shown, above, below } = windowRows(rows, selected)

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text>{title}</Text>
        {subtitle ? <Text dimColor={true}>{` ${subtitle}`}</Text> : null}
      </Box>
      {snapshot.data !== null ? (
        <Box flexDirection="row">
          <Text dimColor={true}>
            {`${plural(snapshot.data.stats.filesCount, 'file')} changed `}
          </Text>
          <DiffStatsCell
            added={snapshot.data.stats.linesAdded}
            removed={snapshot.data.stats.linesRemoved}
          />
        </Box>
      ) : null}
      {rows.length === 0 ? (
        <Text dimColor={true}>
          {snapshot.hasSettled
            ? listEmptyMessage(snapshot.data, rows.length)
            : 'Loading diff…'}
        </Text>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {above > 0 ? (
            <Text dimColor={true}>{` ↑ ${above} more ${plural(above, 'file')}`}</Text>
          ) : null}
          {shown.map(row => {
            const note = noteFor(row)
            return (
              <Box key={row.path} flexDirection="row">
                <Text>{`  ${truncateTail(sanitize(row.displayPath), Math.max(MIN_PATH_WIDTH, columns - CURSOR_RESERVE))}`}</Text>
                <Box flexGrow={1} />
                {note !== null ? (
                  <Text dimColor={true} italic={true}>
                    {note}
                  </Text>
                ) : (
                  <DiffStatsCell added={row.added} removed={row.removed} />
                )}
              </Box>
            )
          })}
          {below > 0 ? (
            <Text dimColor={true}>{` ↓ ${below} more ${plural(below, 'file')}`}</Text>
          ) : null}
        </Box>
      )}
    </Box>
  )
}
