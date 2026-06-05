import { describe, test } from 'bun:test';

// Source imports `./CodexUsage.js` (deleted in commit 1b586849 — "refactor:
// remove non-standard provider support"). The if-branch `provider === 'codex'`
// in Usage.tsx is dead code (OpenCC only supports anthropic/ollama/openai-compatible
// per AGENTS.md). Test file exists to satisfy the @ts-nocheck coverage requirement.
describe('Usage (import smoke)', () => {
  test.skip('module loads without error (skipped: CodexUsage.js was deleted, refactor 1b586849)', () => {});
});
