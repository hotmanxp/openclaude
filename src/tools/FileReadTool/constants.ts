// Keep tool name constants in a leaf module to avoid circular-import TDZ issues.
export const FILE_READ_TOOL_NAME = 'Read'

import type { FileState } from '../../utils/fileStateCache.js'

/**
 * One entry of the read cache. Aliased to the canonical `FileState` rather
 * than restated, so the two cannot drift — an earlier hand-written copy here
 * typed `offset: number` and `tsc` rejected every `FileStateCache` passed in.
 */
export type ReadFileStateEntry = FileState

/** The slice of the read cache this function needs. */
export type ReadFileStateCache = {
  get(path: string): ReadFileStateEntry | undefined
  set(path: string, entry: ReadFileStateEntry): void
}

/**
 * Write the post-read cache entry for one completed Read.
 *
 * `offset`/`limit` are load-bearing beyond cache eviction: the dedup gate in
 * `FileReadTool.call` only fires for entries with `offset !== undefined`,
 * i.e. entries a *model-initiated* Read produced. FileWriteTool /
 * FileEditTool deliberately store `offset: undefined` so a later Read cannot
 * dedup against post-write state the model never actually saw.
 *
 * An internal read (see `CallInput.internal`) is neither: it exists only to
 * feed a background diff — `utils/attachments.ts::getChangedFiles` re-reads
 * every externally-changed file to build the "this file you read changed"
 * notice — and the model never sees its output. Letting it write a normal
 * `offset: 1` entry promotes a Write-seeded entry into Read shape, so the
 * next model Read dedups against content the model was never shown: the
 * false `file_unchanged` stub. For internal reads we keep the pre-existing
 * entry's range shape and only refresh content and timestamp, which is what
 * the changed-file diff actually consumes, and mark it `refreshedBehindModel`
 * so consumers can tell the content was refreshed outside the model's flow.
 *
 * Lives in this leaf module (not FileReadTool.ts) so it is importable
 * without dragging in the tool graph, which is what makes it unit-testable.
 */
export function writeReadFileState(
  readFileState: ReadFileStateCache,
  fullFilePath: string,
  entry: ReadFileStateEntry,
  isInternal: boolean,
): void {
  if (!isInternal) {
    readFileState.set(fullFilePath, entry)
    return
  }
  const existing = readFileState.get(fullFilePath)
  if (!existing) {
    // Nothing to preserve the range shape of. `offset: undefined` still
    // records "the model has not read this", which is the honest state.
    readFileState.set(fullFilePath, {
      ...entry,
      offset: undefined,
      limit: undefined,
      refreshedBehindModel: true,
    })
    return
  }
  readFileState.set(fullFilePath, {
    ...entry,
    offset: existing.offset,
    limit: existing.limit,
    ...(existing.isPartialView ? { isPartialView: true } : {}),
    refreshedBehindModel: true,
  })
}
