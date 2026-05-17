// Test goal completion logic directly
import { evaluateGoal } from './src/services/goal/goalEvaluator.js'

// Create mock messages
const messages = [
  { type: 'user', content: 'Hello' },
  { type: 'assistant', content: 'Hi there!' },
  { type: 'user', content: 'Fix all bugs' },
  { type: 'assistant', content: 'I have fixed all the bugs. Done!' }
]

async function test() {
  console.log('Testing goal evaluation...')

  const result = await evaluateGoal(
    'Fix all bugs',
    messages,
    new AbortController().signal
  )

  console.log('Result:', JSON.stringify(result))
  console.log('goalComplete:', result.ok)
}

test().catch(console.error)