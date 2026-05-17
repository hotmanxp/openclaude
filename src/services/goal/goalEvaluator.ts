import { queryHaiku } from '../api/claude.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { extractTextContent } from '../../utils/messages.js'
import type { Message } from '../../types/message.js'
import type { GoalEvaluationResult } from '../../types/goal.js'

const GOAL_EVALUATOR_SYSTEM_PROMPT = asSystemPrompt([
  `You are an independent goal evaluator. Your task is to determine if a completion condition has been satisfied based on the conversation transcript.

RULES:
- You CANNOT call any tools - you can only read the transcript
- Search the transcript for CONCRETE EVIDENCE that the condition is satisfied
- The condition must be satisfied with SPECIFIC evidence from the transcript
- If no clear evidence exists, respond with ok: false
- Be precise - vague or implied completion does not count

Respond with ONLY a JSON object:
{"ok": true/false, "reason": "brief explanation with evidence or why not satisfied"}`,
])

/**
 * Evaluates whether a goal condition is satisfied using the Haiku model.
 * The evaluator reads the conversation transcript and determines if there's
 * concrete evidence that the condition has been met.
 */
export async function evaluateGoal(
  condition: string,
  messages: Message[],
  signal: AbortSignal,
): Promise<GoalEvaluationResult> {
  // Helper to extract text from content (could be string, ContentBlock[], or other)
  function extractTextFromContent(content: unknown): string {
    if (typeof content === 'string') {
      return content
    }
    if (Array.isArray(content)) {
      // ContentBlock array - extract text from tool_result blocks
      const texts: string[] = []
      for (const block of content) {
        if (block && typeof block === 'object') {
          if (block.type === 'text') {
            texts.push((block as { text: string }).text)
          } else if (block.type === 'tool_result') {
            const toolResult = block as { content: string | { text: string }[] }
            if (typeof toolResult.content === 'string') {
              texts.push(toolResult.content)
            } else if (Array.isArray(toolResult.content)) {
              for (const item of toolResult.content) {
                if (typeof item === 'string') {
                  texts.push(item)
                } else if (item && typeof item === 'object' && 'text' in item) {
                  texts.push((item as { text: string }).text)
                }
              }
            }
          }
        }
      }
      return texts.join('\n')
    }
    if (content == null) {
      return '(empty)'
    }
    return JSON.stringify(content)
  }

  // Build transcript text from messages
  const transcript = messages
    .filter(m => ['user', 'assistant', 'system', 'attachment', 'function'].includes(m.type))
    .map(m => {
      let role: string
      let content: string

      if (m.type === 'user') {
        role = 'User'
        content = extractTextFromContent(m.message?.content ?? m.content)
      } else if (m.type === 'assistant') {
        role = 'Assistant'
        content = extractTextFromContent(m.message?.content ?? m.content)
      } else if (m.type === 'system') {
        role = 'System'
        content = extractTextFromContent(m.message?.content ?? m.content)
      } else if (m.type === 'attachment') {
        role = 'ToolResult'
        content = extractTextFromContent(m.message?.content ?? m.content)
      } else if (m.type === 'function') {
        role = 'Function'
        content = extractTextFromContent(m.message?.content ?? m.content)
      } else {
        role = m.type
        content = extractTextFromContent(m.message?.content ?? m.content)
      }

      return `${role}: ${content}`
    })
    .join('\n\n')


  const userPrompt = `Evaluate if this condition is satisfied:

CONDITION: ${condition}

TRANSCRIPT:
${transcript}

Respond with ONLY a JSON object:
{"ok": true/false, "reason": "brief explanation"}`

  try {
    const result = await queryHaiku({
      systemPrompt: GOAL_EVALUATOR_SYSTEM_PROMPT,
      userPrompt,
      signal,
      options: {
        isNonInteractiveSession: true,
        hasAppendSystemPrompt: false,
        mcpTools: [],
        agents: [],
        querySource: 'goal_evaluation',
      },
    })

    // Extract text from response
    const content = extractTextContent(result.message.content as readonly { readonly type: string }[])
    const text = content

    // Parse JSON response
    const parsed = JSON.parse(text) as GoalEvaluationResult
    return parsed
  } catch (error) {
    // On evaluation error, default to not done
    return {
      ok: false,
      reason: `Evaluation error: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
