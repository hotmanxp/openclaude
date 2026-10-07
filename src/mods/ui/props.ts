/**
 * Prop contracts for `Box` and `Text` — upstream `Ioo` @3617295 and the
 * value rules in `D5t` @3617967.
 *
 * `Box` carries 43 layout and colour props, `Text` carries 10. Both sets are
 * closed: anything else is refused with the prop named, because a prop that
 * silently does nothing is worse than one that is refused — the mod author
 * debugs the refusal, and never debugs the silence.
 */

/** Upstream `hrt` @3619349 — every numeric prop is capped at 1e4. */
export const SIZE_LIMIT = 1e4

/**
 * Upstream `M5t` — these four take a number or a `/^\d{1,3}%$/` string.
 */
export const SIZE_PROPS = new Set(['width', 'height', 'minWidth', 'minHeight'])

/**
 * Upstream `xoo` — finite numbers within ±SIZE_LIMIT.
 */
export const NUMBER_PROPS = new Set([
  'flexGrow',
  'flexShrink',
  'gap',
  'columnGap',
  'rowGap',
  'margin',
  'marginX',
  'marginY',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'padding',
  'paddingX',
  'paddingY',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
])

/**
 * Upstream `grt` — whole character cells, not fractions.
 */
export const OFFSET_PROPS = new Set(['top', 'left', 'right', 'bottom'])

/** Upstream `Too` — a theme key, a colour name, or hex. */
export const COLOR_PROPS = new Set(['color', 'backgroundColor', 'borderColor'])

export const BOOLEAN_PROPS = new Set([
  'dimColor',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'inverse',
  'borderDimColor',
])

/**
 * Upstream `Ooo` — a prop that conceals its children. An engine node (the
 * component the host itself would have drawn) may not sit under one.
 */
export const CONCEALING_PROPS = new Set([
  'display',
  'overflow',
  'position',
  ...SIZE_PROPS,
  ...OFFSET_PROPS,
])

/** Upstream `Poo` @3616703 — the enumerated prop values. */
export const PROP_VALUES: Readonly<Record<string, ReadonlySet<string>>> = {
  flexDirection: new Set([
    'row',
    'column',
    'row-reverse',
    'column-reverse',
  ]),
  flexWrap: new Set(['nowrap', 'wrap', 'wrap-reverse']),
  alignItems: new Set(['flex-start', 'center', 'flex-end', 'stretch']),
  alignSelf: new Set(['flex-start', 'center', 'flex-end', 'auto']),
  justifyContent: new Set([
    'flex-start',
    'center',
    'flex-end',
    'space-between',
    'space-around',
    'space-evenly',
  ]),
  overflow: new Set(['visible', 'hidden']),
  display: new Set(['flex', 'none']),
  position: new Set(['relative', 'absolute']),
  wrap: new Set([
    'wrap',
    'end',
    'middle',
    'truncate-end',
    'truncate',
    'truncate-middle',
    'truncate-start',
  ]),
}

/** Upstream `Roo` — which props `hover` may override, per element. */
export const HOVER_PROPS: Readonly<Record<string, readonly string[]>> = {
  Box: [
    'borderStyle',
    'borderColor',
    'borderDimColor',
    'backgroundColor',
    'display',
    'top',
    'left',
    'right',
    'bottom',
  ],
  Text: [
    'color',
    'backgroundColor',
    'dimColor',
    'bold',
    'italic',
    'underline',
    'strikethrough',
    'inverse',
  ],
}

/** Upstream `Ioo` @3617295 — verbatim. */
export const RENDER_PROPS: Readonly<Record<'Box' | 'Text', ReadonlySet<string>>> =
  {
    Box: new Set([
      'flexDirection',
      'flexGrow',
      'flexShrink',
      'flexWrap',
      'alignItems',
      'alignSelf',
      'justifyContent',
      'gap',
      'columnGap',
      'rowGap',
      'width',
      'height',
      'minWidth',
      'minHeight',
      'margin',
      'marginX',
      'marginY',
      'marginTop',
      'marginBottom',
      'marginLeft',
      'marginRight',
      'padding',
      'paddingX',
      'paddingY',
      'paddingTop',
      'paddingBottom',
      'paddingLeft',
      'paddingRight',
      'borderStyle',
      'borderColor',
      'borderDimColor',
      'backgroundColor',
      'overflow',
      'display',
      'position',
      'top',
      'left',
      'right',
      'bottom',
    ]),
    Text: new Set([
      'color',
      'backgroundColor',
      'dimColor',
      'bold',
      'italic',
      'underline',
      'strikethrough',
      'inverse',
      'wrap',
    ]),
  }

const PERCENT = /^\d{1,3}%$/
const COLOR = /^[#a-zA-Z0-9_().,% -]{1,40}$/

/**
 * Upstream `D5t` @3617967. Returns an error message, or undefined when the
 * value is acceptable.
 */
export function checkPropValue(name: string, value: unknown): string | undefined {
  const enumerated = PROP_VALUES[name]
  if (enumerated !== undefined) {
    return typeof value === 'string' && enumerated.has(value)
      ? undefined
      : `must be one of ${[...enumerated].join(', ')}`
  }
  if (SIZE_PROPS.has(name)) {
    if (typeof value === 'number') {
      return Number.isFinite(value) && value >= 0 && value <= SIZE_LIMIT
        ? undefined
        : `must be a finite number between 0 and ${SIZE_LIMIT}`
    }
    return typeof value === 'string' && PERCENT.test(value)
      ? undefined
      : 'must be a number or a percentage'
  }
  if (NUMBER_PROPS.has(name)) {
    return typeof value === 'number' &&
      Number.isFinite(value) &&
      Math.abs(value) <= SIZE_LIMIT
      ? undefined
      : `must be a finite number within ${SIZE_LIMIT}`
  }
  if (OFFSET_PROPS.has(name)) {
    return typeof value === 'number' &&
      Number.isInteger(value) &&
      Math.abs(value) <= SIZE_LIMIT
      ? undefined
      : `must be an integer within ${SIZE_LIMIT} (character cells)`
  }
  if (COLOR_PROPS.has(name)) {
    return typeof value === 'string' && COLOR.test(value)
      ? undefined
      : 'must be a color (a theme key, a name, or hex)'
  }
  if (BOOLEAN_PROPS.has(name)) {
    return typeof value === 'boolean' ? undefined : 'must be a boolean'
  }
  return 'has no value rule'
}