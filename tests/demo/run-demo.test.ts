import { describe, it, expect } from 'vitest';
import { SkillEvolver, LLMRouter, MockAdapter, AdapterRouter, SkillRegistry } from '../helpers/imports.js';
import type { EvolveResult } from '@skillevolver/core';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function setupMockLLM(): LLMRouter {
  const mock = new MockAdapter();
  mock.setResponse('Task path:', JSON.stringify({
    domain:'office', rewardType:'binary', summary:'Count words/chars/lines',
    decisionAxes:[{name:'lang',options:['python','bash'],description:'Lang'}],
    parametricAxes:[{name:'fname',trainingValue:'text.txt',derivationRule:'runtime'}],
    invariantAxes:[],
  }));
  mock.setResponse(JSON.stringify({task:'Count words',decisionAxes:[],parametricAxes:[],count:2}), JSON.stringify({
    strategies:[
      {id:'s1',name:'Python',description:'Use Python',decisions:{lang:'python'},parametricValues:{fname:'RUNTIME_DERIVE'},content:'# Python'},
      {id:'s2',name:'Bash',description:'Use wc',decisions:{lang:'bash'},parametricValues:{fname:'RUNTIME_DERIVE'},content:'# Bash'},
    ],
  }));
  mock.setResponse('What did the', JSON.stringify({
    winnerFeatures:['Python split()'],loserFeatures:['hardcoded'],
    diff:['Use Python open()'],analysis:'ok',patchTarget:'skill_body',
  }));
  mock.setResponse('null', JSON.stringify({
    skillMd: '# Word Counter\n\n## Primary Action\n```bash\npython count.py input/*.txt output/stats.json\n```\n\n## Constraints\n- Runtime file detection',
    newScripts:{'count.py':"import sys,json,glob,os\nt=0\nfor f in sorted(glob.glob(sys.argv[1])):\n with open(f) as fh: t+=len(fh.read().split())\nos.makedirs(os.path.dirname(sys.argv[2]),exist_ok=True)\njson.dump({'total_words':t},open(sys.argv[2],'w'))"},
    modifiedScripts:{},changesSummary:'v1',
  }));
  for (let i=0;i<4;i++) {
    mock.setResponse('skillId', JSON.stringify({passed:true}));
    mock.setResponse('Check if', JSON.stringify({passed:true}));
    mock.setResponse('identify', JSON.stringify({passed:true}));
    mock.setResponse('For each', JSON.stringify({passed:true}));
  }
  const router = new LLMRouter();
  (router as any)._adapterRouter = new AdapterRouter([mock]);
  return router;
}

describe('SkillEvolver Live Demo', () => {
  it('runs full evolve with word-counter task', async () => {
    const tmpDir = path.join(os.tmpdir(), `demo-test-${Date.now()}`);
    const taskDir = path.join(tmpDir, 'word-counter');

    await fs.mkdir(path.join(taskDir, 'input'), { recursive: true });
    await fs.writeFile(path.join(taskDir, 'README.md'), '# Word Counter\n\nCount words in input/text.txt.\n');
    await fs.writeFile(path.join(taskDir, 'input', 'text.txt'), 'The quick brown fox.\nJumped over the lazy dog.\n');
    await fs.writeFile(path.join(taskDir, 'evaluate.sh'),
      '#!/bin/bash\nif [ -f output/stats.json ]; then echo "SCORE: 1.0"; exit 0; fi\necho "SCORE: 0.0"; exit 1');
    await fs.chmod(path.join(taskDir, 'evaluate.sh'), 0o755);

    const llm = setupMockLLM();
    const evolver = new SkillEvolver({
      llm, maxIterations: 1, exploreWidth: 2, validationTrials: 1,
      harborTimeout: 30000, budget: { maxCostUSD: 5, maxTurns: 50 },
    });

    const t0 = Date.now();
    const result: EvolveResult = await evolver.evolve(taskDir);
    const elapsed = (Date.now() - t0) / 1000;

    // 验证核心产出
    expect(result.skill).toBeDefined();
    expect(result.skill.version).toBe(1);
    expect(result.skill.skillMd).toContain('Generated Skill');
    expect(result.axes.domain).toBeTruthy();
    expect(result.trajectories.length).toBeGreaterThan(0);
    expect(result.auditReports.length).toBe(1);
    expect(result.auditReports[0].verdict).toBe('PASS');
    expect(result.costUsd).toBe(0);
    expect(elapsed).toBeLessThan(10);

    // 保存并重新加载
    const registry = new SkillRegistry(path.join(tmpDir, 'skills'));
    await registry.save(result.skill);
    const loaded = await registry.loadLatest('word-counter');
    expect(loaded.version).toBe(1);

    // 输出演示信息
    console.log('\n🧬 SkillEvolver Demo 完成!');
    console.log('  领域:', result.axes.domain);
    console.log('  版本:', 'v' + result.skill.version);
    console.log('  耗时:', elapsed.toFixed(2) + 's');
    console.log('  审计:', result.auditReports[0].verdict);
    console.log('  脚本:', Object.keys(result.skill.scripts).join(', '));

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
