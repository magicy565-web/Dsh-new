import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { validatePublicBusinessInput } from '../packages/workspace-procurement/src/workspace.mjs';

// The UI-only SDK does not carry evidence of the backend model's remaining
// cash budget. Keep execution/recovery on the reviewed original host/web path.
export function workspaceOmpTerminalControlClient(client) {
  const gap = async () => ({ status: 'unconfigured', reason: 'ORIGINAL_HOST_EXECUTION_REVIEW_REQUIRED',
    detail: 'The UI-only terminal cannot prove the original backend model cost and remaining budget. Use the original reviewed web/API execution and recovery path; no mutation or model request was sent.' });
  return Object.freeze({ ...client, submit: gap, resume: gap, continue: gap, businessSubmit: gap, businessResume: gap });
}

// UI transport only. Existing HTTP APIs and Runtime own all IDs, admission,
// model requests, cancellation, task links, events and persisted results.
export function createWorkspaceOmpTerminalClient({ baseURL, fetchImpl = fetch, pollIntervalMs = 250 } = {}) {
  const base = new URL(baseURL), host = base.hostname.replace(/^\[|\]$/g, '');
  const localOrigin = base.protocol === 'http:' && (host === 'localhost' || host === '::1' || isIP(host) === 4 && host.startsWith('127.'));
  if (!localOrigin || base.username || base.password || base.search || base.hash || base.pathname !== '/')
    throw new Error('OMP terminal currently requires the original loopback local-mode Workspace origin; enterprise uses the original authenticated web Session.');
  let conversationId = null, currentRunId = null;
  const read = async (method, pathname, body) => {
    const response = await fetchImpl(base.origin + pathname, { method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); if (Buffer.byteLength(text) > 2_000_000) throw new Error('Original public terminal receipt exceeded its bound.');
    let value; try { value = JSON.parse(text); } catch { throw new Error('Original Workspace returned no structured public receipt.'); }
    if (!response.ok) throw new Error(`Original Workspace HTTP ${response.status}: ${value.error?.code || value.code || 'PUBLIC_REQUEST_REFUSED'}`);
    return value;
  };
  const verifyLocalSession = async () => {
    const receipt = await read('GET', '/api/session');
    if (receipt.mode !== 'local' || receipt.authenticated !== true || receipt.workspaceId !== 'local' || receipt.user?.id !== 'local-operator')
      throw new Error('OMP terminal needs the original local-operator Session. Enterprise Session/CSRF is not supplied by an Agent bearer.');
    const runtime = await read('GET', '/api/conversations/runtime');
    if (runtime.engine !== 'omp' || runtime.engineScope !== 'omp:18.10.4:public-v1' || runtime.frontend !== 'original-workspace-conversation-run')
      throw new Error('The original host has no fixed OMP public frontend. No implicit Pi fallback or new Run is admitted.');
    return receipt;
  };
  return Object.freeze({
    verifyLocalSession,
    current: () => ({ conversationId, runId: currentRunId }),
    async submit(content, { workspaceExecution = false } = {}) {
      validatePublicBusinessInput(content); if (!content.trim() || content.length > 16000) throw new Error('Use bounded explicit public task text.');
      if (typeof workspaceExecution !== 'boolean') throw new Error('Choose explicit execution or read-only input.');
      await verifyLocalSession();
      if (!conversationId) {
        const created = await read('POST', '/api/conversations', { title: 'Workspace factory terminal', requestId: 'omp-terminal-' + randomUUID() });
        conversationId = created.conversation.id;
      }
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
  });
}
