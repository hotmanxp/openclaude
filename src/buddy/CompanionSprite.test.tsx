import { describe, expect, test } from 'bun:test';
import { CompanionSprite } from './CompanionSprite.js';

describe('CompanionSprite (render smoke)', () => {
  test('exports a callable component', () => {
    expect(CompanionSprite).toBeDefined();
    expect(() => <CompanionSprite />).not.toThrow();
  });
});
