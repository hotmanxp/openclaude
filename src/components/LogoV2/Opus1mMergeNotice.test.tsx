import { describe, expect, test } from 'bun:test';
import { Opus1mMergeNotice } from './Opus1mMergeNotice.js';

describe('Opus1mMergeNotice (render smoke)', () => {
  test('exports a callable component', () => {
    expect(Opus1mMergeNotice).toBeDefined();
    expect(() => <Opus1mMergeNotice />).not.toThrow();
  });
});
