import { transformModRenderText, __resetModRenderCacheForTesting } from '/Users/ethan/code/opencc/src/mods/renderTap.js'
import { runModRenderChainSync, hasModRenderHandlers } from '/Users/ethan/code/opencc/src/mods/dispatch.js'
import { registerLoadedMod, unregisterMod, resetModsRegistryForTesting } from '/Users/ethan/code/opencc/src/mods/registry.js'
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.js'
console.log('IMPORT_OK', typeof transformModRenderText, typeof runModRenderChainSync, typeof createModContext)
