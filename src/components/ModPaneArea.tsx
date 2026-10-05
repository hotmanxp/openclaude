import { Component, useSyncExternalStore, type ReactNode } from 'react'
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
  { modName: string; title: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
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

function PaneView({ pane }: { pane: RegisteredPane }): ReactNode {
  const content = pane.component(pane.props)
  if (content === null || content === undefined) return null
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
      {typeof content === 'string' ? <Text>{content}</Text> : (content as ReactNode)}
    </Box>
  )
}

export function ModPaneArea(): ReactNode {
  usePaneVersion()
  const panes = getModPanesSnapshot()
  if (panes.length === 0) return null
  return (
    <Box flexDirection="column">
      {panes.map(pane => (
        <PaneErrorBoundary
          key={pane.key}
          modName={pane.modName}
          title={pane.title}
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
