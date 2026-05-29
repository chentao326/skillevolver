<p align="center">
  <h1 align="center">🧬 SkillEvolver</h1>
  <p align="center">
    <em>AI Agent 技能自我进化系统</em>
    <br>
    不动模型权重，让 Agent 通过试错自主进化出可复用技能
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-ES2022-blue?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-20%2B-green?logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/pnpm-monorepo-orange?logo=pnpm" alt="pnpm">
  <img src="https://img.shields.io/badge/tests-81%20passed-brightgreen" alt="tests">
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="license">
  <img src="https://img.shields.io/badge/paper-arXiv:2605.10500-red" alt="paper">
</p>

---

基于论文 [*SkillEvolver: Skill Learning as a Meta-Skill*](https://arxiv.org/abs/2605.10500) 的完整工程实现。

## 💡 这是什么

传统 AI Agent 每次面对新任务都从零开始推理。**SkillEvolver** 改变了这一点——

它让 Agent 通过多轮试运行自我进化，将成功经验沉淀为可复用的技能文件。整个过程**不动模型权重**，只操作文件系统。技能是制品，不是参数。

<details open>
<summary><b>一个进化生成的技能长这样</b></summary>

```markdown
# Word Counter

## Primary Action
```bash
python scripts/count.py input/*.txt output/stats.json
```

## Constraints
- 从 input/ 目录运行时检测文件名
- 输出 JSON 格式：{ "total_words": N, "total_chars": N }
```
</details>

## 🔄 核心机制

```
 任务目录       Understand        Strategy         Explore          Update          Audit        技能文件
┌──────────┐   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ README.md │──▶│ 分析任务  │───▶│ K 个不同  │───▶│ K 路并行  │───▶│ 对比胜/败 │───▶│ 9 项审计  │───▶│ SKILL.md │
│ input/    │   │ 结构      │    │ 策略      │    │ 试运行    │    │ 提取补丁  │    │ 门控      │    │ + 脚本    │
│ evaluate  │   └──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
└──────────┘
```

### 进化循环

| 阶段 | 功能 | 输出 |
|:-----|:-----|:-----|
| **Understand** | 分析任务目录，提取决策轴、参数轴、奖励类型 | `TaskAxes` |
| **Strategy** | 生成 K 个差异化策略（首次引导，后续针对性修补） | K × `Strategy` |
| **Explore** | K 路并行试运行，每个策略在隔离沙箱中独立执行 | K × `Trajectory` |
| **Update** | 对比胜者特征 vs 败者特征，提取 Δ 补丁并合成新技能 | `SkillArtifact` |
| **Audit** | 独立 LLM 会话执行 9 项审计，通过才进入候选 | `AuditReport` |
| **Finalize** | 训练/验证分集评估，选出最优技能版本 | 最终技能 |

## 🛡️ 9 项审计检查

> 对应论文 **Table 3** — 防止技能过拟合训练数据、泄露敏感信息、生成不可用制品

| # | 检查 | 防御目标 |
|:--|:-----|:---------|
| 1 | **Framing** | 技能名/描述泄露训练实例的业务名词 |
| 2 | **Literals** | 训练文件名/路径被硬编码到技能 |
| 2b | **Script Bloat** | 脚本超过 200/400 行阈值 |
| 3 | **Untraceable** | 技能断言缺乏轨迹数据支撑 |
| 4 | **Shape Bake** | 硬编码列名/键名，未做运行时探测 |
| 5 | **Coverage** | 机械式任务只有纯文本指导、缺少脚本 |
| 6 | **Xref** | 技能文本出现训练数据的字符串字面量 |
| 7 | **Under-abstraction** | 参数轴值写成常量而非运行时推导 |
| 8 | **Primary Action Hoist** | 约束文案排在主操作之前，Agent 跳过脚本 |
| 9 | **Silent Bypass** | 失败轨迹大部分未曾调用主脚本 |

## 📂 项目结构

```
skillevolver/
├── packages/
│   ├── core/                        核心引擎
│   │   └── src/
│   │       ├── orchestrator.ts  ——  进化编排器
│   │       ├── phases/          ——  Understand / Strategy / Explore / Update
│   │       ├── auditor/         ——  9 项审计检查
│   │       ├── llm/             ——  多模型适配器 (Claude / GPT / DeepSeek / Mock)
│   │       ├── trace-engine.ts  ——  SQLite 轨迹持久化
│   │       ├── worker-pool.ts   ——  并发信号量 + 进度追踪
│   │       └── utils/           ——  容错 JSON 提取 / 指数退避重试
│   ├── sandbox/                    安全沙箱 + 路径白名单 Hook
│   ├── skill-registry/             技能版本化文件存储
│   └── cli/                        CLI 工具
├── tests/
│   ├── integration/                集成测试
│   ├── demo/                       Mock LLM 端到端演示
│   ├── benchmark/                  83-task 基准测试
│   └── phase4/                     真实 LLM 测试（需 API key）
├── specs/                          需求规格
├── ARCHITECTURE.md                 详细架构设计
└── DEVELOPMENT.md                  开发步骤文档
```

## 🚀 快速开始

### 安装

```bash
git clone https://github.com/chentao326/skillevolver.git
cd skillevolver
pnpm install && pnpm build
```

> 要求 Node.js ≥ 20, pnpm

### 零依赖演示

无需任何 API key，用内置 Mock LLM 跑完整进化流程：

```bash
npx tsx demo/run-evolve.ts
```

你会看到 word-counter 任务从无到有进化出一个技能，包含审计结果和生成脚本。

### 真实 LLM 进化

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # 或 DEEPSEEK_API_KEY=sk-...

pnpm --filter @skillevolver/cli exec skillevolver evolve \
  --task ./my-task/ \
  --iterations 2 \
  --explore-width 4 \
  --output ./skills/
```

### CLI 命令

| 命令 | 说明 |
|:-----|:-----|
| `skillevolver evolve --task <path>` | 为任务进化技能 |
| `skillevolver audit --skill <slug>` | 对已有技能执行 9 项审计 |
| `skillevolver status --task <slug>` | 查看进化状态和版本历史 |
| `skillevolver list` | 列出所有已进化技能 |

<details>
<summary><b>evolve 命令参数</b></summary>

| 参数 | 默认值 | 说明 |
|:-----|:-------|:-----|
| `-i, --iterations` | 2 | 最大进化轮数 |
| `-k, --explore-width` | 4 | 每轮并行探索数 |
| `-b, --budget` | 15 | 最大预算 (USD) |
| `-o, --output` | ./skills/ | 技能输出目录 |
</details>

## 💻 编程接口

```typescript
import { SkillEvolver, LLMRouter } from '@skillevolver/core';
import { SkillRegistry } from '@skillevolver/skill-registry';

const evolver = new SkillEvolver({
  llm: new LLMRouter({ anthropicKey: process.env.ANTHROPIC_API_KEY }),
  maxIterations: 2,
  exploreWidth: 4,
  budget: { maxCostUSD: 15, maxTurns: 200 },
});

const result = await evolver.evolve('./path/to/task/');

// result.skill.skillMd     — 生成的 SKILL.md
// result.skill.scripts     — 生成的脚本文件
// result.costUsd           — 总花费
// result.auditReports      — 每轮审计报告
// result.trajectories      — 全部试运行轨迹

const registry = new SkillRegistry('./skills/');
await registry.save(result.skill);
```

<details>
<summary><b>切换 LLM 模型</b></summary>

```typescript
import { LLMRouter, DeepSeekAdapter, AdapterRouter } from '@skillevolver/core';

const router = new LLMRouter();
(router as any)._adapterRouter = new AdapterRouter([
  new DeepSeekAdapter(process.env.DEEPSEEK_API_KEY),
]);
```

不同角色可指定不同模型，编辑 `packages/core/src/llm/types.ts` 中的 `DEFAULT_MODEL_MAP`。

</details>

## 📋 任务目录格式

```
my-task/
├── README.md          ← 任务描述
├── input/             ← 训练输入数据
│   └── data.csv
└── evaluate.sh        ← 评估脚本，输出 "SCORE: <number>"
```

`evaluate.sh` 是奖励信号来源。技能执行后沙箱运行它，解析 `SCORE:` 后的数字作为 reward。

## 🧪 测试

```bash
pnpm test              # 全部测试
pnpm -r typecheck      # 类型检查
```

| 层级 | 文件数 | 用例 | 覆盖内容 |
|:-----|:-------|:-----|:---------|
| 集成 / Demo | 5 | 14 | 端到端进化、SkillStore、TrajectoryCollector |
| Core 单元 | 3 | 53 | JSON/Retry/CostTracker、审计白盒、TraceEngine |
| Sandbox | 1 | 14 | 白名单 Hook 6 边界场景、沙箱执行 |
| 真实 LLM | 3 | 8 | DeepSeek API（需 key，无 key 自动 skip） |

## 🏗️ 技术栈

| 层 | 选型 |
|:---|:-----|
| 语言 | TypeScript ES2022, strict mode |
| 运行时 | Node.js ≥ 20 |
| 包管理 | pnpm workspace monorepo |
| 测试 | Vitest 3.x |
| 存储 | SQLite (better-sqlite3) + 文件系统 |
| LLM | Anthropic Claude / OpenAI GPT / DeepSeek（统一 Adapter 接口） |
| 沙箱 | 本地进程 + 路径白名单 Hook |

## 🎯 设计原则

- **Agent 无关** — 技能通过标准 CLI 接口加载，不绑定任何 Agent 框架
- **LLM 无关** — `LLMAdapter` 接口支持切换任意模型
- **制品级进化** — 修改作用于 Skill 文件，永不动模型权重
- **隔离安全** — 每次试运行在独立工作区，白名单 Hook 防路径遍历
- **审计先行** — 任何变更必须通过独立 LLM 会话的 9 项检查

## 📖 论文对照

| 论文 | 实现 |
|:-----|:-----|
| Algorithm 1 — EvolveLoop | `orchestrator.ts` |
| §3.1 — Understand | `phases/understand.ts` |
| §3.2.1 — Strategy Generation | `phases/strategy.ts` |
| §3.2.2 — K-way Explore | `phases/explore.ts` — `executeParallel()` |
| §3.2.2 — Contrast + Update | `phases/update.ts` |
| Table 3 — 9 Audit Checks | `auditor/index.ts` 每个 `check*()` 函数 |
| §A.3 — Anti-Leak Layer | `checkLiterals`, `checkXref`, `checkFraming` |
| §3.2.2 — φ() Trace Query | `trace-engine.ts` |

## 📄 许可

MIT © 2026
