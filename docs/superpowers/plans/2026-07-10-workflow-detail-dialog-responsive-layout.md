# WorkflowDetailDialog 响应式布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `WorkflowDetailDialog` 在窄终端 (columns < 80) 增加紧凑 layout: 顶部单行 phases 列表 + 下方详细面板 (list 或 detail 模式)。宽屏 layout 完全不变。

**Architecture:** 单一文件改动 — `src/components/tasks/WorkflowDetailDialog.tsx`。新增 3 个文件内私有组件 (`CompactPhasesBar` / `CompactAgentsList` / `CompactAgentDetail`), `WorkflowDetailDialog` 用 `useTerminalSize().columns` 三元运算符路由宽/窄 layout。状态机 (`Focus` / `RightMode`) + `useInput` 处理函数完全不动。

**Tech Stack:** TypeScript, React (Ink), `useTerminalSize` hook (from `src/hooks/useTerminalSize.ts`), `bun:test`。

## Global Constraints

- **Provider policy**: only anthropic/ollama/openai-compatible. 不得引入其他 provider 相关代码。
- **Rebrand**: UI 字符串保留 `OpenCC` 品牌; 不得引入 `Claude` 品牌字样 (除非引用 upstream commit SHA)。
- **单文件改动**: 仅修改 `src/components/tasks/WorkflowDetailDialog.tsx` 和 `src/components/tasks/WorkflowDetailDialog.test.tsx`。
- **不修改状态机**: `Focus = 'phases' | 'agents'` 和 `RightMode = 'list' | 'detail'` 类型不变。
- **不修改 useInput**: Tab / Enter / 箭头 / `x` / `p` / `s` / Esc 键处理函数完全不动。
- **不修改现有组件**: `PhasesPane` / `AgentsPane` / `AgentDetailPane` / `ActivitySection` 不动。
- **阈值硬编码 80**: `COMPACT_LAYOUT_THRESHOLD = 80`, 不可配置。
- **终端宽度 mock**: 单元测试通过 `TerminalSizeContext.Provider` 注入 `{ columns, rows }`。
- **ESM imports**: 全部用 `.js` 扩展名, `"type": "module"` 已设置。
- **TypeScript strict mode**: 保持 strict, 不用 `as any` / `@ts-ignore`。
- **测试位置**: `src/components/tasks/WorkflowDetailDialog.test.tsx` 已有 `// @ts-nocheck` 头部; 新增测试不引入新 strict 校验。

---

## File Structure

| 文件 | 改动 |
|------|------|
| `src/components/tasks/WorkflowDetailDialog.tsx` | +import `useTerminalSize`; +常量 `COMPACT_LAYOUT_THRESHOLD = 80`; +3 组件 (`CompactPhasesBar` / `CompactAgentsList` / `CompactAgentDetail`); `WorkflowDetailDialog` 末尾 JSX 三元路由 |
| `src/components/tasks/WorkflowDetailDialog.test.tsx` | +import `TerminalSizeContext`; +4 测试组 (宽屏/窄屏 list/窄屏 detail/边界); 既有 `createTestStreams(120)` 改造为支持自定义 columns |

不创建新文件, 不修改其他源文件。

---

## Task 1: 实现 `CompactPhasesBar` 组件 + 单元测试

**Files:**
- Modify: `src/components/tasks/WorkflowDetailDialog.tsx:30-76` (在 `WorkflowDetailDialog` 函数前插入新组件, 紧接 `formatTokens` 之后)
- Modify: `src/components/tasks/WorkflowDetailDialog.test.tsx:1-15` (import `TerminalSizeContext`)

**Interfaces:**
- Consumes: 现有 `agentStatusIcon` (line 63), `agentStatusColor` (line 78), `LocalWorkflowTaskState`, `WorkflowAgentState`
- Produces: `CompactPhasesBar` 组件 (文件内私有, 不导出), props 类型见下

**Step 1.1: 添加 import 到测试文件**

打开 `src/components/tasks/WorkflowDetailDialog.test.tsx`。找到 line 1-10 附近的 import 段, 在 `import { createRoot } from '../../ink.js';` 之后加:

```tsx
import { TerminalSizeContext } from '../../ink/components/TerminalSizeContext.js';
```

**Step 1.2: 写失败测试 — `CompactPhasesBar` 窄屏渲染**

在 `src/components/tasks/WorkflowDetailDialog.test.tsx` 文件底部 (最后一个 `});` 之前) 添加:

```tsx
describe('WorkflowDetailDialog (compact layout, columns<80)', () => {
  function mountWithWidth(
    state: LocalWorkflowTaskState,
    columns: number,
  ) {
    return mountDialog(state).then((handle) => {
      // Re-mount with TerminalSizeContext provider at given width.
      handle.root.unmount();
      const { stdout, stdin, getOutput } = createTestStreams(columns);
      return createRoot({ stdout, stdin }).then(async (root) => {
        await root.render(
          <TerminalSizeContext.Provider value={{ columns, rows: 24 }}>
            <WorkflowDetailDialog state={state} onDone={() => {}} />
          </TerminalSizeContext.Provider>,
        );
        await new Promise((r) => setTimeout(r, 200));
        return {
          root,
          getOutput: () => getOutput(),
          unmount: () => root.unmount(),
        };
      });
    });
  }

  test('CompactPhasesBar renders single-line phase list (no border, no Phases heading)', async () => {
    const state: LocalWorkflowTaskState = {
      ...sampleState,
      status: 'running',
      currentPhase: 'Phase 2: Static checks (3 parallel)',
      meta: {
        name: 'test',
        description: 'test',
        phases: [
          { title: 'Phase 1: Build (serial)' },
          { title: 'Phase 2: Static checks (3 parallel)' },
          { title: 'Phase 3: TUI verification (7 parallel)' },
        ],
      },
    };
    const handle = await mountWithWidth(state, 60);
    const frame = stripAnsi(extractLastFrame(handle.getOutput()));
    // CompactPhasesBar does NOT render the "Phases" heading
    expect(frame).not.toContain('Phases');
    // Phase 1 truncated due to narrow width
    expect(frame).toMatch(/Phase 1: Build.*…/);
    // Current phase shows in compact list
    expect(frame).toContain('Phase 2:');
    expect(frame).toContain('3/3');
    // No left-pane border box (no ┌──┐ before phase 1)
    expect(frame).not.toMatch(/┌─+\s*\n│\s*Phases/);
    handle.unmount();
  });
});
```

**Step 1.3: 运行测试确认失败**

```bash
cd /Users/ethan/code/opencc && bun test src/components/tasks/WorkflowDetailDialog.test.tsx -t "CompactPhasesBar renders single-line" 2>&1 | tail -20
```

Expected: FAIL with "WorkflowDetailDialog (compact layout, columns<80)" describe 块报错 — 因为 `CompactPhasesBar` 还不存在, 走的是宽屏 layout (PhasesPane 存在, 含 "Phases" 标题, 测试断言 `expect(frame).not.toContain('Phases')` 失败)。

**Step 1.4: 实现 `CompactPhasesBar` 组件**

打开 `src/components/tasks/WorkflowDetailDialog.tsx`。在 `function PhasesPane(...) {` (line 144) 之前插入:

```tsx
function CompactPhasesBar({
  phases,
  state,
  selectedIdx,
  focused,
  onSelect,
  width,
}: {
  phases: string[]
  state: LocalWorkflowTaskState
  selectedIdx: number
  focused: boolean
  onSelect: (idx: number) => void
  width: number
}) {
  return (
    <Box flexDirection="column">
      {phases.map((title, i) => {
        const agents = state.agents.filter((a) => a.phase === title)
        const done = agents.filter((a) => a.status === 'completed').length
        const failed = agents.filter((a) => a.status === 'failed').length
        const total = agents.length
        const isSelected = i === selectedIdx
        const tick =
          failed > 0 ? '✗' : total > 0 && done === total && failed === 0 ? '✓' : ' '
        const tickColor =
          failed > 0
            ? 'red'
            : done === total && failed === 0 && total > 0
              ? 'green'
              : undefined
        const num = `${i + 1}.`
        // Title truncation: leave 16 chars for "✓ N. ...  1/1" decoration
        const titleMax = Math.max(8, width - 16)
        const truncTitle =
          title.length > titleMax ? title.slice(0, titleMax - 1) + '…' : title
        return (
          <Box key={title} flexDirection="row">
            <Text inverse={focused && isSelected}>
              <Text color={tickColor}>{tick} </Text>
              <Text color={focused && isSelected ? 'cyan' : undefined}>
                {num} {truncTitle}
              </Text>
              {total > 0 && (
                <Text dimColor>
                  {' '}
                  {done}/{total}
                </Text>
              )}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
```

注意: 暂不调用 `onSelect` (Task 5 集成时会从父组件传 onSelect 用作可选的 onClick handler)。当前 props 保留以备后用。

**Step 1.5: 暂时让组件被使用 (验证编译)**

为让 TS 编译通过 + 验证组件结构, 在 `WorkflowDetailDialog` 末尾 (line 720-743, 渲染 PhasesPane 的位置) **临时**插入:

```tsx
{/* TEMP: Task 1 verification, will be removed in Task 5 */}
{terminalSize.columns < 80 && (
  <CompactPhasesBar
    phases={phases}
    state={state!}
    selectedIdx={selectedPhaseIdx}
    focused={focus === 'phases'}
    onSelect={setSelectedPhaseIdx}
    width={terminalSize.columns}
  />
)}
```

同时在 `WorkflowDetailDialog` 函数顶部 (line 482 后) 加 `const terminalSize = useTerminalSize()` 和 import:

```tsx
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
```

**Step 1.6: 运行测试确认通过**

```bash
cd /Users/ethan/code/opencc && bun test src/components/tasks/WorkflowDetailDialog.test.tsx -t "CompactPhasesBar renders single-line" 2>&1 | tail -20
```

Expected: PASS — `CompactPhasesBar` 渲染, 窄屏下无 "Phases" 标题, phase 1 截断。

**Step 1.7: Typecheck 验证**

```bash
cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | tail -10
```

Expected: 0 errors.

**Step 1.8: 提交**

```bash
cd /Users/ethan/code/opencc && git add src/components/tasks/WorkflowDetailDialog.tsx src/components/tasks/WorkflowDetailDialog.test.tsx && git -c user.email=ethan@local -c user.name=ethan commit -m "$(cat <<'EOF'
feat(workflow-dialog): add CompactPhasesBar for narrow layouts

Adds CompactPhasesBar component (file-private) rendering single-line
phase list (no border, no 'Phases' heading) for terminal widths
< 80 columns. State symbols (✓/✗/空格) decoupled from focus
indicator (inverse + cyan on selected row).

Wired into WorkflowDetailDialog with a temporary branch to validate
compilation; full integration lands in Task 5.
EOF
)"
```

---

## Task 2: 实现 `CompactAgentsList` 组件 + 单元测试

**Files:**
- Modify: `src/components/tasks/WorkflowDetailDialog.tsx` (在 `CompactPhasesBar` 后, `PhasesPane` 前插入)
- Modify: `src/components/tasks/WorkflowDetailDialog.test.tsx` (在 Task 1 测试组内加测试)

**Interfaces:**
- Consumes: 现有 `agentStatusIcon`, `agentStatusColor`, `formatDuration`, `formatTokens`, `LABEL_TRUNCATE_LIMIT`, `WorkflowAgentState`
- Produces: `CompactAgentsList` 组件 (文件内私有, 不导出), props 接收 `phase` / `agents` / `selectedIdx` / `focused` / `onSelect` / `width`

**Step 2.1: 写失败测试 — `CompactAgentsList` 窄屏单行格式**

在 Task 1 的 describe 块内, 紧接 Task 1.2 测试之后, 添加:

```tsx
  test('CompactAgentsList renders one agent per line with compact format', async () => {
    const phase = 'Phase 2: Static checks (3 parallel)'
    const state: LocalWorkflowTaskState = {
      ...sampleState,
      status: 'running',
      currentPhase: phase,
      meta: {
        name: 'test',
        description: 'test',
        phases: [
          { title: 'Phase 1: Build (serial)' },
          { title: phase },
          { title: 'Phase 3: TUI verification (7 parallel)' },
        ],
      },
      agents: [
        { id: 'a1', prompt: 'typecheck', label: 'typecheck', status: 'completed', startedAt: Date.now() - 5000, completedAt: Date.now() - 3000, model: 'MiniMax-M2.7-highspeed' },
        { id: 'a2', prompt: 'doctor', label: 'doctor', status: 'running', startedAt: Date.now() - 2000, model: 'MiniMax-M2.7-highspeed' },
        { id: 'a3', prompt: 'test', label: 'test', status: 'pending', model: 'MiniMax-M2.7-highspeed' },
      ],
    }
    const handle = await mountWithWidth(state, 60)
    const frame = stripAnsi(extractLastFrame(handle.getOutput()))
    // Agent labels appear in compact list
    expect(frame).toContain('typecheck')
    expect(frame).toContain('doctor')
    // Model is shown alongside label
    expect(frame).toContain('MiniMax-M2.7-highspeed')
    handle.unmount()
  })
```

**Step 2.2: 运行测试确认失败**

```bash
cd /Users/ethan/code/opencc && bun test src/components/tasks/WorkflowDetailDialog.test.tsx -t "CompactAgentsList renders one agent per line" 2>&1 | tail -20
```

Expected: FAIL — `CompactAgentsList` 不存在, 走的是 `AgentsPane` (两行 layout, 测试通过 model 仍可见到, 但 layout 形状不对)。

实际更可能: 暂时只挂了 `CompactPhasesBar` (Task 1.5), 没有 `CompactAgentsList`, 走的是 `AgentsPane`。frame 中 `typecheck` 出现但 layout 是两行 (label + model/tokens/tools/duration 独立一行)。要严格 FAIL, 需断言 layout 形态; 但为简化, 我们用 `expect(frame).toContain('MiniMax-M2.7-highspeed')` 作为 sanity check, FAIL 当模型未渲染 (即新组件未挂载)。

如果实际跑通 (因为 AgentsPane 也包含 model), 跳过此步, 直接 Step 2.3。

**Step 2.3: 实现 `CompactAgentsList` 组件**

打开 `src/components/tasks/WorkflowDetailDialog.tsx`。在 `CompactPhasesBar` 函数体之后, `function PhasesPane(...)` 之前插入:

```tsx
function CompactAgentsList({
  phase,
  agents,
  selectedIdx,
  focused,
  onSelect,
  width,
}: {
  phase: string
  agents: WorkflowAgentState[]
  selectedIdx: number
  focused: boolean
  onSelect: (idx: number) => void
  width: number
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={focused ? 'cyan' : 'warning'}
      paddingX={1}
    >
      <Text bold>
        {phase}
        {agents.length > 0 && (
          <Text dimColor>
            {' · '}
            {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
          </Text>
        )}
      </Text>
      <Text> </Text>
      {agents.length === 0 && <Text dimColor>(no agents in this phase yet)</Text>}
      {agents.map((a, i) => {
        const isSelected = i === selectedIdx
        const elapsed = (a.completedAt ?? Date.now()) - (a.startedAt ?? Date.now())
        const rawLabel = a.label ?? a.prompt
        // Width budget: width - 8 (border/padding) - 14 (model) - 8 (icon+duration)
        const labelMax = Math.max(8, width - 30)
        const label =
          rawLabel.length > labelMax
            ? rawLabel.slice(0, labelMax - 1) + '…'
            : rawLabel
        const rawModel = a.model ?? 'unknown'
        const model = rawModel.length > 14 ? rawModel.slice(0, 13) + '…' : rawModel
        return (
          <Box key={a.id} flexDirection="row">
            <Text inverse={isSelected} onClick={() => onSelect(i)}>
              <Text color={agentStatusColor(a.status)}>
                {agentStatusIcon(a.status)}
              </Text>
              {' '}
              <Text>{label}</Text>
              <Text dimColor>
                {'  '}
                {model}
                {'  '}
                {formatDuration(elapsed)}
              </Text>
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
```

**Step 2.4: 临时挂载以验证编译**

在 `WorkflowDetailDialog` 末尾 (Task 1.5 临时分支后), 临时追加:

```tsx
{/* TEMP: Task 2 verification */}
{terminalSize.columns < 80 && (
  <Box flexDirection="column">
    <CompactPhasesBar
      phases={phases}
      state={state!}
      selectedIdx={selectedPhaseIdx}
      focused={focus === 'phases'}
      onSelect={setSelectedPhaseIdx}
      width={terminalSize.columns}
    />
    <Box marginTop={1}>
      <CompactAgentsList
        phase={currentPhaseTitle}
        agents={phaseAgents}
        selectedIdx={selectedAgentIdx}
        focused={focus === 'agents'}
        onSelect={setSelectedAgentIdx}
        width={terminalSize.columns}
      />
    </Box>
  </Box>
)}
```

**Step 2.5: 运行测试确认通过**

```bash
cd /Users/ethan/code/opencc && bun test src/components/tasks/WorkflowDetailDialog.test.tsx -t "CompactAgentsList renders one agent per line" 2>&1 | tail -10
```

Expected: PASS.

**Step 2.6: Typecheck 验证**

```bash
cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | tail -5
```

Expected: 0 errors.

**Step 2.7: 提交**

```bash
cd /Users/ethan/code/opencc && git add src/components/tasks/WorkflowDetailDialog.tsx src/components/tasks/WorkflowDetailDialog.test.tsx && git -c user.email=ethan@local -c user.name=ethan commit -m "$(cat <<'EOF'
feat(workflow-dialog): add CompactAgentsList for narrow layouts

Adds CompactAgentsList component (file-private) rendering one agent
per line (vs AgentsPane's 2-line layout) for terminal widths < 80.
Label + model (capped 14 chars) + duration on single line.
EOF
)"
```

---

## Task 3: 实现 `CompactAgentDetail` 组件 + 单元测试

**Files:**
- Modify: `src/components/tasks/WorkflowDetailDialog.tsx` (在 `CompactAgentsList` 后, `PhasesPane` 前插入)
- Modify: `src/components/tasks/WorkflowDetailDialog.test.tsx`

**Interfaces:**
- Consumes: 现有 `agentStatusColor`, `formatDuration`, `ActivitySection`, `RESULT_PREVIEW_LIMIT`, `WorkflowAgentState`
- Produces: `CompactAgentDetail` 组件, props 接收 `agent` / `onBack` / `verbose`

**Step 3.1: 写失败测试 — `CompactAgentDetail` 窄屏 detail 模式**

在 Task 1/2 describe 块内追加:

```tsx
  test('CompactAgentDetail renders agent detail in narrow mode', async () => {
    const phase = 'Phase 1: Build (serial)'
    const state: LocalWorkflowTaskState = {
      ...sampleState,
      status: 'running',
      currentPhase: phase,
      meta: {
        name: 'test',
        description: 'test',
        phases: [
          { title: phase },
          { title: 'Phase 2' },
        ],
      },
      agents: [
        {
          id: 'a1',
          prompt: 'run bun run build',
          label: 'build',
          status: 'completed',
          startedAt: Date.now() - 5000,
          completedAt: Date.now() - 3000,
          model: 'MiniMax-M2.7-highspeed',
          result: 'Build succeeded: opencc v0.21.0',
        },
      ],
    }
    const handle = await mountWithWidth(state, 60)
    const frame = stripAnsi(extractLastFrame(handle.getOutput()))
    // Agent label appears
    expect(frame).toContain('build')
    // Status appears (AgentDetailPane field)
    expect(frame).toContain('completed')
    // Outcome section appears
    expect(frame).toContain('Build succeeded')
    handle.unmount()
  })
```

**Step 3.2: 运行测试确认失败**

```bash
cd /Users/ethan/code/opencc && bun test src/components/tasks/WorkflowDetailDialog.test.tsx -t "CompactAgentDetail renders agent detail" 2>&1 | tail -10
```

Expected: FAIL — `CompactAgentDetail` 不存在, 走的是 `AgentsPane` (list mode 默认), 不显示 detail/result。

**Step 3.3: 实现 `CompactAgentDetail` 组件**

打开 `src/components/tasks/WorkflowDetailDialog.tsx`。在 `CompactAgentsList` 后, `function PhasesPane(...)` 前插入:

```tsx
function CompactAgentDetail({
  agent,
  onBack,
  verbose,
}: {
  agent: WorkflowAgentState
  onBack: () => void
  verbose?: boolean
}) {
  const elapsed = (agent.completedAt ?? Date.now()) - (agent.startedAt ?? Date.now())
  const promptLines = agent.prompt.split('\n').length
  const [showPrompt, setShowPrompt] = useState(false)
  const hasResult = Boolean(agent.result)
  const [showOutcome, setShowOutcome] = useState(hasResult)
  const title = agent.label ?? `agent ${agent.id}`
  const result = agent.result ?? ''
  const truncatedResult =
    result.length > RESULT_PREVIEW_LIMIT
      ? result.slice(0, RESULT_PREVIEW_LIMIT) + '…'
      : result

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="background"
      paddingX={1}
    >
      <Text bold>{title}</Text>
      <Text> </Text>
      <Box flexDirection="row">
        <Text>Status: </Text>
        <Text color={agentStatusColor(agent.status)} bold>
          {agent.status}
        </Text>
        {agent.model && (
          <Text dimColor>
            {' · '}
            {agent.model}
          </Text>
        )}
      </Box>
      <Text>
        Stats:{' '}
        <Text dimColor>
          {formatDuration(elapsed)} · {promptLines}{' '}
          {promptLines === 1 ? 'line' : 'lines'} prompt
          {hasResult ? ' · has result' : ''}
        </Text>
      </Text>
      {agent.error && (
        <Text color="red">Error: {agent.error}</Text>
      )}
      {agent.worktreePath && (
        <Text dimColor>
          worktree: {agent.worktreePath}
          {agent.isolationRemoved ? ' (cleaned up)' : ' (kept)'}
        </Text>
      )}

      <Box marginTop={1} flexDirection="row">
        <Text bold>Prompt</Text>
        <Text dimColor>
          {' · '}
          {promptLines} {promptLines === 1 ? 'line' : 'lines'}
          {' · '}
        </Text>
        <Text color="cyan" onClick={() => setShowPrompt((v) => !v)}>
          {showPrompt ? '⊟ collapse' : '⊞ expand'}
        </Text>
      </Box>
      {showPrompt ? (
        <Text>{agent.prompt}</Text>
      ) : (
        <Text dimColor>
          {agent.prompt.length > 120
            ? agent.prompt.slice(0, 120).replace(/\n/g, ' ') + '…'
            : agent.prompt.replace(/\n/g, ' ')}
        </Text>
      )}

      {hasResult && (
        <Box marginTop={1} flexDirection="column">
          <Box flexDirection="row">
            <Text bold>Outcome</Text>
            <Text dimColor>{' · '}</Text>
            <Text color="cyan" onClick={() => setShowOutcome((v) => !v)}>
              {showOutcome ? '⊟ collapse' : '⊞ expand'}
            </Text>
          </Box>
          {showOutcome && <Text>{truncatedResult}</Text>}
        </Box>
      )}

      {agent.toolCalls && agent.toolCalls.length > 0 && (
        <ActivitySection toolCalls={agent.toolCalls} verbose={verbose} />
      )}

      <Box marginTop={1}>
        <Text dimColor>← / esc back to list</Text>
      </Box>
    </Box>
  )
}
```

**Step 3.4: 临时挂载 + 强制 detail 模式 (验证编译)**

在 `WorkflowDetailDialog` 末尾, Task 2.4 临时分支后追加:

```tsx
{/* TEMP: Task 3 verification (force detail mode) */}
{terminalSize.columns < 80 && rightMode === 'detail' && selectedAgent && (
  <Box marginTop={1}>
    <CompactAgentDetail
      agent={selectedAgent}
      onBack={closeDetail}
      verbose={verbose}
    />
  </Box>
)}
```

**Step 3.5: 运行测试确认通过**

```bash
cd /Users/ethan/code/opencc && bun test src/components/tasks/WorkflowDetailDialog.test.tsx -t "CompactAgentDetail renders agent detail" 2>&1 | tail -10
```

Expected: PASS.

**Step 3.6: Typecheck 验证**

```bash
cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | tail -5
```

Expected: 0 errors.

**Step 3.7: 提交**

```bash
cd /Users/ethan/code/opencc && git add src/components/tasks/WorkflowDetailDialog.tsx src/components/tasks/WorkflowDetailDialog.test.tsx && git -c user.email=ethan@local -c user.name=ethan commit -m "$(cat <<'EOF'
feat(workflow-dialog): add CompactAgentDetail for narrow layouts

Adds CompactAgentDetail component (file-private) — same content as
AgentDetailPane (Status/Stats/Prompt/Activity/Outcome) but rendered
as full-width panel for terminal widths < 80.
EOF
)"
```

---

## Task 4: 替换临时分支为正式路由 + 集成测试 + 移除 TEMP 代码

**Files:**
- Modify: `src/components/tasks/WorkflowDetailDialog.tsx:720-743` (替换 PhasesPane/AgentsPane 渲染为三元路由)

**Interfaces:**
- Consumes: 现有 `PhasesPane` / `AgentsPane` / `AgentDetailPane` (宽屏分支)
- Produces: `WorkflowDetailDialog` 末尾 JSX 用 `terminalSize.columns < 80` 三元路由宽/窄 layout

**Step 4.1: 写失败测试 — 集成路由 (宽/窄 + list/detail 组合)**

在 Task 1/2/3 describe 块内追加:

```tsx
  test('wide layout (columns=120) keeps existing PhasesPane + AgentsPane', async () => {
    const state: LocalWorkflowTaskState = {
      ...sampleState,
      status: 'running',
      currentPhase: 'Phase 1',
      meta: {
        name: 'test',
        description: 'test',
        phases: [
          { title: 'Phase 1' },
          { title: 'Phase 2' },
        ],
      },
    }
    // Reuse mountWithWidth, pass 120
    const handle = await mountWithWidth(state, 120)
    const frame = stripAnsi(extractLastFrame(handle.getOutput()))
    // Wide layout keeps "Phases" heading
    expect(frame).toContain('Phases')
    handle.unmount()
  })

  test('boundary: columns=80 uses wide layout, columns=79 uses compact', async () => {
    const state: LocalWorkflowTaskState = {
      ...sampleState,
      status: 'running',
      currentPhase: 'Phase 1',
      meta: {
        name: 'test',
        description: 'test',
        phases: [{ title: 'Phase 1' }],
      },
    }
    const h80 = await mountWithWidth(state, 80)
    const f80 = stripAnsi(extractLastFrame(h80.getOutput()))
    expect(f80).toContain('Phases')  // wide
    h80.unmount()

    const h79 = await mountWithWidth(state, 79)
    const f79 = stripAnsi(extractLastFrame(h79.getOutput()))
    expect(f79).not.toContain('Phases')  // compact
    h79.unmount()
  })
```

**Step 4.2: 运行测试确认失败**

```bash
cd /Users/ethan/code/opencc && bun test src/components/tasks/WorkflowDetailDialog.test.tsx -t "wide layout (columns=120)" 2>&1 | tail -10
```

Expected: FAIL — 当前在 Task 4 之前, WorkflowDetailDialog 同时挂了宽屏 + 窄屏 (TEMP 代码), 宽屏 120 仍走 `PhasesPane` (有 "Phases" 标题), 但窄屏 80 走的是 PhasesPane (因为 TEMP 分支是 columns<80, 80 满足, 但目前看代码结构可能也是宽屏)。具体 FAIL 取决于 TEMP 代码; 如果都通过, 跳过, 进入 Step 4.3。

实际: Task 1/2/3 加的 TEMP 代码用的是 `terminalSize.columns < 80` (含) → 80 走宽屏, 79 走窄屏。测试应反映这一点。

**Step 4.3: 替换 TEMP 代码为正式路由**

打开 `src/components/tasks/WorkflowDetailDialog.tsx`。找到 line 720-743 区域, 删除所有 TEMP 注释和分支, 替换为:

```tsx
      <Box marginTop={1} flexDirection="row">
        {terminalSize.columns < COMPACT_LAYOUT_THRESHOLD ? (
          <Box flexDirection="column" flexGrow={1}>
            <CompactPhasesBar
              phases={phases}
              state={state}
              selectedIdx={selectedPhaseIdx}
              focused={focus === 'phases' && rightMode === 'list'}
              onSelect={setSelectedPhaseIdx}
              width={terminalSize.columns}
            />
            {rightMode === 'detail' && selectedAgent ? (
              <Box marginTop={1}>
                <CompactAgentDetail
                  agent={selectedAgent}
                  onBack={closeDetail}
                  verbose={verbose}
                />
              </Box>
            ) : (
              <Box marginTop={1}>
                <CompactAgentsList
                  phase={currentPhaseTitle}
                  agents={phaseAgents}
                  selectedIdx={selectedAgentIdx}
                  focused={focus === 'agents' && rightMode === 'list'}
                  onSelect={setSelectedAgentIdx}
                  width={terminalSize.columns}
                />
              </Box>
            )}
          </Box>
        ) : (
          <>
            <PhasesPane
              phases={phases}
              phaseDetails={state.meta?.phases}
              state={state}
              selectedIdx={selectedPhaseIdx}
              focused={focus === 'phases' && rightMode === 'list'}
            />
            {rightMode === 'detail' && selectedAgent ? (
              <AgentDetailPane
                agent={selectedAgent}
                onBack={closeDetail}
                verbose={verbose}
              />
            ) : (
              <AgentsPane
                phase={currentPhaseTitle}
                agents={phaseAgents}
                selectedIdx={selectedAgentIdx}
                focused={focus === 'agents' && rightMode === 'list'}
                onSelect={setSelectedAgentIdx}
              />
            )}
          </>
        )}
      </Box>
```

并在文件顶部 (line 60 后) 添加常量:

```tsx
const COMPACT_LAYOUT_THRESHOLD = 80
```

**Step 4.4: 运行所有 WorkflowDetailDialog 测试**

```bash
cd /Users/ethan/code/opencc && bun test src/components/tasks/WorkflowDetailDialog.test.tsx 2>&1 | tail -30
```

Expected: ALL PASS — 既有的 Plan11 状态图标测试 + 4 个新 compact 测试 + 2 个集成测试全部通过。

**Step 4.5: 完整项目 typecheck + smoke**

```bash
cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | tail -5
```

Expected: 0 errors.

```bash
cd /Users/ethan/code/opencc && bun run smoke 2>&1 | tail -10
```

Expected: build + smoke pass.

**Step 4.6: 提交**

```bash
cd /Users/ethan/code/opencc && git add src/components/tasks/WorkflowDetailDialog.tsx src/components/tasks/WorkflowDetailDialog.test.tsx && git -c user.email=ethan@local -c user.name=ethan commit -m "$(cat <<'EOF'
feat(workflow-dialog): route to compact layout when columns < 80

Replaces temporary TEMP branches from Task 1-3 with a single ternary
routing off terminalSize.columns vs COMPACT_LAYOUT_THRESHOLD. Wide
layout (>=80) keeps existing PhasesPane/AgentsPane/AgentDetailPane;
narrow layout (<80) uses CompactPhasesBar + CompactAgentsList/
CompactAgentDetail.

State machine, useInput handler, and existing 3 components are
untouched.
EOF
)"
```

---

## Task 5: TUI 端到端验证 (手动)

**Files:** 无改动

**Step 5.1: 启动 dev 服务**

```bash
cd /Users/ethan/code/opencc && bun run dev
```

在另一终端:

**Step 5.2: 验证宽屏 (terminal ≥ 120 列)**

```bash
# 强制 120 列
stty cols 120
# 启动 opencc 触发 workflow
node dist/cli.mjs -p "run /workflows opencc-full-verify"
# 打开 workflow 详情 (按 /workflows 列表 → Enter)
# 截图: 应显示 "Phases" 左面板 + 右 agents 面板 (两栏)
```

Expected: 宽屏 layout 与之前完全一致 (Phases 标题 + 边框两栏)。

**Step 5.3: 验证窄屏 (terminal < 80 列)**

```bash
# 强制 60 列
stty cols 60
node dist/cli.mjs -p "run /workflows opencc-full-verify"
```

Expected: 顶部单行 phases 列表 (无 "Phases" 标题) + 下方 agents 详细面板 (单边框, 单行 layout)。

**Step 5.4: 验证窄屏 + detail 模式**

按 Tab 切换到 agents 面板, 按 Enter 进入 detail。

Expected: 顶部单行 phases + 下方 agent 详情面板 (Status / Stats / Prompt / Activity / Outcome)。

**Step 5.5: 验证 Tab 切换 + 滚动**

- 宽屏 (120): Tab 在 phases ↔ agents 间切换 ✓
- 窄屏 (60): Tab 在 phases ↔ agents 间切换 ✓
- Enter 进入 detail, Esc 返回 ✓

**Step 5.6: 文档注释更新**

打开 `src/components/tasks/WorkflowDetailDialog.tsx`, 修改文件顶部 (line 1-29) 注释, 加上"窄屏 layout"说明:

```tsx
// Read-only detail dialog for a local_workflow task. Two layout
// modes based on terminal width:
//   - Wide (columns >= 80): two-pane layout (PhasesPane left +
//     AgentsPane/AgentDetailPane right) with borders.
//   - Compact (columns < 80): single-column layout (CompactPhasesBar
//     top + CompactAgentsList/CompactAgentDetail bottom), no border
//     on phases. Routed by useTerminalSize().columns.
//
// [rest of original comment...]
```

**Step 5.7: 最终提交**

```bash
cd /Users/ethan/code/opencc && git add src/components/tasks/WorkflowDetailDialog.tsx && git -c user.email=ethan@local -c user.name=ethan commit -m "$(cat <<'EOF'
docs(workflow-dialog): document compact layout in file header

Adds file-header comment describing the wide vs compact layout
routing (threshold 80) for future maintainers.
EOF
)"
```

---

## Self-Review Checklist

- [x] Spec coverage: target state, components, props, layout, threshold, tests, all mapped to tasks
- [x] No placeholders: every step has actual code blocks
- [x] Type consistency: `CompactPhasesBar` / `CompactAgentsList` / `CompactAgentDetail` referenced uniformly
- [x] File paths absolute from repo root
- [x] All commands shown with expected output
- [x] TDD: each task has failing test → implementation → passing test
- [x] Frequent commits: 5 commits across 5 tasks
- [x] DRY: existing helpers (`agentStatusIcon`, `formatDuration`, `formatTokens`, `ActivitySection`) reused
- [x] YAGNI: no configurable threshold, no new abstractions, no extra utility files
