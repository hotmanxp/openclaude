# E3 复现物存档

> **来源**：四家选手在 `/tmp/bughunt-<agent>/` 下留下的复现脚本与运行日志，以及裁判自己的验证脚本 `/tmp/judge-verify/`。
> **入库存档时间**：2026-10-06（`/tmp` 会被系统清理，此目录是该批证据的唯一长期副本）

## 目录

| 子目录 | 来源 | 内容 |
|---|---|---|
| `claude-code/` | `/tmp/bughunt-claude-code/` | 55 个探针脚本 + 26 份日志 |
| `opencc/` | `/tmp/bughunt-opencc/` | 26 个复现脚本 + 23 份日志 |
| `trae-code/` | `/tmp/bughunt-trae-code/` | 6 个复现脚本 + 5 份日志 |
| `workbuddy/` | `/tmp/bughunt-workbuddy/` | 8 个复现脚本 + 4 份日志 |
| `judge-verify/` | `/tmp/judge-verify/` | 裁判复核 36 条声明时自建的 31 个脚本 + 11 份日志 |

## 入库规则

只保留**手写的**内容：

- 复现脚本（`*.mjs` / `*.ts` / `*.py` / `*.js`）
- 运行日志（`*.log`）、基线快照（`head.txt` / `status-before.txt` / `typecheck-baseline.log`）
- 手写 fixture：`opencc-mod.json`、围栏外的诱饵文件（`secret.txt` / `outside.txt`）

**未保留**的是运行时生成物——探针自己 `mkdir` 出来的 200+ 个文件（`scantest/file-*.md` ×50、`memdirtest/.facts/*`、`probe-tasks/cfg*` 等）。它们由脚本在运行时重建，入库只会污染 diff。

两个 1.5MB 的压舱文件 `outside.mjs` / `outside2.mjs` 也未保留：`probe-symlink-fence.mjs` 第 12 行自己 `writeFile` 生成它们。

## 跑法

脚本内的路径**仍是当时的 `/tmp/bughunt-*` 绝对路径**，这是**故意的**——保持与原始运行完全一致，避免事后改动让证据失真。多数脚本自带 `mkdir` 引导，可直接重跑：

```bash
cd /Users/ethan/code/opencc

# tc-001（P0）：符号链接写穿授权围栏
bun docs/bugs/bug-hunt-game-10-06/repros/trae-code/repro-fs-symlink.ts
# → REPRODUCED: write escaped the fence

# cc-011（P0）：转录永久静默丢失
bun docs/bugs/bug-hunt-game-10-06/repros/claude-code/probe-transcript/probe-lost-transcript.ts
# → contains "TURN TWO" : false   ← 用户的第二轮对话永久消失
```

依赖真实仓库源码的脚本（如 `probe-symlink-fence.mjs` 直接 import `src/mods/validate.ts`）需要仓库根的 `node_modules`，且脚本内写的是 `/Users/ethan/code/opencc/...` 绝对路径——在本机可直接运行，换机器需改路径。

**验证本仓库行为时不要用 PATH 上的 `opencc`**，它指向 `opencc-release` 的旧构建。显式路径：

```bash
node /Users/ethan/code/opencc/dist/cli.mjs
```

## 已知失效的探针

- `workbuddy/repro-render-cache.ts` 附带的 `toUpperCase` 对照组是失效的：`renderTap` 的 LRU 是模块级的，`cache.get('hello')` 命中了上一段的陈旧条目，后半段实验根本没跑。**它当场在注释里写下了矛盾的输出却没回头修。** 该探针产出的最高分发现 `wb-r01` 结论本身成立（裁判三重独立验证 + 修正后的 `review-extra-double-render-fixed.ts` 复现），但请勿引用其原始证据块。
- `opencc/repro-pane-leak.ts`、`repro-pane-leak2.ts`、`judge-verify/probe3.ts`、`probe4.ts`、`probe9.ts` 依赖预置的 mod fixture 目录（`fake-mods/`、`fake-mods2/`、`esm2/`），这些 fixture 已随脚本一并入库。

## 危险操作提示

多个探针会 `chmod 0444` 真实文件、对目标路径跑 `rm -rf`、或在**本仓库工作区**内创建符号链接。运行前请确认在干净的工作树上操作。