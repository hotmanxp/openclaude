import { readdir, lstat, readFile, realpath } from 'node:fs/promises'
const entries = await readdir('/tmp/judge-verify/sl/inside', { withFileTypes: true })
for (const e of entries) {
  const st = await lstat('/tmp/judge-verify/sl/inside/' + e.name)
  console.log(`name=${e.name} isFile=${e.isFile()} isSymbolicLink=${e.isSymbolicLink()} lstat.isSymbolicLink=${st.isSymbolicLink()} lstat.isFile=${st.isFile()}`)
  console.log(`  -> line103 'if(!entry.isFile()) continue' fires? ${!e.isFile()} => the symlink branch at :105 is ${!e.isFile() ? 'UNREACHABLE' : 'reachable'}`)
}
