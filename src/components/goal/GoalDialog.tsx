// @ts-nocheck
import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import type { CommandResultDisplay } from '../../commands.js';
import { Dialog } from '../design-system/Dialog.js';
type Props = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
export function GoalDialog(t0) {
  const $ = _c(8);
  const {
    onDone
  } = t0;
  const goalState = useAppState(s => s.goalState);
  let t1;
  if ($[0] !== goalState) {
    t1 = goalState?.status === 'active' ? <Box flexDirection="column" gap={1}><Text>Condition: <Text bold={true}>{goalState.condition}</Text></Text><Text dimColor={true}>Rounds: {goalState.roundCount}{goalState.maxRounds ? `/${goalState.maxRounds}` : ''}</Text></Box> : <Text>No goal set</Text>;
    $[0] = goalState;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const statusContent = t1;
  let t2;
  if ($[2] !== goalState) {
    t2 = goalState?.status === 'active' ? <Text dimColor={true}>/goal &lt;condition&gt; to set a new goal</Text> : <Text dimColor={true}>/goal &lt;condition&gt; to set one</Text>;
    $[2] = goalState;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const hintText = t2;
  let t3;
  if ($[4] !== onDone) {
    t3 = function handleCancel() {
      onDone("Goal dialog dismissed", {
        display: "system"
      });
    };
    $[4] = onDone;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  const handleCancel = t3;
  let t4;
  if ($[6] !== statusContent || $[7] !== hintText) {
    t4 = <Box flexDirection="column" gap={1}>{statusContent}{hintText}</Box>;
    $[6] = statusContent;
    $[7] = hintText;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  const content = t4;
  let t5;
  if ($[9] !== handleCancel || $[10] !== content) {
    t5 = <Dialog title="Goal" onCancel={handleCancel} color="foreground">{content}</Dialog>;
    $[9] = handleCancel;
    $[10] = content;
    $[11] = t5;
  } else {
    t5 = $[11];
  }
  return t5;
}