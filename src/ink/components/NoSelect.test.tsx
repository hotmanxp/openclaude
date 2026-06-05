import { describe, expect, test } from 'bun:test';
import { NoSelect } from './NoSelect.js';

describe('NoSelect (render smoke)', () => {
  test('exports a callable component', () => {
    expect(NoSelect).toBeDefined();
    expect(() => <NoSelect />).not.toThrow();
  });
});
