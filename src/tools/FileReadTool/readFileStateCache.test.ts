/**
 * Regression for the false `file_unchanged` stub in the Read dedup gate.
 *
 * The defect: `utils/attachments.ts::getChangedFiles` re-reads every
 * externally-changed file through `FileReadTool.call` to build the "this file
 * you read changed" notice. That call went through the model-facing path, so
 * it wrote a normal `offset: 1` readFileState entry. FileWriteTool /
 * FileEditTool deliberately store `offset: undefined` so a later Read cannot
 * dedup against post-write state the model never saw — the internal read
 * silently promoted those entries into Read shape, and the next model Read
 * deduped against a file that had genuinely changed on disk.
 *
 * End-to-end: Write a file → change it externally → Read returns
 * "File unchanged since last read" instead of the new content.
 *
 * `writeReadFileState` (in constants.ts, a leaf module) is the seam encoding
 * that invariant, so these cases drive it directly.
 */
import { describe, expect, test } from 'bun:test'
import {
  writeReadFileState,
  type ReadFileStateCache,
  type ReadFileStateEntry,
} from './constants.js'

/** Minimal stand-in for the FileStateCache surface writeReadFileState touches. */
function makeCache(entries: Record<string, Partial<ReadFileStateEntry>> = {}) {
  const map = new Map<string, ReadFileStateEntry>(
    Object.entries(entries).map(([k, v]) => [
      k,
      {
        content: '',
        timestamp: 0,
        offset: undefined,
        limit: undefined,
        ...v,
      } as ReadFileStateEntry,
    ]),
  )
  const cache: ReadFileStateCache & {
    map: Map<string, ReadFileStateEntry>
  } = {
    map,
    get: k => map.get(k),
    set: (k, v) => void map.set(k, v),
  }
  return cache
}

/** The entry a completed read wants to record. */
const readEntry = (
  over: Partial<ReadFileStateEntry> = {},
): ReadFileStateEntry => ({
  content: 'new content',
  timestamp: 2000,
  offset: 1,
  limit: undefined,
  contentNotInModelContext: false,
  ...over,
})

/** Mirrors the real gate in FileReadTool.call. */
const dedupGateFires = (
  e: ReadFileStateEntry | undefined,
  offset: number,
  limit: number | undefined,
): boolean =>
  !!e &&
  !e.isPartialView &&
  !e.refreshedBehindModel &&
  e.offset !== undefined &&
  e.offset === offset &&
  e.limit === limit

describe('writeReadFileState — internal reads must not fake a model-initiated Read', () => {
  test('internal read leaves a Write-seeded entry (offset: undefined) in Write shape', () => {
    // Exactly the FileWriteTool shape: offset/limit explicitly undefined.
    const cache = makeCache({ '/f.txt': { content: 'written', timestamp: 1000 } })

    writeReadFileState(
      cache,
      '/f.txt',
      readEntry({ content: 'changed on disk' }),
      true,
    )

    const after = cache.map.get('/f.txt')!
    // The bug: this used to become 1, letting the next model Read dedup.
    expect(after.offset).toBeUndefined()
    expect(after.limit).toBeUndefined()
    // Content/timestamp still refreshed — that is what the diff needs.
    expect(after.content).toBe('changed on disk')
    expect(after.timestamp).toBe(2000)
  })

  test('the promoted entry would have misfired the dedup gate; the preserved one does not', () => {
    // Direct statement of the shipped bug, not just a shape assertion.
    const buggy = makeCache({ '/f.txt': { content: 'written', timestamp: 1000 } })
    buggy.set('/f.txt', readEntry({ content: 'changed on disk' })) // pre-fix
    expect(dedupGateFires(buggy.map.get('/f.txt'), 1, undefined)).toBe(true)

    const fixed = makeCache({ '/f.txt': { content: 'written', timestamp: 1000 } })
    writeReadFileState(
      fixed,
      '/f.txt',
      readEntry({ content: 'changed on disk' }),
      true,
    )
    // A model Read with default offset=1 / no limit must NOT dedup.
    expect(dedupGateFires(fixed.map.get('/f.txt'), 1, undefined)).toBe(false)
  })

  test('internal read marks the entry refreshedBehindModel', () => {
    const cache = makeCache({ '/f.txt': { content: 'written', timestamp: 1000 } })

    writeReadFileState(cache, '/f.txt', readEntry({ content: 'new' }), true)

    expect(cache.map.get('/f.txt')!.refreshedBehindModel).toBe(true)
  })

  test('model-initiated read still writes the Read shape (dedup keeps working)', () => {
    const cache = makeCache({ '/f.txt': { content: 'written', timestamp: 1000 } })

    writeReadFileState(
      cache,
      '/f.txt',
      readEntry({ content: 'what the model sees', timestamp: 3000 }),
      false,
    )

    const after = cache.map.get('/f.txt')!
    expect(after.offset).toBe(1)
    expect(after.content).toBe('what the model sees')
    // A model-initiated Read is not a behind-the-model refresh.
    expect(after.refreshedBehindModel).toBeUndefined()
    // …and the gate still fires for a repeat of the same range.
    expect(dedupGateFires(after, 1, undefined)).toBe(true)
  })

  test('internal read on an unseen file records offset: undefined, not 1', () => {
    const cache = makeCache()

    writeReadFileState(cache, '/new.txt', readEntry({ content: 'c' }), true)

    expect(cache.map.get('/new.txt')!.offset).toBeUndefined()
  })

  test('internal read preserves a prior ranged Read (offset/limit untouched)', () => {
    // A partial view must stay partial — promoting it would let dedup fire
    // against content the model only partially saw.
    const cache = makeCache({
      '/f.txt': { content: 'partial', timestamp: 1000, offset: 10, limit: 5 },
    })

    writeReadFileState(
      cache,
      '/f.txt',
      readEntry({ content: 'partial refreshed' }),
      true,
    )

    const after = cache.map.get('/f.txt')!
    expect(after.offset).toBe(10)
    expect(after.limit).toBe(5)
  })

  test('internal read keeps isPartialView sticky', () => {
    const cache = makeCache({
      '/f.txt': {
        content: 'truncated',
        timestamp: 1000,
        offset: 1,
        isPartialView: true,
      },
    })

    writeReadFileState(
      cache,
      '/f.txt',
      readEntry({ content: 'refreshed' }),
      true,
    )

    expect(cache.map.get('/f.txt')!.isPartialView).toBe(true)
  })

  test('internal read carries contentNotInModelContext from the read itself', () => {
    // opencc tracks whether the model's view is a 1:1 mirror of `content`.
    // The internal read must not clobber that signal with a stale `false`.
    const cache = makeCache({ '/f.txt': { content: 'written', timestamp: 1000 } })

    writeReadFileState(
      cache,
      '/f.txt',
      readEntry({ content: 'truncated by cap', contentNotInModelContext: true }),
      true,
    )

    expect(cache.map.get('/f.txt')!.contentNotInModelContext).toBe(true)
  })
})
