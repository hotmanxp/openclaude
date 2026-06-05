import { describe, expect, test } from 'bun:test';
import { DiffFileList } from './DiffFileList.js';

describe('DiffFileList (render smoke)', () => {
  test('exports a callable component', () => {
    expect(DiffFileList).toBeDefined();
    expect(() => <DiffFileList />).not.toThrow();
  });
});
