// src/components/tasks/WorkflowDetailDialog.tsx
//
// Read-only detail dialog for a local_workflow task. Two-pane layout:
//   - Left  pane: workflow phases declared via `__setMeta({ phases: [...] })`
//     (or derived from agents' phase field). Each phase shows its title,
//     agent count, and a per-phase completion fraction.
//   - Right pane: subagents in the currently-highlighted phase, each row
//     showing the agent's label (truncated), model, token/tool/duration
//     stats, and a status checkmark. The right pane follows the left
//     pane's selection.
//
// The header shows workflow name + description + global progress
// (e.g. "7/10 agents · 5m28s"). The footer lists the keyboard
// shortcuts (↑↓ select · x stop · p pause · esc back · s save).
//
// Mirrors the visual shape of ShellDetailDialog / DreamDetailDialog
// but without live output tailing — workflows surface their final
// report via the `result` field, not a streamed outputFile.
import { Box, Text, useInput } from '../../ink.js'
import { useMemo, useState } from 'react'
import type { WorkflowAgentState } from '../../tools/WorkflowTool/types.js'
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/state.js'

type Props = {
  state: LocalWorkflowTaskState
  onDone: () => void
  onKill?: () => void
  onPause?: () => void
}

const RESULT_PREVIEW_LIMIT = 500
const LABEL_TRUNCATE_LIMIT = 36

function agentStatusIcon(status: WorkflowAgentState['status']): string {
  switch (status) {
    case 'completed': return '✓'
    case 'running': return '▶'
    case 'failed': return '✗'
    case 'skipped': return '⏸'
    case 'pending': return '◯'
  }
}

function agentStatusColor(status: WorkflowAgentState['status']): string {
  switch (status) {
    case 'completed': return 'green'
    case 'running': return 'cyan'
    case 'failed': return 'red'
    case 'skipped': return 'yellow'
    case 'pending': return 'gray'
  }
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return '—'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  return `${min}m ${remSec}s`
}

function formatTokens(tok?: number): string {
  if (tok === undefined) return '—'
  if (tok >= 1000) return `${(tok / 1000).toFixed(1)}k`
  return String(tok)
}

/** Derive the ordered list of phases for a workflow run. */
function derivePhases(state: LocalWorkflowTaskState): string[] {
  const declared = state.meta?.phases?.map(p => p.title) ?? []
  const fromAgents = Array.from(
    new Set(state.agents.map(a => a.phase).filter((p): p is string => Boolean(p))),
  )
  // Preserve declared order; append any phase seen on an agent but not declared.
  const out: string[] = []
  for (const t of declared) {
    if (!out.includes(t)) out.push(t)
  }
  for (const t of fromAgents) {
    if (!out.includes(t)) out.push(t)
  }
  return out
}

export function WorkflowDetailDialog({ state, onDone, onKill, onPause }: Props) {
  const phases = useMemo(() => derivePhases(state), [state])

  // Default: the current phase (the one the script is in right now), falling
  // back to the last phase that had any agent, falling back to the first.
  const initialIdx = useMemo(() => {
    if (phases.length === 0) return 0
    if (state.currentPhase) {
      const i = phases.indexOf(state.currentPhase)
      if (i >= 0) return i
    }
    // Last phase that has at least one agent
    for (let i = phases.length - 1; i >= 0; i--) {
      if (state.agents.some(a => a.phase === phases[i])) return i
    }
    return 0
  }, [phases, state.currentPhase, state.agents])

  const [selectedIdx, setSelectedIdx] = useState(initialIdx)

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIdx(i => Math.max(0, i - 1))
    } else if (key.downArrow) {
      setSelectedIdx(i => Math.min(Math.max(0, phases.length - 1), i + 1))
    } else if (input === 'x' || input === 'X') {
      onKill?.()
    } else if (input === 'p' || input === 'P') {
      onPause?.()
    } else if (input === 's' || input === 'S') {
      onDone?.()
    } else if (key.escape || key.leftArrow || input === 'q') {
      onDone?.()
    }
  })

  const selectedPhase = phases[selectedIdx] ?? ''
  const phaseAgents = state.agents.filter(a => a.phase === selectedPhase)
  const completed = state.agents.filter(a => a.status === 'completed').length
  const totalAgents = state.agents.length
  const totalElapsed = (state.completedAt ?? Date.now()) - state.startedAt
  const description = state.meta?.description ?? state.description

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="ansi:cyan" paddingX={1}>
      {/* Header */}
      <Box>
        <Text>
          <Text color="ansi:magenta" bold>▶ {state.name}</Text>
          {description && (
            <Text dimColor>  {description.length > 80 ? description.slice(0, 80) + '…' : description}</Text>
          )}
        </Text>
        <Box flexGrow={1} />
        <Text dimColor>
          {totalAgents > 0 ? `${completed}/${totalAgents} agents · ${formatDuration(totalElapsed)}` : formatDuration(totalElapsed)}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="row">
        {/* Left pane: Phases */}
        <Box flexDirection="column" width={38} borderStyle="single" borderColor="warning" paddingX={1}>
          <Text bold>Phases</Text>
          <Text> </Text>
          {phases.length === 0 && <Text dimColor>(no phases declared)</Text>}
          {phases.map((title, i) => {
            const agents = state.agents.filter(a => a.phase === title)
            const done = agents.filter(a => a.status === 'completed').length
            const failed = agents.filter(a => a.status === 'failed').length
            const isCurrent = title === state.currentPhase
            const isSelected = i === selectedIdx
            const isPast = phases.indexOf(state.currentPhase ?? '') > i
            const tick = (isPast || isCurrent) && done + failed === agents.length && agents.length > 0
              ? '✓'
              : (isCurrent ? '›' : ' ')
            return (
              <Text key={title} inverse={isSelected}>
                <Text color={tick === '✓' ? 'green' : isCurrent ? 'cyan' : undefined}>
                  {tick === '✓' ? '✓' : isCurrent ? '›' : ' '} {title}
                </Text>
                <Text dimColor>{' '.repeat(Math.max(1, 28 - title.length - (tick === '✓' || isCurrent ? 2 : 1)))}{done}/{agents.length}</Text>
              </Text>
            )
          })}
        </Box>

        {/* Right pane: selected phase's agents */}
        <Box flexDirection="column" flexGrow={1} marginLeft={1} borderStyle="single" borderColor="warning" paddingX={1}>
          <Text bold>
            {selectedPhase ? selectedPhase : 'Agents'}
            {phaseAgents.length > 0 && <Text dimColor> · {phaseAgents.length} agents</Text>}
          </Text>
          <Text> </Text>
          {phaseAgents.length === 0 && (
            <Text dimColor>(no agents in this phase yet)</Text>
          )}
          {phaseAgents.map(a => {
            const elapsed = (a.completedAt ?? Date.now()) - (a.startedAt ?? Date.now())
            const label = a.label ?? a.prompt.slice(0, LABEL_TRUNCATE_LIMIT)
            return (
              <Text key={a.id}>
                <Text color={agentStatusColor(a.status)}>{agentStatusIcon(a.status)}</Text>
                {' '}
                <Text>{label.length > LABEL_TRUNCATE_LIMIT ? label.slice(0, LABEL_TRUNCATE_LIMIT) + '…' : label}</Text>
                {a.model && <Text dimColor>   {a.model}</Text>}
                <Text dimColor>{'  '}{formatTokens(a.result?.length)} tok · ? tools · {formatDuration(elapsed)}</Text>
              </Text>
            )
          })}
        </Box>
      </Box>

      {/* Footer: keyboard shortcuts */}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ select · x stop workflow · p pause · esc back · s save
        </Text>
      </Box>

      {/* Optional error / result preview below the two-pane */}
      {state.error && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="red">Error:</Text>
          <Text color="red">{state.error.message}</Text>
        </Box>
      )}
      {state.result && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Final report:</Text>
          <Text>
            {state.result.length > RESULT_PREVIEW_LIMIT
              ? state.result.slice(0, RESULT_PREVIEW_LIMIT) + '…'
              : state.result}
          </Text>
        </Box>
      )}
    </Box>
  )
}
