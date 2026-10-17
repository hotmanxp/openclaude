import { describe, expect, test } from 'bun:test';

import { BackgroundTasksDialog } from './BackgroundTasksDialog.js';

/**
 * cx-r01: this file used to carry a skipped placeholder whose comment read
 * "module loads without error (skipped: MonitorMcpDetailDialog.js was
 * deleted)". The module did NOT load without error — the static import could
 * not be resolved by anything except scripts/build.ts's stub plugin. Now that
 * the dead import is gone the smoke test can actually assert what it says.
 *
 * This is a load-time guard, not a rendering test: the regression it catches is
 * "this file grew a static import of a module that does not exist", which no
 * behavioural assertion would notice.
 */
describe('BackgroundTasksDialog (import smoke)', () => {
  test('module loads without error', () => {
    expect(typeof BackgroundTasksDialog).toBe('function');
  });
});
