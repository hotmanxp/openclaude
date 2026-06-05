import { describe, expect, test } from 'bun:test';
import { GoalDialog } from './GoalDialog.js';

describe('GoalDialog (render smoke)', () => {
  test('exports a callable component', () => {
    expect(GoalDialog).toBeDefined();
    expect(() => <GoalDialog />).not.toThrow();
  });
});
