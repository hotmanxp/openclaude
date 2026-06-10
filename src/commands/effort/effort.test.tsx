import { describe, expect, test, beforeEach, mock, afterEach } from 'bun:test';
import * as M from './effort.js';
import { executeEffort, setEffortValue } from './effort.js';

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
    mock.module('../../utils/settings/settings.js', () => ({
      updateSettingsForSource: (_src: string, _patch: any) => ({ error: null }),
    }));
    return import(`./effort.tsx?ts=${Date.now()}-${Math.random()}`).then(mod => {
      const result = mod.executeEffort('ultracode');
      expect(result.message).toContain('xhigh');
      expect(result.message).toContain('ultracode');
      expect(result.effortUpdate?.value).toBe('ultracode');
    });
  });

  test('setEffortValue("ultracode") flips settings.ultracode to true', () => {
    let capturedPatch: any = null;
    mock.module('../../utils/settings/settings.js', () => ({
      updateSettingsForSource: (_src: string, patch: any) => {
        capturedPatch = patch;
        return { error: null };
      },
    }));
    return import(`./effort.tsx?ts=${Date.now()}-${Math.random()}`).then(mod => {
      const result = mod.setEffortValue('ultracode');
      expect(capturedPatch).toEqual({ ultracode: true });
      expect(result.effortUpdate?.value).toBe('ultracode');
    });
  });

  test('setEffortValue("ultracode") message includes xhigh + workflow orchestration', () => {
    mock.module('../../utils/settings/settings.js', () => ({
      updateSettingsForSource: () => ({ error: null }),
    }));
    return import(`./effort.tsx?ts=${Date.now()}-${Math.random()}`).then(mod => {
      const result = mod.setEffortValue('ultracode');
      expect(result.message).toContain('xhigh');
      expect(result.message.toLowerCase()).toContain('workflow');
    });
  });

  test('setEffortValue("ultracode") returns a user-facing error when settings write fails', () => {
    mock.module('../../utils/settings/settings.js', () => ({
      updateSettingsForSource: () => ({ error: new Error('disk full') }),
    }));
    return import(`./effort.tsx?ts=${Date.now()}-${Math.random()}`).then(mod => {
      const result = mod.setEffortValue('ultracode');
      expect(result.message).toContain('disk full');
      expect(result.effortUpdate).toBeUndefined();
    });
  });
});
