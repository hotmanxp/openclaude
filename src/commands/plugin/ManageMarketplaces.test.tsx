import { describe, expect, test } from 'bun:test';
import { ManageMarketplaces } from './ManageMarketplaces.js';

describe('ManageMarketplaces (render smoke)', () => {
  test('exports a callable component', () => {
    expect(ManageMarketplaces).toBeDefined();
    expect(() => ManageMarketplaces({})).not.toThrow();
  });
});
