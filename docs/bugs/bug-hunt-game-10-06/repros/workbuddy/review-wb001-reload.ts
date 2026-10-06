/**
 * 核实裁判对 wb-001 的降档理由：「更常见的 reload 路径不需要第二个 mod」。
 *
 * 裁判的说法：reload 后该 mod 重新注册 → renderTap.ts:49 的
 * hasModRenderHandlers() 短路不成立 → 缓存照查 → 陈旧输出生效。
 *
 * 但这条路径要成立，必须先有一次 reload 之前的缓存写入。
 * 关键问题：同一个 mod 在 reload 后 handler 身份变了，
 * renderTap 的 cache 是否仍然命中旧值？
 */
import {
  transformModRenderText,
  __resetModRenderCacheForTesting,
} from '/Users/ethan/code/opencc/src/mods/renderTap.js'
import {
  registerLoadedMod,
  unregisterMod,
  getLoadedMods,
  resetModsRegistryForTesting,
  type LoadedMod,
} from '/Users/ethan/code/opencc/src/mods/registry.js'
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.js'

function mk(name: string, wrap: (s: string) => string): LoadedMod {
  const mod: LoadedMod = {
    manifest: { name, entry: '(r)' },
    root: '(r)', entryPath: '(r)',
    handlers: [], commands: [], tools: [],
  }
  createModContext(mod).on('ui.render', (e: { text: string }) => wrap(e.text))
  return mod
}

const TEXT = 'graph TD'

// --- 场景 1：单个 mod，reload 前是 v1（加壳） ---
resetModsRegistryForTesting()
__resetModRenderCacheForTesting()
registerLoadedMod(mk('m', s => `[v1:${s}]`))
const r1 = transformModRenderText(TEXT)
console.log('reload 前的输出:', JSON.stringify(r1))

// reload：unregister 旧实例 + 注册新实例（新 handler，无壳）
unregisterMod('m')
registerLoadedMod(mk('m', s => s.toUpperCase()))
console.log('reload 后 loaded:', JSON.stringify(getLoadedMods().map(x => x.manifest.name)))

const r2 = transformModRenderText(TEXT)
console.log('reload 后的输出:', JSON.stringify(r2))
console.log('  ⇒ 缓存陈旧    :', r2 === '[v1:graph TD]' ? 'YES（reload 路径同样陈旧）' : 'no')
console.log('  ⇒ 说明        : 短路不成立（有 handler），cache 命中旧值，与「需第二个 mod」无关')

// --- 场景 2：换一条全新文本（模拟用户继续对话） ---
const TEXT2 = 'graph LR'
const r3 = transformModRenderText(TEXT2)
console.log('\n新文本输出      :', JSON.stringify(r3), '（正确：应为 GRAPH LR）')

resetModsRegistryForTesting()
__resetModRenderCacheForTesting()