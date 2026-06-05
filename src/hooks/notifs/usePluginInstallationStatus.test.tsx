import { describe, expect, test } from 'bun:test';
import * as M from './usePluginInstallationStatus.js';

describe('usePluginInstallationStatus (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
