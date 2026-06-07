import { describe, test, expect } from 'bun:test'
import { extractSkillsUsed } from '../extract-skills.js'

// Skill tool_use block factory
function skillCall(skill: string) {
  return {
    type: 'tool_use',
    name: 'Skill',
    input: { skill },
  }
}

function otherCall(name: string) {
  return { type: 'tool_use', name, input: {} }
}

function messageWith(content: unknown[]) {
  return { message: { content } }
}

function userText(text: string) {
  return { message: { content: text } }
}

describe('extractSkillsUsed', () => {
  test('returns empty array for empty messages', () => {
    expect(extractSkillsUsed([])).toEqual([])
  })

  test('extracts single skill from one message', () => {
    const messages = [messageWith([skillCall('commit')])]
    expect(extractSkillsUsed(messages)).toEqual(['commit'])
  })

  test('extracts multiple skills in order, dedupes', () => {
    const messages = [
      messageWith([skillCall('commit')]),
      messageWith([skillCall('review-pr')]),
      messageWith([skillCall('commit')]), // dup
    ]
    expect(extractSkillsUsed(messages)).toEqual(['commit', 'review-pr'])
  })

  test('ignores non-Skill tool_use blocks', () => {
    const messages = [
      messageWith([otherCall('Bash'), skillCall('commit'), otherCall('Read')]),
    ]
    expect(extractSkillsUsed(messages)).toEqual(['commit'])
  })

  test('ignores plain string content (user text messages)', () => {
    const messages = [userText('hello world'), messageWith([skillCall('pdf')])]
    expect(extractSkillsUsed(messages)).toEqual(['pdf'])
  })

  test('skips skill calls with missing skill field', () => {
    const messages = [
      messageWith([
        { type: 'tool_use', name: 'Skill', input: {} },
        skillCall('commit'),
      ]),
    ]
    expect(extractSkillsUsed(messages)).toEqual(['commit'])
  })
})
