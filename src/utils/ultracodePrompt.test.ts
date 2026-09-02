// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import {
  withUltracodePrompt,
  ULTRACODE_OPT_IN_BLOCK,
  ULTRACODE_SUBAGENT_PROMPT,
} from './ultracodePrompt.js'

// Upstream 2.1.252 reorganised the ultracode block: detailed Composing
// patterns + Quality patterns + Scale live in the main-session OPT_IN
// block, while SUBAGENT_PROMPT is just the 6-line "you are a subagent +
// CRITICAL: call FinalAnswer tool once" preamble. This split lets the
// LLM see the full pattern catalogue in the main session (where it
// chooses how to compose) but only the mechanical constraint in
// spawned subagents (where the patterns would just bloat context).
//
// 2.1.170/2.1.177 (opencc's prior verbatim) had the patterns in
// SUBAGENT_PROMPT; 2.1.252 moves them up.

describe('ULTRACODE_OPT_IN_BLOCK', () => {
  it('starts with the Ultracode block marker', () => {
    expect(ULTRACODE_OPT_IN_BLOCK).toContain('**Ultracode.**')
  })

  it('mentions all 4 core quality patterns (moved here from SUBAGENT in 2.1.252)', () => {
    expect(ULTRACODE_OPT_IN_BLOCK).toContain('Adversarial verify')
    expect(ULTRACODE_OPT_IN_BLOCK).toContain('Multi-modal sweep')
    expect(ULTRACODE_OPT_IN_BLOCK).toContain('Completeness critic')
    expect(ULTRACODE_OPT_IN_BLOCK).toContain('loop-until-dry')
  })

  it('includes the perspective-diverse and judge-panel patterns', () => {
    expect(ULTRACODE_OPT_IN_BLOCK).toContain('Perspective-diverse verify')
    expect(ULTRACODE_OPT_IN_BLOCK).toContain('Judge panel')
    expect(ULTRACODE_OPT_IN_BLOCK).toContain('No silent caps')
  })

  it('contains the Composing patterns exhaustive-review example', () => {
    expect(ULTRACODE_OPT_IN_BLOCK).toContain('Composing patterns')
    expect(ULTRACODE_OPT_IN_BLOCK).toContain('loop-until-dry')
  })

  it('points at the Workflow tool description (not "above")', () => {
    expect(ULTRACODE_OPT_IN_BLOCK).toContain(
      'revert to the opt-in rule in the Workflow tool description',
    )
  })

  it('documents script authoring (meta object + inline script pattern)', () => {
    expect(ULTRACODE_OPT_IN_BLOCK).toContain('Pass the script inline')
    expect(ULTRACODE_OPT_IN_BLOCK).toContain('export const meta =')
  })
})

describe('ULTRACODE_SUBAGENT_PROMPT (2.1.252 slim preamble)', () => {
  it('is a workflow-orchestration script preamble', () => {
    expect(ULTRACODE_SUBAGENT_PROMPT).toContain('workflow orchestration script')
  })

  it('requires the FinalAnswer tool exactly once', () => {
    expect(ULTRACODE_SUBAGENT_PROMPT).toContain('FinalAnswer tool')
    expect(ULTRACODE_SUBAGENT_PROMPT).toContain('exactly once')
  })

  it('does NOT carry the full quality-pattern catalogue (moved to OPT_IN in 2.1.252)', () => {
    expect(ULTRACODE_SUBAGENT_PROMPT).not.toContain('Adversarial verify')
    expect(ULTRACODE_SUBAGENT_PROMPT).not.toContain('Multi-modal sweep')
  })
})

describe('withUltracodePrompt', () => {
  beforeEach(() => {
    mock.restore()
  })

  afterEach(() => {
    mock.restore()
  })

  it('returns the input array unchanged when ultracode is inactive', () => {
    mock.module('./ultracode.js', () => ({
      isUltracodeActive: () => false,
    }))
    return import(
      `./ultracodePrompt.ts?ts=${Date.now()}-${Math.random()}`
    ).then(mod => {
      const input = ['base prompt', 'env details']
      const out = mod.withUltracodePrompt(input)
      expect(out).toEqual(input)
    })
  })

  it('appends ULTRACODE_SUBAGENT_PROMPT when ultracode is active', () => {
    mock.module('./ultracode.js', () => ({
      isUltracodeActive: () => true,
    }))
    return import(
      `./ultracodePrompt.ts?ts=${Date.now()}-${Math.random()}`
    ).then(mod => {
      const input = ['base prompt']
      const out = mod.withUltracodePrompt(input)
      expect(out.length).toBe(2)
      expect(out[0]).toBe('base prompt')
      expect(out[1]).toBe(mod.ULTRACODE_SUBAGENT_PROMPT)
    })
  })
})
