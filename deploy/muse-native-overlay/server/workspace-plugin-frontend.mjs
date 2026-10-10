import http from 'node:http';
import { MuseWorkerError } from './muse-worker-api.mjs';
import { isNativeMusePublicError } from './muse-worker-native.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAccessControl, validateAccessConfig, AccessError } from './access.mjs';
import { respond, readBody, staticResponse } from './index.mjs';
import { ApiError } from './runtime.mjs';
import { WorkerGatewayError, WORKER_BODY_LIMIT } from './personal-worker.mjs';
import { CapabilityError } from './capabilities.mjs';
import { FILE_BODY_MAX_BYTES, DEFAULT_FILE_LIMITS, validateFileLimits, createFileRequestGate } from './file-limits.mjs';
import { pluginFields, pluginFail, WorkspacePluginError } from './workspace-plugin-config.mjs';

/** HTTP presentation of an existing business plugin; owns no business store or executor.
 * @param options - Existing service, reviewed owner bindings, access and frontend paths.
 * @returns Loopback listener and a disposer that drains accepted requests.
 */
export async function createWorkspacePluginFrontend({ service, operators, dataDirectory,
  dotHost,
  staticDirectory = fileURLToPath(new URL('../dist', import.meta.url)), access: accessOptions = {},
  maxConcurrentFileRequests = DEFAULT_FILE_LIMITS.maxConcurrentFileRequests }) {
  if (!service?.bindActor || !Array.isArray(operators) || !path.isAbsolute(dataDirectory)) {
    pluginFail('WORKSPACE_FRONTEND_CONFIG', 'The frontend requires the existing business service and reviewed owners.');
  }
  const fileLimits = validateFileLimits({ maxConcurrentFileRequests });
  const fileRequests = createFileRequestGate(fileLimits.maxConcurrentFileRequests);
  const access = await createAccessControl({ config: validateAccessConfig(accessOptions), dataDirectory });
  let stopping = false, closing;
  const pending = new Set();
  function owner(subject) {
    const matches = operators.filter(o => o.subject === subject);
    if (matches.length !== 1) pluginFail('WORKSPACE_PLUGIN_OWNER', 'This frontend identity has no unique native Agent binding.');
    return matches[0];
  }
  function resultHandle(actor) {
    try { return service.bindNativeResults(actor); }
    catch (error) { if (error.code === 'WORKSPACE_NATIVE_RESULT_BINDING_REQUIRED') return null; throw error; }
  }
  async function view(actor) {
    return { ...await service.bindActor(actor).view(), nativeResultsAvailable: Boolean(resultHandle(actor)),
      ...(service.dot?.enabled ? { dotEvents: service.dot.view(actor.subject), dotTasks: await service.bindDotTasks(actor).view() } : {}),
      ...await service.bindNativeTasks(actor).catalog() };
  }
  async function handle(req, res) {
    let completeFileRequest;
    try {
      if (stopping) throw new ApiError(503, 'WORKSPACE_FRONTEND_CLOSED', 'The plugin frontend is closing.');
      const url = new URL(req.url, 'http://localhost'), pathname = url.pathname;
      if (pathname === '/api/muse-worker' || pathname.startsWith('/api/muse-worker/')) {
        if (!service.muse?.enabled) throw new MuseWorkerError(404, 'MW_GATEWAY_UNAVAILABLE', 'Muse REST is not configured on this native Host.');
        await service.muse.handle(req, res, pathname); return;
      }
      if (service.dot?.enabled && ['/mcp/dot', '/.well-known/oauth-protected-resource', service.dot.metadataPath].includes(pathname)) {
        if (pathname !== '/mcp/dot') {
          if (req.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET.');
          return await respond(res, 200, service.dot.metadata);
        }
        if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
        const body = await readBody(req, WORKER_BODY_LIMIT);
        const headers = new Headers();
        for (const name of ['authorization', 'content-type', 'mcp-protocol-version', 'origin']) if (typeof req.headers[name] === 'string') headers.set(name, req.headers[name]);
        const response = await service.dot.handle(new Request(service.dot.metadata.resource, { method: 'POST', headers, body: JSON.stringify(body) }));
        for (const name of ['content-type', 'www-authenticate', 'mcp-protocol-version', 'allow']) if (response.headers.has(name)) res.setHeader(name, response.headers.get(name));
        res.setHeader('Cache-Control', 'no-store'); res.writeHead(response.status); return res.end(await response.text());
      }
      const context = await access.begin(req, res, pathname);
      if (!pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET or HEAD.');
        return await staticResponse(req, res, pathname, staticDirectory);
      }
      if (req.method === 'GET' && pathname === '/api/session') return await respond(res, 200, access.sessionView(context));
      if (req.method === 'POST' && ['/api/session/login', '/api/session/logout'].includes(pathname)) {
        const body = await readBody(req); access.verifyBody(context, req.bodyBytes); pluginFields(body, []);
        return await respond(res, 200, await access[pathname.endsWith('login') ? 'login' : 'logout'](context, res));
      }
      const actor = owner(context.subject), worker = service.bindActor(actor), results = resultHandle(actor);
      const business = service.bindFrontend(actor);
      if (/^\/api\/(?:worker-services|worker-orders|worker-opportunities|muse-workers)(?:\/|$)/.test(pathname)) {
        if (context.role !== 'admin') throw new ApiError(403, 'ROLE_REQUIRED', 'Only the reviewed administrator may authorize or accept Muse work.');
        if (!service.muse?.enabled) throw new MuseWorkerError(404, 'MW_GATEWAY_UNAVAILABLE', 'Muse REST is not configured on this native Host.');
        const desk = service.muse.bindDesk(actor);
        if (req.method === 'GET') {
          if (pathname === '/api/worker-services') return await respond(res, 200, { services: await desk.catalog() });
          if (pathname === '/api/worker-orders') return await respond(res, 200, { orders: await desk.list() });
          if (pathname === '/api/worker-opportunities') return await respond(res, 200, { opportunities: await desk.opportunities() });
          if (pathname === '/api/muse-workers') return await respond(res, 200, { muse: await desk.info(), tasks: await desk.tasks() });
          const readOrder = pathname.match(/^\/api\/worker-orders\/([^/]+)$/);
          if (readOrder) return await respond(res, 200, { order: await desk.get(readOrder[1]) });
        }
        if (req.method === 'POST') {
          const body = await readBody(req, 30_000); access.verifyBody(context, req.bodyBytes);
          if (pathname === '/api/worker-orders') return await respond(res, 201, await desk.create(body));
          const operation = pathname.match(/^\/api\/worker-orders\/([^/]+)\/(approve|dispatch|refresh|accept|cancel|promote)$/);
          if (operation) {
            if (['dispatch', 'refresh', 'cancel'].includes(operation[2])) pluginFields(body, []);
            return await respond(res, 200, await desk[operation[2]](operation[1], body));
          }
          const review = pathname.match(/^\/api\/worker-opportunities\/([^/]+)\/review$/);
          if (review) return await respond(res, 200, await desk.review(review[1], body));
        }
        throw new ApiError(404, 'NOT_FOUND', 'Muse business route not found.');
      }
      if (/^\/api\/(?:artifacts|cloud-worker\/files)(?:\/|$)/.test(pathname)) completeFileRequest = fileRequests.admit(res);
      if (req.method === 'GET' && pathname === '/api/cloud-worker/tasks') return await respond(res, 200, { tasks: await service.bindDotTasks(actor).view() });
      if (dotHost && req.method === 'POST' && pathname === '/api/cloud-worker/accept') {
        const body = await readBody(req); access.verifyBody(context, req.bodyBytes);
        return await respond(res, 200, { tasks: await dotHost.acceptResult(actor, body) });
      }
      if (dotHost && req.method === 'POST' && ['/api/cloud-worker/cancel', '/api/cloud-worker/close'].includes(pathname)) {
        const body = await readBody(req); access.verifyBody(context, req.bodyBytes);
        return await respond(res, 200, { tasks: await dotHost[pathname.endsWith('/cancel') ? 'cancelTask' : 'closeResult'](actor, body) });
      }
      if (dotHost && req.method === 'POST' && pathname === '/api/conversations') {
        const body = await readBody(req); access.verifyBody(context, req.bodyBytes); pluginFields(body, ['title']);
        return await respond(res, 200, { conversation: { id: actor.nativeAgentId, title: body.title || '和 xy 对话', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
      }
      const cloudQuestion = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (dotHost && cloudQuestion && req.method === 'POST') {
        const body = await readBody(req); access.verifyBody(context, req.bodyBytes);
        if (cloudQuestion[1] !== actor.nativeAgentId) pluginFail('WORKSPACE_PLUGIN_OWNER', 'This conversation belongs to a different original native Session.');
        return await respond(res, 200, { task: await dotHost.submitQuestion(actor, body) });
      }
      const cloudFile = pathname.match(/^\/api\/cloud-worker\/files\/([^/]+)$/);
      if (cloudFile && req.method === 'GET') {
        const output = await service.bindDotTasks(actor).download({ artifactId: cloudFile[1], version: Number(url.searchParams.get('version')), sha256: url.searchParams.get('sha256') });
        await res.accessFinish?.(200);
        res.writeHead(200, { 'Content-Type': output.mimeType, 'Content-Length': output.bytes.length,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(output.filename)}`,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Content-SHA256': output.sha256 });
        return res.end(output.bytes);
      }
      if (req.method === 'GET' && pathname === '/api/personal-worker') return await respond(res, 200, await view(actor));
      const file = pathname.match(/^\/api\/artifacts\/([^/]+)\/(download|open|content)$/);
      if (file && req.method === 'GET') {
        const refs = (await worker.view()).delegations.flatMap(j => j.files);
        const reference = refs.find(r => r.id === file[1] && r.version === Number(url.searchParams.get('version')));
        const options = url.searchParams.has('version') ? { version: Number(url.searchParams.get('version')) } : {};
        const state = await business.snapshot(access.health());
        if (!state.artifacts.some(a => a.id === file[1])) throw new ApiError(404, 'NOT_FOUND', 'The owned file was not found.');
        if (file[2] === 'content' && url.searchParams.get('format') !== 'worker') return await respond(res, 200, await business.file(file[1], options, true));
        if (url.searchParams.get('format') === 'worker' && !reference) throw new ApiError(404, 'NOT_FOUND', 'The exact Worker file version was not found.');
        const output = reference
          ? await worker.download({ artifactId: reference.id, version: reference.version, sha256: reference.sha256 })
          : await business.download(file[1], options);
        if (file[2] === 'content') {
          return await respond(res, 200, { filename: output.filename, mimeType: output.mimeType,
            sha256: output.sha256, version: reference.version,
            encoding: 'base64', content: output.bytes.toString('base64') });
        }
        await res.accessFinish?.(200);
        res.writeHead(200, { 'Content-Type': output.mimeType, 'Content-Length': output.bytes.length,
          'Content-Disposition': `${file[2] === 'download' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(output.filename)}`,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-SHA256': output.sha256 ?? output.version.sha256 });
        return res.end(output.bytes);
      }
      if (req.method === 'GET') {
        const state = await business.snapshot(access.health());
        const resources = {
          '/api/bootstrap': state, '/api/status': state.runtime, '/api/diagnostics': state.diagnostics,
          '/api/health': { status: state.diagnostics.blockers.length ? 'degraded' : 'ok', storage: state.diagnostics.storage,
            access: state.diagnostics.access, plugin: state.runtime.plugin, provider: state.diagnostics.provider,
            fileIO: { requests: fileRequests.status(), bodyMaxBytes: FILE_BODY_MAX_BYTES } },
          '/api/conversations': { conversations: state.conversations }, '/api/goals': { goals: state.goals },
          '/api/activity': { activity: state.activity }, '/api/settings': { settings: state.settings },
          '/api/memories': { memories: state.memories }, '/api/runs': { runs: state.runs }, '/api/artifacts': { artifacts: state.artifacts },
          '/api/capabilities': state.capabilities, '/api/skills': { skills: state.capabilities.skills },
          '/api/connectors': { connectors: state.capabilities.connectors }, '/api/approvals': { approvals: state.capabilities.approvals },
          '/api/schedules': { schedules: state.capabilities.schedules },
          '/api/schedule-runs': { runs: state.capabilities.scheduleRuns }, '/api/connector-runs': { runs: state.capabilities.connectorRuns },
        };
        if (resources[pathname]) return await respond(res, 200, resources[pathname]);
        if (pathname === '/api/search') {
          const query = (url.searchParams.get('q') ?? '').trim();
          if (!query || query.length > 200) throw new ApiError(400, 'INVALID_INPUT', 'Search query must be 1–200 characters.');
          const needle = query.toLocaleLowerCase();
          const results = ['conversations', 'messages', 'goals', 'memories', 'artifacts'].flatMap(collection => state[collection]
            .filter(i => [i.title, i.content, i.description, i.filename].some(v => typeof v === 'string' && v.toLocaleLowerCase().includes(needle)))
            .map(i => ({ collection, id: i.id, title: i.title || i.filename || i.content?.slice(0, 100), conversationId: i.conversationId || i.sourceConversationId || null }))).slice(0, 100);
          return await respond(res, 200, { results });
        }
        const item = pathname.match(/^\/api\/(conversations|goals|memories|runs|artifacts|skills|connectors|schedules)\/([^/]+)(?:\/messages)?$/);
        if (item) {
          const values = state[item[1]] ?? state.capabilities[item[1]], value = values?.find(i => i.id === item[2]);
          if (!value) throw new ApiError(404, 'NOT_FOUND', 'Item not found.');
          const singular = { conversations: 'conversation', goals: 'goal', memories: 'memory', runs: 'run', artifacts: 'artifact', skills: 'skill', connectors: 'connector', schedules: 'schedule' };
          return await respond(res, 200, { [singular[item[1]]]: value,
            ...(item[1] === 'conversations' ? { messages: state.messages.filter(m => m.conversationId === value.id) } : {}) });
        }
      }
      if (['POST', 'PATCH', 'DELETE'].includes(req.method) && /^\/api\/(conversations|goals|settings|memories|runs|skills|connectors|schedules|approvals|artifacts)(?:\/|$)/.test(pathname)) {
        const body = req.method === 'DELETE' ? {} : await readBody(req, /^\/api\/artifacts(?:\/[^/]+)?$/.test(pathname) ? FILE_BODY_MAX_BYTES : 100_000);
        access.verifyBody(context, req.bodyBytes || Buffer.alloc(0));
        if (req.method === 'PATCH' && pathname === '/api/settings') return await respond(res, 200, await business.updateSettings(body));
        if (req.method === 'POST' && pathname === '/api/memories') return await respond(res, 201, await business.createMemory(body));
        if (req.method === 'POST' && pathname === '/api/artifacts') return await respond(res, 201, await business.createArtifact(body));
        const local = pathname.match(/^\/api\/(memories|artifacts)\/([^/]+)$/);
        if (local && ['PATCH', 'DELETE'].includes(req.method)) {
          const method = `${req.method === 'PATCH' ? 'update' : 'delete'}${local[1] === 'memories' ? 'Memory' : 'Artifact'}`;
          return await respond(res, 200, await business[method](local[2], body));
        }
        pluginFail('WORKSPACE_NATIVE_TASK_REQUIRED', '当前原生入口通过我的 Worker 提交批准目录中的任务。资料编辑不会触发自由聊天、目标执行或外部操作。');
      }
      if (req.method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Plugin frontend route not found.');
      const body = await readBody(req); access.verifyBody(context, req.bodyBytes);
      if (pathname === '/api/personal-worker/native/submit') {
        const submission = await service.bindNativeTasks(actor).submit(body);
        return await respond(res, 200, { ...await view(actor), ...submission });
      }
      const action = pathname.match(/^\/api\/personal-worker\/(register|disconnect|pause|resume|revoke|delegate)$/);
      if (action) {
        const methods = { register: 'register', disconnect: 'disconnect', pause: 'pauseConnection', resume: 'resumeConnection', revoke: 'revokeConnection', delegate: 'delegate' };
        await worker[methods[action[1]]](body);
        return await respond(res, 200, await view(actor));
      }
      if (pathname === '/api/personal-worker/native/inspect') {
        pluginFields(body, ['jobId']);
        if (!results) pluginFail('WORKSPACE_NATIVE_RESULT_BINDING_REQUIRED', 'The original Muse result reader is not configured.');
        return await respond(res, 200, await results.inspect(body.jobId));
      }
      if (['/api/personal-worker/native/publish', '/api/personal-worker/native/reconcile'].includes(pathname)) {
        pluginFields(body, ['jobId', 'expectedReceiptHash', 'confirmed']);
        if (!results || body.confirmed !== true) pluginFail('WORKSPACE_NATIVE_RESULT_REVIEW', 'Review and confirm the original result before publication.');
        const { action, resource, payload } = await results.inspect(body.jobId);
        if (action !== (pathname.endsWith('/reconcile') ? 'reconcile' : 'publish_result')) {
          pluginFail('WORKSPACE_NATIVE_RESULT_ACTION', 'Use publication for a successful result or reconciliation for an executor failure/cancellation receipt.');
        }
        if (payload.expectedReceiptHash !== body.expectedReceiptHash) pluginFail('WORKSPACE_NATIVE_RESULT_CHANGED', 'The result changed; inspect it again before approving.');
        const { connector } = await results.createConnector();
        if (!connector.enabled) await results.setEnabled(connector.id, true);
        const input = { action, resource, payload };
        const { approval } = await results.requestApproval(connector.id, input);
        await results.decideApproval(approval.id, { decision: 'approved', confirmed: true });
        const execution = await results.execute(connector.id, { ...input, approvalId: approval.id });
        return await respond(res, 200, { ...await view(actor), publication: execution });
      }
      throw new ApiError(404, 'NOT_FOUND', 'Plugin frontend route not found.');
    } catch (error) {
      if (error.status === 413) { req.pause(); res.shouldKeepAlive = false; res.setHeader('Connection', 'close'); }
      const safe = isNativeMusePublicError(error) || error instanceof ApiError || error instanceof AccessError || error instanceof WorkerGatewayError
        || error instanceof CapabilityError || error instanceof WorkspacePluginError;
      await respond(res, safe ? error.status ?? 409 : 503, { error: { code: safe ? error.code : 'WORKSPACE_FRONTEND_UNAVAILABLE',
        message: safe ? error.message : 'The plugin request failed; inspect the same task before retrying.' } });
    } finally { completeFileRequest?.(); }
  }
  const server = http.createServer((req, res) => {
    const task = handle(req, res); pending.add(task);
    void task.catch(() => res.destroy()).finally(() => pending.delete(task));
  });
  return {
    address: () => server.address(),
    async listen(port = 0) {
      if (stopping) throw new Error('The plugin frontend is closing.');
      await new Promise((resolve, reject) => {
        const failed = error => { server.removeListener('error', failed); reject(error); };
        server.once('error', failed); server.listen(port, '127.0.0.1', () => { server.removeListener('error', failed); resolve(); });
      });
      return server.address();
    },
    close() {
      return closing ??= (async () => {
        stopping = true;
        if (server.listening) {
          const drained = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
          server.closeIdleConnections(); await drained;
        }
        await Promise.allSettled([...pending]); await access.close();
      })();
    },
  };
}
