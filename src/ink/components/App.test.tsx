import { describe, expect, test } from 'bun:test';
import * as M from './App.js';

describe('App (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
