import { BUILTIN_MARKETPLACE_NAME } from '../plugins/builtinPlugins.js'
import type { LoadedPlugin } from '../types/plugin.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'
import { BUILTIN_ORIGIN, getKnownMods, getLoadedMods } from './registry.js'

/**
 * Mod → plugin projection (docs/mods-plan.md §1.3).
 *
 * Upstream ships its own features as bundled plugins: `/diff` is
 * `cc-plugin-diff`, AGENTS.md support is `cc-plugin-agents-md`. They surface
 * in `/plugins` → Installed under a "Built-in" section and can be toggled
 * there. OpenCC ships `/diff`, `/handoff` and `/mermaid` the same way — as
 * mods — but used to give them a private `/mods` command, which put two
 * management surfaces for one extension system in front of the user.
 *
 * This module is the bridge: every loaded mod is projected into the
 * `LoadedPlugin` shape the plugin UI already understands, so mods render in
 * the same list, under the same scope headers, and are toggled through the
 * same `settings.enabledPlugins` key the plugin pipeline already writes.
 *
 * Two ids, two sections (mirroring how upstream splits bundled plugins from
 * marketplace installs):
 *
 *   built-in mod → `<name>@builtin`  →  "Built-in"  section
 *   disk mod     → `<name>@mods`     →  "User"      section
 *
 * Enabled state lives in the SAME `settings.enabledPlugins` map as real
 * plugins (`pluginOperations.setPluginEnabledOp` takes the `@builtin` fast
 * path for exactly this reason) — one toggle key, one source of truth.
 *
 * Read-only by design: this module must stay importable from the loader
 * (mods/hooks.ts gates loading on `isModEnabled`) without pulling the loader
 * back in. The mutating half — `setModEnabled` / `reloadMods` — lives in
 * mods/hooks.ts.
 */

/** Marketplace label for disk mods (`~/.claude/mods/<name>/`). */
export const MODS_MARKETPLACE_NAME = 'mods'

/**
 * Mod data the plugin detail view renders. `LoadedPlugin` has no slot for
 * "how many handlers does this thing have", so it rides along on the object.
 */
export type ModPluginInfo = {
  /** Mod manifest name — the key in the mod registry. */
  modName: string
  /** Absolute mod root, or `BUILTIN_ORIGIN` for in-memory built-ins. */
  root: string
  /** Shipped in the bundle vs. discovered in the mods directory. */
  builtin: boolean
  /** Events this mod subscribed to (`PostToolUse`, `ui.render`, …). */
  handlerEvents: string[]
  /** Registered tool names (runtime `mods_<mod>_<tool>`). */
  toolNames: string[]
  /** Registered command names (unprefixed, as declared in `register`). */
  commandNames: string[]
}

/** Settings key for a mod's enablement. Stable across the id rename. */
export function modPluginId(modName: string, builtin: boolean): string {
  return `${modName}@${builtin ? BUILTIN_MARKETPLACE_NAME : MODS_MARKETPLACE_NAME}`
}

/** True when a plugin id belongs to a built-in mod rather than a mod on disk. */
export function isModBuiltinId(pluginId: string): boolean {
  return pluginId.endsWith(`@${BUILTIN_MARKETPLACE_NAME}`)
}

/** Narrow a plugin that may be a mod projection. */
export function asModPlugin(
  plugin: LoadedPlugin,
): ModPluginInfo | undefined {
  return plugin.mod
}

/**
 * Read a mod's enablement. Absent key means enabled — same default the
 * plugin pipeline uses, so a fresh install shows every mod active.
 */
export function isModEnabled(modName: string, builtin: boolean): boolean {
  const id = modPluginId(modName, builtin)
  return getSettings_DEPRECATED()?.enabledPlugins?.[id] !== false
}

/**
 * Project every known mod into the plugin shape.
 *
 * Known ≠ loaded: a mod /plugins has disabled is deliberately NOT in the
 * registry (its code must not run), but it still needs a row — otherwise
 * turning one off would remove the only control that turns it back on.
 * Those get an empty component list and rely on `enabledPlugins[id] === false`
 * for the greyed-out status the list already renders.
 */
export function getModsAsPlugins(): LoadedPlugin[] {
  const loaded = new Map(getLoadedMods().map(m => [m.manifest.name, m]))
  const plugins: LoadedPlugin[] = []
  for (const [name, meta] of getKnownMods()) {
    const mod = loaded.get(name)
    // A disabled mod has no LoadedMod, so its schema comes from discovery.
    const userConfig = mod?.manifest.userConfig ?? meta.userConfig
    // Origin comes from discovery, not the mod: a loaded mod's `root` says
    // the same thing, but a disabled one has no mod object to ask.
    const builtin = mod ? mod.root === BUILTIN_ORIGIN : meta.builtin
    const pluginId = modPluginId(name, builtin)
    plugins.push({
      name,
      manifest: {
        name,
        ...(mod?.manifest.description
          ? { description: mod.manifest.description }
          : {}),
        ...(mod?.manifest.version ? { version: mod.manifest.version } : {}),
        // Same field real plugins declare options in — which is the whole
        // point: /plugins renders "Configure options" off it, and
        // savePluginOptions writes under the id above, with no mod-specific
        // path anywhere.
        ...(userConfig ? { userConfig: userConfig as LoadedPlugin['manifest']['userConfig'] } : {}),
      },
      // No filesystem path for built-ins (sentinel, mirrors builtinPlugins);
      // disk mods point at their root so error text can name a real location.
      path: builtin ? BUILTIN_MARKETPLACE_NAME : (mod?.root ?? ''),
      source: pluginId,
      repository: pluginId,
      // Both channels are "not installed from a marketplace": they must not be
      // routed through install/uninstall/update paths.
      isBuiltin: true,
      mod: {
        modName: name,
        root: mod?.root ?? '',
        builtin,
        handlerEvents: mod?.handlers.map(h => h.event) ?? [],
        toolNames: mod?.tools.map(t => t.name) ?? [],
        commandNames: mod?.commands.map(c => c.name) ?? [],
      },
    })
  }
  return plugins
}