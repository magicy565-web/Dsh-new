// Cross-branch profile boundaries: configuration only, no provider/remote I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceOmpBusinessOptions } from '../server/workspace-omp-host.mjs';
import { createWorkspaceOmpSession } from '../server/workspace-omp-session.mjs';

const configured = { PI_PROVIDER: 'deepseek', PI_MODEL: 'deepseek-flash', DEEPSEEK_API_KEY: 'synthetic-unused-integration-fixture',
  WORKSPACE_OMP_PROVIDER_COST_JSON: JSON.stringify({ input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0.3 }), WORKSPACE_OMP_LIVE_BUDGET_VERIFIED: '1' };
const privateProfiles = ['factory-materials', 'factory-customers', 'factory-inquiries', 'factory-ingestion', 'market-validation', 'shopify-product'];

test('local file and original Session read profiles reject Shopify flags/clients before SDK or I/O', async () => {
  await assert.rejects(createWorkspaceOmpSession({ localSession: {}, shopifyProduct: true }), /LOCAL_SESSION_PROFILE_REFUSED/);
  for (const remote of [{ shopifyProduct: true }, { productClient: {} }]) {
    await assert.rejects(createWorkspaceOmpSession({ localFactory: {}, ...remote }), /Local factory files cannot inherit/);
    await assert.rejects(createWorkspaceOmpSession({ readOnlyBusiness: true, ...remote }), /Session business reads require/);
  }
});

test('merged Host keeps public Session reads and refuses to substitute them for private remote profiles', async () => {
  let sessionReads = 0;
  const client = { readOnlySession: true }, actor = { subject: 'synthetic-owner' };
  const input = { actor, sessionReadonlyClient(value) { assert.equal(value, actor); sessionReads++; return client; } };
  const publicOptions = createWorkspaceOmpBusinessOptions({ environment: configured });
  assert.equal((await publicOptions.resolveBinding(input)).client, client); assert.equal(sessionReads, 1);
  for (const profile of privateProfiles) {
    const options = createWorkspaceOmpBusinessOptions({ environment: { ...configured, WORKSPACE_OMP_PROFILE: profile } });
    assert.equal(await options.resolveBinding(input), null, profile);
  }
  assert.equal(sessionReads, 1);
});

test('unconfigured merged profiles return unavailable without resolving a model or remote Session', async () => {
  for (const profile of ['public', ...privateProfiles]) {
    const options = createWorkspaceOmpBusinessOptions({ environment: { WORKSPACE_OMP_PROFILE: profile } });
    assert.equal(await options.resolveBinding({ sessionReadonlyClient() { assert.fail('No Session substitute when model is unconfigured'); } }), null, profile);
  }
});
