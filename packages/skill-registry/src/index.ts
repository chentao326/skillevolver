import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Minimal types (avoid circular dep with core)
interface SkillArtifact {
  skillId: string;
  domain: string;
  taskSlug: string;
  version: number;
  skillMd: string;
  scripts: Record<string, string>;
  references: Record<string, string>;
  metadata: SkillMetadata;
  checksum: string;
}

interface SkillMetadata {
  createdAt: string;
  evolveStats: {
    iterations: number;
    totalTrials: number;
    totalCostUsd: number;
    trainingPassRate: number;
    validationPassRate: number;
  };
  model: string;
  parentVersion?: number;
}

export class SkillStore {
  constructor(private basePath: string) {}

  async save(skill: SkillArtifact): Promise<void> {
    const versionDir = path.join(this.basePath, skill.taskSlug, '.versions', `v${skill.version}`);
    await fs.mkdir(path.join(versionDir, 'scripts'), { recursive: true });

    skill.checksum = this.computeChecksum(skill);

    await fs.writeFile(path.join(versionDir, 'SKILL.md'), skill.skillMd, 'utf-8');

    for (const [name, content] of Object.entries(skill.scripts)) {
      await fs.mkdir(path.dirname(path.join(versionDir, 'scripts', name)), { recursive: true });
      await fs.writeFile(path.join(versionDir, 'scripts', name), content, 'utf-8');
    }

    if (Object.keys(skill.references).length > 0) {
      await fs.mkdir(path.join(versionDir, 'references'), { recursive: true });
      for (const [name, content] of Object.entries(skill.references)) {
        await fs.writeFile(path.join(versionDir, 'references', name), content, 'utf-8');
      }
    }

    await fs.writeFile(
      path.join(versionDir, 'metadata.json'),
      JSON.stringify(skill.metadata, null, 2),
      'utf-8',
    );

    const headPath = path.join(this.basePath, skill.taskSlug, 'HEAD');
    try { await fs.unlink(headPath); } catch { /* */ }
    await fs.symlink(`.versions/v${skill.version}`, headPath, 'dir');
  }

  async loadLatest(taskSlug: string): Promise<SkillArtifact> {
    const headPath = path.join(this.basePath, taskSlug, 'HEAD');
    const realPath = await fs.readlink(headPath);
    const version = parseInt(realPath.replace('.versions/v', ''), 10);
    return this.loadVersion(taskSlug, version);
  }

  async loadVersion(taskSlug: string, version: number): Promise<SkillArtifact> {
    const versionDir = path.join(this.basePath, taskSlug, '.versions', `v${version}`);
    const skillMd = await fs.readFile(path.join(versionDir, 'SKILL.md'), 'utf-8');
    const metadataRaw = await fs.readFile(path.join(versionDir, 'metadata.json'), 'utf-8');
    const metadata: SkillMetadata = JSON.parse(metadataRaw);

    const scripts: Record<string, string> = {};
    try {
      const scriptFiles = await fs.readdir(path.join(versionDir, 'scripts'));
      for (const file of scriptFiles) {
        scripts[file] = await fs.readFile(path.join(versionDir, 'scripts', file), 'utf-8');
      }
    } catch { /* */ }

    const references: Record<string, string> = {};
    try {
      const refFiles = await fs.readdir(path.join(versionDir, 'references'));
      for (const file of refFiles) {
        references[file] = await fs.readFile(path.join(versionDir, 'references', file), 'utf-8');
      }
    } catch { /* */ }

    return {
      skillId: taskSlug,
      domain: this.extractDomain(taskSlug),
      taskSlug,
      version,
      skillMd,
      scripts,
      references,
      metadata,
      checksum: this.computeChecksum({ skillMd, scripts } as SkillArtifact),
    };
  }

  async listVersions(taskSlug: string): Promise<number[]> {
    const versionsDir = path.join(this.basePath, taskSlug, '.versions');
    const entries = await fs.readdir(versionsDir);
    return entries
      .filter((e) => e.startsWith('v'))
      .map((e) => parseInt(e.replace('v', ''), 10))
      .sort((a, b) => a - b);
  }

  async exists(taskSlug: string): Promise<boolean> {
    try { await fs.access(path.join(this.basePath, taskSlug)); return true; }
    catch { return false; }
  }

  async deleteTask(taskSlug: string): Promise<void> {
    await fs.rm(path.join(this.basePath, taskSlug), { recursive: true, force: true });
  }

  private computeChecksum(skill: Pick<SkillArtifact, 'skillMd' | 'scripts'>): string {
    const hash = crypto.createHash('sha256');
    hash.update(skill.skillMd);
    for (const [, content] of Object.entries(skill.scripts).sort(([a], [b]) => a.localeCompare(b))) {
      hash.update(content);
    }
    return hash.digest('hex').slice(0, 16);
  }

  private extractDomain(taskSlug: string): string {
    return taskSlug.split('-')[0] ?? 'unknown';
  }
}

export function validateSkill(skill: SkillArtifact): string[] {
  const errors: string[] = [];
  if (!skill.skillMd?.trim()) errors.push('SKILL.md is empty');
  if (!skill.skillId?.trim()) errors.push('skillId is required');
  if (skill.version < 0) errors.push('version must be >= 0');
  for (const [name, content] of Object.entries(skill.scripts)) {
    if (content.split('\n').length > 400) {
      errors.push(`Script "${name}" exceeds 400 lines (critical bloat)`);
    }
  }
  return errors;
}

export { SkillStore as SkillRegistry };
