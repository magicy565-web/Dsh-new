import test from 'node:test';
import assert from 'node:assert/strict';
import { UI_APP_JS, UI_CSS, UI_PAGE } from '../src/ui.mjs';

test('the Muse page uses only same-origin market endpoints and real labels', () => {
  assert.match(UI_PAGE, /<title>Muse · AI Worker 市场<\/title>/);
  assert.match(UI_PAGE, /\/market\/app\.js/);
  assert.match(UI_PAGE, /\/market\/app\.css/);
  assert.match(UI_CSS, /--muse-ink:#141b29/);
  assert.match(UI_CSS, /--muse-blue:#2459ea/);
  for (const endpoint of ['/api/market/status', '/api/market/workers', '/api/market/desk', '/scheme', '/activate']) {
    assert.ok(UI_APP_JS.includes(endpoint), `missing endpoint ${endpoint}`);
  }
  assert.ok(!UI_APP_JS.includes('http://'), 'no hard-coded http origin');
  assert.ok(!UI_APP_JS.includes('https://'), 'no hard-coded https origin');
  assert.match(UI_APP_JS, /还没有评价/);
  assert.match(UI_APP_JS, /预算上限是业务帽，不结算/);
  assert.match(UI_APP_JS, /画面未接入/);
  assert.doesNotThrow(() => new Function(UI_APP_JS));
});

test('the market page renders real fixtures and posts an activation', async t => {
  let JSDOM;
  try { ({ JSDOM } = await import('jsdom')); } catch { JSDOM = null; }
  if (!JSDOM) { t.skip('jsdom is not installed in this checkout'); return; }

  const listing = {
    id: 'inquiry-assistant', name: '询盘助手', category: '销售',
    summary: '把新询盘整理成可回复的草稿，不直接外发。',
    pricing: { type: 'per_task', priceLabel: '¥320 / 次' }, priceLabel: '¥320 / 次',
    defaultScale: 'light', requiresComputer: true,
    confirmActions: [{ id: 'allow-draft', label: '允许起草，不外发' }],
    featured: true, publishedAt: '2026-10-20',
    rating: { average: null, count: 0, label: '还没有评价' },
    owner: { displayName: '云上买手', avatarDesignId: 'orbit', verificationLevel: 'email_verified' },
  };
  const scheme = {
    workerId: 'inquiry-assistant', status: 'published', revision: 1, editable: false,
    name: '询盘助手', category: '销售', summary: listing.summary,
    services: [{ title: '整理询盘', detail: '当天回复一版可编辑的回复草稿，不直接外发。' }],
    doesNot: '不代替买方对外发送。', workingStyle: '接单后先回 accepted，草稿只放进 drafts。',
    contract: 'grokbot-callback-v1',
    owner: { displayName: '云上买手', avatarDesignId: 'orbit', bio: '做外贸询盘八年。', verificationLevel: 'email_verified', verificationProvider: 'stub' },
    portfolio: [], reviews: [], reviewSummary: { count: 0, average: null, label: '还没有评价' },
    pricing: { type: 'per_task', priceLabel: '¥320 / 次' }, defaultScale: 'light', requiresComputer: true,
    confirmActions: listing.confirmActions, capabilities: [], ctaLabel: '开通',
  };
  const hire = { id: 'act-1', offerId: 'inquiry-assistant', name: '询盘助手', scale: 'standard', budgetCap: 800, computers: 2 };

  const dom = new JSDOM(UI_PAGE, { url: 'http://127.0.0.1:8790/market', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.scrollTo = () => {};
  let activated = false;
  const calls = [];
  const reply = (status, payload) => ({ ok: status < 400, status, json: async () => payload });
  dom.window.fetch = async (path, options = {}) => {
    calls.push({ path: String(path), method: (options.method || 'GET').toUpperCase(), body: options.body });
    if (options.method === 'POST') {
      activated = true;
      const body = JSON.parse(options.body);
      assert.equal(body.budgetCap, 800);
      assert.equal(body.scale, 'light');
      assert.deepEqual(body.confirmActionIds, ['allow-draft']);
      return reply(201, {
        duplicate: false,
        activation: { id: 'act-1', offerId: 'inquiry-assistant', name: '询盘助手', scale: body.scale, budgetCap: body.budgetCap, computers: 2 },
        computers: [
          { id: 'act-1-pc-1', workerName: '询盘助手', label: '电脑 1', status: 'booting', task: null },
          { id: 'act-1-pc-2', workerName: '询盘助手', label: '电脑 2', status: 'booting', task: null },
        ],
      });
    }
    if (path === '/api/market/status') {
      return reply(200, {
        engineVersion: 1, source: 'demo', demo: true, runtime: 'off',
        counts: { workers: 1, activations: activated ? 1 : 0, computers: activated ? 2 : 0, needsYou: 0 },
      });
    }
    if (path === '/api/market/workers') return reply(200, { source: 'demo', total: 1, workers: [listing] });
    if (path.endsWith('/scheme')) return reply(200, { source: 'demo', scheme });
    if (path === '/api/market/desk') {
      return reply(200, activated
        ? {
            status: 'ready', source: 'demo', catalog: [listing], hires: [hire],
            instances: [
              { id: 'act-1-pc-1', workerName: '询盘助手', label: '电脑 1', status: 'booting', task: null },
              { id: 'act-1-pc-2', workerName: '询盘助手', label: '电脑 2', status: 'booting', task: null },
            ],
            requests: [],
          }
        : { status: 'empty', source: 'demo', catalog: [listing], hires: [], instances: [], requests: [] });
    }
    return reply(404, { error: { code: 'HARNESS_ROUTE_NOT_FOUND', message: 'not found' } });
  };

  const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
  dom.window.eval(UI_APP_JS);
  await tick(35);
  const root = dom.window.document.getElementById('app');
  assert.ok(root, 'app root exists');
  assert.match(root.textContent, /AI Worker 市场/);
  assert.match(root.textContent, /询盘助手/);
  assert.match(root.textContent, /还没有评价/);
  assert.match(root.textContent, /演示目录/);
  assert.match(root.textContent, /未接入/);

  const open = root.querySelector('[data-action="open"][data-id="inquiry-assistant"]');
  assert.ok(open, 'worker card is rendered');
  open.click();
  await tick(35);
  assert.match(root.textContent, /归属者/);
  assert.match(root.textContent, /不代替买方对外发送/);
  assert.match(root.textContent, /近 7 日无已授权展示的交付/);

  const form = root.querySelector('form[data-form="activate"]');
  assert.ok(form, 'activation form is rendered');
  form.querySelector('[name="budgetCap"]').value = '800';
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(60);
  assert.ok(calls.some(call => call.path === '/api/market/workers/inquiry-assistant/activate' && call.method === 'POST'), 'activation POST issued');
  assert.match(root.textContent, /工作电脑/);
  assert.match(root.textContent, /电脑 1/);
  assert.match(root.textContent, /开机中/);
  assert.match(root.textContent, /未配置/);
});
