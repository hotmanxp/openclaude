import React from 'react'
import BaseButton from '../../ink/components/Button.js'
import { Text } from '../../ink.js'
import { useKeybindingContext } from '../../keybindings/KeybindingContext.js'
import { getEngineOwnedActions } from './engineActions.js'
import { logForDebugging } from '../../utils/debug.js'

/**
 * The `Button` element as a mod sees it — upstream `Z5r` @6848238.
 *
 * Upstream's contract and the host's component disagree in three places, so
 * this file is the seam rather than a straight re-export:
 *
 * 1. Upstream puts `onPress` on the **element node**, not in props, and takes
 *    no children. The host's `Button` (`src/ink/components/Button.tsx`, itself
 *    vendored upstream code) takes `onAction` plus render-prop children and
 *    has no `key`/`label`/`hotkey`/`variant`/`role` at all.
 * 2. Upstream's props are a closed whitelist. The host's `Button` spreads
 *    unknown props straight onto a `Box`, where a typo becomes a silent
 *    no-op.
 * 3. Upstream's `plain`/`variant`/`autoFocus` are literal-`true`-or-absent;
 *    the host's `autoFocus` is already boolean.
 *
 * That last point is why the upstream plugin passes `plain: true` to draw a
 * bare label with no chrome, and why `label` is what gets rendered — not
 * children.
 */

export type ModButtonProps = {
  key: string
  label: string
  hotkey?: string
  action?: string
  plain?: true
  dimColor?: boolean
  variant?: 'primary' | 'secondary'
  role?: 'dismiss'
  autoFocus?: true
}

export type ModButtonNodeProps = ModButtonProps & {
  onPress?: () => void
  disabled?: boolean
}

export function ModButton(props: ModButtonNodeProps): React.ReactNode {
  // `key` is React's, consumed by the reconciler before render — it is in the
  // upstream prop contract because a mod must name every interactive element,
  // not because it reaches the host Button.
  const { label, hotkey, action, dimColor, autoFocus, onPress, disabled } = props
  const keybindings = useKeybindingContext()

  // `action` names a host keybinding action. Upstream resolves it against its
  // own keybinding table; here it goes through the host's `invokeAction`, so
  // a ported upstream plugin's `<Button action="app:someCommand">` fires the
  // same command a user would trigger from the keyboard.
  //
  // The reserved-action check is repeated here rather than trusted to the
  // validator: the validator runs on the tree before it is drawn, and this
  // runs whenever the button is pressed. A mod that skips validation must not
  // be the cheaper path to an engine-owned action.
  const handlePress = React.useCallback(() => {
    onPress?.()
    if (action === undefined) return
    if (getEngineOwnedActions().has(action)) {
      logForDebugging(`[mods] Button action "${action}" refused: the engine's alone`)
      return
    }
    keybindings?.invokeAction(action)
  }, [onPress, action, keybindings])

  const content = (
    <Text dimColor={dimColor}>
      {hotkey ? `${hotkey}. ` : ''}
      {label}
    </Text>
  )

  return (
    <BaseButton
      onAction={handlePress}
      autoFocus={autoFocus === true}
      {...(disabled === true ? { tabIndex: -1 } : {})}
    >
      {content}
    </BaseButton>
  )
}

/** Upstream `Z5r` @6848238 — closed whitelist, verbatim in substance. */
export function validateButtonProps(props: Record<string, unknown>): string | undefined {
  const allowed = new Set([
    'key',
    'label',
    'hotkey',
    'action',
    'plain',
    'dimColor',
    'variant',
    'role',
    'autoFocus',
    'onPress',
    'disabled',
  ])
  for (const name of Object.keys(props)) {
    if (!allowed.has(name)) return `Button prop "${name}" is not allowed`
  }
  const { key, label, hotkey, plain, dimColor, variant, role, autoFocus, action } =
    props as ModButtonNodeProps
  if (typeof key !== 'string' || key === '') {
    return 'Button props must be { key, label }, both strings'
  }
  if (typeof label !== 'string') {
    return 'Button props must be { key, label }, both strings'
  }
  if (hotkey !== undefined && !(typeof hotkey === 'string' && /^[0-9a-z]$/.test(hotkey))) {
    return 'Button hotkey is a digit or a letter'
  }
  if (plain !== undefined && plain !== true) {
    return `Button "${key}" plain is true or absent`
  }
  if (dimColor !== undefined && typeof dimColor !== 'boolean') {
    return 'Button dimColor is a boolean'
  }
  if (
    variant !== undefined &&
    variant !== 'primary' &&
    variant !== 'secondary'
  ) {
    return 'Button variant is "primary" or "secondary"'
  }
  if (role !== undefined && role !== 'dismiss') {
    return 'Button role is "dismiss"'
  }
  if (autoFocus !== undefined && autoFocus !== true) {
    return `Button "${key}" autoFocus is true or absent`
  }
  if (action !== undefined) {
    if (typeof action !== 'string' || action === '') {
      return 'Button action is a keybinding action name'
    }
    if (getEngineOwnedActions().has(action)) {
      return `Button action "${action}" is the engine's alone; its key cannot be rebound (ctrl+c, ctrl+d)`
    }
  }
  return undefined
}