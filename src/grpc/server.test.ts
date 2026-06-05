import { describe, expect, test } from 'bun:test';
import * as M from './server.js';

describe('server (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
