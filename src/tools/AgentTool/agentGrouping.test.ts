import { describe, expect, test } from 'bun:test'

import {
  getActiveAgentsFromList,
  type AgentDefinition,
} from './loadAgentsDir.js'

/**
 * Source grouping for the active-agent list — upstream `bz` (bundle @10651865).
 *
 * The group ORDER encodes precedence: later groups overwrite earlier ones for
 * the same `agentType`. These tests exist because two facts that look like
 * opencc bugs are actually upstream's behaviour, and "fixing" either would be
 * a divergence:
 *
 * 1. A mod-registered agent uses `source: 'plugin'`, not a separate `'mod'`
 *    group. Upstream stamps it exactly that way (L3t, @10654646) and has no
 *    seventh group. It also cannot collide with a markdown agent: the type is
 *    `"<plugin>:<name>"` and `name` is `[A-Za-z0-9_-]{1,64}` (Sro, @6533695),
 *    so `:` is unrepresentable in a bare name.
 * 2. `localSettings` is absent from the group list even though `source` is a
 *    `SettingSource` and `AGENT_SOURCE_GROUPS` lists it for display. Upstream
 *    omits it too.
 */

function agent(agentType: string, source: string): AgentDefinition {
  return {
    agentType,
    whenToUse: `use ${agentType}`,
    source,
  } as unknown as AgentDefinition
}

describe('getActiveAgentsFromList', () => {
  test('keeps an agent from every grouped source', () => {
    const active = getActiveAgentsFromList([
      agent('builtin', 'built-in'),
      agent('plug', 'plugin'),
      agent('user', 'userSettings'),
      agent('proj', 'projectSettings'),
      agent('flag', 'flagSettings'),
      agent('managed', 'policySettings'),
    ])
    expect(active.map(a => a.agentType)).toEqual([
      'builtin',
      'flag',
      'managed',
      'plug',
      'proj',
      'user',
    ])
  })

  test('a mod-registered agent lands in the plugin group and spawns', () => {
    // `plugin:` namespacing is what makes this safe: the project owns `foo`,
    // the registered agent owns `my-mod:foo`, and spawn matches the exact
    // string. Both must survive.
    const active = getActiveAgentsFromList([
      agent('foo', 'projectSettings'),
      agent('my-mod:foo', 'plugin'),
    ])
    expect(active.map(a => a.agentType).sort()).toEqual([
      'foo',
      'my-mod:foo',
    ])
  })

  test('later groups win a name collision, in upstream order', () => {
    const active = getActiveAgentsFromList([
      agent('dup', 'built-in'),
      agent('dup', 'plugin'),
      agent('dup', 'userSettings'),
      agent('dup', 'projectSettings'),
      agent('dup', 'flagSettings'),
      agent('dup', 'policySettings'),
    ])
    expect(active).toHaveLength(1)
    expect(active[0]?.source).toBe('policySettings')
  })

  test('managed beats CLI flag beats project, as upstream orders them', () => {
    expect(
      getActiveAgentsFromList([
        agent('x', 'projectSettings'),
        agent('x', 'flagSettings'),
      ])[0]?.source,
    ).toBe('flagSettings')
    expect(
      getActiveAgentsFromList([
        agent('x', 'flagSettings'),
        agent('x', 'policySettings'),
      ])[0]?.source,
    ).toBe('policySettings')
  })

  test('an ungrouped source is dropped — upstream behaves identically', () => {
    // `localSettings` is a real SettingSource and `AGENT_SOURCE_GROUPS` lists
    // it for display, so this looks like an oversight. It is not one:
    // upstream's `bz` filters for the same six values and no seventh. A local
    // -settings agent reaches `allAgents` and is dropped from `activeAgents`.
    // Changing this would diverge from upstream, so the test pins the current
    // behaviour rather than the wish.
    const all = [agent('shown', 'projectSettings'), agent('hidden', 'localSettings')]
    expect(getActiveAgentsFromList(all).map(a => a.agentType)).toEqual(['shown'])
  })

  test('an empty list yields an empty list', () => {
    expect(getActiveAgentsFromList([])).toEqual([])
  })
})