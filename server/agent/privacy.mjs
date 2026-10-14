/** Reuse original task ownership when older Workspace APIs expose runs/conversations. */
export function agentOwnerScope(state, actor) {
  const tasks = state.workspaceAgentTasks?.tasks || [];
  const byId = new Map(tasks.map(task => [task.id, task]));
  const owned = task => Boolean(task && actor?.subject && actor?.workspaceId && task.subject === actor.subject && task.workspaceId === actor.workspaceId);
  const validId = value => typeof value === 'string' && value.length > 0;
  const taskIds = new Set(tasks.filter(task => !owned(task)).map(task => task.id).filter(validId));
  const conversations = new Set(tasks.filter(task => !owned(task)).map(task => task.conversationId).filter(validId));
  const ids = new Set([...taskIds, ...conversations]);
  for (const conversation of state.conversations || []) if ((conversation.piTaskOwner || conversation.businessAgentOwner) && !owned(conversation.piTaskOwner || conversation.businessAgentOwner)) {
    if (validId(conversation.id)) { ids.add(conversation.id); conversations.add(conversation.id); }
  }
  const runTask = run => run?.agentTaskId || run?.agentPresetContext?.taskId;
  // An orphaned Agent run never turns into public ordinary conversation history.
  for (const run of state.runs || []) if (runTask(run) && !owned(byId.get(runTask(run)))) {
    if (validId(run.id)) ids.add(run.id);
    if (validId(run.conversationId)) { ids.add(run.conversationId); conversations.add(run.conversationId); }
  }
  for (const run of state.runs || []) if ((run.piTaskContext || run.businessAgentContext) && !owned(run.piTaskContext || run.businessAgentContext)) {
    if (validId(run.id)) ids.add(run.id);
    if (validId(run.conversationId)) { ids.add(run.conversationId); conversations.add(run.conversationId); }
  }
  const references = item => Boolean(item && typeof item === 'object' && (
    ids.has(item.id) || ids.has(item.conversationId) || ids.has(item.sourceConversationId) || ids.has(item.runId) || ids.has(item.sourceRunId) || ids.has(item.goalId)
    || ids.has(item.taskId) || ids.has(item.agentTaskId) || ids.has(item.artifactId) || ids.has(item.outputArtifactId)
    || ids.has(item.metadata?.agentTaskId) || ids.has(item.metadata?.sourceRunId) || ids.has(item.agentPresetRef?.taskId)
    || item.agentPresetContext && !owned(byId.get(item.agentPresetContext.taskId))
    || item.piTaskContext && !owned(item.piTaskContext)
    || item.piTaskOwner && !owned(item.piTaskOwner)
    || item.businessAgentContext && !owned(item.businessAgentContext)
    || item.businessAgentOwner && !owned(item.businessAgentOwner)
    || item.binding && (ids.has(item.binding.runId) || ids.has(item.binding.conversationId) || ids.has(item.binding.goalId))
  ));
  let changed;
  do {
    changed = false;
    for (const collection of [...Object.values(state), ...Object.values(state.capabilities || {})]) if (Array.isArray(collection)) for (const item of collection) {
      if (item?.id && !ids.has(item.id) && references(item)) { ids.add(item.id); changed = true; }
    }
  } while (changed);
  return { conversations, taskIds, ids, ownsTask: id => owned(byId.get(id)), privateRecord: references };
}

export function createAgentOwnerPolicy({ read, error = (status, code, message) => Object.assign(new Error(message), { status, code }) }) {
  const denied = () => { throw error(404, 'NOT_FOUND', 'The requested Workspace item was not found.'); };
  function filter(value, scope) {
    if (Array.isArray(value)) return value.map(item => filter(item, scope)).filter(item => item !== undefined);
    if (!value || typeof value !== 'object') return value;
    if (scope.privateRecord(value)) return undefined;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['businessAgentSession', 'businessAgentContext'].includes(key)).map(([key, item]) => [key, filter(item, scope)]).filter(([, item]) => item !== undefined));
  }
  return {
    filterResponse(value, actor) { return filter(value, agentOwnerScope(read(), actor)); },
    filterBootstrap(snapshot, actor) { return filter(snapshot, agentOwnerScope(read(), actor)); },
    assertRun(actor, id) { const scope = agentOwnerScope(read(), actor); if (scope.ids.has(id)) denied(); },
    assertConversation(actor, id) { const scope = agentOwnerScope(read(), actor); if (scope.conversations.has(id)) denied(); },
    ownsTask(actor, id) { return agentOwnerScope(read(), actor).ownsTask(id); },
    guardHttp(pathname, actor, body) {
      const scope = agentOwnerScope(read(), actor), route = pathname.match(/^\/api\/([^/]+)\/([^/]+)/);
      if (route && route[1] !== 'agent') {
        let id; try { id = decodeURIComponent(route[2]); } catch { throw error(400, 'INVALID_PATH', 'Invalid API identifier.'); }
        if (scope.ids.has(id)) denied();
      }
      const check = value => {
        if (!value || typeof value !== 'object') return;
        if (scope.privateRecord(value)) denied();
        for (const [key, item] of Object.entries(value)) {
          if (typeof item === 'string' && /(?:^id$|Id$)/.test(key) && scope.ids.has(item)) denied();
          if (item && typeof item === 'object') check(item);
        }
      };
      check(body);
    },
  };
}
