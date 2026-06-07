// .claude/workflows/serial-stats-verify.js
//
// 串行 3-agent 验证：每个 agent 跑完一个简单任务后停下，user 可以
// 在 /workflows panel 里逐个看到 model / tokens / tools 是否正确
// 更新。比 opencc-bug-hunt 的 6-parallel 更适合 debug stats wire-up。
//
// 3 个 agent：
//   1. 读 README.md 第一行 → 回复 5 个词（验证 Read 工具 + 1 tool call）
//   2. Bash: echo hello-world → 回复 output（验证 Bash 工具）
//   3. 读 package.json → 回复 "name" 字段值（验证 Read 工具）

__setMeta({
  name: 'serial-stats-verify',
  description: '3 个简单 agent 串行运行，用来在 /workflows 面板逐个看 model+token+tool 是否显示',
  phases: [
    { title: 'A1: 读 README' },
    { title: 'A2: bash echo' },
    { title: 'A3: 读 package.json' },
  ],
})

// Phase 1
const a1 = await agent(
  '用 Read 工具读 /Users/ethan/code/opencc/README.md，回复我第一行的前 5 个词（英文或中文，词之间空格隔开）。不要做任何其他事情。',
  {
    agentType: 'Explore',
    label: 'A1: read README.md L1',
    phase: 'A1: 读 README',
  }
)
log(`A1 done: ${(a1.report || '').slice(0, 60)}`)

// Phase 2
const a2 = await agent(
  '用 Bash 工具执行 `echo hello-world-stats-verify` 并把 stdout 完整回复给我。不要做其他事情。',
  {
    agentType: 'Explore',
    label: 'A2: bash echo',
    phase: 'A2: bash echo',
  }
)
log(`A2 done: ${(a2.report || '').slice(0, 60)}`)

// Phase 3
const a3 = await agent(
  '用 Read 工具读 /Users/ethan/code/opencc/package.json，把 "name" 字段的值原样回复给我。不要做其他事情。',
  {
    agentType: 'Explore',
    label: 'A3: read package.json name',
    phase: 'A3: 读 package.json',
  }
)
log(`A3 done: ${(a3.report || '').slice(0, 60)}`)

return {
  report: `A1=${(a1.report || '').trim()}\nA2=${(a2.report || '').trim()}\nA3=${(a3.report || '').trim()}`,
}
