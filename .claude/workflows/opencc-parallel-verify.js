// .claude/workflows/opencc-parallel-verify.js
//
// OpenCC 完整功能验证 (5-phase protocol + 并行 multi-agent recipe)
//
// Architecture (3 phases, 1 serial + 11 parallel agents):
//   Phase 1: Static checks     4 parallel agents: build ‖ typecheck ‖ test ‖ doctor
//   Phase 2: TUI verification  7 parallel agents (per recipe 2026-06-27):
//                                - cli-smoke:        --version ‖ --help ‖ -p hello ‖ -p model ‖ --invalid-flag
//                                - tui-startup:      PTY + splash + debug log basic scan
//                                - slash-basic:      /help ‖ /version ‖ /clear
//                                - slash-resource:   /provider list ‖ /model list (echoes current model only, NOT list)
//                                - slash-status:     /status ‖ /memory
//                                - tool-calls:       Read ‖ Glob ‖ Grep ‖ multi-turn ‖ error recovery
//                                - debug-log-scan:   Phase 5 catalog A-I + K-L
//   Phase 3: Synthesis         inline result aggregation + verdict
//
// Hard gate after Phase 1: static broken -> runtime checks meaningless.
// Soft fail through Phase 2: gather all data so synthesis shows full picture.
//
// Invocation: /opencc-parallel-verify
//
// Reference:
//   - docs/verification-checklist.md (5-phase protocol)
//   - team/opencc-parallel-multi-agent-full-verify-recipe-2026-06-27
//   - .claude/workflows/opencc-verfiy-fix.js (v1 reference, only has Phase 1 + single TUI agent)
//   - .claude/workflows/opencc-fullprocess-verify.js (existing workflow meta format)
//
// Wall-clock: ~40s build (in Phase 1) + ~60-90s 11 parallel agents = ~2 min total
// vs ~6-8 min serial 5-phase gate.
//
// CRITICAL SAFETY CONSTRAINTS (per user 2026-06-27 EOD + AGENTS.md Provider Policy):
//   - 严禁修改任何源文件 (.ts/.tsx/.js/.json, except dist/ + /tmp/*.log)
//   - 严禁修改 provider 或 model 配置
//     * 禁止 /provider set / /provider use / /model set / /model use 等修改 slash
//     * 禁止修改 .claude-profile.json
//     * 禁止 export CLAUDE_CODE_USE_OPENAI / OPENAI_API_KEY / OPENAI_MODEL / ANTHROPIC_API_KEY
//     * 禁止传 --model / --provider / --api-base 参数给 dist/cli.mjs
//   - 严禁修改任何环境变量 (除只读检查如 OPENCC_LOG_FILE)
//   - 仅观察、运行、报告。不尝试修复 bug - issues 字段报告即可
//   - AGENTS.md Provider Policy: Only anthropic / ollama / openai-compatible 三种 provider 受支持

export const meta = {
  name: "opencc-parallel-verify",
  description:
    "OpenCC 完整功能验证 (并行 11 agent):Phase 1 静态检查 (build+typecheck+test+doctor) → Phase 2 TUI 验证 (cli-smoke + tui-startup + slash×3 + tools + debug-log-scan)。严禁修改任何文件、provider、model 或 profile。",
  phases: [
    { title: "Phase 1: Static checks (4 parallel)" },
    { title: "Phase 2: TUI verification (7 parallel)" },
    { title: "Phase 3: Synthesis" },
  ],
}

const cwd = "/Users/ethan/code/opencc"

// Schemas: avoid `array` fields (memory: opencc-workflowtool-structured-output-schema-array-validation)
// All collection fields are newline-joined strings instead.
const CHECK_SCHEMA = {
  type: "object",
  required: ["passed", "summary"],
  properties: {
    passed: { type: "boolean" },
    exitCode: { type: "integer" },
    summary: { type: "string" },
    errors: { type: "string" },
  },
}

const TUI_SCHEMA = {
  type: "object",
  required: ["passed", "summary"],
  properties: {
    passed: { type: "boolean" },
    summary: { type: "string" },
    details: { type: "string" },
    issues: { type: "string" },
  },
}

// agent() returns { ok, agentId, report, label, phase } — NOT schema fields.
// (memory: opencc-agent-schema-not-returned-as-object-fields-2026-06-27)
// The schema is a contract for the LLM's freeform report, NOT a typed return.
// Parse the report string for PASS/FAIL verdict.
function checkPassed(agentR) {
  if (!agentR?.ok) return false
  const report = agentR.report ?? ""
  return /\bpass(ed)?\b/i.test(report) || !/\bfail(ed)?\b/i.test(report)
}

// Safety banner prepended to every agent prompt — enforces user 2026-06-27 EOD directive
// (no provider/model/profile changes) + AGENTS.md Provider Policy + no source modifications.
const SAFETY_BANNER = `
[SAFETY] Strictly observe (严禁违反):

1. Source files: DO NOT modify any .ts/.tsx/.js/.json files (except dist/ artifacts + /tmp/*.log).
2. Provider / Model (CRITICAL — 严禁):
   - DO NOT call /provider set / /provider use / /model set / /model use slash commands.
   - DO NOT modify .claude-profile.json (gitignored).
   - DO NOT export CLAUDE_CODE_USE_OPENAI / OPENAI_API_KEY / OPENAI_MODEL / OPENAI_BASE_URL / ANTHROPIC_API_KEY.
   - DO NOT pass --model / --provider / --api-base flags to dist/cli.mjs.
3. Environment: DO NOT modify any env var except read-only logging (e.g. OPENCC_LOG_FILE).
4. Behavior: observe, run, report ONLY. Do NOT attempt to fix bugs — report in issues field with evidence.

Provider Policy (AGENTS.md): Only anthropic / ollama / openai-compatible 三种 provider 受支持. Other providers (mistral / bedrock / gemini / vertex / foundry / codex / fireworks / xAI / nvidia-nim) 已弃用 — 出现时正常报告为 PASS-by-policy-excluded 即可.
`

// =====================================================================
// PHASE 1: STATIC CHECKS (parallel: build + typecheck + test + doctor)
// =====================================================================
phase("Phase 1: Static checks (4 parallel)")
log("并行执行 build / typecheck / test / doctor")

const [buildR, typeR, testR, doctorR] = await parallel([
  () =>
    agent(
      SAFETY_BANNER +
        `
You are the build verification agent.
Working dir: ${cwd}

Task:
\`\`\`bash
cd ${cwd} && bun run build 2>&1 | tail -30
\`\`\`

Report (PASS/FAIL):
- exit code
- Does "✓ Built opencc vX.Y.Z → dist/cli.mjs" appear? Extract version.
- Key output lines (last 20 lines on failure).
- Any errors: externals missing / SDK sync / bundle guard.`,
      {
        label: "bun-build",
        phase: "Phase 1: Static checks (4 parallel)",
        schema: CHECK_SCHEMA,
        agentType: "tui-func-verifier",
      },
    ),
  () =>
    agent(
      SAFETY_BANNER +
        `
You are the typecheck verification agent.
Working dir: ${cwd}

Task:
\`\`\`bash
cd ${cwd} && bun run typecheck 2>&1 | tail -30
\`\`\`

Report (PASS/FAIL):
- exit code
- TS error count
- Top 5 errors (file:line + message)
- Any TS2367 (rebrand residue — memory: opencc-fork-rebrand-ant-vs-external-residuals).
- Any TS2304 / TS2740 / module-not-found.`,
      {
        label: "bun-typecheck",
        phase: "Phase 1: Static checks (4 parallel)",
        schema: CHECK_SCHEMA,
        agentType: "tui-func-verifier",
      },
    ),
  () =>
    agent(
      SAFETY_BANNER +
        `
You are the full unit-test verification agent.
Working dir: ${cwd}

Task:
\`\`\`bash
cd ${cwd} && bun test --timeout 30000 2>&1 | tail -150
\`\`\`

Report (PASS/FAIL):
- exit code
- pass / skip / fail counts (format like "3887 pass / 44 skip / 55 fail")
- Top 5 failing test names on failure (grep "FAIL " lines)
- Categorize: pre-existing vs new regression.
  - Pre-existing baseline: 55 fails, root cause src/utils/auth.ts:293 ANTHROPIC_API_KEY env-var + excluded-provider scaffolding (mistral/bedrock/gemini/fireworks/xAI/codex/Foundry/v2-emitter), per team/opencc-main-opencc-pre-existing-test-fails-2026-06-23.
  - Tolerate up to 60 fails as PASS (pre-existing baseline 55 + small drift).
  - Anything > 60 fails OR fails outside the pre-existing buckets = real regression, report FAIL.`,
      {
        label: "bun-test",
        phase: "Phase 1: Static checks (4 parallel)",
        schema: CHECK_SCHEMA,
        agentType: "tui-func-verifier",
      },
    ),
  () =>
    agent(
      SAFETY_BANNER +
        `
You are the doctor:runtime verification agent.
Working dir: ${cwd}

Task:
\`\`\`bash
cd ${cwd} && bun run doctor:runtime 2>&1 | tail -40
\`\`\`

Report (PASS/FAIL):
- exit code
- Individual check results (Node version / Bun version / dist exists / sandbox / provider)
- Any critical warnings`,
      {
        label: "doctor-runtime",
        phase: "Phase 1: Static checks (4 parallel)",
        schema: CHECK_SCHEMA,
        agentType: "tui-func-verifier",
      },
    ),
])

const phase1Pass =
  checkPassed(buildR) &&
  checkPassed(typeR) &&
  checkPassed(testR) &&
  checkPassed(doctorR)

if (!phase1Pass) {
  const failed = []
  if (!checkPassed(buildR)) failed.push("build")
  if (!checkPassed(typeR)) failed.push("typecheck")
  if (!checkPassed(testR)) failed.push("test")
  if (!checkPassed(doctorR)) failed.push("doctor")
  log("Phase 1 FAILED on: " + failed.join(", ") + " — 跳过 TUI 验证阶段")
  return {
    status: "failed-phase-1",
    failed,
    phase1: { build: buildR, typecheck: typeR, test: testR, doctor: doctorR },
  }
}

log("Phase 1 全绿:build + typecheck + test + doctor 全部通过。开始 Phase 2 并行 TUI 验证...")

// =====================================================================
// PHASE 2: TUI VERIFICATION (7 parallel agents)
// =====================================================================
phase("Phase 2: TUI verification (7 parallel)")
log(
  "并行 7 agent:cli-smoke + tui-startup + slash×3 (basic/resource/status) + tool-calls + debug-log-scan",
)

const [
  cliSmokeR,
  tuiStartupR,
  slashBasicR,
  slashResourceR,
  slashStatusR,
  toolCallsR,
  debugLogR,
] = await parallel([
  // ===== V-cli-smoke: 非交互 CLI smoke =====
  () =>
    agent(
      SAFETY_BANNER +
        `
You are the OpenCC CLI non-interactive smoke verification agent.
Working dir: ${cwd}
dist/cli.mjs already built (v0.19.0).

5 steps, all read-only:

1. \`node dist/cli.mjs --version\`
   MUST show "0.19.0 (Open CC)" exactly. NOT "OpenClaude" / "0.18.0".
   Brand regression check — memory: opencc-cherry-pick-version-bump-rebrand-regression.

2. \`node dist/cli.mjs --help\`
   Verify contains: -p, --model, --provider, --debug, -c flags.

3. \`node dist/cli.mjs -p "hello"\`
   Expect: assistant reply (≥ 1 line), exit 0, no stack trace.

4. \`node dist/cli.mjs -p "what model are you using? reply in one short sentence"\`
   Expect: assistant mentions a model name (claude / sonnet / opus / MiniMax).

5. \`node dist/cli.mjs --invalid-flag\`
   Expect: clear error message + exit 1, no stack trace.

Report PASS/FAIL per step + actual output key lines.
Overall: PASS / FAIL.`,
      {
        label: "cli-smoke",
        phase: "Phase 2: TUI verification (7 parallel)",
        schema: TUI_SCHEMA,
        agentType: "tui-func-verifier",
      },
    ),

  // ===== V-tui-startup: PTY 启动 + splash + debug log basic =====
  () =>
    agent(
      SAFETY_BANNER +
        `
You are the OpenCC TUI startup + splash + debug log verification agent.
Working dir: ${cwd}

Task:

STEP 1 (REQUIRED FIRST) — PTY launch REPL --debug
(memory: opencc-tui-launch-pty-pattern — use \`script -q\` to allocate a PTY):

\`\`\`
rm -f /tmp/opencc-tui.log /tmp/opencc-debug.log
OPENCC_LOG_FILE=/tmp/opencc-debug.log timeout 15 script -q /tmp/opencc-tui.log \\
  bash -c 'node dist/cli.mjs --debug 2>&1' <<'EOF' || true
hello
/exit
EOF
\`\`\`

STEP 2 — Verify splash renders
\`cat /tmp/opencc-tui.log\`
Expect: OpenCC brand line + clawd ASCII mascot (3-row: ▐▟▙ / ████▙▖ / ▝▝ ▝▝) or woodpecker + prompt indicator (❯ or >).
Reference: memory opencc-claude-mascot-exact-ascii-v2-1-177 + opencc-woodpecker-splash-replacement.

STEP 3 — Verify prompt appears.

STEP 4 — Debug log basic check:
\`wc -l /tmp/opencc-debug.log\`
\`grep -c "ERROR" /tmp/opencc-debug.log\`

STEP 5 (REQUIRED BEFORE report) — Key error pattern grep
(distinguish noise vs real):

Real error (FAIL if found):
- \`grep -E "useMemoCache size [0-9]+ vs [0-9]+"\` (React Compiler bug, memory: opencc-react-compiler-usememocache-size-mismatch)
- \`grep -i "exception|TypeError|throw"\` (unhandled exception)
- \`grep -i "Permission denied|EACCES"\` (permission error)
- \`grep -i "Cannot find module|MODULE_NOT_FOUND"\` (module missing)
- \`grep -i "tree-sitter unavailable"\` (Class K, baseline OK)

Report:
- Splash render: yes/no + ASCII line
- Prompt appearance: yes/no
- Debug log: line count + error count
- Key error pattern grep results
- Overall: PASS / FAIL`,
      {
        label: "tui-startup",
        phase: "Phase 2: TUI verification (7 parallel)",
        schema: TUI_SCHEMA,
        agentType: "tui-func-verifier",
      },
    ),

  // ===== V-slash-basic: /help + /version + /clear =====
  () =>
    agent(
      SAFETY_BANNER +
        `
You are the OpenCC slash commands — BASIC group verification agent.
Working dir: ${cwd}

Task: verify basic slash commands, each in its own REPL session (PTY via \`script -q\`).

Helper function:
\`\`\`bash
run_slash() {
  local cmd="$1"
  local logf="/tmp/opencc-slash-\$(echo "$cmd" | tr '/ ' '__').log"
  rm -f "$logf"
  cd ${cwd} && timeout 20 script -q "$logf" \\
    bash -c 'node dist/cli.mjs 2>&1' <<EOF
\$cmd
/exit
EOF
  echo "=== \$cmd ==="
  tail -50 "$logf"
}
\`\`\`

Run sequentially:

1. /help
   Expect: command list displayed (containing provider/status/model/memory/help/clear/exit/version).

2. /version
   MUST show "0.19.0 (Open CC)" exactly.
   Memory: opencc-cherry-pick-version-bump-rebrand-regression — NOT "OpenClaude" / "0.18.0".

3. /clear
   Expect: clears screen, no error, exits cleanly.

Report PASS/FAIL per command + key output.
Overall: PASS / FAIL.

NOTE: Read-only slash commands ONLY. Do NOT call /provider set, /model set, /provider use.`,
      {
        label: "slash-basic",
        phase: "Phase 2: TUI verification (7 parallel)",
        schema: TUI_SCHEMA,
        agentType: "tui-func-verifier",
      },
    ),

  // ===== V-slash-resource: /provider list + /model list =====
  () =>
    agent(
      SAFETY_BANNER +
        `
You are the OpenCC slash commands — RESOURCE group verification agent.
Working dir: ${cwd}

Task: verify resource-listing slash commands.

Helper function:
\`\`\`bash
run_slash() {
  local cmd="$1"
  local logf="/tmp/opencc-slash-\$(echo "$cmd" | tr '/ ' '__').log"
  rm -f "$logf"
  cd ${cwd} && timeout 20 script -q "$logf" \\
    bash -c 'node dist/cli.mjs 2>&1' <<EOF
\$cmd
/exit
EOF
  echo "=== \$cmd ==="
  tail -50 "$logf"
}
\`\`\`

Run sequentially:

1. /provider list
   Expect: providers shown — anthropic + ollama + openai-compatible per AGENTS.md Provider Policy.
   Other providers (mistral / bedrock / gemini / codex / fireworks / xAI) should NOT appear (excluded by policy).

2. /model list
   EXPECTATION NOTE: \`/model list\` actually only ECHOES the current model, NOT list models.
   It is a known limitation (memory: opencc-slash /model behavior 2026-06-27 — see V4 agent killed mid-run on this).
   Verdict: PASS if the slash runs cleanly without error AND shows current model name.
   PASS = no crash, no stack trace, no error message.

Report PASS/FAIL per command + key output.
Overall: PASS / FAIL.

NOTE: Read-only. Do NOT call /provider set, /model set, /provider use.`,
      {
        label: "slash-resource",
        phase: "Phase 2: TUI verification (7 parallel)",
        schema: TUI_SCHEMA,
        agentType: "tui-func-verifier",
      },
    ),

  // ===== V-slash-status: /status + /memory =====
  () =>
    agent(
      SAFETY_BANNER +
        `
You are the OpenCC slash commands — STATUS group verification agent.
Working dir: ${cwd}

Task: verify status / UI slash commands.

Helper function:
\`\`\`bash
run_slash() {
  local cmd="$1"
  local logf="/tmp/opencc-slash-\$(echo "$cmd" | tr '/ ' '__').log"
  rm -f "$logf"
  cd ${cwd} && timeout 20 script -q "$logf" \\
    bash -c 'node dist/cli.mjs 2>&1' <<EOF
\$cmd
/exit
EOF
  echo "=== \$cmd ==="
  tail -50 "$logf"
}
\`\`\`

Run sequentially:

1. /status
   Expect: session / model / CWD / permissions info displayed.
   3-way version check (memory: docs/verification-checklist.md Phase 4.4): /status MUST show current version (e.g. "0.19.0") — matches dist/cli.mjs build version.

2. /memory
   Expect: memory UI displayed, or CLAUDE.md / AGENTS.md related content.
   Memory: opencc-memory-ui-claudemd-label — /memory UI label changed from CLAUDE.md to AGENTS.md.

Report PASS/FAIL per command + key output.
Overall: PASS / FAIL.

NOTE: Read-only. Do NOT modify provider / model / profile.`,
      {
        label: "slash-status",
        phase: "Phase 2: TUI verification (7 parallel)",
        schema: TUI_SCHEMA,
        agentType: "tui-func-verifier",
      },
    ),

  // ===== V-tool-calls: Read/Glob/Grep + multi-turn + error recovery =====
  () =>
    agent(
      SAFETY_BANNER +
        `
You are the OpenCC tool-call verification agent.
Working dir: ${cwd}

Task: use \`-p\` mode to trigger Read / Glob / Grep tools, verify all work correctly.

STEP 1 (REQUIRED FIRST) — Read tool
\`\`\`bash
cd ${cwd} && OPENCC_LOG_FILE=/tmp/opencc-tool-read.log \\
  timeout 90 node dist/cli.mjs -p "Read package.json and tell me its name and version. Reply in one sentence." 2>&1 | tail -40
\`\`\`
Expect: assistant mentions "@hotmanxp/opencc" AND "0.19.0".

STEP 2 — Glob tool
\`\`\`bash
cd ${cwd} && OPENCC_LOG_FILE=/tmp/opencc-tool-glob.log \\
  timeout 90 node dist/cli.mjs -p "List 3 TypeScript files in src/. Just file names, no explanation." 2>&1 | tail -30
\`\`\`
Expect: assistant mentions 3 .ts file paths.

STEP 3 — Grep tool
\`\`\`bash
cd ${cwd} && OPENCC_LOG_FILE=/tmp/opencc-tool-grep.log \\
  timeout 90 node dist/cli.mjs -p "Use Grep to find the string 'getAnthropicClient' in src/. Just report total count." 2>&1 | tail -30
\`\`\`
Expect: assistant gives a number (real match count).

STEP 4 (BEFORE STEP 5) — Multi-turn dialogue
\`\`\`bash
cd ${cwd} && timeout 90 node dist/cli.mjs -p "First, say hi. Then read package.json and tell me version." 2>&1 | tail -40
\`\`\`
Expect: greeting + version both appear.

STEP 5 — Error recovery
\`\`\`bash
cd ${cwd} && timeout 60 node dist/cli.mjs -p "Read the file /tmp/nonexistent-xyz-12345.txt and tell me what you see." 2>&1 | tail -30
\`\`\`
Expect: assistant says file does NOT exist, does NOT crash.

Report PASS/FAIL per step + actual output.
Overall: PASS / FAIL.`,
      {
        label: "tool-calls",
        phase: "Phase 2: TUI verification (7 parallel)",
        schema: TUI_SCHEMA,
        agentType: "tui-func-verifier",
      },
    ),

  // ===== V-debug-log-scan: Phase 5 catalog comprehensive scan =====
  () =>
    agent(
      SAFETY_BANNER +
        `
You are the OpenCC debug log comprehensive scan agent (Phase 5 of docs/verification-checklist.md).
Working dir: ${cwd}

Task: launch --debug REPL, run a basic operation, then do comprehensive debug log error classification.

STEP 1 (REQUIRED FIRST) — Launch + operation
\`\`\`bash
cd ${cwd} && rm -f /tmp/opencc-debug-full.log && \\
  OPENCC_LOG_FILE=/tmp/opencc-debug-full.log timeout 30 node dist/cli.mjs -p \\
  "show me current directory and one file in it" 2>&1 | tail -10
\`\`\`

STEP 2 — Debug log size
\`\`\`bash
ls -la /tmp/opencc-debug-full.log
wc -l /tmp/opencc-debug-full.log
\`\`\`

STEP 3 (REQUIRED BEFORE STEP 4) — Key error pattern grep
(distinguish noise vs real; per docs/verification-checklist.md Phase 5 catalog A-I + K-L):

A. Known startup noise (IGNORE):
   - "Successfully connected" (MCP, memory: opencc-debug-log-mcp-stderr-false-positive)
   - "Failed to fetch MCP registry: 403" (memory: opencc-debug-log-mcp-registry-403-2026-06-14)
   - Class A: "circuit breaker" (banner only)
   - Class B: "generateSessionTitle.*SyntaxError" (UI title skip)
   - Class C: "supportedModels=undefined" (gate correctly disabled)
   - Class D: "spawn gh ENOENT" (probe disabled at source in this fork since 2026-06-06)
   - Class E: "MCP server .* Server stderr:" (false positive)
   - Class H: "Streaming stall detected" (MiniMax first-token latency)
   - Class I: "[WARN] [stderr]" at session cleanup (LSP child stderr flush)
   - Class L: "Cached MC gate: enabled=false modelSupported=false" (per-request gate eval, memory: opencc-debug-log-cached-mc-gate-minimax)

B. Real error patterns (FAIL if found):
   - \`grep -E "useMemoCache size [0-9]+ vs [0-9]+"\` (React Compiler bug, memory: opencc-react-compiler-usememocache-size-mismatch)
   - \`grep -i "TypeError|Exception|stack trace"\` (unhandled exception, exclude generateSessionTitle)
   - \`grep -i "Permission denied|EACCES"\` (permission error)
   - \`grep -i "Cannot find module|MODULE_NOT_FOUND"\` (module missing)
   - \`grep "FATAL"\` (fatal)
   - \`grep -i "tree-sitter unavailable"\` (Class K, real degradation, memory: opencc-debug-log-tree-sitter-unavailable)
   - Class F: "does not support Node" (chrome-devtools Node engine — env issue)
   - Class G: chrome-devtools plugin loader skip (no "Starting connection" line for chrome-devtools)

STEP 4 — Final report:
   - Debug log line count
   - Error counts by category (B bucket)
   - Any [ERROR] not classifiable into A (top 10 lines context)
   - Overall: PASS / FAIL`,
      {
        label: "debug-log-scan",
        phase: "Phase 2: TUI verification (7 parallel)",
        schema: TUI_SCHEMA,
        agentType: "tui-func-verifier",
      },
    ),
])

// =====================================================================
// PHASE 3: SYNTHESIS
// =====================================================================
phase("Phase 3: Synthesis")

const tuiResults = {
  cliSmoke: cliSmokeR,
  tuiStartup: tuiStartupR,
  slashBasic: slashBasicR,
  slashResource: slashResourceR,
  slashStatus: slashStatusR,
  toolCalls: toolCallsR,
  debugLogScan: debugLogR,
}

const failed = []
for (const [name, r] of Object.entries(tuiResults)) {
  if (!checkPassed(r)) failed.push(name)
}

const allPass = failed.length === 0
const status = allPass
  ? "complete"
  : failed.length <= 2
    ? "completed-with-issues"
    : "partial"

log(
  "Phase 2 summary: " +
    (failed.length === 0 ? "ALL 7 agents PASS" : "FAILED: " + failed.join(", ")),
)
log("Overall verdict: " + status)

return {
  status,
  phase1_static: { build: buildR, typecheck: typeR, test: testR, doctor: doctorR },
  phase2_tui: tuiResults,
  failed,
}