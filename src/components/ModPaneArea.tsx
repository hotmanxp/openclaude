import {
  Component,
  isValidElement,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Box, Text } from '../ink.js'
import {
  getModPanesSnapshot,
  getModPanesVersion,
  subscribeModPanes,
  type RegisteredPane,
} from '../mods/engine.js'

/**
 * P3 render site (docs/mods-plan.md): renders every mod-registered pane
 * (ctx.ui.pane) persistently above the prompt input, refreshed on data
 * notifications. Each pane is wrapped in an ErrorBoundary — a crashing mod
 * component degrades to an inline error line instead of taking down the TUI
 * (the same-process substitute for upstream's per-plugin Worker isolation).
 */

class PaneErrorBoundary extends Component<
  {
    modName: string
    title: string
    /**
     * Changing this value clears a latched error and retries the subtree.
     * It is `${paneVersion}:${component identity}` — a mod that fixes its
     * component (re-registers with a new function) or pushes fresh data
     * (`ctx.ui.notify()`) recovers without a process restart. Without it the
     * error latched for the pane's whole lifetime.
     */
    resetKey: string
    children: ReactNode
  },
  { error: Error | null; seenResetKey: string }
> {
  state = { error: null as Error | null, seenResetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { seenResetKey: string },
  ): { error: null; seenResetKey: string } | null {
    if (props.resetKey !== state.seenResetKey) {
      return { error: null, seenResetKey: props.resetKey }
    }
    return null
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <Text color="red">
          ·pane [{this.props.modName}:{this.props.title}] crashed:{' '}
          {this.state.error.message}
        </Text>
      )
    }
    return this.props.children
  }
}

/**
 * Normalize a mod component's return value into something renderable.
 *
 * The component is called as a plain function (not `<C />`), so React never
 * sees it as a component boundary and primitives do not get wrapped for the
 * caller. Ink's reconciler drops bare `number` / `string[]` / `boolean` and
 * renders an empty box with no diagnostic, which reads as "my pane is broken"
 * with nothing to act on. Normalize the shapes a mod author reasonably writes,
 * and throw a naming error for the rest so the ErrorBoundary can show it.
 */
export function normalizePaneContent(value: unknown, modName: string, paneId: string): ReactNode {
  // `cond && <X/>` yields false — treat every boolean as "takes no space".
  if (value === null || value === undefined || typeof value === 'boolean') {
    return null
  }
  if (typeof value === 'string') return <Text>{value}</Text>
  if (typeof value === 'number' || typeof value === 'bigint') {
    return <Text>{String(value)}</Text>
  }
  if (Array.isArray(value)) {
    const items = value.map(item => normalizePaneContent(item, modName, paneId))
    if (items.every(item => item === null)) return null
    return <>{items}</>
  }
  if (isValidElement(value)) return value
  throw new Error(
    `ctx.ui.pane("${paneId}"): component must return null, a string, a number, ` +
      `a React element or an array of those — got ${describe(value)}. ` +
      `Returning a plain object, class instance or function is not renderable.`,
  )
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'object') {
    const name = (value as object).constructor?.name
    return name ? `an instance of ${name}` : 'a plain object'
  }
  return `a ${typeof value}`
}

function PaneView({ pane }: { pane: RegisteredPane }): ReactNode {
  const content = normalizePaneContent(
    pane.component(pane.props),
    pane.modName,
    pane.id,
  )
  if (content === null) return null
  return (
    <Box
      key={pane.key}
      flexDirection="column"
      borderStyle="round"
      paddingX={1}
    >
      <Text dimColor>
        {pane.title} · mod:{pane.modName}
      </Text>
      {content}
    </Box>
  )
}

export function ModPaneArea(): ReactNode {
  const version = usePaneVersion()
  const panes = getModPanesSnapshot()
  if (panes.length === 0) return null
  return (
    <Box flexDirection="column">
      {panes.map(pane => (
        <PaneErrorBoundary
          key={pane.key}
          modName={pane.modName}
          title={pane.title}
          resetKey={`${version}:${pane.component}`}
        >
          <PaneView pane={pane} />
        </PaneErrorBoundary>
      ))}
    </Box>
  )
}

// useSyncExternalStore is stable across renders; isolated in a tiny hook so
// the component body stays readable.
function usePaneVersion(): number {
  return useSyncExternalStore(subscribeModPanes, getModPanesVersion)
}
