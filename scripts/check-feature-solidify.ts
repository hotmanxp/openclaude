#!/usr/bin/env bun
/**
 * Build-time guard: 在 bun run build 之前跑, 扫 src/ 中所有 feature('XXX')
 * 调用, 对字典中值为 true 的 flag 报警. 防止"已固化的 true flag"
 * 重新被加回 src/ 源码中.
 *
 * Exit codes:
 *   0 - 通过 (没有 true flag 守卫残留)
 *   1 - 失败 (有 true flag 守卫残留, 打印文件:行号)
 *   2 - 字典解析失败
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const REPO_ROOT = join(import.meta.dir, '..')
const BUILD_TS = join(REPO_ROOT, 'scripts', 'build.ts')
const DEFAULT_SRC = join(REPO_ROOT, 'src')

const args = process.argv.slice(2)
const srcRoot = (() => {
  const i = args.indexOf('--src')
  return i !== -1 ? args[i + 1]! : DEFAULT_SRC
})()

function parseFeatureFlags(buildTsPath: string): Set<string> {
  const content = readFileSync(buildTsPath, 'utf-8')
  const dictMatch = content.match(/featureFlags:\s*Record<string,\s*boolean>\s*=\s*\{([\s\S]*?)\n\}/m)
  if (!dictMatch) throw new Error('Cannot find featureFlags dict in scripts/build.ts')
  const dictBody = dictMatch[1]!
  const trueFlags = new Set<string>()
  for (const line of dictBody.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*:\s*true\b/)
    if (m) trueFlags.add(m[1]!)
  }
  return trueFlags
}

// Match feature('FLAG') and feature("FLAG") calls, including multi-line
// forms such as feature(\n  'FLAG',\n). The `s` flag lets `.` cross
// newlines so we can match through the closing `)`. To compute the
// call's source line we count `\n` in the content slice *before* the
// match offset.
const featureCallRe = /\bfeature\(\s*['"](\w+)['"][\s,]*\)/gs

function walkDir(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) walkDir(p, out)
    else if (/\.tsx?$/.test(entry)) out.push(p)
  }
  return out
}

const trueFlags = parseFeatureFlags(BUILD_TS)
const violations: Array<{ file: string; line: number; flag: string }> = []

// Skip matches that appear inside a `//` line comment or inside a
// `/* ... */` block.  Some prior feat-solidify commits left
// `// [FLAG] was: feature('FLAG') ...` historical marker comments
// behind after the runtime guard had been removed.  Those markers
// are documentation, not live guards, and should not fail the build.
function isInsideComment(content: string, matchIndex: number): boolean {
  // Find the start of the line containing the match.
  const lineStart = content.lastIndexOf('\n', matchIndex - 1) + 1
  const linePrefix = content.slice(lineStart, matchIndex)
  // `//` line comment: any `//` earlier on the same line begins a comment.
  if (linePrefix.includes('//')) return true
  // Block comment: walk through the file, toggling on `/*` and `*/`.
  // For correctness we use a simple state machine over the full text up
  // to the match index.
  let i = 0
  let inBlock = false
  while (i < matchIndex) {
    if (inBlock) {
      const end = content.indexOf('*/', i)
      if (end === -1 || end > matchIndex) return true
      i = end + 2
      inBlock = false
    } else {
      const start = content.indexOf('/*', i)
      const lineEnd = content.indexOf('\n', i)
      if (lineEnd !== -1 && (start === -1 || start > lineEnd)) {
        // On this line, only a `//` could start a comment; already
        // checked above via linePrefix. Advance past the newline.
        i = lineEnd + 1
        continue
      }
      if (start === -1) return false
      i = start + 2
      inBlock = true
    }
  }
  return inBlock
}

for (const file of walkDir(srcRoot)) {
  const rel = file.replace(REPO_ROOT + '/', '')
  if (rel.includes('__tests__') || rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue
  const content = readFileSync(file, 'utf-8')
  let m: RegExpExecArray | null
  featureCallRe.lastIndex = 0
  while ((m = featureCallRe.exec(content)) !== null) {
    const flag = m[1]!
    if (!trueFlags.has(flag)) continue
    if (isInsideComment(content, m.index)) continue
    // Line number = number of newlines before the match offset, plus 1.
    const line = content.slice(0, m.index).split('\n').length
    violations.push({ file: rel, line, flag })
  }
}

if (violations.length > 0) {
  console.log('feature-solidify guard FAILED:')
  console.log('  以下 src/ 文件对已固化的 true flag 仍有 feature() 守卫:')
  for (const v of violations) {
    console.log(`    ${v.file}:${v.line}  feature('${v.flag}')`)
  }
  console.log('')
  console.log('  处理方式: 按 docs/superpowers/specs/2026-06-13-feat-solidify-design.md')
  console.log('  §4 7 形态规则 改写, 然后重新跑 build.')
  process.exit(1)
}

console.log('feature-solidify guard OK: 0 true-flag guards remain in src/.')
process.exit(0)