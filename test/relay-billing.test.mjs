import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRelayAcceptanceBilling } from '../server/relay-billing.mjs';
const synthetic = { WORKSPACE_ACCEPTANCE_TOTAL_CAP_CNY: '5', WORKSPACE_ACCEPTANCE_HARD_CAP_VERIFIED: '1', WORKSPACE_ACCEPTANCE_KEY_BILLING_MODE: 'token-only', WORKSPACE_ACCEPTANCE_MODEL_GROUP: 'synthetic-fixture-group', WORKSPACE_ACCEPTANCE_ACCOUNT_CURRENCY: 'CNY', WORKSPACE_ACCEPTANCE_BILLING_REVIEWED: '1', WORKSPACE_ACCEPTANCE_HARD_CAP_SEMANTICS_VERIFIED: '1' };
test('paid relay acceptance refuses unknown billing mode, group, currency, pricing or aggregate cap semantics', () => {
  for (const key of Object.keys(synthetic)) { const config = { ...synthetic }; delete config[key]; assert.throws(() => assertRelayAcceptanceBilling(config)); }
  for (const mode of ['automatic', 'token', 'unknown']) assert.throws(() => assertRelayAcceptanceBilling({ ...synthetic, WORKSPACE_ACCEPTANCE_KEY_BILLING_MODE: mode }));
  assert.throws(() => assertRelayAcceptanceBilling({ ...synthetic, WORKSPACE_ACCEPTANCE_TOTAL_CAP_CNY: '6' }));
});
test('billing metadata records explicit declarations without mistaking flags or requested token limits for enforcement', () => {
  for (const mode of ['token-only', 'prefer-per-call']) {
    const value = assertRelayAcceptanceBilling({ ...synthetic, WORKSPACE_ACCEPTANCE_KEY_BILLING_MODE: mode });
    assert.equal(value.totalCapCny, 5); assert.equal(value.independentlyVerified, false);
    assert.equal(value.requestTokenLimitEnforcedByProvider, 'unverified'); assert.equal(value.keyBillingMode, mode);
  }
});
