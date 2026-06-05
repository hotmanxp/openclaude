import { describe, expect, test } from 'bun:test';
import { AnimatedClawd } from './AnimatedClawd.js';

describe('AnimatedClawd (render smoke)', () => {
  test('exports a callable component', () => {
    expect(AnimatedClawd).toBeDefined();
    expect(() => <AnimatedClawd />).not.toThrow();
  });
});
