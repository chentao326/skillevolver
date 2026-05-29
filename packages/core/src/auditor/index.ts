import { randomUUID } from 'node:crypto';
import type { TaskAxes, SkillArtifact, Trajectory, CheckResult, AuditReport } from '../types.js';
import { AuditCheck } from '../types.js';
import type { LLMRouter } from '../llm/router.js';

// ===== 审计检查实现 =====

export async function checkFraming(
  skill: SkillArtifact,
  taskAxes: TaskAxes,
  llm: LLMRouter,
): Promise<CheckResult> {
  const response = await llm.complete({
    role: 'audit',
    maxTokens: 1000,
    temperature: 0,
    systemPrompt: `Check if the skill's name or description borrows
training-instance business nouns instead of abstract operations.
Example: "process-medical-intake-form" is a leak; "process-form-fields" is abstract.
Return JSON: { passed: boolean, evidence?: string }`,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        skillName: skill.skillId,
        skillDescription: skill.skillMd.slice(0, 500),
        trainingContext: taskAxes.summary,
      }),
    }],
  });
  return JSON.parse(response.content);
}

export function checkLiterals(skill: SkillArtifact, trainingPaths: string[]): CheckResult {
  const skillText = skill.skillMd + ' ' + Object.values(skill.scripts).join(' ');
  for (const p of trainingPaths) {
    const basename = p.split('/').pop()!;
    if (basename.length >= 3 && skillText.includes(basename)) {
      return { passed: false, evidence: `Found training filename "${basename}" in skill text` };
    }
  }
  return { passed: true };
}

export function checkScriptBloat(skill: SkillArtifact): CheckResult {
  for (const [name, content] of Object.entries(skill.scripts)) {
    const lines = content.split('\n').length;
    if (lines > 400) {
      return { passed: false, evidence: `Script "${name}" is ${lines} lines (>400 critical)` };
    }
    if (lines > 200) {
      return { passed: false, evidence: `Script "${name}" is ${lines} lines (>200 important)` };
    }
  }
  return { passed: true };
}

export async function checkUntraceable(
  skill: SkillArtifact,
  traces: Trajectory[],
  llm: LLMRouter,
): Promise<CheckResult> {
  const response = await llm.complete({
    role: 'audit',
    maxTokens: 2000,
    temperature: 0,
    systemPrompt: `Identify imperative assertions in the skill ("use X not Y", "never", "required")
and check if they have trace provenance. Flag untraceable assertions.
Return JSON: { passed: boolean, evidence?: string }`,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        skillText: skill.skillMd,
        traceSummaries: traces.map(t => t.steps.filter(s => s.type === 'tool_call')
          .map(s => `${s.toolName}: ${JSON.stringify(s.toolInput).slice(0, 100)}`).join(', ')),
      }),
    }],
  });
  return JSON.parse(response.content);
}

export function checkShapeBake(skill: SkillArtifact): CheckResult {
  for (const [name, content] of Object.entries(skill.scripts)) {
    const hasHardcodedIndex = /\[\s*['"]\w+['"]\s*\]/.test(content);
    const hasRuntimeProbe = /\.columns|\.sheetnames|\.keys\(\)/.test(content);
    if (hasHardcodedIndex && !hasRuntimeProbe) {
      return {
        passed: false,
        evidence: `Script "${name}" uses hardcoded index without runtime probe`,
      };
    }
  }
  return { passed: true };
}

export async function checkCoverage(
  skill: SkillArtifact,
  taskAxes: TaskAxes,
  llm: LLMRouter,
): Promise<CheckResult> {
  if (Object.keys(skill.scripts).length > 0) {
    return { passed: true };
  }

  const response = await llm.complete({
    role: 'audit',
    maxTokens: 500,
    temperature: 0,
    systemPrompt: `Check if this is a MECHANICAL task requiring bundled scripts
(format conversion, data extraction, template filling, file transformation).
If mechanical but skill has zero scripts, flag it.
Return JSON: { passed: boolean, evidence?: string }`,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        taskSummary: taskAxes.summary,
        domain: taskAxes.domain,
        skillScriptCount: Object.keys(skill.scripts).length,
      }),
    }],
  });
  return JSON.parse(response.content);
}

export function checkXref(skill: SkillArtifact, trainingLiterals: string[]): CheckResult {
  const skillText = skill.skillMd + ' ' + Object.values(skill.scripts).join(' ');
  const stringLiterals = extractStringLiterals(skillText).filter((s) => s.length >= 4);

  for (const literal of stringLiterals) {
    for (const trainingLiteral of trainingLiterals) {
      if (literal === trainingLiteral && literal.length >= 4) {
        return {
          passed: false,
          evidence: `Skill contains literal "${literal}" matching training data`,
        };
      }
    }
  }
  return { passed: true };
}

export async function checkUnderAbstraction(
  skill: SkillArtifact,
  parametricAxes: TaskAxes['parametricAxes'],
  llm: LLMRouter,
): Promise<CheckResult> {
  const response = await llm.complete({
    role: 'audit',
    maxTokens: 2000,
    temperature: 0,
    systemPrompt: `For each parametric axis, check whether the skill embeds
the training-specific constant without a sibling "re-derive at runtime" instruction.
Return JSON: { passed: boolean, evidence?: string }`,
    messages: [{
      role: 'user',
      content: JSON.stringify({ skillText: skill.skillMd, parametricAxes }),
    }],
  });
  return JSON.parse(response.content);
}

export async function checkPrimaryActionHoisting(
  skill: SkillArtifact,
  llm: LLMRouter,
): Promise<CheckResult> {
  if (Object.keys(skill.scripts).length === 0) return { passed: true };

  const response = await llm.complete({
    role: 'audit',
    maxTokens: 1000,
    temperature: 0,
    systemPrompt: `Check if the SKILL.md routes constraints/background prose
BEFORE the primary script invocation block. If the using-agent reads constraints
first and never invokes the script, this is a failure.
Return JSON: { passed: boolean, evidence?: string }`,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        skillMd: skill.skillMd,
        scriptNames: Object.keys(skill.scripts),
      }),
    }],
  });
  return JSON.parse(response.content);
}

export function checkSilentBypass(skill: SkillArtifact, trajectories: Trajectory[]): CheckResult {
  const primaryScripts = Object.keys(skill.scripts);
  if (primaryScripts.length === 0) return { passed: true };

  const failTraces = trajectories.filter((t) => t.reward < 1);
  if (failTraces.length === 0) return { passed: true };

  let silentCount = 0;
  for (const trace of failTraces) {
    const invoked = trace.steps.some(
      (step) =>
        step.type === 'tool_call' &&
        primaryScripts.some((script) => step.toolInput?.toString().includes(script) || step.content?.includes(script)),
    );
    if (!invoked) silentCount++;
  }

  if (silentCount > failTraces.length / 2) {
    return {
      passed: false,
      evidence: `Primary scripts never invoked in ${silentCount}/${failTraces.length} failing trials — silent bypass`,
    };
  }
  return { passed: true };
}

// ===== 工具函数 =====

function extractStringLiterals(text: string): string[] {
  const literals: string[] = [];
  // 双引号字符串
  const dq = text.match(/"([^"]{4,})"/g);
  if (dq) literals.push(...dq.map((s) => s.slice(1, -1)));
  // 单引号字符串
  const sq = text.match(/'([^']{4,})'/g);
  if (sq) literals.push(...sq.map((s) => s.slice(1, -1)));
  return [...new Set(literals)];
}

function isCritical(checkId: AuditCheck): boolean {
  return [1, 2, 4, 6, 7, 8, 9].includes(Number(checkId));
}

// ===== Auditor Engine =====

export class AuditorEngine {
  constructor(private llm: LLMRouter) {}

  async audit(
    candidateSkill: SkillArtifact,
    taskAxes: TaskAxes,
    trainingContext: { paths: string[]; literals: string[] },
    recentTrajectories: Trajectory[],
  ): Promise<AuditReport> {
    const checks: Array<{ checkId: AuditCheck; passed: boolean; evidence?: string }> = [];

    // === Static Checks (1-6) ===
    const staticResults = await Promise.all([
      checkFraming(candidateSkill, taskAxes, this.llm),
      Promise.resolve(checkLiterals(candidateSkill, trainingContext.paths)),
      Promise.resolve(checkScriptBloat(candidateSkill)),
      checkUntraceable(candidateSkill, recentTrajectories, this.llm),
      Promise.resolve(checkShapeBake(candidateSkill)),
      checkCoverage(candidateSkill, taskAxes, this.llm),
      Promise.resolve(checkXref(candidateSkill, trainingContext.literals)),
    ]);

    checks.push(
      { checkId: AuditCheck.FRAMING, ...staticResults[0] },
      { checkId: AuditCheck.LITERALS, ...staticResults[1] },
      { checkId: AuditCheck.SCRIPT_BLOAT, ...staticResults[2] },
      { checkId: AuditCheck.UNTRACEABLE, ...staticResults[3] },
      { checkId: AuditCheck.SHAPE_BAKE, ...staticResults[4] },
      { checkId: AuditCheck.COVERAGE, ...staticResults[5] },
      { checkId: AuditCheck.XREF, ...staticResults[6] },
    );

    // === Dynamic Checks (7-9) ===
    const dynamicResults = await Promise.all([
      checkUnderAbstraction(candidateSkill, taskAxes.parametricAxes, this.llm),
      checkPrimaryActionHoisting(candidateSkill, this.llm),
      Promise.resolve(checkSilentBypass(candidateSkill, recentTrajectories)),
    ]);

    checks.push(
      { checkId: AuditCheck.UNDER_ABSTRACTION, ...dynamicResults[0] },
      { checkId: AuditCheck.PRIMARY_ACTION_HOIST, ...dynamicResults[1] },
      { checkId: AuditCheck.SILENT_BYPASS, ...dynamicResults[2] },
    );

    const criticalFailures = checks.filter((c) => !c.passed && isCritical(c.checkId));
    const verdict = criticalFailures.length > 0 ? 'FAIL' : 'PASS';

    return {
      skillVersion: String(candidateSkill.version),
      timestamp: Date.now(),
      sessionId: randomUUID(),
      checks: checks.map((c) => ({
        ...c,
        severity: isCritical(c.checkId) ? 'critical' : 'warning',
      })),
      verdict,
      failReason:
        verdict === 'FAIL'
          ? criticalFailures.map((c) => c.evidence).join('; ')
          : undefined,
    };
  }
}
