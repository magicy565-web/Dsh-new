import { randomUUID } from 'node:crypto';

/**
 * Redacted, read-only remote dot MCP connection probe.
 * Does NOT print credentials, upload files, claim tasks, or start execution.
 *
 * WORKSPACE_DOT_MCP_URL=https://reviewed-host.example/mcp
 * WORKSPACE_DOT_MCP_BEARER=[host secret manager output]
 * node scripts/check-dot-mcp-connection.mjs
 */
const endpoint = process.env.WORKSPACE_DOT_MCP_URL;
const bearer = process.env.WORKSPACE_DOT_MCP_BEARER;
if (!endpoint || !bearer) {
  console.error('NOT_CONNECTED: set reviewed WORKSPACE_DOT_MCP_URL and private WORKSPACE_DOT_MCP_BEARER in the local secure environment.');
  process.exitCode = 2;
} else {
  const modern = '2026-07-28';
  let url;
  try { url = new URL(endpoint); }
  catch { console.error('INVALID_ENDPOINT: reviewed absolute HTTPS URL required.'); process.exit(2); }
  if (url.protocol !== 'https:' || url.pathname !== '/mcp' ||
      url.username || url.password || url.hash || url.search ||
      url.hostname === 'localhost' || url.hostname.endsWith('.local')) {
    console.error('INVALID_ENDPOINT: use exactly https://<reviewed-host>/mcp. No URL credentials or query.');
    process.exit(2);
  }
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(bearer)) {
    console.error('INVALID_AUTH: the protected dot Worker credential has an invalid format.');
    process.exit(2);
  }
  const meta = {
    'io.modelcontextprotocol/protocolVersion': modern,
    'io.modelcontextprotocol/clientInfo': { name: 'Workspace-Dot-MCP-ReadOnlyProbe', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
  };
  async function call(method, params = {}) {
    const id = randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const name = method === 'tools/call' ? params.name : undefined;
      const response = await fetch(endpoint, {
        method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: {
          Authorization: 'Bearer ' + bearer,
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': modern,
          'Mcp-Method': method,
          ...(name ? { 'Mcp-Name': name } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0', id, method, params: { ...params, _meta: meta },
        }),
      });
      if (response.status >= 300 && response.status < 400) throw new Error('Redirect is not permitted for the pinned MCP host.');
      if (!response.ok) throw new Error('MCP host returned HTTP ' + response.status);
      const body = await response.json();
      if (body.jsonrpc !== '2.0' || body.id !== id || body.error)
        throw new Error('Unexpected or rejected MCP JSON-RPC result.');
      return body.result;
    } finally { clearTimeout(timeout); }
  }
  try {
    const discovery = await call('server/discover');
    const list = await call('tools/list');
    const names = list.tools?.map(x => x.name) || [];
    const expected = ['workspace_worker_identity', 'workspace_worker_inbox',
      'workspace_worker_read_task', 'workspace_worker_claim_task',
      'workspace_worker_status', 'workspace_worker_heartbeat',
      'workspace_worker_upload_file', 'workspace_worker_submit_result',
      'workspace_worker_report_blocked', 'workspace_worker_confirm_stop',
      'workspace_worker_ack_event'];
    if (!discovery.supportedVersions?.includes(modern) ||
        names.length !== expected.length || !expected.every(x => names.includes(x))) {
      throw new Error('The connected MCP server did not advertise all eleven reviewed Dot tools.');
    }
    const identity = await call('tools/call', { name: 'workspace_worker_identity', arguments: {} });
    const info = identity.structuredContent;
    if (identity.isError || info?.dot !== 'xy')
      throw new Error('The authenticated MCP server did not return the expected invited Dot identity.');
    const inbox = await call('tools/call', { name: 'workspace_worker_inbox', arguments: {} });
    if (inbox.isError || !Array.isArray(inbox.structuredContent?.tasks))
      throw new Error('Authenticated Dot inbox did not return a valid public task list.');
    console.log(JSON.stringify({
      result: 'MCP_BACKEND_HANDSHAKE_PASSED',
      server: url.hostname,
      modernProtocol: true,
      toolCount: names.length,
      invitedDot: info.dot,
      reviewedWorkerApproved: info.approved === true,
      queuedPublicTasks: inbox.structuredContent.tasks.length,
      remoteDotExecutionVerified: false,
      note: 'This confirms only MCP transport and server-side credentials. It does NOT prove that the personal ChatGPT dot actually invoked these tools.',
    }, null, 2));
  } catch (error) {
    // Never print the underlying fetch error, token, request, or response body.
    console.error('MCP_HANDSHAKE_NOT_VERIFIED: ' + (
      error instanceof Error && /^(MCP host returned HTTP |Redirect|Unexpected|The connected|The authenticated|Authenticated)/.test(error.message)
        ? error.message : 'Network, TLS, or protocol verification failed.'
    ));
    process.exitCode = 1;
  }
}
