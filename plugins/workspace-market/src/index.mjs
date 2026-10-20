// Harness plugin: Muse AI Worker 市场 + 工作电脑 desk + Muse 品牌页面。
//
// 契约来源（workspace-agent 近期分支）：
//   docs/MUSE-WORKER-MARKET.md          浏览 / 已开通 / 我的 Worker、方案页、开通
//   docs/MUSE-WORKER-DESK-API.md        电脑实例、status=booting|running|needs_you|idle、未接入画面
//   docs/GROKBOT-PERSONAL-WORKER.md     个人 Worker 状态灯（未配置时不显示假的已聘请）
//
// 本插件只做当前 harness 能真实兑现的部分：目录 + 方案页 + 开通 + desk 读取。
// 支付/结算/Provider 上架/noVNC 画面 = 未接入；demo 目录必须由组合行显式开启。
import { randomUUID } from 'node:crypto';
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import {
  BUDGET_MAX, BUDGET_MIN, DEMO_WORKERS, MARKET_STATE_VERSION, PRICING_LABEL, SCALE_COMPUTERS, SCALE_LABEL,
  SCALES, VERIFY_LABEL, computersFor, emptyMarket, normalizeMarket, publicActivation, publicComputer,
  publicListing, publicScheme, validateActivation,
} from './catalog.mjs';
import { UI_APP_JS, UI_CSS, UI_PAGE } from './ui.mjs';

const MARKET_KEY = 'harnessMarket';
const WORKER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

const ROUTES = [
  ['GET', '/api/market/status'],
  ['GET', '/api/market/workers'],
  ['GET', '/api/market/workers/:workerId/scheme'],
  ['POST', '/api/market/workers/:workerId/activate'],
  ['GET', '/api/market/activations'],
  ['GET', '/api/market/desk'],
  ['POST', '/api/market/desk/computers/:computerId/screen'],
  ['GET', '/market'],
  ['GET', '/market/app.js'],
  ['GET', '/market/app.css'],
  ['GET', '/'],
];

const ENGINE_VERSION = 1;

/** HarnessError 的 code 与 HTTP status 分开设置：status 由内核优先采用。 */
function marketError(code, message, status) {
  const error = new HarnessError(code, message);
  error.status = status;
  return error;
}

const textResponse = (body, contentType, extra = {}) => new Response(body, {
  status: 200,
  headers: { 'content-type': contentType, 'cache-control': 'no-store', ...extra },
});

const HTML_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
});

/**
 * Mount the Muse market.
 *
 * @param {object} ctx - Cordis context with `storage`, `tools`, `http` services.
 * @param {{ demo?: boolean, workspaceId?: string }} [config]
 */
export async function apply(ctx, config = {}) {
  if (!ctx?.http?.route) throw new HarnessError(ERROR.pluginMissingDependency, 'workspace-market requires ctx.http.route.');
  if (!ctx?.storage?.read || !ctx?.storage?.update) throw new HarnessError(ERROR.pluginMissingDependency, 'workspace-market requires ctx.storage.');
  if (!ctx?.tools?.register) throw new HarnessError(ERROR.pluginMissingDependency, 'workspace-market requires ctx.tools.');
  if (config === null || typeof config !== 'object' || Array.isArray(config))
    throw new HarnessError(ERROR.manifestInvalid, 'workspace-market config must be an object.');
  if (config.demo !== undefined && typeof config.demo !== 'boolean')
    throw new HarnessError(ERROR.manifestInvalid, 'workspace-market config.demo must be a boolean.');
  if (config.workspaceId !== undefined && typeof config.workspaceId !== 'string')
    throw new HarnessError(ERROR.manifestInvalid, 'workspace-market config.workspaceId must be a string.');

  const demo = config.demo === true;
  const workspaceId = config.workspaceId ?? 'local';

  function readMarket() {
    const state = ctx.storage.read() ?? {};
    return normalizeMarket(state[MARKET_KEY]);
  }

  async function writeMarket(mutator) {
    let result;
    await ctx.storage.update(state => {
      const market = normalizeMarket(state[MARKET_KEY]);
      result = mutator(market);
      state[MARKET_KEY] = market;
    });
    return result;
  }

  if (demo) {
    // 只有组合行显式 demo: true 才写入演示目录；已有任何 Worker 时不覆盖。
    await ctx.storage.update(state => {
      const current = normalizeMarket(state[MARKET_KEY]);
      if (current.workers.length > 0) return;
      state[MARKET_KEY] = {
        version: MARKET_STATE_VERSION,
        workers: structuredClone(DEMO_WORKERS),
        activations: current.activations,
        computers: current.computers,
        requests: current.requests,
      };
    });
  }

  function publishedWorkers(market) {
    return market.workers.filter(item => item.status === 'published');
  }

  function findWorker(market, workerId) {
    const item = publishedWorkers(market).find(candidate => candidate.id === workerId);
    if (!item) throw marketError('HARNESS_MARKET_WORKER_NOT_FOUND', `没有已上架的 Worker ${JSON.stringify(workerId)}。`, 404);
    return item;
  }

  function findComputer(market, computerId) {
    const item = market.computers.find(candidate => candidate.id === computerId);
    if (!item) throw marketError('HARNESS_MARKET_COMPUTER_NOT_FOUND', `没有工作电脑 ${JSON.stringify(computerId)}。`, 404);
    return item;
  }

  function statusPayload(market) {
    const workers = publishedWorkers(market);
    return {
      engineVersion: ENGINE_VERSION,
      source: demo ? 'demo' : 'workspace',
      demo,
      workspaceId,
      asOf: new Date().toISOString().slice(0, 10),
      runtime: 'off',
      counts: {
        workers: workers.length,
        activations: market.activations.length,
        computers: market.computers.length,
        needsYou: market.computers.filter(item => item.status === 'needs_you').length,
      },
    };
  }

  function deskPayload(market) {
    return {
      status: market.activations.length > 0 || market.computers.length > 0 ? 'ready' : 'empty',
      source: demo ? 'demo' : 'workspace',
      catalog: publishedWorkers(market).map(publicListing),
      hires: market.activations.map(publicActivation),
      instances: market.computers.map(publicComputer),
      requests: market.requests,
    };
  }

  /** 开通：只接受已上架 Worker；同样的 requestId 幂等返回同一条记录。 */
  async function activate(workerId, body, actor) {
    const market = readMarket();
    const item = findWorker(market, workerId);
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const invalid = validateActivation(item, input);
    if (invalid) throw marketError(invalid.code, invalid.message, invalid.status);
    const requestId = typeof input.requestId === 'string' && input.requestId.trim() ? input.requestId.trim() : null;
    if (requestId) {
      const existing = market.activations.find(entry => entry.requestId === requestId);
      if (existing) {
        return {
          duplicate: true,
          activation: publicActivation(existing),
          computers: market.computers.filter(computer => computer.hireId === existing.id).map(publicComputer),
        };
      }
    }
    const activationId = `act-${randomUUID()}`;
    const count = item.requiresComputer === false ? 0 : SCALE_COMPUTERS[input.scale];
    const activation = {
      id: activationId,
      offerId: item.id,
      name: item.name,
      scale: input.scale,
      budgetCap: input.budgetCap,
      computers: count,
      confirmActionIds: [...(input.confirmActionIds ?? [])],
      requestId,
      createdAt: new Date().toISOString(),
      actor: actor?.subject ?? null,
      workspaceId,
    };
    const computers = computersFor(activationId, item.name, count);
    await writeMarket(next => {
      next.activations.push(activation);
      next.computers.push(...computers);
    });
    return { duplicate: false, activation: publicActivation(activation), computers: computers.map(publicComputer) };
  }

  // ---------------------------------------------------------------- routes
  for (const [method, path] of ROUTES) {
    if (path.startsWith('/market') || path === '/') continue; // static responses below
    ctx.http.route({ method, path, handler: marketHandler(method, path) });
  }

  function marketHandler(method, path) {
    if (method === 'GET' && path === '/api/market/status') {
      return async () => ({ status: 200, body: statusPayload(readMarket()) });
    }
    if (method === 'GET' && path === '/api/market/workers') {
      return async (_req, _res, context) => {
        const market = readMarket();
        const query = String(context?.query?.q ?? '').trim().toLowerCase();
        const category = String(context?.query?.category ?? '').trim();
        const rows = publishedWorkers(market).filter(item => {
          if (category && category !== '全部' && item.category !== category) return false;
          if (!query) return true;
          return `${item.name} ${item.summary ?? ''} ${item.category ?? ''} ${item.does ?? ''}`.toLowerCase().includes(query);
        });
        return { status: 200, body: { source: demo ? 'demo' : 'workspace', total: rows.length, workers: rows.map(publicListing) } };
      };
    }
    if (method === 'GET' && path === '/api/market/workers/:workerId/scheme') {
      return async (_req, _res, context) => {
        const workerId = context?.params?.workerId;
        if (!WORKER_ID.test(workerId ?? '')) throw marketError('HARNESS_MARKET_WORKER_NOT_FOUND', 'Invalid Worker id.', 404);
        const market = readMarket();
        const item = findWorker(market, workerId);
        return { status: 200, body: { source: demo ? 'demo' : 'workspace', scheme: publicScheme(item) } };
      };
    }
    if (method === 'POST' && path === '/api/market/workers/:workerId/activate') {
      return async (_req, _res, context) => {
        const workerId = context?.params?.workerId;
        if (!WORKER_ID.test(workerId ?? '')) throw marketError('HARNESS_MARKET_WORKER_NOT_FOUND', 'Invalid Worker id.', 404);
        const result = await activate(workerId, context?.body, context?.actor);
        return { status: result.duplicate ? 200 : 201, body: result };
      };
    }
    if (method === 'GET' && path === '/api/market/activations') {
      return async () => {
        const market = readMarket();
        return { status: 200, body: { source: demo ? 'demo' : 'workspace', activations: market.activations.map(publicActivation) } };
      };
    }
    if (method === 'GET' && path === '/api/market/desk') {
      return async () => ({ status: 200, body: deskPayload(readMarket()) });
    }
    if (method === 'POST' && path === '/api/market/desk/computers/:computerId/screen') {
      return async (_req, _res, context) => {
        const market = readMarket();
        findComputer(market, context?.params?.computerId);
        // MUSE_COMPUTER_RUNTIME=off：不生成 URL，也不编造一块假画面。
        throw marketError(
          'COMPUTER_SCREEN_UNAVAILABLE',
          '画面未接入：MUSE_COMPUTER_RUNTIME=off。只在 noVNC 端口应答后才返回本机画面地址。',
          409,
        );
      };
    }
    throw new HarnessError(ERROR.pluginFailed, `workspace-market did not register ${method} ${path}.`);
  }

  // 静态页面：Muse 品牌 + 市场 UI（无构建步骤，由本插件直接返回）。
  ctx.http.route({
    method: 'GET', path: '/',
    handler: async () => new Response(null, { status: 302, headers: { location: '/market', 'cache-control': 'no-store' } }),
  });
  ctx.http.route({
    method: 'GET', path: '/market',
    handler: async () => textResponse(UI_PAGE, 'text/html; charset=utf-8', HTML_HEADERS),
  });
  ctx.http.route({
    method: 'GET', path: '/market/app.js',
    handler: async () => textResponse(UI_APP_JS, 'text/javascript; charset=utf-8'),
  });
  ctx.http.route({
    method: 'GET', path: '/market/app.css',
    handler: async () => textResponse(UI_CSS, 'text/css; charset=utf-8'),
  });

  // ----------------------------------------------------------------- tools
  ctx.tools.register({
    name: 'market_workers',
    description: 'List published AI Workers in the Muse market: id, name, category, one-line summary, pricing label and the owner verification level. No ratings are invented and no private owner fields are returned.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', maxLength: 120, description: 'Optional substring over name, summary and category.' },
        category: { type: 'string', maxLength: 40, description: 'Optional exact category; omit or 全部 for all.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum cards to return; defaults to 10.' },
      },
      additionalProperties: false,
    },
    approval: 'never',
    readOnly: true,
    authority: 'workspace',
    handler: async args => {
      const market = readMarket();
      const needle = String(args?.q ?? '').trim().toLowerCase();
      const category = String(args?.category ?? '').trim();
      const rows = publishedWorkers(market).filter(item => {
        if (category && category !== '全部' && item.category !== category) return false;
        if (!needle) return true;
        return `${item.name} ${item.summary ?? ''} ${item.category ?? ''}`.toLowerCase().includes(needle);
      });
      const limit = args?.limit ?? 10;
      return {
        source: demo ? 'demo' : 'workspace',
        total: rows.length,
        workers: rows.slice(0, limit).map(item => ({
          id: item.id, name: item.name, category: item.category, summary: item.summary,
          priceLabel: item.pricing?.priceLabel ?? '面议', pricing: item.pricing?.type ?? 'per_task',
          owner: item.owner?.displayName ?? null, verification: item.owner?.verificationLevel ?? 'unverified',
        })),
        omitted: Math.max(0, rows.length - limit),
      };
    },
  });

  ctx.tools.register({
    name: 'market_desk',
    description: 'Read the Muse work-computer desk: activations (scale, business budget cap, computer count) and computer instances with their real status (booting/running/needs_you/idle). Screens are unavailable while MUSE_COMPUTER_RUNTIME=off, so no screen URLs are returned.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    approval: 'never',
    readOnly: true,
    authority: 'workspace',
    handler: async () => {
      const market = readMarket();
      const desk = deskPayload(market);
      return {
        status: desk.status,
        source: desk.source,
        hires: desk.hires.map(item => ({ id: item.id, offerId: item.offerId, name: item.name, scale: item.scale, budgetCap: item.budgetCap, computers: item.computers })),
        instances: desk.instances,
        runtime: 'off',
      };
    },
  });

  ctx.tools.register({
    name: 'market_activate_worker',
    description: 'Activate one published AI Worker and create its work computers. The budget cap is a business cap only and is never charged. Requires a one-shot approval ticket for this exact tool; a duplicate requestId returns the same activation instead of creating another one.',
    parameters: {
      type: 'object',
      properties: {
        workerId: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$', description: 'Published Worker id.' },
        scale: { type: 'string', enum: ['light', 'standard', 'fast'], description: 'Work scale: 1 / 2 / 4 computers.' },
        budgetCap: { type: 'integer', minimum: BUDGET_MIN, maximum: BUDGET_MAX, description: 'Integer business budget cap; never settled.' },
        confirmActionIds: { type: 'array', description: 'Subset of this Worker confirm-action ids.' },
        requestId: { type: 'string', maxLength: 120, description: 'Optional idempotency key.' },
      },
      required: ['workerId', 'scale', 'budgetCap'],
      additionalProperties: false,
    },
    approval: 'always',
    authority: 'workspace',
    handler: async (args, execution) => {
      const result = await activate(args.workerId, {
        scale: args.scale,
        budgetCap: args.budgetCap,
        confirmActionIds: Array.isArray(args.confirmActionIds) ? args.confirmActionIds : [],
        requestId: args.requestId,
      }, execution?.actor);
      return {
        duplicate: result.duplicate,
        activation: result.activation,
        computers: result.computers,
        scaleLabel: SCALE_LABEL[result.activation.scale],
        note: '预算上限是业务帽，不会结算；电脑在 MUSE_COMPUTER_RUNTIME=off 时停在 booting。',
      };
    },
  });

  if (ctx.health?.register) {
    ctx.health.register('market', () => {
      const market = readMarket();
      const count = publishedWorkers(market).length;
      return {
        status: count > 0 || demo ? 'ok' : 'degraded',
        detail: { source: demo ? 'demo' : 'workspace', workers: count, computers: market.computers.length, runtime: 'off' },
      };
    });
  }

  return async () => {
    // 路由、工具与健康检查由内核按插件生命周期移除。
  };
}

export default { apply };
