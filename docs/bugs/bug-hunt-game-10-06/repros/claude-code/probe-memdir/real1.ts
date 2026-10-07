import { sanitizeMemoryText, sanitizeMemoryIdentifier, looksLikeMemorySecretValue } from '/Users/ethan/code/opencc/src/memdir/memorySecurity.ts'

const cases = [
  'literal marker __OPENCLAUDE_MEMORY_URL_0__ plus url https://example.com/a',
  'see __OPENCLAUDE_MEMORY_URL_5__ then https://a.example/x https://b.example/y',
  'my password is hunter2hunter2 and my token is abcdefgh12345678',
  'aws key AKIAIOSFODNN7EXAMPLE',
]
for (const c of cases) {
  const r = sanitizeMemoryText(c)
  console.log('IN :', JSON.stringify(c))
  console.log('OUT:', JSON.stringify(r.text), 'changed=', r.changed, 'whole=', r.wholeSecret)
  console.log('---')
}
