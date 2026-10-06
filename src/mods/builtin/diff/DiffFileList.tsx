import React from 'react'
import { Box, Text } from '../../../ink.js'
import { CURSOR_RESERVE, MIN_PATH_WIDTH } from './constants.js'
import type { DiffRow } from './rows.js'
import { noteFor } from './rows.js'
import { plural, sanitize, truncateTail } from './text.js'

/** `cr` — the cursor upstream draws on the selected row. */
const CURSOR = '❯'

type StatsCellProps = {
  added: number
  removed: number
}

/**
 * `V` — the right-hand `+12 -3` column. Each side is dropped when it is
 * zero, so a pure addition reads as just `+12`.
 */
export function DiffStatsCell({ added, removed }: StatsCellProps): React.ReactNode {
  return (
    <Text>
      {added > 0 ? <Text color="diffAddedWord">{`+${added}`}</Text> : null}
      {added > 0 && removed > 0 ? ' ' : null}
      {removed > 0 ? <Text color="diffRemovedWord">{`-${removed}`}</Text> : null}
    </Text>
  )
}

/** `Y` — a dim, truncating single line. */
function DimLine({ children }: { children: string }): React.ReactNode {
  return (
    <Text dimColor={true} wrap="truncate-end">
      {children}
    </Text>
  )
}

/** `et` — one row: label on the left, stats right-aligned by a flex spacer. */
function Row({
  label,
  right,
  isSelected,
}: {
  label: string
  right: React.ReactNode
  isSelected: boolean
}): React.ReactNode {
  return (
    <Box flexDirection="row">
      <Text bold={isSelected}>{label}</Text>
      <Box flexGrow={1} />
      {right}
    </Box>
  )
}

/** `pt` — the `↑ 3 more files` / `↓ 2 more files` overflow hint. */
function overflowHint(direction: 'up' | 'down', count: number): string {
  return ` ${direction === 'up' ? '↑' : '↓'} ${plural(count, 'file').replace(' ', ' more ')}`
}

type Props = {
  rows: DiffRow[]
  selectedPath: string | null
  /** Rows hidden above / below the window. */
  above: number
  below: number
  columns: number
}

/**
 * The file list.
 *
 * `columns` is the body width, not the terminal width: the pane draws a
 * border and the list has to fit inside it, so path truncation uses the
 * space actually available.
 */
export function DiffFileList({
  rows,
  selectedPath,
  above,
  below,
  columns,
}: Props): React.ReactNode {
  const pathWidth = Math.max(MIN_PATH_WIDTH, columns - CURSOR_RESERVE)
  return (
    <>
      {above > 0 ? <DimLine>{overflowHint('up', above)}</DimLine> : null}
      {rows.map(row => {
        const note = noteFor(row)
        const label = `${row.path === selectedPath ? CURSOR : ' '} ${truncateTail(
          sanitize(row.displayPath),
          pathWidth,
        )}`
        return (
          <Row
            key={row.path}
            label={label}
            isSelected={row.path === selectedPath}
            right={
              note !== null ? (
                <Text dimColor={true} italic={true}>
                  {note}
                </Text>
              ) : (
                <DiffStatsCell added={row.added} removed={row.removed} />
              )
            }
          />
        )
      })}
      {below > 0 ? <DimLine>{overflowHint('down', below)}</DimLine> : null}
    </>
  )
}
