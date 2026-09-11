---
name: sync-upperstream-opencc
description: "Sync upstream opencc latest version to local project (src/ + scripts/, on main)"
argument-hint:
  - <optional_notes>
---

# Sync Upstream OpenCC

在当前 **main** 分支上同步上游 opencc 最新版本。**只覆盖 `src/` 和 `scripts/`**，不创建任何分支。

## 流程

### Step 0: 确认在 main 上 + 预 stash

```bash
git branch --show-current
```

必须是 `main`，否则停下问用户。

按 `feedback/sync-presync-stash.md` 经验，开 sync 前先 stash main 上未提交修改：

```bash
git stash push -u -m "pre-sync-$(date +%Y%m%d-%H%M%S)" || true
```

如果 stash 失败或没有需要 stash 的东西，继续；不要因为 stash 卡住 sync。

### Step 1: 执行解压 + 品牌名替换脚本

```bash
cd .agent_working_dir/sync-uperstream && ./update.sh
```

脚本会：
- 解压 zip 到 `opencc-extract/<INNER_DIR>/`
- 把 `@hotmanxp/opencc` 替换为 `@zn-ai/opencc`
- **只 `cp -rf "$INNER_DIR/src" "$INNER_DIR/scripts" "$PROJECT_ROOT/"`**（2026-07-02 起改：之前 `cp -rf "$INNER_DIR"/*` 会拷全量造成污染）

记下脚本输出的 `INNER_DIR` 路径。

### Step 2: 只覆盖 src/ 和 scripts/

`update.sh` 已经只 copy `src/` + `scripts/`，但保留 rsync + cleanup 作为防御网（防止脚本回归 cp 全部）：

```bash
INNER_DIR="$(find .agent_working_dir/sync-uperstream/opencc-extract -maxdepth 1 -type d ! -name 'opencc-extract' ! -name '__MACOSX' | head -n 1)"

# 把 src/ + scripts/ 同步进项目
rsync -a --include='/' --include='src/***' --include='scripts/***' --exclude='*' "$INNER_DIR/" ./

# 还原脚本 cp 步骤带过来的非 src/ + 非 scripts/ 改动（tracked）
git checkout -- . ':(exclude)src' ':(exclude)src/**' ':(exclude)scripts' ':(exclude)scripts/**' || true

# 清理脚本 cp 步骤带过来的非 src/ + 非 scripts/ 新文件（untracked）
git clean -fd -- ':(exclude)src' ':(exclude)src/**' ':(exclude)scripts' ':(exclude)scripts/**' || true
```

执行后 `git status` **必须** 100% 都在 `src/` 和 `scripts/` 下。如果发现非这两个目录的变更，**停下**让用户决定。

### Step 3: 🛑 停下来让用户审查

**绝对不要**继续 commit / cherry-pick / test。停下，把以下信息汇报给用户：

1. `git status --short` 的变更文件清单（必须 100% 在 `src/` 和 `scripts/` 下）
2. `git diff --stat` 的体量（`+/−` 行数）
3. 上游版本信息（如能从 zip 名 / INNER_DIR 推断）
4. 提示用户：「请 review 变更。我等你的 OK，然后再做 reviewer 第一道 review。」

等用户**明确回复 OK** 后才进入 Step 4。

### Step 4: Reviewer 第一道 review（agent 跑）

用户 OK 后，派一个 `general-purpose` subagent 走 `git diff` 做 code review。**显式边界**：

- ✅ 只做 review，**不要 commit、不要 typecheck、不要 test、不要 push**
- ✅ 检查：与本地 hot zone（`src/api/`、`src/components/`、`src/services/`、providers、openaiShim parallel impls、SDK_ONLY_EXTERNALS）的语义冲突
- ✅ 检查：上游已删文件是否在本地下游仍被引用
- ✅ 检查：与 `team/sync-workflow.md` / `team/opencc-upstream-sync-fix.md` / `team/opencc-dep-migration-methodology.md` 已记录的历史冲突点对照
- ✅ 检查：brand 替换是否完整（残留 `@hotmanxp/opencc` 报错）
- ❌ 不要主动 fix；只输出报告
- ❌ 不要主动跑 build / bun test

把 reviewer 报告原样贴给用户。

### Step 5: 🛑 用户做最终 review（第二道）

Reviewer 出报告后，**再次停下**。让用户做最终 review（这就是第二道）。**不要**在用户说 OK 之前走 typecheck / test / commit。

如果 reviewer 报告里有问题，等用户拍板：
- 接受 reviewer 建议 → 改源码
- 拒绝 / 接受风险 → 标记已知问题继续
- cherry-pick 冲突（罕见，因为是直接覆盖）→ 让用户手动解决

### Step 6: 构建 + 测试（用户拍板后）

用户最终 review OK 后才执行：

```bash
bun run typecheck
bun test
```

全过后再走 Step 7。如果有 fail，**停下**汇报，不自动修。

### Step 7: 提交

用户**明确**说「提交」才执行：

```bash
git add -A
git commit -m "HRMSV3-ZN-WEBSITE#668 sync(upperstream opencc): 同步官方最新 opencc 更新（src/ only）"
```

记录 commit hash 报给用户。**不要 push**（`feedback_no_push_ask.md`：OpenCC 本地仓库）。

如果 Step 0 有 stash，**提示**用户：

```bash
git stash list
```

让用户决定何时 pop（避免外部 hook 静默 reset 撞 stash）。

## 注意事项

- **不创建任何分支**，全部在当前 main 上
- **只覆盖 `src/` 和 `scripts/`**；其它目录的变更必须清掉
- **两道 review 都要停下等用户**，不能合并
- Reviewer agent 显式 `do not commit / typecheck / test / push`
- 冲突不要自己处理，等用户拍板
- 提交信息格式：`HRMSV3-ZN-WEBSITE#668 sync(upperstream commit): 同步官方最新提交`
- `dist/` 是 generated，不进 commit（`AGENTS.md` 规则 6）
- **build 不是 Step 6 必跑项**（typecheck + bun test 是）；sync 完后跑 `bun run build` 经常需要修 `scripts/externals.ts`（sync 引入 60+ INTENTIONALLY_BUNDLED 项，但 OpenCC 本地 package.json 没装；处理流程见下方的「Post-sync build 修复」章节）
- **Post-sync build 修复模式**（2026-07-02 起发现）：
  1. `bun run build` 报 `validate-externals.ts` 错
  2. 删 `INTENTIONALLY_BUNDLED` 里 OpenCC 本地 package.json 完全没装的包（transitive deps / upstream-only 删了）
  3. 加 `ajv-formats` / `asciichart` / `ink` 等 runtime 必要包到 `INTENTIONALLY_BUNDLED`
  4. 加 8 个 devDeps test/build 工具到 `INTENTIONALLY_BUNDLED`（`@testing-library/react-hooks` / `@types/bun` / `@types/node` / `@types/react` / `react-devtools-core` / `react-test-renderer` / `tsx` / `typescript`）
  5. 改 `scripts/validate-externals.ts` 让 `allDeps` 集合也包含 `devDependencies`
  6. commit `HRMSV3-ZN-WEBSITE#668 fix(scripts): externals.ts 反映本地 package.json + validate 看 devDeps`

$ARGUMENTS
