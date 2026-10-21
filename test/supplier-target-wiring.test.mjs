// S2b wiring: the supplier publication flow must select the reviewed commerce
// target from host configuration and register exactly one adapter for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createApp } from '../server/index.mjs';

const MEDUSA_ENV = {
  WORKSPACE_SUPPLIER_PUBLICATION_TARGET: 'medusa',
  WORKSPACE_MEDUSA_BASE_URL: 'https://medusa.example.test',
  WORKSPACE_MEDUSA_SECRET_API_KEY: 'sk_synthetic_medusa_key_0001',
  WORKSPACE_MEDUSA_SALES_CHANNEL_ID: 'sc_default',
  WORKSPACE_SUPPLIER_MEDUSA_WRITES_ENABLED: '1',
};
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

async function open(t, environment) {
  const directory = await fs.mkdtemp('/tmp/supplier-target-');
  const calls = [];
  const medusaFetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push(`${init.method || 'GET'} ${path}`);
    if (path === '/admin/stores') return json({ stores: [{ id: 'store_1', default_currency_code: 'usd' }] });
    if (path === '/admin/sales-channels') return json({ sales_channels: [{ id: 'sc_default' }] });
    if (path === '/admin/products') return json({ products: [], count: 0 });
    return json({});
  };
  const app = await createApp({ dataDirectory: directory, capabilityEnvironment: environment, medusaFetch, shopifyFetch: medusaFetch });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { app, calls };
}

test('the default supplier target stays Shopify', async t => {
  const { app } = await open(t, {});
  assert.equal(app.supplierPublication.status().apiVersion, '2026-10');
  const created = await app.supplierPublication.ensureConnector();
  assert.equal(created.adapter, 'workspace-supplier-shopify');
  assert.deepEqual(created.capabilities.slice().sort(), ['supplier.shopify.draft', 'supplier.shopify.publish', 'supplier.shopify.repair_draft'].sort());
});

test('selecting medusa registers only the Medusa adapter and its credential', async t => {
  const { app } = await open(t, MEDUSA_ENV);
  const status = app.supplierPublication.status();
  assert.equal(status.apiVersion, 'admin-v2');
  assert.equal(status.salesChannelConfigured, true);
  const created = await app.supplierPublication.ensureConnector();
  assert.equal(created.adapter, 'workspace-supplier-medusa');
  assert.deepEqual(created.capabilities.slice().sort(), ['supplier.medusa.draft', 'supplier.medusa.publish', 'supplier.medusa.repair_draft'].sort());
  assert.deepEqual(created.credentialRefs, { medusa: 'WORKSPACE_MEDUSA_SECRET_API_KEY' });
  assert.equal(app.capabilities.listConnectors().filter(item => item.adapter === 'workspace-supplier-shopify').length, 0);
});

test('an unknown target is rejected before the app starts', async () => {
  const directory = await fs.mkdtemp('/tmp/supplier-target-bad-');
  await assert.rejects(createApp({ dataDirectory: directory, capabilityEnvironment: { WORKSPACE_SUPPLIER_PUBLICATION_TARGET: 'etsy' } }), /shopify or medusa/u);
  await fs.rm(directory, { recursive: true, force: true });
});
