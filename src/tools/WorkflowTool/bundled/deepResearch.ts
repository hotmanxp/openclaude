// src/tools/WorkflowTool/bundled/deepResearch.ts
import type { Workflow } from '../types.js'

/**
 * The deep-research bundled workflow.
 * Fans out 3 parallel subagents to research a question from different angles,
 * then a final synthesis agent produces a cited report.
 *
 * Invocation: /deep-research <question>
 */
const deepResearchScript = `
async function userScript(args) {
  const question = Array.isArray(args) ? args.join(' ') : String(args ?? '').trim();
  if (!question) {
    return 'Usage: /deep-research <question>';
  }

  // Phase 1: fan out 3 parallel research angles
  const angles = [
    { label: 'background', prompt: \`Provide a concise background summary on: \${question}. Use WebSearch and WebFetch to gather authoritative sources.\` },
    { label: 'current-state', prompt: \`What is the current state of the art / latest developments regarding: \${question}? Use WebSearch for recent (2025-2026) sources.\` },
    { label: 'critiques', prompt: \`What are the main critiques, limitations, or counterpoints about: \${question}? Use WebSearch to find skeptical or critical analyses.\` },
  ];

  const research = await Promise.all(
    angles.map(a => spawnSubagent(a.prompt, { tools: ['WebSearch', 'WebFetch'] })),
  );

  // Phase 2: cross-verify findings (one extra subagent to spot-check claims)
  const verification = await spawnSubagent(
    \`Review these three research summaries for the question "\${question}". Identify any factual claims that look dubious, hallucinated, or unsupported. Use WebSearch to spot-check at most 3 claims.\n\n\` +
    research.map((r, i) => \`## \${angles[i].label}\n\${r.report}\`).join('\n\n'),
    { tools: ['WebSearch', 'WebFetch'] },
  );

  // Phase 3: synthesize
  return [
    \`# Deep research: \${question}\`,
    '',
    '## Background',
    research[0].report,
    '',
    '## Current state',
    research[1].report,
    '',
    '## Critiques',
    research[2].report,
    '',
    '## Cross-verification',
    verification.report,
  ].join('\n');
}
`

export const deepResearch: Workflow = {
  name: 'deep-research',
  description: 'Multi-agent research: fan out to gather + critique + outline, then synthesize a cited report',
  source: 'bundled',
  path: '<bundled:deepResearch>',
  run: async () => '',  // not used — script source is read separately
}

// Also export the script source for the Worker
export const deepResearchSource = deepResearchScript
