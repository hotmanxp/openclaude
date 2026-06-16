// .claude/workflows/opencc-fullprocess-verify-exhaustive.js
//
// Exhaustive full-process validation of OpenCC. Builds on the canonical
// 5-phase protocol in docs/verification-checklist.md and the existing
// opencc-fullprocess-verify.js, filling the documented gap that the
// existing workflow skips Phase 5 (debug log scan with anomaly
// classification A-I).
//
// Architecture (6 phases, strict order):
//   1. Static Foundation     3 parallel: build ‖ test ‖ typecheck       [HARD GATE]
//   2. Extended Static       3 parallel: provider-tests ‖ provider-reco ‖ hardening
//   3. Runtime CLI Smoke     4 parallel: version ‖ help ‖ subcmd-reg ‖ debug -p
//                            + 5-way version consistency (separate verifier)
//   4. TUI End-to-End        1 tui-func-verifier: 4 tools + 4 slash + 3-way version
//   5. Debug Log Scan        1 verifier: anomaly A-I + stream health + memory cleanup
//   6. Synthesis             1 reporter: merge all, verdict + gaps + next_actions
//
// Hard gate after Phase 1: static broken ⇒ runtime checks meaningless.
// Soft fail through 2-5: gather all data so synthesis shows full picture.
//
// Invocation: /opencc-fullprocess-verify-exhaustive [profile]
//   profile: optional, default MiniMax-M3 (e.g. "claude-sonnet-4-6" for real API)

export const meta = {
  name: "opencc-fullprocess-verify-exhaustive",
  description: "Exhaustive 6-phase validation: static ‖ extended-static ‖ CLI ‖ TUI E2E ‖ debug-log scan ‖ synthesis. Includes anomaly classification A-I and memory side-effect cleanup.",
  phases: [
    { title: "Static Foundation" },
    { title: "Extended Static" },
    { title: "Runtime CLI Smoke" },
    { title: "TUI End-to-End" },
    { title: "Debug Log Scan" },
    { title: "Synthesis" },
  ],
}

const cwd = "/Users/ethan/code/opencc"
const profile = (args?.[0]) || "MiniMax-M3"

// ── Schemas ──────────────────────────────────────────────────
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

const VERSION_SCHEMA = {
  type: "object",
  required: ["passed", "version", "sources", "consistent"],
  properties: {
    passed: { type: "boolean" },
    version: { type: "string", description: "canonical version (e.g. 0.16.1)" },
    sources: {
      type: "object",
      description: "version reported by each surface",
      properties: {
        build_output: { type: "string" },
        cli_version_flag: { type: "string" },
        splash: { type: "string" },
        help_command: { type: "string" },
        status_command: { type: "string" },
        package_json: { type: "string" },
        npm_latest: { type: "string" },
      },
    },
    consistent: { type: "boolean" },
    mismatches: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
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

const LOG_SCHEMA = {
  type: "object",
  required: ["passed", "log_path", "error_count", "warn_count", "anomalies"],
  properties: {
    passed: { type: "boolean" },
    log_path: { type: "string" },
    error_count: { type: "integer" },
    warn_count: { type: "integer" },
    anomalies: {
      type: "array",
      items: {
        type: "object",
        required: ["class", "count", "verdict"],
        properties: {
          class: { type: "string", description: "A through I, or 'NEW'" },
          count: { type: "integer" },
          verdict: { enum: ["ignore", "noise", "env", "bug", "regression"] },
          note: { type: "string" },
        },
      },
    },
    stream_health: {
      type: "object",
      properties: {
        first_token_median_ms: { type: "integer" },
        first_token_p95_ms: { type: "integer" },
        stall_count: { type: "integer" },
      },
    },
    memory_artifacts: { type: "array", items: { type: "string" } },
    cleaned_files: { type: "array", items: { type: "string" } },
    new_classes: { type: "array", items: { type: "string" } },
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
        extended_static: { type: "string" },
        cli_smoke: { type: "string" },
        tui: { type: "string" },
        debug_log: { type: "string" },
      },
      required: ["static", "extended_static", "cli_smoke", "tui", "debug_log"],
    },
    version_consistency: { type: "string" },
    gaps: { type: "array", items: { type: "string" } },
    next_actions: { type: "array", items: { type: "string" } },
  },
}

// ── Helpers ──────────────────────────────────────────────────
// agent() returns { ok, report, ... }. Schema's `passed` is NOT reliably
// parsed — the LLM returns freeform text matching the schema. Use ok +
// string match as the truth signal.
function checkPassed(agentR) {
  if (!agentR?.ok) return false
  const report = agentR.report ?? ""
  return /\bpass(ed)?\b/i.test(report) || !/\bfail(ed)?\b/i.test(report)
}

function summarizePhase(name, results) {
  const lines = Object.entries(results).map(([k, v]) => {
    const ok = checkPassed(v)
    const firstLine = (v?.report ?? "").split("\n")[0]?.slice(0, 140) ?? "(no output)"
    return `  ${ok ? "✅" : "❌"} ${k}: ${firstLine}`
  })
  return `${name}\n${lines.join("\n")}`
}

// ── Phase 1: Static Foundation (HARD GATE) ──────────────────
phase("Static Foundation")
log(`Phase 1: parallel build ‖ test ‖ typecheck (cwd: ${cwd})`)

const [buildR, testR, typeR] = await parallel([
  () => agent(
    `cd ${cwd} && bun run build 2>&1 | tail -100.
     捕获:(1) exit code,(2) "Built opencc vX.Y.Z" 中的版本号,(3) pass/fail,(4) dist/cli.mjs 存在性 (ls -la dist/cli.mjs)。
     严禁修改任何源文件。
     返回 {passed, summary, details, errors[]}。`,
    { label: "bun-build", phase: "Static Foundation", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `cd ${cwd} && bun run test 2>&1 | tail -200.
     报告:(1) exit code,(2) pass/skip/fail 计数(格式如 "2141 pass / 19 skip / 0 fail"),(3) 失败时前 5 个失败用例名 + file:line。
     对照 AGENTS.md "Silenced Tests & Dead Code" 章节:codexOAuth.test.ts 已删, statusNoticeDefinitions.safety.test.tsx 有 silenced 标记,这些 NOT blocker。
     严禁修改任何源文件。
     返回 {passed, summary, details, errors[]}。`,
    { label: "bun-test", phase: "Static Foundation", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `cd ${cwd} && bun run typecheck 2>&1 | tail -100.
     报告:(1) exit code,(2) 错误数量,(3) 前 5 个错误详情(含 file:line:col + error code), (4) pass/fail。
     严禁修改任何源文件。
     返回 {passed, summary, details, errors[]}。`,
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

// ── Phase 2: Extended Static ────────────────────────────────
phase("Extended Static")
log("Phase 2: provider-tests ‖ provider-recommendation ‖ hardening")

const [providerR, recommendR, hardeningR] = await parallel([
  () => agent(
    `cd ${cwd} && bun run test:provider 2>&1 | tail -100.
     报告:(1) exit code,(2) pass/fail 计数,(3) 失败用例。
     Provider Policy: 仅 anthropic/ollama/openai-compatible 三个被支持。
     严禁修改任何源文件。
     返回 {passed, summary, details, errors[]}。`,
    { label: "test-provider", phase: "Extended Static", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `cd ${cwd} && bun run test:provider-recommendation 2>&1 | tail -100.
     报告:(1) exit code,(2) pass/fail 计数,(3) 失败用例。
     严禁修改任何源文件。
     返回 {passed, summary, details, errors[]}。`,
    { label: "test-provider-reco", phase: "Extended Static", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `cd ${cwd} && bun run hardening:check 2>&1 | tail -50.
     这是 smoke + doctor 检查。报告:(1) exit code,(2) 任何错误或警告,(3) pass/fail。
     严禁修改任何源文件。
     返回 {passed, summary, details, errors[]}。`,
    { label: "hardening-check", phase: "Extended Static", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
])

const phase2 = { provider: providerR, recommendation: recommendR, hardening: hardeningR }
log(summarizePhase("Phase 2 (Extended Static):", phase2))
// Soft fail — extended static issues don't block downstream, but go to synthesis.

// ── Phase 3: Runtime CLI Smoke ──────────────────────────────
phase("Runtime CLI Smoke")
log("Phase 3: CLI binary 验证 + 5 处版本一致性")

const [versionR, helpR, subcmdR, debugR] = await parallel([
  () => agent(
    `cd ${cwd} && node dist/cli.mjs --version 2>&1; echo "---EXIT:$?---"
     报告:(1) 实际退出码,(2) stdout 版本字符串,(3) 是否正常。
     返回 {passed, summary, details}。`,
    { label: "cli-version", phase: "Runtime CLI Smoke", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `cd ${cwd} && node dist/cli.mjs --help 2>&1; echo "---EXIT:$?---"
     报告:(1) stdout 实际内容,(2) 列出的 subcommand 完整列表,(3) 是否出现 "Usage:" 行。
     返回 {passed, summary, details}。`,
    { label: "cli-help", phase: "Runtime CLI Smoke", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `2026-06-14 T7 lesson:commander 注册 gap 专项检查。

     步骤:
     1. cd ${cwd} && grep -rnE "getCommands|Command\\(" src/commands.ts | head -50
     2. 列出源码期望注册的 subcommand 集合(grep 推断)
     3. cd ${cwd} && node dist/cli.mjs --help 2>&1 | grep -E "^\\s+[a-z][a-z-]+ "  提取实际显示的 sub
     4. 对比 step 2 vs step 3, 找出 missing subcommands
     5. 额外检查:src/commands/bg-agents/ 存在则必须注册 bg-agents

     报告:(1) grep 命令输出,(2) 期望 sub 列表,(3) 实际 sub 列表,(4) missing 列表(若有),(5) pass/fail。
     返回 {passed, summary, details, errors[]}(missing sub 列表)。`,
    { label: "cli-subcmd-registration", phase: "Runtime CLI Smoke", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `cd ${cwd} && node dist/cli.mjs --debug -p "say 'ok' and stop" 2>&1 | tail -50; echo "---EXIT:$?---"
     报告:(1) 是否启动 DEBUG 日志,(2) 是否能完成 -p 单次调用并退出,(3) 任何 fatal 错误。
     返回 {passed, summary, details}。`,
    { label: "cli-debug-oneliner", phase: "Runtime CLI Smoke", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
])

const phase3a = { version: versionR, help: helpR, subcmd: subcmdR, debug: debugR }
log(summarizePhase("Phase 3a (CLI smoke):", phase3a))

// 5-way version consistency check
const versionR2 = await agent(
  `收集 OpenCC 当前 5 处版本号,判断一致性(任何不一致都视为 stale MACRO bug)。

   步骤:
   1. cd ${cwd} && bun run build 2>&1 | grep -oE "v[0-9]+\\.[0-9]+\\.[0-9]+"  → build_output
   2. cd ${cwd} && node dist/cli.mjs --version 2>&1 → cli_version_flag
   3. cat ${cwd}/package.json | grep '"version"' → package_json (去掉引号和逗号)
   4. npm view opencc version 2>&1 → npm_latest(超时用 unknown)
   5. 用 tui-func-verifier 取 splash 的版本号(运行 agent-tui run bun run dev, screenshot, 抓 "OpenCC (vX.Y.Z)" 字符串) → splash
   6. 取 /help + /status 的版本号(同 tui session, type /help, /status, 抓 "OpenCC vX.Y.Z" + "版本 : X.Y.Z") → help_command, status_command

   注意:docs/verification-checklist.md 5.1 提到 3-way(splash/help/status),这里扩到 5-way(+ package.json + npm_latest)。任一不一致就是 stale 字符串。

   报告:每个源的实际版本号, 是否一致, 不一致对列表, pass/fail。
   返回 {passed, version, sources, consistent, mismatches[], summary}。`,
  { label: "5-way-version", phase: "Runtime CLI Smoke", schema: VERSION_SCHEMA, agentType: "general-purpose" },
)

const phase3 = { ...phase3a, version_consistency: versionR2 }
log(`Phase 3 (CLI smoke + version): ${checkPassed(versionR2) ? "✅" : "❌"} 5-way version ${checkPassed(versionR2) ? "consistent" : "DIVERGED"}`)

// ── Phase 4: TUI End-to-End ─────────────────────────────────
phase("TUI End-to-End")
log("Phase 4: tui-func-verifier 跑完整 4-tool + 4-slash + 3-way version")

const profileNote = `当前 profile: ${profile}。如需切换:opencc profile set ${profile} 或 /model。`

const tuiR = await agent(
  `你是 OpenCC TUI 验证 agent。${profileNote}

   任务:完整 TUI 端到端验证(对照 docs/verification-checklist.md Phase 4)。

   步骤:
   1. 加载 agent-tui skill (Bash: agent-tui --version, 若未装: curl -fsSL https://raw.githubusercontent.com/pproenca/agent-tui/master/install.sh | sh)
   2. macOS daemon 隔离 + 启动:
      tmux kill-session -t agent-tui 2>/dev/null; rm -f /tmp/agent-tui*; tmux new-session -d -s agent-tui 'agent-tui daemon start --foreground > /tmp/agent-tui-daemon.log 2>&1'; sleep 1
   3. cd ${cwd} && agent-tui run bun run dev(等 "❯" prompt)

   4.1 Render check: agent-tui wait --stable + screenshot, 验证 splash + model + branch + bypass permissions on + Debug mode
   4.2 LLM response: type "Say ok and stop" + Enter + wait --stable, 验证 ⏺ ok

   4.3 4-tool 覆盖(每个工具 atomic loop):
      - Bash: type "Run: bash -c 'echo HELLO_FROM_TUI_VERIFY'"
      - Read: type "Use Read to read package.json and tell me version"
      - Edit: type "Use Edit to replace 'Edit tool will replace this line' with 'Edit tool verified working' in /tmp/opencc-edit-test.md, then Read to confirm"
      - Write: type "Use Write to create /tmp/opencc-write-test.md with content 'Write tool verified working' then ls it"

   4.4 4-slash 覆盖 + 3-way version:
      - /help: 抓版本号(对照 build 阶段 capture)
      - /status: 抓版本号 + ctx token
      - /mcp: 验证 N MCP failed 计数,与预期 baseline(预存在 Class F/G: chrome-devtools Node 引擎)
      - /model: 验证 profile 列表
      - 验证 splash + help + status 三处版本号完全一致(任何不一致 = stale MACRO bug, FAIL)

   4.5 Final tool call: type "Run: bash -c 'echo FINAL_TOOL_CALL_$(date +%s)'"(为 Phase 5 留 log 痕迹)

   清理: agent-tui kill + daemon stop + rm -f /tmp/opencc-edit-test.md /tmp/opencc-write-test.md

   严禁修改源文件。严格遵守 agent-tui skill 原子执行规则(每步后 wait + screenshot + 验证)。

   返回 {passed, tests[{name, passed, details}], issues[], summary}。
   tests 数组应至少 13 项:render, llm_response, tool_bash, tool_read, tool_edit, tool_write, slash_help, slash_status, slash_mcp, slash_model, version_3way, final_tool_call, cleanup。`,
  { label: "tui-e2e", phase: "TUI End-to-End", schema: TUI_SCHEMA, agentType: "tui-func-verifier" },
)

log(checkPassed(tuiR) ? "Phase 4: TUI E2E 通过" : "Phase 4: TUI E2E 失败")

// ── Phase 5: Debug Log Scan (NOT OPTIONAL) ──────────────────
phase("Debug Log Scan")
log("Phase 5: anomaly classification A-I + stream health + memory cleanup")

const logR = await agent(
  `你是 OpenCC debug log 扫描 agent。对照 docs/verification-checklist.md Phase 5 的 anomaly catalog A-I 做分类。

   步骤:
   1. 定位最新 log: LATEST=$(ls -t ~/.claude/debug/*.txt | head -1); echo "Log: $LATEST ($(wc -l < $LATEST) lines)"
   2. 基础计数: error_count=$(grep -cE '\\[ERROR\\]' $LATEST); warn_count=$(grep -cE '\\[WARN\\]' $LATEST)
      Baseline: ~22-25 for standard 3-MCP / MiniMax-M3 / no-gh setup on macOS。超过 = 新 regression。
   3. Anomaly classification(对每个 [ERROR]/[WARN] 取上下 5 行 context):
      A circuit-breaker                noise (banner only)        ignore
      B generateSessionTitle.*SyntaxError  noise (UI title skip)   ignore
      C supportedModels=undefined      noise (gate disabled)      ignore
      D spawn gh ENOENT                env (5-20 normal; fork 已 disable 3 files since 2026-06-06)  ignore
      E MCP server .* Server stderr:   noise (false positive)     ignore
      F does not support Node          env (Node v22.11.0 < 22.12.0)  upgrade or disable plugin
      G no 'Starting connection' for chrome-devtools (context7 有)  bug (loader skips plugin)
      H Streaming stall detected + first_token_ms ≈ duration_ms   noise (MiniMax latency)  ignore
      I [WARN] [stderr] at session cleanup (after LSP shut down)  noise (LSP child flush)  ignore

      任何不在 A-I 的 = NEW class, 标记为 regression, 加入 new_classes[]。

   4. Stream health:
      first_token_ms 列表: grep -E 'first_token_ms' $LATEST | head -20
      计算 median + p95(粗估即可, 不需精确), 报告 stall_count(class H 触发次数)

   5. Memory side-effect:
      grep -E 'extractMemories.*writtenPaths=1' $LATEST
      ls -t ~/.claude/projects/-Users-ethan-code-opencc/memory/private/tool-baseline-test-*.md 2>/dev/null
      列出所有检测到的 memory artifact, 然后执行清理:
      rm -f ~/.claude/projects/-Users-ethan-code-opencc/memory/private/tool-baseline-test-*.md
      把被删的文件路径记入 cleaned_files[]

   6. Verdict:
      - passed = error_count 在 baseline 范围 OR 所有 [ERROR] 都归入 A-I noise class
        AND no new_classes
        AND stream health 不异常(stall_count < 3)
      - 任何 new_class 或 error_count 显著超 baseline → failed

   返回 {passed, log_path, error_count, warn_count, anomalies[{class, count, verdict, note}], stream_health{first_token_median_ms, first_token_p95_ms, stall_count}, memory_artifacts[], cleaned_files[], new_classes[], summary}。`,
  { label: "debug-log-scan", phase: "Debug Log Scan", schema: LOG_SCHEMA, agentType: "general-purpose" },
)

log(checkPassed(logR) ? "Phase 5: log scan 通过(全在 A-I noise catalog)" : "Phase 5: log scan 异常(可能 new class)")

// ── Phase 6: Synthesis ──────────────────────────────────────
phase("Synthesis")
log("Phase 6: 汇总 6 phase + 5-way version + log anomalies, 输出 verdict")

const synthR = await agent(
  `你是 OpenCC 验证 reporter。严格基于下方实际数据生成最终报告。

   ==== Phase 1: Static Foundation ====
   - build:    ${checkPassed(buildR) ? "PASS" : "FAIL"} — ${(buildR?.report ?? "").slice(0, 300)}
   - test:     ${checkPassed(testR) ? "PASS" : "FAIL"} — ${(testR?.report ?? "").slice(0, 300)}
   - typecheck:${checkPassed(typeR) ? "PASS" : "FAIL"} — ${(typeR?.report ?? "").slice(0, 300)}

   ==== Phase 2: Extended Static ====
   - provider tests:        ${checkPassed(providerR) ? "PASS" : "FAIL"} — ${(providerR?.report ?? "").slice(0, 200)}
   - provider-recommendation:${checkPassed(recommendR) ? "PASS" : "FAIL"} — ${(recommendR?.report ?? "").slice(0, 200)}
   - hardening check:       ${checkPassed(hardeningR) ? "PASS" : "FAIL"} — ${(hardeningR?.report ?? "").slice(0, 200)}

   ==== Phase 3: Runtime CLI Smoke ====
   - version flag:      ${checkPassed(versionR) ? "PASS" : "FAIL"} — ${(versionR?.report ?? "").slice(0, 200)}
   - help:              ${checkPassed(helpR) ? "PASS" : "FAIL"} — ${(helpR?.report ?? "").slice(0, 200)}
   - subcmd registration:${checkPassed(subcmdR) ? "PASS" : "FAIL"} — ${(subcmdR?.report ?? "").slice(0, 300)}
   - debug -p oneliner: ${checkPassed(debugR) ? "PASS" : "FAIL"} — ${(debugR?.report ?? "").slice(0, 200)}
   - 5-way version consistency: ${checkPassed(versionR2) ? "PASS" : "FAIL"} — ${(versionR2?.report ?? "").slice(0, 400)}

   ==== Phase 4: TUI End-to-End ====
   - render + LLM + 4-tool + 4-slash + 3-way version: ${checkPassed(tuiR) ? "PASS" : "FAIL"} — ${(tuiR?.report ?? "").slice(0, 400)}

   ==== Phase 5: Debug Log Scan ====
   - anomaly classification A-I: ${checkPassed(logR) ? "PASS" : "FAIL"} — ${(logR?.report ?? "").slice(0, 500)}

   任务:
   1. 计算每个 phase 的 pass/fail 计数
   2. 列出所有 gaps(任何 FAIL 的根因 + 修复建议)
   3. verdict: PASS = 所有 phase 全绿, FAIL = 任何 phase FAIL
   4. next_actions: 优先级排序, 先 fix critical(Phase 1 失败 > TUI 失败 > log new class > cosmetic)

   返回 {verdict, summary, breakdown{static, extended_static, cli_smoke, tui, debug_log}, version_consistency, gaps[], next_actions[]}。`,
  { label: "synthesis", phase: "Synthesis", schema: FINAL_SCHEMA, agentType: "general-purpose" },
)

return {
  verdict: checkPassed(synthR) && /"verdict":\s*"PASS"/i.test(synthR?.report ?? "") ? "PASS" : "FAIL",
  status: checkPassed(synthR) ? "complete" : "completed-with-issues",
  phase1: { build: buildR, test: testR, typecheck: typeR },
  phase2: { provider: providerR, recommendation: recommendR, hardening: hardeningR },
  phase3: { version: versionR, help: helpR, subcmd: subcmdR, debug: debugR, version_consistency: versionR2 },
  phase4: tuiR,
  phase5: logR,
  phase6: synthR,
}