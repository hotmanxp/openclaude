// .claude/workflows/completion-smoke.js
//
// Sub-5s test workflow — does NOT call any LLM, so it can complete
// fast enough to verify the pushCompletionMessage() → setMessages
// path end-to-end. Used by the TUI verifier to confirm the
// completion system message actually appears in chat.
//
// Invocation: /completion-smoke

export const meta = {
  name: 'completion-smoke',
  description: '5s no-LLM workflow for verifying completion message wire-up',
  phases: [
    { title: 'noop' },
  ],
}

// Single phase that does no LLM work. Just log + return.
// ~50ms total runtime so the verifier can confirm the completion
// message lands in chat within its 90s cap.
log('completion-smoke: starting')
await new Promise(r => setTimeout(r, 200))
log('completion-smoke: middle tick')
await new Promise(r => setTimeout(r, 200))
log('completion-smoke: finishing')

return 'completion-smoke done'
