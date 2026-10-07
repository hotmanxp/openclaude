// @ts-nocheck
import { c as _c } from "react-compiler-runtime";
import figures from 'figures';
import React, { useCallback, useState } from 'react';
import { Dialog } from '../../components/design-system/Dialog.js';
import { stringWidth } from '../../ink/stringWidth.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw text input for config dialog
import { Box, Text, useInput } from '../../ink.js';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import type { PluginOptionSchema, PluginOptionValues } from '../../utils/plugins/pluginOptionsStorage.js';

/**
 * Build the onSave payload from collected string inputs.
 *
 * Sensitive fields are never prepopulated in the text buffer (security), so
 * by the time the user reaches the last field every sensitive field they
 * stepped through contains '' in collected. To avoid silently wiping saved
 * secrets on reconfigure: if a sensitive field is '' AND initialValues has
 * a value for it, OMIT the key entirely. savePluginOptions only writes keys
 * it receives, so omitting = keep existing.
 *
 * Exported for unit testing.
 */
export function buildFinalValues(fields: string[], collected: Record<string, string>, configSchema: PluginOptionSchema, initialValues: PluginOptionValues | undefined): PluginOptionValues {
  const finalValues: PluginOptionValues = {};
  for (const fieldKey of fields) {
    const schema = configSchema[fieldKey];
    const value = collected[fieldKey] ?? '';
    if (schema?.sensitive === true && value === '' && initialValues?.[fieldKey] !== undefined) {
      continue;
    }
    if (schema?.type === 'number') {
      // Number('') returns 0, not NaN — omit blank number inputs so
      // validateUserConfig's required check actually catches them.
      if (value.trim() === '') continue;
      const num = Number(value);
      finalValues[fieldKey] = Number.isNaN(num) ? value : num;
    } else if (schema?.type === 'boolean') {
      finalValues[fieldKey] = isEnvTruthy(value);
    } else {
      finalValues[fieldKey] = value;
    }
  }
  return finalValues;
}
/**
 * A field is a CHOICE when its schema pins an accepted value set (`options`).
 *
 * Upstream models this as `"type": "string"` plus `"options": [...]` — not a
 * distinct enum type — so `type` stays `string` and the dialog swaps the
 * free-text box for a ←/→ cycler. See cc-plugin-agents-md's
 * `userConfig.instructionFiles`.
 */
export function getChoiceOptions(schema) {
  const options = schema?.options;
  return Array.isArray(options) && options.length > 0 ? options : undefined;
}

/**
 * The value a choice field should start on: the saved value if it is still
 * legal, else the schema default, else the first option. Never returns a
 * value the cycler cannot reach, and never `undefined` — a choice field with
 * no selection would render blank while claiming to be a single pick.
 *
 * Exported for unit testing.
 */
export function resolveInitialChoice(schema, savedValue) {
  const options = getChoiceOptions(schema);
  if (!options) return undefined;
  if (typeof savedValue === 'string' && options.includes(savedValue)) return savedValue;
  if (typeof schema?.default === 'string' && options.includes(schema.default)) return schema.default;
  return options[0];
}

/**
 * Step a choice field by `delta`, wrapping at both ends. Wrapping (rather
 * than clamping) is what makes ←/→ feel like a cycler; clamping leaves the
 * key looking broken at the first and last option.
 *
 * Exported for unit testing.
 */
export function cycleChoice(options, current, delta) {
  const index = options.indexOf(current);
  const from = index === -1 ? 0 : index;
  const next = (from + delta + options.length) % options.length;
  return options[next];
}
type Props = {
  title: string;
  subtitle: string;
  configSchema: PluginOptionSchema;
  /** Pre-fill fields when reconfiguring. Sensitive fields are not prepopulated. */
  initialValues?: PluginOptionValues;
  onSave: (config: PluginOptionValues) => void;
  onCancel: () => void;
};
export function PluginOptionsDialog(t0) {
  const $ = _c(70);
  const {
    title,
    subtitle,
    configSchema,
    initialValues,
    onSave,
    onCancel
  } = t0;
  let t1;
  if ($[0] !== configSchema) {
    t1 = Object.keys(configSchema);
    $[0] = configSchema;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const fields = t1;
  let t2;
  if ($[2] !== configSchema || $[3] !== initialValues) {
    t2 = key => {
      const schema_0 = configSchema[key];
      // Choice fields resolve to a legal member of their set, so the box is
      // never blank and never shows a value the cycler can't return to.
      const choice = resolveInitialChoice(schema_0, initialValues?.[key]);
      if (choice !== undefined) return choice;
      if (schema_0?.sensitive === true) {
        return "";
      }
      const v = initialValues?.[key];
      return v === undefined ? "" : String(v);
    };
    $[2] = configSchema;
    $[3] = initialValues;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const initialFor = t2;
  const [currentFieldIndex, setCurrentFieldIndex] = useState(0);
  let t3;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = {};
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  const [values, setValues] = useState(t3);
  let t4;
  if ($[6] !== fields[0] || $[7] !== initialFor) {
    t4 = () => fields[0] ? initialFor(fields[0]) : "";
    $[6] = fields[0];
    $[7] = initialFor;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  const [currentInput, setCurrentInput] = useState(t4);
  const currentField = fields[currentFieldIndex];
  const fieldSchema = currentField ? configSchema[currentField] : null;
  let t5;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = {
      context: "Settings"
    };
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  useKeybinding("confirm:no", onCancel, t5);
  let t6;
  if ($[10] !== currentField || $[11] !== currentFieldIndex || $[12] !== currentInput || $[13] !== fields || $[14] !== initialFor) {
    t6 = () => {
      if (currentFieldIndex < fields.length - 1 && currentField) {
        setValues(prev => ({
          ...prev,
          [currentField]: currentInput
        }));
        setCurrentFieldIndex(_temp);
        const nextKey = fields[currentFieldIndex + 1];
        setCurrentInput(nextKey ? initialFor(nextKey) : "");
      }
    };
    $[10] = currentField;
    $[11] = currentFieldIndex;
    $[12] = currentInput;
    $[13] = fields;
    $[14] = initialFor;
    $[15] = t6;
  } else {
    t6 = $[15];
  }
  const handleNextField = t6;
  let t7;
  if ($[16] !== configSchema || $[17] !== currentField || $[18] !== currentFieldIndex || $[19] !== currentInput || $[20] !== fields || $[21] !== initialFor || $[22] !== initialValues || $[23] !== onSave || $[24] !== values) {
    t7 = () => {
      if (!currentField) {
        return;
      }
      const newValues = {
        ...values,
        [currentField]: currentInput
      };
      if (currentFieldIndex === fields.length - 1) {
        onSave(buildFinalValues(fields, newValues, configSchema, initialValues));
      } else {
        setValues(newValues);
        setCurrentFieldIndex(_temp2);
        const nextKey_0 = fields[currentFieldIndex + 1];
        setCurrentInput(nextKey_0 ? initialFor(nextKey_0) : "");
      }
    };
    $[16] = configSchema;
    $[17] = currentField;
    $[18] = currentFieldIndex;
    $[19] = currentInput;
    $[20] = fields;
    $[21] = initialFor;
    $[22] = initialValues;
    $[23] = onSave;
    $[24] = values;
    $[25] = t7;
  } else {
    t7 = $[25];
  }
  const handleConfirm = t7;
  let t8;
  if ($[26] !== handleConfirm || $[27] !== handleNextField) {
    t8 = {
      "confirm:nextField": handleNextField,
      "confirm:yes": handleConfirm
    };
    $[26] = handleConfirm;
    $[27] = handleNextField;
    $[28] = t8;
  } else {
    t8 = $[28];
  }
  let t9;
  if ($[29] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = {
      context: "Confirmation"
    };
    $[29] = t9;
  } else {
    t9 = $[29];
  }
  useKeybindings(t8, t9);
  // Left deliberately un-memoized: the handler closes over fieldSchema and
  // currentInput, and threading those through the compiler's positional
  // cache would renumber every later slot in this file. Re-registration per
  // render costs nothing for a dialog this small.
  useInput((char, key_0) => {
    const choiceOptions = getChoiceOptions(fieldSchema);
    if (choiceOptions) {
      // Choice fields take no typed input — the value is whatever the cycler
      // last landed on. Left/right step it; everything that would edit text
      // (backspace, printable chars) is inert.
      if (key_0.leftArrow || key_0.rightArrow) {
        setCurrentInput(cycleChoice(choiceOptions, currentInput, key_0.leftArrow ? -1 : 1));
      }
      return;
    }
    if (key_0.backspace || key_0.delete) {
      setCurrentInput(_temp3);
      return;
    }
    if (char && !key_0.ctrl && !key_0.meta && !key_0.tab && !key_0.return) {
      setCurrentInput(prev_3 => prev_3 + char);
    }
  });
  if (!fieldSchema || !currentField) {
    return null;
  }
  const isSensitive = fieldSchema.sensitive === true;
  const isRequired = fieldSchema.required === true;
  const choiceOptions = getChoiceOptions(fieldSchema);
  let t11;
  if ($[31] !== currentInput || $[32] !== isSensitive) {
    t11 = isSensitive ? "*".repeat(stringWidth(currentInput)) : currentInput;
    $[31] = currentInput;
    $[32] = isSensitive;
    $[33] = t11;
  } else {
    t11 = $[33];
  }
  const displayValue = t11;
  // A constrained string renders as a cycler, not a text box: the arrows on
  // either side are the whole affordance, and without them a user would not
  // know ←/→ does anything.
  const valueNode = choiceOptions ? <Box>
      <Text dimColor={true}>{` ${figures.pointerSmall} `}</Text>
      <Text>{currentInput}</Text>
      <Text dimColor={true}>{` ${figures.pointerSmall} `}</Text>
    </Box> : undefined;
  const t12 = fieldSchema.title || currentField;
  let t13;
  if ($[34] !== isRequired) {
    t13 = isRequired && <Text color="error"> *</Text>;
    $[34] = isRequired;
    $[35] = t13;
  } else {
    t13 = $[35];
  }
  let t14;
  if ($[36] !== t12 || $[37] !== t13) {
    t14 = <Text bold={true}>{t12}{t13}</Text>;
    $[36] = t12;
    $[37] = t13;
    $[38] = t14;
  } else {
    t14 = $[38];
  }
  let t15;
  if ($[39] !== fieldSchema.description) {
    t15 = fieldSchema.description && <Text dimColor={true}>{fieldSchema.description}</Text>;
    $[39] = fieldSchema.description;
    $[40] = t15;
  } else {
    t15 = $[40];
  }
  let t16;
  if ($[41] === Symbol.for("react.memo_cache_sentinel")) {
    t16 = <Text>{figures.pointerSmall} </Text>;
    $[41] = t16;
  } else {
    t16 = $[41];
  }
  let t17;
  if ($[42] !== displayValue) {
    t17 = <Text>{displayValue}</Text>;
    $[42] = displayValue;
    $[43] = t17;
  } else {
    t17 = $[43];
  }
  let t18;
  if ($[44] === Symbol.for("react.memo_cache_sentinel")) {
    t18 = <Text>█</Text>;
    $[44] = t18;
  } else {
    t18 = $[44];
  }
  let t19;
  if ($[45] !== t17 || $[46] !== choiceOptions) {
    // Guarded on choiceOptions (referentially stable, taken straight off the
    // schema) rather than valueNode — a JSX literal is a fresh object every
    // render and would defeat the memo entirely.
    t19 = <Box marginTop={1}>{choiceOptions ? valueNode : <>{t16}{t17}{t18}</>}</Box>;
    $[45] = t17;
    $[46] = choiceOptions;
    $[47] = t19;
  } else {
    t19 = $[47];
  }
  let t20;
  if ($[48] !== t14 || $[49] !== t15 || $[50] !== t19) {
    t20 = <Box flexDirection="column">{t14}{t15}{t19}</Box>;
    $[48] = t14;
    $[49] = t15;
    $[50] = t19;
    $[51] = t20;
  } else {
    t20 = $[51];
  }
  const t21 = currentFieldIndex + 1;
  let t22;
  if ($[52] !== fields.length || $[53] !== t21) {
    t22 = <Text dimColor={true}>Field {t21} of {fields.length}</Text>;
    $[52] = fields.length;
    $[53] = t21;
    $[54] = t22;
  } else {
    t22 = $[54];
  }
  let t23;
  if ($[55] !== currentFieldIndex || $[56] !== fields.length) {
    t23 = currentFieldIndex < fields.length - 1 && <Text dimColor={true}>{choiceOptions ? "Tab: Next field · ←/→: Change value · Enter: Save and continue" : "Tab: Next field · Enter: Save and continue"}</Text>;
    $[55] = currentFieldIndex;
    $[56] = fields.length;
    $[57] = t23;
  } else {
    t23 = $[57];
  }
  let t24;
  if ($[58] !== currentFieldIndex || $[59] !== fields.length || $[60] !== choiceOptions) {
    t24 = currentFieldIndex === fields.length - 1 && <Text dimColor={true}>{choiceOptions ? "Enter: Save configuration · ←/→: Change value" : "Enter: Save configuration"}</Text>;
    $[58] = currentFieldIndex;
    $[59] = fields.length;
    $[60] = choiceOptions;
    $[61] = t24;
  } else {
    t24 = $[61];
  }
  let t25;
  if ($[62] !== t22 || $[63] !== t23 || $[64] !== t24) {
    t25 = <Box flexDirection="column">{t22}{t23}{t24}</Box>;
    $[62] = t22;
    $[63] = t23;
    $[64] = t24;
    $[65] = t25;
  } else {
    t25 = $[65];
  }
  let t26;
  if ($[66] !== onCancel || $[67] !== subtitle || $[68] !== t20 || $[69] !== t25 || $[70] !== title) {
    t26 = <Dialog title={title} subtitle={subtitle} onCancel={onCancel} isCancelActive={false}>{t20}{t25}</Dialog>;
    $[66] = onCancel;
    $[67] = subtitle;
    $[68] = t20;
    $[69] = t25;
    $[70] = title;
    $[71] = t26;
  } else {
    t26 = $[71];
  }
  return t26;
}
function _temp3(prev_2) {
  return prev_2.slice(0, -1);
}
function _temp2(prev_1) {
  return prev_1 + 1;
}
function _temp(prev_0) {
  return prev_0 + 1;
}
