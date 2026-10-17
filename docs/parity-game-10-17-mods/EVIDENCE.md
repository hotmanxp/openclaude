# 赛题资料包 · 取证方法与已知陷阱

> **本文件对两名选手完全对称。** 规则见 [`README.md`](./README.md)。
> **这里给的是「怎么找」，不是「找到了什么」。** 本文件**不含任何差距结论**——那是你要交的东西。

---

## 一、上游：权威 d.ts（**裁判已提取，双方直接读**）

### 1.1 位置

```
~/source/claude-2.1.302/types/claude-code-2.1.302.d.ts
```

**16,699 行 / 637 KB**，首行 `// Written by Claude Code 2.1.302.`

这份 d.ts 在 2.1.302 的发布目录里**默认不存在**——它由引擎在 `plugin-authoring` 技能加载时写出，内容以 zstd 压缩资源 `claude-code.d.ts-a75b5762.txt.zst` 内嵌在 SFX 二进制里。裁判已经把它切出来放好了。**你不需要重复提取。**

### 1.2 为什么以它为准

它是**官方签名的发布产物**，逐个事件的 input/result、每个 noun 与 `$` 方法（含文档注释与示例）、每个 element 的 props 全在里面。其它来源都不可靠：

| 来源 | 问题 |
|---|---|
| npm 的 `@anthropic-ai/claude-code` | 只带 `sdk-tools.d.ts`（SDK 工具类型），**不含 mod 协议** |
| GitHub `anthropics/claude-code` 的 `mods/types/claude-code.d.ts` | 首行版本号**落后于二进制** |
| 第三方转录本 | 系统性漏事件 |

**凡「某个事件查不到契约」，先怀疑来源版本不对，再怀疑事件不存在。**

### 1.3 ⚠️ 一个会误导你的数字

2.1.296 的 d.ts 是 **21,260 行**，2.1.302 是 **16,699 行**——**变小了**。

这不代表上游能力面缩小了。运行时有两份声明：`coreDeclarationsOf(版本)` 产出核心声明，`pluginDeclarationsOf(版本, 插件)` 会**再追加该插件自己的声明**。落在磁盘上的那份可能经过追加。

**因此：不要用「行数变少」推断任何能力被移除。** 判断一个能力在不在，只看它**在这一版的 d.ts 里有没有条目**。

---

## 二、上游：怎么读 bundle

### 2.1 目录里有什么

```
~/source/claude-2.1.302/
├── bundle.js      45 MB，压缩后的全部 JS
├── modules/       2451 个切片，bundle.js 按模块边界切出来的
├── index.json     模块索引（分类 + 代表字符串）
├── strings.json   字符串索引
├── assets/        提取产物 + 载荷偏移表（PAYLOADS.json）
└── types/         裁判补的 d.ts
```

### 2.2 检索姿势

压缩后标识符全是单字母，**字符串字面量是唯一可靠线索**。典型做法：

```bash
# 在 bundle 里按字符串定位，拿字节偏移当坐标
python3 -c "
s=open('/Users/ethan/source/claude-2.1.302/bundle.js',encoding='utf-8',errors='replace').read()
i=s.find('<你的特征串>')
print('offset',i); print(s[max(0,i-300):i+300])"
```

坐标写作 `bundle.js@<字节偏移>`。

### 2.3 别把压缩函数名当标识

**不同版本的 minified 字母是同一套表里的不同名字。** 拿某个函数名跨版本做正则，会静默返回 0 条而不报错。**跨版本只比字符串。**

### 2.4 别信 index.json 的分类

它开头自己写着「**基于字符串字面量关键词自动分类，未经人工校验**」。当检索入口可以，当结论不行。

---

## 三、上游：跑真二进制拿 V3 证据

```
~/source/claude-2.1.302/bin/claude      # 256 MB，实测 --version 报 2.1.302
```

这是**平台包** `@anthropic-ai/claude-code-darwin-arm64@2.1.302` 里的原始二进制，裁判为这场比赛放好的，**只读**。

它让你能把「上游有这个能力」从静态推断升级为实跑。**V3 证据的上游侧优先走这条路**（§8.2 的 `V3 = 1.0`）。

注意事项：

- 它是**完整的 Claude Code**，不是测试桩。跑任何东西都可能碰你的账号、你的 `~/.claude`、你的 token。**要跑就在一个干净的临时目录里跑，别在 `/Users/ethan/code` 下跑。**
- 需要登录态才能跑完整流程。只跑 `--help` / `--version` / 加载类命令不需要。
- 二进制别改、别删——**它是本场双方共用的资料**，删了等于毁掉对手的取证条件（按 §10 判违规）。

---

## 四、下游：opencc 侧的取证环境

### 4.1 入口在哪

| 要查的东西 | 从哪开始 |
|---|---|
| 事件声明表 | `src/mods/protocol.ts`（`MOD_ENGINE_EVENTS` / `MOD_OP_EVENTS`） |
| `$` 能力面 | `src/mods/nouns.ts` |
| dispatch 与 tier 链 | `src/mods/dispatch.ts` |
| 加载与沙箱 | `src/mods/loader` 相关、`src/mods/manifest.ts`、`src/mods/validate.ts` |
| UI 元素表 | `src/mods/ui/` |
| **接线点** | **不在 `src/mods/`——要扫全 `src/`** |

### 4.2 ⚠️ 陷阱一：接线审计脚本会把注释算成「已接线」

这是本仓已经栽过一次的地方，也是裁判自己栽过的。

统计「事件 X 有没有 dispatch 点」时，**必须剥掉注释再匹配调用点**：

```python
# ❌ 错的：注释里出现的事件名会被算成已接线
s = open('src/mods/protocol.ts').read()
hits = re.findall(r'dispatchMod\w*\(\s*[\'"]' + event, s)

# ✅ 对的：先剥注释
import re
s = open('src/mods/protocol.ts').read()
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)   # 块注释
s = re.sub(r'//.*', '', s)                    # 行注释
hits = re.findall(r'dispatchMod\w*\(\s*[\'"]' + event, s)
```

**还有第二层**：某些接线点的键是**带引号的属性**（形如 `'tool.call': 'PreToolUse'`），不长得像 `dispatchModXxx(` 的裸调用。**这类要单独计数**，别让它从统计里漏掉。

> 上一次这个坑造出的两个数字**差了一整个数量级**，而且**两个都是当时看起来"对"的**。
> 本资料包不写出那两个数字——**它们本身就是你要重新算出来的东西的一部分。**

### 4.3 ⚠️ 陷阱二：证伪一个入口 ≠ 证伪整条声明

「我在 A 处没找到 dispatch，所以这个能力不存在」——**这个推理是断的**。可达性论证必须穷尽全部调用方：

- 某条路径可能**编译期就被折叠掉**（构建脚本会剥离内部特性）
- 可能被**运行时环境变量闸门**挡住，静态看不见
- 可能经**动态注册 / 字符串拼接 / 外部配置**构造

**裁判在这件事上判错过一次**：把「某个 flag 被编译掉」当成整条能力声明不成立的证明，漏掉了另一条运行时路径。**你在写 `REJECTED` 时必须穷尽调用方，否则你会重犯。**

### 4.4 取证命令

```bash
# 类型层面找矛盾
bun run typecheck > /tmp/parity-<你>/tc.log 2>&1; grep -E "error TS" /tmp/parity-<你>/tc.log

# 单文件 / 指定文件测试。必须重定向，禁止 | tail
bun test src/mods/某文件.test.ts > /tmp/parity-<你>/t.log 2>&1
grep -cE '^\(fail\)' /tmp/parity-<你>/t.log
```

**三个已知坑**（所有人都会踩）：

1. **PATH 上的 `opencc` 是旧构建**——它指向 `opencc-release` 的产物，与本仓库 `src/` 无关。验证本仓库行为**必须**用 `bun /Users/ethan/code/opencc/dist/cli.mjs`。用 `opencc` 得到的一切结论都无效。
2. **本仓库有预存测试失败。** 无改动状态下跑出来的红不等于你发现的缺陷。
3. **`bun test` 在非 TTY 下只打印 `(fail)`。** 几百个通过项零反馈，看起来像卡死。永远重定向到文件再读。

**检索用 Grep / Glob / codegraph 工具，不要在 Bash 里手搓 `rg`/`grep`。**

---

## 五、⚠️ 现成文档的可靠性警告

`/Users/ethan/code/opencc/docs/` 下有三份上游对齐文档：

```
mods-upstream-audit.md        （2.1.289 口径）
mods-upstream-contract.md     （2.1.296 口径）
mods-upstream-gaps.md         （2.1.296 口径）
```

**你可以读，但不能当结论引用。** 三条硬理由：

1. **版本不对。** 三份都是 2.1.289 / 2.1.296 口径，本场是 **2.1.302**。
2. **它们已经被自己推翻过。** 同一份 `contract` 里既写过「`$` 有 24 个 noun」，也写过「实为 19 个」；`audit` 有一条整节结论被 `contract` 明确标为**错的**。**一份会自我更正的文档，不能被当成不需复核的基准。**
3. **文档自己也标了「存疑」。** 例如某条结论旁边写着「可能是自创」「未找到上游对应声明」。

**因此规则（README §5.6）**：引用它们可以，但每一条都要**独立复核到 2.1.302 或 opencc 源码**，并在你自己的文档里注明「我复核过」或「我复核后修正为 X」。

**裁判在裁定时会抽查：如果你报告里的某条差距，其上游坐标和这三份文档的措辞高度雷同、且你没有独立坐标，证据等级按 V1 计。**

---

## 六、你的证据要长什么样

一条合格的证据，两个坐标 + 一段输出：

```
上游：d.ts:2348  或  bundle.js@36385773  或  modules/0156-…mjs:88
下游：src/mods/protocol.ts:182
运行环境：Node v22.22.3 / 真 2.1.302 二进制 / Bun 1.4.2（逐条注明）
输出：（贴真实命令的真实输出）
```

**坐标格式统一用 `文件:行号` 或 `bundle.js@字节偏移`。** 裁判抽查时按图索骥，格式不统一会让人核不到。

---

## 七、一句话总结本资料包

> **权威签名在 d.ts，可执行行为在真二进制，实现现状在 opencc 源码。**
> **注释不是接线点，一个入口的缺席不是能力的缺席，三份现成文档不是答案。**
