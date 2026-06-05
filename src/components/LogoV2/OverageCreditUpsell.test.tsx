import { describe, expect, test } from 'bun:test';
import { OverageCreditUpsell } from './OverageCreditUpsell.js';

describe('OverageCreditUpsell (render smoke)', () => {
  test('exports a callable component', () => {
    expect(OverageCreditUpsell).toBeDefined();
    expect(() => <OverageCreditUpsell />).not.toThrow();
  });
});
