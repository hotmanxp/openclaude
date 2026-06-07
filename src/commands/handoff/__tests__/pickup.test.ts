import { describe, test, expect } from 'bun:test'
import { renderPickupPrompt } from '../prompts/pickup.js'

describe('renderPickupPrompt', () => {
  test('renders happy-path with pre-read handoff', async () => {
    const text = await renderPickupPrompt({
      pickPath: '/p/.agent_working_dir/handoff/foo-2026-06-07.md',
      pickContent: '# foo\n\nbody',
      errorNote: null,
      cwd: '/p',
      root: '/p/.agent_working_dir/handoff',
      availableFiles: ['foo-2026-06-07.md'],
    })
    expect(text).toContain('# Task: Resume from a handoff document')
    expect(text).toContain('foo-2026-06-07.md')
    expect(text).toContain('# foo')
    expect(text).toContain('body')
    expect(text).toContain('cwd')
    expect(text).toContain('/p')
    expect(text).not.toContain('Warning')
  })

  test('renders error block when handoff is missing', async () => {
    const text = await renderPickupPrompt({
      pickPath: null,
      pickContent: null,
      errorNote: 'Directory `/p/.agent_working_dir/handoff` is empty',
      cwd: '/p',
      root: '/p/.agent_working_dir/handoff',
      availableFiles: ['old-2026-06-06.md', 'new-2026-06-07.md'],
    })
    expect(text).toContain('Warning')
    expect(text).toContain('Directory `/p/.agent_working_dir/handoff` is empty')
    expect(text).toContain('AskUserQuestion')
    expect(text).toContain('`old-2026-06-06.md`')
    expect(text).toContain('`new-2026-06-07.md`')
    expect(text).not.toContain('Pre-read handoff')
  })

  test('error block uses the current slash command name (regression for /handon rename)', async () => {
    const text = await renderPickupPrompt({
      pickPath: null,
      pickContent: null,
      errorNote: 'Directory `/p` is empty',
      cwd: '/p',
      root: '/p',
      availableFiles: [],
    })
    expect(text).toContain('/handoff')
    expect(text).not.toContain('/handon')
  })

  test('renders specific --pick error when file is missing', async () => {
    const text = await renderPickupPrompt({
      pickPath: null,
      pickContent: null,
      errorNote: 'Specified file `missing.md` does not exist',
      cwd: '/p',
      root: '/p/.agent_working_dir/handoff',
      availableFiles: [],
    })
    expect(text).toContain('missing.md')
    expect(text).toContain('does not exist')
  })

  test('resume flow includes re-activate skills step', async () => {
    const text = await renderPickupPrompt({
      pickPath: '/p/.agent_working_dir/handoff/foo-2026-06-07.md',
      pickContent: '## Skills Used\n- commit\n- review-pr',
      errorNote: null,
      cwd: '/p',
      root: '/p/.agent_working_dir/handoff',
      availableFiles: [],
    })
    expect(text).toContain('Re-activate the previously useful skills')
    expect(text).toContain('Skills Used')
    expect(text).toContain('Skill** tool')
    expect(text).toContain('Skills don')
  })
})
