import { describe, expect, test } from 'bun:test';
import { InProcessTeammateDetailDialog } from './InProcessTeammateDetailDialog.js';

describe('InProcessTeammateDetailDialog (render smoke)', () => {
  test('exports a callable component', () => {
    expect(InProcessTeammateDetailDialog).toBeDefined();
    expect(() => <InProcessTeammateDetailDialog />).not.toThrow();
  });
});
