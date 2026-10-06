import React from 'react'
import type { BuiltinModSpec } from '../builtin.js'
import type { ModContext } from '../engine.js'
import {
  consumeArmedDiff,
  isPaneOpen,
  resetDiffStore,
  setPaneOpen,
} from './diff/store.js'

/**
 * Built-in `diff` mod — opencc parity of upstream `cc-plugin-diff`
 * ("The diff panel as a plugin pane: /diff, the changed files and their
 * hunks beside the transcript, refreshed as Claude edits").
 *
 * Upstream ships this as a plugin that contributes two things: a `/diff`
 * command that opens a dialog, and a pane that keeps the same list beside
 * the transcript. Both read the same git-backed store, so the dialog is a
 * focused view of what the pane already shows. The git side is in ./diff.
 *
 * The pane used to show a session-scoped log of what the model changed
 * through Edit/Write. That has no upstream counterpart and no consumer left
 * once `/diff` became the dialog, so it is gone rather than kept as a
 * second, smaller pane competing for the same space.
 */

/** Upstream's string when the dialog closes without a selection. */
const DISMISSED = 'Diff dialog dismissed'

/**
 * The dialog and the pane are imported lazily, never at module scope.
 *
 * `mods/builtin.ts` calls `registerBuiltinMod(diffBuiltinMod)` while it is
 * still evaluating, so anything this module imports at the top level has to
 * finish loading before `diffBuiltinMod` exists. The component tree reaches
 * back into `mods/builtin.ts` and re-enters it mid-evaluation, which throws
 * "Cannot access 'diffBuiltinMod' before initialization". Deferring both
 * imports past registration breaks the cycle without touching the host.
 */

export const diffBuiltinMod: BuiltinModSpec = {
  name: 'diff',
  version: '1.0.0',
  description:
    'Uncommitted changes as a live pane, and /diff to open the same list as a dialog',
  register(ctx: ModContext): void {
    ctx.on('SessionStart', async (e, next) => {
      resetDiffStore()
      const { DiffPane } = await import('./diff/DiffPane.jsx')
      ctx.ui.pane({
        id: 'diff',
        title: 'Diff',
        component: () => <DiffPane />,
      })
      return next(e)
    })

    // An armed file rides the next prompt. The arming is consumed here
    // rather than on submit failure: the attachment belongs to the turn the
    // user asked for, and re-arming it would silently duplicate the diff.
    ctx.on('UserPromptSubmit', async (e, next) => {
      const armed = consumeArmedDiff()
      if (armed === null) return next(e)
      return next({
        ...e,
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: armed,
        },
      })
    })

    ctx.registerCommand({
      // Upstream ships /diff as the `cc-plugin-diff` plugin, whose command
      // opens a dialog over `git diff HEAD` rather than printing text. The
      // host /diff that used to own this name was removed in eeb58339; the
      // mod keeps the name, but now renders the dialog the plugin renders.
      name: 'diff',
      type: 'local-jsx',
      description: 'Toggle the diff panel, or open it on a changed file',
      call: async onDone => {
        // Upstream describes this command as "Toggle the diff panel showing
        // uncommitted changes": turning it off closes the pane and shows no
        // dialog, because there would be nothing to focus. Turning it on
        // reveals the pane and opens the dialog over it.
        if (isPaneOpen()) {
          setPaneOpen(false)
          // The store's own listeners only re-render the component that
          // subscribed; the host needs telling to drop the pane's rows.
          ctx.ui.notify()
          onDone(DISMISSED, { display: 'system' })
          return null
        }
        setPaneOpen(true)
        ctx.ui.notify()
        const { DiffDialog } = await import('./diff/DiffDialog.jsx')
        return (
          <DiffDialog
            onDone={() => onDone(DISMISSED, { display: 'system' })}
            setStatus={text => ctx.ui.status(text)}
          />
        )
      },
    })

  },
}
