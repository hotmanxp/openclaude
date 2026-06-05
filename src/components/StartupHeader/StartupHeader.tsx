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

const ACCENT = 'rgb(240,148,100)' as const

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
  // buildModelLine with empty hint — we render the hint separately below
  // so it can take an accent color.
  const modelLine = useMemo(
    () => buildModelLine(modelDisplay, '', ctxWindow),
    [modelDisplay, ctxWindow],
  )
  const dirLine = useMemo(() => buildDirectoryLine(dir), [dir])

  // Split the header `>_ OpenCC (v0.14.0)` into:
  //   prefix:  `>_ `              (codex accent — orange/amber)
  //   brand:   `OpenCC`           (default white)
  //   version: `(v0.14.0)`        (dim gray)
  const versionIdx = header.indexOf('(v')
  const headerPrefix = versionIdx >= 0 ? header.slice(0, 3) : '>_'  // `>_ ` (3 chars)
  const headerBrand = versionIdx >= 0 ? header.slice(3, versionIdx) : header.slice(3)
  const headerVersion = versionIdx >= 0 ? header.slice(versionIdx) : ''

  return (
    <Box
      alignSelf="flex-start"
      borderStyle="round"
      borderDimColor
      paddingX={1}
      flexDirection="column"
    >
      <Text>
        <Text color={ACCENT}>{headerPrefix}</Text>
        {headerBrand}
        {headerVersion && <Text dimColor>{headerVersion}</Text>}
      </Text>
      <Text> </Text>
      <Text>
        {modelLine}
        <Text color={ACCENT}>    /model</Text>
        <Text dimColor> to change</Text>
      </Text>
      <Text>{dirLine}</Text>
    </Box>
  )
})
