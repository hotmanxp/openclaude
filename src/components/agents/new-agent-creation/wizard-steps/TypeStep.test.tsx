import { describe, expect, test } from 'bun:test';
import { TypeStep } from './TypeStep.js';

describe('TypeStep (render smoke)', () => {
  test('exports a callable component', () => {
    expect(TypeStep).toBeDefined();
    expect(() => <TypeStep />).not.toThrow();
  });
});
