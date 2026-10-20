// @workspace-harness/seams — mountable service providers for the Workspace Harness.
//
//   import { createStorageProvider, createApprovalProvider, createToolsProvider } from '@workspace-harness/seams';
//
// Each provider exposes `apply(ctx)`, publishes its service on the context
// (`ctx.storage` / `ctx.approval` / `ctx.tools`) and returns an async disposer.
export { createStorage, createStorageProvider, resolveStorageDirectory, DEFAULT_DIRECTORY, REPO_ROOT } from './storage.mjs';
export { createApproval, createApprovalProvider, DEFAULT_TTL_MS } from './approval.mjs';
export { createTools, createToolsProvider, validateArgs, MAX_AUDIT_ENTRIES } from './tools.mjs';
export { createArtifacts, createArtifactsProvider, resolveArtifactsDirectory } from './artifacts.mjs';
