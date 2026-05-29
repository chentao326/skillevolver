import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SkillEvolver, LLMRouter, TraceEngine } from '@skillevolver/core';

describe('SkillsBench Runner', () => {
  const fixtureDir = path.resolve('tests/fixtures/jpg-ocr-stat');

  it('fixture task exists', async () => {
    const ok = await fs.stat(path.join(fixtureDir, 'train', 'README.md')).then(() => true).catch(() => false);
    expect(ok).toBe(true);
  });

  it('SkillEvolver constructs for benchmark', () => {
    const evolver = new SkillEvolver({
      llm: new LLMRouter(),
      maxIterations: 2, exploreWidth: 4, validationTrials: 5,
      budget: { maxCostUSD: 15, maxTurns: 200 },
    });
    expect(evolver).toBeDefined();
  });

  it('TraceEngine handles 83-task aggregation', async () => {
    const engine = new TraceEngine();
    for (let i = 0; i < 83; i++) {
      await engine.save({
        id: `t${i}`, taskId: `task-${i}`, iteration: 0, strategyId: 's1',
        steps: [], totalTokens: 100, totalTurns: 2, wallClockMs: 1000,
        reward: i % 3 === 0 ? 1 : 0, success: i % 3 === 0,
        sandboxId: 'test', modelName: 'test', timestamp: Date.now(),
      });
    }
    let pass = 0;
    for (let i = 0; i < 83; i++) {
      if (engine.getStats(`task-${i}`).passRate > 0.5) pass++;
    }
    expect(pass).toBeGreaterThan(0);
    engine.close();
  });
});
