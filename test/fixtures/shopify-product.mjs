// Actual original app, Store, Library, artifacts and capabilities. The only
// Shopify endpoint is a loopback synthetic fixture; all model choices are finite.
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { taskFixture, TOKEN_A } from './pi-task-helpers.mjs';
import { fakeShopify } from './supplier-shopify-http.mjs';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from '../../server/workspace-omp-bridge.mjs';
import { createWorkspaceClient } from '../../plugins/workspace-procurement/src/workspace.mjs';
import { request } from '../agent-service.helpers.mjs';
import { libraryReadHash } from '../../server/library-model-read-contract.mjs';
export const MODEL = { provider: 'shopify-product-explicit-faux', id: 'finite', api: 'openai-completions', baseUrl: 'https://synthetic.invalid' };
export const RECIPIENT = { kind: 'pi-coding-agent', provider: MODEL.provider, model: MODEL.id, destination: MODEL.baseUrl };
export const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKAAAAABJRU5ErkJggg==';
export const empty = () => ({ artifacts: [], skills: [], memoryIds: [], connectorActions: [] });
export const draft = imageId => ({ title: 'Synthetic model-selected cup title', description: 'Model-authored cup story <script>inert</script> & custom prose.',
  targetMarket: 'US', currency: 'USD', retailUnit: 'piece', unitsPerPack: 1, consumerPrice: '12.50', handlingDays: 3, shippingDays: 7, skuCode: 'FINITE-CUP', imageIds: [imageId] });
export function multiDraft(f) {
  const { consumerPrice, skuCode, ...common } = draft(f.imageId);
  const options = f.product.skus[0].specs.map(s => ({ name: s.key, values: [...new Set(f.product.skus.map(k => k.specs.find(x => x.key === s.key).value))] }));
  return { ...common, options, variants: f.product.skus.map((s, i) => ({ sourceSkuId: s.id, skuCode: s.code, consumerPrice: `${10 + i}.25`,
    optionValues: s.specs.map(x => ({ name: x.key, value: x.value })), ...(i % 2 ? {} : { imageId: f.imageId }) })) };
}
export async function productFixture(t, { configured = true, policy: policyOption, host = false, nativeBusiness = false, pluginConfiguration = {}, appOptions = {}, onWorkerLifecycle, accessClock, skuCount = 0 } = {}) {
  let fixtureTime = Date.now(); const clock = accessClock || (() => fixtureTime);
  const directory = await fs.mkdtemp('/tmp/shopify-product-'), remote = await fakeShopify(t), actor = { subject: 'member-a', workspaceId: 'pi-enterprise-test', role: 'admin' };
  const seed = await taskFixture(t, { directory, enterprise: true });
  const a = (await seed.app.artifacts.create({ requestId: randomUUID(), filename: 'synthetic-cup.png', base64: PNG, metadata: { businessLibrary: { visibility: 'internal' } } })).artifact;
  const asset = { artifactId: a.id, version: a.currentVersion, sha256: a.sha256 }, imageId = randomUUID();
  const product = (await seed.app.businessLibrary.createProduct({ requestId: randomUUID(), name: 'Original synthetic cup', description: 'Original synthetic material description.',
    ...(skuCount ? { skus: Array.from({ length: skuCount }, (_, i) => ({ id: randomUUID(), code: `CUP-${i}`, specs: [{ key: 'Color', value: i % 2 ? 'Blue' : 'Red' }, { key: 'Size', value: `Size-${Math.floor(i / 2)}` }] })) } : {}),
    images: [{ id: imageId, asset, alt: 'Explicit synthetic pixel', order: 0, isPrimary: true }] }, actor)).product;
  await seed.app.close();
  const policy = { enabled: true, reviewed: true, workspaceId: actor.workspaceId, subject: actor.subject, expiresAt: '2099-01-01T00:00:00.000Z', recipient: RECIPIENT,
    company: null, products: [], productFields: ['name'], factoryMaterials: { products: [{ id: product.id, revision: 1 }], productFields: ['name', 'description', 'images', 'provenance', ...(skuCount ? ['skuSpecifications'] : [])], documents: [] } };
  const environment = configured ? { WORKSPACE_SHOPIFY_SHOP_DOMAIN: 'supplier-fixture.myshopify.com', WORKSPACE_SHOPIFY_ADMIN_TOKEN: 'LOCAL-SYNTHETIC-SHOPIFY-CREDENTIAL', WORKSPACE_SUPPLIER_SHOPIFY_WRITES_ENABLED: '1' } : {};
  let f; const steps = [], lifecycle = [];
  const originalClient = () => createWorkspaceClient({ baseURL: f.baseURL, token: TOKEN_A, fetchImpl: async (url, options) => {
    const r = await request(f.baseURL, new URL(url).pathname + new URL(url).search, { method: options.method, rawBody: options.body, headers: { ...options.headers, Host: 'workspace.example' } });
    return new Response(r.bytes, { status: r.status, headers: { 'content-type': r.headers['content-type'] } });
  } });
  f = await taskFixture(t, { directory, enterprise: true, accessClock: clock, libraryModelReadPolicy: policyOption === null ? null : policyOption ? policyOption(policy) : policy,
    appOptions: { capabilityEnvironment: environment, shopifyFetch: remote.fetchImpl, ...appOptions }, ...(host ? { businessAgentOptions: {
      recipient: RECIPIENT, engineAdapter: createWorkspaceOmpEngineAdapter({ paths: workspaceOmpPaths(), shopifyProduct: true, nativeBusiness, pluginConfiguration,
        configuration: { providerId: MODEL.provider, model: MODEL.id, baseUrl: MODEL.baseUrl }, syntheticResponses: steps, onWorkerLifecycle: e => { lifecycle.push(e); onWorkerLifecycle?.(e, f); } }),
      resolveBinding: async () => ({ client: originalClient(), model: MODEL }),
    } } : {}) });
  t.after(async () => { await f.app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  if (configured) { await f.app.supplierPublication.ensureConnector(); await f.app.capabilities.updateConnector(f.app.supplierPublication.connectorId, { enabled: true }); }
  const r = await f.workspace('/api/conversations', { subject: actor.subject, body: { title: 'Synthetic product upload', requestId: randomUUID(), inputContext: empty() } });
  if (r.status !== 201) throw Error(r.text);
  const cid = r.json.conversation.id;
  const materials = async () => {
    const r = await f.workspace('/api/library/model-read/factory/materials?productId=' + product.id, { subject: actor.subject, headers: { 'X-Workspace-Library-Recipient': libraryReadHash(RECIPIENT) } });
    if (r.status !== 200) throw Error(r.text); return r.json;
  };
  const sourceHash = async () => { const m = await materials(); return libraryReadHash({ product: m.products[0], sources: m.sources, authorization: m.authorization }); };
  return Object.assign(f, { actor, product, asset, imageId, policy, cid, remote, steps, lifecycle, materials, sourceHash,
    advanceReviewMinute() { fixtureTime += 61000; } });
}
