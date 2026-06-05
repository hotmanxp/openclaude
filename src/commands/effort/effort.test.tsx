import { describe, expect, test } from 'bun:test';
import { EffortPicker } from './effort.js';

describe('effort (render smoke)', () => {
  test('exports a callable component', () => {
    expect(EffortPicker).toBeDefined();
    expect(() => EffortPicker({})).not.toThrow();
  });
});
