import { describe, expect, test } from 'bun:test';
import { LocationStep } from './LocationStep.js';

describe('LocationStep (render smoke)', () => {
  test('exports a callable component', () => {
    expect(LocationStep).toBeDefined();
    expect(() => <LocationStep />).not.toThrow();
  });
});
