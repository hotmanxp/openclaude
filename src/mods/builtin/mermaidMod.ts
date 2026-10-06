import type { BuiltinModSpec } from '../builtin.js'
import type { ModContext } from '../engine.js'

/**
 * Built-in `mermaid` mod — opencc parity of upstream `cc-plugin-mermaid`
 * ("Mermaid diagrams in the terminal: flowcharts and sequence diagrams in a
 * reply's mermaid code fences are drawn in place as box-drawing text").
 *
 * Subscribes to the synchronous `ui.render` event and rewrites ```mermaid
 * fences that PARSE into box-drawing diagrams, wrapped in a plain ```text
 * fence so the markdown renderer preserves the layout. Anything that does
 * not parse (unsupported diagram type, exotic syntax, size caps) stays as
 * the original code fence — fail-safe: a failed render never breaks the
 * reply.
 *
 * Supported subset (v1):
 * - flowchart TD/TB/BT/LR/RL (`graph` alias): rect/round/diamond node
 *   shapes, chained edges with optional |labels|, arrow vs line styles
 *   (dotted/thick map onto arrow/line). Subgraphs are NOT laid out in v1 —
 *   a fence containing one stays as code.
 * - sequenceDiagram: participants, ->>/-->>/-x/--x/->/-- messages, notes
 *   (over/left/right), loop/opt/alt frames with else dividers.
 */

// Guardrails (fail-safe): anything past these keeps the original fence.
const MAX_FENCE_SOURCE = 20_000
const MAX_FENCE_LINES = 200
const MAX_NODES = 24
const MAX_EDGES = 40
const MAX_PARTICIPANTS = 12
const MAX_MESSAGES = 60
const MAX_RENDER_ROWS = 140
const MAX_LABEL = 36
const BOX_H = 3
const GAP_H = 3

// ---------------------------------------------------------------------------
// Fence scanning
// ---------------------------------------------------------------------------

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*mermaid[ \t\r]*$/
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/

/**
 * Replace every ```mermaid fence that parses with a plain fence holding the
 * box-drawing render. Fences that fail to parse are left untouched.
 */
export function renderMermaidFences(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0
  let changed = false
  while (i < lines.length) {
    const open = FENCE_OPEN_RE.exec(lines[i] ?? '')
    if (!open) {
      out.push(lines[i] ?? '')
      i++
      continue
    }
    const marker = open[1] ?? '```'
    const body: string[] = []
    let j = i + 1
    let closed = false
    while (j < lines.length) {
      const close = FENCE_CLOSE_RE.exec(lines[j] ?? '')
      if (close && (close[1]?.startsWith(marker) ?? false)) {
        closed = true
        break
      }
      body.push(lines[j] ?? '')
      j++
    }
    if (!closed || body.length === 0) {
      // Unterminated fence (e.g. still streaming) — keep the rest as-is.
      for (let k = i; k < lines.length; k++) out.push(lines[k] ?? '')
      return out.join('\n')
    }
    const rendered = renderMermaidDiagram(body.join('\n'))
    if (rendered === null) {
      for (let k = i; k <= j; k++) out.push(lines[k] ?? '')
    } else {
      out.push('```text', ...rendered.split('\n'), '```')
      changed = true
    }
    i = j + 1
  }
  return changed ? out.join('\n') : text
}

/** Render one diagram's source; null = "cannot render, keep the fence". */
export function renderMermaidDiagram(source: string): string | null {
  if (source.length === 0 || source.length > MAX_FENCE_SOURCE) return null
  const lines = source.split('\n')
  if (lines.length > MAX_FENCE_LINES) return null
  const first = lines.findIndex(line => line.trim() !== '')
  if (first === -1) return null
  const header = (lines[first] ?? '').trim().toLowerCase()
  const rest = lines.slice(first + 1)
  if (/^(flowchart|graph)\b/.test(header)) {
    const graph = parseFlowchart(header, rest)
    return graph === null ? null : layoutFlowchart(graph)
  }
  if (header === 'sequencediagram') return renderSequence(rest)
  return null
}

// ---------------------------------------------------------------------------
// Shared grid painting
// ---------------------------------------------------------------------------

type Grid = string[][]

function paint(grid: Grid, x: number, y: number, s: string): void {
  if (y < 0 || y >= grid.length || x < 0) return
  const row = grid[y] ?? []
  for (let k = 0; k < s.length; k++) {
    while (row.length <= x + k) row.push(' ')
    row[x + k] = s[k] ?? ' '
  }
  grid[y] = row
}

function gridToString(grid: Grid): string {
  return grid.map(row => row.join('').replace(/\s+$/, '')).join('\n')
}

// ---------------------------------------------------------------------------
// Flowchart
// ---------------------------------------------------------------------------

type FcShape = 'rect' | 'round' | 'diamond'
type FcNode = { label: string; shape: FcShape }
type FcEdge = { from: string; to: string; label?: string; arrow: boolean }
type FcDir = 'TD' | 'BT' | 'LR' | 'RL'

/** Longest-first: `-\.->` before `-\.-`. */
const EDGE_OP_RE = /(-\.->|-\.-|-->|==>|---)/

function parseNodeToken(
  token: string,
): { id: string; def?: FcNode } | null {
  const m = /^([A-Za-z0-9_]+)\s*(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?\s*$/.exec(
    token,
  )
  if (!m) return null
  const id = m[1] ?? ''
  if (id === '') return null
  const raw = (m[2] ?? m[3] ?? m[4])?.trim()
  if (raw === undefined) return { id }
  let label = raw
  if (
    (label.startsWith('"') && label.endsWith('"') && label.length >= 2) ||
    (label.startsWith("'") && label.endsWith("'") && label.length >= 2)
  ) {
    label = label.slice(1, -1)
  }
  label = label.replace(/<br\s*\/?>/gi, ' ').trim()
  if (label.length > MAX_LABEL) label = `${label.slice(0, MAX_LABEL - 1)}…`
  const shape: FcShape =
    m[2] !== undefined ? 'rect' : m[3] !== undefined ? 'round' : 'diamond'
  return { id, def: { label: label === '' ? id : label, shape } }
}

function parseFlowchart(
  header: string,
  lines: string[],
): { dir: FcDir; nodes: Map<string, FcNode>; edges: FcEdge[] } | null {
  const dirMatch = /(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\s*$/i.exec(header)
  if (!dirMatch) return null
  const rawDir = (dirMatch[1] ?? 'TD').toUpperCase()
  const dir: FcDir = rawDir === 'TB' ? 'TD' : (rawDir as FcDir)

  const nodes = new Map<string, FcNode>()
  const edges: FcEdge[] = []
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('%%')) continue
    if (
      /^(classDef|class|style|click|linkStyle|direction)\b/.test(line) ||
      line === 'end'
    ) {
      continue
    }
    if (/^subgraph\b/.test(line)) return null // subgraphs: not laid out in v1

    const pieces = line.split(EDGE_OP_RE)
    type Step = { token: string; op?: string; label?: string }
    const steps: Step[] = []
    for (let k = 0; k < pieces.length; k++) {
      const piece = pieces[k]
      if (piece === undefined) continue
      if (k % 2 === 1) {
        // Edge operator (capture group) — its operand is pieces[k+1], which
        // may carry a |label| prefix. Consume it so the even branch below
        // doesn't also emit it as a bare node step.
        const next = pieces[k + 1]
        let token = next?.trim()
        let label: string | undefined
        if (token !== undefined) {
          const pipe = /^\|([^|]*)\|\s*(.*)$/.exec(token)
          if (pipe) {
            label = (pipe[1] ?? '').trim()
            token = (pipe[2] ?? '').trim()
          }
        }
        if (token === undefined) return null
        steps.push({ token, op: piece, label })
        k++
      } else {
        const trimmed = piece.trim()
        if (trimmed !== '') steps.push({ token: trimmed })
      }
    }
    if (steps.length === 0) continue

    const record = (parsed: { id: string; def?: FcNode }): void => {
      if (!nodes.has(parsed.id)) {
        nodes.set(parsed.id, parsed.def ?? { label: parsed.id, shape: 'rect' })
      } else if (parsed.def) {
        nodes.set(parsed.id, parsed.def)
      }
    }

    if (steps.length === 1) {
      const parsed = parseNodeToken(steps[0]!.token)
      if (!parsed) return null
      record(parsed)
      continue
    }
    let current: string | undefined
    for (const step of steps) {
      const parsed = parseNodeToken(step.token)
      if (!parsed) return null
      record(parsed)
      if (current !== undefined) {
        if (step.op === undefined) return null
        if (edges.length >= MAX_EDGES) return null
        edges.push({
          from: current,
          to: parsed.id,
          ...(step.label !== undefined && step.label !== ''
            ? { label: step.label }
            : {}),
          arrow: step.op !== '---' && step.op !== '-.-',
        })
      } else if (step.op !== undefined) {
        return null
      }
      current = parsed.id
    }
  }

  if (nodes.size === 0 || nodes.size > MAX_NODES || edges.length === 0) {
    return null
  }
  return { dir, nodes, edges }
}

/**
 * Longest-path leveling on the graph with cycles BROKEN (a DFS finds back
 * edges — the edge closing each cycle — and they are excluded from the
 * relaxation; they are routed as back edges later). Returns null only if the
 * forward graph still fails to converge, which cannot happen after breaking.
 */
function assignLevels(
  ids: string[],
  edges: FcEdge[],
): Map<string, number> | null {
  const outMap = new Map<string, string[]>()
  for (const e of edges) {
    const list = outMap.get(e.from) ?? []
    list.push(e.to)
    outMap.set(e.from, list)
  }
  const back = new Set<string>()
  const color = new Map<string, 0 | 1 | 2>()
  const walk = (id: string): void => {
    color.set(id, 1)
    for (const next of outMap.get(id) ?? []) {
      const c = color.get(next) ?? 0
      if (c === 1) back.add(`${id}\0${next}`)
      else if (c === 0) walk(next)
    }
    color.set(id, 2)
  }
  for (const id of ids) if ((color.get(id) ?? 0) === 0) walk(id)

  const forward = edges.filter(e => !back.has(`${e.from}\0${e.to}`))
  const level = new Map<string, number>()
  for (const id of ids) level.set(id, 0)
  for (let pass = 0; pass <= ids.length; pass++) {
    let changed = false
    for (const e of forward) {
      const next = (level.get(e.from) ?? 0) + 1
      if ((level.get(e.to) ?? 0) < next) {
        level.set(e.to, next)
        changed = true
      }
    }
    if (!changed) return level
  }
  return null
}

/**
 * Axis-transpose glyph map: painting in "abstract TD space" onto a
 * transposed grid (LR/RL) turns every stroke down→right / right→down.
 */
const TRANSPOSE: Record<string, string> = {
  '┌': '┌', '┐': '└', '└': '┐', '┘': '┘',
  '├': '┬', '┤': '┴', '┬': '├', '┴': '┤',
  '╭': '╭', '╮': '╰', '╰': '╮', '╯': '╯',
  '─': '│', '│': '─',
  '▼': '▶', '▲': '◀', '▶': '▼', '◀': '▲',
}
const FLIP_V: Record<string, string> = {
  '┌': '└', '└': '┌', '┐': '┘', '┘': '┐',
  '┬': '┴', '┴': '┬',
  '╭': '╰', '╰': '╭', '╮': '╯', '╯': '╮',
  '▼': '▲', '▲': '▼',
}
const FLIP_H: Record<string, string> = {
  '┌': '┐', '┐': '┌', '└': '┘', '┘': '└',
  '├': '┤', '┤': '├',
  '╭': '╮', '╮': '╭', '╰': '╯', '╯': '╰',
  '▶': '◀', '◀': '▶',
}

function mapGlyphs(text: string, map: Record<string, string>): string {
  return [...text].map(ch => map[ch] ?? ch).join('')
}

/** Paint a 3-line box (label horizontal); returns its center x and width. */
function drawBox(
  grid: Grid,
  x: number,
  y: number,
  label: string,
  shape: FcShape,
): { cx: number; w: number } {
  const inner = shape === 'diamond' ? `⟨${label}⟩` : label
  const w = inner.length + 4
  const [tl, tr, bl, br] =
    shape === 'round' ? ['╭', '╮', '╰', '╯'] : ['┌', '┐', '└', '┘']
  paint(grid, x, y, tl + '─'.repeat(w - 2) + tr)
  paint(grid, x, y + 1, `│ ${inner} │`)
  paint(grid, x, y + 2, bl + '─'.repeat(w - 2) + br)
  return { cx: x + Math.floor(w / 2), w }
}

function layoutFlowchart(
  graph: { dir: FcDir; nodes: Map<string, FcNode>; edges: FcEdge[] },
): string | null {
  if (graph.dir === 'LR' || graph.dir === 'RL') return layoutHorizontal(graph)
  return layoutVertical(graph)
}

/** TD/TB/BT: levels are rows, connectors run vertically. */
function layoutVertical(
  graph: { dir: FcDir; nodes: Map<string, FcNode>; edges: FcEdge[] },
): string | null {
  const ids = [...graph.nodes.keys()]
  const levels = assignLevels(ids, graph.edges)
  if (!levels) return null

  const maxLevel = Math.max(...[...levels.values()])
  const rows: string[][] = Array.from({ length: maxLevel + 1 }, () => [])
  for (const id of ids) (rows[levels.get(id) ?? 0] ?? []).push(id)

  // Geometry: each level = 3 box lines + 3 gap lines.
  const rowTop: number[] = []
  let y = 0
  for (let l = 0; l < rows.length; l++) {
    rowTop[l] = y
    y += BOX_H + GAP_H
  }
  const gridH = y - GAP_H
  if (gridH > MAX_RENDER_ROWS) return null

  const grid: Grid = Array.from({ length: gridH }, () => [])
  const centers = new Map<string, number>()
  const rights = new Map<string, number>()
  for (let l = 0; l < rows.length; l++) {
    let x = 0
    for (const id of rows[l] ?? []) {
      const node = graph.nodes.get(id)!
      const box = drawBox(grid, x, rowTop[l] ?? 0, node.label, node.shape)
      centers.set(id, box.cx)
      rights.set(id, x + box.w - 1)
      x += box.w + 3
    }
  }
  let abstractW = 1
  for (const row of grid) abstractW = Math.max(abstractW, row.length)

  const gapRows = (fromLevel: number): [number, number, number] => {
    const base = (rowTop[fromLevel] ?? 0) + BOX_H
    return [base, base + 1, base + 2]
  }

  const routeAdjacent = (
    e: FcEdge,
    sx: number,
    tx: number,
    y0: number,
    y1: number,
    y2: number,
  ): void => {
    if (sx === tx) {
      paint(grid, sx, y0, '│')
      paint(grid, sx, y1, '│')
      paint(grid, sx, y2, e.arrow ? '▼' : '│')
      return
    }
    const left = Math.min(sx, tx)
    const right = Math.max(sx, tx)
    paint(grid, sx, y0, '│')
    paint(grid, sx, y1, sx < tx ? '└' : '┘')
    paint(grid, left + 1, y1, '─'.repeat(right - left - 1))
    paint(grid, tx, y1, sx < tx ? '┐' : '┌')
    paint(grid, tx, y2, e.arrow ? '▼' : '│')
    if (e.label) {
      const span = right - left - 2
      if (span >= e.label.length) {
        const pad = Math.floor((span - e.label.length) / 2)
        paint(grid, left + 1 + pad, y1, e.label)
      }
    }
  }

  const routeSameLevel = (e: FcEdge, level: number): void => {
    const sx = centers.get(e.from) ?? 0
    const tx = centers.get(e.to) ?? 0
    if (sx === tx) return
    const [y0, y1] = gapRows(level)
    paint(grid, sx, y0, '│')
    paint(grid, tx, y0, e.arrow ? '▲' : '│')
    const left = Math.min(sx, tx)
    const right = Math.max(sx, tx)
    paint(grid, sx, y1, sx < tx ? '└' : '┘')
    paint(grid, left + 1, y1, '─'.repeat(right - left - 1))
    paint(grid, tx, y1, sx < tx ? '┘' : '└')
    if (e.label) {
      const span = right - left - 2
      if (span >= e.label.length) {
        const pad = Math.floor((span - e.label.length) / 2)
        paint(grid, left + 1 + pad, y1, e.label)
      }
    }
  }

  // Level-skip and back edges route through a dedicated gutter column on the
  // right (own column per edge; too many → bail, keep the fence).
  const gutterEdges: FcEdge[] = []
  const gutterXs = new Map<string, number>()
  let gutterX = abstractW + 2

  const routeGutter = (e: FcEdge): void => {
    const fromLevel = levels.get(e.from) ?? 0
    const toLevel = levels.get(e.to) ?? 0
    const sx = centers.get(e.from) ?? 0
    const g = gutterXs.get(`${e.from}\0${e.to}`) ?? gutterX
    const [, y1] = gapRows(fromLevel)
    // Source bottom → across to the gutter column.
    paint(grid, sx, y1, '└')
    paint(grid, sx + 1, y1, '─'.repeat(Math.max(1, g - sx - 1)))
    paint(grid, g, y1, '┐')
    if (toLevel > fromLevel) {
      // Down the gutter to the gap above the target, then in from the right.
      for (let l = fromLevel + 1; l <= toLevel - 1; l++) {
        const top = rowTop[l] ?? 0
        for (let by = top; by < top + BOX_H; by++) paint(grid, g, by, '│')
        for (const gy of gapRows(l)) paint(grid, g, gy, '│')
      }
      const [z0, z1, z2] = gapRows(toLevel - 1)
      paint(grid, g, z0, '│')
      paint(grid, g, z1, '┘')
      const tx = centers.get(e.to) ?? 0
      paint(grid, tx + 1, z1, '─'.repeat(Math.max(0, g - tx - 2)))
      paint(grid, tx, z1, '┌')
      paint(grid, tx, z2, e.arrow ? '▼' : '│')
      if (e.label) {
        const span = g - tx - 2
        if (span >= e.label.length) {
          const pad = Math.floor((span - e.label.length) / 2)
          paint(grid, tx + 1 + pad, z1, e.label)
        }
      }
    } else {
      // Back edge: down the gutter to the target's label row, then in from
      // the right with a side arrowhead touching the box edge.
      const targetMidY = (rowTop[toLevel] ?? 0) + 1
      for (let yy = y1 + 1; yy <= targetMidY; yy++) paint(grid, g, yy, '│')
      paint(grid, g, targetMidY, '┤')
      const edge = (rights.get(e.to) ?? 0) + 1
      paint(grid, edge + 1, targetMidY, '─'.repeat(Math.max(0, g - edge - 2)))
      paint(grid, edge, targetMidY, e.arrow ? '▶' : '─')
    }
  }

  for (const e of graph.edges) {
    const fl = levels.get(e.from) ?? 0
    const tl = levels.get(e.to) ?? 0
    if (tl === fl + 1) {
      routeAdjacent(
        e,
        centers.get(e.from) ?? 0,
        centers.get(e.to) ?? 0,
        ...gapRows(fl),
      )
    } else if (tl === fl) {
      routeSameLevel(e, fl)
    } else {
      const key = `${e.from}\0${e.to}`
      if (!gutterXs.has(key)) {
        gutterEdges.push(e)
        if (gutterEdges.length > 4) return null
        gutterXs.set(key, gutterX)
        gutterX += 2
      }
    }
  }
  for (const e of gutterEdges) routeGutter(e)

  const lines = grid.map(row => row.join('').replace(/\s+$/, ''))
  if (graph.dir === 'BT') {
    return lines.reverse().map(l => mapGlyphs(l, FLIP_V)).join('\n')
  }
  return lines.join('\n')
}

/** LR/RL: levels are columns, connectors run horizontally. */
function layoutHorizontal(
  graph: { dir: FcDir; nodes: Map<string, FcNode>; edges: FcEdge[] },
): string | null {
  const ids = [...graph.nodes.keys()]
  const levels = assignLevels(ids, graph.edges)
  if (!levels) return null

  const maxLevel = Math.max(...[...levels.values()])
  const rows: string[][] = Array.from({ length: maxLevel + 1 }, () => [])
  for (const id of ids) (rows[levels.get(id) ?? 0] ?? []).push(id)

  // Column geometry: per-level column width = widest box; 3 gap columns.
  const colX: number[] = []
  const colW: number[] = []
  let x = 0
  for (let l = 0; l < rows.length; l++) {
    let w = 5
    for (const id of rows[l] ?? []) {
      const node = graph.nodes.get(id)!
      const inner = node.shape === 'diamond' ? `⟨${node.label}⟩` : node.label
      w = Math.max(w, inner.length + 4)
    }
    colX[l] = x
    colW[l] = w
    x += w + 3
  }
  // Vertical stacking within each column: 3 box rows + 3 gap rows.
  const boxTop = new Map<string, number>()
  const boxW = new Map<string, number>()
  let gridH = 3
  for (let l = 0; l < rows.length; l++) {
    let yL = 0
    for (const id of rows[l] ?? []) {
      const node = graph.nodes.get(id)!
      const inner = node.shape === 'diamond' ? `⟨${node.label}⟩` : node.label
      const w = inner.length + 4
      boxTop.set(id, yL)
      boxW.set(id, w)
      yL += BOX_H + 3
    }
    gridH = Math.max(gridH, yL - 3)
  }
  if (gridH > MAX_RENDER_ROWS) return null

  const grid: Grid = Array.from({ length: gridH }, () => [])
  const cy = new Map<string, number>()
  for (let l = 0; l < rows.length; l++) {
    for (const id of rows[l] ?? []) {
      const node = graph.nodes.get(id)!
      const w = boxW.get(id) ?? 5
      const top = boxTop.get(id) ?? 0
      const inner = node.shape === 'diamond' ? `⟨${node.label}⟩` : node.label
      const [tl, tr, bl, br] =
        node.shape === 'round' ? ['╭', '╮', '╰', '╯'] : ['┌', '┐', '└', '┘']
      paint(grid, colX[l] ?? 0, top, tl + '─'.repeat(w - 2) + tr)
      paint(grid, colX[l] ?? 0, top + 1, `│ ${inner} │`)
      paint(grid, colX[l] ?? 0, top + 2, bl + '─'.repeat(w - 2) + br)
      cy.set(id, top + 1)
    }
  }

  const gapCols = (fromLevel: number): [number, number, number] => {
    const base = (colX[fromLevel] ?? 0) + (colW[fromLevel] ?? 0)
    return [base, base + 1, base + 2]
  }

  const routeAdjacent = (
    e: FcEdge,
    sy: number,
    ty: number,
    x0: number,
    x1: number,
    x2: number,
  ): void => {
    const head = e.arrow ? '▶' : '─'
    if (sy === ty) {
      paint(grid, x0, sy, '─')
      if (x2 > x0 + 1) paint(grid, x0 + 1, sy, '─'.repeat(x2 - x0 - 1))
      paint(grid, x2, sy, head)
      if (e.label) {
        const span = x2 - x0 - 2
        if (span >= e.label.length) {
          const pad = Math.floor((span - e.label.length) / 2)
          paint(grid, x0 + 1 + pad, sy, e.label)
        }
      }
      return
    }
    paint(grid, x0, sy, '─')
    paint(grid, x1, sy, sy < ty ? '┐' : '┘')
    const top = Math.min(sy, ty)
    const bottom = Math.max(sy, ty)
    paint(grid, x1, top + 1, '│'.repeat(Math.max(0, bottom - top - 1)))
    paint(grid, x1, ty, sy < ty ? '└' : '┌')
    paint(grid, x2, ty, head)
  }

  // Same-level, level-skip and back edges: bottom gutter rows.
  const gutterEdges: FcEdge[] = []
  const gutterYs = new Map<string, number>()
  let gutterY = gridH + 2

  const routeGutter = (e: FcEdge): void => {
    const sx = (colX[levels.get(e.from) ?? 0] ?? 0) + Math.floor((boxW.get(e.from) ?? 5) / 2)
    const tx = (colX[levels.get(e.to) ?? 0] ?? 0) + Math.floor((boxW.get(e.to) ?? 5) / 2)
    const srcBottom = (boxTop.get(e.from) ?? 0) + BOX_H
    const targetBottom = (boxTop.get(e.to) ?? 0) + BOX_H
    const g = gutterYs.get(`${e.from}\0${e.to}`) ?? gutterY
    // The vertical segments must not cross another box in the same column —
    // boxes stack with 3 gap rows, but a gutter detour can descend past a
    // sibling box. Bail the fence (fail-safe) instead of drawing garbage.
    const crossesBox = (col: number, fromRow: number): boolean => {
      for (const id of ids) {
        const top = boxTop.get(id) ?? 0
        const level = levels.get(id) ?? 0
        const left = colX[level] ?? 0
        const w = boxW.get(id) ?? 5
        if (col >= left && col <= left + w - 1 && top + BOX_H > fromRow && top < g) {
          return true
        }
      }
      return false
    }
    if (crossesBox(sx, srcBottom) || crossesBox(tx, targetBottom)) return
    paint(grid, sx, srcBottom, '│')
    const left = Math.min(sx, tx)
    const right = Math.max(sx, tx)
    paint(grid, sx, g, '└')
    paint(grid, left + 1, g, '─'.repeat(right - left - 1))
    paint(grid, tx, g, '┘')
    for (let yy = targetBottom; yy < g; yy++) paint(grid, tx, yy, '│')
    paint(grid, tx, targetBottom, e.arrow ? '▲' : '│')
  }

  for (const e of graph.edges) {
    const fl = levels.get(e.from) ?? 0
    const tl = levels.get(e.to) ?? 0
    if (tl === fl + 1) {
      routeAdjacent(e, cy.get(e.from) ?? 0, cy.get(e.to) ?? 0, ...gapCols(fl))
    } else {
      const key = `${e.from}\0${e.to}`
      if (!gutterYs.has(key)) {
        gutterEdges.push(e)
        if (gutterEdges.length > 4) return null
        gutterYs.set(key, gutterY)
        gutterY += 2
      }
    }
  }
  for (const e of gutterEdges) routeGutter(e)

  const lines = grid.map(row => row.join('').replace(/\s+$/, ''))
  if (graph.dir === 'RL') {
    return lines.map(l => mapGlyphs(l, FLIP_H)).join('\n')
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Sequence diagram
// ---------------------------------------------------------------------------

type SeqParticipant = { id: string; label: string }
type SeqMessage = {
  from: string
  to: string
  label: string
  style: 'solid' | 'dashed'
  head: 'arrow' | 'cross' | 'open'
}
type SeqNote = {
  over: string[]
  position: 'over' | 'left' | 'right'
  text: string
}
type SeqFrame = { kind: 'loop' | 'opt' | 'alt'; title: string }
type WalkItem =
  | { kind: 'message'; msg: SeqMessage }
  | { kind: 'note'; note: SeqNote }
  | { kind: 'frame-open'; frame: SeqFrame }
  | { kind: 'frame-else'; label: string }
  | { kind: 'frame-close' }

const MSG_RE =
  /^([A-Za-z0-9_]+)\s*(-->>|->>|--x|-x|-->|->|--)\s*([A-Za-z0-9_]+)\s*:\s?(.*)$/

function collectSequenceItems(lines: string[]): WalkItem[] | null {
  const walk: WalkItem[] = []
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('%%') || line === 'autonumber') continue
    if (/^(activate|deactivate)\s+[A-Za-z0-9_]+$/.test(line)) continue
    if (/^[+-][A-Za-z0-9_]+$/.test(line)) continue
    if (/^(participant|actor)\s+/.test(line)) continue
    const note = /^note\s+(over|left of|right of)\s+([A-Za-z0-9_,\s]+?)\s*:\s?(.*)$/.exec(
      line,
    )
    if (note) {
      const over = (note[2] ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(s => s !== '')
      if (over.length === 0 || over.length > 3) return null
      walk.push({
        kind: 'note',
        note: {
          over,
          position:
            note[1] === 'over' ? 'over' : note[1] === 'left of' ? 'left' : 'right',
          text: (note[3] ?? '').slice(0, MAX_LABEL),
        },
      })
      continue
    }
    const frameOpen = /^(loop|opt|alt)\s+(.*)$/.exec(line)
    if (frameOpen) {
      walk.push({
        kind: 'frame-open',
        frame: {
          kind: frameOpen[1] as 'loop' | 'opt' | 'alt',
          title: (frameOpen[2] ?? '').slice(0, MAX_LABEL),
        },
      })
      continue
    }
    if (/^else\b/.test(line)) {
      walk.push({
        kind: 'frame-else',
        label: line.replace(/^else\s*/, '').slice(0, MAX_LABEL),
      })
      continue
    }
    if (line === 'end') {
      walk.push({ kind: 'frame-close' })
      continue
    }
    const msg = MSG_RE.exec(line)
    if (msg) {
      const head = msg[2] ?? ''
      walk.push({
        kind: 'message',
        msg: {
          from: msg[1] ?? '',
          to: msg[3] ?? '',
          label: (msg[4] ?? '').slice(0, MAX_LABEL),
          style: head.startsWith('--') ? 'dashed' : 'solid',
          head: head.endsWith('x') ? 'cross' : head.endsWith('>') ? 'arrow' : 'open',
        },
      })
      continue
    }
    return null // unknown line → whole fence stays code
  }
  return walk
}

function renderSequence(lines: string[]): string | null {
  // Participants: declaration order first, then first-use order.
  const participants: SeqParticipant[] = []
  const ensure = (id: string, label?: string): void => {
    const existing = participants.find(p => p.id === id)
    if (existing) {
      if (label !== undefined) existing.label = label
      return
    }
    participants.push({ id, label: label ?? id })
  }
  for (const rawLine of lines) {
    const line = rawLine.trim()
    const decl = /^(participant|actor)\s+([A-Za-z0-9_]+)(?:\s+as\s+(.*))?$/.exec(line)
    if (decl) ensure(decl[2] ?? '', decl[3]?.trim())
  }
  const walk = collectSequenceItems(lines)
  if (walk === null) return null
  for (const item of walk) {
    if (item.kind === 'message') {
      ensure(item.msg.from)
      ensure(item.msg.to)
    } else if (item.kind === 'note') {
      for (const id of item.note.over) ensure(id)
    }
  }
  if (participants.length === 0 || participants.length > MAX_PARTICIPANTS) {
    return null
  }
  const messageCount = walk.filter(i => i.kind === 'message').length
  if (messageCount === 0 || messageCount > MAX_MESSAGES) return null

  // Balance frames.
  const frames: {
    frame: SeqFrame
    startIdx: number
    endIdx: number
    elseIdx: number[]
  }[] = []
  {
    const stack: { frame: SeqFrame; startIdx: number; elseIdx: number[] }[] = []
    for (let idx = 0; idx < walk.length; idx++) {
      const item = walk[idx]!
      if (item.kind === 'frame-open') {
        stack.push({ frame: item.frame, startIdx: idx, elseIdx: [] })
      } else if (item.kind === 'frame-else') {
        const top = stack[stack.length - 1]
        if (!top) return null
        top.elseIdx.push(idx)
      } else if (item.kind === 'frame-close') {
        const top = stack.pop()
        if (!top) return null
        frames.push({
          frame: top.frame,
          startIdx: top.startIdx,
          endIdx: idx,
          elseIdx: top.elseIdx,
        })
      }
    }
    if (stack.length > 0) return null
  }

  // Column layout: gap sized by the widest label between the two neighbors.
  const gapFor = (a: string, b: string): number => {
    let need = 12
    for (const item of walk) {
      if (item.kind === 'message') {
        const m = item.msg
        if ((m.from === a && m.to === b) || (m.from === b && m.to === a)) {
          need = Math.max(need, m.label.length + 8)
        }
      } else if (item.kind === 'note') {
        const n = item.note
        if (n.over.length === 2 && n.over.includes(a) && n.over.includes(b)) {
          need = Math.max(need, n.text.length + 6)
        }
      }
    }
    return Math.min(40, need)
  }
  const centers: number[] = []
  const widths: number[] = []
  {
    let x = 0
    for (let i = 0; i < participants.length; i++) {
      const p = participants[i]!
      const w = p.label.length + 2
      if (i > 0) x += gapFor(participants[i - 1]!.id, p.id)
      centers.push(x + Math.floor(w / 2))
      widths.push(w)
      x += w
    }
  }
  const cxOf = (id: string): number => {
    const idx = participants.findIndex(p => p.id === id)
    return idx === -1 ? 0 : (centers[idx] ?? 0)
  }
  const totalW =
    (centers[centers.length - 1] ?? 0) +
    Math.ceil(((widths[widths.length - 1] ?? 0) + 1) / 2) +
    2

  const rows: Grid = []
  const at = (y: number, x: number, s: string): void => {
    while (rows.length <= y) rows.push([])
    paint(rows, x, y, s)
  }
  const drawLifelines = (y: number): void => {
    for (const cx of centers) at(y, cx, '│')
  }

  // Header: participant boxes.
  for (let line = 0; line < BOX_H; line++) {
    drawLifelines(line)
    participants.forEach((p, i) => {
      const w = widths[i] ?? 0
      const x0 = (centers[i] ?? 0) - Math.floor(w / 2)
      const border =
        line === 1
          ? `│${p.label.padEnd(w - 2).slice(0, w - 2)}│`
          : `${line === 2 ? '└' : '┌'}${'─'.repeat(w - 2)}${line === 2 ? '┘' : '┐'}`
      at(line, x0, border)
    })
  }
  let y = BOX_H

  const itemTop: number[] = []
  const itemBottom: number[] = []

  for (let idx = 0; idx < walk.length; idx++) {
    const item = walk[idx]!
    itemTop[idx] = y
    if (item.kind === 'message') {
      const { from, to, label, style, head } = item.msg
      const fx = cxOf(from)
      const tx = cxOf(to)
      if (from === to) {
        // Self message: ─┐ / label / ◀┘
        drawLifelines(y)
        drawLifelines(y + 1)
        drawLifelines(y + 2)
        at(y, fx + 1, '─┐')
        at(y + 1, fx + 4, label)
        at(y + 2, fx, head === 'open' ? '─' : head === 'cross' ? 'X' : '◀')
        at(y + 2, fx + 1, '─┘')
        y += 3
      } else {
        const left = Math.min(fx, tx)
        const right = Math.max(fx, tx)
        drawLifelines(y)
        drawLifelines(y + 1)
        if (label !== '') {
          const start = left + Math.max(0, Math.floor((right - left - label.length) / 2))
          at(y, start, label)
        }
        const fill = style === 'dashed' ? '┄' : '─'
        const rightward = fx <= tx
        const headCh =
          head === 'cross'
            ? 'X'
            : rightward
              ? (style === 'dashed' ? '⇢' : head === 'open' ? '▷' : '▶')
              : (style === 'dashed' ? '⇠' : head === 'open' ? '◁' : '◀')
        // Fill strictly between the lifelines; the source lifeline stays
        // intact and the head lands on the target lifeline column.
        for (let c = left + 1; c < right; c++) at(y + 1, c, fill)
        at(y + 1, tx, headCh)
        y += 2
      }
    } else if (item.kind === 'note') {
      const n = item.note
      const cols = n.over.map(cxOf)
      const baseW = Math.max(8, n.text.length + 2)
      let x0: number
      let x1: number
      if (n.position === 'over') {
        const lo = Math.min(...cols)
        const hi = Math.max(...cols)
        if (cols.length === 1) {
          x0 = lo - Math.floor(baseW / 2)
          x1 = x0 + baseW
        } else {
          const mid = (lo + hi) / 2
          x0 = Math.round(Math.min(lo - 2, mid - baseW / 2))
          x1 = Math.round(Math.max(hi + 2, x0 + baseW))
        }
      } else if (n.position === 'left') {
        x1 = cols[0]! - 2
        x0 = x1 - baseW
      } else {
        x0 = cols[0]! + 2
        x1 = x0 + baseW
      }
      x0 = Math.max(0, x0)
      x1 = Math.max(x0 + baseW, x1)
      drawLifelines(y)
      drawLifelines(y + 1)
      drawLifelines(y + 2)
      at(y, x0, `┌${'─'.repeat(x1 - x0 - 1)}┐`)
      at(y + 1, x0, `│${n.text.padEnd(x1 - x0 - 1).slice(0, x1 - x0 - 1)}│`)
      at(y + 2, x0, `└${'─'.repeat(x1 - x0 - 1)}┘`)
      y += 3
    } else {
      // frame-open / frame-else / frame-close: one row, borders painted later.
      drawLifelines(y)
      y += 1
    }
    itemBottom[idx] = y
  }

  drawLifelines(y)
  y += 1

  // Frames painted last (outermost first): dashed side rails, title tab.
  for (const f of frames) {
    const involved = new Set<string>()
    for (let idx = f.startIdx; idx <= f.endIdx; idx++) {
      const item = walk[idx]
      if (!item) continue
      if (item.kind === 'message') {
        involved.add(item.msg.from)
        involved.add(item.msg.to)
      } else if (item.kind === 'note') {
        for (const id of item.note.over) involved.add(id)
      }
    }
    const cols = [...involved].map(cxOf)
    const lo = Math.max(0, Math.min(...cols) - 2)
    const hi = Math.min(totalW, Math.max(...cols) + 2)
    const top = itemTop[f.startIdx] ?? 0
    const bottom = itemBottom[f.endIdx] ?? top
    at(top, lo, `┌${'─'.repeat(Math.max(0, hi - lo - 1))}┐`)
    at(top, lo + 2, `[${f.frame.kind}] ${f.frame.title}`.slice(0, Math.max(0, hi - lo - 3)))
    for (let yy = top + 1; yy < bottom; yy++) {
      const l = rows[yy]?.[lo]
      if (l === undefined || l === ' ') at(yy, lo, '╎')
      const r = rows[yy]?.[hi]
      if (r === undefined || r === ' ') at(yy, hi, '╎')
    }
    at(bottom, lo, `└${'─'.repeat(Math.max(0, hi - lo - 1))}┘`)
    for (const ei of f.elseIdx) {
      const ey = itemTop[ei] ?? top
      at(ey, lo, '├')
      at(ey, hi, '┤')
      const label = walk[ei]?.kind === 'frame-else'
        ? (walk[ei] as { kind: 'frame-else'; label: string }).label
        : ''
      at(ey, lo + 2, `[else] ${label}`.slice(0, Math.max(0, hi - lo - 3)))
    }
  }

  if (rows.length > MAX_RENDER_ROWS) return null
  return rows.map(row => row.join('').replace(/\s+$/, '')).join('\n')
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export const mermaidBuiltinMod: BuiltinModSpec = {
  name: 'mermaid',
  version: '1.0.0',
  description:
    'Draw mermaid code fences (flowchart, sequence diagram) as box-drawing text in assistant replies',
  register(ctx: ModContext): void {
    ctx.on('ui.render', (e, next) => {
      // Cheap pre-check before any parsing work.
      if (!e.text.includes('mermaid')) return next()
      const out = renderMermaidFences(e.text)
      return out === e.text ? next() : out
    })
  },
}
