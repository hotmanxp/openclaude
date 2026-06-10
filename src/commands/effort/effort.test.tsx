import { describe, expect, test, beforeEach, mock, afterEach } from 'bun:test';
import { executeEffort, setEffortValue } from './effort.js';

// Complete mock of `settings.js` — must include EVERY export the production
// code (directly or transitively) imports, otherwise a downstream test file
// that loads `effort.tsx` (which imports `AppStateStore → settings.js`) will
// fail with `Export named 'X' not found in module .../settings/settings.ts`.
//
// bun's `mock.module()` registers globally for the entire test process; the
// partial mock leaks across test files and is not cleared by `mock.restore()`.
function makeCompleteSettingsMock(overrides: Record<string, unknown> = {}) {
  return {
    getInitialSettings: () => ({}),
    getSettingsForSource: () => null,
    getSettingsWithErrors: () => ({ settings: {}, errors: [] }),
    getSettings_DEPRECATED: () => ({}),
    updateSettingsForSource: () => ({ error: null }),
    getSettingsWithSources: () => ({ effective: {}, sources: [] }),
    getSettingsFilePathForSource: () => undefined,
    getRelativeSettingsFilePathForSource: () => '',
    getSettingsRootPathForSource: () => '/',
    hasAutoModeOptIn: () => false,
    hasSkipDangerousModePermissionPrompt: () => false,
    hasAllowBypassPermissionsMode: () => false,
    getUseAutoModeDuringPlan: () => true,
    getAutoModeConfig: () => undefined,
    rawSettingsContainsKey: () => false,
    getManagedFileSettingsPresence: () => ({ hasBase: false, hasDropIns: false }),
    getPolicySettingsOrigin: () => null,
    loadManagedFileSettings: () => ({ settings: null, errors: [] }),
    parseSettingsFile: () => ({ settings: null, errors: [] }),
    getManagedSettingsKeysForLogging: () => [],
    settingsMergeCustomizer: () => undefined,
    ...overrides,
  };
}

describe('effort (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});

describe('effort /ultracode', () => {
  beforeEach(() => {
    mock.restore();
  });

  afterEach(() => {
    mock.restore();
  });

  test('executeEffort routes "ultracode" to setEffortValue and returns xhigh-flavored message', () => {
    mock.module(
      '../../utils/settings/settings.js',
      () => makeCompleteSettingsMock({ updateSettingsForSource: (_src: string, _patch: any) => ({ error: null }) }),
    );
    return import(`./effort.tsx?ts=${Date.now()}-${Math.random()}`).then(mod => {
      const result = mod.executeEffort('ultracode');
      expect(result.message).toContain('xhigh');
      expect(result.message).toContain('ultracode');
      expect(result.effortUpdate?.value).toBe('ultracode');
    });
  });

  test('setEffortValue("ultracode") flips settings.ultracode to true', () => {
    let capturedPatch: any = null;
    mock.module(
      '../../utils/settings/settings.js',
      () => makeCompleteSettingsMock({ updateSettingsForSource: (_src: string, patch: any) => {
        capturedPatch = patch;
        return { error: null };
      } }),
    );
    return import(`./effort.tsx?ts=${Date.now()}-${Math.random()}`).then(mod => {
      const result = mod.setEffortValue('ultracode');
      expect(capturedPatch).toEqual({ ultracode: true });
      expect(result.effortUpdate?.value).toBe('ultracode');
    });
  });

  test('setEffortValue("ultracode") message includes xhigh + workflow orchestration', () => {
    mock.module(
      '../../utils/settings/settings.js',
      () => makeCompleteSettingsMock({ updateSettingsForSource: () => ({ error: null }) }),
    );
    return import(`./effort.tsx?ts=${Date.now()}-${Math.random()}`).then(mod => {
      const result = mod.setEffortValue('ultracode');
      expect(result.message).toContain('xhigh');
      expect(result.message.toLowerCase()).toContain('workflow');
    });
  });

  test('setEffortValue("ultracode") returns a user-facing error when settings write fails', () => {
    mock.module(
      '../../utils/settings/settings.js',
      () => makeCompleteSettingsMock({ updateSettingsForSource: () => ({ error: new Error('disk full') }) }),
    );
    return import(`./effort.tsx?ts=${Date.now()}-${Math.random()}`).then(mod => {
      const result = mod.setEffortValue('ultracode');
      expect(result.message).toContain('disk full');
      expect(result.effortUpdate).toBeUndefined();
    });
  });
});
