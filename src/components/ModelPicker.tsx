// @ts-nocheck
import capitalize from 'lodash-es/capitalize.js';
import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useExitOnCtrlCDWithKeybindings } from 'src/hooks/useExitOnCtrlCDWithKeybindings.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { FAST_MODE_MODEL_DISPLAY, isFastModeAvailable, isFastModeCooldown, isFastModeEnabled } from 'src/utils/fastMode.js';
import { Box, Text } from '../ink.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import { convertEffortValueToLevel, type EffortLevel, getDefaultEffortForModel, modelSupportsEffort, modelSupportsMaxEffort, resolvePickerEffortPersistence, toPersistableEffort } from '../utils/effort.js';
import { getDefaultMainLoopModel, type ModelSetting, modelDisplayString, parseUserSpecifiedModel } from '../utils/model/model.js';
import { getModelPickerOptions, PROVIDER_GROUP_PREFIX, type ModelPickerScope } from '../utils/model/modelOptions.js';
import { getActiveProviderProfile, parseProviderModelTupleKey, providerModelTupleKey } from '../utils/providerProfiles.js';
import { getSettingsForSource, updateSettingsForSource } from '../utils/settings/settings.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/index.js';
import { Byline } from './design-system/Byline.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { Pane } from './design-system/Pane.js';
import { effortLevelToSymbol } from './EffortIndicator.js';
export type Props = {
  initial: string | null;
  sessionModel?: ModelSetting;
  /**
   * `providerId` is set only when the chosen row belongs to a registered
   * provider (all-providers scope); callers should activate that provider so
   * the request routes there and the choice persists.
   */
  onSelect: (model: string | null, effort: EffortLevel | undefined, providerId?: string) => void;
  onCancel?: () => void;
  isStandaloneCommand?: boolean;
  showFastModeNotice?: boolean;
  /** Overrides the dim header line below "Select model". */
  headerText?: string;
  /**
   * When true, skip writing effortLevel to userSettings on selection.
   * Used by the assistant installer wizard where the model choice is
   * project-scoped (written to the assistant's .claude/settings.json via
   * install.ts) and should not leak to the user's global ~/.claude/settings.
   */
  skipSettingsWrite?: boolean;
  /**
   * 'all-providers' (default) merges every registered provider's models into
   * one grouped list keyed by (providerId, model). 'active-only' restricts the
   * list to the active provider — used by pickers that set global model
   * settings (teammate default, compaction) that always run on the current
   * provider.
   */
  scope?: ModelPickerScope;
};
const NO_PREFERENCE = '__NO_PREFERENCE__';
export function ModelPicker(props: Props) {
  const {
    initial,
    sessionModel,
    onSelect,
    onCancel,
    isStandaloneCommand,
    showFastModeNotice,
    headerText,
    skipSettingsWrite,
    scope = 'all-providers'
  } = props;
  const setAppState = useSetAppState();
  const exitState = useExitOnCtrlCDWithKeybindings();
  const isFastMode = useAppState(state => isFastModeEnabled() ? state.fastMode : false);
  const [hasToggledEffort, setHasToggledEffort] = useState(false);
  const effortValue = useAppState(state => state.effortValue);
  const [effort, setEffort] = useState(effortValue !== undefined ? convertEffortValueToLevel(effortValue) : undefined);
  const activeProfile = getActiveProviderProfile();
  const activeProviderId = activeProfile?.id;
  const baseOptions = useMemo(() => getModelPickerOptions(isFastMode ?? false, scope), [isFastMode, scope]);

  // Keep the current selection visible even when it's absent from the merged
  // list (custom --model value, or a model whose provider was deleted).
  const modelOptions = useMemo(() => {
    if (initial === null) {
      return baseOptions;
    }
    const tuple = activeProviderId ? providerModelTupleKey(activeProviderId, initial) : initial;
    const isPresent = baseOptions.some(opt => opt.value === tuple) || baseOptions.some(opt => opt.value === initial) || baseOptions.some(opt => opt.rawModel === initial);
    if (isPresent) {
      return baseOptions;
    }
    return [...baseOptions, {
      value: tuple,
      rawModel: initial,
      providerId: activeProviderId,
      providerName: activeProfile?.name,
      label: modelDisplayString(initial),
      description: '当前模型'
    }];
  }, [baseOptions, initial, activeProviderId, activeProfile?.name]);

  // Group rows by provider with a non-selectable heading per group. The
  // heading carries `disabled: true` so Select refuses to commit it (Enter and
  // number keys are no-ops) while arrow navigation still reaches it.
  const groupedOptions = useMemo(() => {
    const order = [];
    const counts = new Map();
    for (const opt of modelOptions) {
      if (!opt.providerId) {
        continue;
      }
      if (!counts.has(opt.providerId)) {
        order.push({
          id: opt.providerId,
          name: opt.providerName ?? opt.providerId
        });
      }
      counts.set(opt.providerId, (counts.get(opt.providerId) ?? 0) + 1);
    }
    if (order.length === 0) {
      return modelOptions;
    }
    const rows = modelOptions.filter(opt => !opt.providerId);
    for (const group of order) {
      rows.push({
        value: PROVIDER_GROUP_PREFIX + group.id,
        label: group.name,
        description: `共 ${counts.get(group.id)} 个模型`,
        disabled: true
      });
      for (const opt of modelOptions) {
        if (opt.providerId === group.id) {
          rows.push(opt);
        }
      }
    }
    return rows;
  }, [modelOptions]);
  const selectOptions = useMemo(() => groupedOptions.map(opt => ({
    ...opt,
    value: opt.value === null ? NO_PREFERENCE : opt.value
  })), [groupedOptions]);

  // The value the picker treats as "current". Provider rows are identified by
  // the (providerId, model) tuple; bare model names stay in play for built-in
  // rows. When the active provider is unknown we fall back to a unique rawModel
  // match rather than marking a wrong (or every) row.
  const initialValue = useMemo(() => {
    if (initial === null) {
      return NO_PREFERENCE;
    }
    const tuple = activeProviderId ? providerModelTupleKey(activeProviderId, initial) : undefined;
    if (tuple && selectOptions.some(opt => opt.value === tuple)) {
      return tuple;
    }
    if (selectOptions.some(opt => opt.value === initial)) {
      return initial;
    }
    const matches = selectOptions.filter(opt => opt.rawModel === initial);
    return matches.length === 1 ? matches[0].value : initial;
  }, [initial, activeProviderId, selectOptions]);
  const [focusedValue, setFocusedValue] = useState(initialValue);
  const initialFocusValue = selectOptions.some(opt => opt.value === initialValue) ? initialValue : selectOptions[0]?.value ?? undefined;
  const visibleCount = Math.min(10, selectOptions.length);
  const hiddenCount = Math.max(0, selectOptions.length - visibleCount);
  const focusedModelName = selectOptions.find(opt => opt.value === focusedValue)?.label;
  const focusedIsGroup = typeof focusedValue === 'string' && focusedValue.startsWith(PROVIDER_GROUP_PREFIX);
  const focusedModel = resolveOptionModel(focusedValue);
  const focusedSupportsEffort = !focusedIsGroup && focusedModel ? modelSupportsEffort(focusedModel) : false;
  const focusedSupportsMax = focusedModel ? modelSupportsMaxEffort(focusedModel) : false;
  const focusedDefaultEffort = getDefaultEffortLevelForOption(focusedValue);
  const displayEffort = effort === "max" && !focusedSupportsMax ? "high" : effort;
  const handleFocus = useCallback(value => {
    setFocusedValue(value);
    if (!hasToggledEffort && effortValue === undefined) {
      setEffort(getDefaultEffortLevelForOption(value));
    }
  }, [hasToggledEffort, effortValue]);
  const handleCycleEffort = useCallback(direction => {
    if (!focusedSupportsEffort) {
      return;
    }
    setEffort(prev => cycleEffortLevel(prev ?? focusedDefaultEffort, direction, focusedSupportsMax));
    setHasToggledEffort(true);
  }, [focusedSupportsEffort, focusedDefaultEffort, focusedSupportsMax]);
  useKeybindings({
    "modelPicker:decreaseEffort": () => handleCycleEffort("left"),
    "modelPicker:increaseEffort": () => handleCycleEffort("right")
  }, {
    context: "ModelPicker"
  });
  const handleSelect = useCallback(value => {
    logEvent("tengu_model_command_menu_effort", {
      effort: effort as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    if (!skipSettingsWrite) {
      const effortLevel = resolvePickerEffortPersistence(effort, getDefaultEffortLevelForOption(value), getSettingsForSource("userSettings")?.effortLevel, hasToggledEffort);
      const persistable = toPersistableEffort(effortLevel);
      if (persistable !== undefined) {
        updateSettingsForSource("userSettings", {
          effortLevel: persistable
        });
      }
      setAppState(prev => ({
        ...prev,
        effortValue: effortLevel
      }));
    }
    const selectedModel = resolveOptionModel(value);
    const selectedEffort = hasToggledEffort && selectedModel && modelSupportsEffort(selectedModel) ? effort : undefined;
    if (value === NO_PREFERENCE) {
      onSelect(null, selectedEffort);
      return;
    }
    const selectedOption = selectOptions.find(opt => opt.value === value);
    // Provider rows carry a tuple as their value; hand the caller the bare
    // model name plus the provider it belongs to. Built-in rows keep passing
    // their value through unchanged.
    const modelForCallback = selectedOption?.providerId ? (selectedOption.rawModel ?? selectedModel ?? value) : value;
    onSelect(modelForCallback, selectedEffort, selectedOption?.providerId);
  }, [effort, hasToggledEffort, onSelect, setAppState, skipSettingsWrite, selectOptions]);
  const t16 = headerText ?? "在 OpenCC 模型之间切换。适用于当前会话和未来的 OpenCC 会话。对于其他/之前的模型名称，请使用 --model 指定。";
  const content = <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Text color="remember" bold={true}>选择模型</Text>
        <Text dimColor={true}>{t16}</Text>
        {sessionModel && <Text dimColor={true}>当前会话使用 {modelDisplayString(sessionModel)}（由计划模式设置）。选择模型将撤销此设置。</Text>}
      </Box>
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="column">
          <Select defaultValue={initialValue} defaultFocusValue={initialFocusValue} options={selectOptions} onChange={handleSelect} onFocus={handleFocus} onCancel={onCancel ?? (() => {})} visibleOptionCount={visibleCount} />
        </Box>
        {hiddenCount > 0 && <Box paddingLeft={3}><Text dimColor={true}>还有 {hiddenCount} 个…</Text></Box>}
      </Box>
      <Box marginBottom={1} flexDirection="column">
        {focusedIsGroup ? null : focusedSupportsEffort ? <Text dimColor={true}><EffortLevelIndicator effort={displayEffort} />{" "}{capitalize(displayEffort)} 投入度{displayEffort === focusedDefaultEffort ? "（默认）" : ""}{" "}<Text color="subtle">← → 调整</Text></Text> : <Text color="subtle"><EffortLevelIndicator effort={undefined} /> 此模型不支持投入度{focusedModelName ? `（${focusedModelName}）` : ""}</Text>}
      </Box>
      {isFastModeEnabled() ? showFastModeNotice ? <Box marginBottom={1}><Text dimColor={true}>快速模式<Text bold={true}>已开启</Text>，仅适用于 {FAST_MODE_MODEL_DISPLAY}（/fast）。切换到其他模型将关闭快速模式。</Text></Box> : isFastModeAvailable() && !isFastModeCooldown() ? <Box marginBottom={1}><Text dimColor={true}>使用 <Text bold={true}>/fast</Text> 开启快速模式（仅适用于 {FAST_MODE_MODEL_DISPLAY}）。</Text></Box> : null : null}
      {isStandaloneCommand && <Text dimColor={true} italic={true}>{exitState.pending ? <>按 {exitState.keyName} 再次退出</> : <Byline><KeyboardShortcutHint shortcut="Enter" action="确认" /><ConfigurableShortcutHint action="select:cancel" context="Select" fallback="Esc" description="退出" /></Byline>}</Text>}
    </Box>;
  if (!isStandaloneCommand) {
    return content;
  }
  return <Pane color="permission">{content}</Pane>;
}
function resolveOptionModel(value?: string): string | undefined {
  if (!value) return undefined;
  if (value === NO_PREFERENCE) return getDefaultMainLoopModel();
  const { model } = parseProviderModelTupleKey(value);
  return parseUserSpecifiedModel(model);
}
function EffortLevelIndicator(t0) {
  const {
    effort
  } = t0;
  const t1 = effort ? "claude" : "subtle";
  const t2 = effort ?? "low";
  const t3 = effortLevelToSymbol(t2);
  return <Text color={t1}>{t3}</Text>;
}
function cycleEffortLevel(current: EffortLevel, direction: 'left' | 'right', includeMax: boolean): EffortLevel {
  const levels: EffortLevel[] = includeMax ? ['low', 'medium', 'high', 'max'] : ['low', 'medium', 'high'];
  // If the current level isn't in the cycle (e.g. 'max' after switching to a
  // non-Opus model), clamp to 'high'.
  const idx = levels.indexOf(current);
  const currentIndex = idx !== -1 ? idx : levels.indexOf('high');
  if (direction === 'right') {
    return levels[(currentIndex + 1) % levels.length]!;
  } else {
    return levels[(currentIndex - 1 + levels.length) % levels.length]!;
  }
}
function getDefaultEffortLevelForOption(value?: string): EffortLevel {
  const resolved = resolveOptionModel(value) ?? getDefaultMainLoopModel();
  const defaultValue = getDefaultEffortForModel(resolved);
  return defaultValue !== undefined ? convertEffortValueToLevel(defaultValue) : 'high';
}
