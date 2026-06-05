import { describe, expect, test } from 'bun:test';
import { Commands } from './Commands.js';

describe('Commands (render smoke)', () => {
  test('exports a callable component', () => {
    expect(Commands).toBeDefined();
    expect(() => <Commands />).not.toThrow();
  });
});
