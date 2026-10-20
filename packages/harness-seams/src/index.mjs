// @workspace-harness/seams — mountable service providers for the Workspace Harness.
//
//   import { createStorageProvider, createApprovalProvider, createToolsProvider } from '@workspace-harness/seams';
//
// Each provider exposes `apply(ctx)`, publishes its service on the context
// (`ctx.storage` / `ctx.artifacts` / `ctx.approval` / `ctx.tools` / `ctx.llm` / `ctx.skills`)
// and returns an async disposer.
export { createStorage, createStorageProvider, resolveStorageDirectory, DEFAULT_DIRECTORY, REPO_ROOT } from './storage.mjs';
export { createApproval, createApprovalProvider, DEFAULT_TTL_MS } from './approval.mjs';
export { createTools, createToolsProvider, validateArgs, MAX_AUDIT_ENTRIES } from './tools.mjs';
export { createArtifacts, createArtifactsProvider, resolveArtifactsDirectory } from './artifacts.mjs';
export {
  createLlm, createLlmProvider, createEchoProvider, createReplayProvider, createUnavailableProvider,
} from './llm.mjs';
export {
  createSkills, createSkillsProvider, parseSkillDocument, SKILL_ERROR, DEFAULT_ROOTS, DEFAULT_MAX_SKILLS, DEFAULT_MAX_BYTES,
} from './skills.mjs';
