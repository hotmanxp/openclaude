import type { Command } from '../../types/command.js'

export const workflowsListCommand: Command = {
  type: 'prompt',
  name: 'workflows',
  description: 'View and manage dynamic workflow runs in this session',
  source: 'builtin',
  isHidden: false,
  progressMessage: 'listing workflow runs',
  contentLength: 0,
  async getPromptForCommand() {
    return [
      {
        type: 'text',
        text:
          'The user typed /workflows. List all workflow runs in this session. ' +
          'For each run, show: name, status, agent count, elapsed time, and final ' +
          'report (if completed). Ask if they want to save a completed run as a ' +
          'reusable workflow command. ' +
          'Use the WorkflowTool.listRuns() API (defined in src/tools/WorkflowTool/WorkflowTool.ts).',
      },
    ]
  },
}
