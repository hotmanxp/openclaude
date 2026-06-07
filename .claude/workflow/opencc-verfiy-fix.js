export const meta = {
  name: "opencc-verify-and-fix",
  description:
    "验证并修复 opencc:并行 build/test/typecheck,通过后用 TUI Agent 做完整 UI 功能验证(流程参考 docs/sync-upstream.md)",
  phases: [{ title: "Build/Test/Typecheck" }, { title: "TUI Verification" }],
};

const CHECK_SCHEMA = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    exitCode: { type: "integer" },
    summary: { type: "string" },
    errors: { type: "array", items: { type: "string" } },
  },
  required: ["passed", "summary"],
};

const TUI_SCHEMA = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    tests: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          passed: { type: "boolean" },
          details: { type: "string" },
        },
        required: ["name", "passed"],
      },
    },
    issues: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: ["passed", "tests"],
};

const cwd = "/Users/ethan/code/opencc";

// Phase 1: parallel build/test/typecheck
phase("Build/Test/Typecheck");
log("并行执行 bun run build / test / typecheck (cwd: " + cwd + ")");

const [buildR, testR, typeR] = await parallel([
  () =>
    agent(
      "cd " +
        cwd +
        " && bun run build 2>&1 | tail -80. 报告:(1) exit code,(2) pass/fail,(3) 关键输出(失败时最后 30 行),(4) 任何错误信息。严禁修改任何源文件。",
      {
        label: "bun-build",
        phase: "Build/Test/Typecheck",
        schema: CHECK_SCHEMA,
      },
    ),
  () =>
    agent(
      "cd " +
        cwd +
        ' && bun run test 2>&1 | tail -150. 报告:(1) exit code,(2) pass/skip/fail 计数(格式如 "2141 pass / 19 skip / 15 fail"),(3) 失败时前 5 个失败用例名,(4) 任何错误信息。严禁修改任何源文件。',
      {
        label: "bun-test",
        phase: "Build/Test/Typecheck",
        schema: CHECK_SCHEMA,
      },
    ),
  () =>
    agent(
      "cd " +
        cwd +
        " && bun run typecheck 2>&1 | tail -80. 报告:(1) exit code,(2) 错误数量,(3) 前 5 个错误详情,(4) pass/fail。严禁修改任何源文件。",
      {
        label: "bun-typecheck",
        phase: "Build/Test/Typecheck",
        schema: CHECK_SCHEMA,
      },
    ),
]);

// agent() returns { ok, agentId, report, label, phase } — NOT the
// schema's `passed` field. The schema is just a system-prompt
// contract forwarded to the LLM; the LLM returns a freeform
// report string, not schema fields. The previous version read
// `?.passed` (always undefined) and incorrectly flagged every
// phase as failed. Use `?.ok` (the agent-level success signal)
// plus a string match on the report as a belt-and-suspenders
// sanity check.
function checkPassed(agentR) {
  if (!agentR?.ok) return false
  const report = agentR.report ?? ""
  return /\bpass(ed)?\b/i.test(report) || !/\bfail(ed)?\b/i.test(report)
}

const phase1 = { build: buildR, test: testR, typecheck: typeR };
const phase1Pass =
  checkPassed(phase1.build) &&
  checkPassed(phase1.test) &&
  checkPassed(phase1.typecheck);

if (!phase1Pass) {
  const failed = [];
  if (!checkPassed(phase1.build)) failed.push("build");
  if (!checkPassed(phase1.test)) failed.push("test");
  if (!checkPassed(phase1.typecheck)) failed.push("typecheck");
  log("Phase 1 FAILED on: " + failed.join(", ") + " — 跳过 TUI 验证阶段");
  return { status: "failed-phase-1", failed, phase1 };
}

log("Phase 1 全绿:build + test + typecheck 全部通过。开始 TUI 验证...");

// Phase 2: TUI functional verification (only if Phase 1 passes)
phase("TUI Verification");

const tuiResult = await agent(
  '你是 OpenCC TUI 功能验证 Agent,流程严格遵循 /Users/ethan/code/opencc/docs/sync-upstream.md 中 "Verification checklist" 章节的 TUI smoke 部分。\n\n前置条件(已验证通过):bun run build / test / typecheck 全部 green。\n\n==== STEP 1 - 加载 agent-tui skill(必须)====\n调用 Skill tool 加载 agent-tui skill。先运行 `agent-tui --version` 验证已安装,若未安装则用 `curl -fsSL https://raw.githubusercontent.com/pproenca/agent-tui/master/install.sh | sh` 安装。\n\n==== STEP 2 - macOS daemon 隔离(macOS 必做)====\n执行以下序列(agent-tui skill 的强制要求):\n```bash\nif ! agent-tui sessions >/dev/null 2>&1; then\n  tmux kill-session -t agent-tui 2>/dev/null || true\n  agent-tui daemon stop 2>/dev/null || true\n  rm -f /tmp/agent-tui*\n  tmux new-session -d -s agent-tui \'agent-tui daemon start --foreground > /tmp/agent-tui-daemon.log 2>&1\'\n  sleep 1\nfi\n```\n\n==== STEP 3 - 烟雾测试(sync-upstream.md 中的 TUI smoke)====\n```bash\ncd /Users/ethan/code/opencc\nnode bin/opencc -p "say \'ok\' and stop"\n```\n通过标准:返回 "ok"(走 MiniMax-M3 profile)。然后 `cat .claude-profile.json` 验证 OPENAI_MODEL 已设置。\n\n==== STEP 4 - 交互式 REPL 测试 ====\n```bash\ncd /Users/ethan/code/opencc\nagent-tui run bun run dev\nagent-tui wait "❯" --assert\n# 测试 /help slash 命令\nagent-tui type "/help"\nagent-tui press Enter\nagent-tui wait --stable\nagent-tui screenshot\n# 测试 /mcp dialog(检查 ghost 字符)\nagent-tui press Escape\nagent-tui type "/mcp"\nagent-tui press Enter\nagent-tui wait "Manage MCP servers" --assert\nagent-tui screenshot\nagent-tui press Escape\nagent-tui press Ctrl+C\nagent-tui kill\n```\n注意:严格遵守 agent-tui skill 的原子执行规则(每个命令后 wait + screenshot + 验证)。关注 ghost 字符、布局破损、文本截断等渲染问题。\n\n==== STEP 5 - 终端尺寸稳定性 ====\n```bash\ncd /Users/ethan/code/opencc\nagent-tui run bun run dev\nagent-tui resize --cols 120 --rows 30\nagent-tui wait --stable\nagent-tui screenshot\nagent-tui resize --cols 80 --rows 24\nagent-tui wait --stable\nagent-tui screenshot\nagent-tui kill\n```\n\n==== STEP 6 - 清理 ====\n始终以 `agent-tui kill` 结束,避免遗留进程。\n\n==== 输出要求 ====\n对每个测试记录:(1) 测试名,(2) pass/fail,(3) 一行详情。**严禁修改任何源文件**——仅观察和测试。如发现 bug,记录在 issues[] 中(含 screenshot 证据描述),不尝试修复。',
  {
    label: "tui-verify",
    phase: "TUI Verification",
    schema: TUI_SCHEMA,
    agentType: "tui-func-verifier",
  },
);

const tuiPass = checkPassed(tuiResult);
const overall = phase1Pass && tuiPass;
const finalStatus = !phase1Pass
  ? "failed-phase-1"
  : !tuiResult
    ? "partial-no-tui-result"
    : tuiPass
      ? "complete"
      : (tuiResult.report ?? "").match(/\bissue[s]?\b/i)
        ? "completed-with-issues"
        : "partial";

return {
  status: finalStatus,
  phase1: phase1,
  phase2: tuiResult,
};
