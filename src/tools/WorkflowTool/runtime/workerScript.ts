/**
 * Build the wrapper script that's loaded into node:worker_threads.
 *
 * The wrapper:
 * - Defines a restricted global scope (no require, no process, no globalThis)
 * - Exposes `args` and `spawnSubagent` globals
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

  // parentPort must be captured before the require shadow takes effect.
  // The module-level wrapper is trusted code (not user-supplied), so we
  // omit 'use strict' here — it would forbid 'const eval' which we need
  // to shadow. User code inside userScript() is still wrapped in strict.
  return `
const { parentPort } = require('node:worker_threads');

const process = undefined;
const require = undefined;
const globalThis = undefined;
const Buffer = undefined;
const eval = undefined;
const Function = undefined;

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
