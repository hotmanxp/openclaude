import { pwd } from '../utils/cwd.js'
import { hasCodegraphIndex } from '../utils/codegraph.js'
import { systemPromptSection } from './systemPromptSections.js'

// Keep in sync with the CodeGraph section in AGENTS.md.
const CODEGRAPH_SECTION_TEXT = `# CodeGraph

This project is indexed by CodeGraph (a tree-sitter-parsed knowledge graph
of every symbol, edge, and file). Prefer CodeGraph over native grep/Read
for structural questions.

Available tools (use these instead of grep/Read/Grep when possible):

| Question | Tool |
| ------------------------------------- | -------------------------- |
| "Where is X defined?" | codegraph_search |
| "What calls function Y?" | codegraph_callers |
| "What does Y call?" | codegraph_callees |
| "How does X reach Y?" | codegraph_trace |
| "What would break if I changed Z?" | codegraph_impact |
| "Show me Y's source" | codegraph_node |
| "Several related symbols at once" | codegraph_explore |
| "What files exist under path/?" | codegraph_files |
| "Is the index healthy?" | codegraph_status |

Trust CodeGraph results — they're from a full AST parse. Do NOT re-verify
with grep. Don't grep first when looking up a symbol by name.

If a CodeGraph response shows a ⚠️ staleness banner listing pending files,
Read those specific files for accurate content — files NOT in the banner
are fresh.`

export const codegraphSection = systemPromptSection(
  'codegraph',
  () => (hasCodegraphIndex(pwd()) ? CODEGRAPH_SECTION_TEXT : null),
)
