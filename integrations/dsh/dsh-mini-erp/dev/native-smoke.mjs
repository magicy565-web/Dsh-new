import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ERP from '../index.js';
import { LibraryStore, createLibraryService } from '../../dsh-workspace-library/index.js';
import { blocksFromErp } from '../../dsh-sourcing-agent/skills/buyer-magazine/scripts/from-erp.mjs';
import { renderIssue } from '../../dsh-sourcing-agent/skills/buyer-magazine/scripts/render.mjs';
if (!process.env.DSH_RUNTIME_DIR) throw new Error('Set DSH_RUNTIME_DIR');
const require = createRequire(join(resolve(process.env.DSH_RUNTIME_DIR), 'package.json'));
const load = name => import(require.resolve(`@deepseek-ai/${name}`));
const { Context } = await load('cordis');
const { default: SystemPrompt } = await load('dsh-system-prompt');
const { default: Tools } = await load('dsh-tools');
const root = await mkdtemp(join(tmpdir(), 'native-mini-erp-'));
const library = createLibraryService(new LibraryStore({ dir: join(root, 'library') }));
const sourceProduct = await library.saveProduct({ changes: { name: 'Synthetic native product', skus: [{ id: 'native-sku', code: 'NATIVE-TEST', pricingMode: 'tiered', priceTiers: [{ minQuantity: 1, unitPrice: '20.00', currency: 'USD' }] }] } });
const workspace = { id: 'workspace-native-erp', sessionIds: ['session-native-erp'] };
async function boot() {
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt); await ctx.plugin(Tools);
    await ctx.plugin({ apply(scope) { scope.provide('workspaceRegistry', { list: () => [workspace] }); scope.provide('workspaceLibrary', library); } });
    await ctx.plugin(ERP, { dataDir: root }); return ctx;
  } catch (error) { await ctx.fiber.dispose(); throw error; }
}
let ctx;
const execute = async (name, args) => {
  const result = await ctx.tools.execute({ name, arguments: args, agent: { session: { id: 'session-native-erp' } }, callId: `call-${args.requestId ?? 'read'}`, signal: new AbortController().signal });
  assert.equal(result.isError, false, JSON.stringify(result)); return result.value;
};
try {
  ctx = await boot();
  await execute('mini_erp_catalog', { action: 'link_sku', requestId: 'p', id: 'sku', catalogProductId: sourceProduct.id, skuId: 'native-sku', catalogRevision: sourceProduct.revision, stockTotal: 5 });
  await execute('mini_erp_catalog', { action: 'add_buyer', requestId: 'b', id: 'buyer', name: 'Synthetic buyer', contact: 'test@example.test' });
  await execute('mini_erp_catalog', { action: 'add_offer', requestId: 'offer', id: 'rights', productId: 'sku', territory: 'US', channel: 'gift-retail', term: 'Synthetic term', conditions: 'Synthetic rights', capacity: 1, validUntil: new Date(Date.now() + 86400000).toISOString(), source: 'Native fixture only' });
  const snapshot = await execute('mini_erp_read', { entity: 'supply', id: 'sku', offerId: 'rights' });
  const draft = blocksFromErp(snapshot, { modules: ['procurement', 'exclusive'], language: 'en' });
  const html = renderIssue({ title: 'Synthetic ERP magazine check', audience: 'Test only', language: 'en', preview: true, blocks: draft.blocks });
  assert.match(html, /USD 20\.00/); assert.match(html, /ERP-recorded terms/);
  assert.equal(draft.blocks[1].data.slots, 1);
  assert.equal((await execute('mini_erp_read', { entity: 'order' })).items.length, 0);
  const held = await execute('mini_erp_order', { action: 'reserve', requestId: 'reserve', productId: 'sku', buyerId: 'buyer', expectedRevision: 1, expectedCatalogRevision: sourceProduct.revision, quantity: 2, offerId: 'rights' });
  assert.equal(held.current.status, 'reserved');
  assert.equal((await execute('mini_erp_read', { entity: 'offer', id: 'rights' })).availableSlots, 0);
  const updated = blocksFromErp(await execute('mini_erp_read', { entity: 'supply', id: 'sku', offerId: 'rights' }), { modules: ['exclusive'] });
  assert.equal(updated.blocks[0].data.slots, 0); assert.equal(draft.blocks[1].data.slots, 1);
  await execute('mini_erp_order', { action: 'confirm', requestId: 'confirm', orderId: held.id });
  await ctx.fiber.dispose(); ctx = await boot();
  assert.equal((await execute('mini_erp_read', { entity: 'order', id: held.id })).status, 'confirmed');
  assert.equal((await execute('mini_erp_read', { entity: 'product', id: 'sku' })).available, 3);
  console.log('OK: official ToolRuntime, supply snapshot -> selected magazine blocks -> HTML without orders; stock+slot reservation updates fresh snapshots, confirmation and restart persist. Synthetic records and fixture session; no model calls.');
} finally { await ctx?.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
