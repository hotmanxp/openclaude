import { describe, expect, test } from 'bun:test';
import { SelectInputOption } from './select-input-option.js';

describe('select-input-option (render smoke)', () => {
  test('exports a callable component', () => {
    expect(SelectInputOption).toBeDefined();
    expect(() => <SelectInputOption />).not.toThrow();
  });
});
