import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readLocalVerification, operationalDiagnostics } from './diagnostics.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { openStore } from './store.mjs';
import { readRecoveryStatus } from './recovery-status.mjs';
import { createHarnessProvider } from './harness-provider.mjs';
import { createDeepSeekProvider } from './provider.mjs';
import { createFastAITokenProvider } from './relay-provider.mjs';
import { ApiError, createRuntime } from './runtime.mjs';
import { createArtifactService } from './artifacts.mjs';
import { createBusinessLibraryService } from './business-library.mjs';
import { createShopifyClient } from './shopify.mjs';
import { createCommerceService } from './commerce.mjs';
import { createRunOutputService } from './run-output.mjs';
import { createWorkspaceLibraryAdapter, WORKSPACE_LIBRARY_ADAPTER } from './workspace-library.mjs';
import { createCapabilityService, CapabilityError } from './capabilities.mjs';
import { createWorkerServiceDesk, WorkerDeskError } from './worker-desk.mjs';
import { createWorkerOpportunityService, WorkerOpportunityError } from './worker-opportunities.mjs';
import { createCloudExpertService, CloudExpertError } from './cloud-experts.mjs';
import { loadReviewedA2AWorkers } from './worker-a2a-host.mjs';
import { createDotWorkerBridge, createDotWorkerAuth, DotWorkerError } from './dot-worker-bridge.mjs';
import { handleDotMcpHttp } from './dot-mcp-server.mjs';
import { createMuseWorkerHandler, MuseWorkerError } from './muse-worker-api.mjs';
import { AccessError, validateAccessConfig, createAccessControl, accessConfigFromEnvironment } from './access.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };
async function respond(res, status, body) {
  await res.accessFinish?.(status);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(JSON.stringify(body));
}
async function readBody(req, maximum = 100_000) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Send application/json.');
  if (Number(req.headers['content-length']) > maximum) throw new ApiError(413, 'BODY_TOO_LARGE', `Request body must be smaller than ${maximum} bytes.`);
  let length = 0;
  const chunks = [];
  for await (const chunk of req) { length += chunk.length; if (length > maximum) throw new ApiError(413, 'BODY_TOO_LARGE', `Request body must be smaller than ${maximum} bytes.`); chunks.push(chunk); }
  let body;
  try { req.bodyBytes = Buffer.concat(chunks); body = JSON.parse(req.bodyBytes.toString('utf8')); } catch { throw new ApiError(400, 'INVALID_JSON', 'The request must contain valid JSON.'); }
  if (body === null || Array.isArray(body) || typeof body !== 'object') throw new ApiError(400, 'INVALID_JSON', 'The request body must be a JSON object.');
  return body;
}
async function staticResponse(req, res, pathname, staticDirectory) {
  const base = path.resolve(staticDirectory);
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new ApiError(400, 'INVALID_PATH', 'Invalid URL path.'); }
  if (decoded.includes('\0') || decoded.includes('\\')) throw new ApiError(400, 'INVALID_PATH', 'Invalid URL path.');
  let filename = path.resolve(base, `.${decoded}`);
  if (filename !== base && !filename.startsWith(`${base}${path.sep}`)) throw new ApiError(403, 'INVALID_PATH', 'Invalid URL path.');
  try { if (!(await fs.stat(filename)).isFile()) throw new Error('Not a file'); }
  catch {
    if (path.extname(decoded)) throw new ApiError(404, 'NOT_FOUND', 'File not found.');
    filename = path.join(base, 'index.html');
  }
  let data;
  try { const realBase = await fs.realpath(base); const realFile = await fs.realpath(filename); if (!realFile.startsWith(`${realBase}${path.sep}`)) throw new ApiError(403, 'INVALID_PATH', 'Static files must stay inside the frontend directory.'); data = await fs.readFile(realFile); } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(404, 'FRONTEND_NOT_BUILT', 'The frontend is not built. Use the development frontend or run npm run build first.'); }
  await res.accessFinish?.(200);
  res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': path.extname(filename) === '.html' ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' });
  res.end(req.method === 'HEAD' ? undefined : data);
}

export async function createApp({ dataDirectory = path.join(root, '.data'), provider = createDeepSeekProvider(), staticDirectory = path.join(root, 'dist'), goalTimeoutMs, maxConcurrentRuns, maxQueuedRuns, connectorAdapters = {}, workerAdapters = {}, dotWorkerConfig = null, museWorkerConfig = null, schedulerIntervalMs = 1000, capabilityEnvironment = process.env, shopifyFetch = fetch, allowedOrigins = [], access: accessOptions = {}, accessClock = Date.now } = {}) {
  const instanceId = randomUUID(), startedAt = new Date().toISOString();
  const localVerification = await readLocalVerification();
  const accessConfig = validateAccessConfig(accessOptions, allowedOrigins);
  if (!Number.isInteger(schedulerIntervalMs) || schedulerIntervalMs < 50 || schedulerIntervalMs > 60000) throw new Error('schedulerIntervalMs must be 50–60000.');
  const store = await openStore(dataDirectory);
  let runtime, artifacts, capabilities, access, recovery, workerDesk, workerOpportunities, cloudExperts, dotBridge, dotAuth, museBridge, museHandler, businessLibrary, shopify, commerce;
  try {
    recovery = await readRecoveryStatus(store.directory, provider.kind);
    access = await createAccessControl({ config: accessConfig, dataDirectory: store.directory, now: accessClock });
    artifacts = await createArtifactService({ store, directory: path.join(dataDirectory, 'artifacts') });
    businessLibrary = createBusinessLibraryService({ store, artifacts, clock: accessClock });
    dotAuth = dotWorkerConfig && createDotWorkerAuth({ tokenDigest: dotWorkerConfig.tokenDigest });
    if (dotWorkerConfig?.enabled === true && !dotAuth)
      throw new TypeError('A reviewed dot Worker cannot be enabled without a pinned plugin bearer token.');
    dotBridge = dotWorkerConfig ? createDotWorkerBridge({
      store, artifacts, workerId: dotWorkerConfig.workerId || 'chatgpt-dot-xy',
      ownerId: dotWorkerConfig.ownerId || 'xy',
      enabled: dotWorkerConfig.enabled === true,
      externalBudgetVerified: dotWorkerConfig.externalBudgetVerified === true,
      scopeReviewed: dotWorkerConfig.scopeReviewed === true,
    }) : null;
    if (dotBridge && Object.hasOwn(workerAdapters, dotWorkerConfig.workerId || 'chatgpt-dot-xy'))
      throw new TypeError('A Dot Worker ID cannot overwrite another reviewed execution adapter.');
    if (museWorkerConfig) {
      const museId = museWorkerConfig.workerId || 'muse-personal-owner';
      if (Object.hasOwn(workerAdapters, museId) ||
          (dotBridge && museId === (dotWorkerConfig.workerId || 'chatgpt-dot-xy')))
        throw new TypeError('Muse and Dot worker identities must be distinct.');
      if (dotWorkerConfig?.tokenDigest && museWorkerConfig.tokenDigest === dotWorkerConfig.tokenDigest)
        throw new TypeError('Muse and Dot must never share a Bearer credential.');
      museBridge = createDotWorkerBridge({
        store, artifacts, agentKind: 'muse', workerId: museId,
        ownerId: museWorkerConfig.ownerId || 'personal',
        enabled: museWorkerConfig.enabled === true,
        scopeReviewed: museWorkerConfig.scopeReviewed === true,
        externalBudgetVerified: museWorkerConfig.externalBudgetVerified === true,
      });
      museHandler = createMuseWorkerHandler({
        bridge: museBridge, tokenDigest: museWorkerConfig.tokenDigest, readBody, respond,
      });
    }
    workerDesk = createWorkerServiceDesk({ store,
      adapters: {
        ...workerAdapters,
        ...(dotBridge ? { [dotWorkerConfig.workerId || 'chatgpt-dot-xy']: dotBridge.adapter } : {}),
        ...(museBridge ? { [museWorkerConfig.workerId || 'muse-personal-owner']: museBridge.adapter } : {}),
      },
      artifacts });
    workerOpportunities = createWorkerOpportunityService({ store });
    cloudExperts = createCloudExpertService({ store, workerCatalog: () => workerDesk.catalog(), workerDesk });
    await workerDesk.recoverInterrupted();
    capabilities = await createCapabilityService({ store, adapters: { ...connectorAdapters, [WORKSPACE_LIBRARY_ADAPTER]: createWorkspaceLibraryAdapter({ artifacts, store }) }, environment: capabilityEnvironment, executionContext: { kind: provider.kind || 'deepseek-api', model: provider.model || null, permissionFingerprint: provider.permissionFingerprint || null }, dispatchGoal: async ({ goalId, requestId, expectedGoalDefinitionHash, scheduleClaim }) => runtime.updateGoal(goalId, { action: 'resume', queued: true, requestId }, { expectedGoalDefinitionHash, scheduleClaim }) });
    runtime = await createRuntime({ store, provider, goalTimeoutMs, maxConcurrentRuns, maxQueuedRuns, artifacts, capabilities, saveOutput: createRunOutputService({ store, artifacts }), autoStart: false, validateMemory: content => capabilities.assertSafeMemory(content) });
    shopify = createShopifyClient({ environment: capabilityEnvironment, fetchImpl: shopifyFetch, clock: accessClock });
    commerce = createCommerceService({ store, runtime, shopify, workerDesk, workerCatalog: () => workerDesk.catalog(), museConnection: () => museBridge?.info(), clock: accessClock });
  } catch (error) { await artifacts?.close?.(); await capabilities?.close?.(); await access?.close(); await store.close(); throw error; }
  const streams = new Set();
  let scheduler;
  const schedulerState = { state: 'stopped', automaticTimer: false, intervalMs: schedulerIntervalMs, lastStartedAt: null, lastCompletedAt: null, lastError: null };
  let ticking = false;
  const capabilitySnapshot = () => { const snapshot = capabilities.bootstrap(); snapshot.scheduler = { ...snapshot.scheduler, automaticTimer: schedulerState.automaticTimer }; return snapshot; };
  const diagnostics = () => operationalDiagnostics({ instanceId, startedAt, runtime: runtime.status(), storage: store.diagnostics(), capabilities: capabilitySnapshot(), scheduler: schedulerState, recovery, access: access.health(), localVerification });
  async function schedulerTick() {
    if (ticking || !schedulerState.automaticTimer) return;
    ticking = true; schedulerState.lastStartedAt = new Date().toISOString();
    try {
      await capabilities.tick();
      schedulerState.lastCompletedAt = new Date().toISOString(); schedulerState.lastError = null;
      if (schedulerState.automaticTimer) schedulerState.state = 'healthy';
    } catch {
      schedulerState.lastError = { code: 'SCHEDULER_TICK_FAILED', message: 'The scheduler could not complete a local tick. Inspect storage and service state before retrying work.' };
      if (schedulerState.automaticTimer) schedulerState.state = 'degraded';
    } finally { ticking = false; }
  }
  async function streamChanges(req, res, context) {
    const rawCursor = req.headers['last-event-id'] || new URL(req.url, 'http://localhost').searchParams.get('after');
    if (rawCursor && !/^\d{1,16}$/.test(rawCursor)) throw new ApiError(400, 'INVALID_CURSOR', 'Event cursor must be a non-negative sequence.');
    await res.accessFinish?.(200);
    const accessWatch = access.watchStream(context, () => res.end());
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
    const send = event => { if (!accessWatch.valid()) { res.end(); return; } if (res.writableLength > 128_000) { res.destroy(); return; } res.write(`id: ${event.sequence}\nevent: change\ndata: ${JSON.stringify({ sequence: event.sequence, updatedAt: event.updatedAt, bootstrap: '/api/bootstrap' })}\n\n`); };
    // This is a state-invalidation stream, not a replay of private native payloads.
    const unsubscribe = store.subscribe(send);
    const current = store.read().meta;
    send(current);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000); heartbeat.unref();
    streams.add(res);
    res.on('close', () => { accessWatch.stop(); unsubscribe(); clearInterval(heartbeat); streams.delete(res); });
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname.replace(/\/$/, '') || '/';
      const method = req.method;
      // Muse is a separate, authenticated REST API; it does not share the Dot
      // worker credential, task queue or MCP plugin protocol.
      if (pathname.startsWith('/api/muse-worker/')) {
        if (!museHandler) throw new ApiError(404, 'MW_GATEWAY_UNAVAILABLE', 'Muse REST gateway is not configured on this host.');
        return await museHandler(req, res, pathname);
      }
      // Real MCP Streamable HTTP endpoint for ChatGPT plugins. The REST
      // bridge below is deliberately NOT an MCP server. Both transports
      // require the same reviewed private dot credential.
      if (pathname === '/mcp' || pathname === '/api/dot-worker/mcp') {
        if (!dotBridge || !dotAuth) throw new ApiError(404, 'DOT_BRIDGE_UNAVAILABLE', 'The private dot MCP gateway is not installed on this host.');
        dotAuth(req);
        return await handleDotMcpHttp(req, res, { bridge: dotBridge, readBody });
      }
      // Personal ChatGPT dots are pull-based tool users, NOT public A2A
      // endpoints. A dedicated server-side bearer credential isolates the
      // dot's narrow public-data API from the enterprise browser session.
      if (pathname.startsWith('/api/dot-worker/')) {
        if (!dotBridge || !dotAuth) throw new ApiError(404, 'DOT_BRIDGE_UNAVAILABLE', 'The Dot plugin gateway is disabled on this server.');
        dotAuth(req);
        const base = '/api/dot-worker/v1';
        if (pathname === base+'/identity' && method === 'GET') {
          await dotBridge.recordSeen();
          return await respond(res, 200, dotBridge.identity());
        }
        if (pathname === base+'/inbox' && method === 'GET') {
          await dotBridge.recordSeen();
          return await respond(res, 200, dotBridge.inbox());
        }
        const event = pathname.match(/^\/api\/dot-worker\/v1\/tasks\/([^/]+)\/events\/([^/]+)\/ack$/);
        if (event && method === 'POST')
          return await respond(res, 200, await dotBridge.ackEvent({taskRef:event[1],eventId:event[2]}));
        const match = pathname.match(/^\/api\/dot-worker\/v1\/tasks\/([^/]+)(?:\/(claim|status|heartbeat|upload-file|submit-result|report-blocked|confirm-stop))?$/);
        if (match) {
          const [, taskRef, op] = match;
          if (method === 'GET' && !op) return await respond(res, 200, dotBridge.readTask(taskRef));
          if (method === 'GET' && op === 'status') return await respond(res, 200, dotBridge.status(taskRef));
          if (method === 'POST') {
            const data = await readBody(req, op === 'upload-file' ? 1_600_000 : 30_000);
            const payload = { ...data, taskRef };
            if (op === 'claim') return await respond(res, 200, await dotBridge.claimTask(payload));
            if (op === 'heartbeat') return await respond(res, 200, await dotBridge.heartbeat(payload));
            if (op === 'upload-file') return await respond(res, 201, await dotBridge.uploadFile(payload));
            if (op === 'submit-result') return await respond(res, 200, await dotBridge.submitResult(payload));
            if (op === 'report-blocked') return await respond(res, 200, await dotBridge.reportBlocked(payload));
            if (op === 'confirm-stop') return await respond(res, 200, await dotBridge.confirmStop(payload));
          }
        }
        throw new ApiError(404, 'DOT_ROUTE_NOT_FOUND', 'Only the reviewed dot Worker task methods are accepted.');
      }
      const context = await access.begin(req, res, pathname);
      if (!pathname.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        return await staticResponse(req, res, pathname, staticDirectory);
      }
      if (method === 'GET') {
        const goalCommerce = pathname.match(/^\/api\/goals\/([^/]+)\/commerce-context$/);
        if (goalCommerce) return await respond(res, 200, commerce.forGoal(goalCommerce[1]));
        if (pathname === '/api/commerce-status') return await respond(res, 200, commerce.status());
        if (pathname === '/api/commerce-projects') return await respond(res, 200, commerce.list());
        const commerceRead = pathname.match(/^\/api\/commerce-projects\/([^/]+)$/);
        if (commerceRead) return await respond(res, 200, commerce.get(commerceRead[1]));
        if (pathname === '/api/diagnostics') return await respond(res, 200, diagnostics());
        if (pathname === '/api/health') {
          const storage = store.diagnostics(), durable = storage.durability === 'confirmed';
          return await respond(res, 200, { status: durable ? 'ok' : 'degraded', access: access.health(), storage: { ...storage, exclusiveWriter: true, liveWriteProbe: false }, recovery, provider: { configured: !!provider.configured, kind: provider.kind || 'deepseek-api', onlineVerified: false }, readiness: !durable ? 'storage_review_required' : provider.configured ? 'configured-not-online-verified' : 'setup_required' });
        }
        if (pathname === '/api/session') return await respond(res, 200, access.sessionView(context));
        if (pathname === '/api/access/sessions') return await respond(res, 200, access.listSessions());
        if (pathname === '/api/access/audit') return await respond(res, 200, access.listAudit({ after: Number(url.searchParams.get('after') || 0), limit: Number(url.searchParams.get('limit') || 100) }));
        if (pathname === '/api/events') return await streamChanges(req, res, context);
        const conversationLibrary = pathname.match(/^\/api\/conversations\/([^/]+)\/library-references$/);
        if (conversationLibrary) return await respond(res, 200, businessLibrary.getConversationReferences(conversationLibrary[1]));
        if (pathname === '/api/library/company') return await respond(res, 200, businessLibrary.getCompany());
        if (pathname === '/api/library/products' || pathname === '/api/library/documents') {
          const query = Object.fromEntries(url.searchParams);
          if ([...url.searchParams.keys()].length !== Object.keys(query).length) throw new ApiError(400, 'INVALID_INPUT', 'Duplicate library query parameters are not allowed.');
          return await respond(res, 200, businessLibrary[pathname.endsWith('/products') ? 'listProducts' : 'listDocuments'](query));
        }
        const libraryResource = pathname.match(/^\/api\/library\/(products|documents|operations)\/([^/]+)(?:\/(readiness))?$/);
        if (libraryResource) {
          if (libraryResource[3] && libraryResource[1] !== 'products') throw new ApiError(404, 'NOT_FOUND', 'API route not found.');
          return await respond(res, 200, libraryResource[3] ? await businessLibrary.readiness(libraryResource[2]) : businessLibrary[{ products: 'getProduct', documents: 'getDocument', operations: 'getOperation' }[libraryResource[1]]](libraryResource[2]));
        }
        if (pathname === '/api/runs') return await respond(res, 200, runtime.listRuns());
        if (pathname === '/api/artifacts') return await respond(res, 200, artifacts.list());
        if (pathname === '/api/cloud-expert-catalog') return await respond(res, 200, cloudExperts.catalog());
        if (pathname === '/api/cloud-experts') return await respond(res, 200, { experts: cloudExperts.experts() });
        if (pathname === '/api/cloud-teams') return await respond(res, 200, { teams: cloudExperts.teams() });
        const oneCloudExpert = pathname.match(/^\/api\/cloud-experts\/([^/]+)$/);
        if (oneCloudExpert) return await respond(res, 200, { expert: cloudExperts.getExpert(oneCloudExpert[1]) });
        const oneCloudTeam = pathname.match(/^\/api\/cloud-teams\/([^/]+)(?:\/(plan))?$/);
        if (oneCloudTeam) return await respond(res, 200, oneCloudTeam[2] ? { plan: cloudExperts.planTeam(oneCloudTeam[1]) } : { team: cloudExperts.getTeam(oneCloudTeam[1]) });
        if (pathname === '/api/muse-worker-connection/tasks') {
          if (context.role !== 'admin') throw new ApiError(403, 'ROLE_REQUIRED', 'Only enterprise administrators can inspect Muse task lease/audit records.');
          return await respond(res, 200, { tasks: museBridge ? museBridge.adminTasks() : [] });
        }
        if (pathname === '/api/muse-worker-connection')
          return await respond(res, 200, museBridge ? museBridge.info() : { installed:false, approved:false, ownerId:null, onlineVerified:false });
        if (pathname === '/api/dot-worker-connection/tasks') {
          if (context.role !== 'admin') throw new ApiError(403, 'ROLE_REQUIRED', 'Only enterprise administrators can inspect Dot lease/audit records.');
          return await respond(res, 200, { tasks: dotBridge ? dotBridge.adminTasks() : [] });
        }
        if (pathname === '/api/dot-worker-connection') return await respond(res, 200, dotBridge ? dotBridge.info() : { installed:false, approved:false, ownerId:'xy', onlineVerified:false });
        if (pathname === '/api/worker-services') return await respond(res, 200, { services: workerDesk.catalog() });
        if (pathname === '/api/worker-orders') return await respond(res, 200, { orders: workerDesk.list() });
        if (pathname === '/api/worker-opportunities') return await respond(res, 200, { opportunities: workerOpportunities.list() });
        const opportunityRead = pathname.match(/^\/api\/worker-opportunities\/([^/]+)$/);
        if (opportunityRead) return await respond(res, 200, { opportunity: workerOpportunities.get(opportunityRead[1]) });
        const workerOrderRead = pathname.match(/^\/api\/worker-orders\/([^/]+)$/);
        if (workerOrderRead) return await respond(res, 200, { order: workerDesk.get(workerOrderRead[1]) });
        if (pathname === '/api/schedule-runs') return await respond(res, 200, { runs: capabilities.listScheduleRuns() });
        if (pathname === '/api/connector-runs') return await respond(res, 200, { runs: capabilities.listConnectorRuns() });
        if (pathname === '/api/capabilities') return await respond(res, 200, capabilitySnapshot());
        if (pathname === '/api/skills') return await respond(res, 200, { skills: capabilities.listSkills() });
        if (pathname === '/api/connectors') return await respond(res, 200, { connectors: capabilities.listConnectors() });
        if (pathname === '/api/approvals') return await respond(res, 200, { approvals: capabilities.listApprovals() });
        if (pathname === '/api/schedules') return await respond(res, 200, { schedules: capabilities.listSchedules() });
        let resource = pathname.match(/^\/api\/runs\/([^/]+)$/);
        if (resource) return await respond(res, 200, runtime.getRun(resource[1]));
        resource = pathname.match(/^\/api\/artifacts\/([^/]+)(?:\/(content|download))?$/);
        if (resource) {
          const version = url.searchParams.has('version') ? Number(url.searchParams.get('version')) : undefined;
          if (resource[2] === 'download') {
            const file = await artifacts.download(resource[1], version === undefined ? {} : { version });
            await res.accessFinish?.(200);
            res.writeHead(200, { 'Content-Type': file.mimeType, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`, 'Content-Length': file.bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }); return res.end(file.bytes);
          }
          return await respond(res, 200, resource[2] === 'content' ? await artifacts.read(resource[1], version === undefined ? {} : { version }) : artifacts.get(resource[1]));
        }
        resource = pathname.match(/^\/api\/(skills|connectors|schedules)\/([^/]+)$/);
        if (resource) return await respond(res, 200, { [{ skills: 'skill', connectors: 'connector', schedules: 'schedule' }[resource[1]]]: capabilities[{ skills: 'getSkill', connectors: 'getConnector', schedules: 'getSchedule' }[resource[1]]](resource[2]) });
        const state = { ...runtime.bootstrap(), capabilities: capabilitySnapshot(), diagnostics: diagnostics() };
        const resources = { '/api/bootstrap': state, '/api/status': runtime.status(), '/api/conversations': { conversations: state.conversations }, '/api/goals': { goals: state.goals }, '/api/activity': { activity: state.activity }, '/api/settings': { settings: state.settings }, '/api/memories': { memories: state.memories } };
        if (pathname === '/api/search') { const query = (url.searchParams.get('q') || '').trim(); if (!query || query.length > 200) throw new ApiError(400, 'INVALID_INPUT', 'Search query must be 1–200 characters.'); const needle = query.toLocaleLowerCase(); const results = ['conversations', 'messages', 'goals', 'memories', 'artifacts'].flatMap(collection => (state[collection] || []).filter(item => [item.title, item.content, item.description, item.filename].some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(needle))).slice(0, 50).map(item => ({ collection, id: item.id, title: item.title || item.filename || item.content?.slice(0, 100), conversationId: item.conversationId || item.sourceConversationId || null }))); return await respond(res, 200, { results: results.slice(0, 100) }); }
        if (resources[pathname]) return await respond(res, 200, resources[pathname]);
        const singular = pathname.match(/^\/api\/(goals|memories)\/([^/]+)$/);
        if (singular) { const item = state[singular[1]].find(item => item.id === singular[2]); if (!item) throw new ApiError(404, 'NOT_FOUND', 'Item not found.'); return await respond(res, 200, { [singular[1] === 'goals' ? 'goal' : 'memory']: item }); }
        const match = pathname.match(/^\/api\/conversations\/([^/]+)(?:\/messages)?$/);
        if (match) {
          const item = state.conversations.find(item => item.id === match[1]);
          if (!item) throw new ApiError(404, 'NOT_FOUND', 'Conversation not found.');
          return await respond(res, 200, { conversation: item, messages: state.messages.filter(item => item.conversationId === match[1]) });
        }
        throw new ApiError(404, 'NOT_FOUND', 'API route not found.');
      }
      if (!['POST', 'PATCH', 'DELETE'].includes(method)) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      const body = method === 'DELETE' ? {} : await readBody(req, /^\/api\/artifacts(?:\/[^/]+)?$/.test(pathname) ? 7_100_000 : 100_000);
      access.verifyBody(context, req.bodyBytes || Buffer.alloc(0));
      if (method === 'POST' && pathname === '/api/commerce-shopify/verify') {
        if (context.role !== 'admin') throw new ApiError(403, 'ROLE_REQUIRED', 'Only administrators may verify a store authorization.');
        if (Object.keys(body).some(key => key !== 'requestId') || body.requestId !== undefined && !/^[a-f0-9-]{36}$/u.test(body.requestId)) throw new ApiError(400, 'INVALID_INPUT', 'Shopify verification accepts only an optional request ID.');
        return await respond(res, 200, { shopify: await shopify.verify() });
      }
      if (method === 'POST' && pathname === '/api/commerce-projects') return await respond(res, 201, await commerce.create(body, context));
      const commerceAction = pathname.match(/^\/api\/commerce-projects\/([^/]+)\/(stage-research|stage-worker-research|sync-orders)$/);
      if (method === 'POST' && commerceAction) return await respond(res, 200, await commerce[{ 'stage-research': 'stageResearch', 'stage-worker-research': 'stageWorkerResearch', 'sync-orders': 'syncOrders' }[commerceAction[2]]](commerceAction[1], body, context));
      const conversationLibraryWrite = pathname.match(/^\/api\/conversations\/([^/]+)\/library-references$/);
      if (method === 'PATCH' && conversationLibraryWrite) return await respond(res, 200, await businessLibrary.updateConversationReferences(conversationLibraryWrite[1], body, context));
      if (method === 'PATCH' && pathname === '/api/library/company') return await respond(res, 200, await businessLibrary.updateCompany(body, context));
      if (method === 'POST' && ['/api/library/products', '/api/library/documents'].includes(pathname)) return await respond(res, 201, await businessLibrary[pathname.endsWith('/products') ? 'createProduct' : 'createDocument'](body, context));
      const libraryWrite = pathname.match(/^\/api\/library\/(products|documents)\/([^/]+)(?:\/(versions)(?:\/([1-9][0-9]*)\/(reviews))?)?$/);
      if (libraryWrite) {
        if (method === 'PATCH' && !libraryWrite[3]) return await respond(res, 200, await businessLibrary[libraryWrite[1] === 'products' ? 'updateProduct' : 'updateDocument'](libraryWrite[2], body, context));
        if (method === 'POST' && libraryWrite[1] === 'documents' && libraryWrite[3]) return await respond(res, 201, libraryWrite[5] ? await businessLibrary.reviewDocument(libraryWrite[2], Number(libraryWrite[4]), body, context) : await businessLibrary.appendDocumentVersion(libraryWrite[2], body, context));
      }
      if (method === 'POST' && ['/api/session/login', '/api/session/logout'].includes(pathname)) {
        if (Object.keys(body).length) throw new ApiError(400, 'INVALID_INPUT', 'Session actions require an empty JSON object.');
        return await respond(res, 200, await access[pathname.endsWith('/login') ? 'login' : 'logout'](context, res));
      }
      const accessSession = pathname.match(/^\/api\/access\/sessions\/([^/]+)\/revoke$/);
      if (method === 'POST' && accessSession) return await respond(res, 200, await access.revokeSession(context, accessSession[1]));
      const expertDelegation = pathname.match(/^\/api\/cloud-experts\/([^/]+)\/delegate$/);
      if (method === 'POST' && expertDelegation) return await respond(res, 201, await cloudExperts.delegateExpert(expertDelegation[1], body, context.subject));
      if (method === 'POST' && pathname === '/api/cloud-experts') return await respond(res, 201, await cloudExperts.hire(body, context.subject));
      if (method === 'POST' && pathname === '/api/cloud-teams') return await respond(res, 201, await cloudExperts.formTeam(body, context.subject));
      const teamStage = pathname.match(/^\/api\/cloud-teams\/([^/]+)\/stage$/);
      if (teamStage && method === 'POST') return await respond(res, 201, await cloudExperts.stageTeamWork(teamStage[1], body, context.subject));
      const reconfigureExpert = pathname.match(/^\/api\/cloud-experts\/([^/]+)$/);
      if (method === 'PATCH' && reconfigureExpert) return await respond(res, 200, await cloudExperts.configure(reconfigureExpert[1], body, context.subject));
      const reconfigureTeam = pathname.match(/^\/api\/cloud-teams\/([^/]+)$/);
      if (method === 'PATCH' && reconfigureTeam) return await respond(res, 200, await cloudExperts.configureTeam(reconfigureTeam[1], body, context.subject));
      if (method === 'POST' && pathname === '/api/worker-orders') return await respond(res, 201, await workerDesk.create(body, context.subject));
      const promote = pathname.match(/^\/api\/worker-orders\/([^/]+)\/promote$/);
      if (promote && method === 'POST') {
        if (context.role !== 'admin') throw new ApiError(403, 'ROLE_REQUIRED', 'Only an administrator may import externally sourced prospects.');
        return await respond(res, 200, await workerOpportunities.importFromOrder(promote[1], body, context.subject));
      }
      const prospectReview = pathname.match(/^\/api\/worker-opportunities\/([^/]+)\/review$/);
      if (prospectReview && method === 'POST') {
        if (context.role !== 'admin') throw new ApiError(403, 'ROLE_REQUIRED', 'Only an administrator may qualify an external prospect.');
        return await respond(res, 200, await workerOpportunities.review(prospectReview[1], body, context.subject));
      }
      const workerOperation = pathname.match(/^\/api\/worker-orders\/([^/]+)\/(approve|dispatch|refresh|accept|cancel)$/);
      if (workerOperation && method === 'POST') {
        if (context.role !== 'admin') throw new ApiError(403, 'ROLE_REQUIRED', 'An administrator must authorize third-party work and review delivery.');
        const [, orderId, action] = workerOperation;
        if (action === 'approve') return await respond(res, 200, await workerDesk.approve(orderId, context.subject, body));
        if (action === 'dispatch') return await respond(res, 200, await workerDesk.dispatch(orderId));
        if (action === 'refresh') return await respond(res, 200, await workerDesk.refresh(orderId));
        if (action === 'accept') return await respond(res, 200, await workerDesk.accept(orderId, context.subject, body));
        if (action === 'cancel') return await respond(res, 200, await workerDesk.cancel(orderId));
      }
      if (method === 'POST' && pathname === '/api/artifacts') return await respond(res, 201, await artifacts.create(body));
      if (method === 'POST' && pathname === '/api/skills') return await respond(res, 201, await capabilities.createSkill(body));
      if (method === 'POST' && pathname === '/api/connectors') return await respond(res, 201, await capabilities.createConnector(body));
      if (method === 'POST' && pathname === '/api/approvals') return await respond(res, 201, await capabilities.requestApproval(body));
      if (method === 'POST' && pathname === '/api/schedules') return await respond(res, 201, await capabilities.createSchedule(body));
      let extension = pathname.match(/^\/api\/runs\/([^/]+)\/(action-decision|resume)$/);
      if (extension && method === 'POST') return await respond(res, 200, await runtime[extension[2] === 'action-decision' ? 'resolveRunAction' : 'resumeRun'](extension[1], body));
      extension = pathname.match(/^\/api\/conversations\/([^/]+)\/input-context$/);
      if (extension && method === 'PATCH') return await respond(res, 200, await runtime.updateConversationInputContext(extension[1], body));
      extension = pathname.match(/^\/api\/runs\/([^/]+)\/(cancel|retry)$/);
      if (extension && method === 'POST') return await respond(res, extension[2] === 'retry' ? 202 : 200, await runtime[extension[2] === 'cancel' ? 'cancelRun' : 'retryRun'](extension[1], body));
      extension = pathname.match(/^\/api\/artifacts\/([^/]+)$/);
      if (extension && ['PATCH', 'DELETE'].includes(method)) return await respond(res, 200, await artifacts[method === 'PATCH' ? 'update' : 'delete'](extension[1], body));
      extension = pathname.match(/^\/api\/(skills|connectors|schedules)\/([^/]+)$/);
      if (extension && ['PATCH', 'DELETE'].includes(method)) return await respond(res, 200, await capabilities[`${method === 'PATCH' ? 'update' : 'delete'}${{ skills: 'Skill', connectors: 'Connector', schedules: 'Schedule' }[extension[1]]}`](extension[2], body));
      extension = pathname.match(/^\/api\/(connectors|schedules)\/([^/]+)\/approval$/);
      if (extension && method === 'POST') { const scope = extension[1] === 'connectors' ? capabilities.connectorApprovalRequest(extension[2], body) : capabilities.scheduleApprovalRequest(extension[2]); return await respond(res, 201, await capabilities.requestApproval(scope)); }
      extension = pathname.match(/^\/api\/connectors\/([^/]+)\/execute$/);
      if (extension && method === 'POST') return await respond(res, 200, await capabilities.executeConnector(extension[1], body));
      extension = pathname.match(/^\/api\/approvals\/([^/]+)\/decision$/);
      if (extension && method === 'POST') return await respond(res, 200, await capabilities.decideApproval(extension[1], body));
      extension = pathname.match(/^\/api\/schedules\/([^/]+)\/(enable|disable)$/);
      if (extension && method === 'POST') return await respond(res, 200, await capabilities[extension[2] === 'enable' ? 'enableSchedule' : 'disableSchedule'](extension[1], body));
      extension = pathname.match(/^\/api\/conversations\/([^/]+)\/reset-session$/);
      if (extension && method === 'POST') return await respond(res, 200, await runtime.resetSession(extension[1]));
      if (method === 'POST' && pathname === '/api/conversations') return await respond(res, 201, await runtime.createConversation(body));
      if (method === 'POST' && pathname === '/api/goals') return await respond(res, 201, await runtime.createGoal(body));
      if (method === 'PATCH' && pathname === '/api/settings') return await respond(res, 200, await runtime.updateSettings(body));
      if (method === 'POST' && pathname === '/api/memories') return await respond(res, 201, await runtime.createMemory(body));
      let match = pathname.match(/^\/api\/conversations\/([^/]+)(?:\/(messages|cancel))?$/);
      if (match) {
        const [, id, resource] = match;
        if (method === 'POST' && resource === 'messages') return await respond(res, 202, await runtime.sendMessage(id, body));
        if (method === 'POST' && resource === 'cancel') return await respond(res, 200, await runtime.cancelConversation(id));
        if (method === 'PATCH' && !resource) return await respond(res, 200, await runtime.updateConversation(id, body));
        if (method === 'DELETE' && !resource) return await respond(res, 200, await runtime.deleteConversation(id));
      }
      match = pathname.match(/^\/api\/goals\/([^/]+)$/);
      if (match) {
        if (method === 'PATCH') return await respond(res, 200, await runtime.updateGoal(match[1], body));
        if (method === 'DELETE') return await respond(res, 200, await runtime.deleteGoal(match[1]));
      }
      match = pathname.match(/^\/api\/memories\/([^/]+)$/);
      if (match) {
        if (method === 'PATCH') return await respond(res, 200, await runtime.updateMemory(match[1], body));
        if (method === 'DELETE') return await respond(res, 200, await runtime.deleteMemory(match[1]));
      }
      throw new ApiError(404, 'NOT_FOUND', 'API route not found.');
    } catch (error) {
      const safe = error instanceof ApiError || error instanceof CapabilityError || error instanceof WorkerDeskError || error instanceof WorkerOpportunityError || error instanceof CloudExpertError || error instanceof DotWorkerError || error instanceof MuseWorkerError || error instanceof AccessError;
      try {
        if (!res.accessFinish) await access.recordDenial(error);
        if (!res.headersSent) await respond(res, safe ? error.status : 500, { error: { code: safe ? error.code : 'INTERNAL_ERROR', message: safe ? error.message : 'The server could not complete this action. Please retry.' } });
        else res.end();
      } catch {
        if (!res.headersSent) { res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: { code: 'AUDIT_UNAVAILABLE', message: 'Access audit is unavailable. Ask the operator to inspect the deployment.' } })); }
        else res.end();
      }
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 64;
  let closed = false;
  let closingPromise;
  return {
    server, runtime, store, artifacts, businessLibrary, shopify, commerce, capabilities, workerDesk, workerOpportunities, cloudExperts, dotBridge, museBridge, access, diagnostics,
    async listen(port = 8787, host = '127.0.0.1') {
      if (closed) throw new Error('The application is closed. Create a new application instance.');
      if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Only loopback binding is supported. Enterprise access requires a same-host authenticated TLS ingress.');
      await new Promise((resolve, reject) => { const failed = error => reject(error); server.once('error', failed); server.listen(port, host, () => { server.removeListener('error', failed); resolve(); }); });
      runtime.start();
      schedulerState.state = 'starting'; schedulerState.automaticTimer = true;
      scheduler = setInterval(() => { void schedulerTick(); }, schedulerIntervalMs); scheduler.unref();
      return server.address();
    },
    close() {
      if (closingPromise) return closingPromise;
      closed = true;
      closingPromise = (async () => {
        clearInterval(scheduler); schedulerState.automaticTimer = false; schedulerState.state = 'stopped';
        for (const stream of streams) stream.end();
        const stopped = new Promise(resolve => { if (!server.listening) resolve(); else server.close(resolve); });
        server.closeIdleConnections();
        try {
          // Signal both domains before waiting, so a connector cannot delay model cancellation.
          const results = await Promise.allSettled([capabilities.close?.(), runtime.close()]);
          await artifacts.close?.();
          const failure = results.find(result => result.status === 'rejected');
          if (failure) throw failure.reason;
          await access.close();
          await store.close();
        } finally {
          server.closeAllConnections();
          await stopped;
        }
      })();
      return closingPromise;
    },
  };
}

async function main() {
  const port = Number(process.env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  // The key is read only on explicit server startup, never scanned from user files.
  const mode = process.env.WORKSPACE_RUNTIME || 'fastaitoken';
  if (!['deepseek-api', 'harness', 'fastaitoken'].includes(mode)) throw new Error('WORKSPACE_RUNTIME must be deepseek-api, fastaitoken or harness.');
  const access = await accessConfigFromEnvironment(process.env);
  const dataDirectory = path.resolve(process.env.WORKSPACE_DATA_DIR || path.join(root, '.data'));
  const dshHome = path.join(dataDirectory, 'harness');
  const workspaceDirectory = path.join(dataDirectory, 'agent-workspace');
  if (mode === 'harness') { await fs.mkdir(dshHome, { recursive: true, mode: 0o700 }); await fs.mkdir(workspaceDirectory, { recursive: true, mode: 0o700 }); }
  const nativeProvider = process.env.DSH_PROVIDER || 'deepseek-official';
  const nativeOfficial = nativeProvider === 'deepseek-official';
  const provider = mode === 'harness' ? createHarnessProvider({ apiKey: (nativeOfficial ? process.env.DEEPSEEK_API_KEY : process.env.FASTAITOKEN_API_KEY) || '', nativeProvider, nativeProfile: process.env.DSH_PROFILE || 'sdk', nativeProtocol: process.env.DSH_PROTOCOL || (nativeOfficial ? 'deepseek-native' : ''), nativeBaseURL: process.env.DSH_BASE_URL || (nativeOfficial ? 'https://api.deepseek.com' : ''), nativeApiKeyEnv: process.env.DSH_API_KEY_ENV || (nativeOfficial ? 'DEEPSEEK_API_KEY' : ''), relayPatch: process.env.DSH_RELAY_PATCH || '', recoveryPatch: process.env.DSH_RECOVERY_PATCH || '', dshBin: process.env.DSH_BIN || '', profilePatch: process.env.DSH_REVIEWED_PATCH || '', nativeModel: process.env.DSH_MODEL || (nativeOfficial ? 'deepseek-v4-flash' : ''), nativeBridge: process.env.DSH_WORKSPACE_BRIDGE === '1', bridgePatch: process.env.DSH_WORKSPACE_BRIDGE_PATCH || '', dshHome, workspaceDirectory }) : mode === 'fastaitoken' ? createFastAITokenProvider({ apiKey: process.env.FASTAITOKEN_API_KEY || '', model: process.env.FASTAITOKEN_MODEL || '' }) : createDeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY || '' });
  // No SDK, credentials, outbound requests or partner registration without a
  // pinned, privately stored deployment catalog. Web clients cannot edit it.
  const reviewedWorkers = await loadReviewedA2AWorkers({ environment: process.env });
  // The official dot product has no verified inbound task API. Instead,
  // a reviewed ChatGPT plugin can pull scoped public work from this host.
  if (process.env.WORKSPACE_DOT_ENABLED === '1' && !process.env.WORKSPACE_DOT_BRIDGE_TOKEN_SHA256)
    throw new Error('WORKSPACE_DOT_ENABLED requires a server-side pinned dot plugin token hash.');
  if (process.env.WORKSPACE_MUSE_ENABLED === '1' && !process.env.WORKSPACE_MUSE_BRIDGE_TOKEN_SHA256)
    throw new Error('WORKSPACE_MUSE_ENABLED requires a server-side pinned Muse token hash.');
  const museWorkerConfig = process.env.WORKSPACE_MUSE_BRIDGE_TOKEN_SHA256 ? {
    workerId: process.env.WORKSPACE_MUSE_WORKER_ID || 'muse-personal-owner',
    ownerId: process.env.WORKSPACE_MUSE_OWNER_ID || 'personal',
    tokenDigest: process.env.WORKSPACE_MUSE_BRIDGE_TOKEN_SHA256,
    enabled: process.env.WORKSPACE_MUSE_ENABLED === '1',
    scopeReviewed: process.env.WORKSPACE_MUSE_SCOPE_REVIEWED === '1',
    externalBudgetVerified: process.env.WORKSPACE_MUSE_EXTERNAL_BUDGET_VERIFIED === '1',
  } : null;
  const dotWorkerConfig = process.env.WORKSPACE_DOT_BRIDGE_TOKEN_SHA256 ? {
    workerId: process.env.WORKSPACE_DOT_WORKER_ID || 'chatgpt-dot-xy',
    ownerId: process.env.WORKSPACE_DOT_OWNER_ID || 'xy',
    tokenDigest: process.env.WORKSPACE_DOT_BRIDGE_TOKEN_SHA256,
    enabled: process.env.WORKSPACE_DOT_ENABLED === '1',
    scopeReviewed: process.env.WORKSPACE_DOT_SCOPE_REVIEWED === '1',
    externalBudgetVerified: process.env.WORKSPACE_DOT_EXTERNAL_BUDGET_VERIFIED === '1',
  } : null;
  let app;
  try {
    app = await createApp({ dataDirectory, provider, access,
      workerAdapters: reviewedWorkers.adapters,
      dotWorkerConfig, museWorkerConfig,
      allowedOrigins: process.env.WORKSPACE_DEV_ORIGIN ? [process.env.WORKSPACE_DEV_ORIGIN] : [],
      maxConcurrentRuns: mode === 'harness' ? 1 : 3 });
    await app.listen(port);
  } catch (error) {
    await Promise.allSettled([app?.close?.(), reviewedWorkers.close()]);
    throw error;
  }
  console.log(`Workspace server: http://127.0.0.1:${port} (${access.mode} access; ${mode}; ${provider.configured ? 'configured; not connection-tested' : 'setup required'})`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    Promise.allSettled([app.close(), reviewedWorkers.close()]).then(results => {
      process.exit(results.every(result => result.status === 'fulfilled') ? 0 : 1);
    });
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
