import { describe, expect, test } from 'bun:test';
import Box from './Box.js';

describe('Box (render smoke)', () => {
  test('exports a callable component', () => {
    expect(Box).toBeDefined();
    expect(() => <Box />).not.toThrow();
  });
});
