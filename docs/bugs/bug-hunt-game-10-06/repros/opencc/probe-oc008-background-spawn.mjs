// oc-008: `void spawnBackgroundTask().then(...)` had no .catch. A rejection
// became an unhandled rejection AND left resolveProgress unset-resolved, so
// the generator's Promise.race never woke and the command vanished silently.
const results = { unhandled: [], resolved: false }
process.on('unhandledRejection', e => results.unhandled.push(String(e)))

function makeScenario(withCatch) {
  let resolveProgress = () => { results.resolved = true }
  const spawnBackgroundTask = () => Promise.reject(new Error('spawn failed'))
  const race = new Promise(r => { resolveProgress = r })
  if (withCatch) {
    void spawnBackgroundTask()
      .catch(error => {
        logDebug(String(error))
        const r = resolveProgress; if (r) { resolveProgress = null; r() }
        return undefined
      })
      .then(shellId => { if (shellId) return })
  } else {
    void spawnBackgroundTask().then(shellId => {
      const r = resolveProgress; if (r) { resolveProgress = null; r() }
      if (shellId) return
    })
  }
  return race
}
const logDebug = () => {}

async function check(label, withCatch) {
  results.unhandled = []; results.resolved = false
  const race = makeScenario(withCatch)
  const outcome = await Promise.race([
    race.then(() => 'race-resolved'),
    new Promise(r => setTimeout(() => r('race-hung'), 200)),
  ])
  await new Promise(r => setTimeout(r, 50))  // let unhandledRejection fire
  console.log(`${label.padEnd(18)} -> ${outcome}, unhandled rejections: ${results.unhandled.length}`)
}

await check('[before fix]', false)
await check('[after fix]', true)
process.exit(0)
