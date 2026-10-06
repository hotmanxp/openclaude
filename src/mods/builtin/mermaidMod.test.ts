import { describe, expect, test } from 'bun:test'
import {
  mermaidBuiltinMod,
  renderMermaidDiagram,
  renderMermaidFences,
} from './mermaidMod.js'
import { createModContext } from '../engine.js'
import type { LoadedMod } from '../registry.js'

function harness(): { handler: (e: { text: string }) => string | void } {
  const mod: LoadedMod = {
    manifest: { name: 'mermaid', entry: '(builtin)' },
    root: '(builtin)',
    entryPath: '(builtin)',
    handlers: [],
    commands: [],
    tools: [],
  }
  const ctx = createModContext(mod)
  mermaidBuiltinMod.register(ctx)
  const registration = mod.handlers.find(h => h.event === 'ui.render')
  if (!registration) throw new Error('mermaid mod did not register ui.render')
  return {
    handler: e =>
      registration.handler(
        e as unknown as Record<string, unknown>,
        (() => e.text) as never,
      ) as string | void,
  }
}

describe('mermaid built-in mod — diagrams', () => {
  test('renders a TD flowchart with boxes and arrows', () => {
    const out = renderMermaidDiagram(
      ['flowchart TD', 'A[Start] --> B[End]'].join('\n'),
    )
    expect(out).not.toBeNull()
    expect(out).toContain('┌')
    expect(out).toContain('Start')
    expect(out).toContain('End')
    expect(out).toContain('▼')
  })

  test('renders an LR flowchart with horizontal arrows', () => {
    const out = renderMermaidDiagram(
      ['flowchart LR', 'A[Build] --> B[Test]'].join('\n'),
    )
    expect(out).not.toBeNull()
    expect(out).toContain('Build')
    expect(out).toContain('▶')
  })

  test('renders a diamond node with a visual marker', () => {
    const out = renderMermaidDiagram(
      ['flowchart TD', 'A{OK?} --> B[Yes]'].join('\n'),
    )
    expect(out).toContain('⟨OK?⟩')
  })

  test('renders a sequence diagram with participants and messages', () => {
    const out = renderMermaidDiagram(
      [
        'sequenceDiagram',
        'participant A as Alice',
        'participant B as Bob',
        'A->>B: Hello',
        'B-->>A: Hi',
      ].join('\n'),
    )
    expect(out).not.toBeNull()
    expect(out).toContain('Alice')
    expect(out).toContain('Hello')
    expect(out).toContain('▶')
    expect(out).toContain('⇠')
  })

  test('renders loop frames in sequence diagrams', () => {
    const out = renderMermaidDiagram(
      [
        'sequenceDiagram',
        'A->>B: ping',
        'loop every minute',
        'A->>B: ping',
        'end',
      ].join('\n'),
    )
    expect(out).toContain('[loop]')
  })

  test('unsupported diagram type returns null (keep fence)', () => {
    expect(renderMermaidDiagram('pie\n"a": 1')).toBeNull()
  })

  test('a syntax error bails the whole fence', () => {
    expect(
      renderMermaidDiagram(['flowchart TD', 'A --> B & C'].join('\n')),
    ).toBeNull()
  })
})

describe('mermaid built-in mod — fence rewriting', () => {
  test('replaces a parseable fence with a plain text fence', () => {
    const text = [
      'before',
      '```mermaid',
      'flowchart TD',
      'A[Start] --> B[End]',
      '```',
      'after',
    ].join('\n')
    const out = renderMermaidFences(text)
    expect(out).toContain('before')
    expect(out).toContain('after')
    expect(out).toContain('```text')
    expect(out).toContain('▼')
    expect(out).not.toContain('```mermaid')
  })

  test('keeps an unparseable fence untouched', () => {
    const text = ['```mermaid', 'pie', '"a": 1', '```'].join('\n')
    expect(renderMermaidFences(text)).toBe(text)
  })

  test('keeps an unterminated fence untouched (streaming)', () => {
    const text = ['```mermaid', 'flowchart TD', 'A --> B'].join('\n')
    expect(renderMermaidFences(text)).toBe(text)
  })

  test('leaves text without fences unchanged', () => {
    const text = 'just prose\nwith mermaid mentioned\nbut no fence'
    expect(renderMermaidFences(text)).toBe(text)
  })
})

describe('mermaid built-in mod — ui.render registration', () => {
  test('registers a synchronous ui.render handler', () => {
    const { handler } = harness()
    const out = handler({
      text: ['```mermaid', 'flowchart TD', 'A --> B', '```'].join('\n'),
    })
    expect(typeof out).toBe('string')
    expect(out).toContain('```text')
  })

  test('passes through text without mermaid fences', () => {
    const { handler } = harness()
    const text = 'plain reply with no diagrams'
    expect(handler({ text })).toBe(text)
  })
})
