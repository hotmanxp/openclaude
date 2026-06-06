// .claude/workflows/opencc-bug-hunt.js
//
// Read-only bug hunt across the opencc repo. Discovers candidates via
// 6 parallel finder agents (each with its own lens), triages to a top
// 10 with a judge agent, deep-dives the top 3 in parallel, and produces
// a final structured report. The script itself never writes to disk
// or touches git — it only reads.
//
// Invocation: /opencc-bug-hunt (no args)

export const meta = {
  name: 'opencc-bug-hunt',
  description: '只读分析 opencc 仓库，输出 10 bug 排序 + Top 3 修复方案（不写文件、不动 git）',
  phases: [
    { title: 'Discovery: 6 lens 扫描' },
    { title: 'Triage: 严重性排序' },
    { title: 'Deep-dive: Top 3 修复方案' },
    { title: 'Synthesis: 最终报告' }
  ]
}
// Push meta to main so the WorkflowDetailDialog can render the
// Phases pane. The worker wrapper doesn't auto-hoist ESM `export const`
// bindings — we have to call __setMeta() explicitly. (The bundler
// strips this `export const` keyword before the wrapper IIFE runs, so
// the bare local `meta` would otherwise be unreachable.)
__setMeta(meta)

// ============== Schemas (强约束 subagent 输出) ==============
const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    lens:   { type: 'string' },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file:             { type: 'string' },
          line:             { type: 'number' },
          function:         { type: 'string' },
          evidence:         { type: 'string' },
          category:         { type: 'string' },
          severity_hint:    { type: 'string', enum: ['high', 'medium', 'low'] },
          related_symbols:  { type: 'array', items: { type: 'string' } }
        },
        required: ['file', 'line', 'evidence', 'severity_hint']
      }
    }
  },
  required: ['lens', 'candidates']
}

const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    ranked: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rank:        { type: 'number' },
          file:        { type: 'string' },
          line:        { type: 'number' },
          title:       { type: 'string' },
          category:    { type: 'string' },
          score:       { type: 'number' },  // 0..10
          impact:      { type: 'number' },  // 1..3
          likelihood:  { type: 'number' },  // 1..3
          exposure:    { type: 'number' },  // 1..3
          summary:     { type: 'string' },
          evidence:    { type: 'string' }
        },
        required: ['rank', 'file', 'line', 'title', 'score', 'summary', 'evidence']
      }
    },
    top3_ids: { type: 'array', items: { type: 'string' } }
  },
  required: ['ranked', 'top3_ids']
}

const DEEP_DIVE_SCHEMA = {
  type: 'object',
  properties: {
    rank:           { type: 'number' },
    title:          { type: 'string' },
    summary:        { type: 'string' },
    repro_steps:    { type: 'array', items: { type: 'string' } },
    root_cause:     { type: 'string' },
    call_path:      { type: 'array', items: { type: 'string' } },
    existing_tests: { type: 'array', items: { type: 'string' } },
    proposed_fix: {
      type: 'object',
      properties: {
        approach: { type: 'string' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path:   { type: 'string' },
              line:   { type: 'number' },
              before: { type: 'string' },
              after:  { type: 'string' }
            },
            required: ['path', 'before', 'after']
          }
        },
        regression_test: {
          type: 'object',
          properties: {
            path:   { type: 'string' },
            name:   { type: 'string' },
            sketch: { type: 'string' }
          },
          required: ['path', 'name']
        }
      },
      required: ['approach', 'files']
    },
    risk:     { type: 'string', enum: ['low', 'medium', 'high'] },
    estimate: { type: 'string', enum: ['S', 'M', 'L'] }
  },
  required: ['rank', 'title', 'summary', 'proposed_fix']
}

const FINAL_SCHEMA = {
  type: 'object',
  properties: {
    bugs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rank:     { type: 'number' },
          score:    { type: 'number' },
          title:    { type: 'string' },
          file:     { type: 'string' },
          line:     { type: 'number' },
          summary:  { type: 'string' },
          evidence: { type: 'string' }
        },
        required: ['rank', 'score', 'title', 'file', 'line']
      }
    },
    top3: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rank:        { type: 'number' },
          title:       { type: 'string' },
          summary:     { type: 'string' },
          repro_steps: { type: 'array', items: { type: 'string' } },
          root_cause:  { type: 'string' },
          proposed_fix:{ type: 'object' }
        },
        required: ['rank', 'title', 'summary', 'proposed_fix']
      }
    },
    notes: { type: 'string' }
  },
  required: ['bugs', 'top3']
}

// ============== Helper: 构造 finder prompt ==============
const finderPrompt = (lens, label, areas, focus) => `
  你是 opencc 仓库（/Users/ethan/code/opencc）的 bug finder，专注 lens: ${lens} — ${label}。

  优先区域：${areas}

  检查重点：
  ${focus}

  硬约束：
  - 只读！不许 Edit/Write/Bash 改文件
  - 用 codegraph_search / codegraph_context / codegraph_trace 定位
  - 用 Read 拿具体行（最多 3 次 codegraph + 3 次 Read）
  - 每条 candidate 必须有 file:line + 一句话 evidence + severity_hint
  - 忽略 dist/、node_modules/、vendor/、*.test.ts 自身
  - 不要重复 AGENTS.md 已记录的 silenced test

  输出严格按 schema（candidates 数组，不要其他外层包装）。
`

// ============== 6 个 finder lens ==============
const LENSES = [
  {
    key: 'F1',
    label: 'Error handling 黑洞',
    areas: 'src/services/, src/grpc/, src/QueryEngine.ts, src/coordinator/',
    focus: `- try/catch 空块 (catch {})
  - 错误重新包装时丢堆栈
  - async 函数未 await / promise rejection 静默
  - error 路径返回 ok 状态码`
  },
  {
    key: 'F2',
    label: '并发 / 竞态',
    areas: 'src/coordinator/, src/hooks/, src/ink.ts, src/components/',
    focus: `- shared mutable state 无锁
  - async 回调关闭 stale state
  - timer / interval / AbortController 未清理
  - React/Ink useEffect 缺 cleanup
  - profile 并发写 .claude-profile.json`
  },
  {
    key: 'F3',
    label: '资源泄漏',
    areas: 'src/services/api/openaiShim.ts, src/grpc/, src/tools/, src/services/',
    focus: `- unclosed SSE stream / ReadableStream
  - fs handle / fd 未 close
  - event listener 未 removeListener
  - SIGINT/SIGTERM 处理后 child process 残留
  - AbortSignal 未传递`
  },
  {
    key: 'F4',
    label: 'Provider shim 正确性',
    areas: 'src/services/api/openaiShim.ts, src/services/api/codexShim.ts, src/services/api/client.ts, src/services/api/providerConfig.ts',
    focus: `- SSE ↔ Anthropic stream event 翻译错位
  - tool_use / tool_result 跨模型 roundtrip 丢字段
  - token 计数与 max_tokens 边界
  - stream 截断 / 中途 cancel 的状态机
  - function call 名字/参数不匹配时的回退`
  },
  {
    key: 'F5',
    label: 'Null / undefined / 边界',
    areas: 'src/utils/, src/commands/, src/schemas/, src/services/api/providerConfig.ts',
    focus: `- indexed access 越界（数组/map.get 无 fallback）
  - JSON.parse 缺 try/catch
  - env var 缺默认值
  - 配置缺失时的隐式 undefined 穿透
  - Zod / schema 校验不一致`
  },
  {
    key: 'F6',
    label: 'TUI / Ink 状态 & 副作用',
    areas: 'src/components/, src/hooks/, src/keybindings/, src/main.tsx, src/ink.ts, src/dialogLaunchers.tsx',
    focus: `- useEffect stale closure
  - 键盘输入与 React render 竞争
  - profile 写盘未 fsync
  - 大输出截断/换行错位
  - terminal resize / 颜色 / width 边界`
  }
]

// ============== Phase 1: DISCOVERY ==============
phase('Discovery: 6 lens 扫描')

log(`启动 ${LENSES.length} 个 finder agent（不同 lens）`)

const discovery = await parallel(LENSES.map(lens => () =>
  agent(finderPrompt(lens.key, lens.label, lens.areas, lens.focus), {
    label: `finder ${lens.key}: ${lens.label}`,
    phase: 'Discovery: 6 lens 扫描',
    schema: FINDING_SCHEMA
  })
))

const validCandidates = discovery.filter(Boolean).flatMap(r => r.candidates)
log(`共回收 ${validCandidates.length} 条原始 candidate`)

// ============== Phase 2: TRIAGE ==============
phase('Triage: 严重性排序')

const triagePrompt = `
  你是 opencc bug hunt 的 triage judge。

  输入：6 个 finder 的原始 candidate（去重后）:
  ${JSON.stringify(validCandidates, null, 2)}

  任务：
  1. 跨 lens 去重（同一 file+line+function 合并为一条）
  2. 排序公式（满分 10）：
     score = (Impact × 3) + (Likelihood × 2) + (Exposure × 1)
     - Impact:     3=数据丢失/安全/静默坏数据, 2=功能挂/崩溃, 1=UX 差/性能
     - Likelihood: 3=默认路径必触发,    2=特定 env/race 触发, 1=理论可能
     - Exposure:   3=默认 provider 用户可见, 2=opt-in/dev 路径, 1=纯内部
  3. 取前 10（不足 10 条就全给），按 rank 升序
  4. 标记 top3_ids（rank 数组前 3）
  5. summary ≤ 80 字，evidence 必须含 file:line

  输出严格按 schema。
`

const triage = await agent(triagePrompt, {
  label: 'judge: severity 排序',
  phase: 'Triage: 严重性排序',
  schema: TRIAGE_SCHEMA
})

log(`Top 10 已排序，前 3 准备 deep-dive`)

// ============== Phase 3: DEEP-DIVE (top 3 并行) ==============
phase('Deep-dive: Top 3 修复方案')

const top3 = triage.ranked.slice(0, 3)

// budget guard：每个 deep-dive 大约 30k token，3 个 ~90k
if (budget.total && budget.remaining() < 100000) {
  log(`预算紧张 (${budget.remaining()})，deep-dive 数量裁到 2`)
  top3.length = 2
}

const deepDives = await parallel(top3.map(bug => () => {
  const prompt = `
  你是 opencc 仓库的 senior engineer，要为 rank #${bug.rank} 的 bug 出修复方案。

  Bug 信息：
  ${JSON.stringify(bug, null, 2)}

  任务：
  1. 用 codegraph_trace 走完整 call path（从入口触发到 bug 点）
  3. 找现有 *.test.ts 覆盖情况（codegraph_callers + glob）
  4. 设计修复：
     - approach: 一段话说明思路
     - files: 至少 1 个改动点，diff 风格 (path/line/before/after)
     - regression_test: 怎么写能稳定复现这个 bug 的测试
  5. risk 评估: low/medium/high + 理由
  6. estimate: S/M/L

  硬约束：
  - 只读！不许 Edit/Write
  - 代码摘录必须真实可识别（不能捏造）
  - 标注 confidence: high（路径已验证）/ medium（路径推断）/ low（理论）

  输出严格按 schema。
  `
  return agent(prompt, {
    label: `deep-dive rank #${bug.rank}: ${bug.title}`,
    phase: 'Deep-dive: Top 3 修复方案',
    schema: DEEP_DIVE_SCHEMA
  })
}))

const validDeepDives = deepDives.filter(Boolean)
log(`完成 ${validDeepDives.length}/${top3.length} 个 deep-dive`)

// ============== Phase 4: SYNTHESIS ==============
phase('Synthesis: 最终报告')

const synthPrompt = `
  你是 opencc bug hunt 的 reporter。

  Triage 排序（10 条）:
  ${JSON.stringify(triage.ranked, null, 2)}

  Top ${validDeepDives.length} deep-dive 修复方案:
  ${JSON.stringify(validDeepDives, null, 2)}

  合成最终报告：
  - bugs: 10 条排序表（按 rank 升序，每条带 score/file/line/summary/evidence）
  - top3: Top 3 详细方案（含 repro_steps / root_cause / proposed_fix）
  - notes: 范围限制 / 假设 / 漏检说明 / 优先级建议

  ⚠ 此报告不写文件，只为人类审阅。审核通过后才会触发 fix dispatch。
  输出严格按 schema。
`

const finalReport = await agent(synthPrompt, {
  label: 'synthesizer: final report',
  phase: 'Synthesis: 最终报告',
  schema: FINAL_SCHEMA
})

return finalReport
