# SkillEvolver 详细开发步骤

> 基于 ARCHITECTURE.md 的工程化架构，将每个 Phase 拆解为可直接执行的开发任务。
> 每个步骤包含：文件结构、实现要点、伪代码/代码骨架、验收标准、预估工时。

---

## Phase 1: 核心骨架（预估 15 人天）

> 目标：最小可运行原型，单任务单 LLM 跑通 Understand → Explore → Update → Audit 闭环

---

### Step 1.1: 项目脚手架

**预估**: 1 天  
**依赖**: 无  
**产出**: 可构建、可 lint 的 monorepo

#### 文件结构

```
skillevolver/
├── package.json              # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json        # 共享 TS 配置
├── .eslintrc.cjs
├── .prettierrc
├── .github/
│   └── workflows/
│       └── ci.yml            # lint + typecheck + test
├── packages/
│   ├── core/                 # 核心逻辑：Orchestrator, phases
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       └── types.ts      # 所有共享类型定义
│   ├── sandbox/              # 沙箱管理
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts
│   ├── skill-registry/       # 技能注册中心
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts
│   └── cli/                  # CLI 入口
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           └── index.ts
└── tests/
    └── fixtures/             # 测试用任务 fixture
```

#### 实现要点

```bash
# 初始化 monorepo
mkdir skillevolver && cd skillevolver
pnpm init
# 配置 pnpm-workspace.yaml:
# packages:
#   - 'packages/*'
```

**pnpm-workspace.yaml**:
```yaml
packages:
  - 'packages/*'
```

**tsconfig.base.json**（关键配置）:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

#### 验收标准

- [ ] `pnpm install` 成功
- [ ] `pnpm build` 全量编译通过
- [ ] `pnpm lint` 零错误
- [ ] `pnpm test` 运行（哪怕只有 1 个占位测试）
- [ ] CI workflow 在 push 时自动运行

---

### Step 1.2: Skill Registry（技能注册中心）

**预估**: 1.5 天  
**依赖**: 1.1  
**产出**: 版本化技能存储与检索

#### 文件结构

```
packages/skill-registry/
└── src/
    ├── index.ts              # 公开 API
    ├── types.ts              # SkillArtifact, SkillVersion 等类型
    ├── store.ts              # 文件系统读写
    ├── version.ts            # 版本递增与回滚
    └── validator.ts          # 技能结构校验
```

#### 核心类型（写入 `packages/core/src/types.ts`）

```typescript
// ===== 技能工件 =====
export interface SkillArtifact {
  skillId: string;
  domain: string;
  taskSlug: string;
  version: number;
  
  // 技能文件内容
  skillMd: string;              // SKILL.md 正文
  scripts: Record<string, string>;  // filename → content
  references: Record<string, string>;
  
  // 元数据
  metadata: SkillMetadata;
  checksum: string;
}

export interface SkillMetadata {
  createdAt: string;            // ISO 8601
  evolveStats: {
    iterations: number;
    totalTrials: number;
    totalCostUsd: number;
    trainingPassRate: number;
    validationPassRate: number;
  };
  model: string;
  parentVersion?: number;       // 上一版本号
}

// ===== 版本管理 =====
export interface SkillVersion {
  version: number;
  path: string;                 // 文件系统路径
  metadata: SkillMetadata;
  checksum: string;
}
```

#### store.ts 实现要点

```typescript
export class SkillStore {
  constructor(private basePath: string) {}

  // 保存技能（创建新版本）
  async save(skill: SkillArtifact): Promise<void> {
    const versionDir = path.join(this.basePath, skill.taskSlug, `.versions/v${skill.version}`);
    await fs.mkdir(versionDir, { recursive: true });
    
    // 写 SKILL.md
    await fs.writeFile(path.join(versionDir, 'SKILL.md'), skill.skillMd);
    // 写 scripts/
    for (const [name, content] of Object.entries(skill.scripts)) {
      await fs.writeFile(path.join(versionDir, 'scripts', name), content);
    }
    // 写 metadata.json
    await fs.writeFile(
      path.join(versionDir, 'metadata.json'),
      JSON.stringify(skill.metadata, null, 2)
    );
    // 更新 HEAD 符号链接
    await fs.symlink(`.versions/v${skill.version}`, 
      path.join(this.basePath, skill.taskSlug, 'HEAD'), 'dir');
  }

  // 加载最新版本
  async loadLatest(taskSlug: string): Promise<SkillArtifact> { /* ... */ }
  
  // 加载指定版本
  async loadVersion(taskSlug: string, version: number): Promise<SkillArtifact> { /* ... */ }
  
  // 列出所有版本
  async listVersions(taskSlug: string): Promise<SkillVersion[]> { /* ... */ }
}
```

#### 验收标准

- [ ] `save()` 后 `loadLatest()` 读取一致
- [ ] 保存第 2 版后 `listVersions()` 返回 [v1, v2]
- [ ] 结构校验：缺少 SKILL.md 报错
- [ ] 单元测试覆盖所有 CRUD 操作

---

### Step 1.3: LLM Router（模型路由）

**预估**: 1.5 天  
**依赖**: 1.1  
**产出**: 统一 LLM 调用接口 + 成本追踪

#### 文件结构

```
packages/core/
└── src/
    ├── llm/
    │   ├── index.ts          # LLMRouter 公开 API
    │   ├── types.ts          # LLMConfig, LLMResponse
    │   ├── anthropic.ts      # Anthropic API 适配器
    │   ├── openai.ts         # OpenAI API 适配器
    │   └── cost-tracker.ts   # 成本追踪
```

#### 核心接口

```typescript
export type ModelRole = 
  | 'understand' 
  | 'strategy_gen' 
  | 'contrast' 
  | 'synthesize' 
  | 'audit'
  | 'domain_agent';

export interface LLMConfig {
  role: ModelRole;
  model?: string;
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface LLMResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  model: string;
}

// 默认模型分配表
export const DEFAULT_MODEL_MAP: Record<ModelRole, { model: string; temperature: number }> = {
  understand:    { model: 'claude-opus-4-20250514', temperature: 0.1 },
  strategy_gen:  { model: 'claude-opus-4-20250514', temperature: 0.7 },
  contrast:      { model: 'claude-opus-4-20250514', temperature: 0.2 },
  synthesize:    { model: 'claude-opus-4-20250514', temperature: 0.2 },
  audit:         { model: 'claude-opus-4-20250514', temperature: 0.0 },
  domain_agent:  { model: 'claude-sonnet-4-20250514', temperature: 0.0 },
};

// Anthropic 定价 ($/1M tokens, 2026年参考)
export const PRICING = {
  'claude-opus-4-20250514':  { input: 15.0, output: 75.0 },
  'claude-sonnet-4-20250514': { input: 3.0,  output: 15.0 },
};
```

#### cost-tracker.ts 实现要点

```typescript
export class CostTracker {
  private usage: Array<{
    role: ModelRole;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    timestamp: number;
  }> = [];

  record(response: LLMResponse, role: ModelRole): void {
    this.usage.push({ role, model: response.model, ...response.usage, timestamp: Date.now() });
  }

  getTotalCost(): number {
    return this.usage.reduce((sum, u) => sum + u.costUsd, 0);
  }

  getCostByRole(): Record<ModelRole, number> {
    // 按 role 聚合
  }

  isOverBudget(maxUsd: number): boolean {
    return this.getTotalCost() > maxUsd;
  }
}
```

#### 验收标准

- [ ] Anthropic API 调用成功并返回正确格式
- [ ] 成本计算与 API 返回的 usage 一致（误差 < 5%）
- [ ] `isOverBudget` 正确触发
- [ ] Mock 模式下可运行（不消耗 API credit）

---

### Step 1.4: Sandbox Manager（沙箱管理）

**预估**: 2 天  
**依赖**: 1.1  
**产出**: Docker 容器隔离 + 轨迹收集 hooks

#### 文件结构

```
packages/sandbox/
└── src/
    ├── index.ts              # SandboxManager 公开 API
    ├── types.ts
    ├── docker.ts             # Docker 容器管理
    ├── workspace.ts          # 工作区准备与白名单
    └── hooks.ts              # PreToolUse / PostToolUse hooks
```

#### 核心接口

```typescript
export interface SandboxConfig {
  image: string;              // Docker image
  taskPath: string;           // 任务目录（挂载到容器）
  skillPath?: string;         // 技能目录（可选挂载）
  workspacePrefix: string;    // 工作区前缀（白名单根）
  timeoutMs: number;          // 超时
  env: Record<string, string>;
  networkDisabled?: boolean;  // 断网模式
}

export interface SandboxInstance {
  id: string;
  run(params: SandboxRunParams): Promise<SandboxResult>;
  destroy(): Promise<void>;
}

export interface SandboxRunParams {
  agentCommand: string;       // 如 "claude --task task.md"
  maxTurns: number;
  hooks?: {
    preToolUse?: (tool: ToolCall) => ToolCall | null;   // null = deny
    postToolUse?: (tool: ToolCall, result: string) => void;
  };
}

export interface SandboxResult {
  exitCode: number;
  trajectory: Trajectory;
  stdout: string;
  stderr: string;
  wallClockMs: number;
}
```

#### docker.ts 实现要点

```typescript
export class DockerSandbox implements SandboxInstance {
  private container: Docker.Container;

  async run(params: SandboxRunParams): Promise<SandboxResult> {
    // 1. 在容器内执行 agent 命令
    const exec = await this.container.exec({
      Cmd: ['bash', '-c', params.agentCommand],
      AttachStdout: true,
      AttachStderr: true,
    });

    // 2. 流式读取输出，实时收集轨迹
    const stream = await exec.start({ hijack: true, Detach: false });
    const trajectory = new TrajectoryCollector();
    
    stream.on('data', (chunk: Buffer) => {
      const parsed = this.parseAgentOutput(chunk.toString());
      if (parsed) trajectory.addStep(parsed);
    });

    // 3. 超时控制
    const timer = setTimeout(() => exec.resize({ h: 1, w: 1 }), params.timeout);
    
    return await new Promise((resolve) => {
      stream.on('end', () => {
        clearTimeout(timer);
        resolve({
          exitCode: /* inspect exit */,
          trajectory: trajectory.finalize(),
          wallClockMs: Date.now() - start,
        });
      });
    });
  }
}
```

#### workspace.ts — 白名单 hook

```typescript
export function createWorkspaceWhitelistHook(workspacePrefix: string) {
  return (tool: ToolCall): ToolCall | null => {
    // 检查所有路径参数
    for (const [key, value] of Object.entries(tool.input)) {
      if (isPath(value)) {
        const resolved = path.resolve(workspacePrefix, value);
        // 拒绝 .. 遍历
        if (resolved.includes('..')) return null;
        // 拒绝白名单外的绝对路径
        if (!resolved.startsWith(workspacePrefix)) return null;
        // 拒绝指向 curated skill 的路径
        if (resolved.includes('curated-skill')) return null;
      }
    }
    return tool; // 通过
  };
}
```

#### 验收标准

- [ ] 创建容器 → 执行简单命令 → 销毁容器，全流程正常
- [ ] 超时自动终止容器
- [ ] 白名单 hook 拒绝 `cat /etc/passwd`
- [ ] 白名单 hook 拒绝 `cat ../../secret`
- [ ] 轨迹正确收集工具调用的输入输出

---

### Step 1.5: Understand Phase（理解阶段）

**预估**: 1.5 天  
**依赖**: 1.2, 1.3  
**产出**: 任务结构解析 → TaskAxes

#### 文件结构

```
packages/core/
└── src/
    └── phases/
        ├── understand.ts      # UnderstandPhase 主逻辑
        └── prompts.ts         # LLM prompts 集中管理
```

#### prompts.ts

```typescript
export const UNDERSTAND_SYSTEM_PROMPT = `You are a task structure analyzer. 
Given a task directory, identify:

1. Domain (e.g., software_engineering, finance, media, science, robotics)
2. Decision Axes — key high-level choices an agent must make:
   - library_choice: which libraries are viable
   - algorithm_family: which algorithmic approaches exist
   - data_format_handling: how input/output formats vary
   - tool_interface: which CLI tools or APIs are used
3. Parametric Axes — values that differ between training and deployment:
   - For each concrete value in the task (filenames, thresholds, IDs),
     classify as INVARIANT or PARAMETRIC
   - For PARAMETRIC values, specify how to derive at runtime
4. Reward type: "binary" (pass/fail) or "scalar" (continuous score)

Output JSON only, no explanation.`;

// 示例输出格式
export const UNDERSTAND_OUTPUT_SCHEMA = {
  domain: "string",
  decisionAxes: [{ name: "string", options: ["string"], description: "string" }],
  parametricAxes: [{ name: "string", trainingValue: "string", derivationRule: "string" }],
  invariantAxes: [{ name: "string", value: "string" }],
  rewardType: "binary | scalar",
  summary: "string"
};
```

#### understand.ts 实现要点

```typescript
export class UnderstandPhase {
  constructor(private llm: LLMRouter, private registry: SkillStore) {}

  async execute(taskPath: string): Promise<TaskAxes> {
    // 1. 读取任务目录结构
    const taskFiles = await this.readTaskDirectory(taskPath);
    
    // 2. 收集关键文件内容（README, 示例输入, 评分脚本）
    const context = this.collectContext(taskFiles);
    
    // 3. 调用 LLM 解析
    const response = await this.llm.complete({
      role: 'understand',
      maxTokens: 4000,
      temperature: 0.1,
      systemPrompt: UNDERSTAND_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: context }],
    });

    // 4. 解析 JSON 输出
    const raw = JSON.parse(response.content);
    
    // 5. 验证：每个 parametric 轴必须有 derivationRule
    for (const axis of raw.parametricAxes) {
      if (!axis.derivationRule) {
        throw new Error(`Parametric axis "${axis.name}" lacks derivationRule`);
      }
    }

    // 6. 持久化到 registry
    await this.registry.saveAxes(taskPath, raw);
    
    return raw;
  }

  private readTaskDirectory(taskPath: string): Promise<TaskFiles> { /* ... */ }
  private collectContext(files: TaskFiles): string { /* ... */ }
}
```

#### 验收标准

- [ ] 输入真实任务目录 → 输出合法的 TaskAxes JSON
- [ ] 每个 parametric 轴都有 derivationRule
- [ ] 输出持久化后可重现读取
- [ ] 边界情况：空目录 → 抛出可理解的错误

---

### Step 1.6: Explore SubPhase（探索阶段 — 简化版）

**预估**: 2 天  
**依赖**: 1.4, 1.5  
**产出**: 单个策略在沙箱中执行任务并收集轨迹

> Phase 1 先用 K=1 简化，Phase 2 再扩展为 K=4 并行。

#### 文件结构

```
packages/core/
└── src/
    └── phases/
        └── explore.ts
```

#### explore.ts 实现要点

```typescript
export class ExploreSubPhase {
  constructor(
    private sandbox: SandboxManager,
    private llm: LLMRouter,
  ) {}

  async execute(
    task: TaskAxes,
    skill: SkillArtifact | null,  // r=0 时为 null
    strategy: Strategy,           // r=0 时为 bootstrap 策略
    iteration: number,
  ): Promise<Trajectory> {
    // 1. 准备沙箱
    const sandboxConfig: SandboxConfig = {
      image: 'skillevolver/agent:latest',
      taskPath: task.taskPath,
      skillPath: skill ? skill.path : undefined,
      workspacePrefix: `/workspace/${uuid()}`,
      timeoutMs: 300_000, // 5 min
      env: {
        SKILL_STRATEGY_ID: strategy.id,
        SKILL_ITERATION: String(iteration),
      },
    };

    const instance = await this.sandbox.create(sandboxConfig);

    // 2. 构建 agent 命令
    const agentCmd = this.buildAgentCommand(task, skill, strategy);

    // 3. 执行
    const result = await instance.run({
      agentCommand: agentCmd,
      maxTurns: 200,
      hooks: {
        preToolUse: createWorkspaceWhitelistHook(sandboxConfig.workspacePrefix),
        postToolUse: (tool, output) => { /* 可选：实时日志 */ },
      },
    });

    // 4. 清理
    await instance.destroy();

    // 5. 计算 reward
    const reward = await this.computeReward(task, result);

    return {
      ...result.trajectory,
      reward,
      strategyId: strategy.id,
      iteration,
    };
  }

  private buildAgentCommand(task: TaskAxes, skill: SkillArtifact | null, strategy: Strategy): string {
    const parts: string[] = [];
    parts.push(`cd /workspace`);
    if (strategy) {
      parts.push(`export SKILL_STRATEGY="${strategy.content}"`);
    }
    if (skill) {
      parts.push(`claude --skill /skills/${skill.taskSlug}/HEAD`);
    } else {
      parts.push(`claude --task /task/README.md`);
    }
    return parts.join(' && ');
  }

  private async computeReward(task: TaskAxes, result: SandboxResult): Promise<number> {
    if (task.rewardType === 'binary') {
      // 执行评分脚本
      const score = await execScoreScript(task.taskPath, result);
      return score.passed ? 1 : 0;
    }
    // scalar: 返回连续值
    return parseFloat(result.stdout.match(/SCORE: ([\d.]+)/)?.[1] ?? '0');
  }
}
```

#### 验收标准

- [ ] K=1 时，对一个简单任务成功执行全流程
- [ ] 轨迹包含完整的 tool_call / tool_result 序列
- [ ] binary 任务的 reward 正确为 0 或 1
- [ ] 超时后优雅终止并返回部分轨迹

---

### Step 1.7: Update SubPhase（更新阶段）

**预估**: 2 天  
**依赖**: 1.2, 1.3, 1.6  
**产出**: 对比提取 + 补丁生成

#### 文件结构

```
packages/core/
└── src/
    └── phases/
        ├── update.ts          # UpdateSubPhase 主逻辑
        └── prompts.ts         # 追加 contrast / synthesize prompts
```

#### prompts.ts 追加

```typescript
export const CONTRAST_SYSTEM_PROMPT = `You analyze execution traces to identify 
what successful runs know that failed runs don't.

Given:
- A set of HIGH-REWARD trajectories (successful)
- A set of LOW-REWARD trajectories (failed)

Extract features φ(high) and φ(low), then compute Δ = φ(high) \ φ(low).
A "feature" is a concrete action, decision, code pattern, or constraint present 
in the successful runs but missing or wrong in the failed runs.

Output JSON:
{
  "winnerFeatures": ["feature1", "feature2", ...],
  "loserFeatures": ["feature3", "feature4", ...],
  "diff": ["only-in-winner-1", "only-in-winner-2", ...],
  "analysis": "natural language analysis of what the skill is missing",
  "patchTarget": "skill_body" | "scripts" | "description" | "constraints"
}`;

export const SYNTHESIZE_SYSTEM_PROMPT = `You are a skill patch writer.
Given a current skill artifact and a contrast diff Δ, produce a SURGICAL patch.

Rules:
1. Preserve all working guidance — do NOT rewrite the whole skill
2. Add only what the diff reveals as missing
3. For executable scripts: they must accept runtime inputs, not hardcoded filenames/values
4. Do NOT add features likely known from pretraining alone
5. At r=0: create the FIRST domain skill from the contrast signal
6. At r>0: patch v_r, preserving structure, adding only the missing constraint/pattern/tool

Output the patched skill as:
{
  "skillMd": "updated SKILL.md content",
  "newScripts": { "filename": "content" },
  "modifiedScripts": { "filename": "content" },
  "changesSummary": "human-readable summary of changes"
}`;

export const STRATEGY_GEN_PROMPT = `You are a strategy designer for agent task execution.
Given a task structure (decision axes, parametric axes, task summary), design K diverse strategies.

Each strategy must be a concrete, actionable high-level plan that differs from others on at least
one decision axis (library choice, algorithm family, data format handling, etc.).

For PARAMETRIC axes: at least one strategy must tag the value as "RUNTIME_DERIVE" —
meaning the agent should compute it at runtime rather than copying from training data.

For r > 0 (refinement): each strategy should target a different failure mode observed
in the previous iteration's trajectories.

Output JSON:
{
  "strategies": [
    {
      "id": "s1",
      "name": "strategy name",
      "description": "natural language plan",
      "decisions": { "axis_name": "chosen_value" },
      "parametricValues": { "param_name": "RUNTIME_DERIVE | INVARIANT" },
      "failureModeTarget": "failure description (r>0 only)",
      "content": "full strategy Markdown"
    }
  ]
}`;

```

#### update.ts 实现要点

```typescript
export class UpdateSubPhase {
  constructor(
    private llm: LLMRouter,
    private registry: SkillStore,
  ) {}

  async execute(
    currentSkill: SkillArtifact | null, // r=0 时为 null（bootstrap）
    trajectories: Trajectory[],
    task: TaskAxes,
  ): Promise<SkillArtifact> {
    // 1. 选出 τ⁺ 和 τ⁻
    const { winners, losers } = this.splitByReward(trajectories, task.rewardType);

    if (winners.length === 0) {
      throw new Error('No successful trajectories — all K trials failed');
    }

    // 2. 调用 LLM 提取对比特征 Δ
    const contrastResult = await this.extractContrast(winners, losers, currentSkill !== null);

    // 3. 生成补丁
    const patchedSkill = await this.synthesizePatch(
      currentSkill,
      contrastResult,
      task,
    );

    // 4. 保存到 registry（分配新版本号）
    const nextVersion = currentSkill ? currentSkill.version + 1 : 1;
    patchedSkill.version = nextVersion;
    await this.registry.save(patchedSkill);

    return patchedSkill;
  }

  private splitByReward(trajectories: Trajectory[], rewardType: 'binary' | 'scalar') {
    if (rewardType === 'binary') {
      return {
        winners: trajectories.filter(t => t.reward === 1),
        losers: trajectories.filter(t => t.reward === 0),
      };
    }
    // scalar: top vs bottom
    const sorted = [...trajectories].sort((a, b) => b.reward - a.reward);
    return {
      winners: sorted.slice(0, Math.ceil(sorted.length / 2)),
      losers: sorted.slice(-Math.ceil(sorted.length / 2)),
    };
  }

  private async extractContrast(
    winners: Trajectory[],
    losers: Trajectory[],
    isRefinement: boolean,
  ): Promise<ContrastResult> {
    // 构造 prompt
    const question = isRefinement
      ? "Where did the current skill mislead, underspecify, or fail to guide the agent?"
      : "What did the winners know that the losers lacked?";
    
    const response = await this.llm.complete({
      role: 'contrast',
      maxTokens: 8000,
      temperature: 0.2,
      systemPrompt: CONTRAST_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          question,
          winnerTraces: winners.map(this.summarizeTrace),
          loserTraces: losers.map(this.summarizeTrace),
        }),
      }],
    });

    return JSON.parse(response.content);
  }

  private async synthesizePatch(
    currentSkill: SkillArtifact | null,
    contrast: ContrastResult,
    task: TaskAxes,
  ): Promise<SkillArtifact> {
    const response = await this.llm.complete({
      role: 'synthesize',
      maxTokens: 16000,
      temperature: 0.2,
      systemPrompt: SYNTHESIZE_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          currentSkill: currentSkill ? {
            skillMd: currentSkill.skillMd,
            scripts: Object.keys(currentSkill.scripts),
          } : null,
          contrast,
          taskSummary: task.summary,
        }),
      }],
    });

    const patch = JSON.parse(response.content);
    
    // 构建新的 SkillArtifact
    return {
      skillId: task.taskSlug,
      domain: task.domain,
      taskSlug: task.taskSlug,
      version: 0, // 外部设置
      skillMd: patch.skillMd,
      scripts: {
        ...currentSkill?.scripts ?? {},
        ...patch.newScripts,
        ...patch.modifiedScripts,
      },
      references: currentSkill?.references ?? {},
      metadata: {
        createdAt: new Date().toISOString(),
        evolveStats: { iterations: 0, totalTrials: 0, totalCostUsd: 0, trainingPassRate: 0, validationPassRate: 0 },
        model: '',
      },
      checksum: '', // TODO: compute SHA256
    };
  }

  private summarizeTrace(t: Trajectory): string {
    // 提取关键步骤：脚本调用、错误信息、最终结果
    return t.steps
      .filter(s => s.type === 'tool_call')
      .map(s => `${s.toolName}: ${JSON.stringify(s.toolInput).slice(0, 200)}`)
      .join('\n');
  }
}
```

#### 验收标准

- [ ] r=0（无现有技能）→ 从零生成第一个技能
- [ ] r=1（有技能）→ 仅添加缺失部分，不重写
- [ ] 所有 trial 失败时，抛出明确错误（而非产生无效补丁）
- [ ] 生成的技能通过结构校验

---

### Step 1.8: 端到端集成测试

**预估**: 2 天  
**依赖**: 1.1–1.7  
**产出**: 单任务完整流程可运行 + 回归测试

#### 测试任务

从 SkillsBench 选一个简单任务，如 `jpg-ocr-stat`（Office 领域）：

```bash
# 准备测试 fixture
tests/fixtures/jpg-ocr-stat/
├── train/          # T_train — 训练实例
│   ├── README.md
│   ├── input/
│   └── evaluate.sh
└── val/            # T_val — 验证实例（不同数据）
    ├── README.md
    ├── input/
    └── evaluate.sh
```

#### 集成测试代码骨架

```typescript
// tests/integration/evolve.test.ts
import { SkillEvolver } from '@skillevolver/core';
import { createMockLLMRouter } from '../helpers/mock-llm';
import { createTestFixture } from '../helpers/fixtures';

describe('SkillEvolver end-to-end', () => {
  it('should evolve a skill for jpg-ocr-stat', async () => {
    // 1. 准备
    const fixture = await createTestFixture('jpg-ocr-stat');
    const llm = createMockLLMRouter(); // 使用录制的 LLM 响应
    const evolver = new SkillEvolver({
      llm,
      sandbox: new DockerSandboxManager(),
      registry: new SkillStore('/tmp/test-skills'),
      config: { maxIterations: 1, exploreWidth: 1, validationTrials: 1 },
    });

    // 2. 执行
    const result = await evolver.evolve(fixture.taskPath);

    // 3. 断言
    expect(result.skill).toBeDefined();
    expect(result.skill.version).toBeGreaterThanOrEqual(1);
    expect(result.skill.skillMd.length).toBeGreaterThan(100);
    expect(result.skill.scripts).toBeDefined();
    expect(result.costUsd).toBeLessThan(5);
    expect(result.trajectories.length).toBeGreaterThan(0);
  });
});
```

#### 验收标准

- [ ] 集成测试通过（使用 mock LLM + 真实沙箱）
- [ ] 产物技能可通过 `registry.loadLatest()` 正确加载
- [ ] 日志输出可读，包含各阶段耗时和成本

---

## Phase 2: 进化循环（预估 12 人天）

> 目标：完整实现论文核心算法 — K=4 并行探索 + 9 项审计 + R=2 迭代

---

### Step 2.1: Strategy Engine（策略引擎）

**预估**: 2 天  
**依赖**: 1.5  
**产出**: K 个多样化策略生成与校验

#### 文件结构

```
packages/core/
└── src/
    └── phases/
        └── strategy.ts       # StrategyEngine
```

#### strategy.ts 实现要点

```typescript
export class StrategyEngine {
  constructor(private llm: LLMRouter) {}

  async generateBootstrap(
    axes: TaskAxes,
    k: number = 4,
  ): Promise<Strategy[]> {
    const response = await this.llm.complete({
      role: 'strategy_gen',
      maxTokens: 8000,
      temperature: 0.7,
      systemPrompt: STRATEGY_GEN_PROMPT,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          task: axes.summary,
          decisionAxes: axes.decisionAxes,
          parametricAxes: axes.parametricAxes,
          count: k,
          requirements: [
            'Each strategy must differ on at least one decision axis',
            'For each parametric axis, at least one strategy must use RUNTIME_DERIVE',
            'Strategies represent high-level plans, not token-level variations',
          ],
        }),
      }],
    });

    const strategies: Strategy[] = JSON.parse(response.content).strategies;
    
    // 多样性校验
    this.validateDiversity(strategies, axes.decisionAxes);
    // 参数化轴校验
    this.validateParametricCoverage(strategies, axes.parametricAxes);
    
    return strategies;
  }

  async generateTargeted(
    axes: TaskAxes,
    currentSkill: SkillArtifact,
    prevTrajectories: Trajectory[],
    k: number = 4,
  ): Promise<Strategy[]> {
    // r>0: 针对 v_r 的弱点生成策略
    const failureModes = this.extractFailureModes(prevTrajectories);
    
    const response = await this.llm.complete({
      role: 'strategy_gen',
      maxTokens: 8000,
      temperature: 0.7,
      systemPrompt: STRATEGY_GEN_PROMPT,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          task: axes.summary,
          decisionAxes: axes.decisionAxes,
          currentSkillSummary: this.summarizeSkill(currentSkill),
          failureModes,
          count: k,
          requirements: [
            'Each strategy targets a different observed failure mode',
            'Strategies stress-test the current skill where it is weakest',
          ],
        }),
      }],
    });

    return JSON.parse(response.content).strategies;
  }

  // ===== 多样性校验 =====
  private validateDiversity(strategies: Strategy[], axes: DecisionAxis[]): void {
    for (let i = 0; i < strategies.length; i++) {
      for (let j = i + 1; j < strategies.length; j++) {
        const identical = axes.every(axis => 
          strategies[i].decisions[axis.name] === strategies[j].decisions[axis.name]
        );
        if (identical) {
          throw new Error(`Strategies ${i} and ${j} are identical on all decision axes`);
        }
      }
    }
  }

  // ===== 参数化检查 =====
  private validateParametricCoverage(strategies: Strategy[], axes: ParametricAxis[]): void {
    for (const axis of axes) {
      const hasRuntimeDerive = strategies.some(s => 
        s.parametricValues[axis.name] === 'RUNTIME_DERIVE'
      );
      if (!hasRuntimeDerive) {
        throw new Error(
          `No strategy uses RUNTIME_DERIVE for parametric axis "${axis.name}". ` +
          `At least one strategy must derive this value at runtime.`
        );
      }
    }
  }

  private extractFailureModes(trajectories: Trajectory[]): string[] {
    return trajectories
      .filter(t => t.reward === 0)
      .map(t => t.error ?? 'unknown error');
  }
}
```

#### Strategy 类型

```typescript
export interface Strategy {
  id: string;
  name: string;
  description: string;
  decisions: Record<string, string>;     // axis_name → chosen_value
  parametricValues: Record<string, string>;  // param_name → "RUNTIME_DERIVE" | "INVARIANT"
  failureModeTarget?: string;            // r>0 时: 针对哪个失败模式
  content: string;                       // 策略文件的完整 Markdown 内容
}
```

#### 验收标准

- [ ] K=4 时生成 4 个互不相同的策略
- [ ] 多样性校验：相同策略被拒绝
- [ ] 参数化校验：缺少 RUNTIME_DERIVE 被拒绝
- [ ] r>0 时策略内容引用上一轮的失败模式

---

### Step 2.2: 并行探索（K=4）

**预估**: 2 天  
**依赖**: 1.6, 2.1  
**产出**: K 路并行沙箱执行 + 结果聚合

#### explore.ts 扩展

```typescript
export class ExploreSubPhase {
  async executeParallel(
    task: TaskAxes,
    skill: SkillArtifact | null,
    strategies: Strategy[],
    iteration: number,
  ): Promise<Trajectory[]> {
    // 并发执行
    const promises = strategies.map((strategy, i) => {
      // 每个策略分配独立的 env index
      const env = { ...sandboxEnv, SKILL_TRIAL_INDEX: String(i) };
      return this.executeSingle(task, skill, strategy, iteration, env);
    });

    const results = await Promise.allSettled(promises);

    // 处理部分失败
    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      // 沙箱崩溃 → 返回空轨迹 (reward=0)
      return Trajectory.failed({
        strategyId: strategies[i].id,
        error: (r.reason as Error).message,
      });
    });
  }
}
```

#### 沙箱并发管理

```typescript
export class SandboxManager {
  private activeInstances: Map<string, SandboxInstance> = new Map();
  private maxConcurrent: number;

  constructor(maxConcurrent: number = 4) {
    this.maxConcurrent = maxConcurrent;
  }

  async runParallel(
    configs: SandboxConfig[],
    params: SandboxRunParams[],
  ): Promise<SandboxResult[]> {
    // 信号量控制并发数
    const semaphore = new Semaphore(this.maxConcurrent);
    
    return Promise.all(
      configs.map((config, i) => semaphore.with(async () => {
        const instance = await this.create(config);
        try {
          return await instance.run(params[i]);
        } finally {
          await instance.destroy();
        }
      }))
    );
  }
}
```

#### 验收标准

- [ ] 4 个沙箱同时执行，总耗时 ≈ 最长单个耗时（而非累加）
- [ ] 一个沙箱崩溃不影响其他沙箱
- [ ] 并发数限制生效（maxConcurrent=2 时只有 2 个同时运行）
- [ ] 每个策略的结果正确关联 strategyId

---

### Step 2.3: Auditor Engine（审计引擎）

**预估**: 3 天  
**依赖**: 1.3, 1.4  
**产出**: 9 项审计检查的完整实现

#### 文件结构

```
packages/core/
└── src/
    └── auditor/
        ├── index.ts           # AuditorEngine 主逻辑
        ├── types.ts           # AuditCheck, AuditReport
        ├── static-checks.ts   # Checks 1-6 (静态分析)
        ├── dynamic-checks.ts  # Checks 7-9 (动态分析)
        └── prompts.ts         # Audit LLM prompts
```

#### static-checks.ts — Checks 1-6

```typescript
/**
 * Check 1 (FRAMING): skill 名称/描述是否泄露训练实例的业务名词
 */
export async function checkFraming(
  skill: SkillArtifact,
  taskAxes: TaskAxes,
  llm: LLMRouter,
): Promise<CheckResult> {
  const response = await llm.complete({
    role: 'audit',
    maxTokens: 1000,
    temperature: 0,
    systemPrompt: `Check if the skill's name or description borrows 
training-instance business nouns instead of abstract operations.
Example: "process-medical-intake-form" is a FRAMING leak; 
"process-form-fields" is abstract.
Return JSON: { passed: boolean, evidence?: string }`,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        skillName: skill.skillId,
        skillDescription: extractDescription(skill.skillMd),
        trainingContext: taskAxes.summary,
      }),
    }],
  });
  return JSON.parse(response.content);
}

/**
 * Check 2 (LITERALS): 硬编码训练文件名/字段名
 */
export async function checkLiterals(
  skill: SkillArtifact,
  trainingPaths: string[],  // 训练目录中的所有文件名
  llm: LLMRouter,
): Promise<CheckResult> {
  // 简单方法：检查技能文本中是否直接出现训练文件名
  const skillText = skill.skillMd + Object.values(skill.scripts).join('\n');
  for (const path of trainingPaths) {
    const basename = path.split('/').pop()!;
    if (skillText.includes(basename)) {
      return { passed: false, evidence: `Found training filename "${basename}" in skill text` };
    }
  }
  return { passed: true };
}

/**
 * Check 2b (SCRIPT_BLOAT): 脚本不应超过 200/400 行
 */
export function checkScriptBloat(skill: SkillArtifact): CheckResult {
  for (const [name, content] of Object.entries(skill.scripts)) {
    const lines = content.split('\n').length;
    if (lines > 400) {
      return { passed: false, evidence: `Script "${name}" is ${lines} lines (critical: >400)` };
    }
    if (lines > 200) {
      return { passed: false, evidence: `Script "${name}" is ${lines} lines (important: >200)` };
    }
  }
  return { passed: true };
}

/**
 * Check 3 (UNTRACEABLE): 不可追溯的强制断言
 */
export async function checkUntraceable(
  skill: SkillArtifact,
  traces: Trajectory[],
  llm: LLMRouter,
): Promise<CheckResult> {
  // LLM 检查：skill 中的 "must use X not Y" / "never" / "required"
  // 是否在 trace 中有证据支撑
  const response = await llm.complete({
    role: 'audit',
    maxTokens: 2000,
    temperature: 0,
    systemPrompt: `Identify imperative assertions in the skill 
("use X not Y", "never", "required") and check if they have trace provenance.
If an assertion cannot be traced to any execution evidence, flag it.
Return JSON: { passed: boolean, evidence?: string }`,
    messages: [{
      role: 'user',
      content: JSON.stringify({ skillText: skill.skillMd, traceSummaries: traces.map(summarize) }),
    }],
  });
  return JSON.parse(response.content);
}

/**
 * Check 4 (SHAPE_BAKE): 脚本是否硬编码列/表/键索引
 */
export async function checkShapeBake(skill: SkillArtifact, llm: LLMRouter): Promise<CheckResult> {
  // 静态分析：检查脚本中是否有 df.columns / wb.sheetnames 的运行时探测
  for (const [name, content] of Object.entries(skill.scripts)) {
    const hasHardcodedIndex = /\[\s*['"]\w+['"]\s*\]/.test(content); // 简化检测
    const hasRuntimeProbe = /\.columns|\.sheetnames|\.keys\(\)/.test(content);
    if (hasHardcodedIndex && !hasRuntimeProbe) {
      return { passed: false, evidence: `Script "${name}" uses hardcoded index without runtime probe` };
    }
  }
  return { passed: true };
}

/**
 * Check 5 (COVERAGE): 机械任务缺少打包脚本时标记
 * 
 * 如果任务描述表明这是一个纯操作任务（不需要决策、不需要编程），
 * 但技能中未打包任何脚本，则标记为不充分覆盖。
 * 在 high-pass 模式下可跳过此检查（非关键检查）。
 */
export async function checkCoverage(
  skill: SkillArtifact,
  taskAxes: TaskAxes,
  llm: LLMRouter,
): Promise<CheckResult> {
  // 如果技能已有脚本，自动通过
  if (Object.keys(skill.scripts).length > 0) {
    return { passed: true };
  }

  const response = await llm.complete({
    role: 'audit',
    maxTokens: 500,
    temperature: 0,
    systemPrompt: `Check if this task is a MECHANICAL task that requires bundled scripts.
A task is mechanical if it involves: format conversion, data extraction, template filling,
file transformation, or any operation that benefits from a reusable script.
If the task IS mechanical but the skill has ZERO bundled scripts, flag it.
Return JSON: { passed: boolean, evidence?: string }`,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        taskSummary: taskAxes.summary,
        domain: taskAxes.domain,
        skillScriptCount: Object.keys(skill.scripts).length,
      }),
    }],
  });
  return JSON.parse(response.content);
}

/**
 * Check 6 (XREF): ≥4 字符的字符串匹配训练数据文件名/字段/值
 */
export function checkXref(
  skill: SkillArtifact,
  trainingLiterals: string[],  // 训练数据中的所有字符串常量
): CheckResult {
  // 1. 提取技能中的所有 ≥4 字符的字符串字面量
  const skillText = skill.skillMd + Object.values(skill.scripts).join('\n');
  const stringLiterals = extractStringLiterals(skillText).filter(s => s.length >= 4);
  
  // 2. 交叉比对
  for (const literal of stringLiterals) {
    for (const trainingLiteral of trainingLiterals) {
      if (literal === trainingLiteral) {
        return { passed: false, evidence: `Skill contains literal "${literal}" matching training data` };
      }
    }
  }
  return { passed: true };
}
```

#### dynamic-checks.ts — Checks 7-9

```typescript
/**
 * Check 7 (UNDER_ABSTRACTION): 参数轴常量是否硬编码
 */
export async function checkUnderAbstraction(
  skill: SkillArtifact,
  parametricAxes: ParametricAxis[],
  llm: LLMRouter,
): Promise<CheckResult> {
  const response = await llm.complete({
    role: 'audit',
    maxTokens: 2000,
    temperature: 0,
    systemPrompt: `For each parametric axis, check whether the skill embeds 
the training-specific constant without a sibling "re-derive at runtime" instruction.
Return JSON: { passed: boolean, evidence?: string }`,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        skillText: skill.skillMd,
        parametricAxes,
      }),
    }],
  });
  return JSON.parse(response.content);
}

/**
 * Check 8 (PRIMARY_ACTION_HOISTING): SKILL.md 是否在脚本调用前放约束文
 */
export async function checkPrimaryActionHoisting(
  skill: SkillArtifact,
  llm: LLMRouter,
): Promise<CheckResult> {
  if (Object.keys(skill.scripts).length === 0) return { passed: true };
  
  const response = await llm.complete({
    role: 'audit',
    maxTokens: 1000,
    temperature: 0,
    systemPrompt: `Check if the SKILL.md routes constraints/background prose 
BEFORE the primary script invocation block. If the using-agent reads constraints 
first and never invokes the script, this is a failure.
Return JSON: { passed: boolean, evidence?: string }`,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        skillMd: skill.skillMd,
        scriptNames: Object.keys(skill.scripts),
      }),
    }],
  });
  return JSON.parse(response.content);
}

/**
 * Check 9 (SILENT_BYPASS): 主要脚本在运行时是否从未被调用
 */
export function checkSilentBypass(
  skill: SkillArtifact,
  trajectories: Trajectory[],
): CheckResult {
  const primaryScripts = Object.keys(skill.scripts);
  if (primaryScripts.length === 0) return { passed: true };
  
  // 检查在高失败率的 trace 中，主要脚本是否被调用
  const failTraces = trajectories.filter(t => t.reward === 0);
  if (failTraces.length === 0) return { passed: true };
  
  // 多数失败的 trace 中是否从未调用主要脚本
  let silentCount = 0;
  for (const trace of failTraces) {
    const invoked = trace.steps.some(step => 
      step.type === 'tool_call' && 
      primaryScripts.some(script => step.toolInput?.toString().includes(script))
    );
    if (!invoked) silentCount++;
  }
  
  if (silentCount > failTraces.length / 2) {
    return {
      passed: false,
      evidence: `Primary scripts never invoked in ${silentCount}/${failTraces.length} failing trials — silent bypass`,
    };
  }
  
  return { passed: true };
}
```

#### AuditorEngine 主逻辑

```typescript
export class AuditorEngine {
  constructor(
    private llm: LLMRouter,
    private sandbox: SandboxManager,
  ) {}

  async audit(
    candidateSkill: SkillArtifact,
    taskAxes: TaskAxes,
    trainingContext: {
      paths: string[];
      literals: string[];
    },
    recentTrajectories: Trajectory[],
  ): Promise<AuditReport> {
    // MUST run in fresh session — no context sharing with evolve loop
    
    const checks: CheckResult[] = [];

    // === Static Checks (1-6): can run in parallel ===
    const staticResults = await Promise.all([
      checkFraming(candidateSkill, taskAxes, this.llm),
      checkLiterals(candidateSkill, trainingContext.paths, this.llm),
      Promise.resolve(checkScriptBloat(candidateSkill)),
      checkUntraceable(candidateSkill, recentTrajectories, this.llm),
      checkShapeBake(candidateSkill, this.llm),
      Promise.resolve(checkXref(candidateSkill, trainingContext.literals)),
    ]);

    checks.push(
      { checkId: AuditCheck.FRAMING, ...staticResults[0] },
      { checkId: AuditCheck.LITERALS, ...staticResults[1] },
      { checkId: AuditCheck.SCRIPT_BLOAT, ...staticResults[2] },
      { checkId: AuditCheck.UNTRACEABLE, ...staticResults[3] },
      { checkId: AuditCheck.SHAPE_BAKE, ...staticResults[4] },
      { checkId: AuditCheck.XREF, ...staticResults[5] },
    );

    // === Dynamic Checks (7-9): require trace context ===
    const dynamicResults = await Promise.all([
      checkUnderAbstraction(candidateSkill, taskAxes.parametricAxes, this.llm),
      checkPrimaryActionHoisting(candidateSkill, this.llm),
      Promise.resolve(checkSilentBypass(candidateSkill, recentTrajectories)),
    ]);

    checks.push(
      { checkId: AuditCheck.UNDER_ABSTRACTION, ...dynamicResults[0] },
      { checkId: AuditCheck.PRIMARY_ACTION_HOIST, ...dynamicResults[1] },
      { checkId: AuditCheck.SILENT_BYPASS, ...dynamicResults[2] },
    );

    // === 判决 ===
    const criticalFailures = checks.filter(c => !c.passed && isCritical(c.checkId));
    const verdict = criticalFailures.length > 0 ? 'FAIL' : 'PASS';

    return {
      skillVersion: String(candidateSkill.version),
      timestamp: Date.now(),
      sessionId: uuid(),  // fresh session ID
      checks: checks.map(c => ({
        ...c,
        severity: isCritical(c.checkId) ? 'critical' : 'warning',
      })),
      verdict,
      failReason: verdict === 'FAIL' 
        ? criticalFailures.map(c => c.evidence).join('; ')
        : undefined,
    };
  }
}

function isCritical(checkId: AuditCheck): boolean {
  // Checks marked with ⋆ in the paper
  return [1, 2, 4, 6, 7, 8, 9].includes(checkId);
}
```

#### 验收标准

- [ ] 9 项检查全部可独立运行
- [ ] ⋆ 标记的检查（1,2,4,6,7,8,9）任一命中 → FAIL（Check 5 为非关键检查，high-pass 模式可跳过）
- [ ] Auditor 在独立 fresh session 中运行（不与 evolve loop 共享 LLM 上下文）
- [ ] Check 9（silent bypass）正确检测到脚本未被调用
- [ ] 已知泄露案例被正确检出

---

### Step 2.4: EvolveLoop 完整串接

**预估**: 1.5 天  
**依赖**: 2.1, 2.2, 2.3  
**产出**: R 轮迭代的完整状态机

#### evolve-loop.ts

```typescript
export class EvolveLoop {
  constructor(
    private understand: UnderstandPhase,
    private explore: ExploreSubPhase,
    private update: UpdateSubPhase,
    private auditor: AuditorEngine,
    private strategy: StrategyEngine,
    private config: EvolveLoopConfig,
  ) {}

  async execute(taskPath: string): Promise<EvolveResult> {
    const costTracker = new CostTracker();
    
    // ===== Phase 0: Understand =====
    const axes = await this.understand.execute(taskPath);
    
    // ===== Phase 1..R: Evolve =====
    let currentSkill: SkillArtifact | null = null;
    const allTrajectories: Trajectory[][] = [];
    const auditReports: AuditReport[] = [];

    for (let r = 0; r < this.config.maxIterations; r++) {
      // 1. 生成策略（r>0 时必须有 currentSkill）
      let strategies: Strategy[];
      if (r === 0) {
        strategies = await this.strategy.generateBootstrap(axes, this.config.exploreWidth);
      } else {
        if (!currentSkill) {
          throw new Error(
            `Cannot generate targeted strategies at iteration ${r}: ` +
            `currentSkill is null — all previous trials may have failed. ` +
            `Consider increasing K or adjusting the task.`
          );
        }
        strategies = await this.strategy.generateTargeted(
          axes, currentSkill, allTrajectories[r - 1]
        );
      }

      // 2. 并行探索
      const trajectories = await this.explore.executeParallel(
        axes, currentSkill, strategies, r
      );
      allTrajectories.push(trajectories);

      // 3. 对比更新
      const candidateSkill = await this.update.execute(
        currentSkill, trajectories, axes
      );

      // 4. 审计门控
      const report = await this.auditor.audit(
        candidateSkill,
        axes,
        {
          paths: await this.collectTrainingPaths(taskPath),
          literals: await this.collectTrainingLiterals(taskPath),
        },
        trajectories,
      );
      auditReports.push(report);

      // 5. 退出条件判断
      if (report.verdict === 'FAIL') {
        // 触发 targeted patch（下一轮迭代自动处理）
        continue;
      }

      const passRate = trajectories.filter(t => t.reward === 1).length / trajectories.length;
      if (passRate >= 0.75) {
        currentSkill = candidateSkill;
        if (r > 0) break;  // 至少跑 r=1
      } else {
        currentSkill = candidateSkill; // 即使未达到阈值也继续
      }
    }

    // ===== Finalize =====
    // 选择 pass rate 最高的技能版本
    if (!currentSkill) {
      throw new Error(
        'EvolveLoop failed: no skill was produced after all iterations. ' +
        'All trials across all iterations returned zero reward.'
      );
    }
    const bestSkill = await this.finalize(allTrajectories, currentSkill);

    return {
      skill: bestSkill,
      axes,
      trajectories: allTrajectories.flat(),
      auditReports,
      costUsd: costTracker.getTotalCost(),
    };
  }

  private async finalize(
    allTrajectories: Trajectory[][],
    lastSkill: SkillArtifact,
  ): Promise<SkillArtifact> {
    // 在所有版本中选择训练 pass rate 最高的
    // 论文中：finalize 阶段在 held-out T_val 上运行 V 次验证
    // Phase 2 先简化：直接返回最后一个通过审计的版本
    return lastSkill;
  }
}
```

#### 验收标准

- [ ] R=2 完整流程：understand → 2 轮 {策略 → 探索 → 更新 → 审计}
- [ ] 审计失败时自动触发下一轮 targeted patch
- [ ] 退出条件：pass_rate ≥ 75% 且 r ≥ 1
- [ ] 成本在预算内自动中断

---

### Step 2.5: Finalize Phase（定稿验证）

**预估**: 1 天  
**依赖**: 2.4  
**注意**: Step 2.4 的 `EvolveLoop.finalize()` 是 Phase 1/2 的简化版（直接返回最后通过审计的技能）。
本 Step 的 `FinalizePhase` 是完整版——在 held-out T_val 上对多个候选技能运行 V 次验证，
选择 avg reward 最高的版本。两者不矛盾：简化版用于快速原型，完整版用于生产部署。  
**产出**: Held-out 验证 + 最优技能选择

```typescript
export class FinalizePhase {
  async execute(
    candidateSkills: SkillArtifact[],
    validationTaskPath: string,
    v: number = 5,
  ): Promise<SkillArtifact> {
    const scores: Array<{ skill: SkillArtifact; avgReward: number }> = [];

    for (const skill of candidateSkills) {
      let totalReward = 0;
      for (let i = 0; i < v; i++) {
        const result = await this.explore.executeSingle(
          /* validation task */, skill, /* no strategy */, 0
        );
        totalReward += result.reward;
      }
      scores.push({ skill, avgReward: totalReward / v });
    }

    // 选择 avg reward 最高的技能
    scores.sort((a, b) => b.avgReward - a.avgReward);
    return scores[0].skill;
  }
}
```

---

### Step 2.6: Trace Engine（轨迹引擎）

**预估**: 1.5 天  
**依赖**: 1.6  
**产出**: 轨迹持久化 + 查询 + φ() 特征提取

```typescript
export class TraceEngine {
  constructor(private db: Database) {} // SQLite

  async save(trajectory: Trajectory): Promise<void> {
    // 存入 SQLite
    await this.db.run(`
      INSERT INTO trajectories (id, task_id, iteration, strategy_id, reward, steps_json, ...)
      VALUES (?, ?, ?, ?, ?, ?, ...)
    `, [trajectory.id, ...]);
  }

  async queryByTask(taskId: string): Promise<Trajectory[]> { /* ... */ }
  async queryByIteration(taskId: string, r: number): Promise<Trajectory[]> { /* ... */ }
  
  // φ() 函数 — 论文中的特征提取
  async extractFeatures(trajectories: Trajectory[]): Promise<string[]> {
    // 使用 LLM 提取任务相关特征
    // 等价于论文中的 φ(τ)
    const response = await this.llm.complete({
      role: 'contrast',
      maxTokens: 4000,
      temperature: 0.2,
      systemPrompt: 'Extract task-relevant features from these trajectories...',
      messages: [{ role: 'user', content: JSON.stringify(trajectories.map(this.summarize)) }],
    });
    return JSON.parse(response.content).features;
  }
}

// SQLite schema
/*
CREATE TABLE trajectories (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  strategy_id TEXT NOT NULL,
  skill_version TEXT,
  reward REAL NOT NULL,
  success INTEGER NOT NULL,
  steps_json TEXT NOT NULL,  -- JSON array of Step
  total_tokens INTEGER,
  total_turns INTEGER,
  wall_clock_ms INTEGER,
  sandbox_id TEXT,
  model_name TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_trajectories_task ON trajectories(task_id);
CREATE INDEX idx_trajectories_iteration ON trajectories(task_id, iteration);
*/
```

---

## Phase 3: 生产加固（预估 12 人天）

> 目标：可靠、安全、可观测的生产级系统

---

### Step 3.1: Anti-Leak Layer 完整实现

**预估**: 2 天  
**依赖**: 1.4  
**产出**: 五层防护全部就位

| 层级 | 实现细节 |
|------|---------|
| L1 Train/Test Split | 训练和验证使用不同的任务实例、文件名和数据文件 |
| L2 Workspace Whitelist | PreToolUse hook 拦截，拒绝白名单外路径 |
| L3 Path Denylist | 拒绝 `..`，解析 symlink 后二次检查 |
| L4 Curated Skill Deletion | 每次探索前从源删除人工 skill |
| L5 Fresh Session | Auditor 和 Finalizer 每次新建 LLM 上下文 |

```typescript
// L2 + L3 合并实现
export function createAntiLeakHook(workspacePrefix: string): ToolCallHook {
  const DENY_PATTERNS = [
    /\.\./,                          // 路径遍历
    /curated.?skill/i,              // curated skill 目录
    /\/etc\//,                       // 系统目录
    /\/proc\//,
    /\/sys\//,
    /\.env$/,
    /\.git\//,
  ];

  return (tool: ToolCall): ToolCall | null => {
    for (const [key, value] of Object.entries(tool.input)) {
      if (typeof value === 'string' && isPathLike(value)) {
        // 解析绝对路径
        const resolved = path.resolve(workspacePrefix, value);
        
        // 检查黑名单
        for (const pattern of DENY_PATTERNS) {
          if (pattern.test(resolved)) return null;
        }
        
        // 解析 symlink
        let realPath: string;
        try { realPath = fs.realpathSync(resolved); } catch { return null; }
        
        // symlink 目标也在黑名单内
        for (const pattern of DENY_PATTERNS) {
          if (pattern.test(realPath)) return null;
        }
        
        // 必须在白名单内
        if (!realPath.startsWith(workspacePrefix)) return null;
      }
    }
    return tool;
  };
}
```

---

### Step 3.2: 错误处理与重试

**预估**: 2 天  
**产出**: 优雅降级 + 自动恢复

```typescript
// LLM 调用重试
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries: number; baseDelayMs: number } = { maxRetries: 3, baseDelayMs: 1000 },
): Promise<T> {
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === options.maxRetries) throw error;
      if (isRetryableError(error)) {
        const delay = options.baseDelayMs * Math.pow(2, attempt);
        logger.warn(`Retry ${attempt + 1}/${options.maxRetries} after ${delay}ms: ${error.message}`);
        await sleep(delay);
      } else {
        throw error;  // 不可重试错误直接抛出
      }
    }
  }
  throw new Error('unreachable');
}

// 沙箱崩溃恢复
export async function withSandboxRecovery(
  sandbox: SandboxManager,
  config: SandboxConfig,
  fn: (instance: SandboxInstance) => Promise<SandboxResult>,
): Promise<SandboxResult> {
  let attempt = 0;
  while (attempt < 2) {
    const instance = await sandbox.create(config);
    try {
      return await fn(instance);
    } catch (error) {
      await instance.destroy();
      if (attempt === 1) throw error;
      logger.warn(`Sandbox crashed, recreating: ${error.message}`);
    }
    attempt++;
  }
  throw new Error('unreachable');
}
```

---

### Step 3.3: 成本预算控制

**预估**: 1 天

```typescript
export class BudgetController {
  private spent: number = 0;
  
  constructor(private maxUsd: number) {}

  checkBeforeCall(estimatedCost: number): void {
    if (this.spent + estimatedCost > this.maxUsd) {
      throw new BudgetExceededError(
        `Budget exceeded: spent $${this.spent.toFixed(2)} / $${this.maxUsd.toFixed(2)}`
      );
    }
  }

  record(actualCost: number): void {
    this.spent += actualCost;
  }

  getRemaining(): number {
    return this.maxUsd - this.spent;
  }
}
```

---

### Step 3.4: 可观测性

**预估**: 2 天

- OpenTelemetry tracing：每个 Phase 一个 span
- 结构化日志（Pino）：JSON 格式，含 traceId / taskId / iteration
- Metrics：成本、成功率、迭代次数、耗时

---

### Step 3.5: CLI 工具

**预估**: 2 天

```bash
# 进化一个技能
skillevolver evolve --task ./tasks/jpg-ocr-stat \
  --max-iterations 2 \
  --explore-width 4 \
  --budget 15

# 审计一个已有技能
skillevolver audit --skill ./skills/manufacturing-fjsp \
  --task ./tasks/manufacturing-fjsp/train

# 部署技能到目标 Agent
skillevolver deploy --skill ./skills/manufacturing-fjsp \
  --agent claude-code

# 查看进化状态
skillevolver status --task-id manufacturing-fjsp
```

---

## Phase 4: 扩展与生态（预估 15 人天）

> 目标：多 LLM、多 Agent 框架、规模化部署

---

### Step 4.1: 多 LLM 支持（2 天）

- LiteLLM 统一网关
- 开源模型适配（Ollama, vLLM）
- 跨模型基准对比脚本

### Step 4.2: 多 Agent 框架适配（3 天）

- Agent 接口抽象：`ClaudeCodeAdapter`, `CodexCLIAdapter`, `LangChainAdapter`
- 统一轨迹格式转换
- 各框架的 hook 机制适配

### Step 4.3: 分布式沙箱（3 天）

- Harbor 集群（Kubernetes Job per trial）
- Redis 任务队列（BullMQ）
- Worker 自动扩缩容
- 结果回传与聚合

### Step 4.4: 技能市场（3 天）

- 技能发布 / 搜索 / 安装
- 评分与评论
- 跨任务技能复用检测
- 技能签名与供应链安全

### Step 4.5: 基准测试套件（4 天）

- SkillsBench 83 任务自动化 pipeline
- KernelBench GPU 任务集成
- 回归测试（已知案例：court-form-filling, invoice-fraud-detection 等）
- CI 中每日运行子集

---

## 里程碑检查清单

### 🏁 Milestone 1: Demo 可用（Phase 1 完成）
- [ ] 单个 SkillsBench 任务从零进化出技能，准确率 > No-Skill 基线
- [ ] 全流程成本 < $5
- [ ] 产物技能可被独立 Agent 加载使用

### 🏁 Milestone 2: 论文复现（Phase 2 完成）
- [ ] SkillsBench 83 任务 avg@5 达到或接近 56.9%（论文报告值）
- [ ] R=2 相比 R=1 有显著增益
- [ ] 9 项审计检查全部生效

### 🏁 Milestone 3: 生产就绪（Phase 3 完成）
- [ ] 所有错误场景有优雅降级，无 unhandled crash
- [ ] 零信息泄露（通过安全审计）
- [ ] Dashboard 实时展示进化进度

### 🏁 Milestone 4: 规模化（Phase 4 完成）
- [ ] 3 种 LLM 2 种 Agent 框架可互换
- [ ] 分布式沙箱支持 20+ 并发
- [ ] 基准测试 CI 每日运行无回归

---

## 附录 A: 关键代码模板

### A.1 Skill 文件模板（SKILL.md）

```markdown
# {Task Name}

## Quick Start
{一句话描述这个技能解决什么问题}

## Primary Action
{主要脚本调用方式}

```bash
python scripts/primary.py --input $INPUT --output $OUTPUT
```

## Constraints
- {从进化中学习的约束 1}
- {约束 2}

## Common Pitfalls
- {常见陷阱及避免方法}

## Scripts
- `scripts/primary.py`: {说明}
- `scripts/utils.py`: {说明}
```

### A.2 策略文件模板（strategy_{i}.md）

```markdown
# Strategy: {name}

## High-Level Plan
{高层方案描述}

## Decision Axes
- library: {choice}
- algorithm: {choice}

## Parametric Values
- {param}: RUNTIME_DERIVE
- {param}: INVARIANT

## Target Failure Mode (if r > 0)
{上一轮观察到的失败模式}
```
