// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { decide, selectHead } from './sendNowScheduler.js'

/**
 * Ground truth for the decision table below is upstream's Rs() as extracted
 * from bundle.js @26356584 — the order of the checks is the behaviour, so
 * each case isolates one branch and asserts the exact upstream outcome.
 */
const base = {
  isLocalTurnActive: true,
  isLocalTurnRunning: true,
  head: 'deliverable',
  isHeldByDialog: false,
  isCompacting: false,
  holderCount: 0,
  unmovableHolderCount: 0,
  isMainRequestInFlight: true,
  unmovableGraceOver: false,
}

describe('sendNowScheduler decide()', () => {
  it('stands by when no turn is active', () => {
    expect(decide({ ...base, isLocalTurnActive: false })).toEqual({
      action: 'stand_by',
    })
  })

  it('interrupts when a turn is running, nothing is holding it, and a request is in flight', () => {
    expect(decide(base)).toEqual({ action: 'interrupt' })
  })

  it('waits for a dialog to clear before interrupting', () => {
    // A dialog outranks everything below it in the check order.
    expect(decide({ ...base, isHeldByDialog: true, isCompacting: true })).toEqual({
      action: 'wait',
      reason: 'held_by_dialog',
    })
  })

  it('waits when the turn is only dispatching, not running', () => {
    // isActive is true but isRunning is false — nothing has started yet, so
    // aborting would be a no-op and the message should just wait.
    expect(decide({ ...base, isLocalTurnRunning: false })).toEqual({
      action: 'wait',
      reason: 'not_ready',
    })
  })

  it('waits when the head is not_ready', () => {
    expect(decide({ ...base, head: 'not_ready' })).toEqual({
      action: 'wait',
      reason: 'not_ready',
    })
  })

  it('waits when an earlier prompt must be delivered first', () => {
    expect(decide({ ...base, head: 'behind_earlier' })).toEqual({
      action: 'wait',
      reason: 'behind_earlier',
    })
  })

  it('waits while compacting', () => {
    expect(decide({ ...base, isCompacting: true })).toEqual({
      action: 'wait',
      reason: 'compacting',
    })
  })

  it('grants unmovable grace before interrupting a holder', () => {
    const held = { ...base, holderCount: 1, unmovableHolderCount: 1 }
    expect(decide(held)).toEqual({ action: 'wait', reason: 'unmovable_grace' })
    // Once the grace counter is spent, it stops waiting and interrupts.
    expect(decide({ ...held, unmovableGraceOver: true })).toEqual({
      action: 'interrupt',
    })
  })

  it('holds off interrupting when no request is in flight', () => {
    expect(decide({ ...base, isMainRequestInFlight: false })).toEqual({
      action: 'wait',
      reason: 'not_ready',
    })
  })

  it('reports background when holders outnumber unmovable holders', () => {
    // Unreachable in the fork (readEvidence always reports them equal), but the
    // branch is retained so the shape survives if that ever diverges.
    expect(
      decide({ ...base, holderCount: 3, unmovableHolderCount: 1 }),
    ).toEqual({ action: 'background' })
  })
})

describe('sendNowScheduler selectHead()', () => {
  const UUID_A = '11111111-1111-1111-1111-111111111111'
  const UUID_B = '22222222-2222-2222-2222-222222222222'

  const candidate = uuid => ({ uuid, raisedFrom: 'next' })

  it('selects the first candidate that is not already promoted', () => {
    const queue = [
      { value: 'a', mode: 'prompt', uuid: UUID_A, priority: 'next' },
      { value: 'b', mode: 'prompt', uuid: UUID_B, priority: 'next' },
    ]
    const candidates = new Map([
      [UUID_A, candidate(UUID_A)],
      [UUID_B, candidate(UUID_B)],
    ])

    expect(selectHead(queue, candidates)?.candidate.uuid).toBe(UUID_A)
  })

  it('returns null once every candidate is promoted', () => {
    // The regression this pins: after promoting, the promoted command is
    // skipped by the 'now' filter, so the scheduler sees no head. If that were
    // treated as "nothing to do" it would tear down and demote the command
    // straight back to 'next' while it is still queued, silently undoing the
    // promotion. The caller must keep polling instead.
    const queue = [
      { value: 'a', mode: 'prompt', uuid: UUID_A, priority: 'now' },
      { value: 'b', mode: 'prompt', uuid: UUID_B, priority: 'now' },
    ]
    const candidates = new Map([
      [UUID_A, candidate(UUID_A)],
      [UUID_B, candidate(UUID_B)],
    ])

    expect(selectHead(queue, candidates)).toBeNull()
  })

  it('advances to the next candidate when the first is already promoted', () => {
    const queue = [
      { value: 'a', mode: 'prompt', uuid: UUID_A, priority: 'now' },
      { value: 'b', mode: 'prompt', uuid: UUID_B, priority: 'next' },
    ]
    const candidates = new Map([
      [UUID_A, candidate(UUID_A)],
      [UUID_B, candidate(UUID_B)],
    ])

    expect(selectHead(queue, candidates)?.candidate.uuid).toBe(UUID_B)
  })

  it('waits behind an earlier prompt already in the queue', () => {
    // An untracked prompt ahead of the candidate is delivered first, so the
    // candidate must wait rather than jump it.
    const queue = [
      { value: 'earlier', mode: 'prompt', uuid: '33333333-3333-3333-3333-333333333333', priority: 'next' },
      { value: 'a', mode: 'prompt', uuid: UUID_A, priority: 'next' },
    ]
    const candidates = new Map([[UUID_A, candidate(UUID_A)]])

    expect(selectHead(queue, candidates)?.head).toBe('behind_earlier')
  })

  it('waits when an already-promoted command sits ahead of the candidate', () => {
    const queue = [
      { value: 'a', mode: 'prompt', uuid: UUID_A, priority: 'now' },
      { value: 'b', mode: 'prompt', uuid: UUID_B, priority: 'next' },
    ]
    const candidates = new Map([[UUID_B, candidate(UUID_B)]])

    expect(selectHead(queue, candidates)?.head).toBe('not_ready')
  })
})

describe('sendQueuedNow end-to-end', () => {
  const UUID_A = '11111111-1111-1111-1111-111111111111'

  async function driveScheduler({ turnRunning }) {
    const { QueryGuard } = await import('./QueryGuard.js')
    const {
      publishTurnHandles,
      resetTurnHandles,
    } = await import('./turnAbortRegistry.js')
    const { setMainRequestInFlight } = await import('./turnEvidence.js')
    const scheduler = await import('./sendNowScheduler.js')
    const queue = await import('./messageQueueManager.js')

    resetTurnHandles()
    queue.resetCommandQueue()
    scheduler.disposeSendNowScheduler()

    const guard = new QueryGuard()
    if (turnRunning) {
      guard.reserve()
      guard.tryStart()
    }
    // A live, un-aborted controller: the abort-on-'now' hook in print.ts fires
    // on this, which is the whole delivery mechanism.
    const controller = new AbortController()
    publishTurnHandles({
      abortController: controller,
      queryGuard: guard,
      isCompacting: false,
    })
    setMainRequestInFlight(true)

    return {
      scheduler,
      queue,
      guard,
      controller,
      disposeSendNowScheduler: scheduler.disposeSendNowScheduler,
    }
  }

  it('promotes the queued message to now and leaves it promoted while it waits for the drain', async () => {
    const {
      scheduler,
      queue,
      disposeSendNowScheduler,
    } = await driveScheduler({
      turnRunning: true,
    })
    try {
      queue.enqueue({ value: 'send me', mode: 'prompt', uuid: UUID_A })
      expect(queue.getCommandQueue()[0]?.priority).toBe('next')

      expect(scheduler.sendQueuedNow()).toBe(true)

      // Poll past the 200ms interval: promotion happens on the first tick.
      await Bun.sleep(450)

      const cmd = queue.getCommandQueue().find(c => c.uuid === UUID_A)
      expect(cmd).toBeDefined()
      // The regression: an earlier version tore down once selectHead found no
      // un-promoted candidate, and restoreRaised() demoted the command back to
      // 'next' while it was still queued — the promotion silently undid itself.
      expect(cmd.priority).toBe('now')
    } finally {
      disposeSendNowScheduler()
    }
  })

  it('restores the original priority when the scheduler is disposed before delivery', async () => {
    const {
      scheduler,
      queue,
      disposeSendNowScheduler,
    } = await driveScheduler({
      turnRunning: true,
    })
    try {
      queue.enqueue({ value: 'send me', mode: 'prompt', uuid: UUID_A })
      scheduler.sendQueuedNow()
      await Bun.sleep(450)
      expect(queue.getCommandQueue()[0]?.priority).toBe('now')

      disposeSendNowScheduler()
      // Without this, an undelivered command stays pinned at 'now' forever and
      // starves every other queued message.
      expect(queue.getCommandQueue()[0]?.priority).toBe('next')
    } finally {
      disposeSendNowScheduler()
    }
  })

  it('does nothing when no turn is running', async () => {
    const {
      scheduler,
      queue,
      disposeSendNowScheduler,
    } = await driveScheduler({
      turnRunning: false,
    })
    try {
      queue.enqueue({ value: 'send me', mode: 'prompt', uuid: UUID_A })
      expect(scheduler.sendQueuedNow()).toBe(false)
      expect(queue.getCommandQueue()[0]?.priority).toBe('next')
    } finally {
      disposeSendNowScheduler()
    }
  })
})
