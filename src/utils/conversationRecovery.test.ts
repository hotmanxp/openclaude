// @ts-nocheck
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  deserializeMessagesWithInterruptDetection,
  loadConversationForResume,
  restoreSkillStateFromMessages,
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

function attachmentMsg(uuid: string, value: unknown) {
  return {
    type: 'attachment',
    uuid,
    parentUuid: null,
    timestamp: ts,
    sessionId,
    attachment: value,
  }
}

async function writeJsonl(entry: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'opencc-conversation-recovery-'))
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

test('deserializeMessagesWithInterruptDetection drops attachment messages with malformed payloads', () => {
  const messages = [
    user(id(1), 'hello'),
    attachmentMsg(id(2), null),
    attachmentMsg(id(3), undefined),
    attachmentMsg(id(4), { type: 42 }),
    attachmentMsg(id(5), 'string-not-record'),
    attachmentMsg(id(6), { type: 'new_file', content: { type: 'text', text: 'no filename' } }),
    attachmentMsg(id(7), { type: 'new_directory', content: 'no path' }),
  ]

  const result = deserializeMessagesWithInterruptDetection(messages)
  const types = result.messages.map(message => message.type)
  expect(types).toContain('user')
  expect(types).not.toContain('attachment')
})

test('deserializeMessagesWithInterruptDetection migrates valid legacy attachment displayPath', () => {
  const legacyFilePath = join(process.cwd(), 'src', 'legacy-file.txt')
  const messages = [
    user(id(10), 'hello'),
    attachmentMsg(id(11), {
      type: 'new_file',
      filename: legacyFilePath,
      content: { type: 'text', text: 'legacy file' },
    }),
  ]

  const result = deserializeMessagesWithInterruptDetection(messages)
  const fileAttachment = result.messages.find(message => message.type === 'attachment')
  expect(fileAttachment).toBeDefined()
  const attachmentData = (fileAttachment as { attachment: { type: string; displayPath?: string } }).attachment
  expect(attachmentData.type).toBe('file')
  expect(attachmentData.displayPath).toBe(join('src', 'legacy-file.txt'))
})

test('restoreSkillStateFromMessages ignores invoked_skills attachments with non-array skills', () => {
  const messages = [
    user(id(20), 'hello'),
    attachmentMsg(id(21), { type: 'invoked_skills' }),
    attachmentMsg(id(22), { type: 'invoked_skills', skills: 'not-an-array' }),
    attachmentMsg(id(23), {
      type: 'invoked_skills',
      skills: [{ name: 'x', path: '/tmp/x', content: 'c' }],
    }),
  ]

  expect(() => restoreSkillStateFromMessages(messages)).not.toThrow()
})
