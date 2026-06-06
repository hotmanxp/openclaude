import type { Command } from '../../types/command.js'
import { workflowsListCommand } from '../../commands/workflows/listCommand.js'

/**
 * Returns the dynamic-workflow slash commands available in this build.
 * Currently exposes /workflows (list/manage runs in this session).
 *
 * Kept in WorkflowTool/ (not commands/workflows/) so commands.ts can lazy-load
 * it the same way it lazy-loads other plugin/built-in command groups —
 * this lets the rest of the command resolution path stay synchronous while
 * the workflow runtime (worker threads, scheduler) is loaded on demand.
 */
export async function getWorkflowCommands(_cwd: string): Promise<Command[]> {
  return [workflowsListCommand]
}
