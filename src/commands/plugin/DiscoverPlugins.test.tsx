import { describe, expect, test } from 'bun:test';
import { DiscoverPlugins } from './DiscoverPlugins.js';

describe('DiscoverPlugins (render smoke)', () => {
  test('exports a callable component', () => {
    expect(DiscoverPlugins).toBeDefined();
    expect(() => DiscoverPlugins({})).not.toThrow();
  });
});
