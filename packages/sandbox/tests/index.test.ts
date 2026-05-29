import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  TrajectoryCollector,
  createWorkspaceWhitelistHook,
  SandboxManager,
} from '../src/index.js';

describe('TrajectoryCollector', () => {
  it('addThink records a think step', () => {
    const c = new TrajectoryCollector();
    c.addThink('hello');
    const t = c.finalize();
    expect(t.steps.length).toBe(1);
    expect(t.steps[0].type).toBe('think');
    expect(t.steps[0].content).toBe('hello');
  });

  it('addToolCall records name and input', () => {
    const c = new TrajectoryCollector();
    c.addToolCall('bash', { cmd: 'ls' });
    const t = c.finalize();
    expect(t.steps[0].type).toBe('tool_call');
    expect(t.steps[0].toolName).toBe('bash');
    expect(t.steps[0].toolInput).toEqual({ cmd: 'ls' });
  });

  it('addToolResult records output', () => {
    const c = new TrajectoryCollector();
    c.addToolResult('bash', 'ok');
    const t = c.finalize();
    expect(t.steps[0].type).toBe('tool_result');
    expect(t.steps[0].toolOutput).toBe('ok');
  });

  it('finalize computes totals from steps', () => {
    const c = new TrajectoryCollector();
    c.addThink('thinking');
    c.addToolCall('bash', { cmd: 'ls' });
    c.addToolResult('bash', 'file1\nfile2');
    c.addToolCall('write', { path: 'out.txt', content: 'done' });
    c.addToolResult('write', 'written');

    const t = c.finalize({ sandboxId: 'sb1', modelName: 'test', reward: 1, success: true });
    expect(t.totalTurns).toBe(2);
    expect(t.sandboxId).toBe('sb1');
    expect(t.modelName).toBe('test');
    expect(t.reward).toBe(1);
    expect(t.success).toBe(true);
    expect(t.wallClockMs).toBeGreaterThanOrEqual(0);
  });

  it('finalize accepts override fields', () => {
    const c = new TrajectoryCollector();
    const t = c.finalize({
      taskId: 'task-a',
      iteration: 3,
      strategyId: 's2',
      skillVersion: 'v2',
      error: 'timeout',
    });
    expect(t.taskId).toBe('task-a');
    expect(t.iteration).toBe(3);
    expect(t.strategyId).toBe('s2');
    expect(t.skillVersion).toBe('v2');
    expect(t.error).toBe('timeout');
  });
});

describe('createWorkspaceWhitelistHook', () => {
  it('allows paths inside workspace', () => {
    const hook = createWorkspaceWhitelistHook('/tmp/ws');
    const result = hook({ name: 'write', input: { path: '/tmp/ws/output/data.txt' } });
    expect(result).not.toBeNull();
  });

  it('blocks path traversal with ..', () => {
    const hook = createWorkspaceWhitelistHook('/tmp/ws');
    const result = hook({ name: 'read', input: { path: '../../etc/passwd' } });
    expect(result).toBeNull();
  });

  it('blocks env file access', () => {
    const hook = createWorkspaceWhitelistHook('/tmp/ws');
    const result = hook({ name: 'read', input: { path: '/tmp/ws/.env' } });
    expect(result).toBeNull();
  });

  it('blocks git directory access', () => {
    const hook = createWorkspaceWhitelistHook('/tmp/ws');
    const result = hook({ name: 'read', input: { path: '/tmp/ws/.git/config' } });
    expect(result).toBeNull();
  });

  it('blocks paths outside workspace', () => {
    const hook = createWorkspaceWhitelistHook('/tmp/ws');
    const result = hook({ name: 'read', input: { path: '/etc/hosts' } });
    expect(result).toBeNull();
  });

  it('passes non-path values through unchanged', () => {
    const hook = createWorkspaceWhitelistHook('/tmp/ws');
    const result = hook({ name: 'bash', input: { cmd: 'ls', timeout: 5000 } });
    expect(result).toEqual({ name: 'bash', input: { cmd: 'ls', timeout: 5000 } });
  });
});

describe('SandboxManager.executeLocal', () => {
  let taskDir: string;
  let workDir: string;

  beforeEach(async () => {
    const base = path.join(os.tmpdir(), `sb-test-${Date.now()}`);
    taskDir = path.join(base, 'task');
    workDir = path.join(base, 'ws');
    await fs.mkdir(taskDir, { recursive: true });
    await fs.mkdir(workDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(path.dirname(taskDir), { recursive: true, force: true });
    } catch { /* */ }
  });

  it('executes a shell command and captures output', async () => {
    const sm = new SandboxManager();
    const config = {
      taskPath: taskDir,
      workspacePrefix: workDir,
      timeoutMs: 10000,
      env: {},
      maxTurns: 10,
    };

    const result = await sm.executeLocal(config, {
      agentCommand: 'echo "hello world"',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello world');
    expect(result.wallClockMs).toBeGreaterThanOrEqual(0);
    expect(result.trajectory.steps.length).toBeGreaterThan(0);
  });

  it('copies task directory into workspace', async () => {
    await fs.writeFile(path.join(taskDir, 'README.md'), '# Test Task');
    const sm = new SandboxManager();
    const config = {
      taskPath: taskDir,
      workspacePrefix: workDir,
      timeoutMs: 10000,
      env: {},
      maxTurns: 10,
    };

    await sm.executeLocal(config, {
      agentCommand: 'cat task/README.md',
    });

    const copied = await fs.readFile(path.join(workDir, 'task', 'README.md'), 'utf-8');
    expect(copied).toBe('# Test Task');
  });

  it('captures exit code from failed commands', async () => {
    // Write a script that exits with a known code
    await fs.writeFile(path.join(workDir, 'fail.sh'), '#!/bin/sh\n>&2 echo "error output"\nexit 3\n', { mode: 0o755 });

    const sm = new SandboxManager();
    const config = {
      taskPath: taskDir,
      workspacePrefix: workDir,
      timeoutMs: 10000,
      env: {},
      maxTurns: 10,
    };

    const result = await sm.executeLocal(config, {
      agentCommand: 'sh ./fail.sh',
    });

    expect(result.exitCode).toBe(3);
    expect(result.trajectory.error).toBeDefined();
    expect(result.stderr).toContain('error output');
  });
});
