import { createHash } from 'node:crypto';
import { AgentHttpError } from './auth.mjs';
import { looksLikeCredential } from '../security.mjs';

const fail = (status, code, message) => { throw new AgentHttpError(status, message, { code }); };
const keyValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const owns = (run, actor) => run?.piTaskContext?.subject === actor.subject && run.piTaskContext.workspaceId === actor.workspaceId;

/** Thin original-Runtime tool surface. No task queue, executor or storage is added. */
export function createPiTaskApi({ auth, runtime, store, provider }) {
  function original(id, actor, write = false) {
    const run = store.read().runs.find(value => value.id === id);
    if (!owns(run, actor)) fail(404, 'PI_TASK_NOT_FOUND', 'Pi 任务不存在。');
    if (write) {
      auth.authorizePiTask(run.piTaskContext);
      const current = auth.piTaskContext(actor, { delegation: run.piTaskContext.allowSubagents });
      if (current.authorityFingerprint !== run.piTaskContext.authorityFingerprint)
        fail(403, 'PI_TASK_AUTHORIZATION_REVOKED', '只能用原成员及未变化的授权继续本次 Pi 任务。');
    }
    return run;
  }
  function view(run) {
    const reply = store.read().messages.find(value => value.id === run.assistantId);
    return { taskId: run.id, runId: run.id, conversationId: run.conversationId, requestId: run.requestId, status: run.status,
      authority: 'original-workspace-runtime', businessGoalAchieved: false, error: run.error, budget: run.budget,
      stepCount: run.stepCount || 0, outputTokens: run.outputTokens || 0, usage: run.usage, usageStatus: run.usageStatus,
      events: run.events || [], proposals: run.proposals || [],
      reply: reply ? { id: reply.id, status: reply.status, content: reply.content, error: reply.error, runtime: reply.runtime || null,
        artifactReference: reply.artifactReference || null } : null };
  }
  return {
    async handle({ endpoint, req, res, actor, readJson, json }) {
      if (!endpoint.startsWith('/pi/')) return false;
      if (req.method === 'GET' && endpoint === '/pi/tools') {
        await json(res, 200, { version: 1, plugin: 'workspace', authority: 'original-workspace-runtime',
          configured: provider.configured === true, connected: false,
          tools: ['workspace_task', 'workspace_status', 'workspace_delegate'],
          humanCommands: ['decision', 'continue', 'cancel', 'resume'],
          delegatedExecution: provider.piTaskPermissionFingerprint ? 'pi-durable-owned-foreground' : 'unavailable',
          privateFiles: 'not-accepted', backgroundSubagents: false });
        return true;
      }
      if (req.method === 'POST' && endpoint === '/pi/tasks') {
        const body = await readJson(req);
        if (!object(body) || Object.keys(body).some(key => !['title', 'content', 'requestId', 'connectorActions', 'delegation'].includes(key)))
          fail(400, 'PI_TASK_INPUT_INVALID', '仅接受明确输入的任务文本及本次工具选择。');
        const requestId = body.requestId || req.headers['idempotency-key'];
        if (!keyValid(requestId) || req.headers['idempotency-key'] && req.headers['idempotency-key'] !== requestId)
          fail(400, 'PI_TASK_REQUEST_ID_REQUIRED', '需要一个稳定且一致的 requestId。');
        if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 160 || typeof body.content !== 'string' || !body.content.trim() || body.content.length > 20_000)
          fail(400, 'PI_TASK_INPUT_INVALID', '提供有界任务标题和明确的公开任务文本。');
        if (looksLikeCredential(body.content) || looksLikeCredential(body.title)) fail(400, 'RAW_CREDENTIAL_REJECTED', '任务文本不能包含凭据。');
        if (body.delegation !== undefined && typeof body.delegation !== 'boolean') fail(400, 'PI_TASK_INPUT_INVALID', 'delegation 必须是布尔值。');
        const connectorActions = body.connectorActions ?? [];
        if (!Array.isArray(connectorActions) || connectorActions.length > 8 || connectorActions.some(value => !object(value) || Object.keys(value).some(key => !['connectorId', 'action'].includes(key)) || typeof value.connectorId !== 'string' || !value.connectorId.trim() || value.connectorId.length > 128 || typeof value.action !== 'string' || !value.action.trim() || value.action.length > 128))
          fail(400, 'PI_TASK_INPUT_INVALID', '只接受本次明确选择的 connectorId/action。');
        const piTaskContext = auth.piTaskContext(actor, { delegation: body.delegation });
        if (!provider.piTaskPermissionFingerprint) fail(409, 'PI_TASK_RUNTIME_REQUIRED', '现有 Pi Host 尚未启用受控任务插件。');
        const selection = { artifacts: [], skills: [], memoryIds: [], connectorActions };
        const creationId = 'pi-' + createHash('sha256').update(requestId).digest('hex');
        const { conversation } = await runtime.createConversation({ title: body.title.trim(), requestId: creationId, inputContext: selection }, actor, { piTaskContext });
        const admitted = await runtime.sendMessage(conversation.id, { content: body.content, requestId, inputContext: selection, queued: true, workspaceExecution: true }, { piTaskContext });
        const run = original(admitted.run.id, actor);
        res.setHeader('Idempotency-Replayed', admitted.duplicate ? 'true' : 'false');
        await json(res, 201, { ...view(run), duplicate: admitted.duplicate === true });
        return true;
      }
      const byRequest = endpoint.match(/^\/pi\/tasks\/by-request\/([A-Za-z0-9_-]{1,96})$/);
      if (req.method === 'GET' && byRequest) {
        const run = store.read().runs.find(value => value.requestId === byRequest[1] && owns(value, actor));
        if (!run) fail(404, 'PI_TASK_NOT_FOUND', 'Pi 任务不存在。');
        await json(res, 200, view(run)); return true;
      }
      const match = endpoint.match(/^\/pi\/tasks\/([A-Za-z0-9_-]{1,128})(?:\/(cancel|resume|decision|continue))?$/);
      if (!match) fail(404, 'PI_TASK_NOT_FOUND', 'Pi 接口不存在。');
      const run = original(match[1], actor, req.method !== 'GET');
      if (req.method === 'GET' && !match[2]) { await json(res, 200, view(run)); return true; }
      if (req.method !== 'POST' || !match[2]) fail(404, 'PI_TASK_NOT_FOUND', 'Pi 接口不存在。');
      const body = await readJson(req);
      if (!object(body)) fail(400, 'PI_TASK_INPUT_INVALID', 'Pi 任务操作需对象输入。');
      if (match[2] === 'cancel') {
        if (Object.keys(body).length) fail(400, 'PI_TASK_INPUT_INVALID', '取消原任务不能修改输入。');
        await runtime.cancelRun(run.id);
      } else if (match[2] === 'resume') {
        if (Object.keys(body).some(key => key !== 'requestId') || !keyValid(body.requestId)) fail(400, 'PI_TASK_INPUT_INVALID', '恢复需稳定 requestId，不能更换输入或权限。');
        await runtime.recoverPiRun(run.id, { requestId: body.requestId });
      } else if (match[2] === 'decision') {
        await runtime.resolveRunAction(run.id, body);
      } else {
        if (Object.keys(body).some(key => !['proposalId', 'requestId'].includes(key)) || !keyValid(body.requestId) || typeof body.proposalId !== 'string' || !body.proposalId || body.proposalId.length > 128)
          fail(400, 'PI_TASK_INPUT_INVALID', '继续需明确 proposalId 及稳定 requestId。');
        await runtime.resumeRun(run.id, body);
      }
      await json(res, 200, view(original(run.id, actor))); return true;
    },
  };
}
