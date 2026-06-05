import { describe, expect, test } from 'bun:test';
import * as M from './RemoteSessionDetailDialog.js';

describe('RemoteSessionDetailDialog (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
