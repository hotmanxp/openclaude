import { describe, expect, test } from 'bun:test';
import { BrowseMarketplace } from './BrowseMarketplace.js';

describe('BrowseMarketplace (render smoke)', () => {
  test('exports a callable component', () => {
    expect(BrowseMarketplace).toBeDefined();
    expect(() => BrowseMarketplace({})).not.toThrow();
  });
});
