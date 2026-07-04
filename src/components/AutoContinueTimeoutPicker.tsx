// @ts-nocheck
import { c as _c } from "react-compiler-runtime";
import figures from 'figures';
import React, { useState } from 'react';
import { Box, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import TextInput from './TextInput.js';

type Props = {
  initialValueSec: string;
  onComplete: (valueSec: string) => void;
  onCancel: () => void;
};

export function AutoContinueTimeoutPicker(t0) {
  const $ = _c(14);
  const {
    initialValueSec,
    onComplete,
    onCancel
  } = t0;
  const [value, setValue] = useState(initialValueSec);
  const [cursorOffset, setCursorOffset] = useState(initialValueSec.length);
  let t1;
  if ($[0] === Symbol.for('react.memo_cache_sentinel')) {
    t1 = { context: 'Settings' };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  useKeybinding('confirm:no', onCancel, t1);
  let t2;
  if ($[1] !== value || $[2] !== onComplete) {
    t2 = function handleSubmit() {
      const trimmed = value.trim();
      const n = Number(trimmed);
      if (trimmed === '' || (!Number.isInteger(n) || n < 0)) {
        onComplete('0');
      } else {
        onComplete(String(n));
      }
    };
    $[1] = value;
    $[2] = onComplete;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const handleSubmit = t2;
  let t3;
  if ($[4] === Symbol.for('react.memo_cache_sentinel')) {
    t3 = (
      <Text>
        Seconds before an unanswered AskUserQuestion dialog auto-submits with default answers. Set to 0 to disable.
      </Text>
    );
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] === Symbol.for('react.memo_cache_sentinel')) {
    t4 = <Text>{figures.pointer}</Text>;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  const t5 = value;
  let t6;
  if ($[6] !== handleSubmit || $[7] !== setValue || $[8] !== cursorOffset || $[9] !== setCursorOffset || $[10] !== t5) {
    t6 = (
      <TextInput
        value={t5}
        onChange={setValue}
        onSubmit={handleSubmit}
        cursorOffset={cursorOffset}
        onChangeCursorOffset={setCursorOffset}
        placeholder="0"
      />
    );
    $[6] = handleSubmit;
    $[7] = setValue;
    $[8] = cursorOffset;
    $[9] = setCursorOffset;
    $[10] = t5;
  } else {
    t6 = $[11];
  }
  let t7;
  if ($[12] === Symbol.for('react.memo_cache_sentinel')) {
    t7 = (
      <Text dimColor>
        Examples: 0 (disabled), 30, 60, 120, 300.
      </Text>
    );
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  if ($[13] === Symbol.for('react.memo_cache_sentinel')) {
    $[13] = (
      <Box flexDirection="column">
        {t3}
        <Box marginTop={1}>{t4} {t6}</Box>
        <Box marginTop={1}>{t7}</Box>
      </Box>
    );
  }
  return $[13];
}