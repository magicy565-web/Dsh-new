// Isolated protocol acceptance fixture. A provider supplies its own actual agent.
// No commercial buyer results or model calls are simulated as real outcomes.
import { createWorkerClient } from '../worker-client.mjs';
let client;
process.on('message', async message => {
  try {
    if (message.type === 'connect') {
      client = createWorkerClient({ baseUrl: message.origin, token: message.token, allowLocalHttp: true });
      await client.connect(); process.send({ type: 'connected' });
    } else if (message.type === 'execute') {
      const { order } = await client.claim();
      if (!order) throw new Error('No actual queued work order was returned.');
      await client.heartbeat({ orderId: order.id, leaseId: order.leaseId });
      const refreshed = await client.resources({ orderId: order.id, leaseId: order.leaseId });
      const content = `PROTOCOL ACCEPTANCE FIXTURE\nTask: ${order.title}\nAuthorized inputs: ${order.resources.length}\nThis file verifies transport, persistence and acceptance. It contains no commercial leads.`;
      const result = await client.deliver({ orderId: order.id, leaseId: order.leaseId, title: 'Independent process protocol receipt', content, actualMinor: 0, sourceUrls: [] }, { requestId: 'external-process-delivery' });
      process.send({ type: 'delivered', result, content, refreshed: !!refreshed });
    }
  } catch (error) { process.send({ type: 'error', code: error.code || 'FIXTURE_FAILURE', message: error.message }); }
});
