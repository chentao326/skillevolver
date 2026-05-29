// ============================================================================
// SkillEvolver 核心类型定义
// 对应论文: SkillEvolver: Skill Learning as a Meta-Skill (arXiv:2605.10500)
// ============================================================================

// ===== 技能工件 =====
export interface SkillArtifact {
  skillId: string;
  domain: string;
  taskSlug: string;
  version: number;
  skillMd: string;                          // SKILL.md 正文
  scripts: Record<string, string>;          // filename → content
  references: Record<string, string>;       // filename → content
  metadata: SkillMetadata;
  checksum: string;
}

export interface SkillMetadata {
  createdAt: string;
  evolveStats: {
    iterations: number;
    totalTrials: number;
    totalCostUsd: number;
    trainingPassRate: number;
    validationPassRate: number;
  };
  model: string;
  parentVersion?: number;
}

// ===== 任务结构 =====
export interface TaskAxes {
  taskSlug: string;
  taskPath: string;
  domain: string;
  decisionAxes: DecisionAxis[];
  parametricAxes: ParametricAxis[];
  invariantAxes: InvariantAxis[];
  rewardType: 'binary' | 'scalar';
  summary: string;
}

export interface DecisionAxis {
  name: string;
  options: string[];
  description: string;
}

export interface ParametricAxis {
  name: string;
  trainingValue: string;
  derivationRule: string;
}

export interface InvariantAxis {
  name: string;
  value: string;
}

// ===== 策略 =====
export interface Strategy {
  id: string;
  name: string;
  description: string;
  decisions: Record<string, string>;
  parametricValues: Record<string, string>;
  failureModeTarget?: string;
  content: string;
}

// ===== 轨迹 =====
export interface Trajectory {
  id: string;
  taskId: string;
  iteration: number;
  strategyId: string;
  skillVersion?: string;
  steps: Step[];
  totalTokens: number;
  totalTurns: number;
  wallClockMs: number;
  reward: number;
  success: boolean;
  error?: string;
  sandboxId: string;
  modelName: string;
  timestamp: number;
}

export interface Step {
  type: 'think' | 'tool_call' | 'tool_result' | 'message';
  content: string;
  tokens: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
}

// ===== 审计 =====
export enum AuditCheck {
  FRAMING = 1,
  LITERALS = 2,
  SCRIPT_BLOAT = '2b',
  UNTRACEABLE = 3,
  SHAPE_BAKE = 4,
  COVERAGE = 5,
  XREF = 6,
  UNDER_ABSTRACTION = 7,
  PRIMARY_ACTION_HOIST = 8,
  SILENT_BYPASS = 9,
}

export interface CheckResult {
  passed: boolean;
  evidence?: string;
}

export interface AuditReport {
  skillVersion: string;
  timestamp: number;
  sessionId: string;
  checks: Array<{
    checkId: AuditCheck;
    passed: boolean;
    evidence?: string;
    severity: 'critical' | 'warning';
  }>;
  verdict: 'PASS' | 'FAIL';
  failReason?: string;
  patchHint?: string;
}

// ===== 对比结果 =====
export interface ContrastResult {
  winnerFeatures: string[];
  loserFeatures: string[];
  diff: string[];
  analysis: string;
  patchTarget: 'skill_body' | 'scripts' | 'description' | 'constraints';
}

// ===== LLM =====
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

// ===== 配置 =====
export interface EvolveLoopConfig {
  maxIterations: number;
  exploreWidth: number;
  validationTrials: number;
  harborTimeout: number;
  budget: {
    maxCostUSD: number;
    maxTurns: number;
  };
}

export interface EvolveResult {
  skill: SkillArtifact;
  axes: TaskAxes;
  trajectories: Trajectory[];
  auditReports: AuditReport[];
  costUsd: number;
}
