/**
 * Build the wrapper script that's loaded into node:worker_threads.
 *
 * The wrapper:
 * - Defines a restricted global scope (no require, no process, no globalThis)
 * - Exposes `args`, `spawnSubagent`, `__setMeta`, `phase`, `agent`, `parallel`
 * - Wraps the user script in an async IIFE
 * - Posts results back to main via parentPort.postMessage
 *
 * Static audit: rejects scripts containing forbidden tokens BEFORE returning.
 */
const FORBIDDEN_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /\brequire\s*\(/, name: 'require' },
  { pattern: /\bimport\s+/, name: 'import' },
  { pattern: /\bfrom\s+['"]/, name: 'import' },
  { pattern: /\bprocess\./, name: 'process' },
  { pattern: /\bprocess\[/, name: 'process' },
  { pattern: /\bglobalThis\./, name: 'globalThis' },
  { pattern: /\bglobalThis\[/, name: 'globalThis' },
  { pattern: /\bnew\s+Function\s*\(/, name: 'Function' },
  { pattern: /\beval\s*\(/, name: 'eval' },
  { pattern: /\bBuffer\./, name: 'Buffer' },
]

export function buildWorkerScript(userScript: string): string {
  for (const { pattern, name } of FORBIDDEN_PATTERNS) {
    if (pattern.test(userScript)) {
      throw new Error(
        `[workflow] Script contains forbidden token: ${name}`,
      )
    }
  }

  const cleaned = userScript
    .replace(/export\s+default\s+async\s+function/g, 'async function')
    .replace(/export\s+default\s+function/g, 'function')
    .replace(/export\s+default\s+/g, '')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+(let|var)\s+/g, '$1 ')

  // parentPort must be captured before the require shadow takes effect.
  // The module-level wrapper is trusted code (not user-supplied), so we
  // omit 'use strict' here — it would forbid 'const eval' which we need
  // to shadow. User code inside userScript() is still wrapped in strict.
  return `
const { parentPort } = require('node:worker_threads');

let cancelled = false;
parentPort.on('message', (msg) => {
  if (msg && msg.kind === 'cancel') {
    cancelled = true;
  }
});

function spawnSubagent(prompt, opts) {
  return new Promise((resolve, reject) => {
    const callId = Math.random().toString(36).slice(2);
    const onMessage = (msg) => {
      if (msg && msg.kind === 'spawnSubagentResult' && msg.callId === callId) {
        parentPort.off('message', onMessage);
        if (msg.error) reject(new Error(msg.error));
        else resolve({ agentId: msg.agentId, report: msg.report });
      }
    };
    parentPort.on('message', onMessage);
    parentPort.postMessage({ kind: 'spawnSubagent', callId, prompt, opts });
  });
}

// __setMeta(meta) — declares the workflow's UI-visible metadata. Sent to
// main exactly once, after the user calls it. Drives the phase list in
// WorkflowDetailDialog. Calling it multiple times is harmless (last write
// wins on the main side), but only the first call typically has visible
// effect because main captures the meta at init time.
function __setMeta(meta) {
  if (!meta || typeof meta !== 'object') return;
  parentPort.postMessage({ kind: 'meta', meta });
}

// phase(title) — posts a { kind: 'phase', title } message so the dialog
// can show the current phase in the spinner. Safe to call multiple times.
function phase(title) {
  parentPort.postMessage({ kind: 'phase', title: String(title ?? '') });
}

// agent(prompt, opts) — wraps spawnSubagent and returns a structured
// result so scripts can do \`if (!r.ok) return { aborted: '...', details: r.error }\`.
// Never rejects: errors from spawnSubagent are normalized to
// { ok: false, error } so the call site can pattern-match on ok cleanly.
// The legacy spawnSubagent(prompt, opts) stays unchanged for backward
// compatibility with scripts that destructure { agentId, report }.
// \`label\` is a UI-only field; \`agentType\` is forwarded into SpawnOpts so
// the main-process handler can route through the agent registry when set
// (otherwise the LLM is called directly with the schema prompt).
function agent(prompt, opts) {
  const { label, agentType, ...spawnOpts } = opts || {};
  const finalOpts = agentType ? { ...spawnOpts, agentType } : spawnOpts;
  return spawnSubagent(prompt, finalOpts).then(
    function (r) {
      return { ok: true, agentId: r.agentId, report: r.report, label: label };
    },
    function (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        label: label,
      };
    },
  );
}

// parallel(fns) — Promise.all over an array of thunks. Lets scripts do
// \`const [a, b, c] = await parallel([fn1, fn2, fn3])\`. Does NOT change
// spawnSubagent semantics; results come back in input order regardless
// of completion order. The thunks (not the promises) are passed in so
// the user controls when each call starts — a no-op for simple cases
// but lets scripts add setup/teardown around each fn if needed.
function parallel(fns) {
  if (!Array.isArray(fns)) {
    return Promise.reject(new Error('parallel() requires an array of functions'));
  }
  return Promise.all(fns.map(function (fn) { return fn(); }));
}

async function userScript(args) {
  'use strict';
${cleaned
  .split('\n')
  .map(line => '  ' + line)
  .join('\n')}
}

parentPort.on('message', async (msg) => {
  if (!msg || msg.kind !== 'init') return;
  try {
    if (typeof userScript !== 'function') {
      throw new Error('Workflow script must define an async function (default export or named "userScript")');
    }
    const result = await userScript(msg.args);
    if (cancelled) {
      parentPort.postMessage({ kind: 'error', message: 'Cancelled' });
      return;
    }
    parentPort.postMessage({ kind: 'report', value: String(result ?? '') });
  } catch (err) {
    parentPort.postMessage({
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
});
`
}
