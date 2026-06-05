import { describe, expect, test } from 'bun:test';
import { KeybindingSetup } from './KeybindingProviderSetup.js';

describe('KeybindingProviderSetup (render smoke)', () => {
  test('exports a callable component', () => {
    expect(KeybindingSetup).toBeDefined();
    expect(() => <KeybindingSetup />).not.toThrow();
  });
});
