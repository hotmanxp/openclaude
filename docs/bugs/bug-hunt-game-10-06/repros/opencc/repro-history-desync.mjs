// E3: replay the exact ref/state write sequence of useArrowKeyHistory.tsx for a bash-mode first Up.
let historyIndexRef = 0
let historyIndexState = 0            // what setHistoryIndex would drive (drives the rendered entry)
let historyCacheModeFilter = undefined
const initialModeFilterRef = { current: undefined }
let lastShownHistoryEntry            // the user's DRAFT
const historyCache = ['first-entry', 'second-entry']

const setHistoryIndex = v => { historyIndexState = v }

function onHistoryUp(currentMode) {
  // :126-127
  const targetIndex = historyIndexRef
  historyIndexRef++
  if (targetIndex === 0) initialModeFilterRef.current = currentMode === 'bash' ? currentMode : undefined
  const modeFilter = initialModeFilterRef.current
  // :148-152
  if (historyCacheModeFilter !== modeFilter) {
    historyCache.length = 0
    historyCacheModeFilter = modeFilter
    historyIndexRef = 0            // <-- ref reset, state untouched
  }
  historyCache.push('first-entry', 'second-entry')   // :155-163 load
  // :166-174
  if (targetIndex >= historyCache.length) { historyIndexRef--; return }
  setHistoryIndex(targetIndex + 1)                  // state=1, ref=0
  return historyCache[targetIndex]
}

console.log('--- user types "!" then presses Up ---')
const shown1 = onHistoryUp('bash')
console.log('1st Up -> entry shown   :', JSON.stringify(shown1))
console.log('   state historyIndex    :', historyIndexState, ' | ref historyIndexRef:', historyIndexRef, ' <-- DESYNCED')

console.log('\n--- user presses Up again, expecting the 2nd entry ---')
// draft capture at :131-141 fires again because targetIndex===0
lastShownHistoryEntry = shown1
const shown2 = onHistoryUp('bash')
console.log('2nd Up -> entry shown   :', JSON.stringify(shown2), shown2 === shown1 ? ' <-- SAME entry again' : '')
console.log('   state historyIndex    :', historyIndexState, ' | ref historyIndexRef:', historyIndexRef)
console.log('\nRESULT: ' + (shown1 === shown2
  ? 'FAIL — Up is stuck on the first entry; the draft was re-captured at :137 and is now the same history entry'
  : 'PASS'))
