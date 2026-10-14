import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { libraryFixture, COMPANY, PRODUCT, PRIVATE, API } from './fixtures/pi-library-read.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function until(check, label) { for (let i = 0; i < 500; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error(label); }

async function launcher(t, backend) {
  const calls = [];
  // The existing enterprise Session stays in the parent fixture. This test-only
  // loopback relay forwards allowlisted GETs, never gives the child a Session
  // cookie, signing key or production credential. It is not a product endpoint.
  const bridge = http.createServer(async (req, res) => {
    if (req.method !== 'GET' || !req.url.startsWith(API + '/')) { res.writeHead(403); res.end('{}'); return; }
    calls.push({ method: req.method, route: req.url });
    try {
      const value = await backend.workspace(req.url, { subject: 'member-a', headers: { 'X-Workspace-Library-Recipient': req.headers['x-workspace-library-recipient'] } });
      res.writeHead(value.status, { 'content-type': 'application/json' }); res.end(value.bytes);
    } catch { res.writeHead(500); res.end('{"error":"Synthetic Session bridge failure"}'); }
  });
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { bridge.closeAllConnections(); bridge.close(resolve); }));
  const isolated = await fs.mkdtemp('/tmp/workspace-pi-library-pty-');
  const child = spawn('python3', [path.join(root, 'test/fixtures/pi-tui-pty-driver.py'), process.execPath, path.join(root, 'test/fixtures/pi-library-read-pty.mjs')],
    { cwd: root, env: { PATH: process.env.PATH, LANG: 'C.UTF-8', TERM: 'xterm-256color', WS_AGENT_URL: backend.baseURL, WS_AGENT_TOKEN: backend.token,
      PI_LIBRARY_SESSION_BRIDGE: `http://127.0.0.1:${bridge.address().port}`, PI_OFFLINE: '1', PI_CODING_AGENT_DIR: path.join(isolated, 'agent'), PI_LIBRARY_TEST_DIRECTORY: isolated }, stdio: ['pipe', 'pipe', 'pipe'] });
  const driver = { child, closed: once(child, 'exit'), raw: '', stderr: '', code: undefined, calls }; let buffer = '';
  child.stderr.on('data', data => { driver.stderr += data; });
  child.stdout.on('data', data => { buffer += data; while (buffer.includes('\n')) {
    const cut = buffer.indexOf('\n'), event = JSON.parse(buffer.slice(0, cut)); buffer = buffer.slice(cut + 1);
    if (event.type === 'output') driver.raw += event.data; if (event.type === 'exit') driver.code = event.code;
  } });
  driver.command = text => child.stdin.write(JSON.stringify({ type: 'write', text: text + '\r' }) + '\n');
  t.after(async () => { if (child.exitCode === null) child.stdin.write(JSON.stringify({ type: 'stop' }) + '\n'); await driver.closed; await fs.rm(isolated, { recursive: true, force: true }); });
  await until(() => driver.raw.includes('Explicit synthetic Library-read PTY fixture'), 'Official Library fixture failed to start: ' + driver.stderr);
  assert.match(driver.raw, /v1\.1\.0/);
  driver.question = async (question, tool) => {
    const offset = driver.raw.length; driver.command(question);
    await until(() => driver.raw.slice(offset).includes('LIBRARY_REPLY_END ' + tool), 'Official Library answer missing: ' + tool);
    return driver.raw.slice(offset);
  };
  driver.quit = async () => { driver.command('/ws-quit'); await until(() => driver.code !== undefined, 'Official Library TUI did not close'); assert.equal((await driver.closed)[0], 0, driver.stderr); };
  return driver;
}

test('actual official Pi PTY answers company/list/detail from original approved synthetic records', { skip: process.platform === 'win32', timeout: 45_000 }, async t => {
  const backend = await libraryFixture(t), driver = await launcher(t, backend), sequence = backend.app.store.read().meta.sequence;
  const company = await driver.question('公司资料是什么？', 'workspace_company_profile'); assert.match(company, /available/); assert.ok(company.includes(COMPANY.legalName)); assert.match(company, /LIBRARY_SOURCE company/);
  const list = await driver.question('有哪些产品？', 'workspace_products'); assert.match(list, /available/); assert.ok(list.includes(PRODUCT.name)); assert.ok(list.includes(backend.product.id));
  const detail = await driver.question(`产品详情 ${backend.product.id} 是什么？`, 'workspace_product'); assert.match(detail, /available/);
  // The official terminal wraps long CJK descriptions; exact projected text is
  // checked by the AgentSession test, and these original facts survive wrapping.
  assert.match(detail, /500ml/); assert.match(detail, /合成保温杯/); assert.ok(detail.includes(backend.product.id));
  assert.match(await driver.question('任务进度是什么？', 'workspace_business_tasks'), /empty/);
  assert.ok(driver.calls.some(row => row.route === API + '/company')); assert.ok(driver.calls.some(row => row.route === API + '/products/' + backend.product.id));
  assert.ok(driver.calls.every(row => row.method === 'GET')); assert.equal(backend.app.store.read().meta.sequence, sequence);
  assert.ok(!driver.raw.includes(PRIVATE)); assert.ok(!driver.raw.includes(backend.token)); assert.equal(backend.faux.state.callCount, 0);
  await driver.quit();
  t.diagnostic(JSON.stringify({ officialVersion: '1.1.0', transport: 'finite-keyless-faux', liveModelCalls: 0, companyRecordId: 'company',
    companyRevision: backend.company.revision, productRecordId: backend.product.id, productRevision: backend.product.revision,
    tools: ['workspace_company_profile', 'workspace_products', 'workspace_product', 'workspace_business_tasks'], calls: driver.calls,
    terminalSha256: createHash('sha256').update(driver.raw).digest('hex'), unreviewedFieldsDisclosed: false }));
});

test('actual official Pi PTY reports an authorized empty catalog without sample products', { skip: process.platform === 'win32', timeout: 30_000 }, async t => {
  const backend = await libraryFixture(t, { seed: false }), driver = await launcher(t, backend);
  const output = await driver.question('有哪些产品？', 'workspace_products'); assert.match(output, /empty/); assert.ok(!output.includes(PRODUCT.name));
  assert.equal(backend.app.store.read().businessLibrary.products.length, 0); assert.equal(backend.faux.state.callCount, 0); await driver.quit();
});
