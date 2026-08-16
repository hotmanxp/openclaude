import { afterEach, describe, expect, jest, mock, test } from 'bun:test'
import { TaskOutputTool } from './TaskOutputTool.js'

describe('TaskOutput activity', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  test('emits progress heartbeats during a long blocking wait', async () => {
    jest.useFakeTimers()
    const abortController = new AbortController()
    const task = {
      id: 'task-1',
      type: 'local_bash',
      status: 'running',
      description: 'long-running task',
    }
    const onProgress = mock()
    const callPromise = TaskOutputTool.call(
      { task_id: task.id, block: true, timeout: 600_000 },
      {
        abortController,
        getAppState: () => ({ tasks: { [task.id]: task } }),
      } as never,
      undefined as never,
      undefined as never,
      onProgress,
    )

    jest.advanceTimersByTime(30_000)
    await Promise.resolve()
    abortController.abort()
    jest.advanceTimersByTime(100)
    await Promise.resolve()
    await expect(callPromise).rejects.toThrow()

    expect(onProgress).toHaveBeenCalledTimes(2)
    jest.advanceTimersByTime(30_000)
    expect(onProgress).toHaveBeenCalledTimes(2)
  })

  test('a throwing progress callback does not break the blocking wait', async () => {
    jest.useFakeTimers()
    const abortController = new AbortController()
    const task = {
      id: 'task-2',
      type: 'local_bash',
      status: 'running',
      description: 'long-running task',
    }
    const onProgress = mock(() => {
      throw new Error('progress consumer failure')
    })
    const callPromise = TaskOutputTool.call(
      { task_id: task.id, block: true, timeout: 600_000 },
      {
        abortController,
        getAppState: () => ({ tasks: { [task.id]: task } }),
      } as never,
      undefined as never,
      undefined as never,
      onProgress,
    )

    // Heartbeat throws inside the timer callback; it must be contained
    // instead of surfacing as an uncaught exception.
    expect(() => jest.advanceTimersByTime(30_000)).not.toThrow()
    await Promise.resolve()
    abortController.abort()
    jest.advanceTimersByTime(100)
    await Promise.resolve()
    await expect(callPromise).rejects.toThrow()
    expect(onProgress).toHaveBeenCalledTimes(2)
  })
})
