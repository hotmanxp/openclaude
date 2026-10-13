import { describe, expect, test } from 'bun:test'
import { skillDoctorBuiltinMod } from './skillDoctorMod.js'
import { createModContext } from '../engine.js'
import type { LoadedMod } from '../registry.js'

function harness(): LoadedMod {
  const mod: LoadedMod = {
    manifest: { name: 'skill-doctor', entry: '(builtin)' },
    root: '(builtin)',
    entryPath: '(builtin)',
    handlers: [],
    commands: [],
    tools: [],
  }
  skillDoctorBuiltinMod.register(createModContext(mod))
  return mod
}

describe('skill-doctor built-in mod — registration', () => {
  test('registers /skill-doctor as a local-jsx command', () => {
    const command = harness().commands.find(c => c.name === 'skill-doctor')
    expect(command).toBeDefined()
    // The report is rendered, not printed as text — same contract the host
    // command had, now supplied by the mod.
    expect(command!.type).toBe('local-jsx')
    expect(command!.call).toBeDefined()
  })

  test('registers no pane or event handler', () => {
    const mod = harness()
    expect(mod.commands).toHaveLength(1)
    expect(mod.handlers).toHaveLength(0)
    expect(mod.tools).toHaveLength(0)
  })

  test('description is user-facing Chinese, not the upstream English', () => {
    const command = harness().commands.find(c => c.name === 'skill-doctor')!
    expect(command.description).toBe(
      '查看已加载技能的使用率与上下文开销，便于清理闲置技能',
    )
  })
})

describe('skill-doctor built-in mod — the report', () => {
  const callOf = (mod: LoadedMod) =>
    mod.commands.find(c => c.name === 'skill-doctor')!.call!

  test('call resolves to a view over the loaded skill commands', async () => {
    // No JSX is rendered here; the host owns that. What matters is that the
    // dynamic import chain closes and the call settles instead of throwing a
    // TDZ or module-resolution error.
    const element = await callOf(harness())(() => {}, {} as never, '')
    expect(element).toBeTruthy()
  })

  test('the view closes through onDone, not a stray return value', async () => {
    const element = await callOf(harness())(() => {}, {} as never, '')
    // Esc is handled by Dialog's `confirm:no` binding, which calls the
    // onCancel prop. The prop is wired to onDone, so dismissing must reach the
    // host — a view that only returned null would leave the report stuck open.
    const onCancel = (element as { props: { onCancel: () => void } }).props
      .onCancel
    expect(typeof onCancel).toBe('function')

    const seen: unknown[] = []
    const mod = harness()
    const withSpy = await callOf(mod)(
      (...args: unknown[]) => {
        seen.push(args)
      },
      {} as never,
      '',
    )
    ;(withSpy as { props: { onCancel: () => void } }).props.onCancel()
    // No result text and no shouldQuery — the report is read-only and must not
    // enter the conversation when dismissed.
    expect(seen).toEqual([[]])
  })
})