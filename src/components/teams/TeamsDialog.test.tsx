import { describe, expect, test } from 'bun:test';
import * as M from './TeamsDialog.js';

describe('TeamsDialog (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
