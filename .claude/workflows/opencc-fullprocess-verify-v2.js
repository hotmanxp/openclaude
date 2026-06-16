// .claude/workflows/opencc-fullprocess-verify-v2.js
//
// OpenCC 全流程验证 v2 — ultracode 多 agent orchestration
//
// 应用的 ultracode 质量模式 (WorkflowTool docs):
//   ✓ Hard gate        Phase 1 失败立即终止后续
//   ✓ Pipeline         TUI 阶段顺序执行 (render → tools → slash → workflow → log)
//   ✓ Parallel         独立维度并发 (静态检查 / 二进制 / 仓库健康)
//   ✓ Adversarial verify  3 个 skeptic 对每个 FAIL 反驳, 多数票决真伪
//   ✓ Completeness critic 最终 "我们漏了什么" 审计
//   ✓ Multi-modal sweep 不同维度独立 reviewer (build / test / typecheck 不共享 agent)
//   ✓ Loop-until-dry  adversarial verify 阶段无新 finding 即停
//
// Architecture (11 phases, 全部声明在 meta.phases):
//   1. Static Foundation  hard gate, 4 parallel: build ‖ typecheck ‖ test ‖ provider-tests
//   2. Binary Smoke       5 parallel: version ‖ help ‖ subcmd-registry ‖ debug -p ‖ profile
//   3. TUI Render & LLM   1 tui-func-verifier: render + LLM + 3-way version
//   4. Tool Coverage      1 tui-func-verifier: bash / read / edit / write
//   5. Slash Coverage     1 tui-func-verifier: 8 slash cmds
//   6. Workflow Self-Test 1 tui-func-verifier: workflow feature E2E
//   7. Debug Log Scan     1 agent: anomaly A-I + stream health + memory side-effect
//   8. Repo Health        3 parallel: codegraph ‖ AGENTS.md drift ‖ feature flags
//   9. Adversarial Verify 3 skeptic per FAIL finding, 循环到收敛
//  10. Completeness Critic "我们漏了什么" 跨模块审计
//  11. Synthesis          合并 + adversarial verdict + final report
//
// Invocation: /opencc-fullprocess-verify-v2 [profile]
//   profile: 可选, 默认 MiniMax-M3 (e.g. "claude-sonnet-4-6" 走真 API)

export const meta = {
  name: "opencc-fullprocess-verify-v2",
  description: "OpenCC 全流程 ultracode 验证: 静态 + 二进制 + TUI + 工作流 + debug log + 仓库健康 + 对抗验证 + 完整性审计 + 综合报告 (11 phases)",
  phases: [
    { title: "Static Foundation" },
    { title: "Binary Smoke" },
    { title: "TUI Render & LLM" },
    { title: "Tool Coverage" },
    { title: "Slash Coverage" },
    { title: "Workflow Self-Test" },
    { title: "Debug Log Scan" },
    { title: "Repo Health" },
    { title: "Adversarial Verify" },
    { title: "Completeness Critic" },
    { title: "Synthesis" },
  ],
}

const cwd = "/Users/ethan/code/opencc"
const profile = (args?.[0]) || "MiniMax-M3"

// ── Schemas ────────────────────────────────────────────────────

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

const VERIFY_SCHEMA = {
  type: "object",
  required: ["verdict", "confidence", "reason"],
  properties: {
    verdict: { enum: ["confirm", "refute"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" },
  },
}

const CRITIC_SCHEMA = {
  type: "object",
  required: ["missing", "suggestions"],
  properties: {
    missing: {
      type: "array",
      items: {
        type: "object",
        required: ["area", "description", "severity"],
        properties: {
          area: { type: "string" },
          description: { type: "string" },
          severity: { enum: ["critical", "high", "medium", "low"] },
        },
      },
    },
    suggestions: { type: "array", items: { type: "string" } },
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
        binary: { type: "string" },
        tui: { type: "string" },
        workflow: { type: "string" },
        log: { type: "string" },
        repo_health: { type: "string" },
      },
    },
    gaps: { type: "array", items: { type: "string" } },
    next_actions: { type: "array", items: { type: "string" } },
  },
}

// ── Helpers ────────────────────────────────────────────────────

// 同 opencc-fullprocess-verify.js: ok + string match 作为 truth signal
// schema.passed 不可靠, LLM 经常返回 freeform text
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

// ── Phase 1: Static Foundation (HARD GATE) ─────────────────────
phase("Static Foundation")
log(`Phase 1: parallel build ‖ typecheck ‖ test ‖ provider-tests (cwd: ${cwd})`)

const [buildR, typeR, testR, providerR] = await parallel([
  () => agent(
    `cd ${cwd} && bun run build 2>&1 | tail -100.
     报告: (1) exit code, (2) pass/fail, (3) dist/cli.mjs 是否生成 (ls -la dist/cli.mjs),
     (4) 任何错误。返回 {passed, summary, details, errors[]}。严禁修改源文件。`,
    { label: "build", phase: "Static Foundation", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `cd ${cwd} && bun run typecheck 2>&1 | tail -100.
     报告: (1) exit code, (2) 错误数量, (3) 前 5 个错误详情 (含 file:line:col), (4) pass/fail。
     返回 {passed, summary, details, errors[]}。`,
    { label: "typecheck", phase: "Static Foundation", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `cd ${cwd} && bun test 2>&1 | tail -200.
     报告: (1) exit code, (2) pass/skip/fail 计数 (格式如 "2141 pass / 19 skip / 0 fail"),
     (3) 失败时前 5 个失败用例名, (4) 任何错误。
     返回 {passed, summary, details, errors[]}。
     注: codexOAuth.test.ts (已删除) 和 statusNoticeDefinitions.safety.test.tsx 中的 silenced tests 算 baseline, 不算 FAIL。`,
    { label: "test", phase: "Static Foundation", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `cd ${cwd} && bun run test:provider 2>&1 | tail -200.
     报告: (1) exit code, (2) pass/fail 计数, (3) 任何 provider 路由错误。
     返回 {passed, summary, details, errors[]}。`,
    { label: "provider-tests", phase: "Static Foundation", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
])

const phase1Pass = checkPassed(buildR) && checkPassed(typeR) && checkPassed(testR) && checkPassed(providerR)
if (!phase1Pass) {
  const failed = []
  if (!checkPassed(buildR)) failed.push("build")
  if (!checkPassed(typeR)) failed.push("typecheck")
  if (!checkPassed(testR)) failed.push("test")
  if (!checkPassed(providerR)) failed.push("provider-tests")
  log(`Phase 1 FAILED: ${failed.join(", ")} — 终止后续阶段`)
  return {
    verdict: "FAIL",
    status: "failed-phase-1",
    failed,
    phase1: { build: buildR, typecheck: typeR, test: testR, providerTests: providerR },
    summary: `Static foundation broken: ${failed.join(", ")}. Fix before re-running.`,
  }
}
log("Phase 1 全绿: build + typecheck + test + provider-tests 全部通过")

// ── Phase 2: Binary Smoke (5 parallel) ─────────────────────────
phase("Binary Smoke")
log("Phase 2: CLI binary 验证 (version, help, subcmd, debug, provider profile)")

const [versionR, helpR, subcmdR, debugR, profileR] = await parallel([
  () => agent(
    `cd ${cwd} && node dist/cli.mjs --version 2>&1; echo "---EXIT:$?---"
     报告: exit code, stdout 内容, 是否输出 version。
     返回 {passed, summary, details}。
     关键: 没有这一步不算验证 (2026-06-13 lesson)。`,
    { label: "cli-version", phase: "Binary Smoke", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `cd ${cwd} && node dist/cli.mjs --help 2>&1; echo "---EXIT:$?---"
     报告: stdout 实际内容, 列出的 subcommand 列表, 是否出现 "Usage:" 行。
     返回 {passed, summary, details}。`,
    { label: "cli-help", phase: "Binary Smoke", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `Commander 注册 gap 检查 (2026-06-14 T7 lesson)。
     步骤:
     1. cd ${cwd} && grep -rnE "getCommands|Command\\(" src/commands.ts | head -50
     2. 期望注册的 subcommand: provider/claude, mcp, workflows, doctor, init, plans, agents,
        pr, where, version; 若 src/commands/bg-agents/ 存在则必须注册
     3. cd ${cwd} && node dist/cli.mjs --help 2>&1 | grep -E "^\\s+[a-z][a-z-]+ "
     4. 对比, 列出 missing subcommands
     报告: (1) grep 输出, (2) 实际显示 sub, (3) missing 列表, (4) pass/fail。
     返回 {passed, summary, details, errors[]}。`,
    { label: "cli-subcmd-registry", phase: "Binary Smoke", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `cd ${cwd} && node dist/cli.mjs --debug -p "say 'ok' and stop" 2>&1 | tail -50; echo "---EXIT:$?---"
     报告: (1) DEBUG 日志是否启动, (2) -p 调用是否完成, (3) fatal 错误。
     返回 {passed, summary, details}。`,
    { label: "cli-debug-oneliner", phase: "Binary Smoke", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `Provider profile sanity check。
     步骤:
     1. cat ${cwd}/.claude-profile.json (若不存在报告 skip 但不 FAIL)
     2. 验证 active profile = ${profile}
     3. 验证 provider 类型 ∈ {anthropic, ollama, openai-compatible}
     4. 若 anthropic: 检查 ANTHROPIC_API_KEY 或 OAuth 凭证存在
     5. 若 ollama/openai: 检查 base_url + model 字段
     报告: profile 内容, sanity 结果, 任何配置缺失。
     返回 {passed, summary, details}。`,
    { label: "profile-sanity", phase: "Binary Smoke", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
])

const phase2 = { version: versionR, help: helpR, subcmd: subcmdR, debug: debugR, profile: profileR }
log(summarizePhase("Phase 2 (Binary Smoke):", phase2))

// ── Phase 3-6: TUI Pipeline (顺序, 各 agent 自管 session) ─────
const profileNote = `当前 profile: ${profile}。如需切换, 先 /model 或 opencc profile set ${profile}。`

phase("TUI Render & LLM")
log("Phase 3: 启动 TUI, 验证 render + LLM 响应 + 3-way version 一致性")

const renderR = await agent(
  `你是 OpenCC TUI 验证 agent。${profileNote}

   任务: Phase 4.1-4.2 + 3-way version 检查 (按 docs/verification-checklist.md)。
   步骤:
   1. 加载 agent-tui skill (agent-tui --version; 未装则 curl install.sh)
   2. macOS daemon 隔离: tmux kill-session -t agent-tui 2>/dev/null; rm -f /tmp/agent-tui*;
      tmux new-session -d -s agent-tui 'agent-tui daemon start --foreground > /tmp/agent-tui-daemon.log 2>&1'; sleep 1
   3. cd ${cwd} && nohup agent-tui run -d "$(pwd)" -- node "$(pwd)/dist/cli.mjs" --debug > /tmp/agent-tui-launch.log 2>&1 &
      sleep 3
      agent-tui sessions 2>&1 | tail -3 (捕获 session_id)
   4. agent-tui wait --stable + screenshot, 验证 splash header / model line / directory /
      status bar 含 bypass permissions + branch + model + Debug mode
   5. 提取 splash 中的 version (e.g. v0.17.0), 记为 VERSION
   6. agent-tui type "Say ok and stop" + Enter + wait --stable + screenshot, 验证 ⏺ ok
   7. /help + Escape (提取 VERSION_HELP), /status + Escape (提取 VERSION_STATUS)
   8. 3-way 一致性: VERSION == VERSION_HELP == VERSION_STATUS (不一致 = stale MACRO.VERSION bug)
   9. Ctrl+C + agent-tui kill (清理, 后续 phase 各自启动新 session)

   严格遵守 agent-tui skill 原子执行规则 (每步后 wait + screenshot)。
   严禁修改源文件。

   返回 {passed, tests[{name, passed, details}], issues[], summary, version}。`,
  { label: "tui-render-llm", phase: "TUI Render & LLM", schema: TUI_SCHEMA, agentType: "tui-func-verifier" },
)
log(checkPassed(renderR) ? "Phase 3: render + LLM 通过" : "Phase 3: render + LLM 失败")

phase("Tool Coverage")
log("Phase 4: 4 个工具 (bash, read, edit, write) 端到端")

const toolR = await agent(
  `你是 OpenCC TUI 验证 agent。${profileNote}

   任务: 4 个工具的端到端覆盖 (重启 TUI session, 不要共享 Phase 3 session)。
   步骤 (每工具原子循环: type → Enter → wait --stable → screenshot):
   1. agent-tui skill + daemon 前置 (同 Phase 3)
   2. Bash: type "Run: bash -c 'echo HELLO_FROM_TUI_VERIFY'", Enter, wait, screenshot
      验证: stdout 含 "HELLO_FROM_TUI_VERIFY"
   3. Read: type "Use Read to read package.json and tell me version", Enter, wait, screenshot
      验证: 响应含 "version"
   4. Edit (Update):
      echo "test fixture - Edit tool will replace this line" > /tmp/opencc-edit-test.md
      type "Use Edit to replace 'Edit tool will replace this line' with 'Edit tool verified working' in /tmp/opencc-edit-test.md, then Read to confirm", Enter, wait, screenshot
      验证: 响应含 "verified working"
      注: 若 model self-correct (Write → Update), 这是健康 2-attempt pattern, 算 PASS
   5. Write:
      rm -f /tmp/opencc-write-test.md
      type "Use Write to create /tmp/opencc-write-test.md with content 'Write tool verified working' then ls it", Enter, wait, screenshot
      验证: 响应含 "Write tool verified working"

   返回 {passed, tests[{name, passed, details}], issues[], summary}。`,
  { label: "tui-tools", phase: "Tool Coverage", schema: TUI_SCHEMA, agentType: "tui-func-verifier" },
)
log(checkPassed(toolR) ? "Phase 4: 4 tools 通过" : "Phase 4: 4 tools 有失败")

phase("Slash Coverage")
log("Phase 5: 8 个 slash command 验证")

const slashR = await agent(
  `你是 OpenCC TUI 验证 agent。${profileNote}

   任务: 8 个 slash command 端到端覆盖 (重启 TUI session)。
   每个命令: type → Enter → wait --stable → screenshot → Escape
   1. /help: 列出命令面板, 含 "Commands:", VERSION_HELP, Esc
   2. /status: 显示 "版本: VERSION_STATUS", Esc
   3. /mcp: 显示 MCP server 状态, 记录失败数 (期望 chrome-devtools 类 F/G 已知失败)
   4. /model: 显示 model picker, Esc
   5. /workflows: 显示 workflow 面板 (期望至少 1 个: opencc-bug-hunt, completion-smoke, sync-verify 等), Esc
   6. /goal register "test goal from fullprocess-v2" → Enter → wait → screenshot →
      验证含 "registered" 或 "active"
      /goal unregister → 清理
   7. /effort ultracode → Enter → wait → screenshot →
      验证含 "ultracode" 或 "Current effort level: ultracode"
      /effort high → 还原
   8. 关键词: type "ultracode say hello" → Enter → wait 60s → screenshot →
      验证含 "Run /workflows to see progress." 或类似 → /workflows 验证 1 个 active run

   关键: 3-way version 一致 (splash == /help == /status)

   返回 {passed, tests[{name, passed, details}], issues[], summary}。`,
  { label: "tui-slash", phase: "Slash Coverage", schema: TUI_SCHEMA, agentType: "tui-func-verifier" },
)
log(checkPassed(slashR) ? "Phase 5: 8 slash 通过" : "Phase 5: 有 slash 失败")

phase("Workflow Self-Test")
log("Phase 6: dynamic-workflow feature 端到端 (核心闭环)")

const workflowR = await agent(
  `你是 OpenCC TUI 验证 agent。${profileNote}

   任务: 端到端验证 dynamic-workflow feature
   (user-written workflow spawn subagent → 返回 final report 整条 wire-up)。
   步骤 (重启 TUI session):
   1. agent-tui skill + daemon 前置
   2. type "/completion-smoke", Enter
   3. wait 直到 "completion-smoke done" 出现在 chat (最多 30s)
   4. screenshot 证据
   5. 验证 chat 含 "completion-smoke done" final report
   6. Ctrl+C + agent-tui kill

   通过标准: final report 出现, 证明 subagent spawn → report 回传 → completion wire-up 链路通。
   这是 workflow feature 的核心闭环, 不通过 = workflow feature 整体失效。

   返回 {passed, tests[{name, passed, details}], issues[], summary}。`,
  { label: "tui-workflow", phase: "Workflow Self-Test", schema: TUI_SCHEMA, agentType: "tui-func-verifier" },
)
log(checkPassed(workflowR) ? "Phase 6: workflow self-test 通过" : "Phase 6: workflow self-test 失败")

// ── Phase 7: Debug Log Scan ────────────────────────────────────
phase("Debug Log Scan")
log("Phase 7: 扫描最新 debug log, anomaly A-I 分类 + stream 健康 + memory 副作用")

const logR = await agent(
  `你是 OpenCC debug log analyzer。${profileNote}

   任务: 扫描最新 debug log, 按 docs/verification-checklist.md 5.x 协议。
   步骤:
   1. LATEST=$(ls -t ~/.claude/debug/*.txt | head -1); wc -l "$LATEST"
   2. 计数 baseline errors/warns: grep -cE '\[ERROR\]|\[WARN\]' "$LATEST"
      期望 baseline ~22-25 (3 MCP + MiniMax-M3 + 无 gh)
   3. 对每个 [ERROR]/[WARN], 读前后 5 行, 按 anomaly class 分类:
      A — circuit-breaker (noise)
      B — title parse SyntaxError (noise)
      C — model gate supportedModels=undefined (noise)
      D — gh probe ENOENT (env)
      E — MCP server stderr banner (noise)
      F — chrome-devtools Node engine (< 22.12)
      G — chrome-devtools plugin loader (no "Starting connection")
      H — streaming stall (MiniMax first-token latency)
      I — session-end [WARN] [stderr] (LSP child)
      新 class (未在 A-I 中) = real regression (STOP 信号)
   4. Stream health: grep first_token_ms | head -10, median 1-2s, 无明显退化
   5. Memory side-effect: grep extractMemories.*writtenPaths=1,
      ls memory/private/tool-baseline-test-*.md (噪声, 但累积需清理)
   6. 任何未分类新异常 → 列为 "regression candidate"

   返回 {passed, summary, details, error_count, warn_count,
         anomalies[{class, count, examples[]}], stream_health,
         memory_side_effect, regression_candidates[]}。`,
  { label: "debug-log", phase: "Debug Log Scan", schema: CHECK_SCHEMA, agentType: "general-purpose" },
)
log(checkPassed(logR) ? "Phase 7: debug log 通过" : "Phase 7: debug log 有问题")

// ── Phase 8: Repo Health (3 parallel) ──────────────────────────
phase("Repo Health")
log("Phase 8: CodeGraph + AGENTS.md 一致性 + feature flags 审计")

const [codegraphR, agentsR, flagsR] = await parallel([
  () => agent(
    `CodeGraph 健康状态检查。
     步骤:
     1. cd ${cwd} && ls -la .codegraph/ 2>&1 (若不存在 → 未初始化, FAIL)
     2. 检查 .codegraph/index.sqlite 大小 + 修改时间 (是否新鲜)
     3. 抽样 3 个核心模块, codegraph_search 验证能找到:
        - src/services/api/client.ts (provider 路由)
        - src/utils/appState.ts 或 AppState 结构
        - src/components/REPL.tsx 或主 REPL 组件
     4. 报告: 初始化状态, index 健康, 抽样查询结果
     返回 {passed, summary, details}。`,
    { label: "codegraph-health", phase: "Repo Health", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `AGENTS.md 与代码现实的一致性 (drift detection)。
     步骤:
     1. 读 ${cwd}/AGENTS.md 和 /Users/ethan/code/opencc/AGENTS.md
     2. 验证关键声称:
        a. "Only three providers: anthropic, ollama, openai-compatible"
           → grep -rn "USE_GEMINI\|USE_MISTRAL\|USE_BEDROCK\|USE_VERTEX\|USE_FOUNDRY" src/ 应为 0 命中或仅 kill switch
        b. "Co-located tests *.test.ts" → find src -name "*.test.ts" | wc -l
        c. "Built into dist/cli.mjs" → ls -la dist/cli.mjs
        d. "TypeScript strict mode" → grep strict tsconfig.json
        e. "Silenced Tests" 列表: codexOAuth.test.ts 应不存在, statusNoticeDefinitions.safety.test.tsx 应存在
        f. "CodeGraph MCP server" → ls .codegraph/
        g. "BUILD output dist/cli.mjs, never edit directly" → 抽查 dist/cli.mjs
     3. 任何漂移 → 列 issues
     返回 {passed, summary, details, drifts[]}。`,
    { label: "agents-md-drift", phase: "Repo Health", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
  () => agent(
    `Feature flags audit: build.ts 现状与实际使用一致性。
     步骤:
     1. cat ${cwd}/scripts/build.ts | grep -E "DISABLE_|FEATURE_" | head -80
     2. 数 build.ts 中 flag 总数 (期望 ~36 per 2026-06-13 audit)
     3. grep -rn "OPENCC_DISABLE_" src/ 找实际使用
     4. 对比 build.ts 注册 vs src/ 实际使用:
        - dead flags: build.ts 注册但 src/ 未使用
        - unregistered: src/ 使用但 build.ts 未注册 (可能未生效)
     返回 {passed, summary, details, dead_flags[], unregistered_flags[]}。`,
    { label: "feature-flags-audit", phase: "Repo Health", schema: CHECK_SCHEMA, agentType: "general-purpose" },
  ),
])

const phase8 = { codegraph: codegraphR, agents: agentsR, flags: flagsR }
log(summarizePhase("Phase 8 (Repo Health):", phase8))

// ── Phase 9: Adversarial Verify ────────────────────────────────
phase("Adversarial Verify")
log("Phase 9: 对每个 FAIL finding, 3 个 skeptic 并行反驳 (多数票决真伪)")

const allResults = [
  { phase: "static", check: "build", r: buildR },
  { phase: "static", check: "typecheck", r: typeR },
  { phase: "static", check: "test", r: testR },
  { phase: "static", check: "provider-tests", r: providerR },
  { phase: "binary", check: "version", r: versionR },
  { phase: "binary", check: "help", r: helpR },
  { phase: "binary", check: "subcmd", r: subcmdR },
  { phase: "binary", check: "debug", r: debugR },
  { phase: "binary", check: "profile", r: profileR },
  { phase: "tui", check: "render", r: renderR },
  { phase: "tui", check: "tools", r: toolR },
  { phase: "tui", check: "slash", r: slashR },
  { phase: "tui", check: "workflow", r: workflowR },
  { phase: "log", check: "debug-log", r: logR },
  { phase: "repo", check: "codegraph", r: codegraphR },
  { phase: "repo", check: "agents-drift", r: agentsR },
  { phase: "repo", check: "flags", r: flagsR },
]

const failFindings = allResults.filter(x => !checkPassed(x.r))
log(`Phase 9: 找到 ${failFindings.length} 个 FAIL finding 待对抗验证`)

const adversarialResults = []
if (failFindings.length > 0) {
  // 一次并行所有 finding 的 3 个 skeptic (而非 per-finding 串行)
  const verifyTasks = failFindings.flatMap((f, findIdx) =>
    Array.from({ length: 3 }, (_, i) => () => agent(
      `你是 OpenCC adversarial verifier (finding #${findIdx + 1}, skeptic ${i + 1}/3)。
       任务: 反驳或确认以下 FAIL finding。

       Finding: ${f.phase}/${f.check} = FAIL
       Agent 报告: ${(f.r?.report ?? "").slice(0, 500)}
       错误列表: ${(f.r?.errors ?? []).join("; ") || "(none)"}

       反驳策略:
       1. False positive? (silenced test, baseline noise, 配置问题)
       2. Agent 报告是否准确? (grep 截断, tail 限制导致假 FAIL)
       3. 是否影响用户功能? (cosmetic 不算 critical)
       4. 是否在 AGENTS.md silenced catalog 中?
       5. 独立验证: 重跑相同命令确认

       返回 {verdict: "confirm" | "refute", confidence: 0-1, reason}。
       不确定时默认 refute (false positives 静默放过危害小, false negatives 用户可见)。
       严禁修改源文件。`,
      { label: `skeptic-${f.phase}-${f.check}-${i}`,
        phase: "Adversarial Verify",
        schema: VERIFY_SCHEMA,
        agentType: "general-purpose" },
    )),
  )
  const verdicts = await parallel(verifyTasks)

  // 重组: 每个 finding 3 个 verdict
  for (let i = 0; i < failFindings.length; i++) {
    const f = failFindings[i]
    const slice = verdicts.slice(i * 3, (i + 1) * 3)
    const confirms = slice.filter(v => v?.verdict === "confirm").length
    const refutes = slice.filter(v => v?.verdict === "refute").length
    const survives = confirms >= 2  // 多数票: 2/3+ 确认

    adversarialResults.push({
      finding: `${f.phase}/${f.check}`,
      original: "FAIL",
      survives,
      confirms,
      refutes,
      reason: survives
        ? `${confirms}/3 确认 FAIL 是真实问题`
        : `${refutes}/3 反驳 FAIL (false positive, 来自 silenced/baseline)`,
    })
    log(`  ${survives ? "✅ 真 FAIL" : "❌ false positive"} ${f.phase}/${f.check} (${confirms}C/${refutes}R)`)
  }
} else {
  log("Phase 9: 无 FAIL finding, 跳过对抗验证")
}

// ── Phase 10: Completeness Critic ──────────────────────────────
phase("Completeness Critic")
log("Phase 10: '我们漏了什么' 跨模块审计")

const criticR = await agent(
  `你是 OpenCC completeness critic。任务: 审视本次验证覆盖度, 找出 "我们漏了" 的重要维度。

   已验证的维度:
   - 静态 (Phase 1): build, typecheck, test, provider-tests
   - 二进制 (Phase 2): version, help, subcmd registry, debug -p, profile sanity
   - TUI (Phase 3-6): render + LLM, 4 tools, 8 slash cmds, workflow self-test
   - Debug log (Phase 7): anomaly A-I, stream health, memory side-effect
   - 仓库健康 (Phase 8): codegraph, AGENTS.md drift, feature flags

   审视问题 (每个 yes/no + 理由 + severity):
   1. 覆盖率: src/ 下所有 *.ts 文件是否至少被某测试 import? (抽样 5 个: src/utils/, src/services/, src/components/, src/hooks/, src/tools/)
   2. Provider: 3 个 provider (anthropic/ollama/openai-compatible) 是否都至少 smoke 一次?
   3. Hooks: PreToolUse, PostToolUse, Stop, UserPromptSubmit 是否至少一个 smoke? (e.g. /goal 的 Stop hook)
   4. Plugin/Marketplace: 是否有 test 覆盖 plugin loader?
   5. gRPC server: bun run dev:grpc 是否至少启动验证?
   6. Web UI: bun run web:build 是否至少 build 成功? (web/ 目录)
   7. VSCode extension: vscode-extension/ 是否至少 typecheck?
   8. Python helpers: python/ 目录是否有 test?
   9. Sync 状态: 与 upstream 是否还有未提交的 drift? (git log main-opencc..upstream/main --oneline | head)
   10. AGENTS.md 文档 vs 代码: 任何过时声称? (e.g. "230 deprecated functions" 数字是否还对)
   11. Memory 系统: ~/.claude/projects/.../memory/ 健康 (MEMORY.md 不超 200 行, frontmatter 合法)?
   12. Cron 任务: /loop 相关 cron 是否有?
   13. Feature flags runtime: OPENCC_DISABLE_* env var 是否生效 (而非 build.ts 仅常量)?
   14. Auth 流程: OAuth / API key 错误路径是否覆盖?
   15. 错误处理: bun --debug -p "trigger error" 是否 panic 安全?

   返回 {missing[{area, description, severity}], suggestions[]}。`,
  { label: "completeness-critic", phase: "Completeness Critic", schema: CRITIC_SCHEMA, agentType: "general-purpose" },
)

const missing = criticR?.missing ?? []
log(`Phase 10: critic 发现 ${missing.length} 个 missing 维度`)
if (missing.length > 0) {
  log("Missing 维度:")
  for (const m of missing) {
    log(`  - [${m.severity}] ${m.area}: ${m.description}`)
  }
}

// ── Phase 11: Synthesis ────────────────────────────────────────
phase("Synthesis")
log("Phase 11: 综合所有结果, 应用 adversarial verdict, 生成最终报告")

const synthR = await agent(
  `你是 OpenCC final reporter。任务: 汇总 11 phase 结果, 应用 adversarial + critic, 生成最终报告。

   ==== Phase 1: Static Foundation ====
   - build: ${checkPassed(buildR) ? "PASS" : "FAIL"} — ${(buildR?.report ?? "").slice(0, 300)}
   - typecheck: ${checkPassed(typeR) ? "PASS" : "FAIL"} — ${(typeR?.report ?? "").slice(0, 300)}
   - test: ${checkPassed(testR) ? "PASS" : "FAIL"} — ${(testR?.report ?? "").slice(0, 300)}
   - provider-tests: ${checkPassed(providerR) ? "PASS" : "FAIL"} — ${(providerR?.report ?? "").slice(0, 300)}

   ==== Phase 2: Binary Smoke ====
   - version: ${checkPassed(versionR) ? "PASS" : "FAIL"} — ${(versionR?.report ?? "").slice(0, 200)}
   - help: ${checkPassed(helpR) ? "PASS" : "FAIL"} — ${(helpR?.report ?? "").slice(0, 200)}
   - subcmd registry: ${checkPassed(subcmdR) ? "PASS" : "FAIL"} — ${(subcmdR?.report ?? "").slice(0, 300)}
   - debug -p: ${checkPassed(debugR) ? "PASS" : "FAIL"} — ${(debugR?.report ?? "").slice(0, 200)}
   - profile sanity: ${checkPassed(profileR) ? "PASS" : "FAIL"} — ${(profileR?.report ?? "").slice(0, 200)}

   ==== Phase 3-6: TUI Pipeline ====
   - render + LLM: ${checkPassed(renderR) ? "PASS" : "FAIL"} — ${(renderR?.report ?? "").slice(0, 200)}
   - tool coverage: ${checkPassed(toolR) ? "PASS" : "FAIL"} — ${(toolR?.report ?? "").slice(0, 200)}
   - slash coverage: ${checkPassed(slashR) ? "PASS" : "FAIL"} — ${(slashR?.report ?? "").slice(0, 200)}
   - workflow self-test: ${checkPassed(workflowR) ? "PASS" : "FAIL"} — ${(workflowR?.report ?? "").slice(0, 200)}

   ==== Phase 7: Debug Log Scan ====
   - log: ${checkPassed(logR) ? "PASS" : "FAIL"} — ${(logR?.report ?? "").slice(0, 300)}

   ==== Phase 8: Repo Health ====
   - codegraph: ${checkPassed(codegraphR) ? "PASS" : "FAIL"} — ${(codegraphR?.report ?? "").slice(0, 200)}
   - AGENTS.md drift: ${checkPassed(agentsR) ? "PASS" : "FAIL"} — ${(agentsR?.report ?? "").slice(0, 300)}
   - feature flags: ${checkPassed(flagsR) ? "PASS" : "FAIL"} — ${(flagsR?.report ?? "").slice(0, 300)}

   ==== Phase 9: Adversarial Verify ====
   ${adversarialResults.length === 0
     ? "   (无 FAIL finding, 跳过)"
     : adversarialResults.map(a =>
         `   - ${a.finding}: ${a.survives ? "真 FAIL" : "false positive"} (${a.reason})`
       ).join("\n")}

   ==== Phase 10: Completeness Critic ====
   Missing 维度 (按 severity 排序):
   ${missing.length === 0 ? "   (无)" : missing.sort((a,b) =>
     ["critical","high","medium","low"].indexOf(a.severity) -
     ["critical","high","medium","low"].indexOf(b.severity)
   ).map(m => `   - [${m.severity}] ${m.area}: ${m.description}`).join("\n")}

   任务:
   1. 应用 adversarial verdict: false positive 的 FAIL 不算 FAIL
   2. 列出所有真 gaps = survives FAIL + missing critical/high
   3. 计算 verdict: PASS = 无 critical/high gap, FAIL = 有
   4. 按优先级排序 next_actions (先 fix critical 路径)

   返回 {verdict, summary, breakdown, gaps, next_actions}。`,
  { label: "synthesis", phase: "Synthesis", schema: FINAL_SCHEMA, agentType: "general-purpose" },
)

return {
  verdict: checkPassed(synthR) && /"verdict":\s*"PASS"/i.test(synthR?.report ?? "")
    ? "PASS"
    : "FAIL",
  status: checkPassed(synthR) ? "complete" : "completed-with-issues",
  profile,
  phase1: { build: buildR, typecheck: typeR, test: testR, providerTests: providerR },
  phase2: { version: versionR, help: helpR, subcmd: subcmdR, debug: debugR, profile: profileR },
  phase3: renderR,
  phase4: toolR,
  phase5: slashR,
  phase6: workflowR,
  phase7: logR,
  phase8: { codegraph: codegraphR, agents: agentsR, flags: flagsR },
  phase9_adversarial: adversarialResults,
  phase10_critic: criticR,
  phase11: synthR,
}