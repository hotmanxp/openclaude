import { describe, expect, test } from 'bun:test';
import * as M from './BackgroundTasksDialog.js';

describe('BackgroundTasksDialog (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
