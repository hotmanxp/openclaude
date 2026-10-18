// @ts-nocheck
import { c as _c } from "react-compiler-runtime";
import type { ThinkingBlock, ThinkingBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React from 'react';
import { Box, Text } from '../../ink.js';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { Markdown } from '../Markdown.js';
import { formatDuration } from '../../utils/format.js';
type Props = {
  // Accept either full ThinkingBlock/ThinkingBlockParam or a minimal shape with just type and thinking
  param: ThinkingBlock | ThinkingBlockParam | {
    type: 'thinking';
    thinking: string;
  };
  addMargin: boolean;
  isTranscriptMode: boolean;
  verbose: boolean;
  /** When true, hide this thinking block entirely (used for past thinking in transcript mode) */
  hideInTranscript?: boolean;
  /** Elapsed thinking time in ms, rendered as "Thought for Ns". Omitted when
   *  unknown — persisted thinking blocks carry no duration. */
  durationMs?: number;
};
export function AssistantThinkingMessage(t0) {
  const $ = _c(10);
  const {
    param: t1,
    addMargin: t2,
    isTranscriptMode,
    verbose,
    hideInTranscript: t3,
    durationMs: t4
  } = t0;
  const {
    thinking
  } = t1;
  const addMargin = t2 === undefined ? false : t2;
  const hideInTranscript = t3 === undefined ? false : t3;
  if (!thinking) {
    return null;
  }
  if (hideInTranscript) {
    return null;
  }
  const shouldShowFullThinking = isTranscriptMode || verbose;
  if (!shouldShowFullThinking) {
    const t5 = addMargin ? 1 : 0;
    // Upstream renders "Thought for 2s" and floors the duration at 1s, so a
    // sub-second thought never shows as "0ms".
    const duration = t4 === undefined ? null : formatDuration(Math.max(1000, t4));
    let t6;
    if ($[0] === Symbol.for("react.memo_cache_sentinel") || $[1] !== duration) {
      t6 = <Text dimColor={true} italic={true}>{"\u2234 Thought"}{duration !== null && ` for ${duration}`} <CtrlOToExpand /></Text>;
      $[0] = t6;
      $[1] = duration;
    } else {
      t6 = $[0];
    }
    let t7;
    if ($[2] !== t5) {
      t7 = <Box marginTop={t5}>{t6}</Box>;
      $[2] = t5;
      $[3] = t7;
    } else {
      t7 = $[3];
    }
    return t7;
  }
  const t5 = addMargin ? 1 : 0;
  let t6;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Text dimColor={true} italic={true}>{"\u2234 Thinking"}…</Text>;
    $[4] = t6;
  } else {
    t6 = $[4];
  }
  let t7;
  if ($[5] !== thinking) {
    t7 = <Box paddingLeft={2}><Markdown dimColor={true}>{thinking}</Markdown></Box>;
    $[5] = thinking;
    $[6] = t7;
  } else {
    t7 = $[6];
  }
  let t8;
  if ($[7] !== t5 || $[8] !== t7) {
    t8 = <Box flexDirection="column" gap={1} marginTop={t5} width="100%">{t6}{t7}</Box>;
    $[7] = t5;
    $[8] = t7;
    $[9] = t8;
  } else {
    t8 = $[9];
  }
  return t8;
}
