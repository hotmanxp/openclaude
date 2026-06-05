import { describe, expect, test } from 'bun:test';
import { BridgeToggle } from './bridge.js';

describe('bridge (render smoke)', () => {
  test('exports a callable component', () => {
    expect(BridgeToggle).toBeDefined();
    expect(() => BridgeToggle({})).not.toThrow();
  });
});
