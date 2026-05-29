# SkillEvolver

> AI Agent 技能自我进化系统 — 不动模型权重，让 Agent 通过试错自主进化出可复用技能

基于论文 [*SkillEvolver: Skill Learning as a Meta-Skill*](https://arxiv.org/abs/2605.10500) 的完整工程实现。

---

## 这是什么？

传统 AI Agent 每次面对新任务都从零开始推理。SkillEvolver 改变了这一点：它让 Agent 通过多次试运行自我进化，将经验沉淀为可复用的**技能文件**（Markdown 指导 + 可执行脚本）。整个过程不动模型权重，只操作文件系统 — 技能是制品，不是参数。

**一个技能长这样：**

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

## 核心机制

```
任务目录 ──→ Understand ──→ Strategy ──→ Explore ──→ Update ──→ Audit ──→ 技能文件
  (README     分析任务    生成 K 个     K 路并行    对比胜/败    9 项审计    SKILL.md
   + 数据)     结构        不同策略      试运行      提取补丁     门控       + 脚本
```

### 进化循环

| 阶段 | 做什么 | 关键输出 |
|------|--------|----------|
| **Understand** | 分析任务目录，提取决策轴、参数轴、奖励类型 | `TaskAxes` |
| **Strategy** | 生成 K 个差异化策略（r=0 引导，r>0 针对性修补） | K × `Strategy` |
| **Explore** | K 路并行试运行，每个策略在隔离沙箱中执行 | K × `Trajectory` |
| **Update** | 对比胜者特征 vs 败者特征，提取 Δ 补丁 | `SkillArtifact` |
| **Audit** | 独立 LLM 会话执行 9 项审计检查，通过才进入候选 | `AuditReport` |
| **Finalize** | 训练/验证分集评估，选出最优技能版本 | 最终 `SKILL.md` |

### 9 项审计检查（论文 Table 3）

| # | 检查项 | 防御什么 |
|---|--------|----------|
| 1 | Framing | 技能名/描述泄露训练实例的业务名词 |
| 2 | Literals | 训练文件名/路径硬编码到技能中 |
| 2b | Script Bloat | 脚本超过 200/400 行临界线 |
| 3 | Untraceable | 技能中的断言没有轨迹数据支撑 |
| 4 | Shape Bake | 硬编码列名/键名，未做运行时探测 |
| 5 | Coverage | 机械式任务（需脚本）却只有纯文本指导 |
| 6 | Xref | 技能文本中出现训练数据的字符串字面量 |
| 7 | Under-abstraction | 参数轴的值被写成常量而非运行时推导 |
| 8 | Primary Action Hoist | SKILL.md 把约束放在主操作之前，Agent 可能不执行脚本 |
| 9 | Silent Bypass | 失败轨迹中大部分从未调用主脚本 |

## 项目结构

```
skillevolver/
├── packages/
│   ├── core/                  # 核心引擎
│   │   └── src/
│   │       ├── orchestrator.ts    # 进化编排器 (Understand→Explore→Update→Audit)
│   │       ├── phases/
│   │       │   ├── understand.ts  # 任务结构分析
│   │       │   ├── strategy.ts    # 策略生成引擎
│   │       │   ├── explore.ts     # 并行探索 + 沙箱执行
│   │       │   ├── update.ts      # 对比胜/败轨迹，生成补丁
│   │       │   └── prompts.ts     # 全部 LLM 提示词
│   │       ├── auditor/           # 9 项审计检查
│   │       ├── llm/               # 多模型适配器 (Claude/GPT/DeepSeek/Mock)
│   │       ├── trace-engine.ts    # 轨迹 SQLite 持久化 + φ() 查询
│   │       ├── worker-pool.ts     # 并发信号量 + 进度追踪
│   │       ├── utils/
│   │       │   ├── json.ts        # 容错 JSON 提取
│   │       │   └── retry.ts       # 指数退避重试
│   │       └── types.ts           # 全部 TypeScript 类型定义
│   ├── sandbox/               # 安全沙箱 + 工作区白名单 Hook
│   ├── skill-registry/        # 技能版本化文件存储
│   └── cli/                   # CLI 工具 (evolve/audit/status/list)
├── tests/
│   ├── integration/           # Phase 2 集成测试
│   ├── demo/                  # Mock LLM 端到端演示
│   ├── benchmark/             # 83-task 基准测试
│   └── phase4/                # 真实 LLM 测试 (需 API key)
├── specs/                     # 需求规格
├── ARCHITECTURE.md            # 详细架构设计
└── DEVELOPMENT.md             # 开发步骤文档
```

## 快速开始

### 安装

```bash
# 要求 Node.js >= 20, pnpm
git clone https://github.com/chentao326/skillevolver.git
cd skillevolver
pnpm install
pnpm build
```

### 运行演示（零依赖，无需 API key）

```bash
npx tsx demo/run-evolve.ts
```

这会用 Mock LLM 跑一个完整的 word-counter 任务进化流程，输出进化的技能文件和审计结果。

### 用真实 LLM 进化技能

```bash
# 设置 API key
export ANTHROPIC_API_KEY=sk-ant-...
# 或
export DEEPSEEK_API_KEY=sk-...

# 进化一个任务
pnpm --filter @skillevolver/cli exec skillevolver evolve \
  --task ./my-task/ \
  --iterations 2 \
  --explore-width 4 \
  --output ./skills/
```

### CLI 命令

```bash
skillevolver evolve --task <path>    # 为指定任务进化技能
  -i, --iterations <n>               默认 2 轮
  -k, --explore-width <n>            默认 4 路并行
  -b, --budget <usd>                 默认 $15
  -o, --output <dir>                 默认 ./skills/

skillevolver audit --skill <slug>    # 对已有技能执行 9 项审计
skillevolver status --task <slug>    # 查看进化状态和版本历史
skillevolver list                    # 列出所有已进化技能
```

## 编程接口

```typescript
import { SkillEvolver, LLMRouter, AnthropicAdapter, TraceEngine } from '@skillevolver/core';
import { SkillRegistry } from '@skillevolver/skill-registry';

// 1. 配置 LLM
const router = new LLMRouter({
  anthropicKey: process.env.ANTHROPIC_API_KEY,
});

// 2. 创建进化器
const evolver = new SkillEvolver({
  llm: router,
  maxIterations: 2,    // 最多 2 轮迭代
  exploreWidth: 4,     // 每轮 4 路并行探索
  validationTrials: 5, // 5 次验证试运行
  budget: { maxCostUSD: 15, maxTurns: 200 },
});

// 3. 进化
const result = await evolver.evolve('./path/to/task/');

console.log(result.skill.skillMd);    // 生成的 SKILL.md
console.log(result.skill.scripts);    // 生成的脚本文件
console.log(result.costUsd);          // 总花费
console.log(result.auditReports);     // 审计报告

// 4. 保存技能
const registry = new SkillRegistry('./skills/');
await registry.save(result.skill);
```

### 切换模型

```typescript
import { LLMRouter, DeepSeekAdapter, OpenAIAdapter, AdapterRouter } from '@skillevolver/core';

// 直接用网关注入
const router = new LLMRouter();
(router as any)._adapterRouter = new AdapterRouter([
  new DeepSeekAdapter(process.env.DEEPSEEK_API_KEY),
]);

// 或者指定角色用不同模型（在 types.ts 的 DEFAULT_MODEL_MAP 中配置）
```

## 任务目录格式

SkillEvolver 期望一个标准任务目录：

```
my-task/
├── README.md          # 任务描述
├── input/             # 训练输入数据
│   └── data.csv
└── evaluate.sh        # 评估脚本，输出 "SCORE: <number>"
```

`evaluate.sh` 是奖励信号来源。技能执行后，沙箱会运行它，解析 `SCORE:` 后的数字作为 reward。

## 测试

```bash
pnpm test              # 全部测试 (根集成 + 4 个包)
pnpm -r test           # 仅包级测试
pnpm -r typecheck      # 类型检查
```

| 层级 | 文件 | 用例 | 覆盖 |
|------|------|------|------|
| 根集成 | 5 文件 | 14 | 端到端演进、SkillStore、TrajectoryCollector |
| core | 3 文件 | 53 | JSON/Retry/CostTracker、审计白盒、TraceEngine |
| sandbox | 1 文件 | 14 | 白名单 Hook 6 边界、沙箱执行 |
| 真实 LLM | 3 文件 | 8 | DeepSeek API（需 `DEEPSEEK_API_KEY`，默认 skip） |
| **合计** | **12 文件** | **81** | |

## 技术栈

| 层 | 选型 |
|---|------|
| 语言 | TypeScript (ES2022, strict) |
| 运行时 | Node.js >= 20 |
| 包管理 | pnpm monorepo |
| 测试 | Vitest 3.x |
| 存储 | SQLite (better-sqlite3) + 文件系统 |
| LLM | Anthropic / OpenAI / DeepSeek（统一 Adapter 接口） |
| 沙箱 | 本地进程 (execSync) + 路径白名单 Hook |

## 设计原则

- **Agent 无关** — 技能通过标准 CLI 接口加载，不绑定特定 Agent 框架
- **LLM 无关** — `LLMAdapter` 接口支持任意模型切换
- **制品级进化** — 所有修改作用在 Skill 文件（Markdown + 脚本），永不动模型权重
- **隔离安全** — 每次试运行在独立工作区执行，白名单 Hook 阻止路径遍历和敏感文件访问
- **审计先行** — 任何技能变更必须通过独立 LLM 会话的 9 项检查

## 论文对照

| 论文章节 | 对应实现 |
|----------|----------|
| Algorithm 1 (EvolveLoop) | `orchestrator.ts` — `SkillEvolver.evolve()` |
| §3.1 Understand | `phases/understand.ts` |
| §3.2.1 Strategy Generation | `phases/strategy.ts` |
| §3.2.2 Explore (K-way) | `phases/explore.ts` — `executeParallel()` |
| §3.2.2 Contrast + Update | `phases/update.ts` |
| Table 3 (9 审计检查) | `auditor/index.ts` — 每个 `check*` 函数对应一项 |
| §A.3 Anti-Leak | `checkLiterals`, `checkXref`, `checkFraming` |
| §3.2.2 φ() trace query | `trace-engine.ts` — `getTopTrajectories/getBottomTrajectories` |

## 许可

MIT
