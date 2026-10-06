// Child: performs exactly what src/utils/tasks.ts:365 does — a bare
// fs/promises.writeFile of a large JSON string onto an EXISTING task file.
import { writeFileSync } from 'fs'
const path = process.argv[2]
const big = JSON.stringify({ description: 'Y'.repeat(400_000_000) }, null, 2)
// no tmp-file, no rename — identical to updateTaskUnsafe()
writeFileSync(path, big)