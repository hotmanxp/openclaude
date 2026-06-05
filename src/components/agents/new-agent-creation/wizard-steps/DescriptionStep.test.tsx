import { describe, expect, test } from 'bun:test';
import { DescriptionStep } from './DescriptionStep.js';

describe('DescriptionStep (render smoke)', () => {
  test('exports a callable component', () => {
    expect(DescriptionStep).toBeDefined();
    expect(() => <DescriptionStep />).not.toThrow();
  });
});
