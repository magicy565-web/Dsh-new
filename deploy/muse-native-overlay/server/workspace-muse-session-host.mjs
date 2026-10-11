import { pluginFail } from './workspace-plugin-config.mjs';

/** Return inert notices to the original Harness Session; never run a model/Goal. */
export function createMuseSessionRelay({ ctx, service, actor }) {
  if (!ctx?.agents || !ctx?.sessions || !service?.muse?.bindSession) throw new TypeError('Original native services are required for Muse result return.');
  let pending;
  async function deliver() {
    // Capture one parent epoch. A refreshed Muse binding is used on the next
    // tick, never halfway through the original return operation.
    const source = service.muse.bindSession(actor);
    await source.refreshSubmitted();
    for (const item of await source.view()) {
      if (!item.receipt) continue;
      const agent = ctx.agents.get(actor.nativeAgentId);
      if (!agent || agent.session.id !== actor.nativeAgentId) pluginFail('WORKSPACE_MUSE_SESSION_REQUIRED', 'Preserve the original Muse requester Session.');
      const id = source.messageId(item.orderId), text = JSON.stringify(item.receipt);
      const check = async () => {
        const current = (await source.view()).find(row => row.orderId === item.orderId);
        if (!current || current.receiptHash !== item.receiptHash || ctx.agents.get(actor.nativeAgentId) !== agent)
          pluginFail('WORKSPACE_MUSE_RECEIPT_CHANGED', 'The original Muse Session or result changed while returning it.');
      };
      const messages = agent.session.ownEvents().flatMap(e => e.type === 'agent/inbox/spliced' ? e.data.inserted : []).filter(m => m.id === id);
      if (messages.length > 1 || messages.length && (messages[0].role !== 'user' || messages[0].content?.length !== 1 ||
          messages[0].content[0]?.text !== text || messages[0].source?.kind !== 'workspace-muse'))
        pluginFail('WORKSPACE_MUSE_RECEIPT_CHANGED', 'The native Session contains a different Muse receipt.');
      if (item.returnedHash) {
        if (item.returnedHash !== item.receiptHash || messages.length !== 1)
          pluginFail('WORKSPACE_MUSE_RECEIPT_CHANGED', 'Preserve the missing or altered original native receipt.');
        continue;
      }
      for (const file of item.receipt.files)
        await source.download({ artifactId: file.id, version: file.version, sha256: file.sha256 });
      await check();
      if (!messages.length) agent.send({ id, role: 'user', source: { kind: 'workspace-muse', form: 'notice', summary: 'Muse result requires owner review' },
        content: [{ type: 'text', text }] }, 'next-step', false);
      // A durable native message precedes business/UI acknowledgement. If a
      // flush or acknowledgement fails, retry the same ID without another send.
      if (!await ctx.sessions.flush(agent.session)) pluginFail('WORKSPACE_MUSE_PERSISTENCE', 'The original Session was not durably saved.');
      await check();
      await source.acknowledge(item.orderId, item.receiptHash);
    }
  }
  return Object.freeze({ reconcile() {
    if (pending) return pending;
    pending = deliver().finally(() => { pending = undefined; });
    return pending;
  } });
}
