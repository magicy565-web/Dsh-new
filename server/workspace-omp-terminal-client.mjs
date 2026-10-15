import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { validatePublicBusinessInput } from '../packages/workspace-procurement/src/workspace.mjs';

// The UI-only SDK does not carry evidence of the backend model's remaining
// cash budget. Keep execution/recovery on the reviewed original host/web path.
export function workspaceOmpTerminalControlClient(client, { transport } = {}) {
  const gap = async () => ({ status: 'unconfigured', reason: 'ORIGINAL_HOST_EXECUTION_REVIEW_REQUIRED',
    detail: 'The UI-only terminal cannot prove the original backend model cost and remaining budget. Use the original reviewed web/API execution and recovery path; no mutation or model request was sent.' });
  if (!transport) return Object.freeze({ ...client, submit: gap, resume: gap, continue: gap, businessSubmit: gap, businessResume: gap });
  const control = (operation, input) => transport.control(operation, input);
  return Object.freeze({ ...client, submit: gap, businessSubmit: gap,
    status: runId => control('status', { runId }), cancel: runId => control('cancel', { runId, confirmed: true }),
    resume: (runId, requestId) => control('resume', { runId, requestId, confirmed: true }),
    decision: (runId, proposalId, decision) => decision === 'approved' ? control('decision', { runId, proposalId, confirmed: true }) : gap(),
    continue: (runId, proposalId, requestId) => control('continue', { runId, proposalId, requestId, confirmed: true }),
    businessStatus: taskId => control('businessStatus', { taskId }), businessCancel: taskId => control('businessCancel', { taskId, confirmed: true }),
    businessResume: (taskId, _signal, requestId) => transport.resumeBusiness(taskId, requestId),
  });
}

// UI transport only. Existing HTTP APIs and Runtime own all IDs, admission,
// model requests, cancellation, task links, events and persisted results.
export function createWorkspaceOmpTerminalClient({ baseURL, fetchImpl = fetch, requestImpl, conversationId: initialConversationId = null, pollIntervalMs = 250, expectedEngineScope = 'omp:18.10.4:public-v1' } = {}) {
  if (!['omp:18.10.4:public-v1', 'omp:18.10.4:factory-materials-v1', 'omp:18.10.4:factory-customers-v1'].includes(expectedEngineScope)) throw Error('Use the fixed reviewed OMP profile.');
  const base = new URL(baseURL), host = base.hostname.replace(/^\[|\]$/g, '');
  const localOrigin = base.protocol === 'http:' && (host === 'localhost' || host === '::1' || isIP(host) === 4 && host.startsWith('127.'));
  const enterprise = typeof requestImpl === 'function' && base.protocol === 'https:';
  if ((!localOrigin && !enterprise) || base.username || base.password || base.search || base.hash || base.pathname !== '/')
    throw new Error('OMP terminal currently requires the original loopback local-mode Workspace origin; enterprise uses the original authenticated web Session.');
  if (initialConversationId !== null && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(initialConversationId)) throw new Error('Use an exact original conversation identifier.');
  let conversationId = initialConversationId, currentRunId = null, pinnedIdentity;
  const read = async (method, pathname, body) => {
    const supplied = requestImpl ? await requestImpl({ method, path: pathname, body, signal: AbortSignal.timeout(30000) }) : null;
    const response = requestImpl ? new Response(JSON.stringify(supplied.body), { status: supplied.status }) : await fetchImpl(base.origin + pathname, { method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); if (Buffer.byteLength(text) > 2_000_000) throw new Error('Original public terminal receipt exceeded its bound.');
    let value; try { value = JSON.parse(text); } catch { throw new Error('Original Workspace returned no structured public receipt.'); }
    if (!response.ok) throw new Error(`Original Workspace HTTP ${response.status}: ${value.error?.code || value.code || 'PUBLIC_REQUEST_REFUSED'}`);
    return value;
  };
  const verifyLocalSession = async () => {
    const receipt = await read('GET', '/api/session');
    if (enterprise ? receipt.mode !== 'enterprise' || receipt.authenticated !== true || !receipt.workspaceId || !receipt.user?.id || !['admin', 'operator', 'viewer'].includes(receipt.user.role)
      : receipt.mode !== 'local' || receipt.authenticated !== true || receipt.workspaceId !== 'local' || receipt.user?.id !== 'local-operator')
      throw new Error('OMP terminal needs the original local-operator Session. Enterprise Session/CSRF is not supplied by an Agent bearer.');
    const identity = JSON.stringify([receipt.mode, receipt.workspaceId, receipt.user.id, receipt.user.role]);
    if (pinnedIdentity && pinnedIdentity !== identity) throw new Error('Original terminal Session identity changed. No operation was admitted.');
    pinnedIdentity = identity;
    const runtime = await read('GET', '/api/conversations/runtime');
    if (runtime.engine !== 'omp' || runtime.engineScope !== expectedEngineScope || runtime.frontend !== 'original-workspace-conversation-run')
      throw new Error('The original host has no fixed OMP public frontend. No implicit Pi fallback or new Run is admitted.');
    return receipt;
  };
  const ensureConversation = async () => {
    if (!conversationId) {
      const created = await read('POST', '/api/conversations', { title: 'Workspace factory terminal', requestId: 'omp-terminal-' + randomUUID() });
      conversationId = created.conversation.id;
    }
    return conversationId;
  };
  return Object.freeze({
    verifyLocalSession, verifySession: verifyLocalSession, enterprise,
    current: () => ({ conversationId, runId: currentRunId }),
    async submit(content, { workspaceExecution = false } = {}) {
      validatePublicBusinessInput(content); if (!content.trim() || content.length > 16000) throw new Error('Use bounded explicit public task text.');
      if (typeof workspaceExecution !== 'boolean') throw new Error('Choose explicit execution or read-only input.');
      await verifyLocalSession();
      await ensureConversation();
      const admitted = await read('POST', `/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
        content, requestId: 'omp-terminal-' + randomUUID(), workspaceExecution,
        inputContext: { artifacts: [], skills: [], memoryIds: [], connectorActions: [] } });
      currentRunId = admitted.run.id; return { ...admitted, conversationId };
    },
    async status(runId = currentRunId) {
      if (!conversationId || !runId) return { status: 'empty', reason: 'NO_ORIGINAL_TERMINAL_RUN' };
      await verifyLocalSession();
      return read('GET', `/api/conversations/${encodeURIComponent(conversationId)}/terminal-status?runId=${encodeURIComponent(runId)}`);
    },
    async wait(runId, onReceipt = () => {}) {
      for (let attempt = 0; attempt < 400; attempt++) {
        const receipt = await this.status(runId); await onReceipt(receipt);
        if (!['queued', 'running'].includes(receipt.run?.status)) return receipt;
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }
      throw new Error('Original run remains pending. Read its exact status; no replacement task was submitted.');
    },
    async stop() {
      if (!conversationId || !currentRunId) return { status: 'empty', reason: 'NO_ORIGINAL_TERMINAL_RUN' };
      await verifyLocalSession(); return read('POST', `/api/conversations/${encodeURIComponent(conversationId)}/cancel`, {});
    },
    async control(operation, input) {
      await verifyLocalSession(); await ensureConversation();
      return read('POST', `/api/conversations/${encodeURIComponent(conversationId)}/terminal-controls`, { ...input, operation });
    },
    async resumeBusiness(taskId, requestId) {
      await verifyLocalSession(); await ensureConversation();
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(taskId || '')) throw new Error('Use an exact original task identifier.');
      return read('POST', `/api/conversations/${encodeURIComponent(conversationId)}/business-tasks/${encodeURIComponent(taskId)}/resume`, { requestId, confirmed: true });
    },
  });
}
