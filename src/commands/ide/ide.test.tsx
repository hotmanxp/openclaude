import { describe, expect, test } from 'bun:test';
import { IDEScreen } from './ide.js';

describe('ide (render smoke)', () => {
  test('exports a callable component', () => {
    expect(IDEScreen).toBeDefined();
    expect(() => IDEScreen({})).not.toThrow();
  });
});
