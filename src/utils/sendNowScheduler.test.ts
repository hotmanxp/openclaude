// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { decide } from './sendNowScheduler.js'

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
