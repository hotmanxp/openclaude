import { describe, expect, test } from 'bun:test'
import {
  buildFinalValues,
  cycleChoice,
  getChoiceOptions,
  resolveInitialChoice,
} from './PluginOptionsDialog.js'

/**
 * Constrained-string fields — upstream models these as `"type": "string"`
 * plus `"options": [...]` (cc-plugin-agents-md's `instructionFiles`), and
 * the dialog turns them into a ←/→ cycler. These lock down the three pure
 * pieces that decide what the cycler starts on and where a keypress lands.
 */

const SCHEMA = {
  instructionFiles: {
    type: 'string' as const,
    title: 'Project instructions',
    description: '…',
    required: false,
    default: 'claude-md-or-agents-md',
    options: [
      'claude-md',
      'claude-md-or-agents-md',
      'claude-md-and-agents-md',
      'managed-only',
    ],
  },
  // A plain free-text field, which must keep behaving exactly as before.
  apiUrl: { type: 'string' as const, title: 'API URL', description: '…' },
}

describe('getChoiceOptions', () => {
  test('a field with options is a choice', () => {
    expect(getChoiceOptions(SCHEMA.instructionFiles)).toEqual(
      SCHEMA.instructionFiles.options,
    )
  })

  test('a plain string field is not', () => {
    expect(getChoiceOptions(SCHEMA.apiUrl)).toBeUndefined()
    expect(getChoiceOptions(undefined)).toBeUndefined()
    expect(getChoiceOptions({ options: [] })).toBeUndefined()
    expect(getChoiceOptions({ options: 'nope' })).toBeUndefined()
  })
})

describe('resolveInitialChoice', () => {
  test('a saved legal value wins', () => {
    expect(resolveInitialChoice(SCHEMA.instructionFiles, 'managed-only')).toBe(
      'managed-only',
    )
  })

  test('falls back to the schema default when nothing is saved', () => {
    expect(resolveInitialChoice(SCHEMA.instructionFiles, undefined)).toBe(
      'claude-md-or-agents-md',
    )
  })

  test('falls back when the saved value left the option set', () => {
    // A value from an older schema version must not strand the user on
    // something the cycler can never return to.
    expect(resolveInitialChoice(SCHEMA.instructionFiles, 'removed-mode')).toBe(
      'claude-md-or-agents-md',
    )
  })

  test('falls back to the first option when the default is itself illegal', () => {
    expect(
      resolveInitialChoice({ ...SCHEMA.instructionFiles, default: 'gone' }, undefined),
    ).toBe('claude-md')
  })

  test('undefined for a non-choice field', () => {
    expect(resolveInitialChoice(SCHEMA.apiUrl, 'https://x')).toBeUndefined()
  })
})

describe('cycleChoice', () => {
  const opts = SCHEMA.instructionFiles.options

  test('steps forward and back', () => {
    expect(cycleChoice(opts, 'claude-md', 1)).toBe('claude-md-or-agents-md')
    expect(cycleChoice(opts, 'claude-md-or-agents-md', -1)).toBe('claude-md')
  })

  test('wraps at both ends rather than clamping', () => {
    expect(cycleChoice(opts, 'managed-only', 1)).toBe('claude-md')
    expect(cycleChoice(opts, 'claude-md', -1)).toBe('managed-only')
  })

  test('a value outside the set re-enters from the first option', () => {
    expect(cycleChoice(opts, 'stale', 1)).toBe('claude-md-or-agents-md')
    expect(cycleChoice(opts, 'stale', -1)).toBe('managed-only')
  })

  test('a single-option set is a fixed point', () => {
    expect(cycleChoice(['only'], 'only', 1)).toBe('only')
    expect(cycleChoice(['only'], 'only', -1)).toBe('only')
  })
})

describe('buildFinalValues on a choice field', () => {
  test('saves the cycled value verbatim', () => {
    const out = buildFinalValues(
      ['instructionFiles'],
      { instructionFiles: 'managed-only' },
      SCHEMA,
      undefined,
    )
    expect(out.instructionFiles).toBe('managed-only')
  })

  test('an untouched choice still saves, it is never blank', () => {
    const out = buildFinalValues(['instructionFiles'], {}, SCHEMA, undefined)
    expect(out.instructionFiles).toBe('')
  })
})