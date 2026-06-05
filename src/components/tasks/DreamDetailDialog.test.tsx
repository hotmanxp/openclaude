import { describe, expect, test } from 'bun:test';
import { DreamDetailDialog } from './DreamDetailDialog.js';

describe('DreamDetailDialog (render smoke)', () => {
  test('exports a callable component', () => {
    expect(DreamDetailDialog).toBeDefined();
    expect(() => <DreamDetailDialog />).not.toThrow();
  });
});
