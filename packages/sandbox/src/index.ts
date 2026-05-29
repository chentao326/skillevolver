import { randomUUID } from 'node:crypto';
import { promises as fs, realpathSync } from 'node:fs';
import path from 'node:path';

// ===== Self-contained types (no core dependency) =====

export interface Step {
  type: 'think' | 'tool_call' | 'tool_result' | 'message';
  content: string;
  tokens: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
}

export interface Trajectory {
  id: string;
  taskId: string;
  iteration: number;
  strategyId: string;
  skillVersion?: string;
  steps: Step[];
  totalTokens: number;
  totalTurns: number;
  wallClockMs: number;
  reward: number;
  success: boolean;
  error?: string;
  sandboxId: string;
  modelName: string;
  timestamp: number;
}

export interface SandboxConfig {
  taskPath: string;
  skillPath?: string;
  workspacePrefix: string;
  timeoutMs: number;
  env: Record<string, string>;
  maxTurns: number;
}

export interface SandboxRunParams {
  agentCommand: string;
}

export interface SandboxResult {
  exitCode: number;
  trajectory: Trajectory;
  stdout: string;
  stderr: string;
  wallClockMs: number;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export type PreToolUseHook = (tool: ToolCall) => ToolCall | null;

// ===== 轨迹收集器 =====

export class TrajectoryCollector {
  private steps: Step[] = [];
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  addThink(content: string): void {
    this.steps.push({ type: 'think', content, tokens: Math.ceil(content.length / 4) });
  }

  addToolCall(name: string, input: Record<string, unknown>): void {
    this.steps.push({
      type: 'tool_call',
      content: `${name}(${JSON.stringify(input).slice(0, 200)})`,
      tokens: Math.ceil(JSON.stringify(input).length / 4),
      toolName: name,
      toolInput: input,
    });
  }

  addToolResult(name: string, output: string): void {
    this.steps.push({
      type: 'tool_result',
      content: output.slice(0, 1000),
      tokens: Math.ceil(output.length / 4),
      toolName: name,
      toolOutput: output,
    });
  }

  finalize(overrides: Partial<Trajectory> = {}): Trajectory {
    return {
      id: randomUUID(),
      taskId: overrides.taskId ?? '',
      iteration: overrides.iteration ?? 0,
      strategyId: overrides.strategyId ?? '',
      skillVersion: overrides.skillVersion,
      steps: this.steps,
      totalTokens: this.steps.reduce((s, st) => s + st.tokens, 0),
      totalTurns: this.steps.filter((s) => s.type === 'tool_call').length,
      wallClockMs: Date.now() - this.startTime,
      reward: overrides.reward ?? 0,
      success: overrides.success ?? false,
      error: overrides.error,
      sandboxId: overrides.sandboxId ?? '',
      modelName: overrides.modelName ?? 'unknown',
      timestamp: Date.now(),
    };
  }
}

// ===== 工作区白名单 Hook =====

export function createWorkspaceWhitelistHook(workspacePrefix: string): PreToolUseHook {
  const DENY_PATTERNS = [
    /\.\./,
    /curated.?skill/i,
    /\/etc\//,
    /\/proc\//,
    /\/sys\//,
    /\.env$/,
    /\.git\//,
  ];

  return (tool: ToolCall): ToolCall | null => {
    for (const [, value] of Object.entries(tool.input)) {
      if (typeof value === 'string' && isPathLike(value)) {
        const resolved = path.resolve(workspacePrefix, value);
        for (const pattern of DENY_PATTERNS) {
          if (pattern.test(resolved)) return null;
        }
        // Resolve symlinks if the path exists; for new files, trust the resolved path.
        let realPath: string;
        try { realPath = realpathSync(resolved); } catch { realPath = resolved; }
        for (const pattern of DENY_PATTERNS) {
          if (pattern.test(realPath)) return null;
        }
        if (!realPath.startsWith(path.resolve(workspacePrefix))) return null;
      }
    }
    return tool;
  };
}

function isPathLike(value: string): boolean {
  return value.includes('/') || value.includes('\\') || value.startsWith('.');
}

// ===== 沙箱管理器 =====

export class SandboxManager {
  async executeLocal(
    config: SandboxConfig,
    params: SandboxRunParams,
  ): Promise<SandboxResult> {
    const collector = new TrajectoryCollector();
    const sandboxId = randomUUID();
    const startTime = Date.now();

    try {
      const { execSync } = await import('node:child_process');
      const envVars = { ...process.env, ...config.env };
      const cwd = config.workspacePrefix;

      await fs.mkdir(cwd, { recursive: true });
      await this.copyDir(config.taskPath, path.join(cwd, 'task'));
      if (config.skillPath) {
        await this.copyDir(config.skillPath, path.join(cwd, 'skill'));
      }

      collector.addThink(`开始执行: ${params.agentCommand.slice(0, 200)}`);

      const output = execSync(params.agentCommand, {
        cwd,
        env: envVars,
        timeout: config.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8',
      });

      collector.addThink('任务完成');
      return {
        exitCode: 0,
        trajectory: collector.finalize({ sandboxId, modelName: 'local' }),
        stdout: output,
        stderr: '',
        wallClockMs: Date.now() - startTime,
      };
    } catch (error: unknown) {
      const err = error as Error & { stdout?: string; stderr?: string; status?: number; code?: number | string };
      collector.addThink(`错误: ${err.message}`);
      const exitCode = typeof err.status === 'number' ? err.status
        : typeof err.code === 'number' ? err.code
        : 1;
      return {
        exitCode,
        trajectory: collector.finalize({ sandboxId, modelName: 'local', error: err.message, reward: 0, success: false }),
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
        wallClockMs: Date.now() - startTime,
      };
    }
  }

  private async copyDir(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const sp = path.join(src, entry.name);
      const dp = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await this.copyDir(sp, dp);
      } else {
        await fs.copyFile(sp, dp);
      }
    }
  }
}
