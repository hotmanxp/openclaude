import { describe, expect, test } from 'bun:test';
import { SelectHookMode } from './SelectHookMode.js';

describe('SelectHookMode (render smoke)', () => {
  test('exports a callable component', () => {
    expect(SelectHookMode).toBeDefined();
    expect(() => <SelectHookMode />).not.toThrow();
  });
});
