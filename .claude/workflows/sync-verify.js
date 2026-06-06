// .claude/workflows/sync-verify.js
//
// User workflow that demonstrates every new global end-to-end:
// - `export const meta` declares the workflow's UI-visible metadata
//   (sent to main via __setMeta on first read).
// - `phase('title')` posts a phase marker so the dialog spinner can show
//   which stage is running.
// - `agent(prompt, { label, phase, schema, agentType })` runs a sub-task
//   and returns a structured { ok, summary, details? } result. The
//   `schema` is forwarded as a system-prompt contract; `agentType` lets
//   you pick a specific sub-agent from the OpenCC agent registry
//   (e.g. 'tui-func-verifier' for TUI verification).
// - `parallel([fn1, fn2, fn3])` is Promise.all over thunks.
// - The classic `if (!r.ok) return { aborted, result: r }` fail-fast
//   pattern lets the script bail out of any phase that breaks.
//
// Invocation: /sync-verify (no args required)

export const meta = {
  name: 'sync-verify',
  description: '同步 upstream → bun run build → 完整验证（typecheck ‖ test ‖ TUI）',
  phases: [
    { title: 'Sync upstream' },
    { title: 'Build' },
    { title: 'Verify (typecheck ‖ test ‖ TUI)' },
  ],
}

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    summary: { type: 'string' },
    details: { type: 'string' },
  },
  required: ['ok', 'summary'],
}

// ── Phase 1+2: 串行硬门（fail-fast） ──────────────────────────
phase('Sync upstream')
const sync = await agent(
  `同步当前分支与 upstream。
   1. git fetch upstream
   2. git rev-parse --abbrev-ref HEAD 拿到当前分支
   3. git merge upstream/<branch> --no-ff -m "chore: sync upstream"
   4. 冲突 → STOP + 报告，不自动解决
   返回 {ok, summary, details}`,
  {
    label: 'sync',
    phase: 'Sync upstream',
    schema: RESULT_SCHEMA,
    agentType: 'general-purpose',
  },
)
if (!sync.ok) return { aborted: 'sync', result: sync }

phase('Build')
const build = await agent(
  `运行 bun run build 并捕获完整输出。
   返回 {ok, summary, details}：ok=exit 0；details=耗时 + 警告 + dist 体积`,
  {
    label: 'build',
    phase: 'Build',
    schema: RESULT_SCHEMA,
    agentType: 'general-purpose',
  },
)
if (!build.ok) return { aborted: 'build', sync, result: build }

// ── Phase 3: 验证三件事并行（互不依赖） ──────────────────────
phase('Verify (typecheck ‖ test ‖ TUI)')
const [typecheck, tests, tui] = await parallel([
  () => agent(
    `运行 bun run typecheck，捕获所有错误。
     返回 {ok, summary, details}：details=错误文件:行号:列号 + 错误消息`,
    { label: 'typecheck', phase: 'Verify', schema: RESULT_SCHEMA, agentType: 'general-purpose' },
  ),
  () => agent(
    `运行 bun run test，捕获 pass/fail/skip 数量。
     返回 {ok, summary, details}：details=失败测试名 + 错误堆栈`,
    { label: 'test', phase: 'Verify', schema: RESULT_SCHEMA, agentType: 'general-purpose' },
  ),
  () => agent(
    `使用 tui-tester skill 验证 TUI：
       1. 启动 bun run dev:ollama:fast
       2. 等出现 prompt
       3. 输入 /help，截图，验证帮助菜单渲染
       4. 输入 /exit，验证干净退出
     返回 {ok, summary, details}：details=截图路径 + 观察到的异常`,
    {
      label: 'tui-verify',
      phase: 'Verify',
      schema: RESULT_SCHEMA,
      agentType: 'tui-func-verifier',
    },
  ),
])

const allOk = [typecheck, tests, tui].every((r) => r.ok)
return {
  ok: allOk,
  sync, build, typecheck, tests, tui,
  summary: [
    `sync:      ${sync.ok ? '✅' : '❌'} ${sync.summary}`,
    `build:     ${build.ok ? '✅' : '❌'} ${build.summary}`,
    `typecheck: ${typecheck.ok ? '✅' : '❌'} ${typecheck.summary}`,
    `test:      ${tests.ok ? '✅' : '❌'} ${tests.summary}`,
    `tui:       ${tui.ok ? '✅' : '❌'} ${tui.summary}`,
  ].join('\n'),
}
