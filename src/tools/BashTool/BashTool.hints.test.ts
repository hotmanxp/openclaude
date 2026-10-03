// @ts-nocheck
import { describe, expect, test } from 'bun:test'
import { BashTool } from './BashTool.js'

// The hint fields are only useful if they reach the model. They live on `Out`
// (structured data) but the model reads the `content` string assembled by
// mapToolResultToToolResultBlockParam, so this pins that wiring.

const map = (overrides: Record<string, unknown> = {}) =>
  BashTool.mapToolResultToToolResultBlockParam(
    {
      interrupted: false,
      stdout: 'done',
      stderr: '',
      isImage: false,
      ...overrides
    },
    'toolu_test'
  ) as { content: string; is_error?: boolean }

describe('bash hint injection into tool_result content', () => {
  test('appends staleReadFileStateHint so the model re-reads before editing', () => {
    const content = map({
      staleReadFileStateHint: '[This command modified 1 file you have previously read: package.json. Call Read before editing.]'
    }).content
    expect(content).toContain('previously read')
    expect(content).toContain('package.json')
  })

  test('appends ghRateLimitHint', () => {
    const content = map({ ghRateLimitHint: '<system-reminder>GitHub API rate limit exceeded</system-reminder>' }).content
    expect(content).toContain('rate limit exceeded')
  })

  test('omits both hints when absent', () => {
    const content = map().content
    expect(content).toBe('done')
  })

  test('folds backgroundCwdHint into the background notice, not a separate block', () => {
    const content = map({
      backgroundTaskId: 'bg_1',
      assistantAutoBackgrounded: true,
      backgroundCwdHint: 'Session cwd remains /repo; directory changes made by the backgrounded command do not apply to subsequent commands.'
    }).content
    // It must ride along with the background line, not appear on its own.
    expect(content).toContain('moved to the background')
    expect(content).toContain('Session cwd remains /repo')
  })

  test('drops backgroundCwdHint when the command was not backgrounded', () => {
    const content = map({
      backgroundCwdHint: 'Session cwd remains /repo; directory changes do not apply.'
    }).content
    expect(content).not.toContain('Session cwd remains')
  })

  test('keeps hint order stdout, error, background, cwd, stale, rate-limit', () => {
    const content = map({
      stderr: 'warn',
      backgroundTaskId: 'bg_1',
      backgroundCwdHint: 'cwd-note',
      staleReadFileStateHint: 'stale-note',
      ghRateLimitHint: 'rate-note'
    }).content
    // Without assistantAutoBackgrounded the notice is the plain
    // "running in background" wording, so assert on that.
    const order = ['done', 'warn', 'running in background', 'cwd-note', 'stale-note', 'rate-note']
    let cursor = -1
    for (const token of order) {
      const at = content.indexOf(token, cursor + 1)
      expect(at).toBeGreaterThan(cursor)
      cursor = at
    }
  })
})
