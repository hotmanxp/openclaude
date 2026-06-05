import { describe, expect, test } from 'bun:test';
import * as M from './OutputLine.js';

describe('OutputLine (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
