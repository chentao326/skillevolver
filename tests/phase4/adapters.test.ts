import { describe, it, expect } from 'vitest';
import { MockAdapter, AdapterRouter, AnthropicAdapter, OpenAIAdapter } from '@skillevolver/core';
import { WorkerPool, computeProgress } from '@skillevolver/core';

describe('LLM Adapters', () => {
  it('MockAdapter returns preset responses', async () => {
    const mock = new MockAdapter();
    mock.setResponse('test', '{"answer": 42}');
    const resp = await mock.complete({
      role: 'understand', maxTokens: 100, temperature: 0,
      systemPrompt: '', messages: [{ role: 'user', content: 'test' }],
    });
    expect(resp.content).toBe('{"answer": 42}');
    expect(resp.usage.costUsd).toBe(0);
  });

  it('supportsModel works for all adapters', () => {
    expect(new MockAdapter().supportsModel('mock-model')).toBe(true);
    expect(new AnthropicAdapter('k').supportsModel('claude-opus-4')).toBe(true);
    expect(new OpenAIAdapter('k').supportsModel('gpt-5')).toBe(true);
  });

  it('AdapterRouter routes correctly', () => {
    const mock = new MockAdapter();
    const router = new AdapterRouter([mock]);
    expect(router.route('mock-model')).toBe(mock);
  });

  it('AdapterRouter lists all models', () => {
    const router = new AdapterRouter([new AnthropicAdapter('k'), new OpenAIAdapter('k')]);
    const models = router.listAllModels();
    expect(models.some(m => m.startsWith('claude-'))).toBe(true);
    expect(models.some(m => m.startsWith('gpt-'))).toBe(true);
  });
});

describe('WorkerPool', () => {
  it('executes tasks concurrently', async () => {
    const pool = new WorkerPool(2);
    const start = Date.now();
    const results = await pool.executeAll([
      { id: 'a', task: () => new Promise<string>(r => setTimeout(() => r('a'), 50)) },
      { id: 'b', task: () => new Promise<string>(r => setTimeout(() => r('b'), 50)) },
      { id: 'c', task: () => new Promise<string>(r => setTimeout(() => r('c'), 50)) },
      { id: 'd', task: () => new Promise<string>(r => setTimeout(() => r('d'), 50)) },
    ]);
    expect(Date.now() - start).toBeLessThan(200);
    expect(results.map(r => r.value)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('handles failures gracefully', async () => {
    const pool = new WorkerPool(2);
    const results = await pool.executeAll([
      { id: 'ok', task: () => Promise.resolve('ok') },
      { id: 'fail', task: () => Promise.reject(new Error('boom')) },
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
  });

  it('computeProgress tracks stats', () => {
    const pool = new WorkerPool(2);
    const results = [
      { id: 'a', status: 'fulfilled' as const, value: 'a', durationMs: 100 },
      { id: 'b', status: 'rejected' as const, error: 'e', durationMs: 200 },
    ];
    const p = computeProgress(results, pool);
    expect(p.succeeded).toBe(1);
    expect(p.failed).toBe(1);
  });
});
