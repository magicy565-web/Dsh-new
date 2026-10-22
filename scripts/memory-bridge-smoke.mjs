// End-to-end smoke for the harness memory service bridge.
//
// It boots the real harness.local.yml composition on an ephemeral port, then
// talks to it exactly like the application does: over HTTP with a service
// token, through server/business-memory-client.mjs. It proves the B topology
// end to end — the harness owns the memory, the caller only holds a token.
//
// Usage: node scripts/memory-bridge-smoke.mjs
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { parse } from 'yaml';
import { createHarness } from '../packages/harness-kernel/src/app.mjs';
import { createBusinessMemoryClient } from '../server/business-memory-client.mjs';

const root = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) }); };

const dir = await mkdtemp(path.join(tmpdir(), 'memory-bridge-'));
const tokenPath = path.join(dir, 'service.token');
const token = randomBytes(32).toString('base64url');
await writeFile(tokenPath, token, { mode: 0o600 });

const composition = parse(await readFile(path.join(root, 'harness.local.yml'), 'utf8'));
composition.server = { host: '127.0.0.1', port: 0 };
composition.plugins = composition.plugins.map(row => row.id === 'business-memory'
  ? { ...row, config: { ...row.config, serviceTokenFile: tokenPath } }
  : row);

const harness = await createHarness({ composition, root, logger: { info() {}, warn() {}, error() {} } });
let baseURL;
try {
  const started = await harness.start();
  baseURL = started?.address?.url ?? started?.url;
  check('composition started', Boolean(baseURL), baseURL);

  const client = createBusinessMemoryClient({ baseURL, tokenFile: tokenPath });

  const empty = await client.compile({ taskId: 'smoke-empty' });
  check('empty memory compiles a block', typeof empty.text === 'string' && empty.text.length > 0);
  check('empty memory warns instead of inventing facts', Array.isArray(empty.warnings) && empty.warnings.includes('BUSINESS_MEMORY_EMPTY'));

  const proposal = {
    requestId: randomUUID(),
    subjectType: 'customer',
    subjectId: 'customer-haiqi',
    subjectLabel: '海祺贸易',
    factKey: 'reorder-window',
    kind: 'fact',
    statement: '海祺贸易通常在每年 3 月和 9 月补货。',
    source: { kind: 'operator', basis: '2026-10-21 与客户采购负责人通话确认', label: '电话记录' },
  };
  const created = await fetch(`${baseURL}/api/business-memory/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(proposal),
  }).then(response => response.json());
  check('a proposal is only a candidate', created?.record?.status === 'proposed', created?.record?.status);

  const approved = await fetch(`${baseURL}/api/business-memory/records/${created.record.id}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ decision: 'approve', requestId: randomUUID() }),
  }).then(response => response.json());
  check('a human approval activates the fact', approved?.record?.status === 'active');

  const compiled = await client.compile({ taskId: 'smoke-1', query: '海祺 补货' });
  check('the service block cites the approved fact', compiled.items.some(item => item.id === created.record.id));
  check('the service block carries a revision', Number.isInteger(compiled.revision));
  check('the block names the fact', compiled.text.includes('海祺贸易'));

  const ids = compiled.items.map(item => item.id);
  const current = await client.verify({ ids });
  check('verify says the run snapshot is current', current.current === true && current.changed.length === 0);

  const next = await fetch(`${baseURL}/api/business-memory/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ ...proposal, requestId: randomUUID(), statement: '海祺贸易改为每年 4 月和 10 月补货。' }),
  }).then(response => response.json());
  await fetch(`${baseURL}/api/business-memory/records/${next.record.id}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ decision: 'approve', requestId: randomUUID() }),
  });

  const stale = await client.verify({ ids });
  check('a superseded fact is reported as changed', stale.current === false && stale.changed.length === ids.length);

  let unauthorized = null;
  try {
    await createBusinessMemoryClient({ baseURL, tokenFile: path.join(dir, 'missing.token') }).compile({ taskId: 'x' });
  } catch (error) { unauthorized = error.code; }
  check('a caller without a readable token is refused', unauthorized === 'BUSINESS_MEMORY_UNAUTHORIZED', unauthorized);
} finally {
  await harness.stop().catch(() => {});
  await rm(dir, { recursive: true, force: true });
}

const failed = results.filter(item => !item.ok);
for (const item of results) console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === undefined ? '' : ` (${JSON.stringify(item.detail)})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
