import { describe, expect, test } from 'bun:test';
import { SelectMulti } from './SelectMulti.js';

describe('SelectMulti (render smoke)', () => {
  test('exports a callable component', () => {
    expect(SelectMulti).toBeDefined();
    expect(() => <SelectMulti />).not.toThrow();
  });
});
