import { describe, expect, test } from 'bun:test';
import { Select } from './select.js';

describe('select (render smoke)', () => {
  test('exports a callable component', () => {
    expect(Select).toBeDefined();
    expect(() => <Select />).not.toThrow();
  });
});
