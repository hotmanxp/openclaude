// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  dequeue,
  demoteFromNow,
  enqueue,
  getCommandQueue,
  getCommandQueueSnapshot,
  promoteToNow,
  resetCommandQueue,
  subscribeToCommandQueue,
} from './messageQueueManager.js'

const UUID_A = '11111111-1111-1111-1111-111111111111' as const
const UUID_B = '22222222-2222-2222-2222-222222222222' as const

describe('messageQueueManager promote/demote', () => {
  beforeEach(() => {
    resetCommandQueue()
  })

  afterEach(() => {
    resetCommandQueue()
  })

  it('promotes a queued command to now priority', () => {
    enqueue({ value: 'hello', mode: 'prompt', uuid: UUID_A })

    expect(promoteToNow(UUID_A)).toBe(true)
    expect(getCommandQueue()[0]?.priority).toBe('now')
  })

  it('returns false for an unknown uuid', () => {
    enqueue({ value: 'hello', mode: 'prompt', uuid: UUID_A })

    expect(promoteToNow(UUID_B)).toBe(false)
    // The miss must not have touched the other command's priority.
    expect(getCommandQueue()[0]?.priority).toBe('next')
  })

  it('returns false when the command is already now (idempotent re-press)', () => {
    enqueue({ value: 'hello', mode: 'prompt', uuid: UUID_A })

    expect(promoteToNow(UUID_A)).toBe(true)
    expect(promoteToNow(UUID_A)).toBe(false)
    expect(getCommandQueue()[0]?.priority).toBe('now')
  })

  it('demotes a now-priority command back to the given priority', () => {
    enqueue({ value: 'hello', mode: 'prompt', uuid: UUID_A })

    promoteToNow(UUID_A)
    expect(demoteFromNow(UUID_A, 'later')).toBe(true)
    expect(getCommandQueue()[0]?.priority).toBe('later')
  })

  it('refuses to demote a command that is not at now priority', () => {
    enqueue({ value: 'hello', mode: 'prompt', uuid: UUID_A })

    // Still 'next' — demote must be a no-op, not a silent re-prioritisation.
    expect(demoteFromNow(UUID_A, 'later')).toBe(false)
    expect(getCommandQueue()[0]?.priority).toBe('next')
  })

  it('returns false when demoting an unknown uuid', () => {
    expect(demoteFromNow(UUID_A, 'next')).toBe(false)
  })

  it('notifies subscribers on promote and demote', () => {
    enqueue({ value: 'hello', mode: 'prompt', uuid: UUID_A })

    let notifications = 0
    const unsubscribe = subscribeToCommandQueue(() => {
      notifications++
    })
    try {
      promoteToNow(UUID_A)
      demoteFromNow(UUID_A, 'next')
    } finally {
      unsubscribe()
    }

    // One broadcast per mutation. A promote that mutated the object without
    // calling notifySubscribers() would leave React consumers stale — the
    // snapshot array is frozen, but the command objects are not.
    expect(notifications).toBe(2)
  })

  it('rebuilds the frozen snapshot after a promote', () => {
    enqueue({ value: 'hello', mode: 'prompt', uuid: UUID_A })
    const before = getCommandQueueSnapshot()

    promoteToNow(UUID_A)
    const after = getCommandQueueSnapshot()

    expect(after).not.toBe(before)
    expect(after[0]?.priority).toBe('now')
  })

  it('makes a promoted command the next one dequeued', () => {
    // The point of promoting: a 'later' task notification must not be
    // delivered before the message the user just said to send now.
    enqueue({ value: 'notification', mode: 'task-notification', uuid: UUID_B })
    enqueue({ value: 'send me now', mode: 'prompt', uuid: UUID_A })

    expect(dequeue()?.uuid).toBe(UUID_B)

    promoteToNow(UUID_A)
    expect(dequeue()?.uuid).toBe(UUID_A)
  })
})
