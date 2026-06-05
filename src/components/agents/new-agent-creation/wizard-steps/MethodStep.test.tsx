import { describe, expect, test } from 'bun:test';
import { MethodStep } from './MethodStep.js';

describe('MethodStep (render smoke)', () => {
  test('exports a callable component', () => {
    expect(MethodStep).toBeDefined();
    expect(() => <MethodStep />).not.toThrow();
  });
});
