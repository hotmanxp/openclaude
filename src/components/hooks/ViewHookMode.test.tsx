import { describe, expect, test } from 'bun:test';
import { ViewHookMode } from './ViewHookMode.js';

describe('ViewHookMode (render smoke)', () => {
  test('exports a callable component', () => {
    expect(ViewHookMode).toBeDefined();
    expect(() => <ViewHookMode />).not.toThrow();
  });
});
