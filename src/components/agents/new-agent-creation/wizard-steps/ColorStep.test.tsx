import { describe, expect, test } from 'bun:test';
import { ColorStep } from './ColorStep.js';

describe('ColorStep (render smoke)', () => {
  test('exports a callable component', () => {
    expect(ColorStep).toBeDefined();
    expect(() => <ColorStep />).not.toThrow();
  });
});
