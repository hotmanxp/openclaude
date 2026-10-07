import React from 'react'
import type { BuiltinModSpec } from '../builtin.js'
import type { ModContext } from '../engine.js'
import {
  consumeArmedDiff,
  isPaneOpen,
  resetDiffStore,
  setPaneOpen,
} from './diff/store.js'
import { setDiffOptions } from './diff/settings.js'

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

const PANE_ID = 'diff'

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
  /**
   * Every default below is 1:1 with the upstream constant it overrides, so
   * "unset" and "upstream" are the same state. That is deliberate: this mod
   * is a port, and an option whose default silently differs from the port is
   * a claim about upstream behaviour that nobody verified.
   */
  userConfig: {
    minColumns: {
      type: 'number',
      title: 'Minimum terminal width',
      description:
        'Column count below which the diff panel refuses to render. Upstream uses 110; lower it to use the panel in a narrow terminal.',
      required: false,
      default: 110,
      min: 40,
    },
    pollIntervalMs: {
      type: 'number',
      title: 'Refresh interval (ms)',
      description:
        'How often the pane re-reads the worktree. Upstream uses 2000; raise it to poll less often.',
      required: false,
      default: 2000,
      min: 250,
    },
    listWindow: {
      type: 'number',
      title: 'Files shown at once',
      description:
        'Rows of the file list rendered before it starts scrolling. Upstream uses 5.',
      required: false,
      default: 5,
      min: 1,
    },
  },
  register(ctx: ModContext): void {
    // Adopted here rather than read per render: the dialog and pane are
    // separate modules with no handle on ctx, and plugin options are resolved
    // at load time. `/plugins` says "Reload mod" after a change.
    setDiffOptions(ctx.options)
    ctx.on('SessionStart', async (e, next) => {
      resetDiffStore()
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
          // Unregister rather than render nothing: ModPaneArea draws the
          // title and border for every registered pane, so a pane that
          // returns null still leaves an empty box on screen.
          ctx.ui.closePane(PANE_ID)
          onDone(DISMISSED, { display: 'system' })
          return null
        }
        setPaneOpen(true)
        const [{ DiffDialog }, { DiffPane }] = await Promise.all([
          import('./diff/DiffDialog.jsx'),
          import('./diff/DiffPane.jsx'),
        ])
        ctx.ui.pane({ id: PANE_ID, title: 'Diff', component: () => <DiffPane /> })
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
