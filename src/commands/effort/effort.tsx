// @ts-nocheck
import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandOnDone, LocalJSXCommandContext } from '../../types/command.js';
import { type EffortValue, getDisplayedEffortLevel, getEffortEnvOverride, getEffortValueDescription, isEffortLevel, isOpenAIEffortLevel, modelSupportsUltracode, modelUsesOpenAIEffort, openAIEffortToStandard, toPersistableEffort } from '../../utils/effort.js';
import { EffortPicker } from '../../components/EffortPicker.js';
import { getInitialSettings, updateSettingsForSource } from '../../utils/settings/settings.js';
import { isWorkflowsDisabled } from '../../utils/envUtils.js';
import { getMainLoopModel } from '../../utils/model/model.js';
import { isUltracodeActive } from '../../utils/ultracode.js';
import { queueUltracodeReminder } from '../../utils/ultracodeReminder.js';
const COMMON_HELP_ARGS = ['help', '-h', '--help'];
type EffortCommandResult = {
  message: string;
  effortUpdate?: {
    value: EffortValue | undefined;
  };
  /** Meta messages (model-visible, user-hidden) to inject into the current turn. */
  metaMessages?: string[];
};
export function setEffortValue(effortValue: EffortValue): EffortCommandResult {
  // /effort ultracode flips the session-level ultracode toggle (not
  // effortLevel) — ultracode is a session mode, not a persisted tier.
  // The 'ultracode' marker is also returned as effortUpdate.value so the
  // AppState + spinner reflect the current mode.
  if (effortValue === 'ultracode') {
    // Validation 1: workflows must be enabled — ultracode is meaningless
    // without dynamic-workflow orchestration.
    if (isWorkflowsDisabled()) {
      return {
        message: 'Ultracode needs dynamic workflows enabled (see /config). Valid options are: low, medium, high, xhigh, max, auto',
      };
    }
    // Validation 2: model must support ultracode (xhigh effort + opus-4-6
    // family). Surface the model so the user knows what to change to.
    const model = getMainLoopModel();
    if (!modelSupportsUltracode(model)) {
      return {
        message: `Ultracode runs at xhigh effort, which requires an opus-4-6+ family model. Current model: ${model}. Valid options are: low, medium, high, xhigh, max, auto`,
      };
    }
    // Queue the enter reminder (full or short depending on state machine state)
    const metaMessages = queueUltracodeReminder('enter');
    const ultracodeResult = updateSettingsForSource('userSettings', {
      ultracode: true
    });
    if (ultracodeResult.error) {
      return {
        message: `Failed to enable ultracode: ${ultracodeResult.error.message}`
      };
    }
    logEvent('tengu_effort_command', {
      effort: 'ultracode' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    return {
      message: 'Set effort level to ultracode (this session only): xhigh + dynamic workflow orchestration. Workflows are now standing — substantive tasks will use the Workflow tool by default.',
      effortUpdate: {
        value: 'ultracode'
      },
      metaMessages,
    };
  }

  // Non-ultracode effort level: if ultracode was on, emit exit reminder
  // and clear the ultracode session toggle alongside the new effort level.
  let metaMessages: string[] | undefined;
  if (isUltracodeActive()) {
    metaMessages = queueUltracodeReminder('exit');
    updateSettingsForSource('userSettings', { ultracode: false });
  }

  const persistable = toPersistableEffort(effortValue);
  if (persistable !== undefined) {
    const result = updateSettingsForSource('userSettings', {
      effortLevel: persistable
    });
    if (result.error) {
      return {
        message: `Failed to set effort level: ${result.error.message}`
      };
    }
  }
  logEvent('tengu_effort_command', {
    effort: effortValue as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });

  // Env var wins at resolveAppliedEffort time. Only flag it when it actually
  // conflicts — if env matches what the user just asked for, the outcome is
  // the same, so "Set effort to X" is true and the note is noise.
  const envOverride = getEffortEnvOverride();
  if (envOverride !== undefined && envOverride !== effortValue) {
    const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL;
    if (persistable === undefined) {
      return {
        message: `Not applied: CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides effort this session, and ${effortValue} is session-only (nothing saved)`,
        effortUpdate: {
          value: effortValue
        }
      };
    }
    return {
      message: `CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides this session — clear it and ${effortValue} takes over`,
      effortUpdate: {
        value: effortValue
      }
    };
  }
  const description = getEffortValueDescription(effortValue);
  const suffix = persistable !== undefined ? '' : ' (this session only)';
  return {
    message: `Set effort level to ${effortValue}${suffix}: ${description}`,
    effortUpdate: {
      value: effortValue
    },
    metaMessages,
  };
}
export function showCurrentEffort(appStateEffort: EffortValue | undefined, model: string): EffortCommandResult {
  const envOverride = getEffortEnvOverride();
  const effectiveValue = envOverride === null ? undefined : envOverride ?? appStateEffort;
  if (effectiveValue === undefined) {
    const level = getDisplayedEffortLevel(model, appStateEffort);
    return {
      message: `Effort level: auto (currently ${level})`
    };
  }
  const description = getEffortValueDescription(effectiveValue);
  return {
    message: `Current effort level: ${effectiveValue} (${description})`
  };
}
function unsetEffortLevel(): EffortCommandResult {
  // If ultracode was on, emit exit reminder and clear it.
  let metaMessages: string[] | undefined;
  if (isUltracodeActive()) {
    metaMessages = queueUltracodeReminder('exit');
    updateSettingsForSource('userSettings', { ultracode: false });
  }
  const result = updateSettingsForSource('userSettings', {
    effortLevel: undefined
  });
  if (result.error) {
    return {
      message: `Failed to set effort level: ${result.error.message}`
    };
  }
  logEvent('tengu_effort_command', {
    effort: 'auto' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
  // env=auto/unset (null) matches what /effort auto asks for, so only warn
  // when env is pinning a specific level that will keep overriding.
  const envOverride = getEffortEnvOverride();
  if (envOverride !== undefined && envOverride !== null) {
    const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL;
    return {
      message: `Cleared effort from settings, but CLAUDE_CODE_EFFORT_LEVEL=${envRaw} still controls this session`,
      effortUpdate: {
        value: undefined
      }
    };
  }
  return {
    message: 'Effort level set to auto',
    effortUpdate: {
      value: undefined
    },
    metaMessages,
  };
}
export function executeEffort(args: string): EffortCommandResult {
  const normalized = args.toLowerCase();
  if (normalized === 'auto' || normalized === 'unset') {
    return unsetEffortLevel();
  }
  if (isEffortLevel(normalized)) {
    return setEffortValue(normalized);
  }
  if (isOpenAIEffortLevel(normalized)) {
    // Normalize OpenAI-shaped 'xhigh' → standard 'max' so it persists.
    return setEffortValue(openAIEffortToStandard(normalized));
  }
  return {
    message: `Invalid argument: ${args}. Valid options are: low, medium, high, max, xhigh, ultracode, auto`
  };
}
function ShowCurrentEffort(t0) {
  const {
    onDone
  } = t0;
  const effortValue = useAppState(_temp);
  const model = useMainLoopModel();
  const {
    message
  } = showCurrentEffort(effortValue, model);
  onDone(message);
  return null;
}
function _temp(s) {
  return s.effortValue;
}
function ApplyEffortAndClose(t0) {
  const $ = _c(7);
  const {
    result,
    onDone
  } = t0;
  const setAppState = useSetAppState();
  const {
    effortUpdate,
    message,
    metaMessages,
  } = result;
  let t1;
  let t2;
  if ($[0] !== effortUpdate || $[1] !== message || $[2] !== onDone || $[3] !== setAppState || $[4] !== metaMessages) {
    t1 = () => {
      if (effortUpdate) {
        setAppState(prev => ({
          ...prev,
          effortValue: effortUpdate.value
        }));
      }
      if (metaMessages?.length) {
        onDone(message, { metaMessages });
      } else {
        onDone(message);
      }
    };
    t2 = [setAppState, effortUpdate, message, onDone, metaMessages];
    $[0] = effortUpdate;
    $[1] = message;
    $[2] = onDone;
    $[3] = setAppState;
    $[4] = metaMessages;
    $[5] = t1;
    $[6] = t2;
  } else {
    t1 = $[5];
    t2 = $[6];
  }
  React.useEffect(t1, t2);
  return null;
}
export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  args = args?.trim() || '';
  if (COMMON_HELP_ARGS.includes(args)) {
    onDone('Usage: /effort [low|medium|high|max|xhigh|ultracode|auto]\n\nEffort levels:\n- low: Quick, straightforward implementation\n- medium: Balanced approach with standard testing\n- high: Comprehensive implementation with extensive testing\n- max: Maximum capability with deepest reasoning (Opus 4.6 only)\n- xhigh: Extra-high reasoning for OpenAI/Codex models (alias for max)\n- ultracode: xhigh + dynamic-workflow orchestration (session only)\n- auto: Use the default effort level for your model');
    return;
  }
  if (args === 'current' || args === 'status') {
    return <ShowCurrentEffort onDone={onDone} />;
  }
  if (!args) {
    return <EffortPickerWrapper onDone={onDone} />;
  }
  const result = executeEffort(args);
  return <ApplyEffortAndClose result={result} onDone={onDone} />;
}

function EffortPickerWrapper({ onDone }: { onDone: LocalJSXCommandOnDone }) {
  const setAppState = useSetAppState();
  const model = useMainLoopModel();
  const usesOpenAIEffort = modelUsesOpenAIEffort(model);

  function handleSelect(effort: EffortValue | undefined) {
    // Ultracode path: use setEffortValue to get enter meta messages
    if (effort === 'ultracode') {
      const result = setEffortValue('ultracode');
      setAppState(prev => ({
        ...prev,
        effortValue: 'ultracode'
      }));
      if (result.metaMessages?.length) {
        onDone(result.message, { metaMessages: result.metaMessages });
      } else {
        onDone(result.message);
      }
      return;
    }

    // Non-ultracode: if ultracode was on, emit exit and clear it
    const persistable = toPersistableEffort(effort);
    let metaMessages: string[] | undefined;
    if (isUltracodeActive()) {
      metaMessages = queueUltracodeReminder('exit');
    }
    // Skip writing effortLevel if persistable is undefined (numeric values,
    // which the picker doesn't surface, but guard defensively)
    if (persistable !== undefined) {
      updateSettingsForSource('userSettings', {
        effortLevel: persistable,
        // Clear ultracode if it was active (exit path)
        ...(metaMessages ? { ultracode: false } : {}),
      });
    }
    logEvent('tengu_effort_command', {
      effort: (effort ?? 'auto') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    setAppState(prev => ({
      ...prev,
      effortValue: effort
    }));
    const description = effort ? getEffortValueDescription(effort) : 'Use default effort level for your model';
    const suffix = persistable !== undefined ? '' : ' (this session only)';
    if (metaMessages?.length) {
      onDone(`Set effort level to ${effort ?? 'auto'}${suffix}: ${description}`, { metaMessages });
    } else {
      onDone(`Set effort level to ${effort ?? 'auto'}${suffix}: ${description}`);
    }
  }

  function handleCancel() {
    onDone('Cancelled');
  }

  return <EffortPicker onSelect={handleSelect} onCancel={handleCancel} />;
}
