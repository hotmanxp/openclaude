import { describe, expect, test } from 'bun:test';
import { SelectEventMode } from './SelectEventMode.js';

describe('SelectEventMode (render smoke)', () => {
  test('exports a callable component', () => {
    expect(SelectEventMode).toBeDefined();
    expect(() => <SelectEventMode />).not.toThrow();
  });
});
