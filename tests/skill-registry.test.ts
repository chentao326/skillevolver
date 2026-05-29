import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SkillStore, validateSkill } from '@skillevolver/skill-registry';

describe('SkillStore', () => {
  let store: SkillStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `skillevolver-test-${Date.now()}`);
    store = new SkillStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('save and loadLatest round-trip', async () => {
    const skill = {
      skillId: 'test-task',
      domain: 'testing',
      taskSlug: 'test-task',
      version: 1,
      skillMd: '# Test Skill\n\nThis is a test skill.',
      scripts: { 'run.sh': '#!/bin/bash\necho "hello"' },
      references: {},
      metadata: {
        createdAt: new Date().toISOString(),
        evolveStats: { iterations: 1, totalTrials: 5, totalCostUsd: 1.23, trainingPassRate: 0.8, validationPassRate: 0.6 },
        model: 'test-model',
      },
      checksum: '',
    };

    await store.save(skill);
    const loaded = await store.loadLatest('test-task');

    expect(loaded.version).toBe(1);
    expect(loaded.skillMd).toBe('# Test Skill\n\nThis is a test skill.');
    expect(loaded.scripts['run.sh']).toBe('#!/bin/bash\necho "hello"');
    expect(loaded.checksum).toBeTruthy();
    expect(loaded.checksum.length).toBe(16);
  });

  it('versioning: multiple saves increment correctly', async () => {
    const base = {
      skillId: 'versioned-task', domain: 'testing', taskSlug: 'versioned-task',
      skillMd: 'v1', scripts: {}, references: {},
      metadata: { createdAt: '', evolveStats: { iterations: 0, totalTrials: 0, totalCostUsd: 0, trainingPassRate: 0, validationPassRate: 0 }, model: '' },
      checksum: '',
    };

    await store.save({ ...base, version: 1, skillMd: 'version 1' });
    await store.save({ ...base, version: 2, skillMd: 'version 2' });
    await store.save({ ...base, version: 3, skillMd: 'version 3' });

    const versions = await store.listVersions('versioned-task');
    expect(versions).toEqual([1, 2, 3]);

    const latest = await store.loadLatest('versioned-task');
    expect(latest.version).toBe(3);
    expect(latest.skillMd).toBe('version 3');
  });

  it('validateSkill catches empty SKILL.md', () => {
    const skill = {
      skillId: 'bad', domain: 'x', taskSlug: 'bad', version: 1,
      skillMd: '', scripts: {}, references: {},
      metadata: { createdAt: '', evolveStats: { iterations: 0, totalTrials: 0, totalCostUsd: 0, trainingPassRate: 0, validationPassRate: 0 }, model: '' },
      checksum: '',
    };
    const errors = validateSkill(skill);
    expect(errors).toContain('SKILL.md is empty');
  });
});
