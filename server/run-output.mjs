import { createHash } from 'node:crypto';
import { ApiError } from './runtime.mjs';
import { sanitizeArtifactFilename, ARTIFACT_TYPES } from './artifacts.mjs';
import path from 'node:path';

const fail = (code, message) => { throw new ApiError(409, code, message); };
const fields = value => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => ['filename', 'content', 'mimeType'].includes(key));

/** Publish inert generated text with durable run provenance. No path or binary execution. */
export function createRunOutputService({ store, artifacts }) {
  return async function saveOutput({ runId, conversationId, goalId, artifact, requestId, signal }) {
    if (!fields(artifact) || typeof artifact.content !== 'string' || artifact.content.length > 80_000)
      fail('INVALID_OUTPUT_ARTIFACT', 'Generated file output must be bounded UTF-8 text.');
    const filename = sanitizeArtifactFilename(artifact.filename);
    const mimeType = ARTIFACT_TYPES[path.extname(filename).toLowerCase()];
    if (!(mimeType.startsWith('text/') || mimeType === 'application/json') || artifact.mimeType !== undefined && artifact.mimeType !== mimeType)
      fail('INVALID_OUTPUT_ARTIFACT', 'Generated file output supports txt, md, csv and json only.');
    if (typeof requestId !== 'string' || !requestId || requestId.length > 256)
      fail('INVALID_OUTPUT_ARTIFACT', 'Generated file output requires a stable step identity.');
    const key = 'run-output-' + createHash('sha256').update(`${runId}:${requestId}`).digest('hex');
    const check = state => {
      if (signal?.aborted) fail('CANCELLED', 'The run stopped before file publication.');
      const run = state.runs.find(item => item.id === runId);
      const conversation = state.conversations.find(item => item.id === conversationId);
      if (!run || run.status !== 'running' || run.conversationId !== conversationId || !conversation
        || conversation.activeRunId !== runId || conversation.status !== 'running'
        || (run.goalId || null) !== (goalId || null))
        fail('OUTPUT_RUN_RETIRED', 'This run is no longer active; no new file was published.');
      if (goalId && !state.goals.some(goal => goal.id === goalId && goal.runId === runId && goal.status === 'running'))
        fail('OUTPUT_RUN_RETIRED', 'This goal is no longer active; no new file was published.');
    };
    check(store.read());
    return artifacts.create({ filename, content: artifact.content, mimeType,
      sourceConversationId: conversationId, sourceRunId: runId, sourceGoalId: goalId || null,
      metadata: { origin: 'generated-run-output', reviewed: false }, requestId: key }, { check });
  };
}
