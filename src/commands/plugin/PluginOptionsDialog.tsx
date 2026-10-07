import figures from 'figures'
import React, { useCallback, useMemo, useState } from 'react'
import { Dialog } from '../../components/design-system/Dialog.js'
import { stringWidth } from '../../ink/stringWidth.js'
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw text input for config dialog
import { Box, Text, useInput } from '../../ink.js'
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import type {
  PluginOptionSchema,
  PluginOptionValues,
} from '../../utils/plugins/pluginOptionsStorage.js'

/**
 * Configure a plugin's (or a mod's — they share this schema) `userConfig`.
 *
 * Walks the schema's fields one at a time and hands the collected values back.
 * Three kinds of field, each with its own editing affordance:
 *
 *   free text   a text box; backspace deletes, printable chars append
 *   sensitive    same box, but the buffer starts EMPTY and renders as `*`
 *   choice       no text box at all — `←`/`→` step through `schema.options`
 *
 * The choice form exists because upstream models a fixed set as
 * `"type": "string"` plus `"options": [...]` rather than a separate enum type
 * (see cc-plugin-agents-md's `userConfig.instructionFiles`), so `type` stays
 * `string` and only the editing affordance changes.
 *
 * Enter confirms: on the last field it saves, elsewhere it advances — the same
 * thing Tab does. Esc cancels.
 */

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Turn the collected raw strings into the typed payload `savePluginOptions`
 * expects.
 *
 * Two deliberate omissions:
 *
 *   - A sensitive field left blank keeps its SAVED value rather than wiping
 *     it. Sensitive buffers start empty on purpose, so a user reconfiguring
 *     one field would otherwise silently erase every secret on the way past.
 *     `savePluginOptions` only writes the keys it is given, so omitting the
 *     key is what "keep what's stored" means.
 *   - A blank number is omitted too, because `Number('')` is 0 rather than
 *     NaN — storing that would defeat `validateUserConfig`'s required check.
 */
export function buildFinalValues(
  fields: string[],
  collected: Record<string, string>,
  configSchema: PluginOptionSchema,
  initialValues: PluginOptionValues | undefined,
): PluginOptionValues {
  const finalValues: PluginOptionValues = {}
  for (const fieldKey of fields) {
    const schema = configSchema[fieldKey]
    const value = collected[fieldKey] ?? ''

    if (
      schema?.sensitive === true &&
      value === '' &&
      initialValues?.[fieldKey] !== undefined
    ) {
      continue
    }

    if (schema?.type === 'number') {
      if (value.trim() === '') continue
      const parsed = Number(value)
      // Keep the raw string if it isn't a number, so validation can say so
      // rather than us silently coercing it to 0.
      finalValues[fieldKey] = Number.isNaN(parsed) ? value : parsed
    } else if (schema?.type === 'boolean') {
      finalValues[fieldKey] = isEnvTruthy(value)
    } else {
      finalValues[fieldKey] = value
    }
  }
  return finalValues
}

/**
 * The accepted values for a choice field, or undefined when the field is an
 * ordinary free-text one. An empty array counts as "not a choice" — it would
 * give the cycler nowhere to go.
 */
export function getChoiceOptions(schema): string[] | undefined {
  const options = schema?.options
  return Array.isArray(options) && options.length > 0 ? options : undefined
}

/**
 * Where a choice field starts: the saved value if it is still legal, else the
 * schema default, else the first option.
 *
 * Always lands on a member of the set. A stale saved value (one from a schema
 * version that no longer offers it) would otherwise put the user on a value
 * the cycler can never return to.
 */
export function resolveInitialChoice(schema, savedValue) {
  const options = getChoiceOptions(schema)
  if (!options) return undefined
  if (typeof savedValue === 'string' && options.includes(savedValue)) {
    return savedValue
  }
  if (
    typeof schema?.default === 'string' &&
    options.includes(schema.default)
  ) {
    return schema.default
  }
  return options[0]
}

/**
 * Step a choice field by `delta`, wrapping at both ends. Wrapping rather than
 * clamping is what makes ←/→ read as a cycler; clamping leaves the key looking
 * broken at the first and last option.
 */
export function cycleChoice(
  options: string[],
  current: string,
  delta: number,
): string {
  const currentIndex = options.indexOf(current)
  // An unknown current value re-enters from the first option rather than
  // producing undefined.
  const from = currentIndex === -1 ? 0 : currentIndex
  return options[(from + delta + options.length) % options.length]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Props = {
  title: string
  subtitle: string
  configSchema: PluginOptionSchema
  /** Pre-fill fields when reconfiguring. Sensitive fields are not prepopulated. */
  initialValues?: PluginOptionValues
  onSave: (config: PluginOptionValues) => void
  onCancel: () => void
}

export function PluginOptionsDialog({
  title,
  subtitle,
  configSchema,
  initialValues,
  onSave,
  onCancel,
}: Props): React.ReactNode {
  const fields = useMemo(() => Object.keys(configSchema), [configSchema])

  /**
   * What a field's input buffer should start as. Called on mount and again
   * whenever the walk lands on a new field.
   */
  const startingInputFor = useCallback(
    (fieldKey: string): string => {
      const schema = configSchema[fieldKey]
      const choice = resolveInitialChoice(schema, initialValues?.[fieldKey])
      if (choice !== undefined) return choice
      // Never prefill a secret — see buildFinalValues.
      if (schema?.sensitive === true) return ''
      const saved = initialValues?.[fieldKey]
      return saved === undefined ? '' : String(saved)
    },
    [configSchema, initialValues],
  )

  const [fieldIndex, setFieldIndex] = useState(0)
  /** Values for the fields already walked past, keyed by field. */
  const [collected, setCollected] = useState<Record<string, string>>({})
  const [input, setInput] = useState(() =>
    fields[0] ? startingInputFor(fields[0]) : '',
  )

  const fieldKey = fields[fieldIndex]
  const fieldSchema = fieldKey ? configSchema[fieldKey] : null
  const isLastField = fieldIndex === fields.length - 1

  const moveToField = useCallback(
    (nextIndex: number) => {
      const nextKey = fields[nextIndex]
      setFieldIndex(nextIndex)
      setInput(nextKey ? startingInputFor(nextKey) : '')
    },
    [fields, startingInputFor],
  )

  /** Bank the current buffer, then step to the next field. */
  const commitAndAdvance = useCallback(() => {
    if (!fieldKey || isLastField) return
    setCollected(prev => ({ ...prev, [fieldKey]: input }))
    moveToField(fieldIndex + 1)
  }, [fieldKey, input, isLastField, fieldIndex, moveToField])

  const handleNextField = useCallback(() => {
    commitAndAdvance()
  }, [commitAndAdvance])

  const handleConfirm = useCallback(() => {
    if (!fieldKey) return
    const merged = { ...collected, [fieldKey]: input }
    if (isLastField) {
      onSave(buildFinalValues(fields, merged, configSchema, initialValues))
    } else {
      setCollected(merged)
      moveToField(fieldIndex + 1)
    }
  }, [
    fieldKey,
    input,
    collected,
    isLastField,
    fields,
    configSchema,
    initialValues,
    onSave,
    moveToField,
    fieldIndex,
  ])

  useKeybinding('confirm:no', onCancel, { context: 'Settings' })
  useKeybindings(
    { 'confirm:nextField': handleNextField, 'confirm:yes': handleConfirm },
    { context: 'Confirmation' },
  )

  const choiceOptions = getChoiceOptions(fieldSchema)

  // eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw text entry
  useInput((char, key) => {
    if (choiceOptions) {
      // A choice field has no text to edit: its value is whatever the cycler
      // last landed on. Left/right step it and everything else is inert, so a
      // stray keystroke can't put the field off the allowed set.
      if (key.leftArrow || key.rightArrow) {
        setInput(cycleChoice(choiceOptions, input, key.leftArrow ? -1 : 1))
      }
      return
    }
    if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1))
      return
    }
    if (char && !key.ctrl && !key.meta && !key.tab && !key.return) {
      setInput(prev => prev + char)
    }
  })

  if (!fieldSchema || !fieldKey) return null

  const isRequired = fieldSchema.required === true
  // A secret's length is fine to show; its contents are not.
  const visibleInput = fieldSchema.sensitive
    ? '*'.repeat(stringWidth(input))
    : input

  return (
    <Dialog
      title={title}
      subtitle={subtitle}
      onCancel={onCancel}
      isCancelActive={false}
    >
      <Box flexDirection="column">
        <Text bold>
          {fieldSchema.title || fieldKey}
          {isRequired ? <Text color="error"> *</Text> : null}
        </Text>
        {fieldSchema.description ? (
          <Text dimColor>{fieldSchema.description}</Text>
        ) : null}
        <Box marginTop={1}>
          {choiceOptions ? (
            <Box>
              <Text dimColor>{` ${figures.pointerSmall} `}</Text>
              <Text>{input}</Text>
              <Text dimColor>{` ${figures.pointerSmall} `}</Text>
            </Box>
          ) : (
            <>
              <Text>{figures.pointerSmall} </Text>
              <Text>{visibleInput}</Text>
              <Text>█</Text>
            </>
          )}
        </Box>
      </Box>
      <Box flexDirection="column">
        <Text dimColor>
          Field {fieldIndex + 1} of {fields.length}
        </Text>
        {!isLastField ? (
          <Text dimColor>
            {choiceOptions
              ? 'Tab: Next field · ←/→: Change value · Enter: Save and continue'
              : 'Tab: Next field · Enter: Save and continue'}
          </Text>
        ) : null}
        {isLastField ? (
          <Text dimColor>
            {choiceOptions
              ? 'Enter: Save configuration · ←/→: Change value'
              : 'Enter: Save configuration'}
          </Text>
        ) : null}
      </Box>
    </Dialog>
  )
}