import { describe, expect, test } from 'bun:test';
import * as M from './usePluginAutoupdateNotification.js';

describe('usePluginAutoupdateNotification (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
