const f = s => s.length >= 12 && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(s)
for (const w of ['site-packages','dist-packages','configuration','sourcefiles','abcdefghijkl','my-application-code']) {
  console.log(JSON.stringify(w).padEnd(24), 'len=' + String(w.length).padEnd(3), '->', f(w))
}
console.log('\n=> the `(?:...)*` group matches ZERO times, so separator-free words match too')
