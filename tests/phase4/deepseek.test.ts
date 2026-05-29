import { describe, it, expect } from 'vitest';
import { DeepSeekAdapter, extractJSON } from '@skillevolver/core';

const API_KEY = process.env.DEEPSEEK_API_KEY;

describe('DeepSeek API Integration', () => {
  const skipIfNoKey = API_KEY ? it : it.skip;

  skipIfNoKey('completes a simple chat', async () => {
    const adapter = new DeepSeekAdapter(API_KEY);
    const resp = await adapter.complete({
      role: 'understand',
      maxTokens: 100,
      temperature: 0,
      systemPrompt: 'Reply with only the word "OK" in uppercase.',
      messages: [{ role: 'user', content: 'test' }],
    });

    console.log('DeepSeek response:', resp.content.slice(0, 200));
    console.log('Model:', resp.model);
    console.log('Tokens:', resp.usage);
    console.log('Cost:', '$' + resp.usage.costUsd.toFixed(6));

    expect(resp.content).toBeTruthy();
    expect(resp.usage.inputTokens).toBeGreaterThan(0);
  });

  it('supports deepseek models', () => {
    const adapter = new DeepSeekAdapter(API_KEY);
    expect(adapter.supportsModel('deepseek-v4-flash')).toBe(true);
    expect(adapter.supportsModel('deepseek-v4-pro')).toBe(true);
    expect(adapter.supportsModel('gpt-4')).toBe(false);
    expect(adapter.provider).toBe('deepseek');
  });

  skipIfNoKey('generates a task understanding response', async () => {
    const adapter = new DeepSeekAdapter(API_KEY);
    const resp = await adapter.complete({
      role: 'understand',
      maxTokens: 500,
      temperature: 0.1,
      systemPrompt: `Analyze this task and output JSON with: domain, decisionAxes, parametricAxes, rewardType, summary.
Task: Count words in a text file and output JSON stats.`,
      messages: [{
        role: 'user',
        content: 'Task: word-counter\nInput: text file\nOutput: JSON stats with word count',
      }],
    });

    console.log('Understand response:', resp.content.slice(0, 300));

    const parsed = extractJSON(resp.content);
    expect(parsed).toBeTruthy();

    const result = JSON.parse(parsed);
    expect(result.domain).toBeTruthy();
    expect(result.rewardType).toBeTruthy();

    console.log('Parsed:', JSON.stringify(result, null, 2).slice(0, 300));
  }, 30000);
});
