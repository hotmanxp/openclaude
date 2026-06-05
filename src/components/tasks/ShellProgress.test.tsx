import { describe, expect, test } from 'bun:test';
import { ShellProgress } from './ShellProgress.js';

describe('ShellProgress (render smoke)', () => {
  test('exports a callable component', () => {
    expect(ShellProgress).toBeDefined();
    expect(() => <ShellProgress />).not.toThrow();
  });
});
