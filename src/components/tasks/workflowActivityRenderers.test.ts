import { describe, expect, test } from 'bun:test';
import { formatDuration, formatAgentSummary, formatTokenCount, buildTerminalStatusLine } from './workflowActivityRenderers.js';

describe('formatDuration (ported from upstream y7)', () => {
  test('returns "Ns" for sub-minute', () => {
    expect(formatDuration(5_000)).toBe('5s');
    expect(formatDuration(59_000)).toBe('59s');
  });
  test('returns "NmMs" for sub-hour', () => {
    expect(formatDuration(60_000)).toBe('1m0s');
    expect(formatDuration(125_000)).toBe('2m5s');
  });
  test('returns "NhMm" for hour+', () => {
    expect(formatDuration(3_600_000)).toBe('1h0m');
    expect(formatDuration(3_900_000)).toBe('1h5m');
  });
});

describe('formatAgentSummary (ported from upstream)', () => {
  test('uses singular for 1', () => {
    expect(formatAgentSummary(1)).toBe('1 agent');
  });
  test('uses plural for 0/2+', () => {
    expect(formatAgentSummary(0)).toBe('0 agents');
    expect(formatAgentSummary(5)).toBe('5 agents');
  });
});

describe('formatTokenCount (ported from upstream)', () => {
  test('plain for <1000', () => expect(formatTokenCount(500)).toBe('500'));
  test('K for thousands', () => expect(formatTokenCount(1500)).toBe('1.5K'));
  test('M for millions', () => expect(formatTokenCount(1_500_000)).toBe('1.5M'));
});

describe('buildTerminalStatusLine (port of upstream n73 line shape)', () => {
  test('completed shape: "Completed in 12s · 5 agents · 1.2K tokens"', () => {
    expect(buildTerminalStatusLine({ status: 'completed', durationMs: 12_300, agentCount: 5, totalTokens: 1234 }))
      .toBe('Completed in 12s · 5 agents · 1.2K tokens');
  });
  test('failed shape: "Failed in 5s · 2 agents · 100 tokens"', () => {
    expect(buildTerminalStatusLine({ status: 'failed', durationMs: 5_000, agentCount: 2, totalTokens: 100 }))
      .toBe('Failed in 5s · 2 agents · 100 tokens');
  });
  test('killed shape: "Stopped in 1s · 1 agent"', () => {
    expect(buildTerminalStatusLine({ status: 'killed', durationMs: 1_500, agentCount: 1, totalTokens: 0 }))
      .toBe('Stopped in 1s · 1 agent');
  });
});
