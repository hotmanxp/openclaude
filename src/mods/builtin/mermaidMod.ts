import { stringWidth } from '../../ink/stringWidth.js'
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
const MAX_NODES = 64
const MAX_EDGES = 120
const MAX_PARTICIPANTS = 12
const MAX_MESSAGES = 60
const MAX_RENDER_ROWS = 200
const MAX_GUTTER_EDGES = 24
const MAX_CLUSTERS = 8
/** Blank columns/rows reserved per cluster nesting level so frames fit. */
const FRAME_PAD = 2
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

/**
 * A painted row is stored as an array of CELL STRINGS, one per terminal column.
 * A CJK glyph is a single cell whose rendered width is 2, so `x` is always a
 * display column and never an array index — indexing by array slot instead
 * would shift everything after a wide glyph one column to the left.
 */
type Grid = string[][]

function paint(grid: Grid, x: number, y: number, s: string): void {
  if (y < 0 || y >= grid.length || x < 0) return
  const row = grid[y] ?? []
  let col = x
  for (const ch of s) {
    const w = stringWidth(ch)
    while (row.length < col + w) row.push(' ')
    // A wide glyph owns its first column; the rest stay blank so a later
    // write at col+w lands exactly one glyph to the right on screen.
    row[col] = ch
    for (let k = 1; k < w; k++) row[col + k] = ''
    col += w
  }
  grid[y] = row
}

/**
 * Join a painted row by DISPLAY column. The grid is indexed by array slot, but
 * a CJK glyph occupies two terminal columns, so a plain `join('')` yields rows
 * whose visible width depends on whether they contain CJK — borders that were
 * drawn in the same column then land in different places on screen. Pad each
 * row to the grid's display width and trim the trailing whitespace.
 */
function rowToString(row: string[], targetWidth: number): string {
  let out = ''
  let col = 0
  for (const ch of row) {
    out += ch
    col += stringWidth(ch)
  }
  if (col < targetWidth) out += ' '.repeat(targetWidth - col)
  return out.replace(/\s+$/, '')
}

/** Display width of the widest painted row in the grid. */
function gridDisplayWidth(grid: Grid): number {
  let w = 0
  for (const row of grid) {
    let c = 0
    for (const ch of row) c += stringWidth(ch)
    if (c > w) w = c
  }
  return w
}

function gridToString(grid: Grid): string {
  const w = gridDisplayWidth(grid)
  return grid.map(row => rowToString(row, w)).join('\n')
}

// ---------------------------------------------------------------------------
// Flowchart
// ---------------------------------------------------------------------------

type FcShape = 'rect' | 'round' | 'diamond'
type FcNode = { label: string; shape: FcShape }
type FcEdge = { from: string; to: string; label?: string; arrow: boolean }
type FcDir = 'TD' | 'BT' | 'LR' | 'RL'
/** A `subgraph` cluster — a titled box drawn around its member nodes. */
type FcCluster = {
  id: string
  title: string
  /** Nodes inside this cluster. A nested cluster registers its members with
   *  every open ancestor, so an ancestor's list is already complete. */
  members: string[]
  /** 0 for top-level clusters; outer borders are drawn first. */
  depth: number
}
type PlacedBox = { x: number; y: number; w: number; h: number }

/** Longest-first: `-\.->` before `-\.-`, `===` last so `==>` wins its prefix. */
const EDGE_OP_RE = /(-\.->|-\.-|-->|==>|---|===)/

/**
 * Mermaid's most common edge-label form is INLINE — `A -- text --> B`, where
 * the label sits between the two halves of the arrow. The line splitter only
 * understands the pipe form `A -->|text| B`, so an inline-labelled line leaves
 * `A -- text` as an unparseable node token and the whole diagram is dropped
 * (fail-safe keeps the original fence, so the user just sees raw code).
 * Rewrite inline forms onto the pipe form before splitting.
 *
 * Opening and closing tokens mirror each other: `--` closes with `-->` or
 * `---`, `-.` with `.->` or `.--`, `==` with `==>` or `===`.
 */
const INLINE_EDGE_LABEL_RE =
  /(--|==|-\.)[ \t]+([^|\n]*?)[ \t]+(-->|==>|\.->|---|\.-->|===)/g

/** Closing token of an inline edge label → canonical edge operator. */
const INLINE_EDGE_OP: Record<string, string> = {
  '-->': '-->',
  '---': '---',
  '.->': '-.->',
  '.--': '-.-',
  '==>': '==>',
  '===': '===',
}

function normalizeInlineEdgeLabels(line: string): string {
  if (!line.includes('-') && !line.includes('=')) return line
  return line.replace(
    INLINE_EDGE_LABEL_RE,
    (_match, _open: string, label: string, close: string) =>
      `${INLINE_EDGE_OP[close] ?? close}|${label.trim()}|`,
  )
}

function stripSurroundingQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Read the label inside an opening bracket, honoring quoted spans so a label
 * may contain its own closing bracket (`A["return ModLoadResult[]"]`). A plain
 * `[^\]]*` character class stops at that inner `]` and leaves a dangling
 * quote, which then fails the trailing anchor and drops the whole diagram.
 * Returns the inner text plus the index just past the closing bracket.
 */
function readBracketed(
  token: string,
  start: number,
  close: string,
): { inner: string; end: number } | null {
  let i = start
  let quote: string | undefined
  while (i < token.length) {
    const ch = token[i] as string
    if (quote !== undefined) {
      if (ch === quote) quote = undefined
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === close) {
      return { inner: token.slice(start, i), end: i + 1 }
    }
    i++
  }
  return null
}

function parseNodeToken(
  token: string,
): { id: string; def?: FcNode } | null {
  const idMatch = /^([A-Za-z0-9_]+)/.exec(token)
  if (!idMatch) return null
  const id = idMatch[1] ?? ''
  if (id === '') return null

  const rest = token.slice(id.length).trim()
  let raw: string | undefined
  let shape: FcShape = 'rect'
  if (rest !== '') {
    const open = rest[0] as string
    if (open !== '[' && open !== '(' && open !== '{') return null
    const close = open === '[' ? ']' : open === '(' ? ')' : '}'
    const scanned = readBracketed(rest, 1, close)
    if (!scanned || scanned.end !== rest.length) return null
    raw = scanned.inner.trim()
    if (open === '(') shape = 'round'
    else if (open === '{') shape = 'diamond'
  }
  if (raw === undefined) return { id }
  let label = stripSurroundingQuotes(raw)
  label = label.replace(/<br\s*\/?>/gi, ' ').trim()
  if (label.length > MAX_LABEL) label = `${label.slice(0, MAX_LABEL - 1)}…`
  return { id, def: { label: label === '' ? id : label, shape } }
}

function parseFlowchart(
  header: string,
  lines: string[],
): {
  dir: FcDir
  nodes: Map<string, FcNode>
  edges: FcEdge[]
  clusters: FcCluster[]
} | null {
  const dirMatch = /(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\s*$/i.exec(header)
  if (!dirMatch) return null
  const rawDir = (dirMatch[1] ?? 'TD').toUpperCase()
  const dir: FcDir = rawDir === 'TB' ? 'TD' : (rawDir as FcDir)

  const nodes = new Map<string, FcNode>()
  const edges: FcEdge[] = []
  const clusters: FcCluster[] = []
  // Stack of open subgraphs; a node/edge seen while N are open belongs to all N.
  const open: FcCluster[] = []
  let clusterSeq = 0
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('%%')) continue

    // `subgraph [id] [title]` … `end`, nestable.
    if (/^subgraph\b/i.test(line)) {
      if (clusters.length >= MAX_CLUSTERS) return null
      const rest = line.replace(/^subgraph\b/i, '').trim()
      // `subgraph id` → id only; `subgraph id [Title]` / `subgraph [Title]`
      // → bracketed title. Anything else is a bare title.
      let id = ''
      let title = ''
      const bracket = /^([A-Za-z0-9_]+)?\s*\[(.*)\]$/.exec(rest)
      if (bracket) {
        id = (bracket[1] ?? '').trim()
        title = (bracket[2] ?? '').trim()
      } else {
        const bare = /^([A-Za-z0-9_]+)$/.exec(rest)
        if (bare && rest !== '') id = bare[1] ?? ''
        else title = rest
      }
      if (id === '') id = `sg${clusterSeq}`
      title = stripSurroundingQuotes(title)
        .replace(/<br\s*\/?>/gi, ' ')
        .trim()
      if (title.length > MAX_LABEL) title = `${title.slice(0, MAX_LABEL - 1)}…`
      const cluster: FcCluster = {
        id,
        title,
        members: [],
        depth: open.length,
      }
      clusterSeq++
      clusters.push(cluster)
      open.push(cluster)
      continue
    }
    if (/^end\b/i.test(line) || line.toLowerCase() === 'end') {
      if (open.length === 0) return null // stray `end` — malformed
      open.pop()
      continue
    }
    if (
      /^(classDef|class|style|click|linkStyle|direction)\b/.test(line)
    ) {
      continue
    }

    const pieces = normalizeInlineEdgeLabels(line).split(EDGE_OP_RE)
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
            label = stripSurroundingQuotes((pipe[1] ?? '').trim())
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
      // Membership is per open cluster, so a nested node joins every ancestor.
      for (const c of open) {
        if (!c.members.includes(parsed.id)) c.members.push(parsed.id)
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
          arrow: step.op !== '---' && step.op !== '-.-' && step.op !== '===',
        })
      } else if (step.op !== undefined) {
        return null
      }
      current = parsed.id
    }
  }

  if (open.length > 0) return null // unterminated subgraph
  // Drop empty clusters (a subgraph with no nodes has nothing to wrap).
  const nonEmpty = clusters.filter(c => c.members.length > 0)
  // A node claimed by two same-depth clusters would make their frames
  // overlap, which cannot be drawn legibly — keep the fence as code.
  {
    const byNode = new Map<string, Map<number, number>>()
    for (const c of nonEmpty) {
      for (const m of c.members) {
        const d = byNode.get(m) ?? new Map<number, number>()
        d.set(c.depth, (d.get(c.depth) ?? 0) + 1)
        byNode.set(m, d)
      }
    }
    for (const depths of byNode.values()) {
      for (const n of depths.values()) if (n > 1) return null
    }
  }
  if (nodes.size === 0 || nodes.size > MAX_NODES || edges.length === 0) {
    return null
  }
  return { dir, nodes, edges, clusters: nonEmpty }
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
/**
 * Pad (or truncate) to an exact terminal column count. `String.padEnd` counts
 * code units, so a CJK label padded to N columns still overflows and pushes the
 * closing border off-align — pad by display width instead.
 */
function padToWidth(text: string, columns: number): string {
  let out = ''
  let used = 0
  for (const ch of text) {
    const cw = stringWidth(ch)
    if (used + cw > columns) break
    out += ch
    used += cw
  }
  return out + ' '.repeat(Math.max(0, columns - used))
}

function drawBox(
  grid: Grid,
  x: number,
  y: number,
  label: string,
  shape: FcShape,
): { cx: number; w: number } {
  const inner = shape === 'diamond' ? `⟨${label}⟩` : label
  const w = stringWidth(inner) + 4
  const [tl, tr, bl, br] =
    shape === 'round' ? ['╭', '╮', '╰', '╯'] : ['┌', '┐', '└', '┘']
  paint(grid, x, y, tl + '─'.repeat(w - 2) + tr)
  paint(grid, x, y + 1, `│ ${padToWidth(inner, w - 4)} │`)
  paint(grid, x, y + 2, bl + '─'.repeat(w - 2) + br)
  return { cx: x + Math.floor(w / 2), w }
}

type FcGraph = {
  dir: FcDir
  nodes: Map<string, FcNode>
  edges: FcEdge[]
  clusters: FcCluster[]
}

/** Glyphs a cluster frame is allowed to overwrite (its own border, plus
 *  connector run/turn characters that a frame may legitimately cross). */
function isFrameBorder(ch: string): boolean {
  return '┌┐└┘─│├┤┬┴┼╭╮╰╯╎'.includes(ch)
}

/** Ensure the grid is tall/wide enough that a later paint at (x, y) lands. */
function growGrid(grid: Grid, width: number, height?: number): void {
  const rows = height ?? grid.length
  while (grid.length < rows) grid.push([])
  if (width > 0) for (const row of grid) while (row.length < width) row.push(' ')
}

/** Draw each cluster's frame around its members' placed boxes. Outer clusters
 *  first so a nested frame lands on top. A frame is skipped rather than
 *  allowed to collide with a node it does not contain. */
function drawClusterFrames(
  grid: Grid,
  clusters: FcCluster[],
  boxes: Map<string, PlacedBox>,
): void {
  // Cells already claimed by a cluster border. A nested frame is allowed to
  // overlay its ancestors' borders, but must not touch node content.
  const frameCells = new Set<string>()
  const claim = (x: number, y: number): void => {
    frameCells.add(`${x}\0${y}`)
  }
  const isFrameCell = (x: number, y: number): boolean =>
    frameCells.has(`${x}\0${y}`)
  const ordered = [...clusters].sort((a, b) => a.depth - b.depth)
  for (const c of ordered) {
    const placed = c.members
      .map(id => boxes.get(id))
      .filter((b): b is PlacedBox => b !== undefined)
    if (placed.length === 0) continue
    const member = new Set(c.members)
    // The frame hugs the members one column / one row outside their boxes.
    const x0 = Math.min(...placed.map(b => b.x)) - 1
    const x1 = Math.max(...placed.map(b => b.x + b.w))
    const y0 = Math.min(...placed.map(b => b.y)) - 1
    const y1 = Math.max(...placed.map(b => b.y + b.h))

    // Refuse to paint over a NON-member node or an edge glyph: a frame that
    // would cut through unrelated content is worse than no frame at all.
    let blocked = false
    for (const [id, b] of boxes) {
      if (member.has(id)) continue
      const overlaps =
        b.x + b.w > x0 && b.x < x1 && b.y + b.h > y0 && b.y < y1
      if (overlaps) {
        blocked = true
        break
      }
    }
    if (blocked) continue
    // The frame's own ring must be clear of anything but border glyphs. The
    // interior is the members' own territory and is intentionally ignored.
    for (let y = y0; y <= y1 && !blocked; y++) {
      const onRing = y === y0 || y === y1
      for (let x = x0; x <= x1; x++) {
        if (!onRing && x !== x0 && x !== x1) continue
        const ch = grid[y]?.[x]
        if (ch === undefined || ch === '' || ch === ' ') continue
        if (isFrameCell(x, y) || isFrameBorder(ch)) continue
        blocked = true
        break
      }
    }
    if (blocked) continue

    const width = x1 - x0 + 1
    const title = c.title === '' ? c.id : c.title
    const head = title === '' ? '' : ` ${title} `
    const headW = stringWidth(head)
    // Too narrow for the title? Fall back to a plain rule rather than
    // silently truncating it — a half-written label reads as corruption.
    // `┌─` (2) + head + filler + `┐` (1) must equal `width` columns. When the
    // title is too wide for the top rule, it goes on its own line inside the
    // frame instead of being dropped — a missing label reads as a bug.
    const fitsInRule = headW + 3 <= width
    // A nested frame shares rows with its ancestor, so its top rule starts one
    // column in — writing over the ancestor's corner leaves a broken joint.
    const indent = c.depth > 0 && isFrameCell(x0, y0) ? 1 : 0
    if (indent > 0) paint(grid, x0, y0, '│')
    const topRule = fitsInRule
      ? `${'─'.repeat(indent)}┌─${head}${'─'.repeat(Math.max(0, width - headW - 3 - indent))}┐`
      : `${'─'.repeat(indent)}┌${'─'.repeat(Math.max(0, width - 2 - indent))}┐`
    paint(grid, x0, y0, topRule)
    for (let k = 0; k < width; k++) claim(x0 + k, y0)
    for (let y = y0 + 1; y < y1; y++) {
      paint(grid, x0, y, '│')
      paint(grid, x1, y, '│')
      claim(x0, y)
      claim(x1, y)
    }
    if (!fitsInRule) {
      // The frame is too narrow for the full title. Truncate to what fits on
      // its own line rather than dropping the label entirely.
      const inner = width - 2
      const shown =
        headW <= inner ? title : `${[...title].slice(0, Math.max(0, Math.floor(inner / 2) - 1)).join('')}…`
      if (stringWidth(shown) <= inner && y0 + 1 < y1 - 1) {
        paint(grid, x0 + 1, y0 + 1, ` ${padToWidth(shown, inner)} `)
      }
    }
    paint(grid, x0, y1, `└${'─'.repeat(Math.max(0, width - 2))}┘`)
    for (let k = 0; k < width; k++) claim(x0 + k, y1)
  }
}

function layoutFlowchart(graph: FcGraph): string | null {
  if (graph.dir === 'LR' || graph.dir === 'RL') return layoutHorizontal(graph)
  return layoutVertical(graph)
}

/** TD/TB/BT: levels are rows, connectors run vertically. */
function layoutVertical(graph: FcGraph): string | null {
  const ids = [...graph.nodes.keys()]
  const levels = assignLevels(ids, graph.edges)
  if (!levels) return null

  const maxLevel = Math.max(...[...levels.values()])
  const rows: string[][] = Array.from({ length: maxLevel + 1 }, () => [])
  for (const id of ids) (rows[levels.get(id) ?? 0] ?? []).push(id)

  // Geometry: each level = 3 box lines + 3 gap lines. Clusters add a blank
  // line above and below so their horizontal frame rules have room.
  const maxDepth = graph.clusters.reduce((m, c) => Math.max(m, c.depth + 1), 0)
  const rowPad = maxDepth > 0 ? FRAME_PAD : 0
  const rowTop: number[] = []
  let y = rowPad
  for (let l = 0; l < rows.length; l++) {
    rowTop[l] = y
    y += BOX_H + GAP_H + rowPad
  }
  const gridH = y - GAP_H + rowPad
  if (gridH > MAX_RENDER_ROWS) return null

  const grid: Grid = Array.from({ length: gridH }, () => [])
  const centers = new Map<string, number>()
  const rights = new Map<string, number>()
  const boxes = new Map<string, PlacedBox>()
  // Depth of the DEEPEST cluster each node belongs to — its frame needs one
  // column of clearance per level, indented from the level's left edge.
  const depthOf = (id: string): number => {
    let d = 0
    for (const c of graph.clusters) if (c.members.includes(id)) d = Math.max(d, c.depth + 1)
    return d
  }
  // Widest title at each nesting level, so an inner frame's top-left corner
  // never lands on an ancestor's title text.
  const titleAtDepth = new Map<number, number>()
  for (const c of graph.clusters) {
    const t = stringWidth(c.title === '' ? c.id : c.title) + 5
    titleAtDepth.set(c.depth, Math.max(titleAtDepth.get(c.depth) ?? 0, t))
  }
  const indentFor = (d: number): number => {
    let n = 0
    for (let k = 0; k < d; k++) n += Math.max(FRAME_PAD, titleAtDepth.get(k) ?? 0)
    return n
  }
  for (let l = 0; l < rows.length; l++) {
    const rowDepth = Math.max(0, ...(rows[l] ?? []).map(depthOf))
    let x = indentFor(rowDepth)
    for (const id of rows[l] ?? []) {
      const node = graph.nodes.get(id)!
      // Widen the node so the enclosing frame has room for its title: the frame
      // is two columns wider than its members, plus `┌─ title ─…─┐`.
      const d = depthOf(id)
      const cluster = graph.clusters.find(
        c => c.depth + 1 === d && c.members.includes(id),
      )
      const titleNeed = cluster
        ? Math.max(
            stringWidth(cluster.title === '' ? cluster.id : cluster.title) + 5,
            ...[...titleAtDepth.values()],
          )
        : 0
      // Budget must cover the shape's own decoration: drawBox wraps a diamond
      // in ⟨⟩. Pass the LABEL and let drawBox add them, so we don't double up.
      const text =
        node.shape === 'diamond' ? `⟨${node.label}⟩` : node.label
      const base = stringWidth(text) + 2
      const widened =
        base < titleNeed ? padToWidth(text, titleNeed) : node.label
      const box = drawBox(grid, x, rowTop[l] ?? 0, widened, node.shape)
      centers.set(id, box.cx)
      rights.set(id, x + box.w - 1)
      boxes.set(id, { x, y: rowTop[l] ?? 0, w: box.w, h: BOX_H })
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
      if (span >= stringWidth(e.label)) {
        const pad = Math.floor((span - stringWidth(e.label)) / 2)
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
      if (span >= stringWidth(e.label)) {
        const pad = Math.floor((span - stringWidth(e.label)) / 2)
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
        if (span >= stringWidth(e.label)) {
          const pad = Math.floor((span - stringWidth(e.label)) / 2)
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
        if (gutterEdges.length > MAX_GUTTER_EDGES) return null
        gutterXs.set(key, gutterX)
        gutterX += 2
      }
    }
  }
  for (const e of gutterEdges) routeGutter(e)

  // Cluster frames sit outside the node boxes, so draw them after routing.
  growGrid(grid, gutterX + 2, gridH + 2)
  drawClusterFrames(grid, graph.clusters, boxes)

  const w = gridDisplayWidth(grid)
  const lines = grid.map(row => rowToString(row, w))
  if (graph.dir === 'BT') {
    return lines.reverse().map(l => mapGlyphs(l, FLIP_V)).join('\n')
  }
  return lines.join('\n')
}

/** LR/RL: levels are columns, connectors run horizontally. */
function layoutHorizontal(graph: FcGraph): string | null {
  const ids = [...graph.nodes.keys()]
  const levels = assignLevels(ids, graph.edges)
  if (!levels) return null

  const maxLevel = Math.max(...[...levels.values()])
  const rows: string[][] = Array.from({ length: maxLevel + 1 }, () => [])
  for (const id of ids) (rows[levels.get(id) ?? 0] ?? []).push(id)

  // Cluster frames need a blank column/row per nesting level.
  const depthOf = (id: string): number => {
    let d = 0
    for (const c of graph.clusters) if (c.members.includes(id)) d = Math.max(d, c.depth + 1)
    return d
  }
  const clusterSetOf = (ids: string[]): Set<string> => {
    const out = new Set<string>()
    for (const id of ids) {
      for (const c of graph.clusters) if (c.members.includes(id)) out.add(c.id)
    }
    return out
  }
  const maxDepth = graph.clusters.reduce((m, c) => Math.max(m, c.depth + 1), 0)
  const pad = maxDepth > 0 ? FRAME_PAD : 0

  // Column geometry: per-level column width = widest box; 3 gap columns, plus
  // one leading indent column per cluster nesting level.
  const colX: number[] = []
  const colW: number[] = []
  let x = pad
  for (let l = 0; l < rows.length; l++) {
    let w = 5
    for (const id of rows[l] ?? []) {
      const node = graph.nodes.get(id)!
      const inner = node.shape === 'diamond' ? `⟨${node.label}⟩` : node.label
      w = Math.max(w, stringWidth(inner) + 4)
    }
    colX[l] = x
    colW[l] = w
    // Two adjacent columns that belong to DIFFERENT clusters each carry a
    // frame wall, so the gap must fit both plus the connector between them.
    const leadSet = clusterSetOf(rows[l] ?? [])
    const nextSet = l + 1 < rows.length ? clusterSetOf(rows[l + 1] ?? []) : new Set<string>()
    const split = leadSet.size !== nextSet.size || [...leadSet].some(id => !nextSet.has(id))
    x += w + 3 + (split ? 2 * pad : 0)
  }
  // Vertical stacking within each column: 3 box rows + 3 gap rows.
  const boxTop = new Map<string, number>()
  const boxW = new Map<string, number>()
  let gridH = 3 + pad
  for (let l = 0; l < rows.length; l++) {
    const colDepth = Math.max(0, ...(rows[l] ?? []).map(depthOf))
    let yL = pad
    for (const id of rows[l] ?? []) {
      const node = graph.nodes.get(id)!
      const inner = node.shape === 'diamond' ? `⟨${node.label}⟩` : node.label
      const w = stringWidth(inner) + 4
      // Indent deeper members so their frames nest instead of overlapping.
      const d = Math.max(0, colDepth - depthOf(id))
      boxTop.set(id, yL + d * FRAME_PAD)
      boxW.set(id, w)
      yL += BOX_H + 3
    }
    gridH = Math.max(gridH, yL - 3 + pad)
  }
  if (gridH > MAX_RENDER_ROWS) return null

  const grid: Grid = Array.from({ length: gridH }, () => [])
  const cy = new Map<string, number>()
  const boxes = new Map<string, PlacedBox>()
  for (let l = 0; l < rows.length; l++) {
    for (const id of rows[l] ?? []) {
      const node = graph.nodes.get(id)!
      const w = boxW.get(id) ?? 5
      const top = boxTop.get(id) ?? 0
      const inner = node.shape === 'diamond' ? `⟨${node.label}⟩` : node.label
      const [tl, tr, bl, br] =
        node.shape === 'round' ? ['╭', '╮', '╰', '╯'] : ['┌', '┐', '└', '┘']
      paint(grid, colX[l] ?? 0, top, tl + '─'.repeat(w - 2) + tr)
      paint(grid, colX[l] ?? 0, top + 1, `│ ${padToWidth(inner, w - 4)} │`)
      paint(grid, colX[l] ?? 0, top + 2, bl + '─'.repeat(w - 2) + br)
      cy.set(id, top + 1)
      boxes.set(id, { x: colX[l] ?? 0, y: top, w, h: BOX_H })
    }
  }

  // 3 gap columns between a box's right wall and the next box's left wall;
  // the arrowhead lands in the middle one so the run is symmetric.
  const gapCols = (fromLevel: number): [number, number, number] => {
    // Start after the source column AND its cluster frame wall, so the arrow
    // leaves the cluster cleanly instead of overlapping the wall.
    const frame = pad > 0 ? 1 : 0
    const base = (colX[fromLevel] ?? 0) + (colW[fromLevel] ?? 0) + frame
    return [base, base + 1, base + 1]
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
        if (span >= stringWidth(e.label)) {
          const pad = Math.floor((span - stringWidth(e.label)) / 2)
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
        if (gutterEdges.length > MAX_GUTTER_EDGES) return null
        gutterYs.set(key, gutterY)
        gutterY += 2
      }
    }
  }
  for (const e of gutterEdges) routeGutter(e)

  if (graph.clusters.length > 0) {
    let width = 0
    for (const row of grid) width = Math.max(width, row.length)
    growGrid(grid, width, grid.length + pad)
    drawClusterFrames(grid, graph.clusters, boxes)
  }

  const w = gridDisplayWidth(grid)
  const lines = grid.map(row => rowToString(row, w))
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
    if (/^(activate|deactivate)\s+[A-Za-z0-9_]+$/i.test(line)) continue
    if (/^[+-][A-Za-z0-9_]+$/.test(line)) continue
    if (/^(participant|actor)\s+/i.test(line)) continue
    const note = /^note\s+(over|left of|right of)\s+([A-Za-z0-9_,\s]+?)\s*:\s?(.*)$/i.exec(
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
    const frameOpen = /^(loop|opt|alt)\s+(.*)$/i.exec(line)
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
    if (/^else\b/i.test(line)) {
      walk.push({
        kind: 'frame-else',
        label: line.replace(/^else\s*/i, '').slice(0, MAX_LABEL),
      })
      continue
    }
    if (/^end$/i.test(line)) {
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
    const decl = /^(participant|actor)\s+([A-Za-z0-9_]+)(?:\s+as\s+(.*))?$/i.exec(line)
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
          need = Math.max(need, stringWidth(m.label) + 8)
        }
      } else if (item.kind === 'note') {
        const n = item.note
        if (n.over.length === 2 && n.over.includes(a) && n.over.includes(b)) {
          need = Math.max(need, stringWidth(n.text) + 6)
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
      const w = stringWidth(p.label) + 2
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
          ? `│${padToWidth(p.label, w - 2)}│`
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
          const start = left + Math.max(0, Math.floor((right - left - stringWidth(label)) / 2))
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
      const baseW = Math.max(8, stringWidth(n.text) + 2)
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
      at(y + 1, x0, `│${padToWidth(n.text, x1 - x0 - 1)}│`)
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
  const w = gridDisplayWidth(rows)
  return rows.map(row => rowToString(row, w)).join('\n')
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
