import { describe, expect, test } from 'bun:test';
import { CopyResponse } from './copy.js';

describe('copy (render smoke)', () => {
  test('exports a callable component', () => {
    expect(CopyResponse).toBeDefined();
    expect(() => CopyResponse({})).not.toThrow();
  });
});
