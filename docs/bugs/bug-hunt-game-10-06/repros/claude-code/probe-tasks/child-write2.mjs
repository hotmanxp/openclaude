import { writeFileSync } from 'fs'
const path = process.argv[2]
const big = JSON.stringify({ description: 'Y'.repeat(40_000_000) }, null, 2)
// identical in shape to tasks.ts:365 updateTaskUnsafe() — bare writeFile, no tmp+rename
writeFileSync(path, big)