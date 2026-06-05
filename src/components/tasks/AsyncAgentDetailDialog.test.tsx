import { describe, expect, test } from 'bun:test';
import { AsyncAgentDetailDialog } from './AsyncAgentDetailDialog.js';

describe('AsyncAgentDetailDialog (render smoke)', () => {
  test('exports a callable component', () => {
    expect(AsyncAgentDetailDialog).toBeDefined();
    expect(() => <AsyncAgentDetailDialog />).not.toThrow();
  });
});
