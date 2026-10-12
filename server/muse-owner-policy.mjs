// Persisted original Personal Agent provenance remains private even while the
// connector is offline. This policy never grants ordinary models file access.
export function originalMuseScope(state, actor) {
  const conversations = new Set(actor ? [actor.nativeAgentId] : []);
  const workers = new Set(), orders = new Set(), artifacts = new Set(), ids = new Set(), modelRuns = new Set();
  for (const c of state.conversations || []) if (c.subject && c.nativeAgentId === c.id) conversations.add(c.id);
  for (const o of state.workerOrders || []) if (o.museSession) { orders.add(o.id); workers.add(o.workerId); conversations.add(o.museSession.nativeAgentId); }
  for (const a of state.artifacts || []) if (a.metadata?.museNativeAgentId || workers.has(a.workerOwner?.workerId)) {
    artifacts.add(a.id); if (a.workerOwner?.workerId) workers.add(a.workerOwner.workerId); if (a.metadata?.museNativeAgentId) conversations.add(a.metadata.museNativeAgentId);
  }
  for (const o of state.workerOrders || []) if (workers.has(o.workerId)) orders.add(o.id);
  const references = item => item && typeof item === 'object' && (
    conversations.has(item.conversationId) || conversations.has(item.sourceConversationId) || conversations.has(item.nativeAgentId)
    || conversations.has(item.workerOwner?.nativeAgentId) || Boolean(item.museSession || item.museReceipt)
    || workers.has(item.workerOwner?.workerId) || workers.has(item.workerId)
    || orders.has(item.orderId) || orders.has(item.museOrderId) || orders.has(item.sourceOrderId) || orders.has(item.workerOrderId)
    || artifacts.has(item.artifactId) || artifacts.has(item.outputArtifactId) || artifacts.has(item.deliveryArtifactId) || artifacts.has(item.sourceArtifactId)
    || (item.inputContextSnapshot?.artifacts || item.inputContext?.artifacts || []).some(a => artifacts.has(a.id))
    || ids.has(item.sourceRunId) || ids.has(item.runId) || ids.has(item.goalId)
    || (typeof item.resource === 'string' && item.resource.startsWith('artifact:') && artifacts.has(item.resource.slice(9))));
  for (const id of [...conversations, ...orders, ...artifacts]) ids.add(id);
  let changed;
  do {
    changed = false;
    for (const run of state.runs || []) if (!modelRuns.has(run.id) && (
      (run.inputContextSnapshot?.artifacts || run.inputContext?.artifacts || []).some(a => artifacts.has(a.id))
      || (run.proposals || []).some(p => artifacts.has(p.receipt?.result?.artifactId) || typeof p.resource === 'string' && p.resource.startsWith('artifact:') && artifacts.has(p.resource.slice(9))))) {
      modelRuns.add(run.id); ids.add(run.id); changed = true;
    }
    // Close historical laundering through outputs of a previously admitted
    // private-file run; these outputs cannot become ordinary selected input.
    for (const item of state.artifacts || []) if (!artifacts.has(item.id) && modelRuns.has(item.sourceRunId)) {
      artifacts.add(item.id); ids.add(item.id); changed = true;
    }
    for (const collection of Object.values(state)) if (Array.isArray(collection)) for (const item of collection) {
      if (item?.id && !ids.has(item.id) && references(item)) { ids.add(item.id); changed = true; }
    }
  } while (changed);
  return { conversations, workers, orders, artifacts, ids, modelRuns, privateRecord: item => Boolean(item && (ids.has(item.id) || references(item))) };
}

export function isOriginalMuseArtifact(state, value) {
  const item = typeof value === 'string' ? state.artifacts?.find(a => a.id === value) : value;
  return Boolean(item && (item.metadata?.museNativeAgentId || originalMuseScope(state).artifacts.has(item.id)));
}

export function isOriginalMuseMessage(state, item) {
  return Boolean(item.workerOwner || item.museReceipt || item.museOrderId || isOriginalMuseArtifact(state, item.artifactId));
}

export function createMuseOwnerPolicy({ read, actor, error }) {
  const isOwner = context => Boolean(actor && context.role === 'admin' && context.subject === actor.subject);
  const scope = () => originalMuseScope(read(), actor);
  const denied = () => { throw error(403, 'MUSE_OWNER_REQUIRED', 'Use the exact original reviewed Muse owner and conversation binding.'); };
  function filter(value, current) {
    if (Array.isArray(value)) return value.map(item => filter(item, current)).filter(item => item !== undefined);
    if (!value || typeof value !== 'object') return value;
    if (current.privateRecord(value)) return undefined;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, filter(item, current)]).filter(([, item]) => item !== undefined));
  }
  return {
    ownsArtifact: item => isOriginalMuseArtifact(read(), item),
    ownsOrder: id => scope().orders.has(id),
    filterResponse: (value, context) => isOwner(context) ? value : filter(value, scope()),
    filterBootstrap(snapshot, context) {
      const result = { ...snapshot, artifacts: (snapshot.artifacts || []).filter(item => !isOriginalMuseArtifact(read(), item)) };
      return isOwner(context) ? result : filter(result, scope());
    },
    guardHttp(pathname, context, body) {
      const current = scope(), route = pathname.match(/^\/api\/([^/]+)\/([^/]+)/);
      if (route) {
        let id;
        try { id = decodeURIComponent(route[2]); } catch { throw error(400, 'INVALID_PATH', 'Invalid API identifier.'); }
        if (route[1] === 'artifacts' && current.artifacts.has(id)) throw error(404, 'NOT_FOUND', 'Use the exact original Muse receipt file reference.');
        if (route[1] === 'worker-orders' && current.orders.has(id)) throw error(404, 'NOT_FOUND', 'Use the reviewed original Muse delegation protocol.');
        if (current.ids.has(id) && !isOwner(context)) denied();
      }
      if (body && !isOwner(context)) {
        const check = value => {
          if (!value || typeof value !== 'object') return;
          if (current.privateRecord(value)) denied();
          for (const [key, item] of Object.entries(value)) {
            if (typeof item === 'string' && /(?:^id$|Id$)/.test(key) && current.ids.has(item)) denied();
            if (item && typeof item === 'object') check(item);
          }
        };
        check(body);
      }
    },
  };
}
