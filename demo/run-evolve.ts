#!/usr/bin/env node
/**
 * SkillEvolver Demo — 自包含演示脚本
 * 零外部依赖：使用 MockAdapter，无需 API key
 */

import { SkillEvolver, LLMRouter, MockAdapter, AdapterRouter, TraceEngine } from '../packages/core/src/index.js';
import { SkillRegistry } from '../packages/skill-registry/src/index.js';
import type { EvolveResult } from '../packages/core/src/types.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`;
const D = (s: string) => `\x1b[90m${s}\x1b[0m`;

async function createTask(tmpDir: string): Promise<string> {
  const taskDir = path.join(tmpDir, 'word-counter');
  await fs.mkdir(path.join(taskDir, 'input'), { recursive: true });
  await fs.writeFile(path.join(taskDir, 'README.md'), [
    '# Task: Word Counter', '',
    'Count words in input/text.txt and write to output/stats.json.',
    'Output format: { "total_words": N, "total_chars": N, "total_lines": N }',
    'Run bash evaluate.sh to check.',
  ].join('\n'));
  await fs.writeFile(path.join(taskDir, 'input', 'text.txt'),
    'The quick brown fox jumps over the lazy dog.\nIt was a dark and stormy night.\n');
  await fs.writeFile(path.join(taskDir, 'evaluate.sh'), [
    '#!/bin/bash',
    'if [ -f output/stats.json ]; then',
    '  WORDS=$(python3 -c "import json;print(json.load(open(\"output/stats.json\")).get(\"total_words\",0))" 2>/dev/null)',
    '  if [ "$WORDS" -gt 0 ]; then echo "SCORE: 1.0"; exit 0; fi',
    'fi',
    'echo "SCORE: 0.0"; exit 1',
  ].join('\n'));
  await fs.chmod(path.join(taskDir, 'evaluate.sh'), 0o755);
  return taskDir;
}

function setupMockLLM(): LLMRouter {
  const mock = new MockAdapter();
  mock.setResponse('Task path:', JSON.stringify({
    domain:'office', rewardType:'binary', summary:'Count words/chars/lines in text file',
    decisionAxes:[{name:'lang',options:['python','bash'],description:'Language'}],
    parametricAxes:[{name:'fname',trainingValue:'text.txt',derivationRule:'runtime from input/'}],
    invariantAxes:[],
  }));
  mock.setResponse(JSON.stringify({task:'Count words',decisionAxes:[],parametricAxes:[],count:2}), JSON.stringify({
    strategies:[
      {id:'s1',name:'Python',description:'Use Python',decisions:{lang:'python'},parametricValues:{fname:'RUNTIME_DERIVE'},content:'# Python'},
      {id:'s2',name:'Bash',description:'Use wc',decisions:{lang:'bash'},parametricValues:{fname:'RUNTIME_DERIVE'},content:'# Bash'},
    ],
  }));
  mock.setResponse('What did the', JSON.stringify({
    winnerFeatures:['Python split()','len() for chars'],loserFeatures:['hardcoded path'],
    diff:['Use Python open()','runtime file detection'],analysis:'Python wins',patchTarget:'skill_body',
  }));
  mock.setResponse('null', JSON.stringify({
    skillMd: '# Word Counter\n\n## Primary Action\n```bash\npython scripts/count.py input/*.txt output/stats.json\n```\n\n## Constraints\n- Derive filename at runtime\n- Output valid JSON',
    newScripts:{'count.py':"import sys,json,glob,os\ntotal=0\nfor f in sorted(glob.glob(sys.argv[1])):\n with open(f) as fh: total+=len(fh.read().split())\nos.makedirs(os.path.dirname(sys.argv[2]),exist_ok=True)\njson.dump({'total_words':total},open(sys.argv[2],'w'))"},
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

async function main() {
  console.log('\n'+B('\x1b[34m🧬 SkillEvolver Demo — 技能自我进化\x1b[0m'));
  console.log(D('   论文: arXiv:2605.10500 | 模式: MockAdapter (零API依赖)')+'\n');

  const tmpDir = path.join(os.tmpdir(), `evolve-demo-${Date.now()}`);
  const taskDir = await createTask(tmpDir);
  console.log(G('✓')+' 任务: word-counter');

  const llm = setupMockLLM();
  console.log(G('✓')+' Mock LLM 就绪\n');

  const evolver = new SkillEvolver({
    llm, maxIterations:1, exploreWidth:2, validationTrials:1,
    harborTimeout:30000, budget:{maxCostUSD:5,maxTurns:50},
  });

  const t0 = Date.now();
  try {
    const result: EvolveResult = await evolver.evolve(taskDir);
    const reg = new SkillRegistry(path.join(tmpDir,'skills'));
    await reg.save(result.skill);
    const s = (Date.now()-t0)/1000;

    console.log(B(G('══════ 进化完成 ══════')));
    console.log('  领域:     '+Y(result.axes.domain));
    console.log('  技能:     '+Y('v'+result.skill.version));
    console.log('  试运行:   '+result.trajectories.length+' 次');
    console.log('  审计:     '+result.auditReports.filter(r=>r.verdict==='PASS').length+'/'+result.auditReports.length+' 通过');
    console.log('  耗时:     '+s.toFixed(1)+'s');
    console.log('  成本:     '+G('$'+result.costUsd.toFixed(2))+' (Mock)');

    console.log('\n'+B('技能 SKILL.md:'));
    console.log(D('─'.repeat(50)));
    for (const l of result.skill.skillMd.split('\n').slice(0,8)) console.log('  '+l);
    console.log(D('─'.repeat(50)));

    console.log('\n脚本: '+Object.keys(result.skill.scripts).join(', '));
    if (result.skill.scripts['count.py']) {
      console.log('\n'+B('count.py:'));
      console.log(D('─'.repeat(50)));
      for (const l of result.skill.scripts['count.py'].split('\n').slice(0,6)) console.log('  '+l);
      console.log(D('─'.repeat(50)));
    }
    console.log('\n'+G('技能已保存'));
  } catch(e) {
    console.error('\x1b[31m✗\x1b[0m',(e as Error).message);
    process.exit(1);
  }
  await fs.rm(tmpDir,{recursive:true,force:true});
}

main();
