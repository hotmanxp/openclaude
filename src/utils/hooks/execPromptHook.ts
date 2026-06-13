// @ts-nocheck
import { randomUUID } from 'crypto'
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import { queryModelWithoutStreaming } from '../../services/api/claude.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { createAttachmentMessage } from '../attachments.js'
import { createCombinedAbortSignal } from '../combinedAbortSignal.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import type { HookResult } from '../hooks.js'
import { safeParseJSON } from '../json.js'
import { createUserMessage, extractTextContent } from '../messages.js'
import { getSmallFastModel } from '../model/model.js'
import type { PromptHook } from '../settings/types.js'
import { asSystemPrompt } from '../systemPromptType.js'
import { addArgumentsToPrompt, hookResponseSchema } from './hookHelpers.js'

/**
 * Strip a markdown code fence (``` or ```json), if present, and return the
 * inner text. Accepts trailing prose after the closing fence — only the
 * content between the first opener and the matching closer is returned.
 */
function stripMarkdownFence(s: string): string {
  // Match ```lang?\n ... \n``` anywhere in s
  const fenceRe = /```(?:[a-zA-Z]+)?\s*\n([\s\S]*?)\n```/
  const m = s.match(fenceRe)
  return m ? m[1].trim() : s
}

/**
 * Find the first balanced top-level `{...}` object in `s`, ignoring braces
 * inside strings and template literals. Treats runs of 3+ backticks as a
 * markdown fence delimiter (skipped as a unit). Returns null if no balanced
 * object is found.
 */
function extractFirstBalancedObject(s: string): string | null {
  let start = -1
  let depth = 0
  let inString: false | '"' | "'" | '`' = false
  let escape = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    // Skip markdown fence runs (3+ backticks) entirely.
    if (c === '`' && !inString) {
      let run = 0
      while (i < s.length && s[i] === '`') {
        run++
        i++
      }
      i-- // step back so the outer for-loop advances past the run
      if (run >= 3) continue
      // Single backtick outside a string still acts as a template literal
      // delimiter for brace-counting purposes.
      inString = '`'
      continue
    }
    if (escape) {
      escape = false
      continue
    }
    if (inString) {
      if (c === '\\') {
        escape = true
        continue
      }
      if (c === inString) {
        inString = false
      }
      continue
    }
    if (c === '{') {
      if (start === -1) start = i
      depth++
      continue
    }
    if (c === '}') {
      if (start === -1) continue
      depth--
      if (depth === 0) {
        return s.slice(start, i + 1)
      }
    }
  }
  return null
}

/**
 * Parse a prompt-hook LLM response into a JS object.
 *
 * LLMs (including MiniMax-M2.7-highspeed and others without structured-output
 * beta headers) often wrap JSON in markdown fences or precede it with prose.
 * We try three strategies in order:
 *   1. Direct JSON.parse on the trimmed response.
 *   2. Strip ```lang fences and retry.
 *   3. Extract the first balanced `{...}` object from the response.
 *
 * Returns null when nothing parseable is found.
 */
export function parsePromptHookResponse(response: string): unknown | null {
  const trimmed = response.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    // fall through
  }
  const unfenced = stripMarkdownFence(trimmed)
  if (unfenced !== trimmed) {
    try {
      return JSON.parse(unfenced)
    } catch {
      // fall through
    }
  }
  const balanced = extractFirstBalancedObject(trimmed)
  if (balanced) {
    try {
      return JSON.parse(balanced)
    } catch {
      // fall through
    }
  }
  return null
}

/**
 * Execute a prompt-based hook using an LLM
 */
export async function execPromptHook(
  hook: PromptHook,
  hookName: string,
  hookEvent: HookEvent,
  jsonInput: string,
  signal: AbortSignal,
  toolUseContext: ToolUseContext,
  messages?: Message[],
  toolUseID?: string,
): Promise<HookResult> {
  // Use provided toolUseID or generate a new one
  const effectiveToolUseID = toolUseID || `hook-${randomUUID()}`
  try {
    // Replace $ARGUMENTS with the JSON input
    const processedPrompt = addArgumentsToPrompt(hook.prompt, jsonInput)
    logForDebugging(
      `Hooks: Processing prompt hook with prompt: ${processedPrompt}`,
    )

    // Create user message directly - no need for processUserInput which would
    // trigger UserPromptSubmit hooks and cause infinite recursion
    const userMessage = createUserMessage({ content: processedPrompt })

    // Prepend conversation history if provided
    const messagesToQuery =
      messages && messages.length > 0
        ? [...messages, userMessage]
        : [userMessage]

    logForDebugging(
      `Hooks: Querying model with ${messagesToQuery.length} messages`,
    )

    // Query the model with Haiku
    const hookTimeoutMs = hook.timeout ? hook.timeout * 1000 : 30000

    // Combined signal: aborts if either the hook signal or timeout triggers
    const { signal: combinedSignal, cleanup: cleanupSignal } =
      createCombinedAbortSignal(signal, { timeoutMs: hookTimeoutMs })

    // First-attempt system prompt. The `Retry` variant below is more
    // aggressive — used when the first response isn't parseable JSON.
    const FIRST_SYSTEM_PROMPT = `You are evaluating a hook in Open CC.

Your response must be a JSON object matching one of the following schemas:
1. If the condition is met, return: {"ok": true}
2. If the condition is not met, return: {"ok": false, "reason": "Reason for why it is not met"}`

    const RETRY_SYSTEM_PROMPT = `You are evaluating a hook in Open CC. Your previous response could not be parsed as JSON.

CRITICAL — your reply will be fed to JSON.parse and MUST succeed:
- Return ONLY the JSON object, with NO surrounding prose, NO markdown code fences, NO leading/trailing text.
- Output exactly: {"ok": true}  OR  {"ok": false, "reason": "..."}
- Do not include greetings, explanations, or anything outside the braces.`

    const MAX_ATTEMPTS = 2

    try {
      const resolvedModel = hook.model ?? getSmallFastModel()
      logForDebugging(
        `Hooks[execPromptHook DIAG]: hookName=${hookName} hookEvent=${hookEvent} ` +
          `resolvedModel=${resolvedModel} outputFormat.type=json_schema ` +
          `messagesToQuery.length=${messagesToQuery.length}`,
      )

      let json: unknown = null
      let lastRawResponse = ''
      let lastParseErr = ''
      let succeededOnAttempt = 0

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (signal.aborted) break

        const systemPrompt =
          attempt === 1 ? FIRST_SYSTEM_PROMPT : RETRY_SYSTEM_PROMPT
        if (attempt > 1) {
          logForDebugging(
            `Hooks[execPromptHook DIAG]: retrying with stronger prompt (attempt ${attempt}/${MAX_ATTEMPTS}); previousRawResponse=${JSON.stringify(lastRawResponse).slice(0, 200)}`,
          )
        }

        const response = await queryModelWithoutStreaming({
          messages: messagesToQuery,
          systemPrompt: asSystemPrompt([systemPrompt]),
          thinkingConfig: { type: 'disabled' as const },
          tools: toolUseContext.options.tools,
          signal: combinedSignal,
          options: {
            async getToolPermissionContext() {
              const appState = toolUseContext.getAppState()
              return appState.toolPermissionContext
            },
            model: resolvedModel,
            toolChoice: undefined,
            isNonInteractiveSession: true,
            hasAppendSystemPrompt: false,
            agents: [],
            querySource: 'hook_prompt',
            mcpTools: [],
            agentId: toolUseContext.agentId,
            outputFormat: {
              type: 'json_schema',
              schema: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean' },
                  reason: { type: 'string' },
                },
                required: ['ok'],
                additionalProperties: false,
              },
            },
          },
        })

        // DIAG: dump raw content block shape BEFORE extracting text — if the
        // model returned a tool_use block or wrapped JSON in code fences, this
        // is the only place we see it.
        try {
          const rawBlocks = response?.message?.content
          if (Array.isArray(rawBlocks)) {
            const blockTypes = rawBlocks.map((b: any) => ({
              type: b?.type,
              hasText: typeof b?.text === 'string',
              textPreview:
                typeof b?.text === 'string'
                  ? b.text.slice(0, 200)
                  : undefined,
              hasInput: b?.input != null,
            }))
            logForDebugging(
              `Hooks[execPromptHook DIAG]: attempt ${attempt} raw content blocks = ${JSON.stringify(blockTypes)}`,
            )
          } else {
            logForDebugging(
              `Hooks[execPromptHook DIAG]: attempt ${attempt} raw content is not array, typeof=${typeof rawBlocks}`,
            )
          }
        } catch (diagErr) {
          logForDebugging(
            `Hooks[execPromptHook DIAG]: error dumping blocks: ${errorMessage(diagErr)}`,
          )
        }

        // Extract text content from response
        const content = extractTextContent(response.message.content)

        // Update response length for spinner display
        toolUseContext.setResponseLength(length => length + content.length)

        const fullResponse = content.trim()
        logForDebugging(
          `Hooks[execPromptHook DIAG]: attempt ${attempt} model response: ${fullResponse}`,
        )

        // Strategy 1: direct JSON.parse
        let parsedJson: unknown = null
        let parseErrMsg = ''
        try {
          parsedJson = JSON.parse(fullResponse)
        } catch (parseErr) {
          parseErrMsg = errorMessage(parseErr)
        }

        // Strategy 2: 3-level parsePromptHookResponse (markdown fence strip,
        // balanced-brace extraction). Recovers `` ```json\n{...}\n``` `` and
        // prose-prefixed JSON for MiniMax-M2.7-highspeed and similar models
        // without structured-outputs beta headers.
        if (parsedJson === null) {
          const recovered = parsePromptHookResponse(fullResponse)
          if (recovered !== null) {
            logForDebugging(
              `Hooks[execPromptHook DIAG]: attempt ${attempt} direct JSON.parse failed (${parseErrMsg}) but parsePromptHookResponse succeeded; recovered=${JSON.stringify(recovered).slice(0, 200)}`,
            )
            parsedJson = recovered
          }
        }

        if (parsedJson !== null) {
          json = parsedJson
          lastRawResponse = fullResponse
          lastParseErr = parseErrMsg
          succeededOnAttempt = attempt
          break
        }

        // All strategies failed for this attempt. Remember the response for
        // the retry's diagnostic log, then either retry or fall through to
        // the failure handler below.
        lastRawResponse = fullResponse
        lastParseErr = parseErrMsg
        logForDebugging(
          `Hooks[execPromptHook DIAG]: attempt ${attempt} all JSON.parse strategies failed; parseErr=${parseErrMsg}; rawResponse=${JSON.stringify(fullResponse).slice(0, 500)}`,
        )
      }

      cleanupSignal()

      if (!json) {
        logForDebugging(
          `Hooks: error parsing response as JSON after ${MAX_ATTEMPTS} attempts: ${lastRawResponse}`,
        )
        return {
          hook,
          outcome: 'non_blocking_error',
          message: createAttachmentMessage({
            type: 'hook_non_blocking_error',
            hookName,
            toolUseID: effectiveToolUseID,
            hookEvent,
            stderr: 'JSON validation failed',
            stdout: lastRawResponse,
            exitCode: 1,
          }),
        }
      }

      if (succeededOnAttempt > 1) {
        logForDebugging(
          `Hooks[execPromptHook DIAG]: succeeded on attempt ${succeededOnAttempt} (retry path recovered)`,
        )
      }

      const parsed = hookResponseSchema().safeParse(json)
      if (!parsed.success) {
        logForDebugging(
          `Hooks: model response does not conform to expected schema: ${parsed.error.message}`,
        )
        return {
          hook,
          outcome: 'non_blocking_error',
          message: createAttachmentMessage({
            type: 'hook_non_blocking_error',
            hookName,
            toolUseID: effectiveToolUseID,
            hookEvent,
            stderr: `Schema validation failed: ${parsed.error.message}`,
            stdout: fullResponse,
            exitCode: 1,
          }),
        }
      }

      // Failed to meet condition
      if (!parsed.data.ok) {
        logForDebugging(
          `Hooks: Prompt hook condition was not met: ${parsed.data.reason}`,
        )
        return {
          hook,
          outcome: 'blocking',
          blockingError: {
            blockingError: `Prompt hook condition was not met: ${parsed.data.reason}`,
            command: hook.prompt,
          },
          preventContinuation: true,
          stopReason: parsed.data.reason,
        }
      }

      // Condition was met
      logForDebugging(`Hooks: Prompt hook condition was met`)
      return {
        hook,
        outcome: 'success',
        message: createAttachmentMessage({
          type: 'hook_success',
          hookName,
          toolUseID: effectiveToolUseID,
          hookEvent,
          content: '',
        }),
      }
    } catch (error) {
      cleanupSignal()

      if (combinedSignal.aborted) {
        return {
          hook,
          outcome: 'cancelled',
        }
      }
      throw error
    }
  } catch (error) {
    const errorMsg = errorMessage(error)
    logForDebugging(`Hooks: Prompt hook error: ${errorMsg}`)
    return {
      hook,
      outcome: 'non_blocking_error',
      message: createAttachmentMessage({
        type: 'hook_non_blocking_error',
        hookName,
        toolUseID: effectiveToolUseID,
        hookEvent,
        stderr: `Error executing prompt hook: ${errorMsg}`,
        stdout: '',
        exitCode: 1,
      }),
    }
  }
}
