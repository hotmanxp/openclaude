import { describe, expect, test } from 'bun:test';
import { FastModePicker } from './fast.js';

describe('fast (render smoke)', () => {
  test('exports a callable component', () => {
    expect(FastModePicker).toBeDefined();
    expect(() => FastModePicker({})).not.toThrow();
  });
});
