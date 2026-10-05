import {
  getLoadedMods,
  getModFailureCount,
} from '../../mods/registry.js'
import {
  reloadMods,
  unloadMod,
  getModsDirectory,
  OPENCC_MODS_DIR_ENV,
} from '../../mods/hooks.js'

export async function call(args: string): Promise<{ type: 'text'; value: string }> {
  const trimmed = args.trim()

  if (trimmed === 'reload') {
    const results = await reloadMods()
    const ok = results.filter(r => r.ok).length
    return {
      type: 'text',
      value: `Mods reloaded: ${ok} loaded, ${results.length - ok} failed (dir: ${getModsDirectory()})`,
    }
  }

  const unloadMatch = trimmed.match(/^unload\s+(\S+)$/)
  if (unloadMatch) {
    const removed = await unloadMod(unloadMatch[1]!)
    return {
      type: 'text',
      value: removed
        ? `Mod "${unloadMatch[1]}" unloaded`
        : `Mod "${unloadMatch[1]}" not found`,
    }
  }

  const mods = getLoadedMods()
  const dir = process.env[OPENCC_MODS_DIR_ENV]
    ? `${getModsDirectory()} (via ${OPENCC_MODS_DIR_ENV})`
    : getModsDirectory()
  const lines: string[] = [`Mods dir: ${dir}`, '']
  if (mods.length === 0) {
    lines.push('No mods loaded. Drop a mod folder (with opencc-mod.json) into the mods dir and restart, or run `/mods reload`.')
  } else {
    lines.push('Loaded mods:')
    for (const mod of mods) {
      const failures = getModFailureCount(mod.manifest.name)
      const failureHint = failures > 0 ? ` · ${failures} recent failures` : ''
      lines.push(
        `  ${mod.manifest.name}${mod.manifest.version ? `@${mod.manifest.version}` : ''} — ${mod.handlers.length} handlers, ${mod.tools.length} tools, ${mod.commands.length} commands${failureHint}`,
      )
    }
    lines.push('', 'Actions: /mods reload · /mods unload <name>')
  }
  return { type: 'text', value: lines.join('\n') }
}
