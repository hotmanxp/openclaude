import { describe, expect, test } from 'bun:test';
import { General } from './General.js';

describe('General (render smoke)', () => {
  test('exports a callable component', () => {
    expect(General).toBeDefined();
    expect(() => <General />).not.toThrow();
  });
});
