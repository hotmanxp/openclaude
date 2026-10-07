// NEW finding: looksLikeSecret treats a 12+ char all-lowercase-alnum segment as a secret.
// A perfectly ordinary directory name is stripped, and the REMAINING path is persisted
// as a "fact" -- pointing at a location that never existed.
const looksLikeSecret = s => {
  s = s.trim()
  if (s.length === 0) return true
  if (s.length >= 16 && /^[a-f0-9]+$/.test(s)) return true
  if (s.length >= 12 && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(s)) return true
  return false
}
function scrubPath(path) {
  const segs = path.split('/').filter(Boolean)
  const safeSegs = segs.filter(s => !looksLikeSecret(s))
  if (safeSegs.length === 0) return null
  return '/' + safeSegs.join('/')
}
const cases = [
  '/Users/me/work/opencodeproject/src',   // ordinary dir, 18 lowercase chars
  '/Users/me/code/opencc/src/utils',      // "opencc" is 6 -> kept
  '/Users/me/Documents/2024/reports/q3',  // fine
  '/Users/me/work/openhandsdk/frontend', // 12 lowercase -> STRIPPED
  '/srv/containerplatform/logs',          // 18 lowercase -> STRIPPED
]
for (const p of cases) {
  const r = scrubPath(p)
  const segs = p.split('/').filter(Boolean)
  const dropped = segs.filter(s => looksLikeSecret(s))
  console.log(p.padEnd(42), '->', String(r).padEnd(30), dropped.length ? `(dropped: ${dropped})` : '')
}
