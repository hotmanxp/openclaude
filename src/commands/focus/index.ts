// Upstream 2.1.270 sync: /focus command.
// Source: claude-code 2.1.270. Description wording follows upstream
// release notes verbatim. OpenCC minimal implementation: toggles a
// `focusMode` session flag. Upstream's full implementation requires a
// fullscreen renderer that hides tool calls and progress (focus_mode
// var ERo prompt section suppresses inter-tool updates). OpenCC has no
// fullscreen renderer, so the flag exists but the UI doesn't
// auto-collapse yet — the UI text tells the user that explicitly.
import type { Command } from '../../commands.js'

const focus = {
  type: 'local-jsx',
  name: 'focus',
  description: 'Toggle focus view: just your prompt, summary, and response.',
  load: () => import('./Focus.js'),
} satisfies Command

export default focus