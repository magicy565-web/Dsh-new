import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ERP from '../index.js';
if (!process.env.DSH_RUNTIME_DIR) throw new Error('Set DSH_RUNTIME_DIR');
const require = createRequire(join(resolve(process.env.DSH_RUNTIME_DIR), 'package.json'));
const load = name => import(require.resolve(`@deepseek-ai/${name}`));
const { Context } = await load('cordis');
const { default: SystemPrompt } = await load('dsh-system-prompt');
const { default: Tools } = await load('dsh-tools');
const root = await mkdtemp(join(tmpdir(), 'native-mini-erp-'));
const workspace = { id: 'workspace-native-erp', sessionIds: ['session-native-erp'] };
async function boot() {
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt); await ctx.plugin(Tools);
    await ctx.plugin({ apply(scope) { scope.provide('workspaceRegistry', { list: () => [workspace] }); } });
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
  await execute('mini_erp_catalog', { action: 'add_product', requestId: 'p', id: 'sku', name: 'Synthetic native product', currency: 'USD', unitPriceMinor: 2000, stockTotal: 5, source: 'Native test only' });
  await execute('mini_erp_catalog', { action: 'add_buyer', requestId: 'b', id: 'buyer', name: 'Synthetic buyer', contact: 'test@example.test' });
  await execute('mini_erp_catalog', { action: 'add_offer', requestId: 'offer', id: 'rights', productId: 'sku', territory: 'US', channel: 'gift-retail', term: 'Synthetic term', conditions: 'Synthetic rights', capacity: 1, validUntil: new Date(Date.now() + 86400000).toISOString(), source: 'Native fixture only' });
  const held = await execute('mini_erp_order', { action: 'reserve', requestId: 'reserve', productId: 'sku', buyerId: 'buyer', expectedRevision: 1, quantity: 2, offerId: 'rights' });
  assert.equal(held.current.status, 'reserved');
  assert.equal((await execute('mini_erp_read', { entity: 'offer', id: 'rights' })).availableSlots, 0);
  await execute('mini_erp_order', { action: 'confirm', requestId: 'confirm', orderId: held.id });
  await ctx.fiber.dispose(); ctx = await boot();
  assert.equal((await execute('mini_erp_read', { entity: 'order', id: held.id })).status, 'confirmed');
  assert.equal((await execute('mini_erp_read', { entity: 'product', id: 'sku' })).available, 3);
  console.log('OK: official ToolRuntime, catalog, stock+slot reservation, confirmation and persistence after restart. Synthetic records and fixture session; no model calls.');
} finally { await ctx?.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
