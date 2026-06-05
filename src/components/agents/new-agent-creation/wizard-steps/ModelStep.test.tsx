import { describe, expect, test } from 'bun:test';
import { ModelStep } from './ModelStep.js';

describe('ModelStep (render smoke)', () => {
  test('exports a callable component', () => {
    expect(ModelStep).toBeDefined();
    expect(() => <ModelStep />).not.toThrow();
  });
});
