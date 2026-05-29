import type { LLMConfig, LLMResponse, ModelRole } from '../types.js';
import { DEFAULT_MODEL_MAP } from './types.js';
import { AdapterRouter, AnthropicAdapter, OpenAIAdapter, DeepSeekAdapter } from './adapter.js';

// ===== 成本追踪 =====
interface UsageEntry {
  role: ModelRole;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: number;
}

export class CostTracker {
  private usage: UsageEntry[] = [];

  record(entry: UsageEntry): void { this.usage.push(entry); }
  getTotalCost(): number { return this.usage.reduce((s, u) => s + u.costUsd, 0); }
  getCostByRole(): Record<string, number> {
    const byRole: Record<string, number> = {};
    for (const u of this.usage) byRole[u.role] = (byRole[u.role] ?? 0) + u.costUsd;
    return byRole;
  }
  isOverBudget(maxUsd: number): boolean { return this.getTotalCost() > maxUsd; }
  reset(): void { this.usage = []; }
}

// ===== LLM Router =====
export class LLMRouter {
  private _adapterRouter?: AdapterRouter;
  private costTracker: CostTracker;
  private options: { anthropicKey?: string; openaiKey?: string };

  constructor(options?: { anthropicKey?: string; openaiKey?: string }) {
    this.options = options ?? {};
    this.costTracker = new CostTracker();
  }

  private get adapterRouter(): AdapterRouter {
    if (!this._adapterRouter) {
      this._adapterRouter = new AdapterRouter([
        new AnthropicAdapter(this.options.anthropicKey),
        new OpenAIAdapter(this.options.openaiKey),
        new DeepSeekAdapter(process.env.DEEPSEEK_API_KEY),
      ]);
    }
    return this._adapterRouter;
  }

  async complete(config: LLMConfig): Promise<LLMResponse> {
    const modelInfo = DEFAULT_MODEL_MAP[config.role];
    const model = config.model ?? modelInfo.model;
    const adapter = this.adapterRouter.route(model);
    const response = await adapter.complete({ ...config, model });

    this.costTracker.record({
      role: config.role,
      model: response.model,
      ...response.usage,
      timestamp: Date.now(),
    });

    return response;
  }

  getCosts(): CostTracker { return this.costTracker; }
}
