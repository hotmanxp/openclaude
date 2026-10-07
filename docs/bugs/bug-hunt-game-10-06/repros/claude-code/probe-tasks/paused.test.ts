import { describe, expect, it } from 'bun:test'
import { registerTask, generateTaskAttachments, applyTaskOffsetsAndEvictions, getRunningTasks } from '/Users/ethan/code/opencc/src/utils/task/framework.js'
import { isTerminalTaskStatus } from '/Users/ethan/code/opencc/src/Task.js'

describe("paused workflow task (WorkflowsListDialog:127 `task.status = 'paused'`)", () => {
  it('is never evicted, never polled, and reported as neither running nor terminal', async () => {
    const mut = { id: 'wprobe0001', type: 'local_workflow', status: 'running',
      description: 'wf', startTime: Date.now(), outputFile: '/tmp/w', outputOffset: 0, notified: false } as any
    let state: any = { tasks: { wprobe0001: mut } }
    const setAppState = (u: any) => { state = u(state) }
    const getAppState = () => state

    registerTask(mut, setAppState as any)

    // Exactly what WorkflowsListDialog.tsx:127 does
    state.workflows = { wprobe0001: mut }
    ;(state.workflows.wprobe0001 as any).status = "paused"

    console.log("isTerminalTaskStatus('paused') =", isTerminalTaskStatus('paused'))
    console.log("getRunningTasks() after pause =", getRunningTasks(getAppState()).map(t => t.id))
    console.log("BackgroundTasksDialog kill key (status==='running') fires?", mut.status === 'running')
    console.log("WorkflowsListDialog onKill provided (status==='running')?", mut.status === 'running')

    const gen = await generateTaskAttachments(getAppState())
    console.log("evictedTaskIds:", gen.evictedTaskIds)
    console.log("updatedTaskOffsets (output polling):", gen.updatedTaskOffsets)
    applyTaskOffsetsAndEvictions(setAppState as any, gen.updatedTaskOffsets, gen.evictedTaskIds)
    console.log("tasks still in AppState after GC pass:", Object.keys(getAppState().tasks))
    console.log("store notified subscribers? (no setAppState call was made by the pause handler)")

    expect(isTerminalTaskStatus('paused')).toBe(false)
    expect(gen.evictedTaskIds).toEqual([])
    expect(Object.keys(getAppState().tasks)).toEqual(['wprobe0001'])
  })
})
