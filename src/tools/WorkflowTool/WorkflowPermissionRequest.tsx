// @ts-nocheck
import React, { useState } from 'react'
import { Box, Text, useInput } from '../../ink.js'
import type { Tool, ToolUseContext } from '../../Tool.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'

type Props = {
  toolUseContext: ToolUseContext
  tool: Tool
  input: { workflowName: string; args: unknown; description?: string }
  decisionReason?: string
  onDone: (result: PermissionResult) => void
}

type Option = 'yes' | 'yes-always' | 'view' | 'no'

const OPTIONS: { value: Option; label: string }[] = [
  { value: 'yes', label: 'Yes, run it' },
  { value: 'yes-always', label: "Yes, and don't ask again for this workflow" },
  { value: 'view', label: 'View raw script' },
  { value: 'no', label: 'No' },
]

export function WorkflowPermissionRequest({
  input,
  onDone,
}: Props) {
  const [selected, setSelected] = useState(0)

  useInput((_ch, key) => {
    if (key.upArrow) {
      setSelected(s => Math.max(0, s - 1))
    } else if (key.downArrow) {
      setSelected(s => Math.min(OPTIONS.length - 1, s + 1))
    } else if (key.return) {
      const opt = OPTIONS[selected]!.value
      if (opt === 'no') {
        onDone({ behavior: 'deny', message: 'User declined' })
      } else if (opt === 'yes') {
        onDone({ behavior: 'allow', updatedInput: input })
      } else if (opt === 'yes-always') {
        persistWorkflowApproval(input.workflowName)
        onDone({ behavior: 'allow', updatedInput: input })
      } else if (opt === 'view') {
        showScriptViewer(input.workflowName)
        onDone({ behavior: 'allow', updatedInput: input })
      }
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text>
        Run workflow <Text bold color="cyan">{input.workflowName}</Text>?
      </Text>
      {input.description && <Text dimColor>{input.description}</Text>}
      <Box marginTop={1} flexDirection="column">
        {OPTIONS.map((opt, i) => (
          <Text key={opt.value} inverse={i === selected}>
            {'  '}{opt.label}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

function persistWorkflowApproval(workflowName: string): void {
  // TODO: Implement actual persistence to ~/.claude/settings.json
  // (see plan Task 16.5 for full implementation)
  console.log(`[workflow] Approval persisted for ${workflowName}`)
}

function showScriptViewer(_workflowName: string): void {
  // TODO: Open a script viewer overlay (see Task 20 — WorkflowDetailDialog)
}
