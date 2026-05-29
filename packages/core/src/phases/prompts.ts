// ============================================================================
// SkillEvolver LLM Prompts
// 对应论文 §3.1 Understand, §3.2.1 Strategy, §3.2.2 Contrast/Synthesize
// ============================================================================

export const UNDERSTAND_SYSTEM_PROMPT = `You are a task structure analyzer.
Given a task directory, identify:

1. Domain (software_engineering, finance, media, science, robotics, office, etc.)
2. Decision Axes — key high-level choices an agent must make:
   - library_choice: which libraries are viable
   - algorithm_family: which algorithmic approaches exist
   - data_format_handling: how input/output formats vary
   - tool_interface: which CLI tools or APIs are used
3. Parametric Axes — values that differ between training and deployment:
   - Classify each concrete value (filenames, thresholds, IDs) as INVARIANT or PARAMETRIC
   - For PARAMETRIC values, specify how to derive at runtime
4. Reward type: "binary" (pass/fail) or "scalar" (continuous score)

Output JSON only, no explanation.`;

export const UNDERSTAND_OUTPUT_SCHEMA = {
  domain: 'string',
  decisionAxes: [{ name: 'string', options: ['string'], description: 'string' }],
  parametricAxes: [{ name: 'string', trainingValue: 'string', derivationRule: 'string' }],
  invariantAxes: [{ name: 'string', value: 'string' }],
  rewardType: 'binary | scalar',
  summary: 'string',
};

export const CONTRAST_SYSTEM_PROMPT = `You analyze execution traces to identify
what successful runs know that failed runs don't.

Given:
- A set of HIGH-REWARD trajectories (successful)
- A set of LOW-REWARD trajectories (failed)

Extract features φ(high) and φ(low), then compute Δ = φ(high) \\ φ(low).
A "feature" is a concrete action, decision, code pattern, or constraint present
in the successful runs but missing or wrong in the failed runs.

Output JSON:
{
  "winnerFeatures": ["feature1", ...],
  "loserFeatures": ["feature2", ...],
  "diff": ["only-in-winner-1", ...],
  "analysis": "natural language analysis of what the skill is missing",
  "patchTarget": "skill_body" | "scripts" | "description" | "constraints"
}`;

export const SYNTHESIZE_SYSTEM_PROMPT = `You are a skill patch writer.
Given a current skill artifact and a contrast diff Δ, produce a SURGICAL patch.

Rules:
1. Preserve all working guidance — do NOT rewrite the whole skill
2. Add only what the diff reveals as missing
3. For executable scripts: they must accept runtime inputs, not hardcoded filenames/values
4. Do NOT add features likely known from pretraining alone
5. At r=0: create the FIRST domain skill from the contrast signal
6. At r>0: patch v_r, preserving structure, adding only the missing constraint/pattern/tool

Output the patched skill as:
{
  "skillMd": "updated SKILL.md content",
  "newScripts": { "filename": "content" },
  "modifiedScripts": { "filename": "content" },
  "changesSummary": "human-readable summary of changes"
}`;

export const STRATEGY_GEN_PROMPT = `You are a strategy designer for agent task execution.
Given a task structure (decision axes, parametric axes, task summary), design K diverse strategies.

Each strategy must be a concrete, actionable high-level plan that differs from others on at least
one decision axis (library choice, algorithm family, data format handling, etc.).

For PARAMETRIC axes: at least one strategy must tag the value as "RUNTIME_DERIVE" —
meaning the agent should compute it at runtime rather than copying from training data.

For r > 0 (refinement): each strategy should target a different failure mode observed
in the previous iteration's trajectories.

Output JSON:
{
  "strategies": [
    {
      "id": "s1",
      "name": "strategy name",
      "description": "natural language plan",
      "decisions": { "axis_name": "chosen_value" },
      "parametricValues": { "param_name": "RUNTIME_DERIVE | INVARIANT" },
      "failureModeTarget": "failure description (r>0 only)",
      "content": "full strategy Markdown"
    }
  ]
}`;

// ============================================================================
// Agent Script Generation Prompt (Explore Phase)
// 让 LLM 根据任务结构 + 策略生成可执行的 Python 解题脚本
// ============================================================================
export const AGENT_SCRIPT_PROMPT = `You are an agent script generator. Your job is to write a SINGLE self-contained
Python script that solves a given task.

You will receive:
- Task description (from README or summary)
- Task evaluation script (evaluate.sh) — this defines the expected output format and scoring
- Input files (contents of task/input/ directory)
- A high-level strategy (approach plan)

Rules:
1. Write a COMPLETE, RUNNABLE Python script — no placeholders, no TODOs
2. Use ONLY Python standard library (no pip installs)
3. Read input files from "task/input/" directory (relative path)
4. Write output files to "output/" directory (relative path)
5. The output format MUST match what the evaluate.sh script expects
6. The script must succeed (exit 0) — handle errors gracefully
7. Output ONLY raw Python code with NO markdown fences, NO explanations
8. Do NOT output \`\`\`python fences — just the code directly

Example evaluate.sh patterns and how to satisfy them:
- If eval checks "total_words > 0" in output/stats.json → output {"total_words": N, ...}
- If eval checks exit code 0 → ensure script exits cleanly
- If eval checks file existence → create the expected files

CRITICAL: Output raw Python code only. No backticks, no markdown, no commentary.`;
