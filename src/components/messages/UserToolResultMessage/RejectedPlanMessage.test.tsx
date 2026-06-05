import { describe, expect, test } from 'bun:test';
import { RejectedPlanMessage } from './RejectedPlanMessage.js';

describe('RejectedPlanMessage (render smoke)', () => {
  test('exports a callable component', () => {
    expect(RejectedPlanMessage).toBeDefined();
    expect(() => <RejectedPlanMessage plan="" />).not.toThrow();
  });
});
