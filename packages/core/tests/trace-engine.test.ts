import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TraceEngine } from '../src/trace-engine.js';
import type { Trajectory } from '../src/types.js';

function makeTraj(overrides?: Partial<Trajectory>): Trajectory {
  const defaults = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    taskId: 'task-a',
    iteration: 0,
    strategyId: 's1',
    steps: [{ type: 'tool_call' as const, content: 'x', tokens: 10, toolName: 'bash' }],
    totalTokens: 50,
    totalTurns: 1,
    wallClockMs: 100,
    reward: 1,
    success: true,
    sandboxId: 'sb1',
    modelName: 'test',
    timestamp: Date.now(),
  };
  return { ...defaults, ...overrides };
}

describe('TraceEngine', () => {
  let dbDir: string;

  beforeEach(async () => {
    dbDir = path.join(os.tmpdir(), `trace-test-${Date.now()}`);
    await fs.mkdir(dbDir, { recursive: true });
  });

  afterEach(async () => {
    try { await fs.rm(dbDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('save and queryByTask round-trip', async () => {
    const engine = new TraceEngine(path.join(dbDir, 'test.db'));
    const t = makeTraj({ id: 't1', taskId: 'task-a', reward: 0.8 });
    await engine.save(t);
    const results = engine.queryByTask('task-a');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('t1');
    expect(results[0].reward).toBe(0.8);
    engine.close();
  });

  it('queryByIteration filters correctly', async () => {
    const engine = new TraceEngine(path.join(dbDir, 'test.db'));
    await engine.save(makeTraj({ id: 'it0', taskId: 't', iteration: 0, reward: 0.5 }));
    await engine.save(makeTraj({ id: 'it1a', taskId: 't', iteration: 1, reward: 0.8 }));
    await engine.save(makeTraj({ id: 'it1b', taskId: 't', iteration: 1, reward: 0.3 }));

    expect(engine.queryByIteration('t', 0).length).toBe(1);
    expect(engine.queryByIteration('t', 1).length).toBe(2);
    engine.close();
  });

  it('getTopTrajectories returns top N by reward', async () => {
    const engine = new TraceEngine(path.join(dbDir, 'test.db'));
    for (let i = 0; i < 5; i++) {
      await engine.save(makeTraj({ id: `s${i}`, taskId: 't', iteration: 0, reward: i * 0.2 }));
    }
    const top = engine.getTopTrajectories('t', 0, 2);
    expect(top.length).toBe(2);
    expect(top[0].reward).toBeCloseTo(0.8);
    expect(top[1].reward).toBeCloseTo(0.6);
    engine.close();
  });

  it('getBottomTrajectories returns bottom N by reward', async () => {
    const engine = new TraceEngine(path.join(dbDir, 'test.db'));
    for (let i = 0; i < 5; i++) {
      await engine.save(makeTraj({ id: `s${i}`, taskId: 't', iteration: 0, reward: i * 0.2 }));
    }
    const bottom = engine.getBottomTrajectories('t', 0, 2);
    expect(bottom.length).toBe(2);
    expect(bottom[0].reward).toBe(0);
    expect(bottom[1].reward).toBe(0.2);
    engine.close();
  });

  it('getStats computes correct aggregate metrics', async () => {
    const engine = new TraceEngine(':memory:');
    await engine.save(makeTraj({ id: 'a', taskId: 't', reward: 1, success: true, totalTokens: 100, wallClockMs: 200 }));
    await engine.save(makeTraj({ id: 'b', taskId: 't', reward: 0, success: false, totalTokens: 200, wallClockMs: 400 }));
    await engine.save(makeTraj({ id: 'c', taskId: 't', reward: 0.5, success: false, totalTokens: 300, wallClockMs: 600 }));

    const stats = engine.getStats('t');
    expect(stats.totalTrials).toBe(3);
    expect(stats.totalIterations).toBe(1);
    expect(stats.avgReward).toBeCloseTo(0.5, 2);
    expect(stats.maxReward).toBe(1);
    expect(stats.passRate).toBeCloseTo(1 / 3, 2);
    expect(stats.avgTokens).toBe(200);
    expect(stats.avgWallClockMs).toBe(400);
    engine.close();
  });

  it('saveBatch persists multiple trajectories atomically', async () => {
    const engine = new TraceEngine(path.join(dbDir, 'test.db'));
    const batch = [
      makeTraj({ id: 'b1', taskId: 'batch-task', reward: 1 }),
      makeTraj({ id: 'b2', taskId: 'batch-task', reward: 0 }),
      makeTraj({ id: 'b3', taskId: 'batch-task', reward: 0.5 }),
    ];
    await engine.saveBatch(batch);
    const results = engine.queryByTask('batch-task');
    expect(results.length).toBe(3);
    engine.close();
  });

  it('returns empty results for unknown task', () => {
    const engine = new TraceEngine(':memory:');
    expect(engine.queryByTask('nonexistent')).toEqual([]);
    expect(engine.getStats('nonexistent').totalTrials).toBe(0);
    engine.close();
  });

  it('orders queryByTask by iteration then reward desc', async () => {
    const engine = new TraceEngine(path.join(dbDir, 'test.db'));
    await engine.save(makeTraj({ id: 'r0-low', taskId: 'order-test', iteration: 0, reward: 0.2 }));
    await engine.save(makeTraj({ id: 'r0-high', taskId: 'order-test', iteration: 0, reward: 0.9 }));
    await engine.save(makeTraj({ id: 'r1-mid', taskId: 'order-test', iteration: 1, reward: 0.5 }));
    const results = engine.queryByTask('order-test');
    expect(results[0].reward).toBe(0.9);
    expect(results[1].reward).toBe(0.2);
    expect(results[2].reward).toBe(0.5);
    engine.close();
  });
});
