import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import type { StreamClientEvent } from './SSETransport.js'

/**
 * Interface for bidirectional transport layers (WebSocket, SSE, etc.)
 * used by RemoteIO to communicate with the session ingress service.
 */
export interface Transport {
  /**
   * Open the transport connection. Implementations handle their own
   * reconnection/backoff; the returned promise resolves when the initial
   * connection attempt completes (or the transport gives up).
   */
  connect(): Promise<void> | void

  /** Send a message to the server. */
  write(message: StdoutMessage): Promise<void> | void

  /** Permanently close the transport, allowing async flush/cleanup. */
  close(): Promise<void> | void

  setOnData(callback: (data: string) => void): void
  setOnClose(callback: (closeCode?: number) => void): void

  /** Optional - only implemented by WebSocketTransport for connection open events */
  setOnConnect?(callback: () => void): void

  /** Register the callback invoked for transport-specific events. */
  setOnEvent?(callback: (event: unknown) => void): void

  /** Whether the transport is currently connected. */
  isConnectedStatus?(): boolean

  /** Whether the transport has permanently closed. */
  isClosedStatus?(): boolean

  /** Human-readable transport state for diagnostics. */
  getStateLabel?(): string
}
