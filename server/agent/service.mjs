import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentHttpError, createAgentAuth } from './auth.mjs';
import { openAgentStore, artifactNameValid, TERMINAL_STATUSES } from './store.mjs';
import { createAgentCoordinator } from './engine.mjs';
import { loadPresets, listPresets, getPreset, validateTaskInput } from './presets.mjs';
import { renderInstall, pluginManifest } from './install.mjs';

export const AGENT_VERSION = '1.1.0-pi';
export const AGENT_API_BASE = '/api/agent/v1';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicPaths = new Set(['/health', '/install', '/plugin/manifest.json', '/plugin/client.py']);
const commonHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const integerSetting = (value, fallback, min, max, name) => {
  const number = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return number;
};

async function json(res, status, value) {
  await res.accessFinish?.(status);
  res.writeHead(status, { ...commonHeaders, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
async function text(res, status, value, headers = {}) {
  await res.accessFinish?.(status);
  res.writeHead(status, { ...commonHeaders, 'Content-Type': 'text/plain; charset=utf-8', ...headers }); res.end(value);
}
function decodeSegment(value) {
  try { const decoded = decodeURIComponent(value); if (!decoded || /[\x00-\x1f/\\]/.test(decoded)) throw new Error(); return decoded; }
  catch { throw new AgentHttpError(400, '无效的路径参数。'); }
}
function parseCursor(req, query) {
  const raw = query.get('from') ?? req.headers['last-event-id'] ?? '0';
  if (typeof raw !== 'string' || !/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    throw new AgentHttpError(400, 'from 必须是非负整数序号。');
  return Number(raw);
}
async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new AgentHttpError(400, '请求必须使用 application/json。');
  if (Number(req.headers['content-length']) > 100_000) throw new AgentHttpError(400, '请求内容不能超过 100000 字节。');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 100_000) throw new AgentHttpError(400, '请求内容不能超过 100000 字节。'); chunks.push(chunk); }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new AgentHttpError(400, '请求必须是有效 JSON。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentHttpError(400, '请求必须是 JSON 对象。');
  return value;
}

/** Host is reflected only after parsing and, optionally, checking the operator allowlist. */
export function requestOrigin(req, env = {}) {
  const proxy = env.WS_AGENT_TRUST_PROXY === '1';
  let host = proxy && req.headers['x-forwarded-host'] ? req.headers['x-forwarded-host'] : req.headers.host;
  const forwardedProto = proxy && req.headers['x-forwarded-proto'];
  if (typeof host !== 'string' || host.length > 255 || !/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[a-f0-9:]+\])(?::[0-9]{1,5})?$/i.test(host))
    throw new AgentHttpError(400, '无效的请求 Host。');
  const protocol = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
  if (!['http', 'https'].includes(protocol)) throw new AgentHttpError(400, '无效的代理协议。');
  let parsed;
  try { parsed = new URL(`${protocol}://${host}`); }
  catch { throw new AgentHttpError(400, '无效的请求 Host。'); }
  const allowed = (env.WS_AGENT_ALLOWED_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(parsed.host.toLowerCase())) throw new AgentHttpError(400, '请求 Host 不在部署允许列表中。');
  return parsed.origin;
}

export async function createAgentService({ env = process.env, dataDir, principals, workspaceStore, runtime, provider, access } = {}) {
  const auth = createAgentAuth({ principals, env, access });
  const presets = await loadPresets({ directory: env.WS_AGENT_PRESETS_DIR || path.join(root, 'presets/agent') });
  const store = await openAgentStore(path.resolve(dataDir || env.WS_AGENT_DATA || path.join(root, '.data/agent')));
  let engine;
  try { engine = await createAgentCoordinator({ store: workspaceStore, runtime, provider, projection: store, auth, env }); }
  catch (error) { await store.close(); throw error; }
  const streams = new Set(); let closing = false, closePromise;
  const mode = engine.demo ? 'demo' : 'model';
  const health = () => ({ status: closing ? 'stopping' : 'ok', version: AGENT_VERSION, mode, model: mode === 'model' ? provider.model || null : null,
    presets: listPresets(presets), configured: auth.configured, runtime: 'pi-durable', authority: 'workspace-store',
    readiness: engine.demo ? 'demo' : provider.kind === 'pi-durable' && provider.configured ? 'configured_unverified' : 'unconfigured',
    research_capabilities: provider.researchCapabilities || [], projection: engine.readiness() });

  async function stream(res, taskId, from, actor) {
    let cursor = from, draining = false, again = false, ended = false;
    let heartbeat, unsubscribe = () => {}, accessWatch;
    const cleanup = () => { if (ended) return; ended = true; clearInterval(heartbeat); unsubscribe(); accessWatch?.stop(); streams.delete(res); };
    const drain = () => {
      if (ended || res.destroyed || closing) return;
      if (accessWatch && !accessWatch.valid()) { res.end(); cleanup(); return; }
      if (draining) { again = true; return; }
      draining = true;
      try {
        do {
          again = false;
          const batch = store.events(taskId, cursor, 256);
          for (const event of batch) {
            if (res.destroyed || res.writableLength > 128_000) { res.destroy(); return; }
            res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
            cursor = event.seq;
          }
          if (batch.length === 256) again = true;
          else if (TERMINAL_STATUSES.has(store.getInternalTask(taskId)?.status)) { res.end(); cleanup(); return; }
        } while (again && !ended);
      } catch { res.destroy(); cleanup(); }
      finally { draining = false; }
    };
    // Register before the first database read: notifications are only wakeups, never event data.
    unsubscribe = store.subscribe(taskId, drain);
    res.on('close', cleanup); streams.add(res);
    accessWatch = auth.watchStream(actor, () => { res.end(); cleanup(); });
    await res.accessFinish?.(200);
    res.writeHead(200, { ...commonHeaders, 'Content-Type': 'text/event-stream; charset=utf-8', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    heartbeat = setInterval(() => { if (!ended) { if (res.writableLength > 128_000) res.destroy(); else res.write(': heartbeat\n\n'); } }, 15000);
    heartbeat.unref(); drain();
  }

  async function handle(req, res) {
    const raw = (req.url || '/').split('?')[0].replace(/\/$/, '') || '/';
    const isApi = raw === AGENT_API_BASE || raw.startsWith(AGENT_API_BASE + '/');
    const endpoint = isApi ? raw.slice(AGENT_API_BASE.length) || '/' : raw;
    if (!isApi && !['/install', '/plugin/manifest.json', '/plugin/client.py'].includes(endpoint)) return false;
    try {
      if (closing) throw new AgentHttpError(503, '服务正在停止，请稍后重试。');
      if (req.method === 'GET' && publicPaths.has(endpoint)) {
        if (endpoint === '/health') { await json(res, 200, health()); return true; }
        const origin = requestOrigin(req, env);
        if (endpoint === '/install') await text(res, 200, renderInstall(origin));
        else if (endpoint === '/plugin/manifest.json') await json(res, 200, pluginManifest(origin, listPresets(presets), AGENT_VERSION));
        else await text(res, 200, await readFile(path.join(root, 'client/ws_client.py'), 'utf8'), { 'Content-Disposition': 'attachment; filename="ws_client.py"' });
        return true;
      }
      const actor = await auth.authenticate(req, res, AGENT_API_BASE + endpoint);
      const query = new URL(req.url, 'http://localhost').searchParams;
      if (req.method === 'GET' && endpoint === '/presets') { await json(res, 200, listPresets(presets)); return true; }
      if (req.method === 'POST' && endpoint === '/tasks') {
        const body = await readJson(req);
        if (typeof body.type !== 'string' || !getPreset(body.type, presets))
          throw new AgentHttpError(400, '未知任务类型，请选择可用预设。', { presets: listPresets(presets) });
        if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 300 || /[\x00-\x08\x0b-\x1f]/.test(body.title))
          throw new AgentHttpError(400, 'title 必须是 1–300 字符的任务标题。');
        if (Object.keys(body).some(key => !['type', 'title', 'input'].includes(key))) throw new AgentHttpError(400, '请求只允许 type、title、input 字段。');
        const preset = getPreset(body.type, presets);
        try { validateTaskInput(preset, body.input); }
        catch { throw new AgentHttpError(400, `input 字段不合法；必填字段：${preset.required_inputs.join('、')}。`); }
        const { task: created, duplicate } = await engine.submit({ actor, preset, title: body.title, input: body.input, requestKey: req.headers['idempotency-key'] });
        res.setHeader('Idempotency-Key', created.requestKey);
        res.setHeader('Idempotency-Replayed', duplicate ? 'true' : 'false');
        await json(res, 201, { taskId: created.id, status: created.status, events_url: AGENT_API_BASE + '/tasks/' + created.id + '/events', request_key: created.requestKey, result: created.result });
        return true;
      }
      const lookup = endpoint.match(/^\/tasks\/by-request\/([^/]+)$/);
      if (req.method === 'GET' && lookup) {
        const found = engine.byRequest(decodeSegment(lookup[1]), actor);
        if (!found) throw new AgentHttpError(404, '任务不存在。');
        await engine.project(found.id); await json(res, 200, store.getTask(found.id, actor)); return true;
      }
      const resume = endpoint.match(/^\/tasks\/([^/]+)\/resume$/);
      if (req.method === 'POST' && resume) {
        const body = await readJson(req);
        if (Object.keys(body).length) throw new AgentHttpError(400, '恢复原任务不能更改输入、模型或权限。');
        const resumed = await engine.resume(decodeSegment(resume[1]), actor);
        await engine.project(resumed.id); await json(res, 200, store.getTask(resumed.id, actor)); return true;
      }
      const match = endpoint.match(/^\/tasks\/([^/]+)(?:\/(events|artifacts)(?:\/([^/]+))?)?$/);
      if (!match || req.method !== 'GET') throw new AgentHttpError(404, '任务或接口不存在。');
      const taskId = decodeSegment(match[1]);
      if (!engine.find(taskId, actor)) throw new AgentHttpError(404, '任务不存在。');
      await engine.project(taskId);
      const task = store.getTask(taskId, actor);
      if (!match[2]) { await json(res, 200, task); return true; }
      if (match[2] === 'events' && !match[3]) {
        const from = parseCursor(req, query);
        const format = query.get('format');
        if (format && format !== 'json') throw new AgentHttpError(400, 'format 只支持 json，省略时返回 SSE。');
        if (format === 'json') await json(res, 200, store.events(taskId, from));
        else await stream(res, taskId, from, actor);
        return true;
      }
      if (match[2] === 'artifacts') {
        if (!match[3]) { await json(res, 200, store.listArtifacts(taskId)); return true; }
        const name = decodeSegment(match[3]);
        if (!artifactNameValid(name)) throw new AgentHttpError(400, '无效的产物文件名。');
        let artifact;
        try { artifact = await store.readArtifact(taskId, name); }
        catch { throw new AgentHttpError(404, '产物不存在或完整性校验未通过。'); }
        if (!artifact) throw new AgentHttpError(404, '产物不存在。');
        await res.accessFinish?.(200);
        res.writeHead(200, { ...commonHeaders, 'Content-Type': name.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'application/octet-stream',
          'Content-Length': artifact.bytes, 'Content-Disposition': `attachment; filename="${name}"` });
        res.end(artifact.data); return true;
      }
      throw new AgentHttpError(404, '任务或接口不存在。');
    } catch (error) {
      if (res.headersSent) res.destroy();
      else if (error instanceof AgentHttpError) await json(res, error.status, { error: error.message, ...error.extra });
      else if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) await json(res, error.status, { error: error.message, code: error.code });
      else await json(res, 500, { error: '服务无法完成请求，请检查服务状态后重试。' });
      await auth.recordDenial(error).catch(() => {});
      // Never log request bodies, Authorization, or raw model/transport errors.
      return true;
    }
  }
  return { handle, store, engine, presets, health,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => { for (const res of streams) res.end(); await engine.close(); await store.close(); })();
      return closePromise;
    },
  };
}
