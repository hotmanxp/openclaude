import { describe, expect, test } from 'bun:test';
import { KeybindingProvider } from './KeybindingContext.js';

describe('KeybindingContext (render smoke)', () => {
  test('exports a callable component', () => {
    expect(KeybindingProvider).toBeDefined();
    expect(() => <KeybindingProvider />).not.toThrow();
  });
});
