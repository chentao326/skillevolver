import { describe, it, expect } from 'vitest';
import { extractJSON, safeParseJSON } from '../src/utils/json.js';
import { withRetry, isRetryableError } from '../src/utils/retry.js';
import { CostTracker } from '../src/llm/router.js';

// ========================
// extractJSON
// ========================

describe('extractJSON', () => {
  it('extracts JSON from markdown code block', () => {
    const out = extractJSON('```json\n{"a": 1}\n```');
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it('extracts JSON from generic code fence', () => {
    const out = extractJSON('```\n{"b": 2}\n```');
    expect(JSON.parse(out)).toEqual({ b: 2 });
  });

  it('finds first balanced braces object', () => {
    const out = extractJSON('prefix text {"x": "y"} suffix');
    expect(JSON.parse(out)).toEqual({ x: 'y' });
  });

  it('handles nested objects', () => {
    const out = extractJSON('before {"outer": {"inner": [1,2]}} after');
    expect(JSON.parse(out)).toEqual({ outer: { inner: [1, 2] } });
  });

  it('skips stale braces in strings', () => {
    const out = extractJSON('{"msg": "a {b} c"}');
    expect(JSON.parse(out)).toEqual({ msg: 'a {b} c' });
  });

  it('returns original text when no braces found', () => {
    expect(extractJSON('just some text')).toBe('just some text');
  });

  it('returns extracted plain text when JSON is invalid', () => {
    const out = extractJSON('```json\n{broken\n```');
    expect(out).toContain('broken');
  });
});

// ========================
// safeParseJSON
// ========================

describe('safeParseJSON', () => {
  it('parses valid JSON from markdown fence', () => {
    const result = safeParseJSON<{ name: string }>('```\n{"name": "alice"}\n```');
    expect(result).toEqual({ name: 'alice' });
  });

  it('parses valid JSON without fence', () => {
    const result = safeParseJSON<{ ok: boolean }>('{"ok": true}');
    expect(result).toEqual({ ok: true });
  });

  it('throws descriptive error for invalid JSON', () => {
    expect(() => safeParseJSON('not json at all', 'testCtx'))
      .toThrow(/testCtx/);
  });

  it('includes preview in error message', () => {
    expect(() => safeParseJSON('abcdefghijklmnopqrstuvwxyz'))
      .toThrow(/abcdefghijklmnopqr/);
  });
});

// ========================
// isRetryableError
// ========================

describe('isRetryableError', () => {
  it('returns true for HTTP 429', () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
  });

  it('returns true for HTTP 502 503 504', () => {
    expect(isRetryableError({ status: 502 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
    expect(isRetryableError({ status: 504 })).toBe(true);
  });

  it('returns true for connection errors', () => {
    expect(isRetryableError({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryableError({ code: 'ETIMEDOUT' })).toBe(true);
  });

  it('returns true for rate limit messages', () => {
    expect(isRetryableError({ message: 'Rate limit exceeded' })).toBe(true);
    expect(isRetryableError({ message: 'too many requests' })).toBe(true);
    expect(isRetryableError({ message: 'Server overloaded' })).toBe(true);
  });

  it('returns false for normal errors', () => {
    expect(isRetryableError({ message: 'invalid input' })).toBe(false);
    expect(isRetryableError({ status: 400 })).toBe(false);
    expect(isRetryableError({})).toBe(false);
  });
});

// ========================
// withRetry
// ========================

describe('withRetry', () => {
  it('returns result on first success', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries on retryable errors then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw { status: 429, message: 'Rate limit' };
        return 'recovered';
      },
      { maxRetries: 3, baseDelayMs: 1 },
    );
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('throws immediately for non-retryable errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw { status: 400, message: 'Bad request' };
        },
        { maxRetries: 2, baseDelayMs: 1 },
      ),
    ).rejects.toEqual({ status: 400, message: 'Bad request' });
    expect(calls).toBe(1);
  });

  it('throws after exhausting maxRetries', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw { message: 'Rate limit' };
        },
        { maxRetries: 2, baseDelayMs: 1 },
      ),
    ).rejects.toEqual({ message: 'Rate limit' });
    expect(calls).toBe(3); // initial + 2 retries
  });
});

// ========================
// CostTracker
// ========================

describe('CostTracker', () => {
  it('starts with zero cost', () => {
    const ct = new CostTracker();
    expect(ct.getTotalCost()).toBe(0);
  });

  it('accumulates costs across roles', () => {
    const ct = new CostTracker();
    ct.record({ role: 'understand', model: 'claude-opus', inputTokens: 1000, outputTokens: 100, costUsd: 0.05, timestamp: Date.now() });
    ct.record({ role: 'audit', model: 'claude-opus', inputTokens: 500, outputTokens: 50, costUsd: 0.02, timestamp: Date.now() });
    expect(ct.getTotalCost()).toBeCloseTo(0.07, 4);
  });

  it('getCostByRole groups by role', () => {
    const ct = new CostTracker();
    ct.record({ role: 'understand', model: 'test', inputTokens: 1, outputTokens: 1, costUsd: 0.01, timestamp: 1 });
    ct.record({ role: 'understand', model: 'test', inputTokens: 1, outputTokens: 1, costUsd: 0.03, timestamp: 2 });
    ct.record({ role: 'audit', model: 'test', inputTokens: 1, outputTokens: 1, costUsd: 0.05, timestamp: 3 });
    const byRole = ct.getCostByRole();
    expect(byRole.understand).toBeCloseTo(0.04, 4);
    expect(byRole.audit).toBeCloseTo(0.05, 4);
  });

  it('isOverBudget returns true once exceeded', () => {
    const ct = new CostTracker();
    ct.record({ role: 'understand', model: 'x', inputTokens: 1, outputTokens: 1, costUsd: 5.0, timestamp: 1 });
    expect(ct.isOverBudget(10)).toBe(false);
    ct.record({ role: 'audit', model: 'x', inputTokens: 1, outputTokens: 1, costUsd: 6.0, timestamp: 2 });
    expect(ct.isOverBudget(10)).toBe(true);
  });

  it('reset clears all usage', () => {
    const ct = new CostTracker();
    ct.record({ role: 'understand', model: 'x', inputTokens: 1, outputTokens: 1, costUsd: 10, timestamp: 1 });
    ct.reset();
    expect(ct.getTotalCost()).toBe(0);
  });
});
