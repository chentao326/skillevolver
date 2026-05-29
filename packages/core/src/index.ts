// ============================================================================
// SkillEvolver Core — 公共 API
// 论文: SkillEvolver: Skill Learning as a Meta-Skill (arXiv:2605.10500)
// ============================================================================

// 类型
export * from './types.js';

// LLM
export { LLMRouter, CostTracker } from './llm/index.js';
export { AnthropicAdapter, OpenAIAdapter, DeepSeekAdapter, MockAdapter, AdapterRouter } from './llm/adapter.js';
export type { LLMAdapter } from './llm/adapter.js';
export { DEFAULT_MODEL_MAP, PRICING } from './llm/types.js';

// 阶段
export { UnderstandPhase, ExploreSubPhase, UpdateSubPhase, StrategyEngine, createBootstrapSkill } from './phases/index.js';

// 审计
export { AuditorEngine } from './auditor/index.js';

// 工具
export { withRetry, isRetryableError } from './utils/retry.js';
export { extractJSON, safeParseJSON } from './utils/json.js';
export { WorkerPool, computeProgress } from './worker-pool.js';
export type { WorkItem, WorkResult, PoolProgress } from './worker-pool.js';

// 轨迹引擎
export { TraceEngine } from './trace-engine.js';

// 编排器
export { SkillEvolver } from './orchestrator.js';
