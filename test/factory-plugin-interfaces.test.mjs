import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { factoryMaterialsExtension } from '../plugins/workspace-factory-materials/src/extension.js';
import { factoryCustomersExtension } from '../plugins/workspace-factory-customers/src/extension.js';
import { factoryInquiriesExtension } from '../plugins/workspace-factory-inquiries/src/extension.js';
import { factoryInquiryHash } from '../plugins/workspace-factory-inquiries/src/drafts.mjs';
import { inquiryFixture } from './fixtures/factory-inquiries-data.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const data = inquiryFixture(factoryInquiryHash);
const model = { id: 'synthetic', provider: 'synthetic', baseUrl: 'https://synthetic.invalid' };
const inquiry = { inquiryDocumentId: data.input.inquiryDocumentId, documentVersion: data.input.documentVersion, productId: data.input.productId,
  sources: [...data.inquiry.sources, ...data.materials.sources], documents: [{ name: 'reply.md', content: 'Which quantity should be assessed?' }], requestId: 'stable' };
const customer = { requestId: 'stable', sourceToolCallIds: ['original-search'], documents: [{ name: 'notes.md', content: 'Public source evidence, unverified.' }] };
const kinds = [
  { kind: 'materials', make: factoryMaterialsExtension, method: 'materials', input: { productId: data.input.productId }, plugin: 'workspace-factory-materials', receipt: data.materials },
  { kind: 'customers', make: factoryCustomersExtension, method: 'save', input: customer, plugin: 'workspace-factory-customers', receipt: {
    plugin: 'workspace-factory-customers', status: 'saved-draft', sources: [], humanReviewed: false, humanReviewRequired: true, sent: false, externalActions: false, verifiedBuyer: false, contactPermission: false } },
  { kind: 'inquiries', make: factoryInquiriesExtension, method: 'save', input: inquiry, plugin: 'workspace-factory-inquiries', receipt: {
    plugin: 'workspace-factory-inquiries', status: 'saved-draft', sources: inquiry.sources, humanReviewed: false, humanReviewRequired: true, sent: false, externalActions: false } },
];
test('private package manifests expose portable dependency-free contracts, declared types and legacy entrypoints', async t => {
  const directory = await fs.mkdtemp('/tmp/factory-interface-exports-'); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'node_modules/@workspace-agent'), { recursive: true });
  const imports = [];
  for (const kind of ['materials', 'customers', 'inquiries']) {
    const original = path.join(root, `plugins/workspace-factory-${kind}`), copied = path.join(directory, `node_modules/@workspace-agent/pi-factory-${kind}`);
    await fs.cp(original, copied, { recursive: true });
    const manifest = JSON.parse(await fs.readFile(path.join(copied, 'package.json')));
    assert.equal(manifest.version, '0.2.0'); assert.equal(manifest.private, true); assert.equal(manifest.license, 'UNLICENSED');
    assert.equal(manifest.dependencies, undefined); assert.equal(manifest.scripts, undefined);
    const resolve = createRequire(path.join(copied, 'package.json'));
    assert.equal(typeof (await import(resolve.resolve(manifest.name))).default, 'function');
    const contract = await import(resolve.resolve(manifest.name + '/contracts'));
    assert.equal(typeof contract[kind === 'materials' ? 'validateFactoryMaterialInput' : kind === 'customers' ? 'validateCustomerDrafts' : 'validateInquiryDrafts'], 'function');
    if (kind === 'inquiries') assert.equal((await import(resolve.resolve(manifest.name + '/drafts'))).validateInquiryDrafts, contract.validateInquiryDrafts);
    if (kind === 'customers') assert.equal((await import(resolve.resolve(manifest.name))).validateCustomerDrafts, contract.validateCustomerDrafts);
    const pack = spawnSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json', '--cache=/tmp/factory-interface-npm-cache'], { cwd: copied, timeout: 15000, encoding: 'utf8' });
    assert.equal(pack.status, 0, pack.stderr); const files = JSON.parse(pack.stdout)[0].files.map(f => f.path);
    for (const required of ['src/extension.js', 'src/contracts.mjs', 'src/contracts.d.mts']) assert.ok(files.includes(required), required);
    assert.ok(files.some(file => file.endsWith('/SKILL.md'))); assert.ok(files.every(file => !file.includes('node_modules') && !file.startsWith('.env')));
    imports.push(`import * as ${kind} from '${manifest.name}/contracts';`);
  }
  const sample = path.join(directory, 'consumer.mts');
  await fs.writeFile(sample, imports.join('\n') + `\nconst product: materials.FactoryMaterialsInput = materials.validateFactoryMaterialInput('materials', {});
const customer: customers.CustomerDraftInput = customers.validateCustomerDrafts({});
const inquiry: inquiries.InquiryDraftInput = inquiries.validateInquiryDrafts({});
// @ts-expect-error selector versions are numeric
const invalid: materials.FactoryDocumentInput = { documentId: 'synthetic', documentVersion: '1' };
void [product, customer, inquiry, invalid];\n`);
  const typed = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2023', sample], { cwd: directory, timeout: 20000, encoding: 'utf8' });
  assert.equal(typed.status, 0, typed.stdout + typed.stderr);
});
for (const engine of ['pi', 'omp']) test(`real ${engine} schema validator agrees with direct DTO validation; extra business constraints stay explicit`, () => {
  const executable = engine === 'pi' ? process.execPath : root + '/support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun';
  const result = spawnSync(executable, ['test/fixtures/factory-plugin-contracts.mjs', engine], { cwd: root, timeout: 20000, encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', HOME: '/tmp', PI_OFFLINE: '1' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const facts = JSON.parse(result.stdout.trim()); assert.ok(facts.rawSchemaCases >= 40); assert.equal(facts.businessPolicyCases, 7); assert.equal(facts.modelCalls, 0);
  console.log(JSON.stringify(facts));
});
test('real Pi SDK executes the customer save adapter with finite keyless responses and synthetic save callbacks', async t => {
  const directory = await fs.mkdtemp('/tmp/factory-customers-pi-sdk-'); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, ['test/fixtures/factory-customers-pi-sdk.mjs', root, directory], { cwd: root, timeout: 20000, encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', HOME: directory, PI_OFFLINE: '1', PI_NO_TITLE: '1', NO_COLOR: '1' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const facts = JSON.parse(result.stdout.trim()); assert.equal(facts.toolCalls, 6); assert.equal(facts.scriptedModelCalls, 12); assert.equal(facts.realOrPaidModelCalls, 0);
  console.log(JSON.stringify(facts));
});
for (const spec of kinds) test(`${spec.kind}: closed DTOs, cancellation, error semantics and pre/post authorization`, async () => {
  let calls = 0, checks = 0, mode = 'normal'; const events = [];
  let controller = new AbortController();
  const methods = Object.fromEntries(['status', 'materials', 'document', 'save'].map(method => [method, async (...args) => {
    calls++; const signal = args.at(-2), receiver = args.at(-1); assert.equal(signal, controller.signal); assert.equal(receiver, model);
    if (mode === 'cancel') { controller.abort(); return spec.receipt; }
    if (mode === 'throws') throw Object.assign(Error('/private/secret must not escape'), { code: 'UNREVIEWED_PRIVATE_CODE' });
    if (mode === 'receipt') return { ...spec.receipt, plugin: 'another-plugin' };
    if (mode === 'partial') return { ...spec.receipt, status: 'partial', reason: 'ORIGINAL_ARTIFACT_SAVE_INCOMPLETE' };
    if (mode === 'claim') return { ...spec.receipt, humanReviewed: true, sent: true };
    if (mode === 'revoke') mode = 'denied';
    return structuredClone(spec.receipt);
  }]));
  const authorize = async (signal, receiver) => {
    checks++; assert.equal(signal, controller.signal); assert.equal(receiver, model);
    if (mode === 'denied') throw Error('/private/authority must not escape');
    if (mode === 'cancel-authorize') controller.abort();
    events.push('authorized');
  };
  const tools = []; spec.make({ client: methods, authorize })({ registerTool: tool => tools.push(tool) });
  const tool = tools.find(row => row.name === (spec.kind === 'materials' ? 'workspace_factory_materials' : spec.kind === 'customers' ? 'workspace_factory_customers_save' : 'workspace_factory_inquiry_save'));
  assert.equal(tool.approval, spec.kind === 'materials' ? 'read' : 'write');
  const invoke = async (value = spec.input, context = { model }) => {
    const result = await tool.execute('synthetic', value, controller.signal, undefined, context);
    assert.deepEqual(JSON.parse(result.content[0].text), result.details); assert.equal(result.details.plugin, spec.plugin);
    assert.doesNotMatch(JSON.stringify(result), /private\/|must not escape|UNREVIEWED_PRIVATE_CODE/); return result;
  };
  const bad = await invoke({ ...spec.input, confirmed: true }); assert.equal(bad.isError, true); assert.match(bad.details.reason, /INPUT_INVALID$/); assert.equal(calls, 0); assert.equal(checks, 0);
  assert.equal((await invoke(spec.input, {})).details.reason, 'EXACT_MODEL_RECEIVER_REQUIRED'); assert.equal(calls, 0);
  controller.abort(); assert.equal((await invoke()).details.reason, 'ORIGINAL_OPERATION_CANCELLED'); assert.equal(calls, 0); assert.equal(checks, 0);
  controller = new AbortController(); mode = 'cancel-authorize'; assert.equal((await invoke()).details.reason, 'ORIGINAL_OPERATION_CANCELLED'); assert.equal(calls, 0);
  controller = new AbortController(); mode = 'normal'; assert.equal((await invoke()).isError, undefined); assert.equal(calls, 1);
  mode = 'partial'; const partial = await invoke(); assert.equal(partial.details.status, 'partial'); assert.equal(partial.isError, spec.kind === 'materials' ? undefined : true);
  mode = 'throws'; assert.equal((await invoke()).details.reason, 'ORIGINAL_HOST_OPERATION_FAILED');
  mode = 'receipt'; assert.match((await invoke()).details.reason, /INVALID_ORIGINAL_(?:SAVE|READ)_RECEIPT/);
  if (spec.kind !== 'materials') { mode = 'claim'; assert.equal((await invoke()).details.reason, 'INVALID_ORIGINAL_SAVE_RECEIPT'); }
  mode = 'revoke'; const revoked = await invoke(); assert.equal(revoked.details.reason, 'ORIGINAL_AUTHORIZATION_REFUSED'); assert.deepEqual(revoked.details.sources, []);
  const deniedCalls = calls; assert.equal((await invoke()).isError, true); assert.equal(calls, deniedCalls);
  mode = 'normal'; assert.equal((await invoke()).isError, undefined);
  mode = 'cancel'; assert.equal((await invoke()).details.reason, 'ORIGINAL_OPERATION_CANCELLED');
  const cancelledCalls = calls; assert.equal((await invoke()).isError, true); assert.equal(calls, cancelledCalls);
  const defaults = []; spec.make()({ registerTool: row => defaults.push(row) });
  const unconfigured = await defaults.find(row => row.name === tool.name).execute('synthetic', spec.input, undefined, undefined, { model });
  assert.equal(unconfigured.isError, true); assert.equal(unconfigured.details.status, 'unconfigured');
});
