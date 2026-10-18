import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnterpriseContextService, enterpriseContextToolDefinitions } from '../plugins/workspace-enterprise-context/src/service.mjs';
import { enterpriseContextExtension } from '../plugins/workspace-enterprise-context/src/extension.js';
import { createMedusaCatalogService, medusaCatalogToolDefinitions } from '../plugins/workspace-medusa-catalog/src/service.mjs';
import { medusaCatalogExtension } from '../plugins/workspace-medusa-catalog/src/extension.js';

// P-layer: actual package factories, finite in-process Host clients; no SDK,
// HTTP server, database, account or real provider is represented by these doubles.
const model = { provider: 'synthetic', id: 'selected' };
const productId = '11111111-1111-4111-8111-111111111111';
const fields = { subjectType: 'company', subjectId: 'fixture', factKey: 'moq' };
const suites = [
  { name: 'enterprise', create: createEnterpriseContextService, extension: enterpriseContextExtension,
    method: 'structuredMemoryRemember', tool: 'workspace_enterprise_context_structured_memory_remember',
    input: { ...fields, statement: 'Synthetic MOQ 100' }, selection: { enabledMethods: ['structuredMemoryRemember'] },
    result: { status: 'stored', statement: 'Synthetic MOQ 100' }, refused: 'ENTERPRISE_CONTEXT_AUTHORIZATION_REFUSED' },
  { name: 'medusa', create: createMedusaCatalogService, extension: medusaCatalogExtension,
    method: 'preview', tool: 'workspace_medusa_preview', input: { productId }, selection: {},
    result: { plugin: 'workspace-medusa-catalog', status: 'available', method: 'preview', input: { productId } },
    refused: 'ORIGINAL_MEDUSA_OPERATION_REFUSED' },
];
function fixture(row, change = {}) {
  const calls = [];
  const controller = new AbortController();
  const options = { ...row.selection,
    authorize: async (signal, receiver) => { calls.push('authorize'); assert.equal(signal, controller.signal); assert.equal(receiver, model); return true; },
    client: { [row.method]: async (input, signal, receiver) => {
      calls.push('operation'); assert.deepEqual(input, row.input); assert.equal(signal, controller.signal); assert.equal(receiver, model);
      return structuredClone(row.result);
    } }, ...change };
  return { options, calls, controller };
}
for (const row of suites) {
  test(`${row.name}: registration has no calls; tool and service share guarded operation and exact receipt`, async () => {
    const a = fixture(row), service = row.create(a.options), tools = [];
    const b = fixture(row); row.extension(b.options)({ registerTool: t => tools.push(t) });
    assert.deepEqual(a.calls, []); assert.deepEqual(b.calls, []);
    const receipt = await service[row.method](row.input, a.controller.signal, model);
    const result = await tools.find(t => t.name === row.tool).execute('call', row.input, b.controller.signal, null, { model });
    assert.deepEqual(result.details, receipt);
    assert.equal(result.content[0].text, JSON.stringify(receipt));
    assert.deepEqual(a.calls, ['authorize', 'operation', 'authorize']);
    assert.deepEqual(b.calls, a.calls);
  });
  test(`${row.name}: no Host is unconfigured; foreign fields and missing model never call client`, async () => {
    assert.equal((await row.create(row.selection)[row.method](row.input, null, model)).status, 'unconfigured');
    const f = fixture(row), service = row.create(f.options);
    assert.equal((await service[row.method]({ ...row.input, approved: true }, f.controller.signal, model)).status, 'blocked');
    assert.equal((await service[row.method](row.input, f.controller.signal, undefined)).status, 'blocked');
    assert.deepEqual(f.calls, []);
  });
  test(`${row.name}: pre-call cancellation prevents work; cancellation after completion withholds receipt`, async () => {
    const f = fixture(row); f.controller.abort();
    assert.equal((await row.create(f.options)[row.method](row.input, f.controller.signal, model)).status, 'blocked');
    assert.deepEqual(f.calls, []);
    const late = fixture(row); let committed = 0;
    late.options.client[row.method] = async () => { committed++; late.controller.abort(); return row.result; };
    const result = await row.create(late.options)[row.method](row.input, late.controller.signal, model);
    assert.equal(committed, 1); assert.equal(result.status, 'blocked');
    assert.equal(result.statement, undefined); assert.equal(result.method, undefined);
    // Refusal after a possible write is not evidence that the write rolled back.
  });
  test(`${row.name}: final authorization runs on both success and error; no retry or private error echo`, async () => {
    for (const failing of [false, true]) {
      const f = fixture(row); let checks = 0, operations = 0;
      f.options.authorize = async () => { if (++checks === 2) throw Error('PRIVATE revoke detail'); return true; };
      f.options.client[row.method] = async () => { operations++; if (failing) throw Error('PRIVATE service detail'); return row.result; };
      const result = await row.create(f.options)[row.method](row.input, f.controller.signal, model);
      assert.equal(result.status, 'blocked'); assert.equal(result.reason, row.refused);
      assert.equal(checks, 2); assert.equal(operations, 1); assert(!JSON.stringify(result).includes('PRIVATE'));
    }
  });
}
test('enterprise: service selection is immutable and disabled methods are absent', async () => {
  const enabledMethods = ['status']; let calls = 0;
  const service = createEnterpriseContextService({ enabledMethods, authorize: async () => true,
    client: { status: async () => { calls++; return { status: 'available' }; } } });
  enabledMethods.push('parseUpload');
  assert.deepEqual(Object.keys(service), ['status']); assert(Object.isFrozen(service));
  assert.equal((await service.status({}, null, model)).status, 'available'); assert.equal(calls, 1);
  assert.equal(service.parseUpload, undefined);
});
test('enterprise: native tuple projection stays correlated and rejects mismatched method selections', () => {
  const nativeCapabilities = { schema: 'workspace.native-document-capabilities.v1', methods: ['parseUpload'],
    sources: [1, 2].map(n => ({ documentId: `doc-${n}`, revision: n, documentVersion: n,
      asset: { artifactId: `asset-${n}`, version: n, sha256: String(n).repeat(64) } })), queries: [fields] };
  const defs = enterpriseContextToolDefinitions({ enabledMethods: ['parseUpload'], nativeCapabilities });
  assert.equal(defs.length, 1);
  assert.deepEqual(defs[0].parameters.oneOf.map(x => Object.fromEntries(Object.entries(x.properties).map(([k,v]) => [k,v.const]))), nativeCapabilities.sources.map(s => s.asset));
  assert.throws(() => createEnterpriseContextService({ enabledMethods: ['status'], nativeCapabilities }), /OSS_NATIVE_DOCUMENT_CAPABILITIES_REFUSED/);
});
test('tool schemas are independent projections; registration cannot mutate service contract', () => {
  const e = enterpriseContextToolDefinitions(), m = medusaCatalogToolDefinitions();
  e[0].parameters.properties.approved = { type: 'boolean' }; m[1].parameters.properties.productId.pattern = '.*';
  assert.deepEqual(enterpriseContextToolDefinitions()[0].parameters.properties, {});
  assert.notEqual(medusaCatalogToolDefinitions()[1].parameters.properties.productId.pattern, '.*');
});
test('Medusa: malformed receipt and invalid product ID remain blocked', async () => {
  let calls = 0;
  const service = createMedusaCatalogService({ authorize: async () => {}, client: { preview: async () => { calls++; return { plugin: 'another-plugin' }; } } });
  assert.equal((await service.preview({ productId: 'arbitrary' }, null, model)).status, 'blocked');
  assert.equal(calls, 0);
  assert.equal((await service.preview({ productId }, null, model)).status, 'blocked');
  assert.equal(calls, 1);
});
