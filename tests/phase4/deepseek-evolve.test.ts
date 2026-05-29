import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  SkillEvolver, LLMRouter, DeepSeekAdapter, AdapterRouter,
  SkillRegistry, TraceEngine,
} from '../helpers/imports.js';
import type { EvolveResult } from '@skillevolver/core';

const API_KEY = process.env.DEEPSEEK_API_KEY;
const RUN_E2E = process.env.DEEPSEEK_E2E === '1';

describe('DeepSeek End-to-End Evolution', () => {
  const maybeIt = RUN_E2E && API_KEY ? it : it.skip;

  maybeIt('evolves a word-counter skill with real LLM (R=1)', async () => {
    // 创建任务
    const tmpDir = path.join(os.tmpdir(), `deepseek-evolve-${Date.now()}`);
    const taskDir = path.join(tmpDir, 'word-counter');
    await fs.mkdir(path.join(taskDir, 'input'), { recursive: true });

    await fs.writeFile(path.join(taskDir, 'README.md'), [
      '# Task: Word Counter',
      '',
      'Count words, characters, and lines in input/text.txt.',
      'Write results as JSON to output/stats.json.',
      '',
      '## Output format',
      '```json',
      '{ "total_words": N, "total_chars": N, "total_lines": N }',
      '```',
      '',
      '## Evaluation',
      'Run `bash evaluate.sh` to check correctness.',
    ].join('\n'));

    await fs.writeFile(path.join(taskDir, 'input', 'text.txt'),
      'The quick brown fox jumps over the lazy dog.\nIt was a dark and stormy night.\nAll was quiet.\n');

    await fs.writeFile(path.join(taskDir, 'evaluate.sh'), [
      '#!/bin/bash',
      '# Check if output has valid JSON with total_words > 0',
      'if [ -f output/stats.json ]; then',
      '  WORDS=$(python3 -c "import json; d=json.load(open(\"output/stats.json\")); print(d.get(\"total_words\",0))" 2>/dev/null)',
      '  if [ "$WORDS" -gt 0 ] 2>/dev/null; then echo "SCORE: 1.0"; exit 0; fi',
      'fi',
      'echo "SCORE: 0.0"; exit 1',
    ].join('\n'));
    await fs.chmod(path.join(taskDir, 'evaluate.sh'), 0o755);

    // 设置 DeepSeek adapter
    const adapter = new DeepSeekAdapter(API_KEY);
    const router = new LLMRouter();
    (router as any)._adapterRouter = new AdapterRouter([adapter]);

    const evolver = new SkillEvolver({
      llm: router,
      maxIterations: 1,
      exploreWidth: 2,
      validationTrials: 1,
      harborTimeout: 60000,
      budget: { maxCostUSD: 0.05, maxTurns: 50 },
    });

    const t0 = Date.now();
    let result: EvolveResult;

    try {
      result = await evolver.evolve(taskDir);
    } catch (e) {
      console.error('Evolve failed:', (e as Error).message);
      throw e;
    }

    const elapsed = (Date.now() - t0) / 1000;

    // 输出结果
    console.log('\n=== DeepSeek 进化结果 ===');
    console.log('耗时:', elapsed.toFixed(1) + 's');
    console.log('成本:', '$' + result.costUsd.toFixed(6));
    console.log('领域:', result.axes.domain);
    console.log('版本:', 'v' + result.skill.version);
    console.log('试运行:', result.trajectories.length);
    console.log('审计:', result.auditReports.map(r => r.verdict).join(', '));
    console.log('');
    console.log('--- SKILL.md ---');
    console.log(result.skill.skillMd.slice(0, 600));
    console.log('--- 脚本 ---');
    for (const [name] of Object.entries(result.skill.scripts)) {
      console.log(' ', name, '(' + result.skill.scripts[name].length + ' chars)');
    }
    console.log('--- 轨迹奖励 ---');
    for (const t of result.trajectories) {
      console.log(' ', t.strategyId, 'reward:', t.reward, 'error:', t.error?.slice(0, 80) || 'none');
    }

    // 验证
    expect(result.skill).toBeDefined();
    expect(result.skill.version).toBeGreaterThanOrEqual(1);
    expect(result.skill.skillMd.length).toBeGreaterThan(50);
    expect(result.axes.domain).toBeTruthy();
    expect(result.costUsd).toBeLessThan(0.05);

    // 保存技能
    const registry = new SkillRegistry(path.join(tmpDir, 'skills'));
    await registry.save(result.skill);
    const loaded = await registry.loadLatest('word-counter');
    expect(loaded.version).toBe(result.skill.version);

    await fs.rm(tmpDir, { recursive: true, force: true });
  }, 120000);
});
