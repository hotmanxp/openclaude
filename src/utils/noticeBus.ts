/**
 * Neutral user-visible notice bus.
 *
 * The REPL subscribes and maps notices onto the host notification queue
 * (toast). Producers are anything that must tell the user something without
 * holding a React reference — mods pushing `ui.notice`, or a core module
 * reporting that it silently dropped work.
 *
 * This lives in utils/ rather than in mods/ so core modules can emit without
 * importing the mods runtime. `source` is a label for who is speaking
 * (`modName` for mods, `'system'` / `'transcript'` for the host itself); it is
 * used in the notice key, not for attribution in the UI.
 */

const NOTICE_MAX_CHARS = 2000

export type UserNotice = {
  key: string
  source: string
  text: string
}

const noticeListeners = new Set<(notice: UserNotice) => void>()
let noticeSeq = 0

export function subscribeUserNotices(
  listener: (notice: UserNotice) => void,
): () => void {
  noticeListeners.add(listener)
  return () => {
    noticeListeners.delete(listener)
  }
}

export function emitUserNotice(source: string, text: string): void {
  const trimmed =
    text.length > NOTICE_MAX_CHARS
      ? `${text.slice(0, NOTICE_MAX_CHARS)}…`
      : text
  const notice: UserNotice = {
    key: `notice-${source}-${noticeSeq++}`,
    source,
    text: trimmed,
  }
  for (const listener of noticeListeners) {
    try {
      listener(notice)
    } catch {
      // A broken subscriber must not stop the others from being told.
    }
  }
}

/** @internal Reset listener state so tests don't leak across cases. */
export function _resetNoticeBusForTesting(): void {
  noticeListeners.clear()
  noticeSeq = 0
}