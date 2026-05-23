// @ts-nocheck
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  loadConversationForResume,
  ResumeTranscriptTooLargeError,
} from './conversationRecovery.ts'

const tempDirs: string[] = []
const originalSimple = process.env.CLAUDE_CODE_SIMPLE
const sessionId = '00000000-0000-4000-8000-000000001999'
const ts = '2026-04-02T00:00:00.000Z'


function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

function user(uuid: string, content: string) {
  return {
    type: 'user',
    uuid,
    parentUuid: null,
    timestamp: ts,
    cwd: '/tmp',
    userType: 'external',
    sessionId,
    version: 'test',
    isSidechain: false,
    isMeta: false,
    message: {
      role: 'user',
      content,
    },
  }
}

async function writeJsonl(entry: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openclaude-conversation-recovery-'))
  tempDirs.push(dir)
  const filePath = join(dir, 'resume.jsonl')
  await writeFile(filePath, `${JSON.stringify(entry)}\n`)
  return filePath
}

afterEach(async () => {
  process.env.CLAUDE_CODE_SIMPLE = originalSimple
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

test('loadConversationForResume accepts a small transcript from jsonl path', async () => {
  process.env.CLAUDE_CODE_SIMPLE = '1'
  const path = await writeJsonl(user(id(1), 'hello'))

  const result = await loadConversationForResume('fixture', path)
  expect(result).not.toBeNull()
  expect(result?.sessionId).toBe(sessionId)
  expect(result?.messages.length).toBeGreaterThan(0)
})

test('loadConversationForResume rejects oversized reconstructed transcripts', async () => {
  process.env.CLAUDE_CODE_SIMPLE = '1'
  const hugeContent = 'x'.repeat(8 * 1024 * 1024 + 32 * 1024)
  const path = await writeJsonl(user(id(2), hugeContent))

  let caught: unknown
  try {
    await loadConversationForResume('fixture', path)
  } catch (error) {
    caught = error
  }

  expect(caught).toBeInstanceOf(ResumeTranscriptTooLargeError)
  expect((caught as Error).message).toContain(
    'Reconstructed transcript is too large to resume safely',
  )
})
test('deserializeMessages preserves thinking blocks for GitHub native Claude transport', async () => {
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_GITHUB = '1'
  process.env.OPENAI_MODEL = 'claude-sonnet-4-6'
  const { deserializeMessages } = await importFreshConversationRecovery()

  const deserialized = deserializeMessages([
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'need a plan' },
          { type: 'text', text: 'working on it' },
        ],
      },
    } as any,
  ])

  const content = (deserialized[0] as any)?.message?.content as Array<{
    type: string
  }>
  expect(content.some(block => block.type === 'thinking')).toBe(true)
})

test('deserializeMessages preserves thinking blocks for DeepSeek 3P provider (#957)', async () => {
  // Regression: DeepSeek requires `reasoning_content` echoed back on assistant
  // messages in thinking mode. The shim reads the thinking block to populate
  // that field — stripping it on resume left the shim with no source and the
  // provider 400'd ("reasoning_content in the thinking mode must be passed
  // back"). preserveReasoningContent: true (from runtimeMetadata's DeepSeek
  // shim config inference) must opt the provider out of the 3P thinking strip.
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1'
  process.env.OPENAI_MODEL = 'deepseek-v4-flash'
  const { deserializeMessages } = await importFreshConversationRecovery()

  const deserialized = deserializeMessages([
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'chain of thought' },
          { type: 'text', text: 'answer' },
        ],
      },
    } as any,
  ])

  const content = (deserialized[0] as any)?.message?.content as Array<{
    type: string
  }>
  expect(content.some(block => block.type === 'thinking')).toBe(true)
})

test('deserializeMessages still strips thinking blocks for generic OpenAI 3P (no preserveReasoningContent)', async () => {
  // Counter-test: providers that don't set preserveReasoningContent keep the
  // original strip behaviour from #248 — thinking blocks were causing 400s
  // there, and the fix for #957 must not regress that path.
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'gpt-5-mini'
  const { deserializeMessages } = await importFreshConversationRecovery()

  const deserialized = deserializeMessages([
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'noise' },
          { type: 'text', text: 'answer' },
        ],
      },
    } as any,
  ])

  const content = (deserialized[0] as any)?.message?.content as Array<{
    type: string
  }>
  expect(content.some(block => block.type === 'thinking')).toBe(false)
})
