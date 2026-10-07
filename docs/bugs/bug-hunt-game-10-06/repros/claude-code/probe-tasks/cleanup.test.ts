import { describe, expect, it } from 'bun:test'
import { registerCleanup, runCleanupFunctions } from '/Users/ethan/code/opencc/src/utils/cleanupRegistry.js'
import { registerTask, updateTaskState } from '/Users/ethan/code/opencc/src/utils/task/framework.js'

describe('spawnShellTask result handler nulls unregisterCleanup without calling it', () => {
  it('leaks the shutdown-cleanup registration after normal completion', async () => {
    let calls = 0
    const spy = async () => { calls++ }
    const unregisterCleanup = registerCleanup(spy)

    let state: any = { tasks: {} as any }
    const setAppState = (u: any) => { state = u(state) }

    registerTask({
      id: 'bprobe0002', type: 'local_bash', status: 'running', description: 'x',
      command: 'x', startTime: Date.now(), outputFile: '/tmp/x', outputOffset: 0,
      notified: false, completionStatusSentInAttachment: false,
      shellCommand: null, unregisterCleanup, lastReportedTotalLines: 0, isBackgrounded: true,
    } as any, setAppState as any)

    // LocalShellTask.tsx:230-240 — the success branch of the result handler
    updateTaskState('bprobe0002', setAppState as any, (task: any) => ({
      ...task, status: 'completed', shellCommand: null,
      unregisterCleanup: undefined, endTime: Date.now(),
    }))
    console.log("state.unregisterCleanup after completion =", state.tasks.bprobe0002.unregisterCleanup)

    // Nothing called it. The registration is still live in cleanupRegistry's Set.
    await runCleanupFunctions()
    console.log("shutdown cleanup fn invocations for a COMPLETED task =", calls)
    expect(calls).toBe(1)  // should be 0 if the handler had unregistered it
  })
})
