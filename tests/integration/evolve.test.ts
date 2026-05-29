import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SkillEvolver, LLMRouter, TraceEngine, AuditorEngine, StrategyEngine, AuditCheck } from '@skillevolver/core';
import { SkillStore } from '@skillevolver/skill-registry';

describe('SkillEvolver Phase 2 Integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `evolve-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('SkillStore versioned save and load', async () => {
    const store = new SkillStore(path.join(tmpDir, 'skills'));
    const skill = { skillId: 't', domain: 'x', taskSlug: 't', version: 2,
      skillMd: '# Test', scripts: { 'run.py': 'pass' }, references: {},
      metadata: { createdAt: '', evolveStats: { iterations: 0, totalTrials: 0, totalCostUsd: 0, trainingPassRate: 0, validationPassRate: 0 }, model: '' },
      checksum: '' };
    await store.save(skill);
    const loaded = await store.loadLatest('t');
    expect(loaded.version).toBe(2);
  });

  it('TraceEngine saves and queries trajectories', async () => {
    const te = new TraceEngine();
    await te.save({
      id: 't1', taskId: 'task-a', iteration: 0, strategyId: 's1',
      steps: [{ type: 'tool_call', content: 'x', tokens: 10, toolName: 'bash' }],
      totalTokens: 50, totalTurns: 1, wallClockMs: 100,
      reward: 1, success: true,
      sandboxId: 'sb1', modelName: 'test', timestamp: Date.now(),
    });
    expect(te.getStats('task-a').totalTrials).toBe(1);
    te.close();
  });

  it('AuditorEngine AuditCheck enum has 9 values', () => {
    const values = Object.values(AuditCheck);
    expect(values.length).toBeGreaterThanOrEqual(9);
  });

  it('SkillEvolver constructs with valid config', () => {
    const llm = new LLMRouter();
    const evolver = new SkillEvolver({
      llm,
      maxIterations: 2,
      exploreWidth: 4,
      validationTrials: 5,
      budget: { maxCostUSD: 15, maxTurns: 200 },
    });
    expect(evolver).toBeDefined();
  });

  it('StrategyEngine constructs', () => {
    const engine = new StrategyEngine(new LLMRouter());
    expect(engine).toBeDefined();
  });
});
