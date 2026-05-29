# SkillEvolver 工程化架构设计

> 基于论文《SkillEvolver: Skill Learning as a Meta-Skill》的工程实现方案

---

## 一、系统总览

### 1.1 设计目标

将论文的 SkillEvolver 从研究原型转化为可独立部署、多 LLM 兼容、可扩展的生产级技能自进化系统。

### 1.2 核心设计原则

| 原则 | 说明 |
|------|------|
| **Agent 无关** | 元技能和领域技能均通过标准 CLI Agent 接口加载，不绑定特定 Agent 框架 |
| **LLM 无关** | 支持切换底层模型（Claude / GPT / 开源模型），通过统一 LLM Router 抽象 |
| **制品级进化** | 所有修改作用于 Skill 文件（Markdown + 脚本），永不动模型权重 |
| **隔离安全** | 每次试运行在独立沙箱中执行，防止训练数据泄露到验证环境 |
| **审计先行** | 任何技能变更必须通过独立 Auditor 会话的 9 项检查才能进入候选序列 |

---

## 二、系统架构

```
┌──────────────────────────────────────────────────────────────────┐
│                     SkillEvolver System                           │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    API / CLI Gateway                         │ │
│  │   • REST API (evolve, audit, deploy, status)                 │ │
│  │   • CLI (skillevolver evolve --task <path>)                  │ │
│  └─────────────────────────┬───────────────────────────────────┘ │
│                            │                                      │
│  ┌─────────────────────────▼───────────────────────────────────┐ │
│  │                 Orchestrator (Meta-Skill Engine)             │ │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐   │ │
│  │  │Understand│  │ Explore  │  │  Update   │  │Finalize  │   │ │
│  │  │  Phase   │  │  Phase   │  │  Phase    │  │  Phase   │   │ │
│  │  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └────┬─────┘   │ │
│  └───────┼─────────────┼─────────────┼─────────────┼─────────┘ │
│          │             │             │             │            │
│  ┌───────▼─────────────▼─────────────▼─────────────▼─────────┐ │
│  │                    Core Services                            │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │ │
│  │  │ Sandbox  │ │  Trace   │ │ Auditor  │ │ LLM Router   │  │ │
│  │  │ Manager  │ │  Engine  │ │  Engine  │ │              │  │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │ │
│  │  │ Skill    │ │ Strategy │ │  Reward  │ │  Anti-Leak   │  │ │
│  │  │ Registry │ │  Engine  │ │  Scorer  │ │  Layer       │  │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                   Storage Layer                             │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │
│  │  │ Skill DB │ │ Trace DB │ │ Audit DB │ │  Config DB   │  │  │
│  │  │(versioned│ │(traject- │ │(9-check  │ │  (task defs, │  │  │
│  │  │  store)  │ │  ories)  │ │ reports) │ │   strategies)│  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 三、核心模块详细设计

### 3.1 Orchestrator（编排引擎）

**职责**：驱动技能进化的完整生命周期，是系统的"大脑"。

```
Orchestrator
├── UnderstandPhase    # 阶段0：解析任务结构
├── EvolveLoop         # 阶段1..R：进化循环
│   ├── ExploreSubPhase    # 策略多样化探索
│   ├── UpdateSubPhase     # 对比式技能更新
│   └── AuditSubPhase      # 独立审计门控
└── FinalizePhase     # 阶段R+1：选定最优技能
```

#### 3.1.1 UnderstandPhase（理解阶段）

**论文对应**：§3.1, Algorithm 1 line 1 `axes ← Parse(T_train)`

**输入**：
```typescript
interface UnderstandInput {
  taskPath: string;        // 训练任务目录路径
  taskDescription: string; // 任务自然语言描述
  oraclePolicy?: string;   // 可选的 oracle 策略（用于评估）
}
```

**输出**：
```typescript
interface TaskAxes {
  domain: string;                    // 领域分类
  decisionAxes: DecisionAxis[];      // 关键决策轴
  parametricAxes: ParametricAxis[];  // 参数化轴
  invariantAxes: InvariantAxis[];    // 不变轴
  rewardType: 'binary' | 'scalar';   // 奖励类型
  summary: string;                   // 任务结构摘要
}

interface DecisionAxis {
  name: string;            // 轴名称，如 "library_choice"
  options: string[];       // 可选值，如 ["pandas", "polars", "native"]
  description: string;     // 说明
}

interface ParametricAxis {
  name: string;            // 参数名，如 "threshold", "filename"
  trainingValue: string;   // 训练集中的具体值
  derivationRule: string;  // 应如何在运行时推导
}
```

**实现要点**：
- 用 LLM 一次性解析任务目录：读取 README、示例输入输出、评分脚本
- 识别领域的决策轴：库选择、算法族、数据格式处理方式等
- 标记每个具体常量为 invariant 或 parametric
- 对 parametric 轴，必须要求运行时推导而非硬编码训练值

#### 3.1.2 EvolveLoop（进化循环）

**论文对应**：§3.2, Algorithm 1 lines 6-13

**核心状态机**：

```
┌──────────────────────────────────────────────────────┐
│                  EvolveLoop (R 轮迭代)                │
│                                                       │
│   v_r (当前技能)                                      │
│     │                                                 │
│     ▼                                                 │
│   ┌──────────────────────────────────────────────┐   │
│   │ ExploreSubPhase                               │   │
│   │ 1. 生成 K 个多样化策略                         │   │
│   │ 2. K 路并行执行 (Harbor sandbox)               │   │
│   │ 3. 收集轨迹 τ_{r,i} + 奖励 y_{r,i}            │   │
│   └──────────────────────┬───────────────────────┘   │
│                          │                            │
│                          ▼                            │
│   ┌──────────────────────────────────────────────┐   │
│   │ UpdateSubPhase                               │   │
│   │ 1. 选出 τ⁺ (top) 和 τ⁻ (bottom)              │   │
│   │ 2. LLM 提取对比特征 Δ = φ(τ⁺) \ φ(τ⁻)       │   │
│   │ 3. 生成外科手术补丁 ṽ_{r+1} = Patch(v_r, Δ) │   │
│   └──────────────────────┬───────────────────────┘   │
│                          │                            │
│                          ▼                            │
│   ┌──────────────────────────────────────────────┐   │
│   │ AuditSubPhase                                │   │
│   │ 1. 独立 fresh session 加载 ṽ_{r+1}           │   │
│   │ 2. 执行 9 项检查                              │   │
│   │ 3. 通过 → v_{r+1} = ṽ_{r+1}, 继续循环        │   │
│   │ 4. 失败 → 触发新一轮 targeted patch           │   │
│   └──────────────────────────────────────────────┘   │
│                                                       │
│   退出条件: Auditor 通过 ∧ #pass(τ_r) ≥ 3K/4         │
└──────────────────────────────────────────────────────┘
```

**EvolveLoop 接口**：
```typescript
interface EvolveLoopConfig {
  maxIterations: number;    // R, 默认 2
  exploreWidth: number;     // K, 默认 4
  validationTrials: number; // V, 默认 5
  harborTimeout: number;    // 每次试运行超时 (秒)
  budget: {
    maxCostUSD: number;     // 单任务最大花费
    maxTurns: number;       // 单次试运行最大交互轮次
  };
}

interface EvolveLoopState {
  iteration: number;
  currentSkill: SkillArtifact;
  trajectories: Trajectory[];
  auditReports: AuditReport[];
  convergenceMetrics: {
    passRate: number;
    costSoFar: number;
    improvementDelta: number;
  };
}
```

#### 3.1.3 FinalizePhase（定稿阶段）

**论文对应**：Algorithm 1 lines 14-15

- 在所有候选技能 {v₁, ..., v_R} 上运行 V 次 held-out 验证
- 选择 avg reward 最高的技能作为最终产物
- 执行 Harbor validation — 在完全隔离的环境中运行，防止信息泄露

---

### 3.2 Strategy Engine（策略引擎）

**论文对应**：§3.2.1 Strategy-Diversified Exploration

**职责**：生成 K 个在高层决策轴上互不相同的探索策略。

```
StrategyEngine
├── StrategyGenerator     # LLM 驱动的策略生成
├── DiversityChecker      # 多样性验证 (不能有相同策略)
└── ParametricGuard       # 参数化轴检查 (至少一个策略运行时推导)
```

**策略文件格式** (`strategy_{i}.md`):
```markdown
# Strategy: {name}

## High-Level Plan
{自然语言描述的高层方案}

## Decision Axes
- library: {choice}        # 必须从决策轴选项中选择
- algorithm: {choice}
- data_format: {choice}

## Parametric Values
- {param_name}: RUNTIME_DERIVE   # 或使用具体的运行时推导规则
- {param_name}: INVARIANT        # 或标记为不变

## Failure Modes to Target (r > 0 only)
{上一轮观察到的失败模式，本轮策略要针对解决}
```

**多样性保证**：
- 不是通过提高 temperature（只改变措辞不改变方案）
- 显式检查任意两个策略在所有决策轴上的值不能完全相同
- 至少有一个策略对每个 parametric 轴使用 RUNTIME_DERIVE

---

### 3.3 Sandbox Manager（沙箱管理器）

**论文对应**：Harbor 隔离环境，§4.1, Appendix A.3

**职责**：为每次试运行提供完全隔离的执行环境。

```
SandboxManager
├── SandboxProvisioner    # 创建/销毁沙箱
├── WorkspaceWhitelist    # 工作区白名单
├── PathDenylist          # 路径黑名单 (防止 .. traversal)
└── EnvIndexRouter        # 环境索引路由 (per-trial env index)
```

**隔离层级**：

| 层级 | 机制 | 防止什么 |
|------|------|---------|
| Layer 1 | train/test split | 训练任务和验证任务是不同实例 |
| Layer 2 | workspace whitelist | Agent 只能访问当前运行的工作区 |
| Layer 3 | path denylist | 拒绝 `..` 遍历，拒绝符号链接绕过 |
| Layer 4 | curated skill deletion | 训练前删除人工编写的参考技能 |
| Layer 5 | fresh session per trial | 每次试运行是全新的 Agent 会话 |

**实现方案**：
- Docker 容器 per trial，`--read-only` 根文件系统 + `tmpfs` 工作区
- 或使用 Firecracker microVM 获得更强隔离
- PreToolUse hook 拦截所有工具调用，校验路径在白名单内

---

### 3.4 Trace Engine（轨迹引擎）

**论文对应**：§3.2.2 Contrastive Skill Update

**职责**：收集、存储、对比试运行轨迹。

```
TraceEngine
├── TraceCollector        # 实时收集 Agent 轨迹
├── TraceStore            # 持久化存储
├── ContrastExtractor     # LLM 驱动的对比特征提取
└── FeatureReader φ()     # 论文中的 φ 函数
```

**轨迹数据结构**：
```typescript
interface Trajectory {
  id: string;
  taskId: string;
  iteration: number;         // r
  strategyId: string;        // s_{r,i}
  skillVersion: string;      // v_r 的版本 hash
  
  // 执行记录
  steps: Step[];
  totalTokens: number;
  totalTurns: number;
  wallClockMs: number;
  
  // 结果
  reward: number;            // y_{r,i}
  success: boolean;          // binary 任务
  error?: string;
  
  // 元数据
  sandboxId: string;
  modelName: string;
  timestamp: number;
}

interface Step {
  type: 'think' | 'tool_call' | 'tool_result' | 'message';
  content: string;
  tokens: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
}

interface ContrastResult {
  winnerFeatures: string[];    // φ(τ⁺) 的特征
  loserFeatures: string[];     // φ(τ⁻) 的特征
  diff: string[];              // Δ = φ(τ⁺) \ φ(τ⁻)
  analysis: string;            // LLM 分析文本
  patchTarget: 'skill_body' | 'scripts' | 'description' | 'constraints';
}
```

**对比逻辑**：
- Binary 任务：τ⁺ = 所有通过的 trial，τ⁻ = 所有失败的 trial
- Scalar 任务：τ⁺ = top-scoring trial，τ⁻ = bottom-scoring trial
- r=0 时：对比问"成功者知道什么失败者不知道的"
- r>0 时：对比问"当前技能在哪里误导/不足/未能引导 Agent"

---

### 3.5 Skill Registry（技能注册中心）

**职责**：管理技能工件的版本化存储和检索。

```
SkillRegistry
├── SkillStore            # 文件系统 + 元数据 DB
├── VersionManager        # 语义化版本管理
├── SkillValidator        # 技能格式校验
└── DeploymentManager     # 将技能安装到目标 Agent
```

**技能目录结构**：
```
skills/
└── {domain}/
    └── {task_slug}/
        ├── SKILL.md           # 技能主文件 (自然语言指令)
        ├── scripts/           # 可执行脚本
        │   ├── primary.py     # 主要操作脚本
        │   └── utils.py       # 辅助工具
        ├── references/        # 参考文件
        │   └── examples.md
        ├── .versions/         # 版本历史
        │   ├── v1/
        │   ├── v2/
        │   └── HEAD -> v2
        └── metadata.json      # 元数据
```

**metadata.json**：
```json
{
  "skill_id": "manufacturing-fjsp-optimization",
  "domain": "manufacturing",
  "version": 2,
  "created_at": "2026-05-28T10:00:00Z",
  "evolve_stats": {
    "iterations": 2,
    "total_trials": 13,
    "total_cost_usd": 3.92,
    "training_pass_rate": 0.75,
    "validation_pass_rate": 1.0
  },
  "model": "claude-opus-4.6",
  "checksum": "sha256:abc123..."
}
```

---

### 3.6 Auditor Engine（审计引擎）

**论文对应**：§3.2.3, Table 3 — 9 项审计检查

**职责**：在独立 fresh session 中验证技能候选，防止泄露、过度拟合和部署失败。

**9 项检查清单**：

```typescript
enum AuditCheck {
  // === 内容泄露检查 (Checks 1-6) ===
  FRAMING = 1,          // ⋆ 名称/描述是否泄露训练实例的业务名词
  LITERALS = 2,         // ⋆ 是否硬编码训练文件名/字段名/数值
  SCRIPT_BLOAT = '2b',  // 单个脚本是否超过 200/400 行
  UNTRACEABLE = 3,      // 是否存在无法追溯的强制断言
  SHAPE_BAKE = 4,       // ⋆ 脚本是否硬编码列/表/键索引
  COVERAGE = 5,         // 机械任务是否缺少打包脚本
  XREF = 6,             // ⋆ 技能文件中是否有 ≥4 字符的字符串匹配训练数据

  // === 部署特有检查 (Checks 7-9) ===
  UNDER_ABSTRACTION = 7,   // ⋆ 是否将参数轴常量嵌入指令
  PRIMARY_ACTION_HOIST = 8,// ⋆ SKILL.md 是否在调用块之前放约束文
  SILENT_BYPASS = 9,       // ⋆ 主要脚本是否在运行时从未被调用
}
```

**Auditor 执行流程**：
```
1. 启动独立 fresh session (不与 evolve loop 共享上下文)
2. 加载候选技能 ṽ_{r+1}
3. 执行 Checks 1-6 (静态分析，检查技能文件内容)
4. 执行 Checks 7-9 (动态分析，检查实际 trace)
5. ⋆ 标记的 check 任一命中 → AUDIT_FAIL → 触发新一轮 targeted patch
6. 全部通过 → AUDIT_PASS → v_{r+1} = ṽ_{r+1}
```

**审计报告**：
```typescript
interface AuditReport {
  skillVersion: string;
  timestamp: number;
  sessionId: string;        // fresh session, 与 evolve loop 不同

  checks: {
    checkId: AuditCheck;
    passed: boolean;
    evidence?: string;      // 命中时的证据
    severity: 'critical' | 'warning';
  }[];

  verdict: 'PASS' | 'FAIL';
  failReason?: string;      // 失败时，供下一轮 targeted patch 使用
  patchHint?: string;       // 建议的修复方向
}
```

---

### 3.7 LLM Router（模型路由层）

**职责**：抽象 LLM 调用，支持多模型切换和成本控制。

```typescript
interface LLMRouter {
  // 不同场景使用不同模型配置
  complete(config: LLMConfig): Promise<LLMResponse>;
  
  // 成本追踪
  getUsage(): UsageStats;
}

interface LLMConfig {
  role: 'understand' | 'strategy_gen' | 'contrast' | 'synthesize' | 'audit';
  model?: string;           // 可覆盖默认模型
  maxTokens: number;
  temperature: number;      // 探索用高一点，审计用 0
  systemPrompt: string;
  messages: Message[];
}
```

**推荐模型分配**：

| 角色 | 模型 | temperature | 原因 |
|------|------|-------------|------|
| Understand | Opus / GPT-5 | 0.1 | 需要深度理解，低温度保证一致 |
| Strategy Gen | Opus / GPT-5 | 0.7 | 需要创造性多样化 |
| Contrast φ() | Opus / GPT-5 | 0.2 | 需要精确提取 |
| Synthesize | Opus / GPT-5 | 0.2 | 需要精确编辑 |
| Auditor | Opus / GPT-5 | 0 | 审计必须确定性 |
| Domain-Skill Agent | Sonnet / GPT-4o | 0 | 执行 Agent 用廉价模型 |

---

### 3.8 Anti-Leak Layer（防泄露层）

**论文对应**：Appendix A.3 Contamination Controls

**职责**：确保训练信息不会泄露到技能工件或验证环境。

**五层防护**：

```
Layer 1: Train/Test Split
  - T_train 和 T_val 是不同的任务实例
  - 不同的数据文件、文件名、有时不同的子领域
  - 技能中编码训练文件名 → 验证时文件不存在 → 静默失败

Layer 2: Workspace Whitelist
  - PreToolUse hook 拒绝白名单外的所有工具调用
  - 每个 run 有独立的工作区前缀

Layer 3: Path Denylist
  - 拒绝 ".." 路径遍历
  - 解析符号链接后再次检查
  - 拒绝解析到 curated skill 目录的路径

Layer 4: Curated Skill Deletion
  - 每次探索运行前，从源删除人工编写的训练 skill
  - Agent 永远不可达

Layer 5: Fresh Session
  - Auditor 和 Final Validator 都在全新会话中运行
  - 不与 evolve loop 共享任何上下文
```

---

## 四、数据流全景

```
                          ┌──────────────┐
                          │  Task Input  │
                          │  T_train     │
                          └──────┬───────┘
                                 │
                                 ▼
                     ┌─────────────────────┐
                     │   UnderstandPhase   │
                     │   Parse → axes      │
                     └─────────┬───────────┘
                               │
                               ▼ axes
                     ┌─────────────────────┐
                     │   EvolveLoop        │
                     │                     │
                     │  ┌───────────────┐  │
                     │  │ Strategy Gen  │  │
                     │  │ S = {s₁..sₖ}  │  │
                     │  └───────┬───────┘  │
                     │          │           │
                     │          ▼           │
                     │  ┌───────────────┐  │
                     │  │ K Parallel    │  │
                     │  │ Explore       │  │
                     │  │ (Harbor)      │  │
                     │  └───────┬───────┘  │
                     │          │ τ, y      │
                     │          ▼           │
                     │  ┌───────────────┐  │
                     │  │ Contrast φ()  │  │
                     │  │ Δ = φ⁺\φ⁻    │  │
                     │  └───────┬───────┘  │
                     │          │ Δ         │
                     │          ▼           │
                     │  ┌───────────────┐  │
                     │  │ Synthesize    │  │
                     │  │ ṽ = Patch(v,Δ)│  │
                     │  └───────┬───────┘  │
                     │          │ ṽ         │
                     │          ▼           │
                     │  ┌───────────────┐  │
                     │  │ Auditor       │  │
                     │  │ (Fresh Session)│  │
                     │  └───────┬───────┘  │
                     │          │ PASS/FAIL │
                     │          ▼           │
                     │    v_{r+1}           │
                     └─────────┬───────────┘
                               │ v₁..v_R
                               ▼
                     ┌─────────────────────┐
                     │   FinalizePhase     │
                     │   Harbor Validate   │
                     │   V trials per v    │
                     │   → v*              │
                     └─────────┬───────────┘
                               │
                               ▼
                     ┌─────────────────────┐
                     │  Deployable Skill   │
                     │  SKILL.md + scripts │
                     └─────────────────────┘
```

---

## 五、技术选型建议

| 组件 | 推荐方案 | 备选方案 |
|------|---------|---------|
| 语言 | TypeScript (Node.js) | Python |
| Agent 框架 | Claude Code / Codex CLI | LangChain, AutoGen |
| 沙箱 | Docker + Harbor | Firecracker, gVisor |
| 存储 | SQLite (元数据) + Filesystem (制品) | PostgreSQL + S3 |
| 消息队列 | BullMQ (Redis) | RabbitMQ, SQS |
| LLM API | Anthropic API + OpenAI API | LiteLLM 统一网关 |
| 配置管理 | YAML + env vars | TOML |
| 日志/监控 | Pino + OpenTelemetry | Winston + Prometheus |

---

## 六、分阶段开发计划

### Phase 1: 核心骨架（2-3 周）

**目标**：最小可运行原型，单任务单 LLM 跑通完整流程

```
□ 1.1 项目脚手架
  - monorepo 结构 (packages/: core, sandbox, skill-registry, cli)
  - TypeScript 配置、ESLint、Prettier
  - 基础 CI/CD

□ 1.2 Skill Registry
  - 技能文件系统布局
  - 版本管理 (写时复制)
  - metadata.json 读写

□ 1.3 LLM Router
  - Anthropic API 封装
  - OpenAI API 封装
  - 统一接口 + 成本追踪

□ 1.4 Sandbox Manager (简化版)
  - Docker 容器管理
  - Workspace 隔离
  - 超时控制

□ 1.5 Understand Phase
  - 任务目录解析
  - LLM 驱动的轴提取
  - 输出 TaskAxes 结构

□ 1.6 Explore SubPhase (简化版)
  - 单策略执行 (K=1, 无多样化)
  - 轨迹收集

□ 1.7 Update SubPhase
  - 对比特征提取 φ()
  - 补丁生成

□ 1.8 端到端集成测试
  - 选一个简单 SkillsBench 任务跑通
```

### Phase 2: 进化循环（2-3 周）

**目标**：完整实现论文核心算法

```
□ 2.1 Strategy Engine
  - K 个多样化策略生成
  - 多样性检查器
  - Parametric guard

□ 2.2 并行探索 (K=4)
  - 并发沙箱管理
  - 结果收集与聚合

□ 2.3 Auditor Engine
  - Checks 1-6 (静态分析)
  - Checks 7-9 (动态分析)
  - Fresh session 隔离

□ 2.4 EvolveLoop 完整实现
  - R=2 迭代
  - 退出条件判断
  - 状态机管理

□ 2.5 Finalize Phase
  - Held-out 验证
  - 最优技能选择

□ 2.6 Trace Engine
  - 持久化轨迹存储
  - 查询与回放
```

### Phase 3: 生产加固（2-3 周）

**目标**：可靠、安全、可观测

```
□ 3.1 Anti-Leak Layer 完整实现
  - 五层防护
  - Workspace whitelist hook
  - Path denylist + symlink resolution

□ 3.2 错误处理与重试
  - 沙箱崩溃恢复
  - LLM API 重试 + 退避
  - 部分失败优雅降级

□ 3.3 成本预算控制
  - 实时成本追踪
  - 预算超限自动中断
  - 成本报告

□ 3.4 可观测性
  - OpenTelemetry tracing
  - 结构化日志
  - Dashboard (演化进度、成本、成功率)

□ 3.5 CLI 工具
  - evolve / audit / deploy / status 命令
  - 进度展示 (spinner + 实时统计)
```

### Phase 4: 扩展与生态（3-4 周）

**目标**：多 LLM、多 Agent 框架、规模化

```
□ 4.1 多 LLM 支持
  - GPT-5 适配
  - 开源模型适配 (Llama, Qwen)
  - 跨模型结果对比

□ 4.2 多 Agent 框架适配
  - Claude Code 适配器
  - Codex CLI 适配器
  - 通用 Agent 接口抽象

□ 4.3 分布式沙箱
  - Harbor 集群管理
  - 任务队列 + worker pool
  - 自动扩缩容

□ 4.4 技能市场
  - 技能发布/发现
  - 多任务共享技能库
  - 跨域技能复用

□ 4.5 基准测试套件
  - SkillsBench 83 任务自动化
  - KernelBench GPU 任务
  - 回归测试
```

---

## 七、关键设计决策与权衡

### 7.1 为什么用文件系统而非数据库存储技能？

- 技能是 Markdown + 脚本，天然适合版本控制（Git）
- 方便人工审查和手动编辑
- 可直接被 Agent 加载（Agent 读文件比读 API 更自然）

### 7.2 为什么 R=2 而非更多？

论文的消融实验表明 R=2 贡献了大部分增益（约 2/3）。更深迭代可能带来边际收益递减，且成本线性增长。建议将 R 作为可配置参数，默认 2，允许高级用户调整。

### 7.3 为什么 K=4？

4 个策略在多样性和成本间取得平衡。更多策略增加覆盖但成本线性增长，更少策略可能漏掉关键决策路径。

### 7.4 为什么 Auditor 必须是 fresh session？

如果 Auditor 与 evolve loop 共享上下文，可能受到编写 Agent 自身偏差的影响。论文中发现的 Checks 7-9（under-abstraction, primary-action hoisting, silent-bypass）只能在部署 trace 中观察到，不能从编写 Agent 的自我反思中检测。

---

## 八、安全考量

| 风险 | 缓解措施 |
|------|---------|
| 技能编码训练数据 | Anti-Leak Layer 五层防护 + Auditor Checks 1-6 |
| Agent 执行恶意代码 | Sandbox 隔离 + 只读根文件系统 + 网络限制 |
| 成本失控 | 硬性预算上限 + 实时成本监控 + 自动中断 |
| 技能退化（regression） | 版本管理 + 回滚能力 + held-out 验证 |
| 供应链攻击 | 技能来源签名 + 内容哈希校验 |

---

## 九、附录：与论文术语对照

| 论文术语 | 工程模块 |
|---------|---------|
| Meta-Skill | Orchestrator (作为 Skill 插件加载到 CLI Agent) |
| SkillEvolver Agent | CLI Agent + Evolver Skill Plugin |
| Domain-Skill Agent | Sandbox 中的执行 Agent |
| Harbor | Sandbox Manager |
| Strategy-Diversified Exploration | Strategy Engine + ExploreSubPhase |
| Contrastive Skill Update | Trace Engine (φ) + UpdateSubPhase |
| Auditor Gate | Auditor Engine |
| Task Axes | UnderstandPhase 输出 |
| Under-abstraction | Auditor Check 7 |
| Primary-Action Hoisting | Auditor Check 8 |
| Silent-Bypass | Auditor Check 9 |
