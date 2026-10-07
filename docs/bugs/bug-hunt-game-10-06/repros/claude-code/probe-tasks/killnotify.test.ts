import { describe, expect, it } from 'bun:test'
import { killTask } from '/Users/ethan/code/opencc/src/tasks/LocalShellTask/killShellTasks.js'
import { registerTask } from '/Users/ethan/code/opencc/src/utils/task/framework.js'
import { generateTaskAttachments, applyTaskOffsetsAndEvictions } from '/Users/ethan/code/opencc/src/utils/task/framework.js'
import { dequeueAllMatching } from '/Users/ethan/code/opencc/src/utils/messageQueueManager.js'
import { enqueuePendingNotification } from '/Users/ethan/code/opencc/src/utils/messageQueueManager.js'

function makeStore() {
  let state: any = { tasks: {} as Record<string, any> }
  const setAppState = (u: any) => { state = u(state) }
  const getAppState = () => state
  return { setAppState, getAppState }
}

describe('UI kill path (BackgroundTasksDialog -> LocalShellTask.kill)', () => {
  it('marks the task killed + notified=true without any queued notification', async () => {
    const { setAppState, getAppState } = makeStore()
    // drain any residue
    dequeueAllMatching(() => true)

    // Simulate what spawnShellTask does: register a running local_bash task
    const fakeShell: any = { kill() {}, cleanup() {} }
    registerTask({
      id: 'bprobe0001', type: 'local_bash', status: 'running',
      description: 'fake-logs.sh', command: './fake-logs.sh', startTime: Date.now(),
      outputFile: '/tmp/x', outputOffset: 0, notified: false,
      completionStatusSentInAttachment: false, shellCommand: fakeShell,
      lastReportedTotalLines: 0, isBackgrounded: true,
    } as any, setAppState as any)

    // The dialog kill button: await LocalShellTask.kill(taskId, setAppState)
    // -> killTask
    killTask('bprobe0001', setAppState as any)

    const t = getAppState().tasks['bprobe0001']
    console.log('AFTER UI KILL status=', t.status, 'notified=', t.notified)

    // Did anything reach the model's message queue?
    const queued = dequeueAllMatching(() => true) as any[]
    console.log('QUEUED NOTIFICATIONS:', JSON.stringify(queued.map(c => c.value ?? c)))

    // Now the shell exits and spawnShellTask's result.then handler runs:
    // it calls enqueueShellNotification(..., 'killed', ...). Reproduce the
    // notified short-circuit that function performs.
    let shouldEnqueue = false
    const { updateTaskState } = await import('/Users/ethan/code/opencc/src/utils/task/framework.js')
    updateTaskState('bprobe0001', setAppState as any, (task: any) => {
      if (task.notified) return task
      shouldEnqueue = true
      return { ...task, notified: true }
    })
    console.log('enqueueShellNotification would enqueue?', shouldEnqueue)

    // And the GC pass evicts it as notified+terminal
    const gen = await generateTaskAttachments(getAppState())
    console.log('evictedTaskIds from GC:', gen.evictedTaskIds)
    applyTaskOffsetsAndEvictions(setAppState as any, gen.updatedTaskOffsets, gen.evictedTaskIds)
    console.log('tasks remaining after GC:', Object.keys(getAppState().tasks))

    expect(shouldEnqueue).toBe(false)
  })
})
