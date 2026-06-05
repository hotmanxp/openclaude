import { describe, expect, test } from 'bun:test';
import * as M from './sdkMessageAdapter.js';

describe('sdkMessageAdapter (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
