# Spec: SkillEvolver 工程化架构设计

## 背景

基于论文《SkillEvolver: Skill Learning as a Meta-Skill》(arXiv:2605.10500) 的思想，设计一套完整的工程化架构方案和详细开发步骤。论文核心贡献：让 AI Agent 在不动模型权重的情况下，通过有限部署试错自我进化出可复用的领域技能。

## 用户故事

- 作为架构师，我需要审查系统架构是否完整覆盖了论文的全部核心机制
- 作为开发者，我需要看到可直接执行的详细开发步骤（含接口定义、伪代码、验收标准）
- 作为项目负责人，我需要评估开发工作量和里程碑可行性

## 交付物

1. **ARCHITECTURE.md** — 系统架构设计文档
2. **DEVELOPMENT.md** — 详细开发步骤文档

## 验收标准

- [ ] ARCHITECTURE.md 覆盖论文全部核心组件：Orchestrator、Strategy Engine、Sandbox Manager、Trace Engine、Auditor Engine、Skill Registry、LLM Router、Anti-Leak Layer
- [ ] 每个模块有明确的 TypeScript 接口定义
- [ ] 数据流完整可追溯（Understand → Explore → Update → Audit → Finalize）
- [ ] DEVELOPMENT.md 包含 4 个 Phase、20+ 个可执行 Step
- [ ] 每个 Step 含：文件结构、接口/伪代码、验收标准、预估工时
- [ ] 开发步骤与论文的 Algorithm 1、Table 3（9 项审计检查）、§A.3（防泄露）严格对应
- [ ] 包含里程碑检查清单
- [ ] 架构设计不绑定特定 LLM 或 Agent 框架

## 技术约束

- 语言：TypeScript
- 包管理：pnpm monorepo
- 沙箱：Docker + Harbor 隔离
- 存储：SQLite + 文件系统
- 技能格式：Markdown + 脚本文件，符合 CLI Agent 标准接口

## 边界情况

- 单任务执行（Phase 1）vs 批量任务（Phase 4）
- K=4 并行探索的部分失败处理
- 审计失败后的 targeted patch 路径
- 成本超预算的自动中断机制
- 训练/验证 domain gap（如 court-form-filling 案例）
