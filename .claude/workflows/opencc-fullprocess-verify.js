// .claude/workflows/opencc-fullprocess-verify.js
//
// Read-only full-process validation of OpenCC. Designed to catch the
// gaps that static checks miss (per 2026-06-13/14 lessons):
//   - typecheck/build/test ≠ runtime verified (must run the binary)
//   - file exists ≠ commander registered (must enumerate subs)
//   - code present ≠ feature works (must exercise /workflows, /goal, etc.)
//
// Architecture (5 phases, all declared in meta.phases for the Phases pane):
//   1. Static Foundation    3 parallel: typecheck ‖ build ‖ test
//   2. Runtime CLI Smoke    4 parallel: binary launch ‖ help ‖ subcmd registration ‖ debug -p
//   3. TUI & Slash Cmds     4 parallel tui-func-verifier: /workflows ‖ /goal ‖ /effort ultracode ‖ ultracode keyword
//   4. Workflow Self-test   1 tui-func-verifier: invoke /completion-smoke end-to-end
//   5. Synthesis            1 reporter: merge all results, identify gaps, return verdict
//
// Hard gate after Phase 1: static broken ⇒ runtime checks meaningless.
// Soft fail through 2-4: gather all data so synthesis shows full picture.
//
// Invocation: /opencc-fullprocess-verify [profile]
//   profile: optional, default MiniMax-M3 (e.g. "claude-sonnet-4-6" for real API)

export const meta = {
  name: "opencc-fullprocess-verify",
  description: "Read-only full-process validation: static ‖ CLI binary ‖ TUI slash cmds ‖ workflow self-test. Catches typecheck-blind gaps.",
  phases: [
    { title: "Static Foundation" },
    { title: "Runtime CLI Smoke" },
    { title: "TUI & Slash Commands" },
    { title: "Workflow Self-test" },
    { title: "Synthesis" },
  ],
}

const cwd = "/Users/ethan/code/opencc"
const profile = (args?.[0]) || "MiniMax-M3"

const CHECK_SCHEMA = {
  type: "object",
  required: ["passed", "summary"],
  properties: {
    passed: { type: "boolean" },
    summary: { type: "string" },
    details: { type: "string" },
    errors: { type: "array", items: { type: "string" } },
  },
}

const TUI_SCHEMA = {
  type: "object",
  required: ["passed", "tests", "issues"],
  properties: {
    passed: { type: "boolean" },
    tests: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "passed"],
        properties: {
          name: { type: "string" },
          passed: { type: "boolean" },
          details: { type: "string" },
        },
      },
    },
    issues: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
}

const FINAL_SCHEMA = {
  type: "object",
  required: ["verdict", "summary", "breakdown", "gaps", "next_actions"],
  properties: {
    verdict: { enum: ["PASS", "FAIL"] },
    summary: { type: "string" },
    breakdown: {
      type: "object",
      properties: {
        static: { type: "string" },
        cli_smoke: { type: "string" },
        tui: { type: "string" },
        workflow: { type: "string" },
      },
      required: ["static", "cli_smoke", "tui", "workflow"],
    },
    gaps: { type: "array", items: { type: "string" } },
    next_actions: { type: "array", items: { type: "string" } },
  },
}

// agent() returns { ok, report, ... }. The schema's `passed` field is NOT
// reliably parsed — the LLM returns freeform text matching the schema.
// Use ok + string match as the truth signal (same as opencc-verfiy-fix.js).
function checkPassed(agentR) {
  if (!agentR?.ok) return false
  const report = agentR.report ?? ""
  return /\bpass(ed)?\b/i.test(report) || !/\bfail(ed)?\b/i.test(report)
}

function summarizePhase(name, results) {
  const lines = Object.entries(results).map(([k, v]) => {
    const ok = checkPassed(v)
    const firstLine = (v?.report ?? "").split("\n")[0]?.slice(0, 120) ?? "(no output)"
    return `  ${ok ? "✅" : "❌"} ${k}: ${firstLine}`
  })
  return `${name}\n${lines.join("\n")}`
}

// ── Phase 1: Static Foundation (hard gate) ────────────────────
phase("Static Foundation")
log(`Phase 1: parallel typecheck ‖ build ‖ test (cwd: ${cwd})`)

const [buildR, testR, typeR] = await parallel([
  () => agent(
    `cd ${cwd} && bun run build 2>&1 | tail -100.
     报告:(1) exit code,(2) pass/fail,(3) dist/cli.mjs 是否生成(检查 ls -la dist/cli.mjs),(4) 任何错误。
     返回 {passed, summary, details, errors[]}。严禁修改任何源文件。`,
    { label: "bun-build", phase: "Static Foundation", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `cd ${cwd} && bun run test 2>&1 | tail -200.
     报告:(1) exit code,(2) pass/skip/fail 计数(格式如 "2141 pass / 19 skip / 0 fail"),(3) 失败时前 5 个失败用例名,(4) 任何错误。
     返回 {passed, summary, details, errors[]}。严禁修改任何源文件。`,
    { label: "bun-test", phase: "Static Foundation", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `cd ${cwd} && bun run typecheck 2>&1 | tail -100.
     报告:(1) exit code,(2) 错误数量,(3) 前 5 个错误详情(含 file:line:col),(4) pass/fail。
     返回 {passed, summary, details, errors[]}。严禁修改任何源文件。`,
    { label: "bun-typecheck", phase: "Static Foundation", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
])

const phase1Pass = checkPassed(buildR) && checkPassed(testR) && checkPassed(typeR)
if (!phase1Pass) {
  const failed = []
  if (!checkPassed(buildR)) failed.push("build")
  if (!checkPassed(testR)) failed.push("test")
  if (!checkPassed(typeR)) failed.push("typecheck")
  log(`Phase 1 FAILED: ${failed.join(", ")} — 运行时验证无意义,终止`)
  return {
    verdict: "FAIL",
    status: "failed-phase-1",
    failed,
    phase1: { build: buildR, test: testR, typecheck: typeR },
    summary: `Static foundation broken: ${failed.join(", ")}. Fix before re-running.`,
  }
}
log("Phase 1 全绿:build + test + typecheck 全部通过")

// ── Phase 2: Runtime CLI Smoke (4 parallel) ───────────────────
phase("Runtime CLI Smoke")
log("Phase 2: CLI binary 验证(launch, help, subcommand registration, debug -p)")

const [versionR, helpR, subcmdR, debugR] = await parallel([
  () => agent(
    `cd ${cwd} && node dist/cli.mjs --version 2>&1; echo "---EXIT:$?---"
     报告:(1) 实际退出码,(2) stdout 内容,(3) 是否正常输出 version 字符串。
     关键检查:这是 2026-06-13 lesson — 没有这一步不算验证。
     返回 {passed, summary, details}。`,
    { label: "cli-version", phase: "Runtime CLI Smoke", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `cd ${cwd} && node dist/cli.mjs --help 2>&1; echo "---EXIT:$?---"
     报告:(1) stdout 实际内容,(2) 列出的 subcommand 列表,(3) 是否出现 "Usage:" 行。
     返回 {passed, summary, details}。`,
    { label: "cli-help", phase: "Runtime CLI Smoke", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `这是 2026-06-14 T7 lesson 的具体检查 — commander 注册 gap。

     步骤:
     1. cd ${cwd} && grep -rnE "getCommands|Command\\(" src/commands.ts | head -50
     2. 列出 OpenCC 期望注册的 subcommand(从源码 grep 推断):
        - 至少应包括:provider/claude, mcp, workflows, doctor, init, plans, agents, pr, where, version
        - 检查是否有 2026-06-14 plan7 加的 bg-agents(若 src/commands/bg-agents/ 存在则必须注册)
     3. cd ${cwd} && node dist/cli.mjs --help 2>&1 | grep -E "^\\s+[a-z][a-z-]+ "  提取实际显示的 sub
     4. 对比 step 2 和 step 3,找出 missing subcommands

     报告:(1) grep 命令输出,(2) 实际显示的 sub 列表,(3) missing sub 列表(若有),(4) pass/fail。
     返回 {passed, summary, details, errors[](missing sub 列表)}。`,
    { label: "cli-subcmd-registration", phase: "Runtime CLI Smoke", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `cd ${cwd} && node dist/cli.mjs --debug -p "say 'ok' and stop" 2>&1 | tail -50; echo "---EXIT:$?---"
     报告:(1) 是否启动 DEBUG 日志,(2) 是否能完成 -p 单次调用并退出,(3) 任何 fatal 错误。
     返回 {passed, summary, details}。`,
    { label: "cli-debug-oneliner", phase: "Runtime CLI Smoke", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
])

const phase2 = { version: versionR, help: helpR, subcmd: subcmdR, debug: debugR }
log(summarizePhase("Phase 2 (Runtime CLI Smoke):", phase2))

// ── Phase 3: TUI & Slash Commands (4 parallel tui-func-verifier) ───
phase("TUI & Slash Commands")
log("Phase 3: TUI 烟雾测试 /workflows /goal /effort ultracode / ultracode 关键词")

const profileNote = `当前 profile: ${profile}。如需切换,先用 /model 或 opencc profile set ${profile}。`

const [workflowsR, goalR, effortR, ultracodeR] = await parallel([
  () => agent(
    `你是 OpenCC TUI 验证 agent。${profileNote}

     任务:验证 /workflows 面板可正常打开并列出 workflow。

     步骤:
     1. 加载 agent-tui skill(Bash: agent-tui --version, 若未装则 curl -fsSL https://raw.githubusercontent.com/pproenca/agent-tui/master/install.sh | sh)
     2. macOS daemon 隔离:tmux kill-session -t agent-tui 2>/dev/null; rm -f /tmp/agent-tui*; tmux new-session -d -s agent-tui 'agent-tui daemon start --foreground > /tmp/agent-tui-daemon.log 2>&1'; sleep 1
     3. cd ${cwd} && agent-tui run bun run dev(等 "❯" prompt)
     4. type "/workflows", press Enter, wait --stable, screenshot
     5. 验证:面板应列出至少 1 个 workflow(opencc-bug-hunt, opencc-verify-and-fix, sync-verify, completion-smoke 等)
     6. Esc 退出面板, Ctrl+C 终止 REPL, agent-tui kill 清理

     严格遵守 agent-tui skill 的原子执行规则(每步后 wait + screenshot + 验证)。
     严禁修改源文件。

     返回 {passed, tests[], issues[], summary}。`,
    { label: "tui-workflows", phase: "TUI & Slash Commands", schema: TUI_SCHEMA, agentType: "tui-func-verifier" },
  ),
  () => agent(
    `你是 OpenCC TUI 验证 agent。${profileNote}

     任务:验证 /goal slash command 完整流程(/goal register → 状态可见 → /goal unregister)。

     步骤:
     1. 加载 agent-tui skill, 启动 daemon(同 Phase 3 通用前置)
     2. cd ${cwd} && agent-tui run bun run dev
     3. /goal register "test goal from fullprocess-verify",Enter,wait --stable,screenshot
     4. 验证:输出应包含 "registered" 或 "active" 字样
     5. /goal unregister 清理
     6. Ctrl+C + agent-tui kill

     返回 {passed, tests[], issues[], summary}。`,
    { label: "tui-goal", phase: "TUI & Slash Commands", schema: TUI_SCHEMA, agentType: "tui-func-verifier" },
  ),
  () => agent(
    `你是 OpenCC TUI 验证 agent。${profileNote}

     任务:验证 /effort ultracode (plan11 2026-06-15 刚 port 的关键命令)。

     步骤:
     1. agent-tui skill + daemon 前置
     2. cd ${cwd} && agent-tui run bun run dev
     3. /effort ultracode,Enter,wait --stable,screenshot
     4. 验证:输出应包含 "ultracode (xhigh + dynamic workflow orchestration; this session only)" 或 "Current effort level: ultracode" 之一
     5. /effort high 还原默认(避免污染 session)
     6. Ctrl+C + agent-tui kill

     返回 {passed, tests[], issues[], summary}。`,
    { label: "tui-effort-ultracode", phase: "TUI & Slash Commands", schema: TUI_SCHEMA, agentType: "tui-func-verifier" },
  ),
  () => agent(
    `你是 OpenCC TUI 验证 agent。${profileNote}

     任务:验证 ultracode 关键词触发路径(2026-06-15 plan11 ship 的核心新功能)。

     步骤:
     1. agent-tui skill + daemon 前置
     2. cd ${cwd} && agent-tui run bun run dev
     3. 输入 "ultracode say hello",Enter,wait 60s 让 workflow 跑,screenshot
     4. 验证:出现 "Run /workflows to see progress." 或类似 workflow 已派发迹象
     5. /workflows,Enter,wait --stable,验证有 1 个 active run
     6. Esc,Ctrl+C,agent-tui kill
     7. 清理:若仍有 active run 残留,/workflows 进入 panel 手动 x 强制 stop

     返回 {passed, tests[], issues[], summary}。
     注意:这是 2026-06-15 plan11 刚 ship 的功能,验证 ultracode 关键词 + tengu_workflow_keyword 事件正确触发。`,
    { label: "tui-ultracode-keyword", phase: "TUI & Slash Commands", schema: TUI_SCHEMA, agentType: "tui-func-verifier" },
  ),
])

const phase3 = { workflows: workflowsR, goal: goalR, effort: effortR, ultracode: ultracodeR }
log(summarizePhase("Phase 3 (TUI & Slash):", phase3))

// ── Phase 4: Workflow Self-test (1 tui-func-verifier) ─────────
phase("Workflow Self-test")
log("Phase 4: 验证 dynamic-workflow feature 端到端(pipeline → subagent → final report)")

const selfR = await agent(
  `你是 OpenCC TUI 验证 agent。${profileNote}

   任务:端到端验证 dynamic-workflow feature(一个 user-written workflow 能 spawn subagent 并返回 final report)。

   步骤:
   1. agent-tui skill + daemon 前置
   2. cd ${cwd} && agent-tui run bun run dev
   3. 输入 "/completion-smoke",Enter,wait 直到 "completion-smoke done" 出现在 chat(最多 30s)
   4. 验证:该 sub-5s workflow 应在 5s 内完成,并在 chat 中出现 "completion-smoke done" final report
   5. screenshot 证据
   6. Ctrl+C + agent-tui kill

   通过标准:final report "completion-smoke done" 出现在 chat 中(证明 subagent spawn → report 回传 → completion message wire-up 整条链路通)。
   这是最关键的一步:workflow feature 的核心闭环验证。

   返回 {passed, tests[], issues[], summary}。`,
  { label: "workflow-self-test", phase: "Workflow Self-test", schema: TUI_SCHEMA, agentType: "tui-func-verifier" },
)

log(checkPassed(selfR) ? "Phase 4: workflow self-test 通过" : "Phase 4: workflow self-test 失败")

// ── Phase 5: Synthesis ────────────────────────────────────────
phase("Synthesis")
log("Phase 5: 汇总所有结果,生成最终报告")

const synthR = await agent(
  `你是 reporter agent。下面是 OpenCC 全流程验证的 4 个 phase 结果。请严格基于实际数据生成最终报告。

   ==== Phase 1: Static Foundation ====
   - build: ${checkPassed(buildR) ? "PASS" : "FAIL"} — ${(buildR?.report ?? "").slice(0, 300)}
   - test: ${checkPassed(testR) ? "PASS" : "FAIL"} — ${(testR?.report ?? "").slice(0, 300)}
   - typecheck: ${checkPassed(typeR) ? "PASS" : "FAIL"} — ${(typeR?.report ?? "").slice(0, 300)}

   ==== Phase 2: Runtime CLI Smoke ====
   - version: ${checkPassed(versionR) ? "PASS" : "FAIL"} — ${(versionR?.report ?? "").slice(0, 200)}
   - help: ${checkPassed(helpR) ? "PASS" : "FAIL"} — ${(helpR?.report ?? "").slice(0, 200)}
   - subcmd registration: ${checkPassed(subcmdR) ? "PASS" : "FAIL"} — ${(subcmdR?.report ?? "").slice(0, 300)}
   - debug -p: ${checkPassed(debugR) ? "PASS" : "FAIL"} — ${(debugR?.report ?? "").slice(0, 200)}

   ==== Phase 3: TUI & Slash Commands ====
   - /workflows: ${checkPassed(workflowsR) ? "PASS" : "FAIL"} — ${(workflowsR?.report ?? "").slice(0, 200)}
   - /goal: ${checkPassed(goalR) ? "PASS" : "FAIL"} — ${(goalR?.report ?? "").slice(0, 200)}
   - /effort ultracode: ${checkPassed(effortR) ? "PASS" : "FAIL"} — ${(effortR?.report ?? "").slice(0, 200)}
   - ultracode keyword: ${checkPassed(ultracodeR) ? "PASS" : "FAIL"} — ${(ultracodeR?.report ?? "").slice(0, 200)}

   ==== Phase 4: Workflow Self-test ====
   - /completion-smoke: ${checkPassed(selfR) ? "PASS" : "FAIL"} — ${(selfR?.report ?? "").slice(0, 200)}

   任务:
   1. 计算每个 phase 的 pass/fail 计数
   2. 列出所有 gaps(任何 FAIL 项的根因 + 修复建议)
   3. 给出 verdict:PASS = 所有 phase 全绿,FAIL = 任何 phase 有 FAIL
   4. 列出 next_actions(优先级排序,先 fix critical 路径)

   返回 {verdict, summary, breakdown, gaps, next_actions}。`,
  { label: "synthesis", phase: "Synthesis", schema: FINAL_SCHEMA, agentType: "general-purpose" },
)

return {
  verdict: checkPassed(synthR) && /"verdict":\s*"PASS"/i.test(synthR?.report ?? "")
    ? "PASS"
    : "FAIL",
  status: checkPassed(synthR) ? "complete" : "completed-with-issues",
  phase1: { build: buildR, test: testR, typecheck: typeR },
  phase2: { version: versionR, help: helpR, subcmd: subcmdR, debug: debugR },
  phase3: { workflows: workflowsR, goal: goalR, effort: effortR, ultracode: ultracodeR },
  phase4: selfR,
  phase5: synthR,
}
