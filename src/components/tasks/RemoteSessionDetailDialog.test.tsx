import { describe, expect, test } from 'bun:test';
import { RemoteSessionDetailDialog } from './RemoteSessionDetailDialog.js';

describe('RemoteSessionDetailDialog (render smoke)', () => {
  test('exports a callable component', () => {
    expect(RemoteSessionDetailDialog).toBeDefined();
    expect(() => <RemoteSessionDetailDialog />).not.toThrow();
  });
});
