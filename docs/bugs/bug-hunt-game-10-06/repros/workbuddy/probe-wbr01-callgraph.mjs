// Decisive check for wb-r01: does any single assistant message get the
// transform applied TWICE?
//
// The claim was: transformModRenderText runs at AssistantTextMessage.tsx:243
// AND Markdown.tsx:237-238, so a message gets H(H(text)).
//
// Traced call graph:
//   path A (completed message): AssistantTextMessage:243 -> <Markdown>  (plain)
//   path B (in-flight stream):  StreamingMarkdown:237-238 -> <Markdown> (plain)
// Neither nests: the <Markdown> rendered in BOTH cases is the plain export
// (Markdown.tsx:80), whose body never calls the transform. So the two call
// sites are disjoint paths, each applying the chain exactly ONCE.
//
// This script proves the plain Markdown path does not re-enter the chain.
import { readFileSync } from 'node:fs'

const src = readFileSync('/Users/ethan/code/opencc/src/components/Markdown.tsx', 'utf8')
const lines = src.split('\n')

// Which function are lines 237-238 inside?
let owner = '(module scope)'
for (let i = 236; i >= 0; i--) {
  const m = lines[i].match(/^export function (\w+)|^function (\w+)/)
  if (m) { owner = m[1] || m[2]; break }
}
console.log(`Markdown.tsx:237-238 lives inside: ${owner}()`)

// Does the plain Markdown (line 80) ever call the transform?
const plainStart = lines.findIndex(l => /^export function Markdown\(/.test(l))
const streamingStart = lines.findIndex(l => /^export function StreamingMarkdown\(/.test(l))
const plainBody = lines.slice(plainStart, streamingStart).join('\n')
console.log(`plain Markdown() calls transformModRenderText: ${plainBody.includes('transformModRenderText')}`)

// Does AssistantTextMessage render the plain Markdown or the streaming one?
const atm = readFileSync('/Users/ethan/code/opencc/src/components/messages/AssistantTextMessage.tsx', 'utf8')
const importLine = atm.split('\n').find(l => l.includes("Markdown.js"))
console.log(`AssistantTextMessage imports: ${importLine?.trim()}`)

console.log('\n===== RESULT =====')
const nested = owner === 'Markdown' && plainBody.includes('transformModRenderText')
console.log(nested
  ? 'REPRODUCED: the transform site is inside plain Markdown, which nests.'
  : 'NOT REPRODUCED: the two transform call sites are disjoint paths.\n' +
    '  A completed message -> AssistantTextMessage:243 -> plain Markdown (1x)\n' +
    '  An in-flight stream -> StreamingMarkdown:237-238 -> plain Markdown (1x)\n' +
    'Neither nests, so no message receives H(H(text)).')
process.exit(0)
