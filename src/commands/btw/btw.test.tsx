import { describe, expect, test } from 'bun:test';
import { BtwSideQuestion } from './btw.js';

describe('btw (render smoke)', () => {
  test('exports a callable component', () => {
    expect(BtwSideQuestion).toBeDefined();
    expect(() => BtwSideQuestion({})).not.toThrow();
  });
});
