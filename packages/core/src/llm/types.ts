import type { LLMConfig, LLMResponse, ModelRole } from '../types.js';

export const DEFAULT_MODEL_MAP: Record<ModelRole, { model: string; temperature: number }> = {
  understand:   { model: 'claude-opus-4-20250514', temperature: 0.1 },
  strategy_gen: { model: 'claude-opus-4-20250514', temperature: 0.7 },
  contrast:     { model: 'claude-opus-4-20250514', temperature: 0.2 },
  synthesize:   { model: 'claude-opus-4-20250514', temperature: 0.2 },
  audit:        { model: 'claude-opus-4-20250514', temperature: 0.0 },
  domain_agent: { model: 'deepseek-v4-flash', temperature: 0.0 },
};

// 定价参考 ($/1M tokens)
export const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-20250514':   { input: 15.0, output: 75.0 },
  'claude-sonnet-4-20250514': { input: 3.0,  output: 15.0 },
  'gpt-5':                    { input: 12.5, output: 50.0 },
  'gpt-4o':                  { input: 2.5,  output: 10.0 },
  'deepseek-v4-pro':          { input: 0.27, output: 1.10 },
  'deepseek-v4-flash':        { input: 0.14, output: 0.55 },
};

export function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

export type { LLMConfig, LLMResponse, ModelRole };
