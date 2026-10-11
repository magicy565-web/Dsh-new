import { createHash } from 'node:crypto';
import { MuseWorkerError } from './muse-worker-api.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesHash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new MuseWorkerError(409, 'MW_SESSION_RECEIPT_CHANGED', message); };
const rows = state => state.workspaceMuseSessionReceipts?.receipts ?? [];
const sameActor = (a, b) => a?.subject === b.subject && a?.nativeAgentId === b.nativeAgentId;
const messageId = (actor, workerId, orderId) => `workspace-muse-result-${hash([actor.subject, actor.nativeAgentId, workerId, orderId])}`;

export function validateMuseSessionReceipts(value, { operators, orders, messages, conversations } = {}) {
  if (value === undefined) return;
  if (value?.version !== 1 || !Array.isArray(value.receipts) || value.receipts.length > 200) fail('Preserve unsupported Muse Session receipts.');
  const keys = new Set();
  for (const item of value.receipts) {
    const key = JSON.stringify([item.subject, item.nativeAgentId, item.workerId, item.orderId]);
    if (keys.has(key) || ![item.subject, item.nativeAgentId, item.workerId, item.orderId].every(v => typeof v === 'string' && v.length > 0) ||
        !Number.isSafeInteger(item.returnedAt) || item.returnedAt < 0 || item.receipt?.schema !== 'workspace.muse.session-receipt.v1' ||
        !/^[a-f0-9]{64}$/.test(item.receiptHash ?? '') || item.receiptHash !== hash(item.receipt) ||
        item.nativeMessageId !== messageId(item, item.workerId, item.orderId) ||
        item.receipt?.nativeAgentId !== item.nativeAgentId || item.receipt?.workerId !== item.workerId ||
        item.receipt?.orderId !== item.orderId) fail('The durable Muse Session receipt was changed.');
    if (operators && !operators.some(actor => sameActor(item, actor)))
      fail('The durable Muse receipt belongs to an unknown original native owner.');
    if (orders) {
      const order = orders.find(order => order.id === item.orderId);
      if (!order || order.createdBy !== item.subject || order.workerId !== item.workerId ||
          !sameActor(order.museSession, item) || order.museSession.workerId !== item.workerId ||
          order.requestId !== item.receipt.requestId)
        fail('Preserve the original order, Worker and Session of every durable Muse receipt.');
    }
    if (conversations && !conversations.some(c => c.id === item.nativeAgentId && sameActor(c, item)))
      fail('Preserve the original conversation of every returned Muse receipt.');
    if (messages) {
      const matches = messages.filter(m => m.id === item.nativeMessageId);
      if (matches.length !== 1 || matches[0].conversationId !== item.nativeAgentId || matches[0].role !== 'assistant' ||
          matches[0].content !== item.receipt.summary || matches[0].museOrderId !== item.orderId ||
          matches[0].museReceiptHash !== item.receiptHash || hash(matches[0].museReceipt) !== item.receiptHash)
        fail('Preserve the original business conversation receipt; do not hide or replace a missing message.');
    }
    keys.add(key);
  }
}

/** Host-only return of the existing Muse REST task; no executor or acceptance. */
export function createMuseSessionProjection({ store, artifacts, actor, workerId, ownedArtifact }) {
  const initial = store.read();
  const validate = state => validateMuseSessionReceipts(state.workspaceMuseSessionReceipts, {
    operators: [actor], orders: state.workerOrders ?? [], messages: state.messages ?? [], conversations: state.conversations ?? [] });
  validate(initial);
  if (rows(initial).some(row => row.workerId !== workerId)) fail('The original returned Muse Worker cannot be replaced by another mount.');
  const belongs = order => order?.createdBy === actor.subject && order.workerId === workerId;
  function taskFor(state, order) {
    const tasks = (state.museTasks ?? []).filter(t => t.orderId === order.id && t.workerId === workerId);
    if (tasks.length > 1 || tasks.length && (tasks[0].id !== order.remoteJobId || tasks[0].id !== order.id))
      fail('The original Muse order and task reference disagree.');
    return tasks[0];
  }
  function receiptFor(state, order, task) {
    if (!task?.submitHash || !order.workerReport) return null;
    const fingerprint = hash({ id: task.id, orderId: task.orderId, serviceId: task.serviceId, workerId,
      agentKind: 'muse', inputs: task.inputs, acceptance: task.acceptance, maxCredits: task.maxCredits,
      deadlineAt: task.deadlineAt, dataScope: 'public' });
    if (task.agentKind !== 'muse' || task.fingerprint !== fingerprint ||
        order.dataMode !== 'public' || order.approvedBy !== actor.subject || !order.approvedAt ||
        task.serviceId !== order.serviceId || task.inputs?.objective !== order.objective ||
        task.inputs?.product !== order.product || task.inputs?.market !== order.market ||
        task.maxCredits !== order.budgetCredits || task.deadlineAt !== order.deadlineAt ||
        hash(task.acceptance) !== hash(order.acceptance) || order.workerReport.independentlyVerified !== false ||
        !task.submitRequestId || !task.attemptId || !Number.isSafeInteger(task.fence) || task.fence < 1 ||
        !Array.isArray(task.files) || !task.files.length || task.files.length > 20 ||
        task.submitHash !== hash({ summary: task.summary, sources: task.sources,
          toolEvidence: task.toolEvidence, evidenceNote: task.evidenceNote ?? null }))
      fail('Return only the original submitted task, attempt, fence and evidence hash.');
    const seen = new Set();
    const files = task.files.map(file => {
      const artifact = state.artifacts?.find(a => a.id === file.artifactId), version = artifact?.versions?.find(v => v.version === 1);
      if (seen.has(file.artifactId) || file.attemptId !== task.attemptId || !ownedArtifact(artifact) ||
          artifact.metadata.museTaskRef !== task.id || artifact.metadata.museWorkerId !== workerId ||
          artifact.requestId !== 'muse-upload-' + bytesHash(Buffer.from(task.id + '|' + task.attemptId + '|' + file.uploadId)) ||
          !version || version.sha256 !== file.sha256 || version.filename !== file.filename)
        fail('Use the original owned upload and its exact first file version.');
      seen.add(file.artifactId);
      return { id: file.artifactId, version: 1, sha256: file.sha256, filename: file.filename };
    });
    return { schema: 'workspace.muse.session-receipt.v1', nativeAgentId: actor.nativeAgentId, workerId,
      orderId: order.id, requestId: order.requestId, taskRef: task.id, attemptId: task.attemptId, fence: task.fence,
      submitRequestId: task.submitRequestId, submitHash: task.submitHash,
      reportSha256: hash(order.workerReport), report: structuredClone(order.workerReport),
      summary: task.summary, sources: structuredClone(task.sources), toolEvidence: structuredClone(task.toolEvidence),
      evidenceNote: task.evidenceNote ?? null, files, independentlyVerified: false };
  }
  function view() {
    const state = store.read(); validate(state);
    if (rows(state).some(row => row.workerId !== workerId)) fail('The original returned Muse Worker changed.');
    return (state.workerOrders ?? []).filter(belongs).map(order => {
      if (order.museSession && (!sameActor(order.museSession, actor) || order.museSession.workerId !== workerId))
        fail('The original order belongs to a different native Session.');
      const task = taskFor(state, order), receipt = receiptFor(state, order, task);
      const saved = rows(state).find(r => sameActor(r, actor) && r.workerId === workerId && r.orderId === order.id);
      const receiptHash = receipt ? hash(receipt) : null;
      if (saved && saved.receiptHash !== receiptHash) fail('A returned Muse receipt cannot be replaced.');
      return { agentKind: 'muse', orderId: order.id, requestId: order.requestId, nativeAgentId: actor.nativeAgentId,
        workerId, taskRef: task?.id ?? null, status: order.status, executionStatus: task?.status ?? null,
        attemptId: task?.attemptId ?? null, fence: task?.fence ?? 0, leaseUntil: task?.leaseUntil ?? null,
        createdAt: order.createdAt, updatedAt: order.updatedAt, deadlineAt: order.deadlineAt,
        serviceId: order.serviceId, product: order.product, market: order.market, objective: order.objective,
        budgetCredits: order.budgetCredits, summary: task?.summary ?? '', receipt, receiptHash,
        returnedHash: saved?.receiptHash ?? null, acceptedAt: order.acceptedAt ?? null, independentlyVerified: false };
    });
  }
  async function download(reference) {
    if (!reference || Object.keys(reference).some(k => !['artifactId', 'version', 'sha256'].includes(k)) ||
        reference.version !== 1 || !/^[a-f0-9]{64}$/.test(reference.sha256 ?? '') ||
        !view().some(item => item.receipt?.files.some(file => file.id === reference.artifactId &&
          file.version === reference.version && file.sha256 === reference.sha256)))
      throw new MuseWorkerError(404, 'MW_SESSION_FILE_NOT_FOUND', 'This exact Muse file belongs to another receipt or Session.');
    const output = await artifacts.download(reference.artifactId, { version: 1 });
    if (!Buffer.isBuffer(output.bytes) || bytesHash(output.bytes) !== reference.sha256 || output.version?.sha256 !== reference.sha256)
      fail('Muse file bytes do not match their original saved SHA-256.');
    return { filename: output.version.filename, mimeType: output.mimeType, version: 1, sha256: reference.sha256, bytes: output.bytes };
  }
  async function acknowledge(orderId, receiptHash) {
    const item = view().find(r => r.orderId === orderId);
    if (!item?.receipt || item.receiptHash !== receiptHash) fail('Acknowledge only the exact original Muse receipt.');
    await store.update(state => {
      const order = state.workerOrders.find(o => o.id === orderId && belongs(o));
      if (!order || hash(receiptFor(state, order, taskFor(state, order))) !== receiptHash)
        fail('The Muse result changed before its Session acknowledgement.');
      const saved = (state.workspaceMuseSessionReceipts ??= { version: 1, receipts: [] }).receipts;
      const previous = saved.find(r => sameActor(r, actor) && r.workerId === workerId && r.orderId === orderId);
      if (previous && previous.receiptHash !== receiptHash) fail('The original receipt acknowledgement cannot be replaced.');
      const id = messageId(actor, workerId, orderId), text = item.receipt.summary;
      const conversation = state.conversations.find(c => c.id === actor.nativeAgentId);
      if (conversation && (!sameActor(conversation, actor))) fail('The original conversation has another owner.');
      const messages = state.messages.filter(m => m.id === id);
      if (messages.length > 1 || messages.length && (messages[0].content !== text || messages[0].conversationId !== actor.nativeAgentId ||
          messages[0].museReceiptHash !== receiptHash || hash(messages[0].museReceipt) !== receiptHash))
        fail('The original conversation already has a different Muse receipt.');
      if (previous) {
        if (messages.length !== 1) fail('Preserve the missing acknowledged original conversation receipt.');
        return;
      }
      if (saved.length >= 200) fail('Review Muse receipt retention before returning more results.');
      const at = Date.now();
      if (!conversation) state.conversations.push({ id: actor.nativeAgentId, ...actor, title: 'Workspace 协作',
        createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString() });
      if (!messages.length) state.messages.push({ id, conversationId: actor.nativeAgentId, role: 'assistant',
        content: text, status: 'complete', createdAt: new Date(at).toISOString(),
        museOrderId: orderId, museReceiptHash: receiptHash, museReceipt: item.receipt, workerOwner: { ...actor, workerId } });
      saved.push({ ...actor, workerId, orderId, receiptHash, receipt: item.receipt, nativeMessageId: id, returnedAt: at });
      validate(state);
    });
    return view();
  }
  return Object.freeze({ view, download, acknowledge,
    messageId: orderId => messageId(actor, workerId, orderId) });
}
