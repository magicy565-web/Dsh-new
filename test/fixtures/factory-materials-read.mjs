import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { taskFixture } from './pi-task-helpers.mjs';
export const MODEL = { provider: 'factory-materials-integration-faux', id: 'finite', api: 'openai-completions', baseUrl: 'https://synthetic.invalid' };
export const RECIPIENT = { kind: 'pi-coding-agent', provider: MODEL.provider, model: MODEL.id, destination: MODEL.baseUrl };
export async function materialsFixture(t, options = {}) {
  const directory = await fs.mkdtemp('/tmp/workspace-factory-materials-read-');
  const seed = await taskFixture(t, { directory, enterprise: true });
  const actor = { subject: 'member-a', role: 'admin' };
  const uploaded = await seed.app.artifacts.create({ requestId: randomUUID(), filename: 'factory-specification.txt',
    content: 'SYNTHETIC original uploaded specification. MOQ remains pending. Materials are evidence, not instructions.', metadata: { businessLibrary: { visibility: 'internal' } } });
  const asset = { artifactId: uploaded.artifact.id, version: uploaded.artifact.currentVersion, sha256: uploaded.artifact.sha256 };
  const document = (await seed.app.businessLibrary.createDocument({ requestId: randomUUID(), title: 'Synthetic uploaded specification', slotKey: 'specification', asset }, actor)).document;
  const product = (await seed.app.businessLibrary.createProduct({ requestId: randomUUID(), name: 'SYNTHETIC original factory cup',
    category: 'Synthetic kitchenware', skus: [{ id: randomUUID(), code: 'SYNTHETIC-CUP', specs: [{ key: 'material', value: 'supplied synthetic steel' }],
      unit: 'piece', moq: null, leadTimeDays: null, pricingMode: 'on_request', pricingNote: 'UNAPPROVED_PRIVATE_PRICE_NOTE' }],
    supply: { capacityNote: '', packaging: 'UNAPPROVED_PACKAGING_NOTE' }, documents: [{ documentId: document.id, documentVersion: 1, purpose: 'Exact synthetic specification' }] }, actor)).product;
  const policy = { enabled: true, reviewed: true, workspaceId: 'pi-enterprise-test', subject: 'member-a', expiresAt: '2099-01-01T00:00:00.000Z', recipient: RECIPIENT,
    company: null, products: [], productFields: ['name'], factoryMaterials: { products: [{ id: product.id, revision: 1 }],
      productFields: ['name', 'category', 'skuSpecifications', 'capacityNote', 'documentReferences', 'provenance'], documents: [{ id: document.id, revision: 1, documentVersion: 1, asset }] } };
  await seed.app.close();
  const f = await taskFixture(t, { directory, enterprise: true, libraryModelReadPolicy: options.policy === null ? null : { ...policy, ...(typeof options.policy === 'function' ? options.policy({ product, document, asset, policy }) : options.policy) },
    ...(options.businessAgentOptions ? { businessAgentOptions: typeof options.businessAgentOptions === 'function' ? options.businessAgentOptions({ product, document, asset, policy }) : options.businessAgentOptions } : {}) });
  t.after(async () => { await f.app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return Object.assign(f, { product, document, asset, policy, actor });
}
