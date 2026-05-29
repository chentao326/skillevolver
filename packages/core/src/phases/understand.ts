import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TaskAxes, DecisionAxis, ParametricAxis, InvariantAxis } from '../types.js';
import type { LLMRouter } from '../llm/router.js';
import { UNDERSTAND_SYSTEM_PROMPT } from './prompts.js';
import { safeParseJSON } from '../utils/json.js';

export class UnderstandPhase {
  constructor(private llm: LLMRouter) {}

  async execute(taskPath: string): Promise<TaskAxes> {
    const taskSlug = path.basename(taskPath);
    const taskFiles = await this.readTaskDirectory(taskPath);
    const context = this.collectContext(taskFiles);

    const response = await this.llm.complete({
      role: 'understand',
      maxTokens: 4000,
      temperature: 0.1,
      systemPrompt: UNDERSTAND_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Task path: ${taskPath}\nTask slug: ${taskSlug}\n\n${context}`,
        },
      ],
    });

    const raw = safeParseJSON<Record<string, unknown>>(response.content, 'understand');
    const domain = (raw.domain as string) ?? 'unknown';
    const decisionAxes = (raw.decisionAxes as DecisionAxis[]) ?? [];
    const parametricAxes = (raw.parametricAxes as ParametricAxis[]) ?? [];
    const invariantAxes = (raw.invariantAxes as InvariantAxis[]) ?? [];
    const rewardType = (raw.rewardType as 'binary' | 'scalar') ?? 'binary';
    const summary = (raw.summary as string) ?? '';

    // 验证 parametric 轴
    for (const axis of parametricAxes) {
      if (!axis.derivationRule) {
        throw new Error(`Parametric axis "${axis.name}" lacks derivationRule`);
      }
    }

    return {
      taskSlug,
      taskPath,
      domain,
      decisionAxes,
      parametricAxes,
      invariantAxes,
      rewardType,
      summary,
    };
  }

  private async readTaskDirectory(
    taskPath: string,
  ): Promise<Array<{ name: string; content: string }>> {
    const files: Array<{ name: string; content: string }> = [];
    await this.walkDir(taskPath, '', files);
    return files;
  }

  private async walkDir(
    basePath: string,
    relativePath: string,
    files: Array<{ name: string; content: string }>,
  ): Promise<void> {
    const currentPath = path.join(basePath, relativePath);
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryRel = path.join(relativePath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        await this.walkDir(basePath, entryRel, files);
      } else {
        // 只读取文本文件
        const ext = path.extname(entry.name).toLowerCase();
        if (['.md', '.txt', '.json', '.yaml', '.yml', '.py', '.sh', '.js', '.ts'].includes(ext)) {
          const content = await fs.readFile(path.join(basePath, entryRel), 'utf-8');
          files.push({ name: entryRel, content: content.slice(0, 4000) }); // 截断长文件
        } else {
          files.push({ name: entryRel, content: `[binary file, ${ext} extension]` });
        }
      }
    }
  }

  private collectContext(files: Array<{ name: string; content: string }>): string {
    return files
      .map((f) => `### File: ${f.name}\n\`\`\`\n${f.content}\n\`\`\``)
      .join('\n\n');
  }
}
