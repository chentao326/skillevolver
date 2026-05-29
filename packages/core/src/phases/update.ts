import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import type { TaskAxes, SkillArtifact, Trajectory, ContrastResult } from '../types.js';
import type { LLMRouter } from '../llm/router.js';
import { CONTRAST_SYSTEM_PROMPT, SYNTHESIZE_SYSTEM_PROMPT } from './prompts.js';
import { safeParseJSON } from '../utils/json.js';

export class UpdateSubPhase {
  constructor(private llm: LLMRouter) {}

  async execute(
    currentSkill: SkillArtifact | null,
    trajectories: Trajectory[],
    task: TaskAxes,
  ): Promise<SkillArtifact> {
    const { winners, losers } = this.splitByReward(trajectories, task.rewardType);

    if (winners.length === 0) {
      throw new Error(
        'No successful trajectories — all trials failed. ' +
        'Cannot extract contrast signal for skill update.',
      );
    }

    const isRefinement = currentSkill !== null;

    // 1. 对比提取 Δ
    const contrastResult = await this.extractContrast(winners, losers, isRefinement);

    // 2. 生成补丁
    const patchedSkill = await this.synthesizePatch(currentSkill, contrastResult, task);

    // 3. 分配版本号
    patchedSkill.version = currentSkill ? currentSkill.version + 1 : 1;
    patchedSkill.checksum = this.computeChecksum(patchedSkill);

    return patchedSkill;
  }

  private splitByReward(
    trajectories: Trajectory[],
    rewardType: 'binary' | 'scalar',
  ): { winners: Trajectory[]; losers: Trajectory[] } {
    if (rewardType === 'binary') {
      return {
        winners: trajectories.filter((t) => t.reward >= 1),
        losers: trajectories.filter((t) => t.reward < 1),
      };
    }
    // scalar: top half vs bottom half
    const sorted = [...trajectories].sort((a, b) => b.reward - a.reward);
    const mid = Math.ceil(sorted.length / 2);
    return {
      winners: sorted.slice(0, mid),
      losers: sorted.slice(mid),
    };
  }

  private async extractContrast(
    winners: Trajectory[],
    losers: Trajectory[],
    isRefinement: boolean,
  ): Promise<ContrastResult> {
    const question = isRefinement
      ? 'Where did the current skill mislead, underspecify, or fail to guide the agent?'
      : 'What did the winners know that the losers lacked?';

    const response = await this.llm.complete({
      role: 'contrast',
      maxTokens: 8000,
      temperature: 0.2,
      systemPrompt: CONTRAST_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            question,
            winnerTraces: winners.map(this.summarizeTrace),
            loserTraces: losers.map(this.summarizeTrace),
          }),
        },
      ],
    });

    return safeParseJSON<ContrastResult>(response.content, 'contrast');
  }

  private async synthesizePatch(
    currentSkill: SkillArtifact | null,
    contrast: ContrastResult,
    task: TaskAxes,
  ): Promise<SkillArtifact> {
    const response = await this.llm.complete({
      role: 'synthesize',
      maxTokens: 16000,
      temperature: 0.2,
      systemPrompt: SYNTHESIZE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            currentSkill: currentSkill
              ? {
                  skillMd: currentSkill.skillMd,
                  scripts: Object.keys(currentSkill.scripts),
                }
              : null,
            contrast,
            taskSummary: task.summary,
          }),
        },
      ],
    });

    const patch = safeParseJSON<Record<string, unknown>>(response.content, 'synthesize');
    const skillMd = (patch.skillMd as string) ?? '';
    const newScripts = (patch.newScripts as Record<string, string>) ?? {};
    const modifiedScripts = (patch.modifiedScripts as Record<string, string>) ?? {};

    return {
      skillId: task.taskSlug,
      domain: task.domain,
      taskSlug: task.taskSlug,
      version: 0,
      skillMd,
      scripts: {
        ...(currentSkill?.scripts ?? {}),
        ...newScripts,
        ...modifiedScripts,
      },
      references: currentSkill?.references ?? {},
      metadata: {
        createdAt: new Date().toISOString(),
        evolveStats: {
          iterations: 0,
          totalTrials: 0,
          totalCostUsd: 0,
          trainingPassRate: 0,
          validationPassRate: 0,
        },
        model: '',
        parentVersion: currentSkill?.version,
      },
      checksum: '',
    };
  }

  private summarizeTrace(t: Trajectory): string {
    const toolCalls = t.steps
      .filter((s) => s.type === 'tool_call')
      .map((s) => `${s.toolName}: ${JSON.stringify(s.toolInput).slice(0, 200)}`)
      .join('\n');

    const errors = t.steps
      .filter((s) => s.type === 'tool_result' && s.toolOutput?.toLowerCase().includes('error'))
      .map((s) => s.toolOutput?.slice(0, 200))
      .join('\n');

    return [
      `Strategy: ${t.strategyId}`,
      `Reward: ${t.reward}`,
      `Turns: ${t.totalTurns}`,
      `Error: ${t.error ?? 'none'}`,
      `Tool calls:\n${toolCalls}`,
      errors ? `Errors:\n${errors}` : '',
    ].join('\n');
  }

  private computeChecksum(skill: Pick<SkillArtifact, 'skillMd' | 'scripts'>): string {
    const hash = crypto.createHash('sha256');
    hash.update(skill.skillMd);
    for (const [, content] of Object.entries(skill.scripts).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      hash.update(content);
    }
    return hash.digest('hex').slice(0, 16);
  }
}

// 辅助：为 bootstrap (r=0) 创建一个空的初始技能
export function createBootstrapSkill(taskSlug: string, domain: string): SkillArtifact {
  return {
    skillId: taskSlug,
    domain,
    taskSlug,
    version: 0,
    skillMd: `# ${taskSlug}\n\nInitial skill — awaiting first evolution iteration.\n`,
    scripts: {},
    references: {},
    metadata: {
      createdAt: new Date().toISOString(),
      evolveStats: {
        iterations: 0,
        totalTrials: 0,
        totalCostUsd: 0,
        trainingPassRate: 0,
        validationPassRate: 0,
      },
      model: '',
    },
    checksum: '',
  };
}
