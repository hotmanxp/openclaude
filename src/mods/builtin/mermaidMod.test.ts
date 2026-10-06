import { describe, expect, test } from 'bun:test'
import {
  mermaidBuiltinMod,
  renderMermaidDiagram,
  renderMermaidFences,
} from './mermaidMod.js'
import { createModContext } from '../engine.js'
import { stringWidth } from '../../ink/stringWidth.js'
import type { LoadedMod } from '../registry.js'

const displayWidth = (line: string): number => stringWidth(line)

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

  // Inline labels parse: before the fix `A -- text --> B` left `A -- text` as
  // an unparseable node token and dropped the whole diagram (returned null).
  test('parses inline edge labels (A -- text --> B)', () => {
    const out = renderMermaidDiagram(
      ['flowchart TD', 'A{ok?} -- yes --> B[done]', 'A -- no --> C'].join('\n'),
    )
    expect(out).not.toBeNull()
    expect(out).toContain('done')
    expect(out).toContain('C')
  })

  test('inline labels are equivalent to the pipe form', () => {
    const inline = renderMermaidDiagram(
      ['flowchart TD', 'A -- retry .-> B'].join('\n'),
    )
    const piped = renderMermaidDiagram(
      ['flowchart TD', 'A -.->|retry| B'].join('\n'),
    )
    expect(inline).not.toBeNull()
    expect(inline).toBe(piped)
  })

  test('parses inline labels on thick and dotted edges', () => {
    expect(
      renderMermaidDiagram(['flowchart TD', 'A == fast ==> B'].join('\n')),
    ).not.toBeNull()
    expect(
      renderMermaidDiagram(['flowchart TD', 'A -- plain --- B'].join('\n')),
    ).not.toBeNull()
  })

  test('renders a label containing its own closing bracket', () => {
    const out = renderMermaidDiagram(
      ['flowchart TD', 'A["returns ModLoadResult[]"] --> B'].join('\n'),
    )
    expect(out).not.toBeNull()
    expect(out).toContain('ModLoadResult')
  })

  // The real-world regression: a 48-line session-start flowchart with inline
  // labels, a `[]`-bearing node label and 6 back edges. Every one of those
  // alone returned null; the reply silently fell back to raw code.
  test('renders a large real-world flowchart (session-start mods flow)', () => {
    const out = renderMermaidDiagram(
      [
        'flowchart TD',
        'A["session start<br/>processSessionStartHooks"] --> M',
        'B["/mods reload"] --> R',
        'R["reloadMods()"] --> M',
        'M{"loadMods()"} --> W',
        'W --> D',
        'D --> U',
        'U --> DISC',
        'DISC --> LOOP{"each root"}',
        'LOOP --> SL',
        'LOOP -- throws --> ERR["catch: logForDebugging"]',
        'LOOP -- done --> BI',
        'BI --> BIC{"name taken?"}',
        'BIC -- yes --> BIS',
        'BIC -- no --> BIR',
        'BIR --> SWAP',
        'SWAP --> UNREG',
        'UNREG --> BUILD',
        'BUILD --> HOOK',
        'HOOK --> RET["returns ModLoadResult[]"]',
        'RET -.->|"fails >= 5 times"| BRK',
        'BRK --> UNLOAD',
        'UNLOAD --> SWAP',
        'ERR --> LOOP',
      ].join('\n'),
    )
    expect(out).not.toBeNull()
    expect(out).toContain('session start')
    expect(out).toContain('ModLoadResult')
  })

  // Mermaid keywords are case-insensitive. `Note` (the capitalised spelling
  // models actually emit) previously failed the whole-diagram regex, so a reply
  // containing a single note fell back to raw code.
  test('accepts capitalised sequence keywords', () => {
    const out = renderMermaidDiagram(
      [
        'sequenceDiagram',
        'Participant S',
        'Actor P',
        'S->>P: hi',
        'Note over P: warn',
        'Activate P',
        'P-->>S: ok',
        'Deactivate P',
      ].join('\n'),
    )
    expect(out).not.toBeNull()
    expect(out).toContain('warn')
  })

  test('accepts uppercase frames and END', () => {
    const out = renderMermaidDiagram(
      [
        'sequenceDiagram',
        'S->>P: a',
        'LOOP retry',
        'P-->>S: b',
        'ELSE give up',
        'S->>P: c',
        'END',
      ].join('\n'),
    )
    expect(out).not.toBeNull()
    // the frame keyword is echoed verbatim, so match case-insensitively
    expect(out?.toLowerCase()).toContain('[loop]')
  })

  // CJK glyphs occupy two terminal columns but one code unit, so a
  // char-count-based box leaves its closing border visibly off-align.
  test('aligns box borders for CJK labels', () => {
    const out = renderMermaidDiagram(
      ['flowchart TD', 'A["中文标签"] --> B["abcdefgh"]'].join('\n'),
    )
    expect(out).not.toBeNull()
    // Group the three rows of each box and assert the borders line up by
    // display width — the top/bottom rules and the label row must match.
    const rows = (out ?? '').split('\n')
    const top = rows.findIndex(l => l.startsWith('┌'))
    expect(top).toBeGreaterThan(-1)
    const [rule, label, bottom] = [rows[top], rows[top + 1], rows[top + 2]] as [
      string,
      string,
      string,
    ]
    expect(label.startsWith('│')).toBe(true)
    expect(bottom.startsWith('└')).toBe(true)
    expect(displayWidth(label)).toBe(displayWidth(rule))
    expect(displayWidth(bottom)).toBe(displayWidth(rule))
  })

  // `subgraph` … `end` used to bail out of parseFlowchart entirely, so any
  // diagram using one fell back to raw code.
  test('wraps subgraph members in a titled frame', () => {
    const out = renderMermaidDiagram(
      [
        'flowchart TD',
        '  subgraph load [加载阶段]',
        '    A[a] --> B[b]',
        '  end',
        '  B --> C[c]',
      ].join('\n'),
    )
    expect(out).not.toBeNull()
    expect(out).toContain('加载阶段')
  })

  test('falls back to the cluster id when no title is given', () => {
    const out = renderMermaidDiagram(
      ['flowchart TD', '  subgraph s1', '    A[a] --> B[b]', '  end', 'B --> C[c]'].join(
        '\n',
      ),
    )
    expect(out).not.toBeNull()
    expect(out).toContain('s1')
  })

  test('handles nested subgraphs', () => {
    const out = renderMermaidDiagram(
      [
        'flowchart TD',
        '  subgraph outer [外层]',
        '    subgraph inner [内层]',
        '      A[a] --> B[b]',
        '    end',
        '    B --> C[c]',
        '  end',
      ].join('\n'),
    )
    expect(out).not.toBeNull()
    expect(out).toContain('内层')
    expect(out).toContain('外层')
  })

  test('renders clusters in an LR flowchart', () => {
    const out = renderMermaidDiagram(
      [
        'graph LR',
        '  subgraph s1 [组一]',
        '    A[a] --> B[b]',
        '  end',
        '  B --> C[c]',
      ].join('\n'),
    )
    expect(out).not.toBeNull()
    expect(out).toContain('组一')
  })

  test('keeps a node claimed by two sibling subgraphs as code', () => {
    // The two frames would overlap, so this is not drawable.
    const src = [
      'flowchart TD',
      '  subgraph one [一]',
      '    A[a] --> M[m]',
      '  end',
      '  subgraph two [二]',
      '    M --> B[b]',
      '  end',
    ].join('\n')
    expect(renderMermaidDiagram(src)).toBeNull()
  })

  test('renders a node shared by a nested subgraph and its ancestor', () => {
    const out = renderMermaidDiagram(
      [
        'flowchart TD',
        '  subgraph outer [外]',
        '    subgraph inner [内]',
        '      A[a]',
        '    end',
        '    A --> B[b]',
        '  end',
      ].join('\n'),
    )
    expect(out).not.toBeNull()
  })

  test('keeps an unterminated subgraph as code', () => {
    const src = ['flowchart TD', '  subgraph s1', '    A --> B'].join('\n')
    expect(renderMermaidDiagram(src)).toBeNull()
  })

  test('leaves cluster-free flowcharts untouched', () => {
    const out = renderMermaidDiagram(['flowchart TD', 'A --> B --> C'].join('\n'))
    expect(out).not.toBeNull()
    expect(out).not.toContain('subgraph')
  })

  test('renders a cyclic flowchart with many back edges', () => {
    const lines = ['flowchart TD', 'A --> B', 'B --> C', 'C --> A']
    // Six distinct back edges — above the old hard-coded limit of 4.
    for (let i = 0; i < 6; i++) lines.push(`C --> N${i}`)
    const out = renderMermaidDiagram(lines.join('\n'))
    expect(out).not.toBeNull()
    expect(out).toContain('A')
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
