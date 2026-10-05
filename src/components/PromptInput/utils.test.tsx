// @ts-nocheck
// Covers only the border-color and standalone-banner helpers. Upstream's
// version of this file also tests normalizePromptInputChunk,
// resolveCoalescedModeSubmission, resolveHelpToggleChange and
// canAcceptPromptSuggestion, none of which exist in this fork.
import { PassThrough } from 'node:stream'
import { expect, test } from 'bun:test'
import React from 'react'
import { createRoot } from '../../ink.js'
import { AppStateProvider, getDefaultAppState } from '../../state/AppState.js'
import {
  resolvePromptBorderColor,
  shouldShowStandaloneAgentBanner,
} from './utils.js'
import { useSwarmBanner } from './useSwarmBanner.js'

function createTestStreams(columns: number) {
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = columns
  return { stdout, stdin }
}

/** Mounts the real hook under an AppState provider and returns what it saw. */
async function renderSwarmBanner(standaloneAgentContext, teamContext) {
  const { stdout, stdin } = createTestStreams(120)
  const root = await createRoot({ stdout, stdin })
  let observedBanner
  let notifyRendered
  const rendered = new Promise(resolve => {
    notifyRendered = resolve
  })

  function HookProbe() {
    observedBanner = useSwarmBanner()
    React.useEffect(() => {
      notifyRendered()
    }, [])
    return null
  }

  try {
    root.render(
      <AppStateProvider
        initialState={{
          ...getDefaultAppState(),
          standaloneAgentContext,
          teamContext,
        }}
      >
        <HookProbe />
      </AppStateProvider>,
    )
    await rendered
    return observedBanner
  } finally {
    root.unmount()
    stdout.destroy()
    stdin.destroy()
  }
}

test('does not create a banner for a color-only standalone context', () => {
  expect(shouldShowStandaloneAgentBanner(undefined)).toBe(false)
  expect(shouldShowStandaloneAgentBanner('')).toBe(false)
  expect(shouldShowStandaloneAgentBanner('   ')).toBe(false)
})

test('creates a banner when a standalone agent has a usable name', () => {
  expect(shouldShowStandaloneAgentBanner('renato')).toBe(true)
})

test('standalone border color respects mode and team identity', () => {
  const standalone = {
    mode: 'prompt' as const,
    inProcessTeammate: false,
    standaloneColor: 'blue',
    ultracodeActive: false,
  }
  expect(resolvePromptBorderColor(standalone)).toBe('blue_FOR_SUBAGENTS_ONLY')
  expect(resolvePromptBorderColor({ ...standalone, mode: 'bash' })).toBe('bashBorder')
  expect(resolvePromptBorderColor({ ...standalone, inProcessTeammate: true })).toBe('promptBorder')
  expect(resolvePromptBorderColor({ ...standalone, teammateColor: 'red' })).toBe('red_FOR_SUBAGENTS_ONLY')
  // An unrecognized color falls through to the next eligible identity.
  expect(resolvePromptBorderColor({ ...standalone, teammateColor: 'invalid' })).toBe('blue_FOR_SUBAGENTS_ONLY')
  expect(resolvePromptBorderColor({ ...standalone, teamName: 'team', teammateColor: 'red' })).toBe('red_FOR_SUBAGENTS_ONLY')
  // An active team suppresses the saved standalone color entirely.
  expect(resolvePromptBorderColor({ ...standalone, teamName: 'team' })).toBe('promptBorder')
  expect(resolvePromptBorderColor({ ...standalone, teamName: 'team', ultracodeActive: true })).toBe('ultracode')
  expect(resolvePromptBorderColor({ ...standalone, standaloneColor: 'invalid' })).toBe('promptBorder')
  expect(resolvePromptBorderColor({ ...standalone, standaloneColor: undefined, ultracodeActive: true })).toBe('ultracode')
  // Agent identity outranks the ambient ultracode indicator.
  expect(resolvePromptBorderColor({ ...standalone, ultracodeActive: true })).toBe('blue_FOR_SUBAGENTS_ONLY')
})

test('border color reads production AppState member identity before dynamic fallback', () => {
  const leader = {
    name: 'team-lead', color: 'red', tmuxSessionName: '', tmuxPaneId: '',
    cwd: '/test', spawnedAt: 0,
  }
  const teamContext = {
    teamName: 'active-team', teamFilePath: '/test/team.json', leadAgentId: 'leader',
    teammates: { leader, member: { ...leader, name: 'member', color: 'green' } },
  }
  const input = {
    mode: 'prompt' as const, inProcessTeammate: false, teamContext,
    standaloneColor: 'blue', ultracodeActive: true,
  }
  // TeamCreateTool stores the leader color in teammates, without selfAgentColor.
  expect(resolvePromptBorderColor(input)).toBe('red_FOR_SUBAGENTS_ONLY')
  expect(resolvePromptBorderColor({ ...input, teammateColor: 'yellow' })).toBe('red_FOR_SUBAGENTS_ONLY')
  expect(resolvePromptBorderColor({ ...input, teamContext: { ...teamContext, selfAgentId: 'member' } })).toBe('green_FOR_SUBAGENTS_ONLY')
  expect(resolvePromptBorderColor({ ...input, teamContext: { ...teamContext, selfAgentColor: 'purple' } })).toBe('purple_FOR_SUBAGENTS_ONLY')
  expect(resolvePromptBorderColor({ ...input, teamContext: { ...teamContext, selfAgentId: 'missing' }, teammateColor: 'yellow' })).toBe('yellow_FOR_SUBAGENTS_ONLY')
  expect(resolvePromptBorderColor({ ...input, teamContext: { ...teamContext, teammates: {} } })).toBe('ultracode')
  expect(resolvePromptBorderColor({ ...input, teamContext: { ...teamContext, teammates: {}, selfAgentColor: 'invalid' }, teammateColor: 'yellow' })).toBe('yellow_FOR_SUBAGENTS_ONLY')
  expect(resolvePromptBorderColor({ ...input, mode: 'bash' })).toBe('bashBorder')
  expect(resolvePromptBorderColor({ ...input, inProcessTeammate: true })).toBe('promptBorder')
})

test('a color-only standalone agent gets no banner, and a team suppresses a saved one', async () => {
  // The regression: a color with no name used to render an empty banner that
  // pushed the prompt down a line.
  expect(
    await renderSwarmBanner({ name: '', color: 'blue' }, undefined),
  ).toBe(null)
  expect(
    await renderSwarmBanner({ name: '   ', color: 'blue' }, undefined),
  ).toBe(null)
  // A team is active, so the saved standalone identity must not also render.
  expect(
    await renderSwarmBanner({ name: 'saved-agent', color: 'blue' }, {
      teamName: 'active-team',
      teamFilePath: '/test/team.json',
      leadAgentId: 'team-lead',
      isLeader: true,
      selfAgentColor: 'red',
      teammates: {},
    }),
  ).toBe(null)
  // With no team, the saved identity does show.
  expect(
    await renderSwarmBanner({ name: 'saved-agent', color: 'blue' }, undefined),
  ).toEqual({ text: 'saved-agent', bgColor: 'blue_FOR_SUBAGENTS_ONLY' })
})
