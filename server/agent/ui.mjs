import { createHash } from 'node:crypto';
import { AgentHttpError } from './auth.mjs';
import { AGENT_TASK_BUDGET } from './engine.mjs';
import { agentPresetHash, requiredAgentPresetCapabilities } from './pi-preset.mjs';
import { getPreset, listPresets, validateTaskInput } from './presets.mjs';
import { artifactNameValid } from './store.mjs';
import { assertAgentUiPublicSource, assertAgentUiApprovalSource } from './ui-source.mjs';
import { looksLikeCredential } from '../security.mjs';

export const AGENT_UI_BASE = '/api/agent-ui/v1';
const OLD_BASE = '/api/agent/v1';
const fields = ['product', 'spec', 'quantity', 'target_price', 'market', 'requirements'];
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const fail = (status, code, message) => { throw new AgentHttpError(status, message, { code }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const keyValid = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const requestBytes = new WeakMap();
const budget = () => ({ ...AGENT_TASK_BUDGET, unit: 'tokens', monetaryLimit: false });
export function disabledAgentUiStatus() {
  return { enabled: false, transport: 'enterprise-session', permissions: { read: false, submit: false },
    blockers: [{ code: 'AGENT_UI_DISABLED', message: 'Agent 企业界面开关尚未开启。' }, { code: 'AGENT_SERVICE_UNAVAILABLE', message: '原 Agent 服务尚未启用。' }],
    provider: null, readiness: 'unconfigured', preset: 'procurement', review: { supported: true }, budget: budget(),
    completion: 'documents_ready', businessGoalAchieved: false, privateDisclosureSupported: false, ordinaryGoalSearch: false };
}
const urls = value => Array.isArray(value) ? value.map(urls) : object(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, ['url', 'events_url'].includes(key) && typeof item === 'string' && item.startsWith(OLD_BASE + '/') ? AGENT_UI_BASE + item.slice(OLD_BASE.length) : urls(item)])) : value;
const segment = value => { try { const decoded = decodeURIComponent(value); if (!decoded || /[\x00-\x1f/\\]/.test(decoded)) throw new Error(); return decoded; } catch { fail(400, 'INVALID_PATH', '无效路径参数。'); } };

async function json(res, status, value) {
  await res.accessFinish?.(status);
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value));
}
async function body(req, access, context) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(400, 'INVALID_JSON', '请求必须使用 application/json。');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 100_000) fail(413, 'INPUT_TOO_LARGE', '请求不能超过 100000 字节。'); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks); access.verifyBody(context, bytes);
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(400, 'INVALID_JSON', '请求必须是有效 UTF-8 JSON。'); }
  if (!object(value)) fail(400, 'INVALID_JSON', '请求必须是 JSON 对象。');
  requestBytes.set(value, bytes);
  return value;
}

/** An inert disclosure snapshot; no model calls, export permissions or public labels. */
export function createAgentUiPolicy({ env, auth, access, workspaceStore, artifacts, provider, presets }) {
  const enabled = () => env.WS_AGENT_UI_ENABLED === '1';
  function recipient() {
    const value = provider.agentUiRecipient;
    if (provider.kind !== 'pi-durable' || !provider.configured) fail(409, 'PI_MODEL_UNCONFIGURED', '缺少原 Pi 模型配置；未发送材料或调用模型。');
    if (!exact(value, ['kind', 'provider', 'model', 'destination']) || typeof value.provider !== 'string' || !value.provider || value.kind !== provider.kind || value.model !== provider.model || typeof value.destination !== 'string' || !value.destination)
      fail(409, 'AGENT_RECIPIENT_UNAVAILABLE', '原模型配置没有可审阅的准确接收目标。');
    let target; try { target = new URL(value.destination); } catch { fail(409, 'AGENT_RECIPIENT_UNAVAILABLE', '模型接收目标无效。'); }
    if (target.username || target.password || target.search || target.hash || target.protocol !== 'https:') fail(409, 'AGENT_RECIPIENT_UNAVAILABLE', '模型接收目标必须是无凭据或查询参数的准确 HTTPS 配置。');
    return structuredClone(value);
  }
  function requireEnabled() { if (!enabled()) fail(403, 'AGENT_UI_DISABLED', 'Agent 企业界面开关尚未开启。'); }
  function requireExecutable() { requireEnabled(); if (env.WS_AGENT_DEMO === '1') fail(409, 'AGENT_UI_DEMO_NOT_EXECUTABLE', '原 Agent 当前为显式模板演示；企业采购界面不能把模板作为实际 Pi 文书执行。'); }
  const sourceRecord = assertAgentUiPublicSource;
  function normalize(value) {
    if (!exact(value, ['type', 'title', 'input', 'source', 'requestKey'])) fail(400, 'AGENT_UI_INPUT_INVALID', '仅允许 type、title、input、source、requestKey。');
    if (value.type !== 'procurement' || !keyValid(value.requestKey)) fail(400, 'AGENT_UI_INPUT_INVALID', '请选择 procurement 并保留原稳定 requestKey。');
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 300 || /[\x00-\x1f\x7f]/.test(value.title)) fail(400, 'AGENT_UI_INPUT_INVALID', '标题须为 1–300 个字符。');
    if (!exact(value.input, fields)) fail(400, 'AGENT_UI_INPUT_INVALID', '仅允许采购的公开产品、规格、数量、目标价、市场和要求字段。');
    const preset = getPreset('procurement', presets);
    if (!preset || preset.stages.some(stage => requiredAgentPresetCapabilities(preset, stage).length)) fail(409, 'AGENT_UI_PRESET_UNSAFE', '当前采购预设必须保持无搜索和无外部写入。');
    try { validateTaskInput(preset, value.input); } catch { fail(400, 'AGENT_UI_INPUT_INVALID', '采购输入不符合原预设字段与数量限制。'); }
    if (typeof value.input.requirements === 'string' && value.input.requirements.length > 1000) fail(400, 'AGENT_UI_INPUT_INVALID', '本次其他要求最多 1000 个字符。');
    const source = value.source;
    if (!exact(source, ['artifactId', 'version', 'sha256', 'url', 'date']) || typeof source.artifactId !== 'string' || !Number.isSafeInteger(source.version) || source.version < 1 || !/^[a-f0-9]{64}$/.test(source.sha256 || '') || !/^\d{4}-\d{2}-\d{2}$/.test(source.date || '') || !Number.isFinite(Date.parse(source.date)) || new Date(source.date).toISOString().slice(0, 10) !== source.date)
      fail(400, 'AGENT_UI_SOURCE_INVALID', '来源需要准确 artifactId/version/sha256 与有效 YYYY-MM-DD 日期。');
    let url; try { url = new URL(source.url); } catch { fail(400, 'AGENT_UI_SOURCE_INVALID', '来源必须是公开 HTTPS URL。'); }
    if (typeof source.url !== 'string' || source.url.length > 2000 || url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname.includes('.') || /(?:localhost|\.local|\.internal)$/.test(url.hostname) || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) fail(400, 'AGENT_UI_SOURCE_INVALID', '来源必须是无凭据的公开 HTTPS URL。');
    if (looksLikeCredential(JSON.stringify(value)) || provider.containsCredential?.(JSON.stringify(value))) fail(400, 'RAW_CREDENTIAL_REJECTED', '输入不能包含原始密钥或凭据。');
    return { type: 'procurement', title: value.title.trim(), input: structuredClone(value.input), source: { ...source, url: url.href }, requestKey: value.requestKey };
  }
  async function preview(value, actor) {
    requireExecutable(); const normalized = normalize(value), target = recipient();
    const state = workspaceStore.read(), { artifact, version } = sourceRecord(state, normalized.source);
    const file = await artifacts.download(artifact.id, { version: version.version });
    if (file.version.sha256 !== normalized.source.sha256 || sha(file.bytes) !== normalized.source.sha256) fail(409, 'AGENT_SOURCE_STALE', '所选文件的原始 SHA 校验失败。');
    let content; try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes); } catch { fail(400, 'AGENT_SOURCE_TYPE_UNSUPPORTED', '公开文件不是有效 UTF-8。'); }
    if (!content.trim() || content.includes('\0') || content.length > 2800) fail(413, 'AGENT_SOURCE_TOO_LARGE', '公开规格须为 1–2800 个字符，不能静默截断。');
    if (looksLikeCredential(content) || provider.containsCredential?.(content)) fail(400, 'RAW_CREDENTIAL_REJECTED', '所选文件包含原始密钥或凭据。');
    const executionInput = { ...normalized.input, requirements: [normalized.input.requirements, '用户另行提供的公开规格（未检索或核验）：\n来源 URL：' + normalized.source.url + '\n来源日期：' + normalized.source.date + '\n文件：' + file.filename + '\n\n' + content].filter(Boolean).join('\n\n') };
    const preset = getPreset('procurement', presets);
    try { validateTaskInput(preset, executionInput); } catch { fail(413, 'AGENT_SOURCE_TOO_LARGE', '完整公开来源与要求超过原采购输入限制。'); }
    const snapshot = { ...normalized, source: { ...normalized.source, filename: file.filename, mimeType: version.mimeType, content }, executionInput,
      purpose: '仅按本次公开材料生成统一询价包、同口径比价文书和采购风险简报；不检索、不对外发送、不联系、不下单、不付款。',
      recipient: target, presetSnapshot: structuredClone(preset), permissionFingerprint: agentPresetHash({ member: actor.uiPermissionFingerprint, model: provider.agentPermissionFingerprint || provider.permissionFingerprint }),
      oneTime: true, futureAccess: false, budget: budget() };
    sourceRecord(workspaceStore.read(), normalized.source);
    return { ...snapshot, previewHash: agentPresetHash(snapshot) };
  }
  const requestOf = snapshot => ({ type: snapshot.type, title: snapshot.title, input: snapshot.input, source: Object.fromEntries(['artifactId', 'version', 'sha256', 'url', 'date'].map(key => [key, snapshot.source[key]])), requestKey: snapshot.requestKey });
  function authorizeInvocation(task) {
    requireExecutable(); const actor = auth.resolveTaskActor(task);
    const fingerprint = agentPresetHash({ member: actor.uiPermissionFingerprint, model: provider.agentPermissionFingerprint || provider.permissionFingerprint });
    if (fingerprint !== task.uiApproval?.permissionFingerprint || agentPresetHash(recipient()) !== agentPresetHash(task.uiApproval?.recipient)) fail(409, 'AGENT_UI_APPROVAL_CHANGED', '原成员权限或接收模型配置已变化。');
  }
  async function validateApproval(task, actor) {
    if (!task.uiApproval) return;
    assertAgentUiApprovalSource(workspaceStore.read(), task);
    const manifest = task.uiApproval;
    if (manifest.version !== 1 || manifest.confirmed !== true || manifest.futureAccess !== false || manifest.oneTime !== true || task.requestKey !== manifest.requestKey || agentPresetHash(task.input) !== agentPresetHash(manifest.executionInput) || agentPresetHash(task.preset) !== agentPresetHash(manifest.presetSnapshot)) fail(409, 'AGENT_UI_APPROVAL_CHANGED', '原一次性许可或任务输入已变化。');
    const current = await preview(requestOf(manifest), actor);
    if (current.previewHash !== manifest.previewHash) fail(409, 'AGENT_UI_APPROVAL_CHANGED', '公开来源、输入、模型接收目标或权限已变化；旧确认不能用于发送。');
  }
  function status(context) {
    const blockers = []; let read = false, submit = false, target = null;
    if (!enabled()) blockers.push({ code: 'AGENT_UI_DISABLED', message: 'Agent 企业界面开关尚未开启。' });
    if (env.WS_AGENT_DEMO === '1') blockers.push({ code: 'AGENT_UI_DEMO_NOT_EXECUTABLE', message: '原 Agent 当前为显式模板演示，不能用于实际 Pi 采购文书执行。' });
    try { auth.sessionActor(context); read = true; } catch (error) { blockers.push({ code: error.extra?.code || error.code, message: error.message }); }
    if (read) try { auth.sessionActor(context, { write: true }); submit = true; } catch (error) { blockers.push({ code: error.extra?.code || error.code, message: error.message }); }
    try { target = recipient(); } catch (error) { blockers.push({ code: error.extra?.code, message: error.message }); }
    return { enabled: enabled(), transport: 'enterprise-session', permissions: { read, submit }, blockers, provider: target, readiness: env.WS_AGENT_DEMO === '1' ? 'demo_not_executable' : target ? 'configured_unverified' : 'unconfigured', preset: 'procurement', review: { supported: true }, budget: budget(), completion: 'documents_ready', businessGoalAchieved: false, privateDisclosureSupported: false, ordinaryGoalSearch: false };
  }
  return { enabled, requireEnabled, sourceRecord, preview, requestOf, validateApproval, authorizeInvocation, status };
}

/** Host calls this only after its original access.begin has admitted the Session. */
export function createAgentUiHandler({ policy, auth, access, engine, store, workspaceStore, presets, stream, closing }) {
  function view(taskId, actor) {
    const task = store.getTask(taskId, actor), authoritative = engine.find(taskId, actor);
    if (!task || !authoritative) fail(404, 'AGENT_TASK_NOT_FOUND', '任务不存在。');
    const original = workspaceStore.read();
    const conversation = original.conversations.find(item => item.id === authoritative.conversationId && item.createdBy === actor.subject && item.workspaceId === actor.workspaceId);
    const observations = !conversation ? [] : authoritative.steps.flatMap(step => {
      const run = original.runs.find(item => item.id === step.runId && item.agentTaskId === taskId && item.conversationId === authoritative.conversationId && item.agentPresetContext?.subject === actor.subject && item.agentPresetContext?.workspaceId === actor.workspaceId);
      return (run?.events || []).filter(event => ['pi.tool.started', 'pi.tool.finished', 'pi.tool.failed'].includes(event.type) && ['workspace_complete_preset_stage', 'workspace_research'].includes(event.toolName) && /^[a-f0-9]{64}$/.test(event.toolCallId || '') && Number.isSafeInteger(event.sequence)).map(({ sequence, type, toolName, toolCallId, createdAt }) => ({ runId: run.id, stageKey: step.key, sequence, type, toolName, toolCallId, createdAt }));
    });
    return urls({ ...task, artifacts: store.listArtifacts(taskId).map(file => ({ ...file, sha256: authoritative.deliverables.find(item => item.name === file.name)?.sha256 })),
      toolObservations: { source: 'original-run-events', events: observations },
      humanReview: authoritative.humanReview || null, disclosure: authoritative.uiApproval ? { previewHash: authoritative.uiApproval.previewHash, approvedAt: authoritative.uiApproval.approvedAt, recipient: authoritative.uiApproval.recipient, source: authoritative.uiApproval.source, input: authoritative.uiApproval.input, executionInput: authoritative.uiApproval.executionInput, purpose: authoritative.uiApproval.purpose, budget: authoritative.uiApproval.budget, oneTime: true, futureAccess: false } : null });
  }
  return async function handleUi(req, res, context) {
    const raw = (req.url || '/').split('?')[0].replace(/\/$/, '');
    if (raw !== AGENT_UI_BASE && !raw.startsWith(AGENT_UI_BASE + '/')) return false;
    try {
      if (closing()) fail(503, 'AGENT_UI_STOPPING', '服务正在停止。');
      if (req.headers.authorization) fail(400, 'AGENT_UI_BEARER_REJECTED', 'Agent UI 只使用原企业 Session，不接受 Bearer。');
      const endpoint = raw.slice(AGENT_UI_BASE.length) || '/', query = new URL(req.url, 'http://localhost').searchParams;
      if (req.method === 'GET' && endpoint === '/status') { await json(res, 200, policy.status(context)); return true; }
      policy.requireEnabled();
      const write = !['GET', 'HEAD'].includes(req.method), actor = auth.sessionActor(context, { write });
      if (req.method === 'GET' && endpoint === '/presets') { await json(res, 200, listPresets(presets).filter(item => item.id === 'procurement')); return true; }
      if (req.method === 'POST' && ['/preview', '/tasks'].includes(endpoint)) {
        const value = await body(req, access, context), submit = endpoint === '/tasks';
        if (submit && (!exact(value, ['type', 'title', 'input', 'source', 'requestKey', 'confirmed', 'expectedPreviewHash']) || value.confirmed !== true || !/^[a-f0-9]{64}$/.test(value.expectedPreviewHash || ''))) fail(400, 'AGENT_CONFIRMATION_REQUIRED', '必须明确 confirmed=true 并提交原预览 hash。');
        const request = submit ? Object.fromEntries(['type', 'title', 'input', 'source', 'requestKey'].map(key => [key, value[key]])) : value;
        const snapshot = await policy.preview(request, actor);
        if (!submit) { await json(res, 200, snapshot); return true; }
        if (req.headers['idempotency-key'] !== value.requestKey) fail(400, 'AGENT_REQUEST_KEY_REQUIRED', 'Idempotency-Key 必须与本次原 requestKey 相同。');
        if (snapshot.previewHash !== value.expectedPreviewHash) fail(409, 'AGENT_PREVIEW_CHANGED', '公开来源、输入、目标模型或权限已变化，请重新预览并确认。');
        access.verifyBody(context, requestBytes.get(value));
        const currentActor = auth.sessionActor(context, { write: true });
        if (currentActor.uiPermissionFingerprint !== actor.uiPermissionFingerprint) fail(409, 'AGENT_PREVIEW_CHANGED', '原成员权限已变化。');
        const { task, duplicate } = await engine.submit({ actor, preset: getPreset('procurement', presets), title: snapshot.title, input: snapshot.executionInput, requestKey: snapshot.requestKey,
          uiApproval: { version: 1, ...snapshot, confirmed: true, approvedAt: new Date().toISOString() }, admission: state => { policy.requireEnabled(); policy.sourceRecord(state, snapshot.source); if (auth.sessionActor(context, { write: true }).uiPermissionFingerprint !== actor.uiPermissionFingerprint) fail(409, 'AGENT_PREVIEW_CHANGED', '原成员权限已变化。'); } });
        res.setHeader('Idempotency-Key', task.requestKey); res.setHeader('Idempotency-Replayed', duplicate ? 'true' : 'false');
        await json(res, 201, { taskId: task.id, status: task.status, events_url: AGENT_UI_BASE + '/tasks/' + task.id + '/events', request_key: task.requestKey, result: task.result }); return true;
      }
      if (req.method === 'GET' && endpoint === '/tasks') {
        const tasks = workspaceStore.read().workspaceAgentTasks.tasks.filter(task => task.subject === actor.subject && task.workspaceId === actor.workspaceId && task.type === 'procurement');
        for (const task of tasks) await engine.project(task.id);
        await json(res, 200, { tasks: tasks.map(task => view(task.id, actor)).reverse() }); return true;
      }
      const lookup = endpoint.match(/^\/tasks\/by-request\/([^/]+)$/);
      if (req.method === 'GET' && lookup) { const task = engine.byRequest(segment(lookup[1]), actor); if (!task) fail(404, 'AGENT_TASK_NOT_FOUND', '任务不存在。'); await engine.project(task.id); await json(res, 200, view(task.id, actor)); return true; }
      const action = endpoint.match(/^\/tasks\/([^/]+)\/(resume|review)$/);
      if (req.method === 'POST' && action) {
        const taskId = segment(action[1]), task = engine.find(taskId, actor);
        if (!task) fail(404, 'AGENT_TASK_NOT_FOUND', '任务不存在。');
        const value = await body(req, access, context);
        if (action[2] === 'resume') {
          if (Object.keys(value).length) fail(400, 'AGENT_RESUME_INPUT_CHANGED', '恢复只能沿用原任务与许可，不能更改输入。');
          if (!task.uiApproval) fail(409, 'AGENT_UI_APPROVAL_REQUIRED', '该任务没有原企业界面的一次性公开发送许可。');
          await policy.validateApproval(task, actor); access.verifyBody(context, requestBytes.get(value)); auth.sessionActor(context, { write: true }); await engine.resume(taskId, actor, { uiApprovalHash: task.uiApproval.previewHash });
        } else {
          if (!exact(value, ['decision', 'note']) || !['accepted', 'needs_changes'].includes(value.decision) || typeof value.note !== 'string' || value.note.length > 2000 || looksLikeCredential(value.note)) fail(400, 'AGENT_REVIEW_INVALID', '审阅须为 accepted 或 needs_changes 与最多 2000 字符的说明。');
          await workspaceStore.update(state => { access.verifyBody(context, requestBytes.get(value)); auth.sessionActor(context, { write: true }); const current = state.workspaceAgentTasks.tasks.find(item => item.id === taskId && item.subject === actor.subject && item.workspaceId === actor.workspaceId); if (!current || current.status !== 'done' || current.result?.completion !== 'documents_ready') fail(409, 'AGENT_DOCUMENTS_NOT_READY', '只有原任务已完成的文书可以人工审阅。'); current.humanReview = { version: 1, decision: value.decision, note: value.note, reviewedBy: actor.subject, reviewedAt: new Date().toISOString(), artifactHashes: current.deliverables.map(({ name, sha256 }) => ({ name, sha256 })), scope: 'documents_only', businessGoalAchieved: false, externalActionAuthorized: false }; });
        }
        await engine.project(taskId); await json(res, 200, view(taskId, actor)); return true;
      }
      const match = endpoint.match(/^\/tasks\/([^/]+)(?:\/(events|artifacts)(?:\/([^/]+))?)?$/);
      if (!match || req.method !== 'GET') fail(404, 'AGENT_UI_NOT_FOUND', '接口不存在。');
      const id = segment(match[1]); if (!engine.find(id, actor)) fail(404, 'AGENT_TASK_NOT_FOUND', '任务不存在。'); await engine.project(id);
      if (!match[2]) { await json(res, 200, view(id, actor)); return true; }
      if (match[2] === 'events' && !match[3]) {
        const rawCursor = query.get('from') ?? req.headers['last-event-id'] ?? '0';
        if (typeof rawCursor !== 'string' || !/^(0|[1-9][0-9]*)$/.test(rawCursor) || !Number.isSafeInteger(Number(rawCursor))) fail(400, 'AGENT_EVENT_CURSOR_INVALID', 'from 必须是非负整数。');
        if (query.has('format') && query.get('format') !== 'json') fail(400, 'AGENT_EVENT_FORMAT_INVALID', 'format 只支持 json 或省略的 SSE。');
        if (query.get('format') === 'json') await json(res, 200, urls(store.events(id, Number(rawCursor))));
        else await stream(res, id, Number(rawCursor), actor, context, urls);
        return true;
      }
      if (match[2] === 'artifacts') {
        if (!match[3]) { await json(res, 200, view(id, actor).artifacts); return true; }
        const name = segment(match[3]); if (!artifactNameValid(name)) fail(400, 'AGENT_ARTIFACT_INVALID', '无效文件名。');
        let file; try { file = await store.readArtifact(id, name); } catch { fail(404, 'AGENT_ARTIFACT_UNAVAILABLE', '原文件不存在或 SHA 校验失败。'); }
        if (!file) fail(404, 'AGENT_ARTIFACT_UNAVAILABLE', '原文件不存在。');
        if (query.has('sha256') && query.get('sha256') !== sha(file.data)) fail(409, 'AGENT_ARTIFACT_SHA_CHANGED', '原文件 SHA 与已审阅值不一致。');
        await res.accessFinish?.(200); res.writeHead(200, { ...headers, 'Content-Type': name.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8', 'Content-Length': file.bytes, 'Content-Disposition': `attachment; filename="${name}"`, 'X-Artifact-Sha256': sha(file.data) }); res.end(file.data); return true;
      }
      fail(404, 'AGENT_UI_NOT_FOUND', '接口不存在。');
    } catch (error) {
      if (res.headersSent) res.destroy();
      else await json(res, error.status || 500, { error: error.status ? error.message : '服务无法完成请求。', code: error.extra?.code || error.code || 'AGENT_UI_INTERNAL_ERROR' });
      await auth.recordDenial(error).catch(() => {}); return true;
    }
  };
}
