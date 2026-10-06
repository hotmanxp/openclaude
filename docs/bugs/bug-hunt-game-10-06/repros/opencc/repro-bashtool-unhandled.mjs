// E3: does `void spawnBackgroundTask().then(fn)` with no .catch() leak a rejection
// and leave the generator's Promise.race unwoken? Reproduce the EXACT structure at BashTool.tsx:1364.
const unhandled = []
process.on('unhandledRejection', r => unhandled.push(r))

// Mirror the real shape: the wake-up (resolveProgress) lives INSIDE .then(onFulfilled).
let resolveProgress = null
let backgroundShellId = null
let raceSettled = false

function makeRace() {
  return new Promise(resolve => {
    resolveProgress = () => { raceSettled = true; resolve() }
    // simulate "poller stopped ticking / hung on I/O": nothing else will settle this race
  })
}
const race = makeRace()

async function spawnBackgroundTask() {
  throw new Error('spawnShellTask failed: setAppState updater threw')
}
function startBackgrounding() {
  // === verbatim structure from BashTool.tsx:1364-1376 ===
  void spawnBackgroundTask().then(shellId => {
    backgroundShellId = shellId
    const resolve = resolveProgress
    if (resolve) { resolveProgress = null; resolve() }
  })
}

startBackgrounding()
setTimeout(() => {
  console.log('race settled?          :', raceSettled, raceSettled ? '' : '  <-- generator still hung in Promise.race')
  console.log('backgroundShellId      :', backgroundShellId, backgroundShellId === null ? ' <-- never assigned' : '')
  console.log('unhandledRejection cnt :', unhandled.length)
  if (unhandled.length) console.log('reason                 :', unhandled[0]?.message)
  console.log((!raceSettled && unhandled.length > 0)
    ? 'RESULT: FAIL — rejection escapes AND the only wake-up (inside .then) never runs => generator deadlocks'
    : 'RESULT: contained')
  process.exit(0)
}, 200)
