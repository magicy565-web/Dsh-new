import http from 'node:http';
import { createAgentService } from '../../server/agent/service.mjs';

// Isolated service process used to prove real SIGKILL recovery. Its credentials
// are ephemeral test values supplied in the process environment, never files.
let service, server, closing = false;
try {
  service = await createAgentService({
    env: process.env,
    dataDir: process.env.WS_AGENT_DATA,
    tokenMap: JSON.parse(process.env.WS_AGENT_TOKENS || '{}'),
    concurrency: Number(process.env.WS_AGENT_TEST_CONCURRENCY || 1),
  });
  server = http.createServer(async (req, res) => {
    try {
      if (await service.handle(req, res)) return;
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Fixture route not found.' }));
    } catch {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Fixture request could not be completed.' }));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  process.send?.({ kind: 'ready', base: `http://127.0.0.1:${server.address().port}` });
} catch {
  process.send?.({ kind: 'startup-error' });
  process.exitCode = 1;
  process.disconnect?.();
}

async function close() {
  if (closing) return;
  closing = true;
  server?.closeAllConnections();
  const closed = server ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
  try { await service?.close(); await closed; process.exitCode = 0; }
  catch { process.exitCode = 1; }
  process.disconnect?.();
}
process.once('SIGTERM', close);
process.once('SIGINT', close);
