import { createNativeMuseBinding } from './muse-worker-native.mjs';
import { MuseWorkerError } from './muse-worker-api.mjs';

/** Mount the original native binding onto the existing locked Workspace host.
 * No DSH service, replacement Session sender, token, identity or scheduler is
 * created. The exact original owner/conversation must be supplied by the host.
 */
export async function createPiMuseBinding({ store, artifacts, config, binding, dotWorkerConfig, readBody, respond }) {
  const { actor, operators, expectedHost } = binding;
  const original = store.read().conversations.find(item => item.id === actor?.nativeAgentId);
  if (!original || original.subject !== actor.subject || original.nativeAgentId !== actor.nativeAgentId)
    throw new MuseWorkerError(409, 'MW_ORIGINAL_BINDING_REQUIRED', 'Restore the exact reviewed original Muse conversation/owner before mounting it on Pi.');
  let stopping = false;
  const pending = new Set();
  const native = createNativeMuseBinding({ store, artifacts, config, actor, operators, expectedHost, dotWorkerConfig, readBody, respond,
    run(callback) {
      if (stopping) throw new MuseWorkerError(503, 'MW_GATEWAY_CLOSED', 'The original Muse binding is closing.');
      const operation = Promise.resolve().then(callback); pending.add(operation);
      void operation.finally(() => pending.delete(operation)).catch(() => {});
      return operation;
    } });
  await native.initialize();
  function authorized(context, conversationId = actor.nativeAgentId) {
    if (context.role !== 'admin' || context.subject !== actor.subject || conversationId !== actor.nativeAgentId)
      throw new MuseWorkerError(403, 'MUSE_OWNER_REQUIRED', 'Use the exact original reviewed Muse owner and conversation.');
    return actor;
  }
  return {
    actor, native,
    forActor(context) { return native.bindConversation(authorized(context)); },
    snapshot(context) {
      return context.role === 'admin' && context.subject === actor.subject
        ? { originalBinding: true, conversationId: actor.nativeAgentId, onlineVerified: false }
        : { originalBinding: false, onlineVerified: false };
    },
    async workerHttp(req, res, pathname) { return native.handle(req, res, pathname); },
    async businessHttp({ req, res, pathname, context, body, query }) {
      const match = pathname.match(/^\/api\/conversations\/([^/]+)\/muse-delegations(?:\/([^/]+)(?:\/(approve|dispatch|refresh|cancel|accept))?)?$/);
      if (match) {
        let id;
        try { id = decodeURIComponent(match[1]); } catch { throw new MuseWorkerError(400, 'INVALID_PATH', 'Invalid conversation identifier.'); }
        const service = native.bindConversation(authorized(context, id));
        if (req.method === 'GET') { await respond(res, 200, match[2] ? { delegation: await service.get(match[2]) } : { delegations: await service.list() }); return true; }
        if (req.method === 'POST' && !match[2]) { await respond(res, 201, await service.prepare(body)); return true; }
        if (req.method === 'POST' && match[3]) {
          const result = await service[match[3]](match[2], body);
          // Persist the verified return through the original Session projection.
          // This is a write-only receipt, never a model turn, wake or acceptance.
          if (match[3] === 'refresh') {
            const session = native.bindSession(actor);
            const tasks = await session.view();
            for (const task of tasks) if (task.receipt && task.receiptHash && !task.returnedHash) await session.acknowledge(task.orderId, task.receiptHash);
            await respond(res, 200, { ...result, delegation: await service.get(match[2]) });
          } else await respond(res, 200, result);
          return true;
        }
        throw new MuseWorkerError(405, 'METHOD_NOT_ALLOWED', 'Use the original Muse delegation operations.');
      }
      if (pathname === '/api/muse-workers' && req.method === 'GET') {
        const desk = native.bindDesk(authorized(context));
        await respond(res, 200, { muse: await desk.info(), tasks: await desk.tasks() }); return true;
      }
      const file = pathname.match(/^\/api\/muse-worker-files\/([^/]+)$/);
      if (file && req.method === 'GET') {
        const session = native.bindSession(authorized(context));
        if ([...query.keys()].length !== 2 || !query.has('version') || !query.has('sha256')) throw new MuseWorkerError(400, 'MW_SESSION_FILE_NOT_FOUND', 'Use one exact version and SHA reference.');
        const output = await session.download({ artifactId: file[1], version: Number(query.get('version')), sha256: query.get('sha256') });
        await res.accessFinish?.(200);
        res.writeHead(200, { 'Content-Type': output.mimeType, 'Content-Length': output.bytes.length, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(output.filename)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Content-SHA256': output.sha256 });
        res.end(output.bytes); return true;
      }
      return false;
    },
    async close() { stopping = true; await Promise.allSettled([...pending]); await native.close(); },
  };
}
