import { describe, expect, test } from 'bun:test';
import { ConfirmStep } from './ConfirmStep.js';

describe('ConfirmStep (render smoke)', () => {
  test('exports a callable component', () => {
    expect(ConfirmStep).toBeDefined();
    expect(() => <ConfirmStep />).not.toThrow();
  });
});
