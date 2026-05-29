#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { SkillEvolver, LLMRouter, TraceEngine, type EvolveLoopConfig, type EvolveResult } from '@skillevolver/core';
import { SkillRegistry } from '@skillevolver/skill-registry';
import path from 'node:path';

const program = new Command();

program
  .name('skillevolver')
  .description('SkillEvolver: AI Agent 技能自我进化系统 — 论文 arXiv:2605.10500')
  .version('0.1.0');

// ===== evolve =====
program
  .command('evolve')
  .description('为指定任务进化一个技能')
  .requiredOption('-t, --task <path>', '训练任务目录路径')
  .option('-i, --iterations <n>', '最大迭代轮数 (R)', '2')
  .option('-k, --explore-width <n>', '每轮并行探索数 (K)', '4')
  .option('-v, --validation <n>', '验证试运行次数 (V)', '5')
  .option('-b, --budget <usd>', '最大预算 (USD)', '15')
  .option('--timeout <ms>', '单次试运行超时 (ms)', '300000')
  .option('-o, --output <dir>', '技能输出目录', './skills')
  .action(async (options) => {
    const config: Partial<EvolveLoopConfig> = {
      maxIterations: parseInt(options.iterations, 10),
      exploreWidth: parseInt(options.exploreWidth, 10),
      validationTrials: parseInt(options.validation, 10),
      harborTimeout: parseInt(options.timeout, 10),
      budget: { maxCostUSD: parseFloat(options.budget), maxTurns: 200 },
    };

    console.log(chalk.blue.bold('🧬 SkillEvolver — 技能进化开始'));
    console.log(chalk.gray(`  任务: ${options.task}`));
    console.log(chalk.gray(`  R=${config.maxIterations}  K=${config.exploreWidth}  V=${config.validationTrials}`));
    console.log(chalk.gray(`  预算: $${config.budget?.maxCostUSD}`));
    console.log('');

    const llm = new LLMRouter();
    const evolver = new SkillEvolver({ ...config, llm });
    const traceEngine = new TraceEngine();

    const startTime = Date.now();

    try {
      const result: EvolveResult = await evolver.evolve(options.task);

      // 持久化轨迹
      await traceEngine.saveBatch(result.trajectories);

      // 保存技能
      const registry = new SkillRegistry(options.output);
      await registry.save(result.skill);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const stats = traceEngine.getStats(result.axes.taskSlug);

      console.log('');
      console.log(chalk.green.bold('✅ 进化完成！'));
      console.log(chalk.white(`  技能: ${result.skill.taskSlug} v${result.skill.version}`));
      console.log(chalk.white(`  领域: ${result.axes.domain}`));
      console.log(chalk.white(`  耗时: ${elapsed}s`));
      console.log(chalk.white(`  成本: $${result.costUsd.toFixed(2)}`));
      console.log(chalk.white(`  试运行: ${stats.totalTrials} 次 (${result.auditReports.filter(r => r.verdict === 'PASS').length}/${result.auditReports.length} 审计通过)`));
      console.log(chalk.white(`  训练通过率: ${(stats.passRate * 100).toFixed(1)}%`));
      console.log(chalk.white(`  存储: ${path.resolve(options.output, result.skill.taskSlug)}/`));

      traceEngine.close();
    } catch (error) {
      console.error(chalk.red.bold('❌ 进化失败:'), (error as Error).message);
      traceEngine.close();
      process.exit(1);
    }
  });

// ===== audit =====
program
  .command('audit')
  .description('审计一个已有技能（9 项检查）')
  .requiredOption('-s, --skill <slug>', '技能标识 (task slug)')
  .option('-d, --skill-dir <dir>', '技能存储目录', './skills')
  .action(async (options) => {
    console.log(chalk.blue.bold('🔍 审计技能...'));
    try {
      const registry = new SkillRegistry(options.skillDir);
      const skill = await registry.loadLatest(options.skill);
      const errors = (await import('@skillevolver/skill-registry')).validateSkill(skill);

      console.log(chalk.white(`  技能: ${skill.taskSlug} v${skill.version}`));
      console.log(chalk.white(`  SKILL.md: ${skill.skillMd.length} 字符`));
      console.log(chalk.white(`  脚本数: ${Object.keys(skill.scripts).length}`));
      console.log(chalk.white(`  校验和: ${skill.checksum}`));

      if (errors.length > 0) {
        console.log(chalk.yellow(`  ⚠️  结构问题: ${errors.length} 项`));
        errors.forEach(e => console.log(chalk.yellow(`     - ${e}`)));
      } else {
        console.log(chalk.green('  ✅ 结构校验通过'));
      }
    } catch (error) {
      console.error(chalk.red(`  错误: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ===== status =====
program
  .command('status')
  .description('查看技能进化状态')
  .option('-t, --task <slug>', '任务标识')
  .option('-d, --skill-dir <dir>', '技能存储目录', './skills')
  .action(async (options) => {
    console.log(chalk.blue.bold('📊 SkillEvolver 状态'));
    const registry = new SkillRegistry(options.skillDir);

    if (options.task) {
      const exists = await registry.exists(options.task);
      if (exists) {
        const versions = await registry.listVersions(options.task);
        const latest = await registry.loadLatest(options.task);
        console.log(chalk.white(`  任务: ${options.task}`));
        console.log(chalk.white(`  版本数: ${versions.length}`));
        console.log(chalk.white(`  最新: v${latest.version}`));
        console.log(chalk.white(`  创建: ${latest.metadata.createdAt}`));
        console.log(chalk.white(`  模型: ${latest.metadata.model || '(未记录)'}`));
        if (latest.metadata.evolveStats.iterations > 0) {
          console.log(chalk.white(`  进化: ${latest.metadata.evolveStats.iterations} 轮, ${latest.metadata.evolveStats.totalTrials} 次试运行`));
          console.log(chalk.white(`  成本: $${latest.metadata.evolveStats.totalCostUsd.toFixed(2)}`));
        }
      } else {
        console.log(chalk.yellow(`  任务 "${options.task}" 未找到`));
      }
    } else {
      console.log(chalk.gray('  使用 --task <slug> 查看特定任务'));
    }
  });

// ===== list =====
program
  .command('list')
  .description('列出所有已进化的技能')
  .option('-d, --skill-dir <dir>', '技能存储目录', './skills')
  .action(async (options) => {
    console.log(chalk.blue.bold('📋 技能列表'));
    try {
      const fs = await import('node:fs/promises');
      const entries = await fs.readdir(options.skillDir);
      if (entries.length === 0) {
        console.log(chalk.gray('  (空)'));
        return;
      }
      for (const entry of entries) {
        try {
          const stat = await fs.stat(path.join(options.skillDir, entry));
          if (stat.isDirectory()) {
            console.log(chalk.white(`  ${entry}`));
          }
        } catch { /* skip */ }
      }
    } catch {
      console.log(chalk.gray('  (技能目录不存在或为空)'));
    }
  });

program.parse();
