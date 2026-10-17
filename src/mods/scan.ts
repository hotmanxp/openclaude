import { parse } from 'acorn'

/**
 * Static scan of a mod's own source — upstream's `uses` (d.ts:7887), and the
 * import specifier check that used to be a regex pass.
 *
 * Why an AST and not a regex: `validate.ts` scanned for import specifiers with
 * five patterns and said so itself ("a regex pass, not an AST walk …
 * defense against accidental dependency, not a security boundary"). The same
 * walk has to answer a second question upstream asks — what does this module
 * hook and call — and that question has no regex answer. `on` appears in a
 * string, in a comment, in a property access and in a call; only the call is a
 * registration. Shipping `{events: [], calls: []}` for a module that plainly
 * registers both would tell every hook that reads `uses` that the mod does
 * nothing, which is the exact failure `UNAVAILABLE_EVENTS`'s docstring names.
 *
 * What this is NOT: a sandbox. It reads the source before the module runs and
 * reports what it spells. A module that computes a specifier or an event name
 * at runtime still loads; upstream's contract says the same thing in one line
 * ("Exact, since a module that spells `on`, `$`, `$.env` or a `$.state`
 * reference other than literally does not load") — it is a statement about
 * which mods exist, not a boundary.
 */

/** What the module hooks and calls, as read from its source. */
export type PluginRegisterUses = {
  /**
   * The patterns its `on(...)` registrations name, as written (`tool.call`,
   * `*`, `!tool.describe`), in registration order, each once.
   */
  events: string[]
  /** What it calls on `$`, spelled `noun.method` (`fs.write`), sorted. */
  calls: string[]
  /** The env names its `$.env.get` / `$.env.set` calls spell, sorted. */
  env?: { reads: string[]; writes: string[] }
  /** The `$.state` values it names by literal, sorted. */
  state?: { reads: string[]; writes: string[] }
}

/**
 * What a `plugin.register` hook is handed, and what it answers (d.ts:7872).
 *
 * `tier` and `uses` are the host's reading of the module — what a gate holds it
 * to. `name`, `root`, `version` and `provenance` are the module's own word, so
 * a rule keyed on them is one a rename walks past; upstream says the same in the
 * same paragraph and the reason is kept here for the same reason.
 */
export type PluginRegisterInput = {
  name: string
  tier: 'prepend' | 'user' | 'append' | 'builtin'
  root: string
  version?: string
  provenance: string
  uses: PluginRegisterUses
}

/** `{allow:true}` from core, or `{refuse: reason}` — which does not load. */
export type PluginRegisterResult =
  | { allow: true; refuse?: undefined }
  | { refuse: string; allow?: undefined }

/** Every literal import specifier in a module, in source order, once. */
export type ImportScan = {
  /** `'./x.js'`, `'node:fs'` … a specifier the source spells out. */
  specifiers: string[]
  /** Specifiers built at runtime (`import(someVar)`) — not names. */
  computed: number
  /** `import … from` / `export … from` whose source is not a plain string. */
  hasModuleSyntax: boolean
}

export class ModScanError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(message)
    this.name = 'ModScanError'
  }
}

type AnyNode = {
  type: string
  [key: string]: unknown
}

const isNode = (value: unknown): value is AnyNode =>
  typeof value === 'object' && value !== null && typeof (value as AnyNode).type === 'string'

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

/**
 * The string a literal AST node holds. acorn keeps `import './x'` as a
 * `{type:'Literal', value:'./x'}` NODE, so reading `.value` off the argument
 * position is what turns a specifier into a name — and reading the node itself
 * is what a first pass here did, counting every import as computed.
 */
const literalValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (isNode(value) && value.type === 'Literal') return asString(value.value)
  return undefined
}

/** Walk every node of a parsed module, parents before children. */
function walk(node: unknown, visit: (node: AnyNode) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  if (!isNode(node)) return
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue
    walk((node as Record<string, unknown>)[key], visit)
  }
}

/**
 * Parse one module.
 *
 * `ecmaVersion: 'latest'` with `sourceType: 'module'`, matching what the host
 * itself imports the file as. A module the host would refuse to import anyway
 * is reported here as unparseable, with the file named — the alternative is a
 * silent "scanned nothing" that reads as a clean bill of health.
 */
function parseModule(source: string, file: string): AnyNode {
  try {
    return parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: false,
      // A mod's top level IS allowed to await: the host imports the file as an
      // ES module and Node runs top-level await there. Without this a valid mod
      // would be reported as unparseable, and "unparseable" here means the mod
      // never loads — the scan would be rejecting the very thing it reads.
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    }) as unknown as AnyNode
  } catch (error) {
    throw new ModScanError(
      `could not parse as an ES module: ${
        error instanceof Error ? error.message : String(error)
      }`,
      file,
    )
  }
}

/**
 * The literal import specifiers, and whether the module has module syntax at
 * all.
 *
 * The computed count is what a regex pass cannot see and therefore cannot
 * report: `import(path)` names nothing at parse time, so it is neither allowed
 * nor refused here — it is counted, and the caller decides. opencc's rule is
 * "only relative imports", which a computed specifier could satisfy or evade;
 * reporting the number keeps that a visible choice instead of a silent gap.
 */
export function scanImports(source: string, file: string): ImportScan {
  const ast = parseModule(source, file)
  const specifiers: string[] = []
  let computed = 0
  let hasModuleSyntax = false
  const add = (specifier: unknown): void => {
    const literal = literalValue(specifier)
    if (literal === undefined) computed++
    else if (!specifiers.includes(literal)) specifiers.push(literal)
  }
  walk(ast, node => {
    switch (node.type) {
      case 'ImportDeclaration':
      case 'ExportNamedDeclaration':
      case 'ExportAllDeclaration':
        hasModuleSyntax = true
        if (node.source !== null && node.source !== undefined) add(node.source)
        break
      case 'ImportExpression':
        add(node.source)
        break
      case 'CallExpression': {
        const callee = node.callee
        // `require('x')` — a `.js` mod may still be CommonJS, and the regex
        // pass caught it, so the AST pass has to.
        if (isNode(callee) && callee.type === 'Identifier' && callee.name === 'require') {
          add(argAt(node, 0))
        }
        break
      }
      default:
        break
    }
  })
  return { specifiers, computed, hasModuleSyntax }
}

/** A plain `.name` property read (not `['name']`). */
const plainName = (property: unknown): string | undefined =>
  isNode(property) && property.type === 'Identifier'
    ? asString(property.name)
    : undefined

/** The i-th argument of a call, if it has one. */
const argAt = (node: AnyNode, index: number): unknown => {
  const args = node.arguments
  return Array.isArray(args) ? args[index] : undefined
}

/**
 * What a call on `$` spells, or undefined when it is not a call on `$`.
 *
 * The AST is three levels deep for `$.fs.write(…)`, not two: the
 * CallExpression's callee is `$.fs.write`, whose `object` is `$.fs` and whose
 * `property` is `write`. Reading `callee.object` as though it were `$` finds a
 * MemberExpression where an Identifier was expected and returns nothing — a
 * scan that reports no calls at all while looking like it ran.
 */
function dollarCall(node: AnyNode): string | undefined {
  const callee = node.callee
  if (!isNode(callee) || callee.type !== 'MemberExpression') return undefined
  const object = callee.object
  const property = callee.property

  if (callee.computed !== true) {
    // `$.fs.write(…)`
    if (
      isNode(object) &&
      object.type === 'MemberExpression' &&
      object.computed !== true &&
      plainName(object.object) === '$'
    ) {
      const noun = plainName(object.property)
      const method = plainName(property)
      return noun !== undefined && method !== undefined
        ? `${noun}.${method}`
        : undefined
    }
    // `$.telemetry(…)` — `$` is a table, so this is one segment, not zero.
    if (plainName(object) === '$') return plainName(property)
    return undefined
  }
  // `$['fs']['write'](…)` / `$[name](…)` — read where it is spelled by literal.
  const method = literalValue(property)
  if (method === undefined) return undefined
  if (
    isNode(object) &&
    object.type === 'MemberExpression' &&
    object.computed === true
  ) {
    const noun = literalValue(object.property)
    if (noun !== undefined) return `${noun}.${method}`
  }
  return plainName(object) === '$' ? method : undefined
}

const addOnce = (list: string[], value: string): void => {
  if (!list.includes(value)) list.push(value)
}

/**
 * What the module hooks and calls.
 *
 * `on` is read as `ctx.on(...)` / `$.on(...)` / a bare `on(...)` — a mod is
 * handed its context under whatever name it chose, so the receiver is not
 * knowable from the call site. Only the FIRST argument is read, because that is
 * the pattern; a matcher object in second position is not an event name and
 * reading it would put `{"tool":"Read"}` into `events`.
 */
export function scanUses(source: string, file: string): PluginRegisterUses {
  const ast = parseModule(source, file)
  const events: string[] = []
  const calls: string[] = []
  const envReads: string[] = []
  const envWrites: string[] = []
  const stateReads: string[] = []
  const stateWrites: string[] = []

  walk(ast, node => {
    if (node.type !== 'CallExpression') return
    const callee = node.callee
    const isOn =
      (isNode(callee) && callee.type === 'Identifier' && callee.name === 'on') ||
      (isNode(callee) &&
        callee.type === 'MemberExpression' &&
        isNode(callee.property) &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'on')
    if (isOn) {
      const pattern = literalValue(argAt(node, 0))
      if (pattern !== undefined) addOnce(events, pattern)
      return
    }
    const spelled = dollarCall(node)
    if (spelled === undefined) return
    const [noun, method] = spelled.split('.')
    if (noun === 'env' && (method === 'get' || method === 'set')) {
      const name = literalValue(argAt(node, 0))
      if (name !== undefined) {
        addOnce(method === 'get' ? envReads : envWrites, name)
      }
      return
    }
    if (noun === 'state' && (method === 'get' || method === 'set')) {
      const literal = argAt(node, 0)
      if (isNode(literal) && literal.type === 'ObjectExpression') {
        const properties: unknown[] = Array.isArray(literal.properties)
          ? literal.properties
          : []
        for (const property of properties) {
          if (!isNode(property)) continue
          // `{plugin: 'me'}` spells its key as an Identifier and `{plugin:
          // 'me'}` as a Literal; both are the same key.
          const key =
            literalValue(property.key) ?? plainName(property.key)
          const value = literalValue(property.value)
          if (key === 'plugin' || key === 'key') {
            if (value !== undefined) {
              addOnce(
                (method === 'get' ? stateReads : stateWrites) as string[],
                `${key}:${value}`,
              )
            }
          }
        }
      }
      return
    }
    addOnce(calls, spelled)
  })

  const uses: PluginRegisterUses = {
    events,
    calls: [...calls].sort(),
  }
  if (envReads.length > 0 || envWrites.length > 0) {
    uses.env = {
      reads: [...envReads].sort(),
      writes: [...envWrites].sort(),
    }
  }
  if (stateReads.length > 0 || stateWrites.length > 0) {
    uses.state = {
      reads: [...stateReads].sort(),
      writes: [...stateWrites].sort(),
    }
  }
  return uses
}
