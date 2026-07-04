import { afterEach, describe, expect, jest, test } from 'bun:test'
import { QueryGuard } from './QueryGuard.js'

describe('QueryGuard', () => {
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  test('starts idle', () => {
    const guard = new QueryGuard()
    expect(guard.isActive).toBe(false)
  })

  test('timeout fires and force-ends the guard', () => {
    jest.useFakeTimers()
    const guard = new QueryGuard()
    const generation = guard.tryStart()!
    expect(guard.isActive).toBe(true)
    expect(guard.generation).toBe(generation)

    // Just before the timeout
    jest.advanceTimersByTime(5 * 60 * 1000 - 1)
    expect(guard.isActive).toBe(true)

    // At timeout
    jest.advanceTimersByTime(1)
    expect(guard.isActive).toBe(false)
  })

  test('timeout notifies owner with the timed-out generation', () => {
    jest.useFakeTimers()
    const guard = new QueryGuard()
    const onTimeout = jest.fn()
    guard.setTimeoutHandler(onTimeout)

    const gen = guard.tryStart()!
    jest.advanceTimersByTime(5 * 60 * 1000)

    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onTimeout).toHaveBeenCalledWith(gen)
    expect(guard.isActive).toBe(false)
  })

  test('timeout handler cleanup prevents stale notification', () => {
    jest.useFakeTimers()
    const guard = new QueryGuard()
    const onTimeout = jest.fn()
    const cleanup = guard.setTimeoutHandler(onTimeout)
    cleanup()

    guard.tryStart()
    jest.advanceTimersByTime(5 * 60 * 1000)

    expect(onTimeout).not.toHaveBeenCalled()
    expect(guard.isActive).toBe(false)
  })

  test('timeout handler errors do not escape the watchdog callback', () => {
    jest.useFakeTimers()
    const guard = new QueryGuard()
    const handlerError = new Error('handler failed')
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    guard.setTimeoutHandler(() => {
      throw handlerError
    })

    guard.tryStart()

    expect(() => jest.advanceTimersByTime(5 * 60 * 1000)).not.toThrow()
    expect(guard.isActive).toBe(false)
    expect(consoleError).toHaveBeenCalledWith('[QueryGuard] Timeout handler failed', handlerError)
  })

  test('timeout is cleared when end() is called normally', () => {
    jest.useFakeTimers()
    const guard = new QueryGuard()
    const generation = guard.tryStart()!
    jest.advanceTimersByTime(60 * 1000)

    expect(guard.end(generation)).toBe(true)
    expect(guard.isActive).toBe(false)

    // Past the timeout — guard should still be idle (timer was cleared)
    jest.advanceTimersByTime(5 * 60 * 1000)
    expect(guard.isActive).toBe(false)
  })

  test('end() returns false for stale generations', () => {
    jest.useFakeTimers()
    const guard = new QueryGuard()
    const firstGen = guard.tryStart()!
    guard.forceEnd()

    // New query
    expect(guard.tryStart()).not.toBe(firstGen)

    // Stale end from the first query
    expect(guard.end(firstGen)).toBe(false)
    expect(guard.isActive).toBe(true)

    guard.forceEnd()
  })
})
