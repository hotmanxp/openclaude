import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// oc-008: `void spawnBackgroundTask().then(...)` had no rejection handler.
// A failed background spawn therefore (a) surfaced as an unhandled rejection
// and (b) left the generator's Promise.race unresolved, because the resolve
// only ran on the success path — so the command silently vanished.
//
// BashTool is a large generator with heavy rendering and shell dependencies;
// driving it end-to-end here would test the harness more than the behaviour.
// This pins the invariant that matters and is cheap to keep true: the spawn
// chain must handle rejection, and the generator's resolve must be reachable
// from that path.
const source = readFileSync(
  join(import.meta.dir, 'BashTool.tsx'),
  'utf8',
)

test('the background spawn chain handles rejection', () => {
  const spawnAt = source.indexOf('void spawnBackgroundTask()')
  expect(spawnAt).toBeGreaterThan(-1)

  const chain = source.slice(spawnAt, spawnAt + 900)
  expect(chain).toContain('.catch(')
  // ...and the catch must not simply rethrow or swallow the resolve.
  const catchBody = chain.slice(chain.indexOf('.catch('), chain.indexOf('.then('))
  expect(catchBody).toMatch(/resolve/)
})

test('the catch path logs why backgrounding failed', () => {
  const spawnAt = source.indexOf('void spawnBackgroundTask()')
  const chain = source.slice(spawnAt, spawnAt + 900)
  const catchBody = chain.slice(chain.indexOf('.catch('), chain.indexOf('.then('))
  expect(catchBody).toContain('logForDebugging')
})