/**
 * 评审中额外发现（我自己的 wb-extra-01）：
 * ui.render 的 mod 变换链在助手消息渲染路径上被套了两遍。
 *
 * AssistantTextMessage.tsx:243  <Markdown>{transformModRenderText(text)}</Markdown>
 *   → Markdown.tsx:237-238 两半又各调一次 transformModRenderText(...)
 *
 * renderTap.ts 的 cache 以「原始文本」为 key、以「链输出」为 value：
 * 第一遍输出 out1 = H(text) 被写入 cache[text] = out1。
 * 第二遍 Markdown 内部对 out1 再跑链：cache 命中 out1（key 是 out1≠text）→
 * 实际是 runModChainSync(out1) = H(H(text)) = out2。
 *
 * 只要 handler 非幂等（H(x) ≠ H(H(x))，例如包裹、加前缀、转义），
 * 用户看到的就是被变换两次的文本。
 *
 * 直接跑真实 renderTap 模块（无 mock），仅手动模拟两层调用结构。
 */
import { transformModRenderText } from '/Users/ethan/code/opencc/src/mods/renderTap.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
  type LoadedMod,
} from '/Users/ethan/code/opencc/src/mods/registry.js'
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.js'

// 非幂等 handler：给文本加一层壳（mermaid 类 mod 常见形态）
function makeMod(name: string) {
  const mod: LoadedMod = {
    manifest: { name, entry: '(review)' },
    root: '(review)',
    entryPath: '(review)',
    handlers: [],
    commands: [],
    tools: [],
  }
  const ctx = createModContext(mod)
  ctx.on('ui.render', (e: { text: string }) => `<mod>${e.text}</mod>`)
  return mod
}
registerLoadedMod(makeMod('wrapper'))

const TEXT = 'hello'

// 第一层：AssistantTextMessage.tsx:243
const afterOuter = transformModRenderText(TEXT)
console.log('原始文本           :', JSON.stringify(TEXT))
console.log('外层 transform     :', JSON.stringify(afterOuter))

// 第二层：Markdown.tsx:237-238 对该结果再调一次
const afterInner = transformModRenderText(afterOuter)
console.log('内层 transform     :', JSON.stringify(afterInner))

console.log()
console.log('单次链的正确输出应为:', JSON.stringify(`<mod>${TEXT}</mod>`))
console.log(
  '  ⇒ 被套了两层     :',
  afterInner === `<mod><mod>${TEXT}</mod></mod>` ? 'YES（handler 幂等性被破坏）' : 'no',
)

// 幂等 handler 对照：H(x)=x.toUpperCase() 也非幂等，验证这不是个例
resetModsRegistryForTesting()
const m2: LoadedMod = {
  manifest: { name: 'upper', entry: '(review)' },
  root: '(review)',
  entryPath: '(review)',
  handlers: [],
  commands: [],
  tools: [],
}
createModContext(m2).on('ui.render', (e: { text: string }) =>
  e.text.toUpperCase(),
)
registerLoadedMod(m2)
const up1 = transformModRenderText(TEXT)
const up2 = transformModRenderText(up1)
console.log('\n幂等对照 toUpperCase: 外层', JSON.stringify(up1), '内层', JSON.stringify(up2), '（大小写 handler 恰好幂等）')

resetModsRegistryForTesting()