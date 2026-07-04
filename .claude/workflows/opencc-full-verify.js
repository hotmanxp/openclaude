// .claude/workflows/opencc-full-verify.js
//
// OpenCC 完整功能验证 workflow (parallel multi-agent recipe)
//
// 触发: 用户要求 "完整功能验证" / "full verification" / "verify opencc"
// 设计参考:
//   - docs/verification-checklist.md (5-phase verify protocol)
//   - feedback/team/opencc-parallel-multi-agent-full-verify-recipe-2026-06-27
//   - .claude/workflows/opencc-verfiy-fix.js (Phase 1+2 reference)
//
// 结构 (3 phases, 1 serial + 9 parallel agents):
//   Phase 1: Build (serial, 1 agent — gating)
//   Phase 2: Static checks (parallel, 2 agents — typecheck/doctor)
//   Phase 3: TUI verification (parallel, 7 agents — 见下)
//
// Phase 3 7 agents:
//   V3a — TUI startup + splash + debug log basic
//   V4-1 — Slash basic (/help + /version + /clear)
//   V4-2 — Slash stats + permissions (/cost + /permissions)
//   V4-3 — Slash status (/status + /memory)
//   V2 — CLI smoke (--version / --help / -p hello / -p model / --invalid-flag)
//   V5 — Tool calls (Read/Glob/Grep + multi-turn + error recovery)
//   V6 — Debug log comprehensive scan (Phase 5 catalog)
//

export const meta = {
  name: "opencc-full-verify",
  description:
    "OpenCC 完整功能验证: Phase 1 build (serial) → Phase 2 静态检查 (2 agents parallel: typecheck/doctor) → Phase 3 TUI 验证 (7 agents parallel)。严禁修改任何源文件。",
  phases: [
    { title: "Phase 1: Build (serial)" },
    { title: "Phase 2: Static checks (2 parallel)" },
    { title: "Phase 3: TUI verification (7 parallel)" },
  ],
};

const cwd = "/Users/ethan/code/opencc";

// Schemas 使用 string 字段而非 array, 避免 StructuredOutput array rejection
// (memory: opencc-workflowtool-structured-output-schema-array-validation)
const CHECK_SCHEMA = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    exitCode: { type: "integer" },
    summary: { type: "string" },
    errors: { type: "string" },
  },
  required: ["passed", "summary"],
};

const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    summary: { type: "string" },
    issues: { type: "string" },
  },
  required: ["passed", "summary"],
};

// agent() returns { ok, agentId, report, label, phase } — NOT schema fields.
// Schema 只是 LLM prompt contract, 我们 parse 字符串 report。
// (memory: opencc-agent-schema-not-returned-as-object-fields-2026-06-27)
function checkPassed(agentR) {
  if (!agentR?.ok) return false;
  const report = agentR.report ?? "";
  return /\bpass(ed)?\b/i.test(report) || !/\bfail(ed)?\b/i.test(report);
}

// ===== PHASE 1: BUILD (serial, gating) =====
phase("Phase 1: Build (serial)");
log("Step 1/3: 重建 dist/cli.mjs (后续 phase 全部依赖此)");

const buildR = await agent(
  `cd ${cwd} && bun run build 2>&1 | tail -30

报告:
- exit code (0 = 成功)
- "Built opencc vX.Y.Z" 中的 X.Y.Z 数字 (这就是 dist/cli.mjs 的版本)
- 任何错误信息 (例如 externals 缺失 / SDK 同步失败 / bundle guard 报错)

严禁修改任何文件。`,
  {
    label: "build",
    phase: "Phase 1: Build (serial)",
    schema: CHECK_SCHEMA,
    agentType: "tui-func-verifier",
    model: "MiniMax-M2.7-highspeed",
  },
);

if (!checkPassed(buildR)) {
  log("✗ Phase 1 build FAILED — 跳过所有后续 phase");
  return { status: "failed-build", build: buildR };
}

log("✓ Phase 1 build 成功 → 开始 Phase 2");

// ===== PHASE 2: STATIC CHECKS (2 agents parallel) =====
phase("Phase 2: Static checks (2 parallel)");
log("Step 2/3: 并行 typecheck + doctor:runtime");

const [typeR, docR] = await parallel([
  () =>
    agent(
      `cd ${cwd} && bun run typecheck 2>&1 | tail -40

报告:
- exit code (0 = pass)
- 错误数量 (TS error count)
- 前 5 个错误详情 (格式: 文件:行号: 错误消息)
- PASS / FAIL 总结

特别注意:
- TS2367 "Type 'X' is used as a value" — rebrand 残留 (memory: opencc-fork-rebrand-ant-vs-external-residuals)
- TS2304 "Cannot find name" — 缺 import
- TS2740 "Missing property" — 类型不匹配

严禁修改任何文件。`,
      {
        label: "typecheck",
        phase: "Phase 2: Static checks (2 parallel)",
        schema: CHECK_SCHEMA,
        agentType: "tui-func-verifier",
        model: "MiniMax-M2.7-highspeed",
      },
    ),
  () =>
    agent(
      `cd ${cwd} && bun run doctor:runtime 2>&1 | tail -40

报告:
- exit code
- 通过的检查数 / 总数 (格式如 "8/8")
- 任何关键警告 (例如 SDK stub 状态 / provider 配置 / sandbox 状态)
- PASS / FAIL

严禁修改任何文件。`,
      {
        label: "doctor",
        phase: "Phase 2: Static checks (2 parallel)",
        schema: CHECK_SCHEMA,
        agentType: "tui-func-verifier",
        model: "MiniMax-M2.7-highspeed",
      },
    ),
]);

const typeOk = checkPassed(typeR);
const docOk = checkPassed(docR);

log(
  `Phase 2 summary: typecheck=${typeOk ? "PASS" : "FAIL"} doctor=${docOk ? "PASS" : "FAIL"}`,
);

if (!typeOk) {
  log("⚠ typecheck FAILED — 通常是 real regression, 强烈建议修复后重跑");
}

log("✓ Phase 2 完成 → 开始 Phase 3");

// ===== PHASE 3: TUI VERIFICATION (7 agents parallel) =====
phase("Phase 3: TUI verification (7 parallel)");
log("Step 3/3: 并行 7 agent TUI 验证");

const [
  tuiR,
  slash1R,
  slash2R,
  slash3R,
  cliR,
  toolsR,
  debugR,
] = await parallel([
  // ===== V3a: TUI startup + splash + debug log basic =====
  () =>
    agent(
      `OpenCC TUI 启动 + splash 验证 Agent。

工作目录: ${cwd}
dist/cli.mjs 已构建。

==== STEP 1 (REQUIRED FIRST) - PTY 启动 REPL ====
(memory: opencc-tui-launch-pty-pattern 用 \`script -q\` 分配 PTY)

\`\`\`
rm -f /tmp/opencc-tui.log /tmp/opencc-debug.log
OPENCC_LOG_FILE=/tmp/opencc-debug.log timeout 15 script -q /tmp/opencc-tui.log \\
  bash -c 'node dist/cli.mjs --debug 2>&1' <<'EOF' || true
hello
/exit
EOF
\`\`\`

==== STEP 2 - 验证 splash 渲染 (BEFORE STEP 3) ====
\`cat /tmp/opencc-tui.log\`
期望看到: OpenCC 品牌 + clawd ASCII (▐▛███▜▌) 或 woodpecker + prompt (❯ 或 >)。
(memory: opencc-claude-mascot-exact-ascii-v2-1-177 + opencc-woodpecker-splash-replacement)

==== STEP 3 - 验证 prompt 出现 ====

==== STEP 4 - Debug log 基础检查 ====
\`wc -l /tmp/opencc-debug.log\` + \`grep -c ERROR /tmp/opencc-debug.log\`

==== STEP 5 (REQUIRED BEFORE report) - 关键错误模式 grep ====
(区分 noise vs real)

Real error (FAIL if found):
- useMemoCache size mismatch (memory: opencc-react-compiler-usememocache-size-mismatch)
- exception / TypeError / throw (未处理异常)
- Permission denied / EACCES
- Cannot find module / MODULE_NOT_FOUND

==== 报告 ====
- Splash 渲染: yes/no + ASCII 行
- Prompt 出现: yes/no
- Debug log: 行数 + 错误数
- 关键错误 grep 结果
- Overall: PASS / FAIL

严禁修改任何源文件。`,
      {
        label: "tui-startup",
        phase: "Phase 3: TUI verification (7 parallel)",
        schema: VERIFY_SCHEMA,
        agentType: "tui-func-verifier",
        model: "MiniMax-M2.7-highspeed",
      },
    ),

  // ===== V4-1: Slash commands basic (/help + /status + /clear) =====
  () =>
    agent(
      `OpenCC slash commands 基础组 验证 Agent。

工作目录: ${cwd}
dist/cli.mjs 已构建。

==== STEP 1 (REQUIRED FIRST) - /help ====
\`\`\`
cd ${cwd} && timeout 20 script -q /tmp/opencc-slash-help.log \\
  bash -c 'node dist/cli.mjs 2>&1' <<'EOF'
/help
/exit
EOF
tail -50 /tmp/opencc-slash-help.log
\`\`\`
期望: 显示命令列表 (含 provider/status/model/memory/help/clear/exit/config)

==== STEP 2 (REQUIRED BEFORE STEP 3) - /status (核心状态查询) ====
\`\`\`
cd ${cwd} && timeout 20 script -q /tmp/opencc-slash-status.log \\
  bash -c 'node dist/cli.mjs 2>&1' <<'EOF'
/status
/exit
EOF
tail -30 /tmp/opencc-slash-status.log
\`\`\`
期望: 显示 session/model/CWD/权限状态信息

==== STEP 3 - /clear ====
\`\`\`
cd ${cwd} && timeout 20 script -q /tmp/opencc-slash-clear.log \\
  bash -c 'node dist/cli.mjs 2>&1' <<'EOF'
/clear
/exit
EOF
tail -10 /tmp/opencc-slash-clear.log
\`\`\`
期望: 不报错, 正常退出

==== 报告 (PASS/FAIL per step + 关键输出) ====
- /help: PASS/FAIL
- /status: PASS/FAIL
- /clear: PASS/FAIL
- Overall: PASS / FAIL

严禁修改任何文件。`,
      {
        label: "slash-basic",
        phase: "Phase 3: TUI verification (7 parallel)",
        schema: VERIFY_SCHEMA,
        agentType: "tui-func-verifier",
        model: "MiniMax-M2.7-highspeed",
      },
    ),

  // ===== V4-2: Slash commands config + provider (/config + /provider) =====
  // Note: /cost + /permissions 已被 2026-07-01 surface-reduction sweep 移除 (memory: opencc-2026-07-01-cost-command-commented-out)
  // /config + /provider 替代 stats 组的位置, 都是当前用户可见命令
  () =>
    agent(
      `OpenCC slash commands 配置+provider 组 验证 Agent。

工作目录: ${cwd}
dist/cli.mjs 已构建。

==== STEP 1 (REQUIRED FIRST) - /config ====
\`\`\`
cd ${cwd} && timeout 20 script -q /tmp/opencc-slash-config.log \\
  bash -c 'node dist/cli.mjs 2>&1' <<'EOF'
/config
/exit
EOF
tail -30 /tmp/opencc-slash-config.log
\`\`\`
期望: 显示 Settings 面板 (含 Config / Preferences / Usage 等 Tab)

==== STEP 2 (REQUIRED BEFORE report) - /provider ====
\`\`\`
cd ${cwd} && timeout 20 script -q /tmp/opencc-slash-provider.log \\
  bash -c 'node dist/cli.mjs 2>&1' <<'EOF'
/provider
/exit
EOF
tail -30 /tmp/opencc-slash-provider.log
\`\`\`
期望: 显示 provider 列表 (含 anthropic / ollama / openai-compatible 等, 标记当前选中)

==== 报告 ====
- /config: PASS/FAIL + 实际显示的 Tab 列表
- /provider: PASS/FAIL + 当前 provider 标记
- Overall: PASS / FAIL

严禁修改任何文件。`,
      {
        label: "slash-stats",
        phase: "Phase 3: TUI verification (7 parallel)",
        schema: VERIFY_SCHEMA,
        agentType: "tui-func-verifier",
        model: "MiniMax-M2.7-highspeed",
      },
    ),

  // ===== V4-3: Slash commands status (/status + /memory) =====
  () =>
    agent(
      `OpenCC slash commands 状态组 验证 Agent。

工作目录: ${cwd}
dist/cli.mjs 已构建。

==== STEP 1 (REQUIRED FIRST) - /status ====
\`\`\`
cd ${cwd} && timeout 20 script -q /tmp/opencc-slash-status.log \\
  bash -c 'node dist/cli.mjs 2>&1' <<'EOF'
/status
/exit
EOF
tail -50 /tmp/opencc-slash-status.log
\`\`\`
期望: 显示 session/model/CWD/权限状态信息

==== STEP 2 (REQUIRED BEFORE report) - /memory ====
\`\`\`
cd ${cwd} && timeout 20 script -q /tmp/opencc-slash-memory.log \\
  bash -c 'node dist/cli.mjs 2>&1' <<'EOF'
/memory
/exit
EOF
tail -50 /tmp/opencc-slash-memory.log
\`\`\`
期望: 显示 memory UI 或 CLAUDE.md/AGENTS.md 相关内容
(memory: opencc-memory-ui-claudemd-label)

==== 报告 ====
- /status: PASS/FAIL + 关键内容 (model/CWD/permissions)
- /memory: PASS/FAIL + 关键内容
- Overall: PASS / FAIL

严禁修改任何文件。`,
      {
        label: "slash-status",
        phase: "Phase 3: TUI verification (7 parallel)",
        schema: VERIFY_SCHEMA,
        agentType: "tui-func-verifier",
        model: "MiniMax-M2.7-highspeed",
      },
    ),

  // ===== V2: CLI non-interactive smoke =====
  () =>
    agent(
      `OpenCC CLI 非交互 smoke 验证 Agent。

工作目录: ${cwd}
dist/cli.mjs 已构建。

==== STEP 1 (REQUIRED FIRST) - --version brand regression ====
\`node dist/cli.mjs --version\`
期望: 精确匹配 "0.19.0 (Open CC)"
(memory: opencc-cherry-pick-version-bump-rebrand-regression)

==== STEP 2 - --help ====
\`node dist/cli.mjs --help\`
期望: 包含 -p, --model, --provider, --debug, -c flag

==== STEP 3 - 单次 prompt ====
\`timeout 60 node dist/cli.mjs -p "hello"\`
期望: assistant 回复 (>= 1 行), exit 0, 无 stack trace

==== STEP 4 - 模型查询 ====
\`timeout 60 node dist/cli.mjs -p "what model are you using? reply in one short sentence."\`
期望: 提到模型名 (claude/sonnet/opus/MiniMax 之一)

==== STEP 5 - 错误处理 ====
\`timeout 30 node dist/cli.mjs --invalid-flag\`
期望: 清晰错误信息 + exit non-zero, 不 stack trace

==== 报告 PASS/FAIL per step + 实际输出 ====
Overall: PASS / FAIL
严禁修改任何文件。`,
      {
        label: "cli-smoke",
        phase: "Phase 3: TUI verification (7 parallel)",
        schema: VERIFY_SCHEMA,
        agentType: "tui-func-verifier",
        model: "MiniMax-M2.7-highspeed",
      },
    ),

  // ===== V5: Dialog flow + tool calls =====
  () =>
    agent(
      `OpenCC 工具调用验证 Agent。

工作目录: ${cwd}
dist/cli.mjs 已构建。

==== STEP 1 (REQUIRED FIRST) - Read 工具 ====
\`\`\`
cd ${cwd} && OPENCC_LOG_FILE=/tmp/opencc-tool-read.log \\
  timeout 90 node dist/cli.mjs -p "Read package.json and tell me its name and version. Reply in one sentence." 2>&1 | tail -40
\`\`\`
期望: assistant 提到 "opencc" 和 "0.19.0"

==== STEP 2 - Glob 工具 ====
\`\`\`
cd ${cwd} && OPENCC_LOG_FILE=/tmp/opencc-tool-glob.log \\
  timeout 90 node dist/cli.mjs -p "List 3 TypeScript files in src/. Just file names, no explanation." 2>&1 | tail -30
\`\`\`
期望: assistant 提到 3 个 .ts 文件路径

==== STEP 3 - Grep 工具 ====
\`\`\`
cd ${cwd} && OPENCC_LOG_FILE=/tmp/opencc-tool-grep.log \\
  timeout 90 node dist/cli.mjs -p "Use Grep to find the string 'getAnthropicClient' in src/. Just report total count." 2>&1 | tail -30
\`\`\`
期望: assistant 给出数字

==== STEP 4 (BEFORE STEP 5) - 多轮对话 ====
\`timeout 90 node dist/cli.mjs -p "First, say hi. Then read package.json and tell me version." 2>&1 | tail -40\`
期望: greeting + version 都出现

==== STEP 5 - 错误恢复 ====
\`timeout 60 node dist/cli.mjs -p "Read the file /tmp/nonexistent-xyz-12345.txt and tell me what you see." 2>&1 | tail -30\`
期望: assistant 说不存在, 不 crash

==== 报告 PASS/FAIL per step + 实际输出 ====
Overall: PASS / FAIL
严禁修改任何文件。`,
      {
        label: "tool-calls",
        phase: "Phase 3: TUI verification (7 parallel)",
        schema: VERIFY_SCHEMA,
        agentType: "tui-func-verifier",
        model: "MiniMax-M2.7-highspeed",
      },
    ),

  // ===== V6: Debug log comprehensive scan =====
  () =>
    agent(
      `OpenCC debug log 综合扫描 Agent (Phase 5 of docs/verification-checklist.md)。

工作目录: ${cwd}
dist/cli.mjs 已构建。

==== STEP 1 (REQUIRED FIRST) - 启动 + 操作 ====
\`\`\`
cd ${cwd} && rm -f /tmp/opencc-debug-full.log && \\
  OPENCC_LOG_FILE=/tmp/opencc-debug-full.log timeout 30 node dist/cli.mjs -p \\
  "show me current directory and one file in it" 2>&1 | tail -10
\`\`\`

==== STEP 2 - Debug log 大小 ====
\`\`\`
ls -la /tmp/opencc-debug-full.log
wc -l /tmp/opencc-debug-full.log
\`\`\`

==== STEP 3 (REQUIRED BEFORE STEP 4) - 关键错误模式 grep ====
(区分 noise vs real, 必须精读)

A. 已知 startup noise (FAIL = false positive):
- "Successfully connected" (MCP, memory: opencc-debug-log-mcp-stderr-false-positive)
- "Failed to fetch MCP registry: 403" (memory: opencc-debug-log-mcp-registry-403-2026-06-14)
- "tree-sitter unavailable" (Phase 5 Class K, baseline)
- "Cached MC gate" (Phase 5 Class L, benign per-request)
- "useMemoCache size" (Phase 5 Class M, real regression if found)

B. Real error 模式 (FAIL if found new):
- TypeError / Exception / stack trace (未处理异常)
- Permission denied / EACCES
- Cannot find module / MODULE_NOT_FOUND
- FATAL (致命错误)

==== STEP 4 - 输出最终报告 ====
- Debug log 行数
- 各类错误数量 (按 B 分类)
- 任何不能归类到 A 的 ERROR (前 10 行 context)
- Overall: PASS / FAIL

严禁修改任何源文件。`,
      {
        label: "debug-log-scan",
        phase: "Phase 3: TUI verification (7 parallel)",
        schema: VERIFY_SCHEMA,
        agentType: "tui-func-verifier",
        model: "MiniMax-M2.7-highspeed",
      },
    ),
]);

const tuiOk = checkPassed(tuiR);
const slash1Ok = checkPassed(slash1R);
const slash2Ok = checkPassed(slash2R);
const slash3Ok = checkPassed(slash3R);
const cliOk = checkPassed(cliR);
const toolsOk = checkPassed(toolsR);
const debugOk = checkPassed(debugR);

const failed = [];
if (!tuiOk) failed.push("tui-startup");
if (!slash1Ok) failed.push("slash-basic");
if (!slash2Ok) failed.push("slash-stats");
if (!slash3Ok) failed.push("slash-status");
if (!cliOk) failed.push("cli-smoke");
if (!toolsOk) failed.push("tool-calls");
if (!debugOk) failed.push("debug-log-scan");

const allPass = failed.length === 0;
const status = allPass
  ? "complete"
  : failed.length <= 2
    ? "completed-with-issues"
    : "partial";

log(
  `Phase 3 summary: ${failed.length === 0 ? "ALL 7 agents PASS" : failed.join(", ") + " FAILED"}`,
);
log(`Overall: ${status}`);

return {
  status,
  build: buildR,
  phase2_static: { typecheck: typeR, doctor: docR },
  phase3_tui: {
    tuiStartup: tuiR,
    slashBasic: slash1R,
    slashStats: slash2R,
    slashStatus: slash3R,
    cliSmoke: cliR,
    toolCalls: toolsR,
    debugLogScan: debugR,
  },
  failed,
};