import { describe, expect, test } from 'bun:test';
import { SelectMatcherMode } from './SelectMatcherMode.js';

describe('SelectMatcherMode (render smoke)', () => {
  test('exports a callable component', () => {
    expect(SelectMatcherMode).toBeDefined();
    expect(() => <SelectMatcherMode />).not.toThrow();
  });
});
