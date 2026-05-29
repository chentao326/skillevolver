import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { LLMConfig, LLMResponse, ModelRole } from '../types.js';
import { DEFAULT_MODEL_MAP, calcCost, PRICING } from './types.js';

/**
 * LLM Adapter 接口 — 支持任意 LLM 提供商
 * 对应 DEVELOPMENT.md Step 4.1 多 LLM 支持
 */
export interface LLMAdapter {
  readonly provider: string;
  complete(config: LLMConfig): Promise<LLMResponse>;
  listModels(): string[];
  supportsModel(model: string): boolean;
}

// ===== Anthropic Adapter =====
export class AnthropicAdapter implements LLMAdapter {
  readonly provider = 'anthropic';
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
  }

  async complete(config: LLMConfig): Promise<LLMResponse> {
    const model = config.model ?? DEFAULT_MODEL_MAP[config.role].model;
    const systemParts = [config.systemPrompt];
    const messages = config.messages
      .filter((m): m is { role: 'user' | 'assistant'; content: string } =>
        m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    const resp = await this.client.messages.create({
      model, max_tokens: config.maxTokens, temperature: config.temperature,
      system: systemParts.join('\n\n'), messages,
    });

    let content = '';
    for (const block of resp.content) {
      if (block.type === 'text') content += block.text + '\n';
    }

    return {
      content: content.trim(),
      usage: {
        inputTokens: resp.usage.input_tokens,
        outputTokens: resp.usage.output_tokens,
        costUsd: calcCost(model, resp.usage.input_tokens, resp.usage.output_tokens),
      },
      model,
    };
  }

  listModels(): string[] { return Object.keys(PRICING).filter((m) => m.startsWith('claude-')); }
  supportsModel(model: string): boolean { return model.startsWith('claude-'); }
}

// ===== OpenAI Adapter =====
export class OpenAIAdapter implements LLMAdapter {
  readonly provider = 'openai';
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
  }

  async complete(config: LLMConfig): Promise<LLMResponse> {
    const model = config.model ?? DEFAULT_MODEL_MAP[config.role].model;
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: config.systemPrompt },
      ...config.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    const resp = await this.client.chat.completions.create({
      model, max_tokens: config.maxTokens, temperature: config.temperature, messages,
    });

    const content = resp.choices[0]?.message?.content ?? '';

    return {
      content,
      usage: {
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
        costUsd: calcCost(model, resp.usage?.prompt_tokens ?? 0, resp.usage?.completion_tokens ?? 0),
      },
      model,
    };
  }

  listModels(): string[] { return Object.keys(PRICING).filter((m) => m.startsWith('gpt-')); }
  supportsModel(model: string): boolean { return model.startsWith('gpt-'); }
}


// ===== DeepSeek Adapter (OpenAI-compatible) =====
export class DeepSeekAdapter implements LLMAdapter {
  readonly provider = 'deepseek';
  private _client: OpenAI | null = null;
  private _baseURL: string;

  constructor(private apiKey?: string, baseURL?: string) {
    this._baseURL = baseURL ?? 'https://api.deepseek.com/v1';
  }

  private get client(): OpenAI {
    if (!this._client) {
      const key = this.apiKey ?? process.env.DEEPSEEK_API_KEY;
      this._client = new OpenAI({ apiKey: key, baseURL: this._baseURL });
    }
    return this._client;
  }

  async complete(config: LLMConfig): Promise<LLMResponse> {
    // 如果传入的是非 DeepSeek 模型名（如 claude-opus），使用默认 DeepSeek 模型
    const model = (config.model && config.model.startsWith('deepseek-')) ? config.model : 'deepseek-v4-flash';
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: config.systemPrompt },
      ...config.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    const resp = await this.client.chat.completions.create({
      model, max_tokens: config.maxTokens, temperature: config.temperature, messages,
    });

    const content = resp.choices[0]?.message?.content ?? '';
    const inputTokens = resp.usage?.prompt_tokens ?? 0;
    const outputTokens = resp.usage?.completion_tokens ?? 0;

    // DeepSeek pricing: $0.27/$1.10 per 1M tokens (input/output) for deepseek-chat
    const costUsd = (inputTokens / 1_000_000) * 0.27 + (outputTokens / 1_000_000) * 1.10;

    return { content, usage: { inputTokens, outputTokens, costUsd }, model };
  }

  listModels(): string[] { return ['deepseek-v4-pro', 'deepseek-v4-flash']; }
  supportsModel(model: string): boolean { return model.startsWith('deepseek-v'); }
}

// ===== Mock Adapter (测试用) =====
export class MockAdapter implements LLMAdapter {
  readonly provider = 'mock';
  private responses: Map<string, string> = new Map();

  setResponse(prompt: string, response: string): void {
    this.responses.set(prompt, response);
  }

  async complete(config: LLMConfig): Promise<LLMResponse> {
    const model = 'mock-model';
    const key = config.messages[config.messages.length - 1]?.content?.slice(0, 50) ?? '';
    let content = this.responses.get(key);
    if (!content) {
      // Default: return valid mock data for any unmatched prompt
      content = JSON.stringify({
        strategies: [
          { id: "s1", name: "Approach A", description: "Use primary", decisions: {}, parametricValues: {}, content: "# Strategy A" },
          { id: "s2", name: "Approach B", description: "Use alternative", decisions: {}, parametricValues: {}, content: "# Strategy B" }
        ],
        diff: ["use standard approach"],
        winnerFeatures: ["correct implementation"],
        loserFeatures: [],
        analysis: "default",
        patchTarget: "skill_body",
        skillMd: "# Generated Skill\n\n## Primary Action\n```bash\npython run.py\n```",
        newScripts: {},
        modifiedScripts: {},
        changesSummary: "Auto-generated",
        passed: true
      });
    }

    return {
      content,
      usage: { inputTokens: 100, outputTokens: 50, costUsd: 0 },
      model,
    };
  }

  listModels(): string[] { return ['mock-model']; }
  supportsModel(model: string): boolean { return model === 'mock-model'; }
}

// ===== Adapter Router =====
export class AdapterRouter {
  private adapters: LLMAdapter[] = [];
  private defaultAdapter: LLMAdapter;

  constructor(adapters: LLMAdapter[]) {
    this.adapters = adapters;
    this.defaultAdapter = adapters[0];
  }

  route(model?: string): LLMAdapter {
    if (!model) return this.defaultAdapter;
    for (const adapter of this.adapters) {
      if (adapter.supportsModel(model)) return adapter;
    }
    return this.defaultAdapter;
  }

  addAdapter(adapter: LLMAdapter): void {
    this.adapters.push(adapter);
  }

  listAllModels(): string[] {
    return this.adapters.flatMap((a) => a.listModels());
  }
}
