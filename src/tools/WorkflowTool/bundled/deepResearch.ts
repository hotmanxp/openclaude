// src/tools/WorkflowTool/bundled/deepResearch.ts
import type { Workflow } from '../types.js'

/**
 * Phase metadata for the PermissionDialog + WorkflowDetailDialog.
 *
 * Each entry maps a logical phase to a short user-facing title and a
 * longer detail string the dialog can render inline (or use as a
 * tooltip) so the user understands what the workflow is about to do
 * before granting permission to run.
 *
 * The phases are the upstream 5-phase adversarial deep-research
 * pipeline: Scope -> Search -> Fetch -> Verify -> Synthesize.
 */
export const DEEP_RESEARCH_PHASES = [
  {
    title: 'Scope',
    detail: 'Decompose the question into sub-questions and pick the angle each lens will attack — narrow or wide, depending on what the user is actually asking.',
  },
  {
    title: 'Search',
    detail: 'Fan out parallel web searches from multiple angles — background, current state, critiques — using the WebSearch tool.',
  },
  {
    title: 'Fetch',
    detail: 'Fetch the most promising sources identified during Search, full-text via WebFetch, and pull the structured data the synthesis will need.',
  },
  {
    title: 'Verify',
    detail: 'Cross-check factual claims across sources — a separate verifier subagent spot-checks dubious or hallucinated findings and surfaces conflicts.',
  },
  {
    title: 'Synthesize',
    detail: 'Write the final cited report — combining background, current state, critiques, and verification into one coherent answer with links to every source.',
  },
] as const

/**
 * The deep-research bundled workflow.
 *
 * 5-phase adversarial pipeline (Scope -> Search -> Fetch -> Verify ->
 * Synthesize). Fans out multiple parallel subagents per phase, then
 * synthesizes a single cited report at the end.
 *
 * Invocation: /deep-research <question>
 *
 * The script source is emitted as a template literal so it can be
 * passed verbatim to the Worker runtime, where it gets compiled
 * together with the worker-script prelude (spawnSubagent, agent,
 * parallel, phase, log, __setMeta, budget). The Worker's agent()
 * wrapper accepts Plan1's {schema, isolation} options end-to-end,
 * so structured-output and worktree-isolation just work.
 */
const deepResearchScript = `
__setMeta({
  name: 'deep-research',
  description: 'Multi-phase adversarial deep-research pipeline: Scope the question, fan out parallel Search agents, Fetch the best sources, Verify claims, then Synthesize a cited report.',
  phases: [
    { title: 'Scope' },
    { title: 'Search' },
    { title: 'Fetch' },
    { title: 'Verify' },
    { title: 'Synthesize' },
  ],
});

async function userScript(args) {
  'use strict';
  const question = Array.isArray(args) ? args.join(' ') : String(args ?? '').trim();
  if (!question) {
    return 'Usage: /deep-research <question>';
  }

  // --- Phase 1: Scope ---------------------------------------------------
  // Decompose the question into 3 lens angles + a verification spec.
  phase('Scope');
  const scope = await agent(
    \`Decompose this research question into 3 distinct lens angles plus a verification spec.\n\nQuestion: \${question}\n\nReturn JSON with:\n- angles: array of { label, prompt } — each prompt should be a self-contained WebSearch/WebFetch directive for one angle (background / current state / critiques)\n- verification_focus: a short list of the 2-3 claim types that need cross-checking (e.g. dates, statistics, named-attribution quotes)\`,
    {
      label: 'scoper',
      phase: 'Scope',
      schema: {
        type: 'object',
        properties: {
          angles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                prompt: { type: 'string' },
              },
              required: ['label', 'prompt'],
              additionalProperties: false,
            },
          },
          verification_focus: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['angles', 'verification_focus'],
        additionalProperties: false,
      },
    },
  );

  if (!scope.ok || !scope.structuredOutput || !scope.structuredOutput.angles) {
    return 'Scope phase failed: ' + (scope.error || 'no structured output');
  }
  const angles = scope.structuredOutput.angles;
  const verificationFocus = scope.structuredOutput.verification_focus || [];

  // --- Phase 2: Search --------------------------------------------------
  // Fan out one search subagent per lens angle, in parallel.
  phase('Search');
  const searchResults = await parallel(
    angles.map(function (angle) {
      return function () {
        return agent(angle.prompt, {
          label: 'search:' + angle.label,
          phase: 'Search',
          tools: ['WebSearch', 'WebFetch'],
        });
      };
    }),
  );

  // --- Phase 3: Fetch ---------------------------------------------------
  // Each search result points to candidate sources; one fetch agent per
  // lens pulls the full content of the most useful 2-3 URLs.
  phase('Fetch');
  const fetched = await parallel(
    searchResults.map(function (r, i) {
      return function () {
        if (!r.ok) {
          return Promise.resolve({ ok: false, error: r.error, label: 'fetch:' + angles[i].label });
        }
        return agent(
          \`From the following search summary, identify the 2-3 most authoritative sources for the angle "\${angles[i].label}" and fetch their full content. Return a structured { sources: [{ url, title, content }] } list.\n\nQuestion: \${question}\n\nSearch summary (\${angles[i].label}):\n\${r.report}\`,
          {
            label: 'fetch:' + angles[i].label,
            phase: 'Fetch',
            schema: {
              type: 'object',
              properties: {
                sources: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      url: { type: 'string' },
                      title: { type: 'string' },
                      content: { type: 'string' },
                    },
                    required: ['url', 'title', 'content'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['sources'],
              additionalProperties: false,
            },
          },
        );
      };
    }),
  );

  // --- Phase 4: Verify --------------------------------------------------
  // A dedicated verifier subagent, isolated in a worktree so it cannot
  // be biased by the fetchers' framing, cross-checks claims against
  // the verification spec.
  phase('Verify');
  const verify = await agent(
    \`Independently verify the following research findings for the question "\${question}".\n\nFocus on these claim types: \${verificationFocus.join(', ')}.\n\nFindings to verify:\n\${searchResults.map(function (r, i) {
      if (!r.ok) return '## ' + angles[i].label + ' (FAILED: ' + r.error + ')';
      return '## ' + angles[i].label + '\n' + r.report;
    }).join('\n\n')}\n\nFetched sources:\n\${fetched.map(function (r, i) {
      if (!r.ok || !r.structuredOutput || !r.structuredOutput.sources) return '## ' + angles[i].label + ' (no sources)';
      return '## ' + angles[i].label + '\n' + r.structuredOutput.sources.map(function (s) {
        return '- ' + s.title + ' (' + s.url + ')';
      }).join('\n');
    }).join('\n\n')}\n\nReturn structured output: { verified: [{ claim, status: 'ok'|'unsupported'|'contested', evidence }], overall: 'reliable'|'mixed'|'unreliable' }\`,
    {
      label: 'verifier',
      phase: 'Verify',
      isolation: 'worktree',
      schema: {
        type: 'object',
        properties: {
          verified: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                claim: { type: 'string' },
                status: { type: 'string' },
                evidence: { type: 'string' },
              },
              required: ['claim', 'status', 'evidence'],
              additionalProperties: false,
            },
          },
          overall: { type: 'string' },
        },
        required: ['verified', 'overall'],
        additionalProperties: false,
      },
    },
  );

  // --- Phase 5: Synthesize ---------------------------------------------
  // Final synthesis — combines all phases into a cited markdown report.
  phase('Synthesize');
  const lines = [
    '# Deep research: ' + question,
    '',
    '## Scope',
    'Lens angles: ' + angles.map(function (a) { return a.label; }).join(', '),
    'Verification focus: ' + (verificationFocus.length ? verificationFocus.join(', ') : '(none specified)'),
    '',
    '## Findings',
  ];

  searchResults.forEach(function (r, i) {
    lines.push('');
    lines.push('### ' + angles[i].label);
    if (r.ok) {
      lines.push(r.report);
    } else {
      lines.push('_(search failed: ' + r.error + ')_');
    }
  });

  lines.push('');
  lines.push('## Cross-verification');
  if (verify.ok && verify.structuredOutput) {
    lines.push('Overall reliability: **' + verify.structuredOutput.overall + '**');
    lines.push('');
    verify.structuredOutput.verified.forEach(function (v) {
      lines.push('- [' + v.status + '] ' + v.claim + (v.evidence ? ' — ' + v.evidence : ''));
    });
  } else {
    lines.push('_(verification failed: ' + (verify.error || 'no structured output') + ')_');
  }

  return lines.join('\n');
}
`

export const deepResearch: Workflow = {
  name: 'deep-research',
  description: '5-phase adversarial deep-research pipeline: Scope → Search → Fetch → Verify → Synthesize. Produces a cited report from multiple parallel lens agents with independent cross-verification.',
  source: 'bundled',
  path: '<bundled:deepResearch>',
  run: async () => '',  // not used — script source is read separately
}

// Also export the script source for the Worker
export const deepResearchSource = deepResearchScript