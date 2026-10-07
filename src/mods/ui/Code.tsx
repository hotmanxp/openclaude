import React, { useMemo } from 'react'
import { Box, Text } from '../../ink.js'

/**
 * The `Code` element — upstream `n9r` @6852432.
 *
 * A closed prop set, because a code block has no room for decoration:
 *
 *   { source, language?, path?, startLine?, format?: "source"|"diff",
 *     wrap?: "wrap"|"truncate-end" }
 *
 * `format:"diff"` parses `source` as a unified diff and colours it. Upstream
 * drops `format`/`startLine` when the text is not actually a diff (`brr`
 * @6881747) rather than refusing it — a mod that builds a diff at runtime
 * should not have to guess whether it produced one, so a non-diff source
 * renders as plain code instead of failing the tree.
 */

export type CodeProps = {
  source: string
  language?: string
  path?: string
  /** 1-based. Upstream `cbt` is 1e9. */
  startLine?: number
  format?: 'source' | 'diff'
  wrap?: 'wrap' | 'truncate-end'
}

const MAX_START_LINE = 1e9

/** Upstream `t9r` @6851285 — a unified diff needs an `@@ -a,b +c,d @@` header. */
export function isUnifiedDiff(source: string): boolean {
  return /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(source)
}

type DiffLine = { kind: 'add' | 'del' | 'ctx' | 'hunk'; text: string }

function parseDiff(source: string): DiffLine[] {
  const lines: DiffLine[] = []
  for (const line of source.split('\n')) {
    if (line.startsWith('@@')) lines.push({ kind: 'hunk', text: line })
    else if (line.startsWith('+')) lines.push({ kind: 'add', text: line })
    else if (line.startsWith('-')) lines.push({ kind: 'del', text: line })
    else lines.push({ kind: 'ctx', text: line })
  }
  return lines
}

export function Code(props: CodeProps): React.ReactNode {
  const { source, language, path, startLine, format, wrap } = props

  // Mirrors upstream `brr`: format only survives when the text really is a
  // diff. Anything else draws as source, which is always correct.
  const asDiff = format === 'diff' && isUnifiedDiff(source)

  const lines = useMemo(
    () => (asDiff ? parseDiff(source) : null),
    [asDiff, source],
  )

  if (asDiff && lines) {
    return (
      <Box flexDirection="column">
        {lines.map((line, index) => (
          <Text
            key={index}
            color={
              line.kind === 'add'
                ? 'diffAddedWord'
                : line.kind === 'del'
                  ? 'diffRemovedWord'
                  : line.kind === 'hunk'
                    ? 'professionalBlue'
                    : undefined
            }
          >
            {line.text}
          </Text>
        ))}
      </Box>
    )
  }

  const start = startLine ?? 1
  const showGutter = startLine !== undefined
  const gutterWidth = showGutter
    ? String(start + source.split('\n').length).length
    : 0

  return (
    <Box flexDirection="column">
      {source.split('\n').map((line, index) => (
        <Box key={index} flexDirection="row">
          {showGutter ? (
            <Text dimColor>{`${String(start + index).padStart(gutterWidth)} `}</Text>
          ) : null}
          <Text wrap={wrap ?? 'wrap'}>{line}</Text>
        </Box>
      ))}
    </Box>
  )
}

/**
 * Guard for the element validator: `Code` accepts nothing outside its prop
 * set, and `startLine` is a 1-based integer — `Number(null) === 0` would
 * otherwise turn an absent line number into line 0.
 */
export function validateCodeProps(props: Record<string, unknown>): string | undefined {
  const allowed = new Set([
    'source',
    'language',
    'path',
    'startLine',
    'format',
    'wrap',
  ])
  for (const name of Object.keys(props)) {
    if (!allowed.has(name)) return `Code prop "${name}" is not allowed`
  }
  const { source, startLine, format, wrap } = props
  if (typeof source !== 'string') return 'Code source must be a string'
  if (startLine !== undefined) {
    if (typeof startLine !== 'number' || !Number.isSafeInteger(startLine) || startLine < 1) {
      return 'Code startLine must be a positive integer'
    }
    if (startLine > MAX_START_LINE) {
      return `Code startLine is at most ${MAX_START_LINE}`
    }
  }
  if (format !== undefined && format !== 'source' && format !== 'diff') {
    return 'Code format is "source" or "diff"'
  }
  if (wrap !== undefined && wrap !== 'wrap' && wrap !== 'truncate-end') {
    return 'Code wrap is "wrap" or "truncate-end"'
  }
  return undefined
}