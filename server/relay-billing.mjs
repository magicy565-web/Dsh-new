/** Paid acceptance prerequisites are operator declarations, never quota enforcement. */
export function assertRelayAcceptanceBilling(environment) {
  const mode = environment.WORKSPACE_ACCEPTANCE_KEY_BILLING_MODE;
  const group = environment.WORKSPACE_ACCEPTANCE_MODEL_GROUP;
  const currency = environment.WORKSPACE_ACCEPTANCE_ACCOUNT_CURRENCY;
  if (environment.WORKSPACE_ACCEPTANCE_TOTAL_CAP_CNY !== '5'
    || environment.WORKSPACE_ACCEPTANCE_HARD_CAP_VERIFIED !== '1') throw new Error('Selected relay acceptance requires a verified CNY5 cumulative hard cap.');
  if (!['token-only', 'prefer-per-call'].includes(mode)
    || typeof group !== 'string' || !/^[A-Za-z0-9\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff _.:-]{0,79}$/u.test(group)
    || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)
    || environment.WORKSPACE_ACCEPTANCE_BILLING_REVIEWED !== '1') {
    throw new Error('Review the selected key billing mode, exact gpt-6-sol model group/pricing and account currency before paid acceptance. Token rates alone are insufficient.');
  }
  if (environment.WORKSPACE_ACCEPTANCE_HARD_CAP_SEMANTICS_VERIFIED !== '1') {
    throw new Error('Verify the CNY5 hard cap covers currency conversion, in-flight requests, all retries and native internal calls before paid acceptance. Requested max_tokens is not a hard cost guarantee.');
  }
  return Object.freeze({ evidenceSource: 'operator-declaration', independentlyVerified: false,
    totalCapCny: 5, keyBillingMode: mode, modelGroup: group, accountCurrency: currency,
    exactModelPricingReviewed: true, cumulativeHardCapSemanticsReviewed: true,
    requestTokenLimitEnforcedByProvider: 'unverified' });
}
