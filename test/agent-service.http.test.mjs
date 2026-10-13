import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  API, PRESET_IDS, INPUTS, ARTIFACTS, request, stream, serviceFixture,
  submit, completed, assertEvents, presetRows,
} from './agent-service.helpers.mjs';

// PR44 transport assertions retained against the unified Workspace app with explicit demo.
// It never calls a real model, supplier, marketplace, Muse account or Vault.
// Pi/business recovery is covered in agent-pi-service.http.test.mjs; no second executor is used.
const runFile = promisify(execFile);
const DEMO = '演示模式：未接模型与真实数据源，内容为结构模板，数字为待确认';

async function downloads(f, taskId, token = f.tokenA) {
  const list = await f.api(`${API}/tasks/${taskId}/artifacts`, { token });
  assert.equal(list.status, 200); assert.ok(Array.isArray(list.json));
  const files = {};
  for (const item of list.json) {
    assert.deepEqual(Object.keys(item).sort(), ['bytes', 'name', 'url']);
    const file = await f.api(item.url, { token });
    assert.equal(file.status, 200, 'Every listed artifact must be downloadable.');
    assert.equal(file.bytes.length, item.bytes, 'Artifact bytes must mean UTF-8 bytes, not character count.');
    assert.ok(String(file.headers['content-disposition']).includes(item.name), 'Download headers must identify the expected file.');
    files[item.name] = file;
  }
  return { list: list.json, files };
}

test('[acceptance 1] public install, manifest and downloadable Python expose the agreed connector and dynamic service host', { timeout: 20_000 }, async t => {
  const f = await serviceFixture(t, { env: { WS_AGENT_TRUST_PROXY: '1' } });
  for (const prefix of ['', API]) {
    const health = await request(f.base, `${prefix}/health`);
    assert.equal(health.status, 200);
    assert.equal(health.json.mode, 'demo');
    assert.equal(typeof health.json.version, 'string');
    const ids = presetRows(health.json.presets)?.map(item => typeof item === 'string' ? item : item.id);
    assert.deepEqual(ids?.sort(), [...PRESET_IDS].sort());
    const install = await request(f.base, `${prefix}/install`, { headers: { host: 'install-fixture.example.test:9443', 'x-forwarded-proto': 'https' } });
    assert.equal(install.status, 200);
    assert.match(String(install.headers['content-type']), /^text\/plain/);
    assert.match(install.text, /custom\.cnsubscribe-workspace-agent/);
    assert.match(install.text, /install-fixture\.example\.test:9443/);
    assert.match(install.text, /Secure Vault|安全凭据/);
    assert.match(install.text, /~\/workspace\/tools\/ws-agent\/ws_client\.py/);
    assert.match(install.text, /health/); assert.match(install.text, /presets/);
    for (const name of ['产品批发采购', '供应商寻找', '产品机会发现']) assert.ok(install.text.includes(name), 'Install instructions must describe all three task presets.');
    const manifest = await request(f.base, `${prefix}/plugin/manifest.json`, { headers: { host: 'manifest-fixture.example.test:9443', 'x-forwarded-proto': 'https' } });
    assert.equal(manifest.status, 200); assert.ok(manifest.json);
    assert.ok(manifest.text.includes('manifest-fixture.example.test:9443'));
    assert.ok(manifest.text.includes(API));
    assert.match(manifest.text, /Bearer/i);
    assert.match(manifest.text, /plugin\/client\.py/);
    for (const id of PRESET_IDS) assert.ok(manifest.text.includes(id));
    const client = await request(f.base, `${prefix}/plugin/client.py`);
    assert.equal(client.status, 200);
    assert.ok(client.bytes.length > 1000, 'The client endpoint must serve actual executable source.');
    assert.equal(client.text.includes(f.tokenA) || client.text.includes(f.tokenB), false, 'A downloadable client must not contain any account token.');
    await runFile('python3', ['-c', 'import ast,sys; ast.parse(sys.argv[1])', client.text], { timeout: 5000 });
  }
  const unauthorizedPresets = await request(f.base, `${API}/presets`);
  assert.equal(unauthorizedPresets.status, 401);
  const invalidHost = await request(f.base, '/install', { headers: { host: 'install-fixture.example.test:99999' } });
  assert.equal(invalidHost.status, 400, 'Malformed Host ports are parameter errors, not internal server failures.');
  assert.deepEqual(Object.keys(invalidHost.json), ['error']);
  const presets = await f.api(`${API}/presets`);
  assert.equal(presets.status, 200);
  assert.deepEqual(presetRows(presets.json)?.map(item => item.id).sort(), [...PRESET_IDS].sort());
});

test('[acceptance 1, 2, 9] a freshly downloaded Python client performs health, presets, submit, replay, status and downloads without saving its token', { timeout: 30_000 }, async t => {
  const f = await serviceFixture(t);
  const source = await request(f.base, '/plugin/client.py');
  const filename = path.join(f.dir, 'downloaded-ws-client.py');
  await writeFile(filename, source.bytes, { mode: 0o700 });
  const clientEnv = { PATH: process.env.PATH || '', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', WS_AGENT_URL: f.base, WS_AGENT_TOKEN: f.tokenA };
  async function client(...args) {
    let result;
    try { result = await runFile('python3', [filename, ...args], { env: clientEnv, timeout: 15_000, maxBuffer: 2_000_000 }); }
    catch { throw new Error('Downloaded Python client command failed; raw process output was withheld.'); }
    assert.equal((result.stdout + result.stderr).includes(f.tokenA), false, 'The Python client must not print its injected credential.');
    return result;
  }
  const health = JSON.parse((await client('health')).stdout);
  assert.equal(health.mode, 'demo');
  assert.deepEqual(presetRows(JSON.parse((await client('presets')).stdout)).map(item => item.id).sort(), [...PRESET_IDS].sort());
  const submitted = await client('submit', '--type', 'procurement', '--title', 'Python 薄客户端验收', '--input-json', JSON.stringify(INPUTS.procurement));
  const events = submitted.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events[0].kind, 'accepted'); assert.equal(events.at(-1).kind, 'done');
  const taskId = events[0].payload.taskId;
  assertEvents(events, { type: 'procurement', taskId });
  const detail = JSON.parse((await client('status', taskId)).stdout);
  assert.equal(detail.status, 'done');
  const replay = JSON.parse((await client('replay', taskId, '--from-seq', '0', '--format', 'json')).stdout);
  assert.deepEqual(replay, events);
  const outputDirectory = path.join(f.dir, 'client-delivery');
  const delivered = JSON.parse((await client('download', taskId, '--output-dir', outputDirectory)).stdout);
  assert.deepEqual(delivered.map(item => item.name).sort(), [...ARTIFACTS.procurement].sort());
  for (const item of delivered) {
    assert.equal(path.dirname(item.path), outputDirectory);
    const file = await readFile(item.path);
    assert.equal(file.byteLength, item.bytes);
    assert.equal(file.includes(Buffer.from(f.tokenA)), false);
    assert.ok(file.toString('utf8').includes(DEMO));
  }
  assert.equal((await readFile(filename, 'utf8')).includes(f.tokenA), false);
});

test('[acceptance 2, 8, 9] procurement returns three real files, truthful template content, and identical durable SSE/JSON events', { timeout: 20_000 }, async t => {
  const f = await serviceFixture(t), task = await submit(f);
  const { live, detail, events } = await completed(f, task);
  assertEvents(events, { type: 'procurement', taskId: task.taskId });
  assert.deepEqual(live.ids, events.map(event => String(event.seq)), 'SSE id must equal the persisted seq.');
  assert.equal(detail.taskId, task.taskId); assert.equal(detail.type, 'procurement');
  assert.equal(detail.status, 'done'); assert.equal(typeof detail.title, 'string');
  assert.deepEqual(detail.input, INPUTS.procurement, 'The exact submitted input must survive task creation.');
  assert.ok(Number.isFinite(Date.parse(detail.created_at)));
  assert.ok(Number.isFinite(Date.parse(detail.finished_at)));
  assert.match(detail.summary, /演示模式/);
  const { list, files } = await downloads(f, task.taskId);
  assert.deepEqual(list.map(item => item.name).sort(), [...ARTIFACTS.procurement].sort());
  assert.deepEqual(detail.artifacts, list);
  assert.deepEqual(events.at(-1).payload.artifacts, list);
  assert.deepEqual(events.filter(event => event.kind === 'artifact').map(event => event.payload), list);
  for (const { text } of Object.values(files)) {
    assert.ok(text.includes(DEMO), 'Every demo artifact must carry the complete agreed demonstration disclosure.');
    assert.ok(text.includes(INPUTS.procurement.product));
    assert.ok(text.includes('500ml'));
    assert.ok(text.includes('1000'));
    assert.doesNotMatch(text, /304\s*不锈钢/, 'The attachment example must not inject an unspecified steel grade.');
  }
  const inquiry = files['inquiry-pack.md'].text;
  for (const expression of [/Q1\b/, /Q9\b/, /MOQ/, /样品|打样/, /付款/, /认证/, /包装/, /有效期/, /EXW/, /FOB/]) assert.match(inquiry, expression);
  const comparison = files['comparison.md'].text;
  for (const expression of [/待回收/, /单价|报价/, /MOQ/, /打样|样品/, /交期/, /付款/, /认证/]) assert.match(comparison, expression);
  const brief = files['procurement-brief.md'].text;
  for (const expression of [/风险/, /谈判/, /打样/, /淘汰/, /需用户确认后执行/]) assert.match(brief, expression);
  const persistedOnly = await stream(f.base, `${task.events_url}?from=0`, f.tokenA);
  assert.equal(persistedOnly.closedByServer, true);
  assert.deepEqual(persistedOnly.events, events, 'A finished task must replay and close immediately.');
});

for (const type of ['supplier-sourcing', 'opportunity-discovery']) {
  test(`[acceptance 3, 8, 9] ${type} produces its complete source-conscious deliverable and event plan`, { timeout: 20_000 }, async t => {
    const f = await serviceFixture(t), task = await submit(f, type);
    const { detail, events } = await completed(f, task);
    assertEvents(events, { type, taskId: task.taskId });
    assert.equal(detail.status, 'done'); assert.ok(detail.summary.includes('演示模式'));
    const { list, files } = await downloads(f, task.taskId);
    assert.deepEqual(list.map(item => item.name), ARTIFACTS[type]);
    const text = files[ARTIFACTS[type][0]].text;
    assert.ok(text.includes(DEMO)); assert.ok(text.includes(INPUTS[type].product)); assert.match(text, /待确认/);
    if (type === 'supplier-sourcing') {
      for (const expression of [/名称/, /链接/, /主营|匹配/, /MOQ/, /报价口径/, /证据|来源/, /A\s*已核验/, /B\s*部分核验/, /C\s*仅线索/, /优先/]) assert.match(text, expression);
      assert.doesNotMatch(events.filter(event => event.kind === 'thinking').map(event => event.payload.text).join('\n'), /已(?:找到|核验|检索到)\s*\d+\s*家/);
    } else {
      for (const expression of [/结论/, /价格带/, /竞品/, /差评/, /未覆盖/, /待确认/]) assert.match(text, expression);
    }
  });
}

test('[acceptance 7] malformed requests and cursors use the string-error contract; unknown type lists valid presets', { timeout: 20_000 }, async t => {
  const f = await serviceFixture(t);
  const cases = [
    {}, { type: 'procurement', title: 'Missing input' },
    { type: 'procurement', title: 'Invalid input', input: [] },
    { type: 'procurement', title: 'Missing product', input: { spec: '500ml', quantity: 1000 } },
    { type: 'procurement', title: 'Blank spec', input: { product: '杯子', spec: ' ', quantity: 1000 } },
    { type: 'procurement', title: 'Null quantity', input: { product: '杯子', spec: '500ml', quantity: null } },
    { type: 'supplier-sourcing', title: 'Spec required', input: { product: '杯子' } },
    { type: 'opportunity-discovery', title: 'Market required', input: { product: '杯子' } },
  ];
  for (const body of cases) {
    const bad = await f.api(`${API}/tasks`, { method: 'POST', body });
    assert.equal(bad.status, 400, 'Invalid request fields must return HTTP 400.');
    assert.equal(typeof bad.json.error, 'string');
  }
  const malformed = await f.api(`${API}/tasks`, { method: 'POST', rawBody: '{ malformed JSON' });
  assert.equal(malformed.status, 400); assert.equal(typeof malformed.json.error, 'string');
  const wrongType = await f.api(`${API}/tasks`, { method: 'POST', body: { type: 'unknown-preset', title: 'Unknown fixture preset', input: {} } });
  assert.equal(wrongType.status, 400); assert.equal(typeof wrongType.json.error, 'string');
  for (const id of PRESET_IDS) assert.ok(wrongType.text.includes(id), 'Unknown type errors must list available presets.');
  const task = await submit(f); await completed(f, task);
  for (const from of ['-1', '1.5', 'abc', '9007199254740992']) {
    const invalid = await f.api(`${task.events_url}?format=json&from=${encodeURIComponent(from)}`);
    assert.equal(invalid.status, 400); assert.equal(typeof invalid.json.error, 'string');
  }
});


test('[acceptance 2] supplied quotes remain attributable and incomparable currencies/trade terms are not silently converted', { timeout: 20_000 }, async t => {
  const f = await serviceFixture(t);
  const quotes = [
    { supplier: '用户测试报价甲', price: 17.8, currency: 'CNY', trade_term: 'EXW', moq: 1000, sample: '待回收', lead_time: '待回收', payment: '待回收', certification: '待回收' },
    { supplier: '用户测试报价乙', price: 2.7, currency: 'USD', trade_term: 'FOB', moq: 800 },
  ];
  const task = await submit(f, 'procurement', { ...INPUTS.procurement, quotes });
  const { detail } = await completed(f, task);
  assert.deepEqual(detail.input.quotes, quotes);
  const { files } = await downloads(f, task.taskId), comparison = files['comparison.md'].text;
  for (const text of ['用户测试报价甲', '用户测试报价乙', '17.8', '2.7', 'CNY', 'USD', 'EXW', 'FOB', '待回收']) assert.ok(comparison.includes(text));
  assert.match(comparison, /口径.*不(?:一致|同)|币种.*不(?:一致|同)|不可直接比较|不强行折算|不做.*折算/);
  assert.match(comparison, /用户.*提供|用户.*输入|用户材料/);
  assert.doesNotMatch(comparison, /折合人民币|统一换算后|已向.*询价/);
});


test('[acceptance 6] artifact downloads reject invalid path segments and only expose registered files', { timeout: 20_000 }, async t => {
  const f = await serviceFixture(t), task = await submit(f); await completed(f, task);
  const base = `${API}/tasks/${task.taskId}/artifacts`;
  for (const suffix of ['..%2f..%2fworkspace.json', '..%5cworkspace.json', '%00inquiry-pack.md', 'unregistered.md']) {
    const result = await f.api(`${base}/${suffix}`);
    assert.ok([400, 404].includes(result.status), 'Invalid or unregistered artifact names must not expose a file.');
    assert.equal(typeof result.json?.error, 'string');
  }
});


test('[acceptance 2, 8] editing a preset JSON and restarting changes its stages, template and completion summary without code edits', { timeout: 20_000 }, async t => {
  const presetDirectory = await mkdtemp(path.join(tmpdir(), 'workspace-agent-presets-'));
  t.after(() => rm(presetDirectory, { recursive: true, force: true }));
  await cp(new URL('../presets/agent/', import.meta.url), presetDirectory, { recursive: true });
  const f = await serviceFixture(t, { env: { WS_AGENT_PRESETS_DIR: presetDirectory } });
  const first = await submit(f); await completed(f, first);
  const filename = path.join(presetDirectory, 'procurement.json');
  const preset = JSON.parse(await readFile(filename, 'utf8'));
  const titleMarker = '运营配置更新：需求核对';
  const contentMarker = '运营配置更新：此段来自修改后的预设模板。';
  const summaryMarker = '运营配置更新：新的交付摘要。';
  preset.name = '产品批发采购（运营配置更新）';
  preset.stages[0].title = titleMarker;
  preset.stages[0].output_template += `\n\n${contentMarker}\n`;
  preset.summary_template += ` ${summaryMarker}`;
  await writeFile(filename, JSON.stringify(preset, null, 2));
  await f.restart();
  const registry = await f.api(`${API}/presets`);
  assert.equal(presetRows(registry.json).find(row => row.id === 'procurement').name, preset.name);
  const second = await submit(f), { detail, events } = await completed(f, second);
  assert.equal(events[0].payload.plan[0], titleMarker);
  assert.equal(events.find(event => event.kind === 'stage').payload.title, titleMarker);
  assert.ok(detail.summary.includes(summaryMarker));
  const { files } = await downloads(f, second.taskId);
  assert.ok(Object.values(files).some(file => file.text.includes(contentMarker)));
  const old = await f.api(`${first.events_url}?format=json`);
  assert.notEqual(old.json[0].payload.plan[0], titleMarker, 'Historical task events must retain their original preset snapshot.');
});
