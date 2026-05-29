import type { TaskAxes, SkillArtifact, Strategy, DecisionAxis, ParametricAxis, Trajectory } from '../types.js';
import type { LLMRouter } from '../llm/router.js';
import { STRATEGY_GEN_PROMPT } from './prompts.js';
import { safeParseJSON } from '../utils/json.js';

export class StrategyEngine {
  constructor(private llm: LLMRouter) {}

  async generateBootstrap(axes: TaskAxes, k: number = 4): Promise<Strategy[]> {
    const response = await this.llm.complete({
      role: 'strategy_gen',
      maxTokens: 8000,
      temperature: 0.7,
      systemPrompt: STRATEGY_GEN_PROMPT,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          task: axes.summary,
          decisionAxes: axes.decisionAxes,
          parametricAxes: axes.parametricAxes,
          count: k,
          requirements: [
            'Each strategy must differ on at least one decision axis',
            'For each parametric axis, at least one strategy must use RUNTIME_DERIVE',
            'Strategies represent high-level plans, not token-level variations',
          ],
        }),
      }],
    });

    const parsed = safeParseJSON(response.content, "generateBootstrap");
    const strategies: Strategy[] = (parsed as any).strategies ?? [];

    this.validateDiversity(strategies, axes.decisionAxes);
    this.validateParametricCoverage(strategies, axes.parametricAxes);

    return strategies;
  }

  async generateTargeted(
    axes: TaskAxes,
    currentSkill: SkillArtifact,
    prevTrajectories: Trajectory[],
    k: number = 4,
  ): Promise<Strategy[]> {
    const failureModes = this.extractFailureModes(prevTrajectories);

    const response = await this.llm.complete({
      role: 'strategy_gen',
      maxTokens: 8000,
      temperature: 0.7,
      systemPrompt: STRATEGY_GEN_PROMPT,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          task: axes.summary,
          decisionAxes: axes.decisionAxes,
          currentSkillSummary: {
            version: currentSkill.version,
            description: currentSkill.skillMd.slice(0, 1000),
            scripts: Object.keys(currentSkill.scripts),
          },
          failureModes,
          count: k,
          requirements: [
            'Each strategy must target a different observed failure mode',
            'Strategies stress-test the current skill where it is weakest',
          ],
        }),
      }],
    });

    const parsed = safeParseJSON<{ strategies?: Strategy[] }>(response.content, 'generateTargeted');
    const strategies: Strategy[] = parsed.strategies ?? [];
    
    this.validateDiversity(strategies, axes.decisionAxes);
    
    return strategies;
  }

  private validateDiversity(strategies: Strategy[], axes: DecisionAxis[]): void {
    for (let i = 0; i < strategies.length; i++) {
      for (let j = i + 1; j < strategies.length; j++) {
        const identical = axes.every((axis) => {
          const a = strategies[i].decisions[axis.name] ?? '';
          const b = strategies[j].decisions[axis.name] ?? '';
          return a === b && a !== '';
        });
        if (identical && axes.length > 0) {
          throw new Error(`Strategies ${i} and ${j} are identical on all decision axes`);
        }
      }
    }
  }

  private validateParametricCoverage(strategies: Strategy[], axes: ParametricAxis[]): void {
    for (const axis of axes) {
      const hasRuntimeDerive = strategies.some(
        (s) => s.parametricValues[axis.name] === 'RUNTIME_DERIVE',
      );
      if (!hasRuntimeDerive) {
        throw new Error(
          `No strategy uses RUNTIME_DERIVE for parametric axis "${axis.name}"`,
        );
      }
    }
  }

  private extractFailureModes(trajectories: Trajectory[]): string[] {
    return trajectories
      .filter((t) => !t.success)
      .map((t) => t.error ?? 'unknown error');
  }
}
