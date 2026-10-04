import { describe, expect, test } from 'bun:test'
import { findClosestName, levenshtein } from './levenshtein.js'

describe('levenshtein', () => {
  test('identical strings are distance 0', () => {
    expect(levenshtein('commit', 'commit')).toBe(0)
    expect(levenshtein('', '')).toBe(0)
  })

  test('empty string is the length of the other', () => {
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('abc', '')).toBe(3)
  })

  test('single substitution, insertion and deletion cost 1', () => {
    expect(levenshtein('commit', 'comnit')).toBe(1)
    expect(levenshtein('commit', 'commmit')).toBe(1)
    expect(levenshtein('commit', 'comit')).toBe(1)
  })

  test('adjacent transposition costs 1, not 2', () => {
    // The Damerau branch. Plain Levenshtein scores this as 2, which would
    // make it miss a maxEditDistance of 1.
    expect(levenshtein('reviw', 'review')).toBe(1)
    expect(levenshtein('ab', 'ba')).toBe(1)
  })

  test('unrelated strings stay expensive', () => {
    expect(levenshtein('commit', 'deploy')).toBeGreaterThan(2)
  })
})

describe('findClosestName', () => {
  const candidates = [
    { name: 'commit' },
    { name: 'review-pr', aliases: ['rp'] },
    { name: 'pdf' },
  ]

  test('returns undefined when nothing is within range', () => {
    expect(findClosestName('zzzzzz', candidates, 2)).toBeUndefined()
  })

  test('finds a single-character typo', () => {
    expect(findClosestName('comnit', candidates, 2)).toBe('commit')
  })

  test('matches aliases as well as names', () => {
    // 'rp' is two edits from 'xxxx'... but within 2 of 'rp' itself.
    expect(findClosestName('rxp', candidates, 2)).toBe('rp')
  })

  test('rejects on length difference before scoring', () => {
    // 'deploy-hooks' differs by more than 2 in length from 'deploy', so it
    // must not win even though the shared prefix is long.
    const long = [{ name: 'deploy' }, { name: 'deploy-hooks-and-more' }]
    expect(findClosestName('deplo', long, 2)).toBe('deploy')
  })

  test('keeps the first candidate on a tie', () => {
    // Both 'review' and 'revise' are distance 1 from 'reviwe'; the scan keeps
    // the first strictly-better hit, so the earlier candidate wins.
    const both = [{ name: 'review' }, { name: 'revise' }]
    expect(findClosestName('reviwe', both, 2)).toBe('review')
  })

  test('prefers the strictly closer candidate', () => {
    const both = [{ name: 'reviewe' }, { name: 'revise' }]
    expect(findClosestName('revise', both, 2)).toBe('revise')
  })
})
