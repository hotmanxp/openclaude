import { describe, expect, test } from 'bun:test';
import { Passes } from './Passes.js';

describe('Passes (render smoke)', () => {
  test('exports a callable component', () => {
    expect(Passes).toBeDefined();
    expect(() => <Passes />).not.toThrow();
  });
});
