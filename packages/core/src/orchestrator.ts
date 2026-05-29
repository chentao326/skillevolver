import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TaskAxes, SkillArtifact, Strategy, Trajectory, AuditReport, EvolveLoopConfig, EvolveResult } from './types.js';
import { UnderstandPhase } from './phases/understand.js';
import { ExploreSubPhase } from './phases/explore.js';
import { UpdateSubPhase } from './phases/update.js';
import { StrategyEngine } from './phases/strategy.js';
import { AuditorEngine } from './auditor/index.js';
import { SandboxManager } from '@skillevolver/sandbox';
import { LLMRouter } from './llm/router.js';

export class SkillEvolver {
  private understand: UnderstandPhase;
  private explore: ExploreSubPhase;
  private update: UpdateSubPhase;
  private auditor: AuditorEngine;
  private strategy: StrategyEngine;
  private config: EvolveLoopConfig;
  private llm: LLMRouter;

  constructor(config: Partial<EvolveLoopConfig> & { llm: LLMRouter }) {
    this.llm = config.llm;
    this.config = {
      maxIterations: config.maxIterations ?? 2,
      exploreWidth: config.exploreWidth ?? 4,
      validationTrials: config.validationTrials ?? 5,
      harborTimeout: config.harborTimeout ?? 300_000,
      budget: config.budget ?? { maxCostUSD: 15, maxTurns: 200 },
    };


    this.understand = new UnderstandPhase(this.llm);
    this.explore = new ExploreSubPhase(new SandboxManager(), this.llm);
    this.update = new UpdateSubPhase(this.llm);
    this.auditor = new AuditorEngine(this.llm);
    this.strategy = new StrategyEngine(this.llm);
  }

  async evolve(taskPath: string): Promise<EvolveResult> {
    // ===== Phase 0: Understand =====
    const axes = await this.understand.execute(taskPath);

    // ===== Phase 1..R: Evolve =====
    let currentSkill: SkillArtifact | null = null;
    const allTrajectories: Trajectory[][] = [];
    const auditReports: AuditReport[] = [];

    for (let r = 0; r < this.config.maxIterations; r++) {
      // 预算检查
      if (this.llm.getCosts().isOverBudget(this.config.budget.maxCostUSD)) {
        console.warn(
          `Budget exceeded at iteration ${r}: $${this.llm.getCosts().getTotalCost().toFixed(2)} / $${this.config.budget.maxCostUSD}`
        );
        break;
      }

      // 1. 生成策略
      let strategies: Strategy[];
      if (r === 0) {
        strategies = await this.strategy.generateBootstrap(axes, this.config.exploreWidth);
      } else {
        if (!currentSkill) {
          throw new Error(
            `Cannot generate targeted strategies at iteration ${r}: ` +
              `currentSkill is null — all previous trials may have failed. ` +
              `Consider increasing K or adjusting the task.`,
          );
        }
        strategies = await this.strategy.generateTargeted(
          axes,
          currentSkill,
          allTrajectories[r - 1],
          this.config.exploreWidth,
        );
      }

      // 2. 并行探索
      const trajectories = await this.explore.executeParallel(axes, currentSkill, strategies, r);
      allTrajectories.push(trajectories);

      // 3. 对比更新
      const candidateSkill = await this.update.execute(currentSkill, trajectories, axes);

      // 4. 审计门控
      const trainingPaths = await this.collectTrainingPaths(taskPath);
      const trainingLiterals = await this.collectTrainingLiterals(taskPath);
      const report = await this.auditor.audit(
        candidateSkill,
        axes,
        { paths: trainingPaths, literals: trainingLiterals },
        trajectories,
      );
      auditReports.push(report);

      // 5. 退出条件
      if (report.verdict === 'FAIL') {
        // 将审计失败原因注入最后一条轨迹的 error 字段，供下一轮 generateTargeted 使用
        if (trajectories.length > 0 && report.failReason) {
          const lastTraj = trajectories[trajectories.length - 1];
          lastTraj.error = `AUDIT_FAIL: ${report.failReason}`;
        }
        currentSkill = candidateSkill;
        continue;
      }

      const passRate = trajectories.filter((t) => t.reward >= 1).length / trajectories.length;
      currentSkill = candidateSkill;

      if (passRate >= 0.75 && r > 0) break;
    }

    // ===== Finalize =====
    if (!currentSkill) {
      throw new Error(
        'SkillEvolver failed: no skill was produced after all iterations. ' +
          'All trials across all iterations returned zero reward.',
      );
    }

    return {
      skill: currentSkill,
      axes,
      trajectories: allTrajectories.flat(),
      auditReports,
      costUsd: this.llm.getCosts().getTotalCost(),
    };
  }

  private async collectTrainingPaths(taskPath: string): Promise<string[]> {
    const paths: string[] = [];
    await walkDir(taskPath, '', paths);
    return paths;
  }

  private async collectTrainingLiterals(taskPath: string): Promise<string[]> {
    const literals: string[] = [];
    const paths = await this.collectTrainingPaths(taskPath);
    for (const p of paths) {
      const basename = p.split('/').pop()!;
      literals.push(basename);
      const parts = basename.replace(/\.\w+$/, '').split(/[-_]/);
      literals.push(...parts.filter((x) => x.length >= 3));
    }
    return [...new Set(literals)];
  }
}

async function walkDir(basePath: string, relativePath: string, files: string[]): Promise<void> {
  const currentPath = path.join(basePath, relativePath);
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryRel = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        await walkDir(basePath, entryRel, files);
      }
    } else {
      files.push(entryRel);
    }
  }
}
