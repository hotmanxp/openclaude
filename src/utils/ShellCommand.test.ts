import { EventEmitter } from 'events'
import { expect, test } from 'bun:test'
import { wrapSpawn } from './ShellCommand.js'
import { TaskOutput } from './task/TaskOutput.js'

function createMockChildProcess(): EventEmitter & {
  pid?: number
  stdout: null
  stderr: null
} {
  const child = new EventEmitter() as EventEmitter & {
    pid?: number
    stdout: null
    stderr: null
  }
  child.stdout = null
  child.stderr = null
  child.pid = undefined
  return child
}

test('interrupt kills running shell commands', async () => {
  const child = createMockChildProcess()
  const controller = new AbortController()
  const command = wrapSpawn(
    child as never,
    controller.signal,
    30_000,
    new TaskOutput('shellcommand-test-running', null),
  )

  controller.abort('interrupt')

  const result = await command.result
  expect(command.status).toBe('killed')
  expect(result.interrupted).toBe(true)
  expect(result.code).toBe(137)
})

test('query-timeout abort is reported as an abort cancellation', async () => {
  const child = createMockChildProcess()
  const controller = new AbortController()
  const command = wrapSpawn(
    child as never,
    controller.signal,
    30_000,
    new TaskOutput('shellcommand-test-query-timeout', null),
  )

  controller.abort('query-timeout')

  const result = await command.result
  expect(command.status).toBe('killed')
  expect(result.interrupted).toBe(true)
  expect(result.code).toBe(137)
  expect(result.signalAborted).toBe(true)
  expect(result.isAbort).toBe(true)
  expect(result.abortReason).toBe('query-timeout')
})

test('shell command timeout is not reported as an abort cancellation', async () => {
  const child = createMockChildProcess()
  const controller = new AbortController()
  const command = wrapSpawn(
    child as never,
    controller.signal,
    10,
    new TaskOutput('shellcommand-test-tool-timeout', null),
  )

  const result = await command.result
  expect(command.status).toBe('killed')
  expect(result.code).toBe(143)
  expect(result.interrupted).toBe(false)
  expect(result.signalAborted).toBe(false)
  expect(result.isAbort).toBe(false)
  expect(result.abortReason).toBe('tool-timeout')
})

test('interrupt does not kill backgrounded shell commands', async () => {
  const child = createMockChildProcess()
  const controller = new AbortController()
  const command = wrapSpawn(
    child as never,
    controller.signal,
    30_000,
    new TaskOutput('shellcommand-test-backgrounded', null),
  )

  expect(command.background('bg-task')).toBe(true)
  controller.abort('interrupt')

  await Promise.resolve()
  expect(command.status).toBe('backgrounded')

  child.emit('exit', 0, null)
  const result = await command.result
  expect(result.code).toBe(0)
  expect(result.backgroundTaskId).toBe('bg-task')
  expect(result.isAbort).toBe(false)
})

test('interrupt does not kill keep-alive commands used by asyncRewake hooks', async () => {
  const child = createMockChildProcess()
  const controller = new AbortController()
  const command = wrapSpawn(
    child as never,
    controller.signal,
    30_000,
    new TaskOutput('shellcommand-test-keepalive', null),
    false,
    undefined,
    { keepAliveOnInterrupt: true },
  )

  controller.abort('interrupt')

  await Promise.resolve()
  expect(command.status).toBe('running')

  child.emit('exit', 2, null)
  const result = await command.result
  expect(result.code).toBe(2)
  expect(result.interrupted).toBe(false)
})

// Regression: the timeout handler has two paths — kill, or hand the command to
// the background. #timedOut used to be set only on the kill path, so a command
// that timed out and was backgrounded reported neither abortReason nor
// timedOutAfterMs, and the model could not tell the timeout had happened.

test('timeout that backgrounds the command still reports timedOutAfterMs', async () => {
  const child = createMockChildProcess()
  const controller = new AbortController()
  const command = wrapSpawn(
    child as never,
    controller.signal,
    40,
    new TaskOutput('shellcommand-test-bg-timeout', null),
    true,
  )

  // Register the handler BashTool installs; without it the timeout kills
  // instead of handing the command over.
  command.onTimeout?.(() => {})

  // Let the 40ms timeout fire and background the command.
  await new Promise(resolve => setTimeout(resolve, 90))
  expect(command.status).toBe('running')

  child.emit('exit', 0, null)
  const result = await command.result
  expect(result.timedOutAfterMs).toBe(40)
  expect(result.abortReason).toBe('tool-timeout')
  // Backgrounded, not killed — must not be reported as an interruption.
  expect(result.interrupted).toBe(false)
  expect(result.isAbort).toBe(false)
})
