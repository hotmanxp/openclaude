import { describe, expect, test } from 'bun:test';
import { GuestPassesUpsell } from './GuestPassesUpsell.js';

describe('GuestPassesUpsell (render smoke)', () => {
  test('exports a callable component', () => {
    expect(GuestPassesUpsell).toBeDefined();
    expect(() => <GuestPassesUpsell />).not.toThrow();
  });
});
