import { describe, expect, test } from 'bun:test';
import { HooksConfigMenu } from './HooksConfigMenu.js';

describe('HooksConfigMenu (render smoke)', () => {
  test('exports a callable component', () => {
    expect(HooksConfigMenu).toBeDefined();
    expect(() => <HooksConfigMenu />).not.toThrow();
  });
});
