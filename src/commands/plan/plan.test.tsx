import { describe, expect, test } from 'bun:test';
import { PlanDisplay } from './plan.js';

describe('plan (render smoke)', () => {
  test('exports a callable component', () => {
    expect(PlanDisplay).toBeDefined();
    expect(() => PlanDisplay({})).not.toThrow();
  });
});
