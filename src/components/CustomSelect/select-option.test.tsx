import { describe, expect, test } from 'bun:test';
import { SelectOption } from './select-option.js';

describe('select-option (render smoke)', () => {
  test('exports a callable component', () => {
    expect(SelectOption).toBeDefined();
    expect(() => <SelectOption />).not.toThrow();
  });
});
