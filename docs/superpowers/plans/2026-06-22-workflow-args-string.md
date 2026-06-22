# Plan: workflow args 改为 string + runtime parse

**Date:** 2026-06-22
**Branch:** main-opencc (current HEAD `64982522`)
**Goal:** 把 `/<name> --key=value ...` 的 args 从 `string[]` 改成 `string`，runtime parse 成 object 注入 workflow 脚本；同时改 `/workflow` slash command 提示 LLM 读实际 workflow 脚本再传参。

---

## 1. 背景

**当前状态**（`createWorkflowCommand.ts:66`, `types.ts:346`）：
- 用户输入 `/<name> --name=ethan --word=hello`
- `args.trim().split(/\s+/)` 切成 `["--name=ethan", "--word=hello"]`
- WorkflowTool schema 接受 `args: z.array(z.string())`
- 注入到 workflow 脚本时是 `string[]`（用户脚本里要 `args[0].split('=')[1]` 手动解析，繁琐）

**目标状态**：
- 用户输入 `/<name> --name=ethan --word=hello`
- args 保留为 string（不再 split）
- WorkflowTool schema 改 `z.string()`，描述改为 "CLI-style args, e.g. `--name=ethan --word=hello`"
- **runtime 注入前**：parse string 成 object `{name: 'ethan', word: 'hello'}`，workflow 脚本里直接 `args.name` `args.word`

**为什么这样改**：
1. LLM 传参更直观——`args: "--name=ethan"` 比 `args: ["--name=ethan"]` 更易读
2. 用户脚本直接拿 object，不用自己 parse
3. 跟现有 `argparse`-style 工具链（git, docker, npm scripts）一致

---

## 2. 改动清单

### 2.1 Schema（`src/tools/WorkflowTool/types.ts:346`）

```typescript
// 改前
args: z.array(z.string()).default([]).describe('Positional args from /<name> invocation')

// 改后
args: z.string().default('').describe(
  'CLI-style args from /<name> invocation. ' +
  'Format: "--name=value --flag". ' +
  'Parsed to object at runtime before injecting into the workflow script. ' +
  'Use --key=value for string params, --key for boolean flags. ' +
  'Example: --name=ethan --word=hello --verbose'
)
```

### 2.2 Parser helper（新建 `src/tools/WorkflowTool/cliArgs.ts`）

```typescript
/**
 * Parse CLI-style args string into object.
 * "--name=ethan --word=hello --verbose" -> {name: 'ethan', word: 'hello', verbose: true}
 *
 * Rules:
 * - `--key=value` -> {key: value} (string)
 * - `--key` (no =) -> {key: true} (boolean)
 * - `--key="multi word"` -> {key: 'multi word'} (quoted strings)
 * - Empty/whitespace string -> {}
 * - Unknown flag prefix (-x or /x) -> ignored (warn in dev mode)
 */
export function parseCliArgs(input: string): Record<string, string | boolean> {
  // ...implementation
}
```

**Tests** (`cliArgs.test.ts`)：
- basic: `--name=ethan --word=hello` → `{name: 'ethan', word: 'hello'}`
- boolean flag: `--verbose` → `{verbose: true}`
- quoted: `--desc="hello world"` → `{desc: 'hello world'}`
- empty: `''` / `'   '` → `{}`
- mixed: `--name=ethan --verbose --word=hello` → `{name: 'ethan', verbose: true, word: 'hello'}`
- bad input: `/path --x` → `{}` (warn)

### 2.3 Runtime injection（`src/tools/WorkflowTool/generateScript.ts` 或 worker entry）

找到 **runtime 把 args 注入到 workflow 脚本** 的地方（grep `args` 在 `singleton.ts` / worker entry）。改：
```typescript
// 改前
const scriptArgs = args  // string[]

// 改后
const scriptArgs = parseCliArgs(args)  // Record<string, string | boolean>
```

**Prompt 同步改**（`generateScript.ts:23`）：
```typescript
// 改前
`The user passed: ${JSON.stringify(p.args ?? null)}`

// 改后
`The user passed CLI args: ${p.args || '(none)'}\n` +
`Parsed to object: ${JSON.stringify(parseCliArgs(p.args ?? ''))}`
```

Workflow 脚本生成时 prompt 明确告诉 LLM "你拿到的是 object，不是 string array"。

### 2.4 /workflow slash command（`src/commands/workflows/workflowCommand.ts` + `createWorkflowCommand.ts`）

**createWorkflowCommand.ts:66 改前**：
```typescript
const argList = args.trim() ? args.trim().split(/\s+/) : []
const argListJson = JSON.stringify(argList)
```

**改后**：
```typescript
const cliArgs = args.trim()  // 保留 string，不再 split
const cliArgsJson = JSON.stringify(cliArgs)
```

**Prompt 改前**：
```
The user typed /${name}. Run the workflow named "${name}" (from ${source}) with args ${argListJson}.
Use the WorkflowTool with input: workflowName: "${name}", args: ${argListJson}.
```

**改后**：
```
The user typed /${name}. Run the workflow named "${name}" (from ${source}).

# Step 1: Read the workflow's actual script before passing args
First, read the workflow's script file (find via the WorkflowTool's lookup or `find ~/.claude/workflow -name '${name}.js'`) to understand what parameters the script expects. The script receives an `args` object whose shape depends on the script's implementation — you cannot know the shape without reading the script.

# Step 2: Map the user's CLI input to the script's args
The user typed: ${cliArgsJson ? `\`${cliArgs}\`` : '(no args)'}
This is CLI-style input (e.g. "--name=ethan --word=hello --verbose"). The runtime will parse it to an object {name, word, verbose: true} before injecting into the script. Match the user's input to the parameter names the script actually expects.

# Step 3: Invoke the WorkflowTool
Use the WorkflowTool with input:
  workflowName: "${name}",
  args: ${cliArgsJson}  // pass the raw CLI string, not pre-parsed
  description: "<one-line summary>"

# Step 4: Surface the Run ID verbatim
The WorkflowTool result includes the Run ID in the form `(Run ID: wf_xxx)`. Paste it verbatim — the user correlates later results to the launch via this token.
```

**workflowCommand.ts 同样改**：保留 raw string，prompt 加 "Step 1: Read the workflow script" 段落。

### 2.5 Update existing test files

- `src/tools/WorkflowTool/types.test.ts` - update schema tests for `args: z.string()`
- `src/commands/workflows/workflowCommand.test.ts` - update argList → cliArgs expectations
- `src/tools/WorkflowTool/createWorkflowCommand.test.ts` - update argList → cliArgs

### 2.6 Verification

- [ ] `bun run typecheck` → 0 errors
- [ ] `bun run build` → OK
- [ ] `bun test src/tools/WorkflowTool/cliArgs.test.ts` → all pass
- [ ] `bun test src/tools/WorkflowTool/types.test.ts` → all pass
- [ ] `bun test src/commands/workflows/` → all pass
- [ ] Runtime 30s+ smoke: `node dist/cli.mjs --debug` 后台 30s 还活
- [ ] Manual E2E: `node dist/cli.mjs plugin list` shows 6.0.3 (no regression)
- [ ] LLM 端到端：起 REPL，调用一个 workflow，看 LLM 是否先 cat 脚本再传 args（看 debug log）

---

## 3. 范围外（不要做）

- 不改 `WorkflowRun` 类型（它追踪的 subagent runs 不变）
- 不改 `WorkerInbound` 的 `init` 消息格式（args 还是 string[] 在 worker 协议层，内部 parse 即可）
- 不改 `claudeMd` 或 plugin manifest 的 workflow 声明
- 不改 upstream 2.1.185 binary 的解析（这是 OpenCC 自己的 fork 改动）

---

## 4. 风险

| 风险 | 缓解 |
|---|---|
| 现有 workflow 脚本假设 args 是 string[] | 解析后 object 是 superset；脚本里 `args[0]` 拿到 undefined 但不会崩。先 grep 用户已有 .js 脚本，统计有没有用 string[] 方式访问 |
| LLM 传参习惯已经形成 `args: ['--name=ethan']` | prompt 明确 + 加 LLM 提示语 |
| test drift | 5 铁律 #1 runtime 验 + typecheck 必跑 |

---

## 5. 验收

1. `node dist/cli.mjs plugin list` 仍正常
2. `/<name> --name=ethan --word=hello` 触发 workflow 后，workflow 脚本里 `args.name === 'ethan'`, `args.word === 'hello'`
3. `/workflow` slash command 的 prompt 包含 "Read the workflow's actual script" 段落
4. 所有 typecheck/test 通过
5. Runtime 30s+ smoke 通过
