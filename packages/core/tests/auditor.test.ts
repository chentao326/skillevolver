import { describe, it, expect } from 'vitest';
import {
  checkScriptBloat,
  checkLiterals,
  checkShapeBake,
  checkXref,
  checkSilentBypass,
} from '../src/auditor/index.js';
import type { SkillArtifact, Trajectory } from '../src/types.js';

type Artifact = Pick<SkillArtifact, 'skillMd' | 'scripts'>;

function makeArtifact(overrides?: Partial<Artifact>): Artifact {
  return {
    skillMd: '# Test Skill\n\n## Primary\n```bash\npython run.py\n```',
    scripts: overrides?.scripts ?? {},
    ...overrides,
  };
}

function makeTrajectory(
  overrides?: Partial<Trajectory>,
): Trajectory {
  return {
    id: 't1', taskId: 'task-a', iteration: 0, strategyId: 's1',
    steps: [], totalTokens: 10, totalTurns: 1, wallClockMs: 100,
    reward: 1, success: true,
    sandboxId: 'sb1', modelName: 'test', timestamp: Date.now(),
    ...overrides,
  };
}

// ========================
// checkScriptBloat
// ========================

describe('checkScriptBloat', () => {
  it('passes when no scripts', () => {
    expect(checkScriptBloat(makeArtifact() as SkillArtifact).passed).toBe(true);
  });

  it('fails when script exceeds 400 lines (critical)', () => {
    const lines = Array(401).fill('pass').join('\n');
    const a = makeArtifact({ scripts: { 'huge.py': lines } }) as SkillArtifact;
    const r = checkScriptBloat(a);
    expect(r.passed).toBe(false);
    expect(r.evidence).toContain('critical');
  });

  it('fails when script exceeds 200 lines', () => {
    const lines = Array(250).fill('pass').join('\n');
    const a = makeArtifact({ scripts: { 'big.py': lines } }) as SkillArtifact;
    const r = checkScriptBloat(a);
    expect(r.passed).toBe(false);
    expect(r.evidence).toContain('250');
  });

  it('passes when script is within limits', () => {
    const lines = Array(100).fill('pass').join('\n');
    const a = makeArtifact({ scripts: { 'ok.py': lines } }) as SkillArtifact;
    expect(checkScriptBloat(a).passed).toBe(true);
  });
});

// ========================
// checkLiterals
// ========================

describe('checkLiterals', () => {
  it('passes when training filenames are not in skill', () => {
    const a = makeArtifact({ skillMd: '# Abstract skill' }) as SkillArtifact;
    expect(checkLiterals(a, ['training/specific_data.csv']).passed).toBe(true);
  });

  it('fails when training filename appears in skill body', () => {
    const a = makeArtifact({ skillMd: 'Process specific_data.csv efficiently' }) as SkillArtifact;
    const r = checkLiterals(a, ['training/input/specific_data.csv']);
    expect(r.passed).toBe(false);
    expect(r.evidence).toContain('specific_data.csv');
  });

  it('fails when training filename appears in scripts', () => {
    const a = makeArtifact({
      skillMd: '# Skill',
      scripts: { 'run.py': 'data = open("patient_records.json")' },
    }) as SkillArtifact;
    const r = checkLiterals(a, ['input/patient_records.json']);
    expect(r.passed).toBe(false);
  });

  it('ignores short basenames (< 3 chars)', () => {
    const a = makeArtifact({ skillMd: '# Ab' }) as SkillArtifact;
    expect(checkLiterals(a, ['data/ab.csv']).passed).toBe(true);
  });
});

// ========================
// checkShapeBake
// ========================

describe('checkShapeBake', () => {
  it('passes when no scripts', () => {
    expect(checkShapeBake(makeArtifact() as SkillArtifact).passed).toBe(true);
  });

  it('passes when dynamic keys use runtime probe', () => {
    const a = makeArtifact({
      scripts: { 'run.py': 'col = df.columns[0]\ndf[col]' },
    }) as SkillArtifact;
    expect(checkShapeBake(a).passed).toBe(true);
  });

  it('fails when hardcoded index used without runtime probe', () => {
    const a = makeArtifact({
      scripts: { 'run.py': 'score = df["net_score"] * 2' },
    }) as SkillArtifact;
    const r = checkShapeBake(a);
    expect(r.passed).toBe(false);
    expect(r.evidence).toContain('hardcoded');
  });

  it('passes when hardcoded index used WITH runtime probe', () => {
    const a = makeArtifact({
      scripts: { 'run.py': '# shape\nprint(df.columns)\nval = df["score"] * 2' },
    }) as SkillArtifact;
    expect(checkShapeBake(a).passed).toBe(true);
  });
});

// ========================
// checkXref
// ========================

describe('checkXref', () => {
  it('passes when no training literals match', () => {
    const a = makeArtifact({ skillMd: '# Abstract processing' }) as SkillArtifact;
    expect(checkXref(a, ['medical_form_123', 'patient_id']).passed).toBe(true);
  });

  it('fails when double-quoted training literal appears in skill', () => {
    const a = makeArtifact({ skillMd: '"medical_form_123" is the target' }) as SkillArtifact;
    const r = checkXref(a, ['templates', 'medical_form_123', 'submitter']);
    expect(r.passed).toBe(false);
  });

  it('fails when single-quoted training literal appears in script', () => {
    const a = makeArtifact({
      skillMd: '# Skill',
      scripts: { 'run.py': "template = 'patient_dashboard_v2'" },
    }) as SkillArtifact;
    const r = checkXref(a, ['patient_dashboard_v2', 'records']);
    expect(r.passed).toBe(false);
  });

  it('ignores literals shorter than 4 characters', () => {
    const a = makeArtifact({ skillMd: 'foo bar baz' }) as SkillArtifact;
    // "foo" is 3 chars, too short to be extracted as a literal
    expect(checkXref(a, ['foo']).passed).toBe(true);
  });
});

// ========================
// checkSilentBypass
// ========================

describe('checkSilentBypass', () => {
  it('passes when no scripts exist', () => {
    const t = makeTrajectory({ reward: 0, success: false });
    expect(checkSilentBypass(makeArtifact() as SkillArtifact, [t]).passed).toBe(true);
  });

  it('passes when no failures', () => {
    const a = makeArtifact({ scripts: { 'run.py': 'pass' } }) as SkillArtifact;
    const t = makeTrajectory({ reward: 1, success: true });
    expect(checkSilentBypass(a, [t]).passed).toBe(true);
  });

  it('passes when failing traces invoked primary scripts', () => {
    const a = makeArtifact({ scripts: { 'doit.sh': 'echo ok' } }) as SkillArtifact;
    const t = makeTrajectory({
      reward: 0, success: false,
      steps: [{ type: 'tool_call', content: 'run doit.sh', tokens: 1, toolName: 'bash', toolInput: { cmd: './doit.sh' } }],
    });
    expect(checkSilentBypass(a, [t]).passed).toBe(true);
  });

  it('fails when majority of failures never invoked primary scripts', () => {
    const a = makeArtifact({ scripts: { 'run.py': 'pass' } }) as SkillArtifact;
    const t1 = makeTrajectory({ id: 't1', reward: 0, steps: [] });
    const t2 = makeTrajectory({ id: 't2', reward: 0, steps: [] });
    const t3 = makeTrajectory({ id: 't3', reward: 0, steps: [
      { type: 'tool_call', content: 'run.py', tokens: 1, toolName: 'bash', toolInput: { cmd: 'python run.py' } },
    ] });
    const r = checkSilentBypass(a, [t1, t2, t3]);
    expect(r.passed).toBe(false);
    expect(r.evidence).toContain('silent bypass');
  });
});
