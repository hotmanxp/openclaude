// Verifies the deterministic logic of autoExtractFacts.ts:78 + :257 + :267.
// The expressions are copied verbatim from those lines.
const looksLikeSecretSegment = s => {                    // autoExtractFacts.ts:70-80
  const t = s.trim()
  if (t.length === 0) return true
  if (t.length >= 16 && /^[a-f0-9]+$/.test(t)) return true
  if (t.length >= 12 && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(t)) return true   // :78
  return false
}

// autoExtractFacts.ts:256-270
function rebuild(originalPath) {
  const segs = originalPath.replace(/^[A-Za-z]:[\\/]/, '').replace(/^\\\\/, '')
    .split(/[\\/]/).filter(Boolean)
  const safeSegs = segs.filter(s => !looksLikeSecretSegment(s))
  if (safeSegs.length === 0) return null                  // :258
  return '/' + safeSegs.join('/')                        // :267
}

for (const p of [
  '/opt/homebrew/lib/site-packages/python3.13',
  '/usr/lib/node_modules/typescript/lib/tsc.js',
  '/srv/app/packages/shared/dist/out',
  '/home/me/projects/mycompany/webapp',
]) {
  const out = rebuild(p)
  console.log('in :', p)
  console.log('out:', out, out && out !== p ? '   <-- DIFFERENT PATH, does not exist on disk' : '')
  console.log('   dropped segments:', p.split('/').filter(s =>
    s && s !== 'opt' && !rebuild(p).split('/').includes(s)))
  console.log()
}
console.log('note: `:78` regex has a *zero-matchable* group, so it also matches a')
console.log('      plain 12+ char lowercase-alnum word with no separator at all:')
for (const w of ['site-packages', 'configuration', 'dist-packages', 'abcdefghijkl'])
  console.log('   looksLikeSecret(%s) =', looksLikeSecretSegment(w))
