import { describe, expect, test } from 'bun:test';
import { DiffDialog } from './DiffDialog.js';

describe('DiffDialog (render smoke)', () => {
  test('exports a callable component', () => {
    expect(DiffDialog).toBeDefined();
    expect(() => <DiffDialog />).not.toThrow();
  });
});
