import { describe, expect, test } from 'bun:test';
import * as M from './PreviewBox.js';

describe('PreviewBox (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
