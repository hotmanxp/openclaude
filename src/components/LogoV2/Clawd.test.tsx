import { describe, expect, test } from 'bun:test';
import { Clawd } from './Clawd.js';

describe('Clawd (render smoke)', () => {
  test('exports a callable component', () => {
    expect(Clawd).toBeDefined();
    expect(() => <Clawd />).not.toThrow();
  });
});
