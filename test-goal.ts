// Test goal completion logic
import { extractTextContent } from './src/utils/messages.js'

// Simulate what happens when goal completes
const goalState = {
  condition: 'test condition',
  startTime: Date.now() - 10000,
  roundCount: 1,
  maxRounds: null,
  status: 'active'
}

// Simulate a goal result where ok is true (goal completed)
const goalResult = {
  continueMessages: null,
  goalComplete: true
}

console.log('Initial goalState.status:', goalState.status)

// Simulate the code flow
let goalJustCompleted = false

if (goalState.status === 'active') {
  console.log('Entered goal evaluation block')

  if (goalResult) {
    console.log('goalResult exists, goalComplete =', goalResult.goalComplete)

    // Update status
    const newStatus = goalResult.goalComplete ? 'completed' : 'active'
    console.log('New status would be:', newStatus)

    if (goalResult.goalComplete) {
      console.log('Setting goalJustCompleted = true')
      goalJustCompleted = true
    } else if (goalResult.continueMessages) {
      console.log('Would continue with messages')
    } else {
      console.log('Would fall through')
    }
  }
} else {
  console.log('goalState.status !== active')
}

// Check the flag
if (goalJustCompleted) {
  console.log('WOULD RETURN goal_completed - this is correct!')
} else {
  console.log('WOULD CONTINUE TO TOKEN BUDGET - this is wrong!')
}

console.log('')
console.log('Testing the actual condition check:')
console.log('goalJustCompleted after block:', goalJustCompleted)

// The issue: when goalComplete is true, we set goalJustCompleted = true
// But when goalComplete is false AND continueMessages is null, we fall through
// and goalJustCompleted stays false

// Test with goalResult.goalComplete = false, continueMessages = null
const goalResult2 = {
  continueMessages: null,
  goalComplete: false
}

goalJustCompleted = false
console.log('')
console.log('Testing with goalComplete=false, continueMessages=null:')

if (goalState.status === 'active') {
  if (goalResult2) {
    if (goalResult2.goalComplete) {
      goalJustCompleted = true
    } else if (goalResult2.continueMessages) {
      console.log('Would continue with messages')
    } else {
      console.log('Fall through - no continueMessages, goalComplete is false')
    }
  }
}

console.log('goalJustCompleted:', goalJustCompleted)
console.log('Would continue to token budget check - THIS IS THE BUG!')

// The fix: when continueMessages is null and goalComplete is false (max rounds or similar),
// we should NOT fall through to token budget check
