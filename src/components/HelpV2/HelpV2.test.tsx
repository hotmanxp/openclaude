import { describe, expect, test } from 'bun:test';
import { HelpV2 } from './HelpV2.js';

describe('HelpV2 (render smoke)', () => {
  test('exports a callable component', () => {
    expect(HelpV2).toBeDefined();
    expect(() => <HelpV2 />).not.toThrow();
  });
});
