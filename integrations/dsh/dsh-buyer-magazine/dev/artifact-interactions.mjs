// Optional developer-only DOM simulation. Never part of runtime or default Node-only tests.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compileDraft, validateIssueJson } from '../compiler.js';
import { makeIssue, NOW } from './synthetic-interaction-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--dependency-root' || !path.isAbsolute(args[1]))) {
  throw new Error('Usage: node dev/artifact-interactions.mjs [--dependency-root /absolute/existing/repo]. No dependencies are installed.');
}
const require = args.length ? createRequire(path.join(args[1], 'package.json')) : createRequire(import.meta.url);
let JSDOM, VirtualConsole, requestInterceptor;
try { ({ JSDOM, VirtualConsole, requestInterceptor } = require('jsdom')); }
catch { throw new Error('Optional DOM audit requires the repository existing jsdom devDependency. Run from its checkout or pass --dependency-root /absolute/existing/repo. No install is attempted.'); }
if (typeof requestInterceptor !== 'function') throw new Error('This optional DOM audit requires the existing jsdom 29 requestInterceptor API. No install is attempted.');
const sha = value => createHash('sha256').update(value).digest('hex');
function snapshot(dir, prefix = '') {
  const out = {};
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.name === 'node_modules') continue;
    const name = path.join(prefix, item.name);
    if (item.isDirectory()) Object.assign(out, snapshot(path.join(dir, item.name), name));
    else if (item.isFile()) out[name] = sha(readFileSync(path.join(dir, item.name)));
  }
  return out;
}
const before = snapshot(pkg);
const originalClient = readFileSync(path.join(pkg, 'upstream/assets/magazine.js'), 'utf8');
const results = [], sessions = [];
function test(name, fn) {
  try { fn(); results.push({ name, status: 'pass' }); }
  catch (error) { results.push({ name, status: 'fail', error: error.message }); }
}
function compile(issue) {
  const json = JSON.stringify(issue);
  assert.equal(validateIssueJson(json, { now: NOW }).valid, true);
  return compileDraft(json, { now: NOW });
}

// Only host APIs that jsdom cannot supply are synthetic captures. The emitted
// application JS is extracted from compiled HTML, byte-checked and evaluated
// unchanged. No fake application state, render function or click handler is used.
function load(draft, { stored, denyStorage = false, opaqueOrigin = false } = {}) {
  const requests = [], downloads = [], revocations = [], scrolls = [], errors = [], timers = new Map(), blobs = new Map();
  let timerId = 0;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(draft.data.toString('utf8'), {
    url: opaqueOrigin ? 'about:blank' : 'https://example.com/offline-audit/', runScripts: 'outside-only',
    resources: { interceptors: [requestInterceptor(request => {
      requests.push({ api: 'resource-interceptor', url: request.url });
      return new Response('Blocked synthetic offline request', { status: 451 });
    })] }, virtualConsole,
  });
  const w = dom.window, d = w.document;
  const deny = api => (...args) => { requests.push({ api, args: args.map(String) }); throw new Error(`Blocked offline API: ${api}`); };
  w.fetch = deny('fetch');
  w.XMLHttpRequest.prototype.open = deny('xhr.open');
  w.XMLHttpRequest.prototype.send = deny('xhr.send');
  w.WebSocket = function (...args) { return deny('WebSocket')(...args); };
  w.EventSource = function (...args) { return deny('EventSource')(...args); };
  w.navigator.sendBeacon = deny('sendBeacon');
  w.open = deny('window.open');
  w.HTMLFormElement.prototype.submit = deny('form.submit');
  w.HTMLFormElement.prototype.requestSubmit = deny('form.requestSubmit');
  w.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
  w.clearTimeout = id => timers.delete(id);
  w.requestAnimationFrame = callback => { callback(0); return 1; };
  w.matchMedia = query => ({ matches: true, media: query });
  w.HTMLElement.prototype.scrollIntoView = function (options) { scrolls.push({ id: this.id, source: this.dataset.sourceRecord, options }); };
  w.Blob = class SyntheticBlob {
    constructor(parts, options) { this.parts = parts.map(String); this.type = options?.type || ''; this.text = this.parts.join(''); }
  };
  w.URL.createObjectURL = blob => { const url = `blob:synthetic-audit-${blobs.size + 1}`; blobs.set(url, blob); return url; };
  w.URL.revokeObjectURL = url => { revocations.push(url); blobs.delete(url); };
  w.HTMLAnchorElement.prototype.click = function () {
    if (this.download && blobs.has(this.href)) {
      const blob = blobs.get(this.href);
      downloads.push({ filename: this.download, href: this.href, mime: blob.type, text: blob.text });
    } else requests.push({ api: 'anchor-navigation-blocked', url: this.href });
  };
  // Stop dispatched link events too. Source drawer buttons are not intercepted.
  d.addEventListener('click', event => {
    const a = event.target.closest?.('a');
    if (a && !a.download) { event.preventDefault(); requests.push({ api: 'anchor-event-blocked', url: a.href }); }
  }, true);
  const key = `buyer-magazine:shortlist:v1:${JSON.parse(d.getElementById('issue-data').textContent).id}`;
  if (stored !== undefined) w.localStorage.setItem(key, typeof stored === 'string' ? stored : JSON.stringify(stored));
  if (denyStorage) Object.defineProperty(w, 'localStorage', { get() { throw new w.DOMException('Synthetic storage denial', 'SecurityError'); } });
  const scripts = [...d.scripts].filter(s => s.type !== 'application/json');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].textContent, originalClient, 'Emitted inline application JS must remain byte-identical to the attributed packaged asset');
  w.eval(scripts[0].textContent);
  const session = { dom, w, d, key, requests, downloads, revocations, scrolls, errors, timers,
    click(selector) { const el = d.querySelector(selector); assert.ok(el, selector); el.click(); return el; },
    ids() { return [...d.querySelectorAll('[data-save][aria-pressed="true"]')].map(el => el.dataset.save); },
    count() { return Number(d.querySelector('[data-count]').textContent); },
  };
  sessions.push(session); return session;
}

const issue = makeIssue(), draft = compile(issue);
test('Compile complete source-backed synthetic issue through public compiler', () => {
  assert.equal(draft.productCount, 4); assert.equal(draft.sourceCount, 4);
  assert.equal(draft.externalImageCount, 0); assert.equal(draft.draftOnly, true);
});
test('Initial shortlist is empty, comparison disabled, dock hidden', () => {
  const s = load(draft); assert.equal(s.count(), 0); assert.equal(s.d.querySelector('[data-compare]').disabled, true);
  assert.equal(s.d.getElementById('shortlist-dock').hidden, true); assert.equal(s.w.localStorage.getItem(s.key), '[]');
});
test('Save/remove updates label, aria state, counter, dock and stored IDs', () => {
  const s = load(draft), selector = '[data-save="audit-retail"]';
  const button = s.click(selector); assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.querySelector('[data-save-label]').textContent, 'Saved');
  assert.equal(button.querySelector('[data-save-mark]').textContent, '✓'); assert.equal(s.count(), 1);
  assert.equal(s.d.getElementById('shortlist-dock').hidden, false);
  assert.deepEqual(JSON.parse(s.w.localStorage.getItem(s.key)), ['audit-retail']);
  s.click(selector); assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.querySelector('[data-save-label]').textContent, 'Shortlist'); assert.equal(s.count(), 0);
  assert.equal(s.d.getElementById('shortlist-dock').hidden, true);
});
test('Three-product limit rejects fourth, then permits replacement after removal', () => {
  const s = load(draft); issue.products.forEach(p => s.click(`[data-save="${p.id}"]`));
  assert.equal(s.count(), 3); assert.deepEqual(s.ids(), issue.products.slice(0, 3).map(p => p.id));
  assert.match(s.d.getElementById('toast').textContent, /holds three products/);
  assert.equal(s.d.querySelector('[data-save="audit-unknown"]').getAttribute('aria-pressed'), 'false');
  s.click('[data-save="audit-retail"]'); s.click('[data-save="audit-unknown"]');
  assert.equal(s.count(), 3); assert.deepEqual(JSON.parse(s.w.localStorage.getItem(s.key)), ['audit-wholesale', 'audit-quote', 'audit-unknown']);
});
test('Comparison opens with actual two selected products and correct known/unknown values', () => {
  const s = load(draft); s.click('[data-save="audit-retail"]'); s.click('[data-save="audit-wholesale"]');
  const trigger = s.click('[data-compare]'); assert.equal(trigger.disabled, false);
  const dialog = s.d.getElementById('comparison-dialog'), table = s.d.getElementById('comparison-table');
  assert.equal(dialog.hasAttribute('open'), true);
  assert.deepEqual([...table.querySelectorAll('thead th')].map(x => x.textContent), ['Buying decision', 'Synthetic Product 1', 'Synthetic Product 2']);
  const row = label => [...table.querySelectorAll('tbody tr')].find(x => x.querySelector('th').textContent === label);
  assert.deepEqual([...row('MOQ').querySelectorAll('td')].map(x => x.textContent), ['Not disclosed', '50 units']);
  assert.deepEqual([...row('Lead time').querySelectorAll('td')].map(x => x.textContent), ['Not disclosed', '21 days']);
  assert.deepEqual([...row('Width').querySelectorAll('td')].map(x => x.textContent), ['10 cm', '11 cm']);
  assert.match(row('Price context').textContent, /retail reference only/);
  assert.match(row('Price context').textContent, /wholesale, EXW, packaging excluded/);
  s.click('#comparison-dialog [data-close]'); assert.equal(dialog.hasAttribute('open'), false);
  assert.equal(s.d.activeElement, trigger);
});
test('Comparison reopens with current selection, no stale removed column', () => {
  const s = load(draft); s.click('[data-save="audit-retail"]'); s.click('[data-save="audit-wholesale"]'); s.click('[data-compare]');
  s.click('#comparison-dialog [data-close]'); s.click('[data-save="audit-retail"]'); s.click('[data-save="audit-quote"]'); s.click('[data-compare]');
  const names = [...s.d.querySelectorAll('#comparison-table thead th')].map(x => x.textContent);
  assert.deepEqual(names, ['Buying decision', 'Synthetic Product 2', 'Synthetic Product 3']);
  assert.match(s.d.getElementById('comparison-table').textContent, /Request a project quote/);
});
test('Three selection comparison contains exactly three product columns', () => {
  const s = load(draft); issue.products.forEach(p => s.click(`[data-save="${p.id}"]`)); s.click('[data-compare]');
  assert.equal(s.d.querySelectorAll('#comparison-table thead th').length, 4);
  assert.equal(s.d.querySelectorAll('#comparison-table tbody tr:first-child td').length, 3);
});
test('Persisted selection reloads, drops unknown IDs and caps at three', () => {
  const s = load(draft, { stored: ['nonexistent', ...issue.products.map(p => p.id)] });
  assert.deepEqual(s.ids(), issue.products.slice(0, 3).map(p => p.id)); assert.equal(s.count(), 3);
  assert.deepEqual(JSON.parse(s.w.localStorage.getItem(s.key)), issue.products.slice(0, 3).map(p => p.id));
});
test('Blocked storage keeps session interaction usable and accurately labels it', () => {
  const s = load(draft, { denyStorage: true }); s.click('[data-save="audit-retail"]');
  assert.equal(s.count(), 1); assert.match(s.d.querySelector('[data-storage-note]').textContent, /This session only/);
  assert.match(s.d.getElementById('toast').textContent, /Saved for this session only/);
  s.click('[data-save="audit-wholesale"]'); s.click('[data-compare]');
  assert.equal(s.d.getElementById('comparison-dialog').hasAttribute('open'), true);
  assert.equal(s.d.querySelectorAll('#comparison-table thead th').length, 3);
  s.click('[data-download-request]'); assert.equal(s.downloads.length, 1);
});
test('Opaque-origin actual jsdom SecurityError keeps page-local shortlist and comparison usable', () => {
  const s = load(draft, { opaqueOrigin: true });
  assert.throws(() => s.w.localStorage, { name: 'SecurityError' });
  s.click('[data-save="audit-retail"]'); s.click('[data-save="audit-wholesale"]'); s.click('[data-compare]');
  assert.equal(s.count(), 2); assert.equal(s.d.getElementById('comparison-dialog').hasAttribute('open'), true);
  assert.match(s.d.querySelector('[data-storage-note]').textContent, /This session only/);
  s.click('[data-download-request]'); assert.equal(s.downloads.length, 1);
});
test('Malformed persisted storage does not crash or create phantom selections', () => {
  const s = load(draft, { stored: '{broken' }); assert.equal(s.count(), 0); s.click('[data-save="audit-retail"]');
  assert.equal(s.count(), 1); assert.match(s.d.querySelector('[data-storage-note]').textContent, /This session only/);
});
test('Source citation opens matching original record and link without navigation', () => {
  const s = load(draft), trigger = s.click('[data-sources="s2"]');
  const dialog = s.d.getElementById('sources-dialog'); assert.equal(dialog.hasAttribute('open'), true);
  const highlighted = dialog.querySelectorAll('[data-highlight="true"]'); assert.equal(highlighted.length, 1);
  assert.equal(highlighted[0].dataset.sourceRecord, 's2');
  assert.match(highlighted[0].textContent, /Synthetic evidence 2/); assert.match(highlighted[0].textContent, /Fictional source 2/);
  assert.equal(highlighted[0].querySelector('a').href, issue.sources[1].url);
  assert.equal(s.scrolls.at(-1).source, 's2'); assert.equal(s.requests.length, 0);
  s.click('#sources-dialog [data-close]'); assert.equal(dialog.hasAttribute('open'), false); assert.equal(s.d.activeElement, trigger);
});
test('All-sources action clears prior highlight; Escape returns focus', () => {
  const s = load(draft); s.click('[data-sources="s3"]'); s.click('#sources-dialog [data-close]');
  const trigger = s.click('[data-sources=""]'), dialog = s.d.getElementById('sources-dialog');
  assert.equal(dialog.querySelectorAll('[data-highlight="true"]').length, 0);
  assert.equal(dialog.querySelectorAll('[data-source-record]').length, 4);
  dialog.dispatchEvent(new s.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(dialog.hasAttribute('open'), false); assert.equal(s.d.activeElement, trigger);
});
test('No-selection draft captures all products, provenance links, unknowns and no-send disclaimer', () => {
  const s = load(draft); s.click('[data-download-request]'); const download = s.downloads[0];
  assert.equal(download.filename, 'sourcing-request-synthetic-interaction-audit-01.md');
  assert.equal(download.mime, 'text/markdown;charset=utf-8');
  for (const p of issue.products) assert.ok(download.text.includes(`## ${p.name}\n`));
  for (const source of issue.sources) assert.ok(download.text.includes(`- Source: ${source.url} (accessed ${source.accessedAt})`));
  assert.match(download.text, /DEMONSTRATION — fictional supplier data/);
  assert.match(download.text, /No messages have been sent by this magazine/);
  assert.match(download.text, /retail reference only/); assert.match(download.text, /Published MOQ: Not disclosed/);
  assert.match(download.text, /Request a project quote/); assert.equal(s.requests.length, 0);
});
test('Selected-product download includes only active selection after cancellation', () => {
  const s = load(draft); s.click('[data-save="audit-retail"]'); s.click('[data-save="audit-wholesale"]'); s.click('[data-save="audit-retail"]');
  s.click('[data-download-request]'); const download = s.downloads[0];
  assert.match(download.text, /## Synthetic Product 2\n/); assert.doesNotMatch(download.text, /## Synthetic Product [134]\n/);
  assert.ok(download.text.includes(issue.sources[1].url)); assert.ok(!download.text.includes(issue.sources[0].url));
});
test('Request preserves field-only evidence in stable deduplicated order without unrelated or unselected sources', () => {
  const custom = makeIssue();
  const extraIds = ['price-only', 'moq-only', 'lead-only', 'spec-only', 'unselected-only', 'unrelated'];
  const extras = extraIds.map(id => ({ ...custom.sources[0], id,
    url: `https://example.com/synthetic/${id}`, title: `Synthetic ${id} evidence` }));
  // Source catalog order must not control the product / price / MOQ / lead / spec order.
  custom.sources.push(...extras.reverse());
  const p = custom.products[1];
  p.sourceIds = ['s2', 's2'];
  p.price.sourceIds = ['price-only', 's2', 'price-only'];
  p.moq.sourceIds = ['moq-only', 'price-only'];
  p.leadTime.sourceIds = ['lead-only', 'moq-only'];
  p.specs[0].sourceIds = ['spec-only', 'lead-only', 's2'];
  custom.products[0].price.sourceIds = ['unselected-only'];
  const s = load(compile(custom));
  s.click('[data-save="audit-retail"]'); s.click('[data-save="audit-wholesale"]'); s.click('[data-save="audit-retail"]');
  s.click('[data-download-request]');
  const request = s.downloads[0].text;
  const expectedIds = ['s2', 'price-only', 'moq-only', 'lead-only', 'spec-only'];
  const expected = expectedIds.map(id => custom.sources.find(source => source.id === id))
    .map(source => `- Source: ${source.url} (accessed ${source.accessedAt})`);
  assert.deepEqual(request.split('\n').filter(line => line.startsWith('- Source: ')), expected);
  assert.match(request, /Published price context: \$12\.00/);
  assert.match(request, /Published MOQ: 50 units/); assert.match(request, /Published lead time: 21 days/);
  assert.match(request, /Width: 11 cm/); assert.doesNotMatch(request, /## Synthetic Product [134]\n/);
  for (const source of custom.sources.filter(source => !expectedIds.includes(source.id))) assert.ok(!request.includes(source.url));
  s.click('[data-download-request]'); assert.equal(s.downloads[1].text, request);
});
test('Restricted specification evidence is rejected before any request artifact is compiled', () => {
  const custom = makeIssue();
  custom.sources.push({ ...custom.sources[0], id: 'restricted-only', url: 'https://example.com/synthetic/restricted-only' });
  custom.products[1].specs[0].visibility = 'restricted';
  custom.products[1].specs[0].sourceIds = ['restricted-only'];
  const json = JSON.stringify(custom);
  assert.equal(validateIssueJson(json, { now: NOW }).valid, false);
  assert.throws(() => compileDraft(json, { now: NOW }), { code: 'MAGAZINE_ISSUE_INVALID' });
});
test('Comparison download captures chosen products; Blob URL is later revoked', () => {
  const s = load(draft); s.click('[data-save="audit-retail"]'); s.click('[data-save="audit-quote"]'); s.click('[data-compare]');
  s.click('#comparison-dialog [data-download-request]'); assert.equal(s.downloads.length, 1);
  assert.match(s.downloads[0].text, /## Synthetic Product 1\n/); assert.match(s.downloads[0].text, /## Synthetic Product 3\n/);
  assert.doesNotMatch(s.downloads[0].text, /## Synthetic Product [24]\n/);
  for (const [id, timer] of s.timers) if (timer.delay === 2000) { timer.callback(); s.timers.delete(id); }
  assert.deepEqual(s.revocations, [s.downloads[0].href]); assert.equal(s.d.querySelectorAll('a[download]').length, 0);
});
test('Category filtering and saved-single-item navigation preserve shortlist', () => {
  const s = load(draft); s.click('[data-save="audit-retail"]'); s.click('[data-filter="Synthetic B"]');
  assert.equal(s.d.querySelector('[data-product-id="audit-retail"]').hidden, true);
  s.click('[data-show-shortlist]'); assert.equal(s.d.querySelector('[data-product-id="audit-retail"]').hidden, false);
  assert.equal(s.count(), 1); assert.match(s.scrolls.at(-1).id, /audit-retail/);
});

// Regression acceptance executes the compiled artifact, not a duplicate price helper.
test('Wholesale quantity survives comparison and request brief separately from MOQ', () => {
  const s = load(draft); s.click('[data-save="audit-retail"]'); s.click('[data-save="audit-wholesale"]'); s.click('[data-compare]');
  const comparison = s.d.getElementById('comparison-table').textContent;
  s.click('[data-download-request]'); const request = s.downloads[0].text;
  assert.match(comparison, /wholesale, EXW, packaging excluded · quote quantity basis: 500 units/);
  assert.match(request, /wholesale, EXW, packaging excluded · quote quantity basis: 500 units/);
  assert.match(request, /Published MOQ: 50 units/);
  const retailPrice = [...s.d.querySelectorAll('#comparison-table tbody tr')].find(r => r.firstElementChild.textContent === 'Price context').querySelector('td').textContent;
  assert.match(retailPrice, /retail reference only/); assert.doesNotMatch(retailPrice, /quote quantity basis/);
});
for (const amount of ['25-30', 'from 25', '25.00', '0', '-5', 'Infinity', '  from $25  ', 0]) {
  test(`Static, comparison and captured draft preserve amount semantics: ${JSON.stringify(amount)}`, () => {
    const custom = makeIssue(); custom.products[0].price.amount = amount;
    // Even when present on a retail record, a wholesale condition is not invented.
    custom.products[0].price.minQty = 999;
    const s = load(compile(custom)); s.click('[data-save="audit-retail"]'); s.click('[data-save="audit-quote"]'); s.click('[data-compare]');
    s.click('[data-download-request]');
    const price = typeof amount === 'string' ? amount.trim() + ' USD / item · retail reference only' : '$0.00 / item · retail reference only';
    const card = s.d.querySelector('[data-product-id="audit-retail"]').textContent;
    const table = s.d.getElementById('comparison-table').textContent;
    const text = s.downloads[0].text;
    for (const rendered of [card, table, text]) { assert.ok(rendered.includes(price), price); assert.doesNotMatch(rendered, /NaN|quote quantity basis|999/); }
  });
}
test('All executed interactions produced zero external request attempts and zero JS runtime errors', () => {
  assert.ok(sessions.length >= 18, 'Expected interaction sessions must have actually executed');
  assert.deepEqual(sessions.flatMap(s => s.requests), []);
  assert.deepEqual(sessions.flatMap(s => s.errors), []);
});
test('Audit does not mutate the candidate package', () => assert.deepEqual(snapshot(pkg), before));

const report = {
  title: 'Offline DOM interaction audit — NOT browser or visual acceptance',
  scope: 'Public pure compiler + exact packaged emitted inline JS executed with root jsdom; wholly synthetic evidence; no DSH Host/model/network/install/deploy/contact.',
  packageVersion: JSON.parse(readFileSync(path.join(pkg, 'package.json'))).version,
  node: process.version, jsdom: require('jsdom/package.json').version,
  generated: { name: draft.name, bytes: draft.data.byteLength, sha256: draft.sha256, productCount: draft.productCount, sourceCount: draft.sourceCount },
  packagedInlineJsSha256: sha(originalClient), unchangedCandidatePackageFiles: Object.keys(before).length,
  executedDomSessions: sessions.length,
  total: results.length, passed: results.filter(r => r.status === 'pass').length, failed: results.filter(r => r.status === 'fail').length,
  results,
  externalRequestAttempts: sessions.flatMap(s => s.requests), runtimeErrors: sessions.flatMap(s => s.errors),
  boundaries: ['This is jsdom DOM simulation, not browser/visual/Host acceptance; no layout, screenshot or keyboard focus trap geometry.',
    'Blob/download/click are explicit synthetic captures; no actual file-save dialog or outbound contact.',
    'Dialog open/close uses jsdom capability or application fallback, not native top-layer browser semantics.',
    'Null images only. No rights review, image acceptance or completed editorial/design workflow.'],
};
sessions.forEach(s => s.dom.window.close());
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.failed ? 1 : 0;
