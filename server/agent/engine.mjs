import { randomUUID, createHash } from 'node:crypto';
import { AgentHttpError } from './auth.mjs';
import { AGENT_EVENT_KINDS } from './store.mjs';
import { buildAgentPresetContext, agentPresetHash } from './pi-preset.mjs';
import { assertAgentUiApprovalSource } from './ui-source.mjs';
import { ACTION_NOTICE, DEMO_NOTICE, RESEARCH_NOTICE, buildEvidenceTables, buildInputTable, collectInputEvidence, renderTemplate } from './presets.mjs';

const now = () => new Date().toISOString();
export const AGENT_TASK_BUDGET = Object.freeze({ maxSteps: 4, maxOutputTokens: 6400 });
const tasks = state => state.workspaceAgentTasks.tasks;
const own = (task, actor) => task.subject === actor.subject && task.workspaceId === actor.workspaceId;
const active = task => ['queued', 'running'].includes(task.status);
const requestKeyValid = key => typeof key === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key);
const hash = text => createHash('sha256').update(text).digest('hex');
const stableRequest = (id, key) => { const h = hash(id + ':' + key); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32); };
function event(task, key, kind, payload) {
  if (!AGENT_EVENT_KINDS.includes(kind)) throw new Error('Unknown event kind.');
  if (task.events.some(item => item.sourceKey === key)) return;
  task.events.push({ seq: task.events.length + 1, kind, payload, ts: now(), sourceKey: key });
}
function result(task, state, extra = {}) {
  return { version: 1, state, completion: state === 'completed' ? 'documents_ready' : 'incomplete', businessGoalAchieved: false,
    execution: task.mode === 'demo' ? 'explicit-template-demo' : 'original-pi-runtime', mode: task.mode, attempt: task.attempt, ...extra };
}
function templateContext(task) {
  const context = { input: task.input, task: { taskId: task.id, title: task.title, type: task.type },
    facts: buildInputTable(task.preset, task.input), tables: buildEvidenceTables(task.preset, task.input),
    evidence: collectInputEvidence(task.input), stages: {} };
  for (const stage of task.preset.stages) {
    const step = task.steps.find(item => item.key === stage.key);
    if (step.output) context.stages[stage.key] = renderTemplate(stage.output_template, { ...context, analysis: step.output });
  }
  return context;
}
function addArtifact(task, name, content, partial = false) {
  const sha256 = hash(content);
  const previous = task.deliverables.find(item => item.name === name);
  if (previous) { if (previous.sha256 !== sha256) throw new Error('Artifact content is immutable.'); return; }
  const file = { name, content, bytes: Buffer.byteLength(content), sha256, url: '/api/agent/v1/tasks/' + task.id + '/artifacts/' + encodeURIComponent(name), partial };
  task.deliverables.push(file);
  event(task, 'artifact:' + name, 'artifact', { name, bytes: file.bytes, url: file.url });
}
function readyArtifacts(task) {
  const context = templateContext(task);
  for (const artifact of task.preset.artifacts) {
    if (task.deliverables.some(item => item.name === artifact.name) || !artifact.stages.every(key => task.steps.find(step => step.key === key)?.status === 'succeeded')) continue;
    const body = artifact.template ? renderTemplate(artifact.template, context) : '# ' + (artifact.title || artifact.name) + '\n\n' + artifact.stages.map(key => context.stages[key]).join('\n\n');
    const receipts = task.steps.flatMap(step => step.result?.researchReceipts || []);
    const evidenceNotice = receipts.length ? '数据范围：用户材料及本任务真实检索工具回执；引用来源不等于已完成供应商身份、成交价格或销量核验。' : RESEARCH_NOTICE;
    addArtifact(task, artifact.name, (task.mode === 'demo' ? '> ' + DEMO_NOTICE + '\n\n' : '') + body + '\n\n---\n\n' + evidenceNotice + '\n\n' + ACTION_NOTICE + '\n', task.mode === 'demo');
  }
}
function stopTask(task, state, code, message, step) {
  if (!active(task)) return;
  if (step && !step.output) {
    const stage = task.preset.stages.find(item => item.key === step.key);
    const context = templateContext(task);
    const content = '> 部分交付：本阶段未完成。' + message + '\n\n' + buildInputTable(task.preset, task.input) + '\n\n' +
      renderTemplate(stage.fallback_output || '缺少证据的数字、供应商信息与结论均为待确认。', context) + '\n\n' + ACTION_NOTICE + '\n';
    addArtifact(task, 'partial-' + step.key + '-attempt-' + task.attempt + '.md', content, true);
  }
  task.status = state === 'interrupted' ? 'interrupted' : 'failed';
  task.summary = message; task.finishedAt = now();
  task.result = result(task, state, { reason: code, partialArtifacts: task.deliverables.length > 0, resumable: !task.legacy && (!step?.runId || state === 'interrupted') });
  event(task, 'error:' + task.attempt, 'error', { message, result: task.result });
}

/**
 * Business-stage coordination only. All work is submitted to runtime.sendMessage;
 * the existing Runtime owns its queue, budgets, Pi loop and recovery. Store change
 * notifications drain the durable business outbox into a disposable SQLite view.
 */
export async function createAgentCoordinator({ store, runtime, provider, projection, auth, env = {}, validateUiApproval }) {
  if (!store?.update || !runtime?.sendMessage) throw new Error('Agent requires the original Workspace Store and Runtime.');
  const demo = env.WS_AGENT_DEMO === '1';
  if (env.WS_AGENT_DEMO !== undefined && !['0', '1', ''].includes(env.WS_AGENT_DEMO)) throw new Error('WS_AGENT_DEMO must be explicit 0 or 1.');
  await store.update(state => {
    state.workspaceAgentTasks ||= { version: 1, tasks: [] };
    if (state.workspaceAgentTasks.version !== 1 || !Array.isArray(state.workspaceAgentTasks.tasks)) throw new Error('Unsupported business Agent task registry.');
  });
  const legacyBindings = auth.legacyBindings || [];
  if (new Set(legacyBindings.map(row => row.legacyAccountId)).size !== legacyBindings.length) throw new Error('A legacy account requires one unambiguous member binding.');
  for (const row of await projection.legacyTasks()) {
    const actor = legacyBindings.find(binding => binding.legacyAccountId === row.account_id);
    if (!actor || tasks(store.read()).some(task => task.id === row.task_id)) continue;
    await store.update(state => {
      const preset = JSON.parse(row.preset_json);
      const task = { id: row.task_id, subject: actor.subject, workspaceId: actor.workspaceId, type: row.type, title: row.title, input: JSON.parse(row.input_json), preset,
        mode: row.mode, status: row.status, summary: row.summary, createdAt: row.created_at, finishedAt: row.finished_at,
        conversationId: null, requestKey: null, legacy: true, attempt: 1, budget: { maxSteps: 0, maxOutputTokens: 0 },
        steps: preset.stages.map(stage => ({ key: stage.key, title: stage.title, status: 'legacy' })), deliverables: row.files, events: row.events };
      task.result = result(task, 'legacy_unverified', { execution: 'legacy-pr44-archive', completion: 'unverified', resumable: false });
      if (active(task)) stopTask(task, 'interrupted', 'LEGACY_CHECKPOINT_UNAVAILABLE', '旧版任务没有 Pi 检查点。原任务、事件和部分文件已归档；需要人工核对原记录，不能自动重做。');
      tasks(state).push(task);
    });
  }
  let closing = false, scheduled = null, reconciling = false, dirty = false, pending = Promise.resolve(), lastFailure = null;
  const recoveryAttempts = new Set();
  // Memory-only consent from the authenticated /tasks/:id/resume request.
  // A server restart must not inherit authority to run a stopped Pi checkpoint.
  const explicitRecoveryRequests = new Set();
  async function project(id) {
    const state = store.read(), task = tasks(state).find(item => item.id === id);
    if (task) await projection.sync(task, state.meta.sequence);
  }
  async function change(id, fn) {
    await store.update(state => { const task = tasks(state).find(item => item.id === id); if (task) fn(task, state); });
    await project(id);
  }
  async function reconcileTask(id) {
    let state = store.read(), task = tasks(state).find(item => item.id === id);
    if (!task) return;
    await project(id);
    if (!active(task) || task.legacy || closing) return;
    let actor;
    try { actor = auth.resolveTaskActor(task); }
    catch { await change(id, task => stopTask(task, 'blocked', 'AGENT_AUTHORIZATION_REVOKED', '原成员权限或 Agent 执行授权已撤销；原任务与文件仍保留。')); return; }
    if (task.uiApproval) {
      try { await validateUiApproval?.(task, actor); if (!validateUiApproval) throw new Error(); }
      catch (error) { await change(id, current => stopTask(current, 'blocked', error.extra?.code || 'AGENT_UI_APPROVAL_CHANGED', '本次公开材料的来源、接收模型或权限已变化；一次性许可不能用于新的发送。原任务与已有文书仍保留。', current.steps.find(step => step.status !== 'succeeded'))); return; }
    }
    if (!task.conversationId && task.mode !== 'demo') {
      const created = await runtime.createConversation({ title: task.title.slice(0, 160), requestId: stableRequest(id, 'conversation') }, actor);
      await change(id, task => { task.conversationId = created.conversation.id; });
      return;
    }
    const step = task.steps.find(item => item.status !== 'succeeded');
    if (!step) {
      await change(id, task => {
        readyArtifacts(task);
        task.status = 'done'; task.finishedAt = now();
        const configuredSummary = renderTemplate(task.preset.summary_template, templateContext(task));
        task.summary = task.mode === 'demo' ? DEMO_NOTICE + '。' + configuredSummary + ' 演示文书已保存；业务目标未完成。' : configuredSummary + ' 来源范围与待确认项见产物；文书完成不证明采购、核验、发布或销售目标达成。';
        task.result = result(task, task.mode === 'demo' ? 'demo' : 'completed', { completion: task.mode === 'demo' ? 'demonstration_only' : 'documents_ready',
          evidenceStatus: task.steps.some(step => step.result?.researchReceipts?.length) ? 'tool_evidence_available' : 'user_supplied_only', resumable: false });
        event(task, 'done:' + task.attempt, 'done', { summary: task.summary, artifacts: task.deliverables.map(({ name, bytes, url }) => ({ name, bytes, url })), result: task.result });
      });
      return;
    }
    const stage = task.preset.stages.find(item => item.key === step.key);
    if (!step.announced) {
      await change(id, task => {
        task.status = 'running'; const current = task.steps.find(item => item.key === step.key); current.announced = true;
        event(task, 'stage:' + step.key, 'stage', { stage: step.key, title: stage.title });
        event(task, 'thinking:check:' + step.key, 'thinking', { stage: step.key, text: '正在检查「' + stage.title + '」所需输入、模型与工具授权。' });
      });
      return;
    }
    if (task.mode === 'demo') {
      await change(id, task => {
        const current = task.steps.find(item => item.key === step.key);
        event(task, 'thinking:demo:' + step.key, 'thinking', { stage: step.key, text: '已显式启用演示，正在生成结构模板；未调用模型或真实检索。' });
        current.output = stage.fallback_output || '未接真实模型与数据源，数字与外部事实为待确认。';
        current.status = 'succeeded'; current.result = { version: 1, completion: 'demonstration_only', businessGoalAchieved: false };
        event(task, 'thinking:saved:' + step.key, 'thinking', { stage: step.key, text: '本阶段演示模板已保存，不代表实际研究或商业动作完成。' });
        event(task, 'progress:' + step.key, 'progress', { stage: step.key, done: true });
        readyArtifacts(task);
      });
      return;
    }
    if (step.runId) {
      const run = state.runs.find(item => item.id === step.runId);
      if (!run) { await change(id, task => stopTask(task, 'blocked', 'ORIGINAL_RUN_MISSING', '原 Pi 执行记录缺失；需恢复一致备份，不能新建替代执行。', task.steps.find(item => item.key === step.key))); return; }
      if (run.status === 'succeeded' && step.status === 'succeeded') return;
      if (run.status === 'interrupted') {
        if (!explicitRecoveryRequests.has(run.id)) {
          await change(id, current => stopTask(current, 'interrupted', 'AGENT_EXPLICIT_RESUME_REQUIRED',
            '服务重启后原 Pi 检查点已保留；需要所属企业成员明确恢复原任务，不能后台自动重新调用模型。',
            current.steps.find(item => item.key === step.key)));
          return;
        }
        if (recoveryAttempts.has(run.id)) return;
        explicitRecoveryRequests.delete(run.id);
        recoveryAttempts.add(run.id);
        try {
          // Stable for one user-approved resume attempt; never invent a new
          // business run when the original Pi response is uncertain.
          await runtime.recoverPiRun(run.id, { requestId: stableRequest(id, 'recover-' + task.attempt) });
          await change(id, task => event(task, 'thinking:recovery:' + run.id + ':' + (run.piRecoverRequests?.length || 0), 'thinking',
            { stage: step.key, text: '已重新连接原 Pi 执行记录与检查点，沿用相同输入、权限和预算。' }));
        } catch (error) {
          if (['BUSY', 'CONVERSATION_BUSY'].includes(error.code)) {
            recoveryAttempts.delete(run.id);
            explicitRecoveryRequests.add(run.id); // preserve this one explicit consent for a transient admission race
            return;
          }
          await change(id, task => stopTask(task, 'interrupted', error.code || 'RECOVERY_BLOCKED', '原任务恢复条件尚未满足；已保留原检查点和部分文件。核对配置、权限或外部回执后可恢复原任务。', task.steps.find(item => item.key === step.key)));
        }
        return;
      }
      if (['queued', 'running'].includes(run.status)) {
        if (run.status === 'running' && !step.runningAnnounced) await change(id, task => {
          task.steps.find(item => item.key === step.key).runningAnnounced = true;
          event(task, 'thinking:running:' + step.key, 'thinking', { stage: step.key, text: '原 Pi Runtime 正在执行本阶段，只输出可公开的执行摘要和文书结果。' });
        });
        return;
      }
      await change(id, task => stopTask(task, run.status === 'blocked' ? 'blocked' : 'partial', run.error?.code || 'PI_STAGE_FAILED',
        'Pi 未完成本阶段的有效回执。已保留已有材料，未完成阶段不能作为正式结果。', task.steps.find(item => item.key === step.key)));
      return;
    }
    if (provider.kind !== 'pi-durable' || !provider.configured) {
      await change(id, task => stopTask(task, 'unconfigured', 'PI_MODEL_UNCONFIGURED', '生产模式缺少可用的原 Pi 模型配置；未生成正式成果，原任务可在配置完成后恢复。', task.steps.find(item => item.key === step.key)));
      return;
    }
    const prior = task.steps.map(item => state.runs.find(run => run.id === item.runId)).filter(Boolean);
    const usedSteps = prior.reduce((n, run) => n + Math.max(1, run.stepCount || 0), 0);
    const usedTokens = prior.reduce((n, run) => n + (Number.isSafeInteger(run.usage?.completionTokens) ? run.usage.completionTokens : Math.max(run.reservedOutputTokens || 0, run.outputTokens || 0, run.budget?.maxOutputTokens || 1600)), 0);
    const remaining = { maxSteps: Math.min(1, task.budget.maxSteps - usedSteps), maxOutputTokens: Math.min(1600, task.budget.maxOutputTokens - usedTokens) };
    if (remaining.maxSteps < 1 || remaining.maxOutputTokens < 1) { await change(id, task => stopTask(task, 'blocked', 'AGENT_BUDGET_EXHAUSTED', '原业务任务预算已用尽；剩余阶段未执行，不能重置预算自动续跑。', task.steps.find(item => item.key === step.key))); return; }
    let context;
    try { context = buildAgentPresetContext({ state, taskId: id, stageKey: step.key, requestId: step.requestId, actor, researchCapabilities: provider.researchCapabilities || [], budget: remaining }); }
    catch (error) { await change(id, task => stopTask(task, 'blocked', error.extra?.code || error.code || 'AGENT_CONTEXT_BLOCKED', '本阶段缺少已授权的真实检索工具或有效输入。原任务与部分材料已保存，缺项不能填为已完成。', task.steps.find(item => item.key === step.key))); return; }
    try {
      await runtime.sendMessage(task.conversationId, { content: '执行已授权的研究文书阶段：' + stage.title, requestId: step.requestId, queued: true, workspaceExecution: true }, { agentPresetContext: context });
      await change(id, task => event(task, 'thinking:admitted:' + step.key, 'thinking', { stage: step.key, text: '本阶段已绑定原 Pi run；模型、工具权限、检查点和预算均由原 Runtime 管理。' }));
    } catch (error) {
      if (['BUSY', 'QUEUE_FULL'].includes(error.code)) return;
      await change(id, task => stopTask(task, 'blocked', error.extra?.code || error.code || 'PI_ADMISSION_BLOCKED', '原 Pi Runtime 尚未接纳本阶段；原任务已保留，需核对执行条件。', task.steps.find(item => item.key === step.key)));
    }
  }
  async function reconcile() {
    for (const task of tasks(store.read())) {
      if (closing) break;
      // Record business progress from the same transaction that published Pi output.
      const ready = task.steps.filter(step => step.status === 'succeeded' && !step.projected);
      if (ready.length) await change(task.id, current => {
        for (const item of ready) {
          const step = current.steps.find(step => step.key === item.key); step.projected = true;
          event(current, 'thinking:saved:' + step.key, 'thinking', { stage: step.key, text: '已保存 Pi 工具返回的本阶段文书与来源回执，待确认事实继续单列。' });
          event(current, 'progress:' + step.key, 'progress', { stage: step.key, done: true });
        }
        readyArtifacts(current);
      });
      await reconcileTask(task.id);
    }
  }
  function wake() {
    if (closing) return;
    dirty = true;
    if (scheduled || reconciling) return;
    scheduled = setImmediate(() => {
      scheduled = null; reconciling = true;
      pending = (async () => { do { dirty = false; await reconcile(); } while (dirty && !closing); })()
        .then(() => { lastFailure = null; })
        .catch(() => { dirty = false; lastFailure = 'AGENT_PROJECTION_UNAVAILABLE'; })
        .finally(() => { reconciling = false; if (dirty) wake(); });
    });
  }
  const unsubscribe = store.subscribe(wake);
  // All saved outputs and events are readable before the service starts accepting requests.
  for (const task of tasks(store.read())) await project(task.id);
  wake();
  return {
    wake, project, demo,
    readiness: () => ({ projection: lastFailure ? 'degraded' : 'ready', reason: lastFailure }),
    find(id, actor) { return tasks(store.read()).find(task => task.id === id && own(task, actor)) || null; },
    byRequest(key, actor) {
      if (!requestKeyValid(key)) throw new AgentHttpError(400, '无效的 Idempotency-Key。');
      return tasks(store.read()).find(task => task.requestKey === key && own(task, actor)) || null;
    },
    async submit({ actor, preset, title, input, requestKey, uiApproval, admission }) {
      const key = requestKey ?? randomUUID();
      if (!requestKeyValid(key)) throw new AgentHttpError(400, 'Idempotency-Key 须为 1–128 个安全字符。');
      const fingerprint = agentPresetHash({ type: preset.id, title: title.trim(), input });
      const answer = await store.update(state => {
        admission?.(state);
        const old = tasks(state).find(task => own(task, actor) && task.requestKey === key);
        if (old) {
          if (old.fingerprint !== fingerprint) throw new AgentHttpError(409, '相同 Idempotency-Key 已用于不同内容。', { code: 'IDEMPOTENCY_CONFLICT' });
          if (uiApproval && old.uiApproval?.previewHash !== uiApproval.previewHash) throw new AgentHttpError(409, '原请求没有相同的一次性公开发送许可。', { code: 'AGENT_UI_APPROVAL_CONFLICT' });
          return { task: old, duplicate: true };
        }
        if (tasks(state).filter(task => own(task, actor) && active(task)).length >= 20) throw new AgentHttpError(429, '当前成员待完成任务已达上限。');
        const id = randomUUID();
        const task = { id, subject: actor.subject, workspaceId: actor.workspaceId, type: preset.id, title: title.trim(), input: structuredClone(input), preset: structuredClone(preset),
          fingerprint, requestKey: key, mode: demo ? 'demo' : 'model', status: 'queued', createdAt: now(), finishedAt: null, summary: null,
          conversationId: null, attempt: 1, steps: preset.stages.map(stage => ({ key: stage.key, title: stage.title, requestId: stableRequest(id, stage.key), status: 'pending', output: null })),
          budget: { ...AGENT_TASK_BUDGET }, deliverables: [], events: [], ...(uiApproval ? { uiApproval: structuredClone(uiApproval) } : {}) };
        task.result = result(task, 'queued');
        event(task, 'accepted', 'accepted', { taskId: id, type: preset.id, preset: preset.name, title: task.title, mode: task.mode, plan: preset.stages.map(stage => stage.title), result: task.result });
        tasks(state).push(task);
        return { task, duplicate: false };
      });
      await project(answer.task.id); wake();
      return answer;
    },
    async resume(id, actor, { uiApprovalHash } = {}) {
      // Admission must be serialized with other original Store mutations.
      // Two simultaneous authenticated /resume requests cannot create two
      // business attempts or race a stale read from an already resumed task.
      const accepted = await store.update(state => {
        const task = tasks(state).find(row => row.id === id && own(row, actor));
        if (!task) throw new AgentHttpError(404, '任务不存在。');
        if (task.uiApproval) {
          if (!actor.uiPermissionFingerprint || uiApprovalHash !== task.uiApproval.previewHash) throw new AgentHttpError(409, '原公开发送许可任务必须经企业 Session 恢复。', { code: 'AGENT_UI_TASK_ROUTE_REQUIRED' });
          assertAgentUiApprovalSource(state, task);
        }
        if (active(task)) return { changed: false, runIds: [], interruptedRunId: null };
        if (!task.result?.resumable || task.legacy) throw new AgentHttpError(409, '原任务当前不能自动恢复；已有回执与失败记录保留。', { code: 'AGENT_RECOVERY_BLOCKED' });
        const unfinished = task.steps.find(step => step.status !== 'succeeded');
        const originalRun = unfinished?.runId && state.runs.find(run => run.id === unfinished.runId);
        const interruptedRunId = originalRun?.status === 'interrupted' ? originalRun.id : null;
        const runIds = task.steps.map(step => step.runId).filter(Boolean);
        task.status = 'queued'; task.finishedAt = null; task.attempt++;
        task.result = result(task, 'recovering', { resumeFrom: task.events.length });
        return { changed: true, runIds, interruptedRunId };
      });
      if (accepted.changed) {
        // Permission is set only after the original transaction commits,
        // before asynchronous projection work or any scheduled reconcile.
        for (const runId of accepted.runIds) recoveryAttempts.delete(runId);
        if (accepted.interruptedRunId) explicitRecoveryRequests.add(accepted.interruptedRunId);
        await project(id);
        wake();
      }
      return this.find(id, actor);
    },
    async close() {
      closing = true; unsubscribe(); if (scheduled) clearImmediate(scheduled);
      await pending;
    },
  };
}
