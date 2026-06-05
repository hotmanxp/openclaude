import { describe, expect, test } from 'bun:test';
import { OrderedList } from './OrderedList.js';

describe('OrderedList (render smoke)', () => {
  test('exports a callable component', () => {
    expect(OrderedList).toBeDefined();
  });
});
