import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Box, Text } from '../../../ink.js'
import { Dialog } from '../../../components/design-system/Dialog.js'
import { useTerminalSize } from '../../../hooks/useTerminalSize.js'
import { useKeybinding } from '../../../keybindings/useKeybinding.js'
import { MIN_COLUMNS } from './constants.js'
import { DiffFileList, DiffStatsCell } from './DiffFileList.jsx'
import { DiffBody, DiffRule } from './detail.jsx'
import {
  OUTSIDE_REPOSITORY_MESSAGE,
  diffTitle,
  emptyHeadline,
  listEmptyMessage,
  tooNarrowMessage,
} from './presentation.js'
import { buildRows, moveSelection, windowRows } from './rows.js'
import { getDiffSnapshot, loadDiffBody, refreshDiff, subscribeToDiff } from './store.js'
import { plural } from './text.js'

type View = 'list' | 'detail'

export type DiffDialogProps = {
  onDone: () => void
}

const KEYBINDING_CONTEXT = { context: 'DiffDialog', isActive: true } as const

/**
 * The `/diff` dialog.
 *
 * Layout follows the plugin's `Rr`: title, blank, stats, body, footer.
 * Navigation is driven by the `diff:*` keybinding actions rather than the
 * plugin's declarative focus model, which is the same choice upstream's own
 * SDK path makes.
 */
export function DiffDialog({ onDone }: DiffDialogProps): React.ReactNode {
  const snapshot = useSyncExternalStore(subscribeToDiff, getDiffSnapshot)
  const { columns } = useTerminalSize()
  const [view, setView] = useState<View>('list')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  useEffect(() => {
    void refreshDiff()
  }, [])

  const rows = useMemo(
    () => buildRows(snapshot.data, snapshot.bodies),
    [snapshot.data, snapshot.bodies],
  )
  const selected = rows.find(row => row.path === selectedPath) ?? rows[0] ?? null

  // Entering the detail view needs that file's hunks; fetch on the way in.
  useEffect(() => {
    if (view === 'detail' && selected) void loadDiffBody(selected.path)
  }, [view, selected])

  const select = useCallback(
    (path: string) => {
      setSelectedPath(path)
      setView('detail')
    },
    [],
  )

  useKeybinding(
    'diff:previousFile',
    () => {
      setView('list')
      setSelectedPath(current => {
        const index = rows.findIndex(row => row.path === current)
        return rows[moveSelection(index, -1, rows.length)]?.path ?? null
      })
    },
    KEYBINDING_CONTEXT,
  )
  useKeybinding(
    'diff:nextFile',
    () => {
      setView('list')
      setSelectedPath(current => {
        const index = rows.findIndex(row => row.path === current)
        return rows[moveSelection(index, 1, rows.length)]?.path ?? null
      })
    },
    KEYBINDING_CONTEXT,
  )
  useKeybinding(
    'diff:viewDetails',
    () => {
      if (view === 'list' && selected) select(selected.path)
    },
    KEYBINDING_CONTEXT,
  )
  useKeybinding(
    'diff:back',
    () => {
      if (view === 'detail') setView('list')
    },
    KEYBINDING_CONTEXT,
  )
  useKeybinding('diff:dismiss', onDone, KEYBINDING_CONTEXT)

  // Esc in the detail view goes back rather than closing, matching upstream:
  // the detail view is reached from the list, so it is dismissed first.
  const handleCancel = useCallback(() => {
    if (view === 'detail') setView('list')
    else onDone()
  }, [view, onDone])

  if (snapshot.isOutsideRepository) {
    return <Text dimColor={true}>{OUTSIDE_REPOSITORY_MESSAGE}</Text>
  }
  if (columns < MIN_COLUMNS) {
    return <Text dimColor={true}>{tooNarrowMessage()}</Text>
  }

  const { title, subtitle } = diffTitle(snapshot.data)
  const empty = emptyHeadline(snapshot.data)
  const windowed = windowRows(rows, selected?.path ?? null)
  const isDetail = view === 'detail' && selected !== null

  return (
    <Dialog
      color="background"
      // Upstream renders title and subtitle on one line; Dialog's own
      // `subtitle` prop stacks them, so the dim half rides along in the title.
      title={
        <>
          {title}
          {subtitle ? <Text dimColor={true}>{` ${subtitle}`}</Text> : null}
        </>
      }
      onCancel={handleCancel}
      inputGuide={exitState =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : (
          <Text dimColor={true} italic={true}>
            {isDetail
              ? '↑/↓ to scroll · Esc to back'
              : '↑/↓ to select · Enter to view · Esc to close'}
          </Text>
        )
      }
    >
      {snapshot.data !== null ? (
        <Box flexDirection="row">
          <Text dimColor={true} wrap="truncate-end">
            {`${plural(snapshot.data.stats.filesCount, 'file')} changed `}
          </Text>
          <DiffStatsCell
            added={snapshot.data.stats.linesAdded}
            removed={snapshot.data.stats.linesRemoved}
          />
        </Box>
      ) : null}

      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {isDetail && selected ? (
          <>
            <Text wrap="truncate-end">{selected.displayPath}</Text>
            <DiffRule columns={columns} />
            <DiffBody
              body={selected.body}
              isLoading={snapshot.pendingBody === selected.path}
              isUntracked={selected.isUntracked}
              isBinary={selected.isBinary}
              path={selected.path}
              columns={columns}
            />
          </>
        ) : rows.length === 0 ? (
          <Text dimColor={true}>
            {empty !== null && snapshot.hasSettled
              ? empty.headline
              : listEmptyMessage(snapshot.data, rows.length)}
          </Text>
        ) : (
          <DiffFileList
            rows={windowed.shown}
            selectedPath={selected?.path ?? null}
            above={windowed.above}
            below={windowed.below}
            columns={columns}
          />
        )}
      </Box>
    </Dialog>
  )
}
