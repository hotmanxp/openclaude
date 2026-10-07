/**
 * wb-r01 对照实验的修正版 —— 裁判指出原脚本的对照组失效，这个批评是对的。
 *
 * 原因：renderTap.ts:19 的 cache 是模块级，:50 cache.get('hello') 直接命中
 * 前一段 wrapper mod 留下的陈旧条目，链根本没重跑。
 * 正确做法：每次对照前必须调用 __resetModRenderCacheForTesting() 清缓存，
 * 否则第二次测的是缓存而不是 handler。
 *
 * 这个修正版用来验证 wb-r01 的正文结论本身是否成立
 * （即：非幂等 handler 被套两层，幂等 handler 不受影响）。
 */
import {
  transformModRenderText,
  __resetModRenderCacheForTesting,
} from '/Users/ethan/code/opencc/src/mods/renderTap.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
  type LoadedMod,
} from '/Users/ethan/code/opencc/src/mods/registry.js'
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.js'

function fresh(text: string) {
  __resetModRenderCacheForTesting() // 关键：原脚本漏了这一步
  const outer = transformModRenderText(text)
  const inner = transformModRenderText(outer)
  return { outer, inner }
}

// --- 对照 A：非幂等 handler（包裹型）---
resetModsRegistryForTesting()
const m1: LoadedMod = {
  manifest: { name: 'wrapper', entry: '(review)' },
  root: '(review)', entryPath: '(review)',
  handlers: [], commands: [], tools: [],
}
createModContext(m1).on('ui.render', (e: { text: string }) => `<mod>${e.text}</mod>`)
registerLoadedMod(m1)
const A = fresh('hello')
console.log('A 非幂等 (包裹型)')
console.log('   外层:', JSON.stringify(A.outer))
console.log('   内层:', JSON.stringify(A.inner))
console.log('   被套两层:', A.inner === '<mod><mod>hello</mod></mod>' ? 'YES' : 'no')

// --- 对照 B：幂等 handler（大写）---
resetModsRegistryForTesting()
__resetModRenderCacheForTesting()
const m2: LoadedMod = {
  manifest: { name: 'upper', entry: '(review)' },
  root: '(review)', entryPath: '(review)',
  handlers: [], commands: [], tools: [],
}
createModContext(m2).on('ui.render', (e: { text: string }) => e.text.toUpperCase())
registerLoadedMod(m2)
const B = fresh('hello')
console.log('\nB 幂等 (toUpperCase)')
console.log('   外层:', JSON.stringify(B.outer))
console.log('   内层:', JSON.stringify(B.inner))
console.log('   被套两层:', B.inner === '<MOD><MOD>HELLO</MOD></MOD>' ? 'YES' : 'no')
console.log('   二次变换与一次等价:', B.inner === B.outer ? 'YES（幂等，免疫）' : 'no')

resetModsRegistryForTesting()