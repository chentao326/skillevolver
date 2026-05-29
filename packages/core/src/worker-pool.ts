/**
 * 分布式 Worker Pool — 对应 DEVELOPMENT.md Step 4.3
 * 管理并发试运行任务，支持信号量限流、结果聚合
 */

export interface WorkItem<T> {
  id: string;
  task: () => Promise<T>;
  priority?: number; // 0 = highest
}

export interface WorkResult<T> {
  id: string;
  status: 'fulfilled' | 'rejected';
  value?: T;
  error?: string;
  durationMs: number;
}

export class WorkerPool {
  private pending: Array<WorkItem<unknown>> = [];
  private activeCount = 0;
  private resolvers: Array<() => void> = [];

  constructor(private maxConcurrent: number = 4) {}

  async executeAll<T>(items: WorkItem<T>[]): Promise<WorkResult<T>[]> {
    const results = new Map<string, WorkResult<T>>();

    const promises = items.map((item) =>
      this.enqueue(item).then((result) => {
        results.set(item.id, result);
        return result;
      }),
    );

    await Promise.allSettled(promises);

    return items.map((item) => results.get(item.id)!);
  }

  private async enqueue<T>(item: WorkItem<T>): Promise<WorkResult<T>> {
    while (this.activeCount >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.resolvers.push(resolve));
    }

    this.activeCount++;
    const startTime = Date.now();

    try {
      const value = await item.task();
      this.release();
      return { id: item.id, status: 'fulfilled', value, durationMs: Date.now() - startTime };
    } catch (error) {
      this.release();
      return {
        id: item.id,
        status: 'rejected',
        error: (error as Error).message,
        durationMs: Date.now() - startTime,
      };
    }
  }

  private release(): void {
    this.activeCount--;
    const next = this.resolvers.shift();
    if (next) next();
  }

  get active(): number { return this.activeCount; }
  get pendingCount(): number { return this.pending.length; }
}

// ===== 进度追踪 =====
export interface PoolProgress {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  activeCount: number;
  estimatedRemainingMs: number;
}

export function computeProgress<T>(results: WorkResult<T>[], pool: WorkerPool): PoolProgress {
  const completed = results.filter((r) => r.status !== undefined).length;
  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;
  const avgDuration = results
    .filter((r) => r.durationMs > 0)
    .reduce((s, r) => s + r.durationMs, 0) / Math.max(completed, 1);

  return {
    total: results.length,
    completed,
    succeeded,
    failed,
    activeCount: pool.active,
    estimatedRemainingMs: Math.round(avgDuration * (results.length - completed)),
  };
}
