/**
 * Queue operation types for command queue logging.
 * These are written to the transcript for debugging and replay.
 */

/**
 * Operations that can be performed on the command queue.
 */
export type QueueOperation = 'enqueue' | 'dequeue' | 'remove' | 'popAll'

/**
 * Message type for queue operation log entries.
 * Written to transcript for debugging/replay of queue behavior.
 */
export type QueueOperationMessage = {
  type: 'queue-operation'
  operation: QueueOperation
  timestamp: string
  sessionId: string
  content?: string
}
