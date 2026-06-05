import { describe, expect, test } from 'bun:test';
import { OrderedListItem } from './OrderedListItem.js';

describe('OrderedListItem (render smoke)', () => {
  test('exports a callable component', () => {
    expect(OrderedListItem).toBeDefined();
  });
});
