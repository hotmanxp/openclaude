// @ts-nocheck
import { describe, expect, test } from 'bun:test'

import type { Command } from '../../commands.js'
import {
  buildUnknownSkillMessage,
  shouldBlockForkRecursion,
  SkillTool,
} from './SkillTool.js'
import { renderToolUseMessage } from './UI.js'

function createPromptCommand(
  name: string,
  options: {
    source?: 'builtin' | 'plugin' | 'mcp' | 'bundled'
    loadedFrom?: Command['loadedFrom']
  } = {},
): Command {
  return {
    type: 'prompt',
    name,
    description: `${name} description`,
    progressMessage: `${name} progress`,
    contentLength: 0,
    source: options.source ?? 'builtin',
    loadedFrom: options.loadedFrom,
    async getPromptForCommand() {
      return []
    },
  }
}

describe('SkillTool missing parameter handling', () => {
  test('missing skill stays required at the schema level', async () => {
    const parsed = SkillTool.inputSchema.safeParse({})

    expect(parsed.success).toBe(false)
  })

  test('validateInput still returns an actionable error when called with missing skill', async () => {
    const result = await SkillTool.validateInput?.({} as never, {
      options: { tools: [] },
      messages: [],
    } as never)

    expect(result).toEqual({
      result: false,
      message:
        'Missing skill name. Pass the slash command name as the skill parameter (e.g., skill: "commit" for /commit, skill: "review-pr" for /review-pr).',
      errorCode: 1,
    })
  })

  test('valid skill input still parses and validates', async () => {
    const parsed = SkillTool.inputSchema.safeParse({ skill: 'commit' })

    expect(parsed.success).toBe(true)
  })
})

describe('SkillTool renderToolUseMessage', () => {
  test('plugin skills render correctly without plugin command metadata', () => {
    const pluginSkillName = 'plugin:review-pr'

    expect(
      renderToolUseMessage(
        { skill: pluginSkillName },
        {
          commands: [],
        },
      ),
    ).toBe(pluginSkillName)

    expect(
      renderToolUseMessage(
        { skill: pluginSkillName },
        {
          commands: [
            createPromptCommand(pluginSkillName, {
              source: 'plugin',
              loadedFrom: 'plugin',
            }),
          ],
        },
      ),
    ).toBe(pluginSkillName)
  })

  test('legacy commands still render with a slash prefix when metadata is present', () => {
    expect(
      renderToolUseMessage(
        { skill: 'legacy-command' },
        {
          commands: [
            createPromptCommand('legacy-command', {
              loadedFrom: 'commands_DEPRECATED',
            }),
          ],
        },
      ),
    ).toBe('/legacy-command')
  })
})

describe('buildUnknownSkillMessage', () => {
  const commands = [
    createPromptCommand('commit'),
    createPromptCommand('apps/web:deploy'),
    createPromptCommand('apps/api:deploy'),
  ]

  test('falls back to a bare message when nothing is close', () => {
    expect(buildUnknownSkillMessage('zzzzzzzz', commands)).toBe(
      'Unknown skill: zzzzzzzz',
    )
  })

  test('suggests a single directory-scoped variant by full name', () => {
    const single = [createPromptCommand('apps/web:deploy')]
    expect(buildUnknownSkillMessage('deploy', single)).toBe(
      'Unknown skill: deploy. Did you mean apps/web:deploy? Invoke it by that full name.',
    )
  })

  test('lists every directory-scoped variant when ambiguous', () => {
    const message = buildUnknownSkillMessage('deploy', commands)
    expect(message).toContain('Several skills match that name')
    expect(message).toContain('apps/web:deploy')
    expect(message).toContain('apps/api:deploy')
  })

  test('does not treat an exact match as a scoped variant', () => {
    // `commit` exists; asking for it should never produce a variant list.
    expect(buildUnknownSkillMessage('commit', commands)).toBe(
      'Unknown skill: commit',
    )
  })

  test('falls back to a typo suggestion when no scoped variant exists', () => {
    expect(buildUnknownSkillMessage('comnit', commands)).toBe(
      'Unknown skill: comnit. Did you mean commit?',
    )
  })
})

describe('shouldBlockForkRecursion', () => {
  const forkCtx = { spawnedBySkill: 'deploy', spawnedByForkedSkill: true }

  test('blocks a fork skill re-invoking itself from inside its own fork', () => {
    const command = {
      ...createPromptCommand('deploy'),
      context: 'fork',
    } as Command

    expect(shouldBlockForkRecursion(command, forkCtx as never)).toBe(true)
  })

  test('blocks even without the fork-context flag, purely from spawn provenance', () => {
    // The skill is an inline one, but we were spawned by a fork: re-invoking
    // the same name is still the runaway-recursion case.
    const command = createPromptCommand('deploy')

    expect(shouldBlockForkRecursion(command, forkCtx as never)).toBe(true)
  })

  test('allows a different skill from the same forked context', () => {
    const command = {
      ...createPromptCommand('rollback'),
      context: 'fork',
    } as Command

    expect(shouldBlockForkRecursion(command, forkCtx as never)).toBe(false)
  })

  test('allows the same skill from the main conversation', () => {
    const command = {
      ...createPromptCommand('deploy'),
      context: 'fork',
    } as Command

    expect(shouldBlockForkRecursion(command, {} as never)).toBe(false)
  })

  test('never blocks a non-prompt command', () => {
    const local = { type: 'local', name: 'deploy' } as unknown as Command

    expect(shouldBlockForkRecursion(local, forkCtx as never)).toBe(false)
  })
})
