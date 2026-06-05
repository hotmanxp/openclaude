import { describe, expect, test } from 'bun:test';
import * as M from './useFastModeNotification.js';

describe('useFastModeNotification (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
