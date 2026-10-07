import React, { useCallback, useMemo, useState } from 'react'
import figures from 'figures'
import { Box, Text, useInput } from '../../ink.js'

/**
 * The `Select` element as a mod sees it — upstream `b9r` @6872470.
 *
 * Upstream's props: `{ key, label?, options: [{value, label?}], value?,
 * autoFocus? }`, options 1–64, values unique within one Select.
 *
 * This is deliberately **not** the host's `CustomSelect`. That one drives
 * itself through `useSelectInput`, which claims terminal input globally; a
 * mod pane and the conversation it sits next to would then fight over the
 * arrow keys, and whichever mounted last would win. Drawing it here keeps
 * input ownership with the pane, which is the boundary that makes a pane a
 * pane rather than a second REPL.
 */

export type ModSelectOption = { value: string; label?: string }

export type ModSelectProps = {
  key: string
  label?: string
  options: ModSelectOption[]
  value?: string
  autoFocus?: true
  onChange?: (value: string) => void
  onCancel?: () => void
}

/** Upstream `urr` @6872470 — options per Select. */
export const MAX_SELECT_OPTIONS = 64

export function ModSelect(props: ModSelectProps): React.ReactNode {
  const { label, options, value, onChange, onCancel } = props
  const [cursor, setCursor] = useState(() => {
    const found = value === undefined ? -1 : options.findIndex(o => o.value === value)
    return found >= 0 ? found : 0
  })

  const selected = options[cursor]

  const move = useCallback(
    (delta: number) => {
      setCursor(current => {
        const next = current + delta
        if (next < 0) return options.length - 1
        if (next >= options.length) return 0
        return next
      })
    },
    [options.length],
  )

  const commit = useCallback(() => {
    if (selected !== undefined) onChange?.(selected.value)
  }, [selected, onChange])

  // The pane owns input while it is drawn. `isActive` is deliberately not
  // wired to `autoFocus`: a Select the user has not focused should still be
  // navigable once they reach it, matching the host's own Select behaviour.
  useInput((input, key) => {
    if (key.upArrow) move(-1)
    else if (key.downArrow) move(1)
    else if (key.return) commit()
    else if (key.escape) onCancel?.()
    else if (input === 'j') move(1)
    else if (input === 'k') move(-1)
  })

  const rows = useMemo(
    () =>
      options.map((option, index) => ({
        option,
        isCursor: index === cursor,
      })),
    [options, cursor],
  )

  return (
    <Box flexDirection="column">
      {label !== undefined ? <Text dimColor>{label}</Text> : null}
      {rows.map(({ option, isCursor }) => {
        const isSelected = option.value === value
        return (
          <Box key={option.value} flexDirection="row">
            <Text color={isCursor ? 'suggestion' : undefined}>
              {isCursor ? figures.pointer : ' '}
            </Text>
            <Text>
              {' '}
              <Text
                bold={isCursor}
                color={isSelected ? 'success' : isCursor ? 'suggestion' : undefined}
              >
                {option.label ?? option.value}
              </Text>
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

/**
 * Upstream `b9r` @6872470 + `S9r` @6872260 — closed set, and an option's
 * `value` must be unique inside one Select or `onChange` cannot say which
 * option was chosen.
 */
export function validateSelectProps(props: Record<string, unknown>): string | undefined {
  const allowed = new Set(['key', 'label', 'options', 'value', 'autoFocus', 'onChange', 'onCancel'])
  for (const name of Object.keys(props)) {
    if (!allowed.has(name)) return `Select prop "${name}" is not allowed`
  }
  const { key, options, value, autoFocus, label } = props
  if (typeof key !== 'string' || key === '') {
    return 'Select props must be { key, options } and any of label, value, autoFocus'
  }
  if (label !== undefined && typeof label !== 'string') {
    return 'Select label must be a string'
  }
  if (autoFocus !== undefined && autoFocus !== true) {
    return `Select "${key}" autoFocus is true or absent`
  }
  if (!Array.isArray(options) || options.length === 0) {
    return `options must be 1 to ${MAX_SELECT_OPTIONS} entries`
  }
  if (options.length > MAX_SELECT_OPTIONS) {
    return `options must be 1 to ${MAX_SELECT_OPTIONS} entries`
  }
  const seen = new Set<string>()
  for (const entry of options) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return 'an option that is not { value, label? }'
    }
    const record = entry as Record<string, unknown>
    for (const name of Object.keys(record)) {
      if (name !== 'value' && name !== 'label') {
        return `Select option prop "${name}" is not allowed`
      }
    }
    if (typeof record.value !== 'string') {
      return 'Select option value must be a string'
    }
    if (record.label !== undefined && typeof record.label !== 'string') {
      return 'Select option label must be a string'
    }
    if (seen.has(record.value)) {
      return `option "${record.value}" is listed twice; values are unique`
    }
    seen.add(record.value)
  }
  if (value !== undefined) {
    if (typeof value !== 'string') return 'Select value must be a string'
    if (!seen.has(value)) {
      return `Select value "${value}" is not one of its options`
    }
  }
  return undefined
}