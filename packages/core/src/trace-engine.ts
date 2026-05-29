import Database from 'better-sqlite3';
import path from 'node:path';
import type { Trajectory, Step } from './types.js';

/**
 * Trace Engine — 对应论文 §3.2.2 φ() 函数
 * 持久化存储试运行轨迹，支持查询和特征提取
 */
export class TraceEngine {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trajectories (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        strategy_id TEXT NOT NULL,
        skill_version TEXT,
        reward REAL NOT NULL,
        success INTEGER NOT NULL,
        steps_json TEXT NOT NULL,
        total_tokens INTEGER DEFAULT 0,
        total_turns INTEGER DEFAULT 0,
        wall_clock_ms INTEGER DEFAULT 0,
        sandbox_id TEXT DEFAULT '',
        model_name TEXT DEFAULT '',
        error TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_traj_task ON trajectories(task_id);
      CREATE INDEX IF NOT EXISTS idx_traj_iter ON trajectories(task_id, iteration);
      CREATE INDEX IF NOT EXISTS idx_traj_reward ON trajectories(task_id, reward);
    `);
  }

  async save(trajectory: Trajectory): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO trajectories
        (id, task_id, iteration, strategy_id, skill_version, reward, success,
         steps_json, total_tokens, total_turns, wall_clock_ms,
         sandbox_id, model_name, error)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      trajectory.id,
      trajectory.taskId,
      trajectory.iteration,
      trajectory.strategyId,
      trajectory.skillVersion ?? null,
      trajectory.reward,
      trajectory.success ? 1 : 0,
      JSON.stringify(trajectory.steps),
      trajectory.totalTokens,
      trajectory.totalTurns,
      trajectory.wallClockMs,
      trajectory.sandboxId,
      trajectory.modelName,
      trajectory.error ?? null,
    );
  }

  async saveBatch(trajectories: Trajectory[]): Promise<void> {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO trajectories
        (id, task_id, iteration, strategy_id, skill_version, reward, success,
         steps_json, total_tokens, total_turns, wall_clock_ms,
         sandbox_id, model_name, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((trajs: Trajectory[]) => {
      for (const t of trajs) {
        insert.run(
          t.id, t.taskId, t.iteration, t.strategyId,
          t.skillVersion ?? null, t.reward, t.success ? 1 : 0,
          JSON.stringify(t.steps), t.totalTokens, t.totalTurns, t.wallClockMs,
          t.sandboxId, t.modelName, t.error ?? null,
        );
      }
    });

    transaction(trajectories);
  }

  queryByTask(taskId: string): Trajectory[] {
    const rows = this.db.prepare(
      'SELECT * FROM trajectories WHERE task_id = ? ORDER BY iteration, reward DESC',
    ).all(taskId) as Array<Record<string, unknown>>;

    return rows.map(this.rowToTrajectory);
  }

  queryByIteration(taskId: string, iteration: number): Trajectory[] {
    const rows = this.db.prepare(
      'SELECT * FROM trajectories WHERE task_id = ? AND iteration = ? ORDER BY reward DESC',
    ).all(taskId, iteration) as Array<Record<string, unknown>>;

    return rows.map(this.rowToTrajectory);
  }

  getTopTrajectories(taskId: string, iteration: number, count: number = 2): Trajectory[] {
    const rows = this.db.prepare(
      'SELECT * FROM trajectories WHERE task_id = ? AND iteration = ? ORDER BY reward DESC LIMIT ?',
    ).all(taskId, iteration, count) as Array<Record<string, unknown>>;

    return rows.map(this.rowToTrajectory);
  }

  getBottomTrajectories(taskId: string, iteration: number, count: number = 2): Trajectory[] {
    const rows = this.db.prepare(
      'SELECT * FROM trajectories WHERE task_id = ? AND iteration = ? ORDER BY reward ASC LIMIT ?',
    ).all(taskId, iteration, count) as Array<Record<string, unknown>>;

    return rows.map(this.rowToTrajectory);
  }

  getStats(taskId: string): {
    totalTrials: number;
    totalIterations: number;
    avgReward: number;
    maxReward: number;
    passRate: number;
    avgTokens: number;
    avgWallClockMs: number;
  } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total_trials,
        MAX(iteration) + 1 as total_iterations,
        AVG(reward) as avg_reward,
        MAX(reward) as max_reward,
        SUM(success) * 1.0 / COUNT(*) as pass_rate,
        AVG(total_tokens) as avg_tokens,
        AVG(wall_clock_ms) as avg_wall_clock_ms
      FROM trajectories WHERE task_id = ?
    `).get(taskId) as Record<string, number>;

    return {
      totalTrials: row.total_trials ?? 0,
      totalIterations: row.total_iterations ?? 0,
      avgReward: row.avg_reward ?? 0,
      maxReward: row.max_reward ?? 0,
      passRate: row.pass_rate ?? 0,
      avgTokens: Math.round(row.avg_tokens ?? 0),
      avgWallClockMs: Math.round(row.avg_wall_clock_ms ?? 0),
    };
  }

  close(): void {
    this.db.close();
  }

  private rowToTrajectory(row: Record<string, unknown>): Trajectory {
    return {
      id: row.id as string,
      taskId: row.task_id as string,
      iteration: row.iteration as number,
      strategyId: row.strategy_id as string,
      skillVersion: row.skill_version as string | undefined,
      steps: JSON.parse(row.steps_json as string) as Step[],
      totalTokens: row.total_tokens as number,
      totalTurns: row.total_turns as number,
      wallClockMs: row.wall_clock_ms as number,
      reward: row.reward as number,
      success: (row.success as number) === 1,
      error: row.error as string | undefined,
      sandboxId: row.sandbox_id as string,
      modelName: row.model_name as string,
      timestamp: new Date(row.created_at as string).getTime(),
    };
  }
}
