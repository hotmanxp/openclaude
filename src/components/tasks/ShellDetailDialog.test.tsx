import { describe, expect, test } from 'bun:test';
import { ShellDetailDialog } from './ShellDetailDialog.js';

describe('ShellDetailDialog (render smoke)', () => {
  test('exports a callable component', () => {
    expect(ShellDetailDialog).toBeDefined();
    expect(() => <ShellDetailDialog />).not.toThrow();
  });
});
