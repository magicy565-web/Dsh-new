// Harness plugin: conversations, runs and their event stream.
//
// This plugin owns the chat substrate only. It never calls a model, never runs
// a tool and never approves anything: a future runner advances runs through
// service.advance() and writes assistant messages through service.appendMessage().
// Everything else (context, approvals, artifacts) addresses a run by id.
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { ChatError, TERMINAL_STATUSES, createChatService } from './domain.mjs';
import { AREA_PATH, renderChatPage } from './area.mjs';

export const PLUGIN_ID = 'workspace-chat';
const BASE = '/api/chat';
const TERMINAL_EVENTS = new Set(['run.completed', 'run.failed', 'run.cancelled']);
const HEARTBEAT_MS = 15_000;

export const ROUTES = Object.freeze([
  ['GET', `${BASE}/status`],
  ['GET', `${BASE}/skills`],
  ['POST', `${BASE}/conversations`],
  ['GET', `${BASE}/conversations`],
  ['GET', `${BASE}/conversations/:id`],
  ['POST', `${BASE}/conversations/:id/messages`],
  ['GET', `${BASE}/runs/:id`],
  ['POST', `${BASE}/runs/:id/cancel`],
  ['GET', `${BASE}/runs/:id/events`],
  ['GET', `${BASE}/conversations/:id/approvals`],
  ['POST', `${BASE}/approvals/:id`],
  ['GET', AREA_PATH],
]);

const manifestError = message => new HarnessError(ERROR.manifestInvalid, message);
const missing = service => new HarnessError(ERROR.pluginMissingDependency, `${PLUGIN_ID} requires ctx.${service}.`);

function asHarnessError(error) {
  if (error instanceof HarnessError) return error;
  if (error instanceof ChatError) {
    const wrapped = new HarnessError(error.code, error.message);
    wrapped.status = error.status;
    return wrapped;
  }
  return error;
}

function frame(event) {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * @param {object} ctx Cordis context with storage/http/health
 * @param {{workspaceId?: string}} [config]
 */
export async function apply(ctx, config = {}) {
  if (!ctx?.http?.route) throw missing('http');
  if (!ctx?.storage?.read || !ctx?.storage?.update) throw missing('storage');
  if (config === null || typeof config !== 'object' || Array.isArray(config))
    throw manifestError(`${PLUGIN_ID} config must be an object.`);
  if (Object.keys(config).some(key => !['workspaceId'].includes(key)))
    throw manifestError(`${PLUGIN_ID} config has an unsupported field.`);
  if (config.workspaceId !== undefined && (typeof config.workspaceId !== 'string' || !config.workspaceId))
    throw manifestError('config.workspaceId must be a non-empty string.');
  const workspaceId = config.workspaceId ?? 'local';
  const resolveWorkspace = typeof ctx.workspace?.resolve === 'function'
    ? actor => {
      const resolved = ctx.workspace.resolve(actor);
      return { workspaceId: resolved.workspaceId, subject: resolved.subject, role: resolved.role };
    }
    : null;
  const notify = typeof ctx.get === 'function'
    ? item => {
      const inbox = ctx.get('inbox', false);
      if (!inbox || typeof inbox.push !== 'function') return Promise.resolve();
      return inbox.push({ actor: { subject: 'service:chat', role: 'operator', workspaceId }, trustedService: true }, item);
    }
    : null;
  const service = createChatService({
    storage: ctx.storage,
    workspaceId,
    resolveWorkspace,
    audit: ctx.audit ?? null,
    notify,
  });

  const call = handler => async (_req, _res, context) => {
    try { return await handler(context ?? {}); }
    catch (error) { throw asHarnessError(error); }
  };

  ctx.http.route({ method: 'GET', path: `${BASE}/status`, handler: call(context => ({ status: 200, body: service.status(context) })) });

  // The skill library is owned by the skills seam; this route only exposes the
  // summaries a person may attach to a message. Bodies never leave the server
  // through this endpoint.
  ctx.http.route({
    method: 'GET', path: `${BASE}/skills`,
    handler: call(context => {
      service.status(context); // authorisation only
      let items = [];
      try {
        const skills = ctx.get('skills', false);
        const listed = skills?.list ? skills.list() : [];
        items = listed.map(skill => ({
          name: skill.name, description: skill.description, pluginId: skill.pluginId ?? null, bytes: skill.bytes ?? 0,
        }));
      } catch { items = []; }
      return { status: 200, body: { total: items.length, items } };
    }),
  });

  ctx.http.route({
    method: 'POST', path: `${BASE}/conversations`,
    handler: call(async context => ({ status: 201, body: await service.createConversation(context, context.body ?? {}) })),
  });

  ctx.http.route({
    method: 'GET', path: `${BASE}/conversations`,
    handler: call(context => ({ status: 200, body: service.listConversations(context, context.query ?? {}) })),
  });

  ctx.http.route({
    method: 'GET', path: `${BASE}/conversations/:id`,
    handler: call(context => ({ status: 200, body: service.readConversation(context, context.params?.id, context.query ?? {}) })),
  });

  ctx.http.route({
    method: 'POST', path: `${BASE}/conversations/:id/messages`,
    handler: call(async context => ({ status: 201, body: await service.postMessage(context, context.params?.id, context.body ?? {}) })),
  });

  ctx.http.route({
    method: 'GET', path: `${BASE}/runs/:id`,
    handler: call(context => ({ status: 200, body: { run: service.readRun(context, context.params?.id) } })),
  });

  ctx.http.route({
    method: 'POST', path: `${BASE}/runs/:id/cancel`,
    handler: call(async context => ({ status: 200, body: await service.cancelRun(context, context.params?.id, context.body ?? {}) })),
  });

  // Server-sent events: replay what the client missed, then follow the run
  // until it reaches a terminal state. A reconnecting client only needs its
  // last event id (`?after=`), so a dropped connection never loses history.
  ctx.http.route({
    method: 'GET', path: `${BASE}/runs/:id/events`,
    handler: (request, _response, context) => {
      let initial;
      let after = 0;
      try {
        after = Number(context?.query?.after ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) throw new ChatError(400, 'CHAT_INPUT', 'after must be a non-negative event sequence.');
        initial = service.readEvents(context ?? {}, context?.params?.id, after);
      } catch (error) {
        throw asHarnessError(error);
      }
      const { run, events } = initial;
      const encoder = new TextEncoder();
      let cleanup = () => {};
      return new Response(new ReadableStream({
        start(controller) {
          let closed = false;
          let unsubscribe = null;
          let heartbeat = null;
          const finish = () => {
            if (closed) return;
            closed = true;
            unsubscribe?.();
            if (heartbeat) clearInterval(heartbeat);
            try { controller.close(); } catch { /* already closed by the client */ }
          };
          cleanup = finish;
          const write = event => {
            if (closed) return;
            try { controller.enqueue(encoder.encode(frame(event))); } catch { finish(); }
          };
          for (const event of events) write(event);
          if (run.terminal) { finish(); return; }
          let lastSeq = events.length ? events[events.length - 1].seq : after;
          unsubscribe = service.subscribe(run.id, event => {
            // A subscriber can attach just as an event is committed; replay and
            // the live feed may therefore describe the same sequence. Send it once.
            if (event.seq <= lastSeq) return;
            lastSeq = event.seq;
            write(event);
            if (TERMINAL_EVENTS.has(event.type)) finish();
          });
          heartbeat = setInterval(() => {
            if (closed) return;
            try { controller.enqueue(encoder.encode(': keep-alive\n\n')); } catch { finish(); }
          }, HEARTBEAT_MS);
          heartbeat.unref?.();
          request?.once?.('close', finish);
        },
        cancel() {
          // The client left: the kernel cancels this stream, so stop following.
          cleanup();
        },
      }), {
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store, no-transform',
          'x-accel-buffering': 'no',
        },
      });
    },
  });

  ctx.http.route({
    method: 'GET', path: `${BASE}/conversations/:id/approvals`,
    handler: call(context => ({
      status: 200,
      body: service.listApprovals(context, { ...(context.query ?? {}), conversationId: context.params?.id }),
    })),
  });

  ctx.http.route({
    method: 'POST', path: `${BASE}/approvals/:id`,
    handler: call(async context => ({
      status: 200,
      body: { approval: await service.decideApproval(context, context.params?.id, context.body ?? {}) },
    })),
  });

  ctx.http.route({
    method: 'GET', path: AREA_PATH,
    handler: async (_request, _response, context) => {
      try {
        // Resolve the actor before serving the page: a caller outside this
        // workspace must not even get the shell.
        service.status(context ?? {});
        return renderChatPage();
      } catch (error) { throw asHarnessError(error); }
    },
  });

  let disposeService = null;
  if (typeof ctx.provide === 'function') disposeService = ctx.provide('chat', service);
  if (ctx.health?.register) {
    ctx.health.register('chat', () => {
      const value = service.status({});
      return { status: 'ok', detail: { workspaceId: value.workspaceId, conversations: value.conversations, activeRuns: value.activeRuns } };
    });
  }
  return async () => { if (typeof disposeService === 'function') await disposeService(); };
}

export { ChatError, TERMINAL_STATUSES };
export default { apply };
