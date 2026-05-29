import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  SkillEvolver, LLMRouter, MockAdapter, AdapterRouter,
  SkillRegistry,
} from '../helpers/imports.js';

describe('SkillEvolver Full Demo (Mock LLM)', () => {
  let tmpDir: string;
  let taskDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `demo-${Date.now()}`);
    taskDir = path.join(tmpDir, 'train');
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(path.join(taskDir, 'README.md'), [
      '# Task: csv-stats', '',
      'Read input/data.csv and compute total rows, columns, averages.',
      'Write results to output/stats.json',
    ].join('\n'));
    await fs.mkdir(path.join(taskDir, 'input'), { recursive: true });
    await fs.writeFile(path.join(taskDir, 'input', 'data.csv'), 'name,age\nA,30\nB,25');
    await fs.writeFile(path.join(taskDir, 'evaluate.sh'), [
      '#!/bin/bash',
      'if [ -f output/stats.json ]; then echo "SCORE: 1.0"; exit 0;',
      'else echo "SCORE: 0.0"; exit 1; fi',
    ].join('\n'));
    await fs.chmod(path.join(taskDir, 'evaluate.sh'), 0o755);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('completes full evolve loop R=1', async () => {
    const mock = new MockAdapter();
    // Strategy generation mock (bootstrap)
    mock.setResponse(JSON.stringify({
      task: 'csv stats',
      decisionAxes: [{ name: 'lib', options: ['pandas', 'csv'], description: 'CSV lib' }],
      parametricAxes: [],
      count: 2,
    }), JSON.stringify({
      strategies: [
        { id:'s1', name:'Pandas approach', description:'Use pandas', decisions:{lib:'pandas'}, parametricValues:{}, content:'# Strategy 1' },
        { id:'s2', name:'CSV approach', description:'Use csv module', decisions:{lib:'csv'}, parametricValues:{}, content:'# Strategy 2' },
      ],
    }));

    mock.setResponse('Task path:', JSON.stringify({
      domain: 'data_science',
      decisionAxes: [{ name: 'lib', options: ['pandas', 'csv'], description: 'CSV lib' }],
      parametricAxes: [{ name: 'fname', trainingValue: 'data.csv', derivationRule: 'runtime' }],
      invariantAxes: [], rewardType: 'binary', summary: 'csv stats',
    }));
    mock.setResponse('What did the', JSON.stringify({
      winnerFeatures: ['pandas'], loserFeatures: [], diff: ['use pandas'],
      analysis: 'a', patchTarget: 'skill_body',
    }));
    mock.setResponse('null', JSON.stringify({
      skillMd: '# csv-stats\n## Primary\n```bash\npython run.py\n```',
      newScripts: { 'run.py': 'print("ok")' }, modifiedScripts: {}, changesSummary: 'v1',
    }));
    mock.setResponse('skillId', JSON.stringify({ passed: true }));
    mock.setResponse('Check if', JSON.stringify({ passed: true }));
    mock.setResponse('identify imperative', JSON.stringify({ passed: true }));
    mock.setResponse('For each parametric', JSON.stringify({ passed: true }));

    const router = new LLMRouter();
    (router as any)._adapterRouter = new AdapterRouter([mock]);

    const evolver = new SkillEvolver({
      llm: router, maxIterations: 1, exploreWidth: 2,
      validationTrials: 1, budget: { maxCostUSD: 5, maxTurns: 50 },
    });

    const result = await evolver.evolve(taskDir);
    expect(result.skill.version).toBe(1);
    expect(result.skill.skillMd).toContain('Generated Skill');
    expect(result.skill.version).toBeGreaterThan(0);
    expect(result.costUsd).toBe(0);
  });

  it('evolves over R=2 iterations', async () => {
    const mock = new MockAdapter();
    // Strategy generation mock (bootstrap)
    mock.setResponse(JSON.stringify({
      task: 'csv stats',
      decisionAxes: [{ name: 'lib', options: ['pandas', 'csv'], description: 'CSV lib' }],
      parametricAxes: [],
      count: 2,
    }), JSON.stringify({
      strategies: [
        { id:'s1', name:'Pandas approach', description:'Use pandas', decisions:{lib:'pandas'}, parametricValues:{}, content:'# Strategy 1' },
        { id:'s2', name:'CSV approach', description:'Use csv module', decisions:{lib:'csv'}, parametricValues:{}, content:'# Strategy 2' },
      ],
    }));

    // Strategy gen mock (bootstrap)
    mock.setResponse(JSON.stringify({
      task: 'test',
      decisionAxes: [],
      parametricAxes: [],
      count: 2,
    }), JSON.stringify({
      strategies: [
        { id:'s1', name:'S1', description:'d1', decisions:{}, parametricValues:{}, content:'# S1' },
        { id:'s2', name:'S2', description:'d2', decisions:{}, parametricValues:{}, content:'# S2' },
      ],
    }));
    // Strategy gen mock (targeted, r=1)
    mock.setResponse(JSON.stringify({
      task: 'test',
      decisionAxes: [],
      currentSkillSummary: { version: 1, description: '# v1' },
      failureModes: ['AUDIT_FAIL: unknown'],
      count: 2,
    }), JSON.stringify({
      strategies: [
        { id:'s3', name:'S3', description:'d3', decisions:{}, parametricValues:{}, content:'# S3' },
        { id:'s4', name:'S4', description:'d4', decisions:{}, parametricValues:{}, content:'# S4' },
      ],
    }));

    mock.setResponse('Task path:', JSON.stringify({
      domain: 'test', decisionAxes: [], parametricAxes: [],

      invariantAxes: [], rewardType: 'binary', summary: 'test',
    }));
    mock.setResponse('What did the', JSON.stringify({
      winnerFeatures: ['f1'], loserFeatures: [], diff: ['f1'], analysis:'a', patchTarget:'skill_body',
    }));
    mock.setResponse('null', JSON.stringify({
      skillMd: '# v1', newScripts:{}, modifiedScripts:{}, changesSummary:'v1',
    }));
    for (const _ of [1,2,3]) {
      mock.setResponse('skillId', JSON.stringify({ passed: true }));
      mock.setResponse('Check if', JSON.stringify({ passed: true }));
      mock.setResponse('identify imperative', JSON.stringify({ passed: true }));
      mock.setResponse('For each parametric', JSON.stringify({ passed: true }));
    }
    mock.setResponse('Where did the', JSON.stringify({
      winnerFeatures: ['f2'], loserFeatures:[], diff:['f2'], analysis:'r', patchTarget:'scripts',
    }));
    mock.setResponse('"# v1"', JSON.stringify({
      skillMd: '# v2', newScripts:{'h.py':'pass'}, modifiedScripts:{}, changesSummary:'v2',
    }));

    const router = new LLMRouter();
    (router as any)._adapterRouter = new AdapterRouter([mock]);
    const evolver = new SkillEvolver({
      llm: router, maxIterations: 2, exploreWidth: 2,
      validationTrials: 1, budget: { maxCostUSD: 5, maxTurns: 50 },
    });

    const result = await evolver.evolve(taskDir);
    expect(result.skill.version).toBeGreaterThanOrEqual(1);
    expect(result.auditReports.length).toBeGreaterThanOrEqual(1);
  });
});
