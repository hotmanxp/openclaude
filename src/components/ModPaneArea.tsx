import {
  Component,
  isValidElement,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Box, Text } from '../ink.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import {
  getModPanesSnapshot,
  getModPanesVersion,
  notifyPaneWidth,
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
 * Components are mounted as `<C />`, so React already normalizes their
 * return. This remains for a mod that hands `pane()` a function returning a
 * bare value: Ink's reconciler drops bare `number` / `string[]` / `boolean`
 * and renders an empty box with no diagnostic, which reads as "my pane is
 * broken" with nothing to act on.
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

/**
 * Render one pane's component.
 *
 * The component is mounted as `<C />`, **not** called as a plain function.
 * Calling it directly (the previous behaviour here) meant React never saw a
 * component boundary: no state, no effects, no context, no focus, no
 * `autoFocus`. That is why the diff pane drew as a static box while its
 * `DiffPane` source was a full React component with hooks in it.
 */
function PaneContent({ pane }: { pane: RegisteredPane }): ReactNode {
  const Component = pane.component as (props: Record<string, unknown>) => ReactNode
  return <Component {...pane.props} />
}

/**
 * One pane, in the layout its `placement` asks for.
 *
 * Upstream's two placements @35263677: `"dock"` sits beside the transcript
 * and keeps refreshing; `"inline"` is inserted into the transcript as a
 * modal, taking the full width and scrolling with it. This host renders both
 * above the prompt input — there is no transcript insertion point on this
 * surface — but the distinction that survives is the border and the padding:
 * a dock pane is a persistent panel, an inline pane is a modal body.
 */
function PaneView({ pane }: { pane: RegisteredPane }): ReactNode {
  const isDock = pane.placement === 'dock'

  if (!pane.isPlaced) {
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text dimColor>
          {pane.title} · mod:{pane.modName}
        </Text>
        <Text dimColor>waiting for a wider terminal…</Text>
      </Box>
    )
  }

  return (
    <Box
      key={pane.key}
      flexDirection="column"
      borderStyle={isDock ? 'round' : 'single'}
      paddingX={1}
      paddingY={isDock ? 0 : 1}
    >
      <Text dimColor>
        {pane.title} · mod:{pane.modName}
        {pane.isFocused ? ' ·focused' : ''}
      </Text>
      <PaneContent pane={pane} />
    </Box>
  )
}

export function ModPaneArea(): ReactNode {
  const version = usePaneVersion()
  const panes = getModPanesSnapshot()
  const { columns } = useTerminalSize()

  // A pane that asked for a width it does not have waits rather than drawing
  // a truncated version of itself — the same call upstream makes when a
  // terminal resize reaches `Fn({isOpen, columns})` (`wpr` @35282718).
  useEffect(() => {
    notifyPaneWidth(columns)
  }, [columns])

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
