// @ts-nocheck
import { Box, Text } from '../../ink.js'
import * as React from 'react'
import { useMemo } from 'react'
import { useAppState } from '../../state/AppState.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { getCwd } from '../../utils/cwd.js'
import { getContextWindowForModel } from '../../utils/context.js'
import { renderModelSetting } from '../../utils/model/model.js'
import {
  buildDirectoryLine,
  buildHeaderLine,
  buildModelLine,
  expandTilde,
  truncatePath,
} from './StartupHeader.pure.js'

function safeGetCwd(): string {
  try {
    return getCwd()
  } catch {
    return process.cwd()
  }
}

function safeRenderModel(name: string): string {
  try {
    return renderModelSetting(name)
  } catch {
    return name
  }
}

function safeContextWindow(name: string): number | undefined {
  try {
    return getContextWindowForModel(name)
  } catch {
    return undefined
  }
}

export const StartupHeader: React.FC = React.memo(function StartupHeader() {
  const modelName = useAppState(s => s.mainLoopModel)
  const { columns } = useTerminalSize()
  const cwd = useMemo(() => safeGetCwd(), [])

  const expanded = useMemo(() => expandTilde(cwd), [cwd])
  const dirMax = Math.max(10, columns - 30)
  const dir = useMemo(() => truncatePath(expanded, dirMax), [expanded, dirMax])
  const modelDisplay = modelName ? safeRenderModel(modelName) : '(no model)'
  const ctxWindow = modelName ? safeContextWindow(modelName) : undefined

  const header = useMemo(
    () => buildHeaderLine(MACRO.DISPLAY_VERSION ?? MACRO.VERSION ?? 'unknown'),
    [],
  )
  const modelLine = useMemo(
    () => buildModelLine(modelDisplay, '/model to change', ctxWindow),
    [modelDisplay, ctxWindow],
  )
  const dirLine = useMemo(() => buildDirectoryLine(dir), [dir])

  return (
    <Box flexDirection="column">
      <Text dimColor>{header}</Text>
      <Box
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        flexDirection="column"
      >
        <Text>{modelLine}</Text>
        <Text>{dirLine}</Text>
      </Box>
    </Box>
  )
})
