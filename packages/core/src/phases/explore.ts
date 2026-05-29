import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TaskAxes, SkillArtifact, Strategy, Trajectory } from '../types.js';
import type { LLMRouter } from '../llm/router.js';
import { SandboxManager, createWorkspaceWhitelistHook } from '@skillevolver/sandbox';
import type { SandboxConfig, SandboxResult, PreToolUseHook } from '@skillevolver/sandbox';
import { AGENT_SCRIPT_PROMPT } from './prompts.js';

export class ExploreSubPhase {
  constructor(
    private sandbox: SandboxManager,
    private llm: LLMRouter,
  ) {}

  async executeSingle(
    task: TaskAxes,
    skill: SkillArtifact | null,
    strategy: Strategy,
    iteration: number,
    trialIndex: number,
    hooks?: { preToolUse?: PreToolUseHook },
  ): Promise<Trajectory> {
    const workspacePrefix = `/tmp/skillevolver/${task.taskSlug}/r${iteration}_t${trialIndex}`;
    const whitelistHook = createWorkspaceWhitelistHook(workspacePrefix);

    const skillDir = skill ? path.join(workspacePrefix, 'skill', 'scripts') : null;
    if (skillDir && skill) {
      await fs.mkdir(skillDir, { recursive: true });
      for (const [name, content] of Object.entries(skill.scripts)) {
        await fs.writeFile(path.join(skillDir, name), content, 'utf-8');
      }
    }

    const sandboxConfig: SandboxConfig = {
      taskPath: task.taskPath,
      skillPath: undefined,
      workspacePrefix,
      timeoutMs: 300_000,
      env: {
        SKILL_STRATEGY_ID: strategy.id,
        SKILL_ITERATION: String(iteration),
        SKILL_TRIAL_INDEX: String(trialIndex),
        SKILL_CONTENT: skill?.skillMd ?? '',
      },
      maxTurns: 200,
    };

    const agentCmd = await this.buildAgentCommand(task, skill, strategy, workspacePrefix);

    const result = await this.sandbox.executeLocal(sandboxConfig, {
      agentCommand: agentCmd,
    });

    console.log(`\n[Explore R${iteration} T${trialIndex}] ${strategy.name}`);
    console.log(`  exitCode=${result.exitCode}`);
    console.log(`  stdout:\n${result.stdout.slice(0, 800)}`);
    console.log(`  stderr:\n${result.stderr.slice(0, 400)}`);

    const reward = await this.computeReward(task, result);
    console.log(`  => reward=${reward}`);

    const trajectory: Trajectory = {
      ...result.trajectory,
      taskId: task.taskSlug,
      iteration,
      strategyId: strategy.id,
      skillVersion: skill ? String(skill.version) : undefined,
      reward,
      success: task.rewardType === 'binary' ? reward >= 1 : reward > 0,
    };

    return trajectory;
  }

  async executeParallel(
    task: TaskAxes,
    skill: SkillArtifact | null,
    strategies: Strategy[],
    iteration: number,
  ): Promise<Trajectory[]> {
    const results = await Promise.allSettled(
      strategies.map((strategy, i) =>
        this.executeSingle(task, skill, strategy, iteration, i),
      ),
    );

    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        id: randomUUID(),
        taskId: task.taskSlug,
        iteration,
        strategyId: strategies[i].id,
        steps: [],
        totalTokens: 0,
        totalTurns: 0,
        wallClockMs: 0,
        reward: 0,
        success: false,
        error: (r.reason as Error).message,
        sandboxId: 'failed',
        modelName: 'unknown',
        timestamp: Date.now(),
      };
    });
  }

  private async buildAgentCommand(
    task: TaskAxes,
    skill: SkillArtifact | null,
    strategy: Strategy,
    workspacePrefix: string,
  ): Promise<string> {
    const taskFiles = await this.readTaskFiles(task.taskPath);

    const userMessage: Record<string, unknown> = {
      taskSummary: task.summary,
      taskDomain: task.domain,
      strategy: {
        name: strategy.name,
        description: strategy.description,
        plan: strategy.content,
        decisions: strategy.decisions,
      },
      taskFiles,
      hasExistingSkill: skill !== null,
    };

    if (skill) {
      userMessage.existingSkillScripts = Object.keys(skill.scripts);
      userMessage.existingSkillSummary = skill.skillMd.slice(0, 1500);
    }

    let pythonScript: string;
    try {
      const resp = await this.llm.complete({
        role: 'domain_agent',
        maxTokens: 2000,
        temperature: 0.2,
        systemPrompt: AGENT_SCRIPT_PROMPT,
        messages: [{
          role: 'user',
          content: JSON.stringify(userMessage),
        }],
      });
      pythonScript = this.extractPythonCode(resp.content);
    } catch (e) {
      pythonScript = this.fallbackScript(task);
    }

    const scriptPath = path.join(workspacePrefix, 'agent_script.py');
    await fs.mkdir(workspacePrefix, { recursive: true });
    await fs.writeFile(scriptPath, pythonScript, 'utf-8');

    // 加强诊断：运行 Python 后 ls + cat 检查输出
    return [
      '#!/bin/bash',
      `echo "Task: ${task.summary.slice(0, 100)}"`,
      `echo "Strategy: ${strategy.name}"`,
      'mkdir -p output',
      'python3 agent_script.py 2>&1',
      'PY_EXIT=$?',
      'echo "--- DEBUG ---"',
      'echo "Python exit: $PY_EXIT"',
      'echo "CWD: $(pwd)"',
      'ls -la output/ 2>&1 || echo "output/ does not exist"',
      'echo "--- output/stats.json ---"',
      'cat output/stats.json 2>&1 || echo "(file not found)"',
      'echo "--- END DEBUG ---"',
      'if [ -f ./task/evaluate.sh ]; then bash ./task/evaluate.sh; else echo "SCORE: $PY_EXIT"; fi',
    ].join('\n');
  }

  private extractPythonCode(llmResponse: string): string {
    const fenceMatch = llmResponse.match(/```python\s*([\s\S]*?)```/);
    if (fenceMatch) return fenceMatch[1].trim();
    const genericFence = llmResponse.match(/```\s*([\s\S]*?)```/);
    if (genericFence) return genericFence[1].trim();
    return llmResponse.trim();
  }

  private async readTaskFiles(taskPath: string): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    try {
      const entries = await fs.readdir(taskPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (['.md', '.sh', '.txt', '.json', '.csv', '.yaml', '.yml'].includes(ext)) {
            const content = await fs.readFile(path.join(taskPath, entry.name), 'utf-8');
            files[entry.name] = content.slice(0, 3000);
          }
        }
        if (entry.isDirectory() && entry.name === 'input') {
          const inputFiles = await fs.readdir(path.join(taskPath, entry.name), { withFileTypes: true });
          for (const f of inputFiles) {
            if (f.isFile()) {
              const content = await fs.readFile(path.join(taskPath, entry.name, f.name), 'utf-8');
              files[`input/${f.name}`] = content.slice(0, 5000);
            }
          }
        }
      }
    } catch { /* ignore */ }
    return files;
  }

  private fallbackScript(task: TaskAxes): string {
    const domain = task.domain.toLowerCase();
    if (domain.includes('text') || task.summary.toLowerCase().includes('word') || task.summary.toLowerCase().includes('count')) {
      return [
        'import json, os',
        'def count_stats(text):',
        '    return {"total_words": len(text.split()), "total_chars": len(text), "total_lines": text.count(chr(10))}',
        'input_dir = "task/input"',
        'text = ""',
        'if os.path.isdir(input_dir):',
        '    for f in os.listdir(input_dir):',
        '        fpath = os.path.join(input_dir, f)',
        '        if os.path.isfile(fpath):',
        '            with open(fpath) as fh: text = fh.read()',
        '            break',
        'os.makedirs("output", exist_ok=True)',
        'stats = count_stats(text)',
        'with open("output/stats.json", "w") as fh: json.dump(stats, fh)',
        'print(f"Wrote: {stats}")',
      ].join('\n');
    }
    return [
      'import json, os',
      'os.makedirs("output", exist_ok=True)',
      'with open("output/stats.json", "w") as f: json.dump({"result": "ok"}, f)',
      'print("Done")',
    ].join('\n');
  }

  private async computeReward(task: TaskAxes, result: SandboxResult): Promise<number> {
    const combined = result.stdout + result.stderr;
    const match = combined.match(/SCORE:\s*([\d.]+)/);
    if (match) return parseFloat(match[1]);
    if (task.rewardType === 'binary') return result.exitCode === 0 ? 1 : 0;
    return 0;
  }
}
