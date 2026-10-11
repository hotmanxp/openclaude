import { createContext, useCallback, useContext, useMemo } from 'react'
import { isProgressReportingAvailable, type Progress } from './terminal.js'
import { BEL } from './termio/ansi.js'
import { ITERM2, OSC, osc, PROGRESS, wrapForMultiplexer } from './termio/osc.js'

type WriteRaw = (data: string) => void

export const TerminalWriteContext = createContext<WriteRaw | null>(null)

/**
 * Module-level mirror of the context, for callers outside React.
 *
 * The hook form cannot serve the mod runtime: `ctx.ui.notify` is called from
 * plain code, with no component tree and therefore no context to read. The
 * provider registers its writer here on mount and clears it on unmount, so
 * there is exactly one owner of the terminal writer and the two paths cannot
 * disagree about multiplexing or wrapping.
 */
let registeredWriter: WriteRaw | null = null

export function setTerminalWriter(fn: WriteRaw | null): void {
  registeredWriter = fn
}

/** The current writer, or null when no provider is mounted. */
export function getTerminalWriter(): WriteRaw | null {
  return registeredWriter
}

/**
 * Publishes `data` to the terminal, if a provider is mounted.
 *
 * Returns whether it went out, so a caller can tell "not rendered" from
 * "rendered and nobody was listening".
 */
export function writeTerminalRaw(data: string): boolean {
  if (!registeredWriter) return false
  registeredWriter(data)
  return true
}

export const TerminalWriteProvider = TerminalWriteContext.Provider

export type TerminalNotification = {
  notifyITerm2: (opts: { message: string; title?: string }) => void
  notifyKitty: (opts: { message: string; title: string; id: number }) => void
  notifyGhostty: (opts: { message: string; title: string }) => void
  notifyBell: () => void
  /**
   * Report progress to the terminal via OSC 9;4 sequences.
   * Supported terminals: ConEmu, Ghostty 1.2.0+, iTerm2 3.6.6+
   * Pass state=null to clear progress.
   */
  progress: (state: Progress['state'] | null, percentage?: number) => void
}

export function useTerminalNotification(): TerminalNotification {
  const writeRaw = useContext(TerminalWriteContext)
  if (!writeRaw) {
    throw new Error(
      'useTerminalNotification must be used within TerminalWriteProvider',
    )
  }

  const notifyITerm2 = useCallback(
    ({ message, title }: { message: string; title?: string }) => {
      const displayString = title ? `${title}:\n${message}` : message
      writeRaw(wrapForMultiplexer(osc(OSC.ITERM2, `\n\n${displayString}`)))
    },
    [writeRaw],
  )

  const notifyKitty = useCallback(
    ({
      message,
      title,
      id,
    }: {
      message: string
      title: string
      id: number
    }) => {
      writeRaw(wrapForMultiplexer(osc(OSC.KITTY, `i=${id}:d=0:p=title`, title)))
      writeRaw(wrapForMultiplexer(osc(OSC.KITTY, `i=${id}:p=body`, message)))
      writeRaw(wrapForMultiplexer(osc(OSC.KITTY, `i=${id}:d=1:a=focus`, '')))
    },
    [writeRaw],
  )

  const notifyGhostty = useCallback(
    ({ message, title }: { message: string; title: string }) => {
      writeRaw(wrapForMultiplexer(osc(OSC.GHOSTTY, 'notify', title, message)))
    },
    [writeRaw],
  )

  const notifyBell = useCallback(() => {
    // Raw BEL — inside tmux this triggers tmux's bell-action (window flag).
    // Wrapping would make it opaque DCS payload and lose that fallback.
    writeRaw(BEL)
  }, [writeRaw])

  const progress = useCallback(
    (state: Progress['state'] | null, percentage?: number) => {
      if (!isProgressReportingAvailable()) {
        return
      }
      if (!state) {
        writeRaw(
          wrapForMultiplexer(
            osc(OSC.ITERM2, ITERM2.PROGRESS, PROGRESS.CLEAR, ''),
          ),
        )
        return
      }
      const pct = Math.max(0, Math.min(100, Math.round(percentage ?? 0)))
      switch (state) {
        case 'completed':
          writeRaw(
            wrapForMultiplexer(
              osc(OSC.ITERM2, ITERM2.PROGRESS, PROGRESS.CLEAR, ''),
            ),
          )
          break
        case 'error':
          writeRaw(
            wrapForMultiplexer(
              osc(OSC.ITERM2, ITERM2.PROGRESS, PROGRESS.ERROR, pct),
            ),
          )
          break
        case 'indeterminate':
          writeRaw(
            wrapForMultiplexer(
              osc(OSC.ITERM2, ITERM2.PROGRESS, PROGRESS.INDETERMINATE, ''),
            ),
          )
          break
        case 'running':
          writeRaw(
            wrapForMultiplexer(
              osc(OSC.ITERM2, ITERM2.PROGRESS, PROGRESS.SET, pct),
            ),
          )
          break
        case null:
          // Handled by the if guard above
          break
      }
    },
    [writeRaw],
  )

  return useMemo(
    () => ({ notifyITerm2, notifyKitty, notifyGhostty, notifyBell, progress }),
    [notifyITerm2, notifyKitty, notifyGhostty, notifyBell, progress],
  )
}
