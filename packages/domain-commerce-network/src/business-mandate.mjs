// Commercial agreements describe business terms. They never grant tool access,
// debit a wallet, create an invoice, or replace the existing Worker grants.
export const BUSINESS_MODES = Object.freeze({
  factory_sales: "工厂海外销售代运营",
  channel_subscription: "渠道与代发经营",
  sourcing_commission: "采购代理与中介服务",
});
export const BUSINESS_CURRENCIES = Object.freeze(["USD", "EUR", "GBP", "CNY"]);
const fail = (code) => {
  throw new Error(code);
};
const keys = (value, names) => {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).some((k) => !names.includes(k))
  )
    fail("BUSINESS_TERMS_INVALID");
};
const amount = (value) =>
  value === null ||
  (Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000);
const date = (value) =>
  value === null ||
  (typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value);
const bounded = (v, max) => typeof v === "string" && v.length <= max;

export function validateBusinessTerms(
  input,
  { complete = false, now = Date.now() } = {},
) {
  keys(input, [
    "version",
    "mode",
    "currency",
    "startDate",
    "endDate",
    "fixedFeeMinor",
    "monthlyFeeMinor",
    "aiCredits",
    "commission",
    "agreementEvidence",
  ]);
  if (
    !Object.hasOwn(BUSINESS_MODES, input.mode) ||
    !BUSINESS_CURRENCIES.includes(input.currency) ||
    !Number.isSafeInteger(input.version) ||
    input.version < 1
  )
    fail("BUSINESS_TERMS_INVALID");
  if (
    !date(input.startDate) ||
    !date(input.endDate) ||
    (input.startDate && input.endDate && input.endDate < input.startDate)
  )
    fail("BUSINESS_DATES_INVALID");
  if (
    !amount(input.fixedFeeMinor) ||
    !amount(input.monthlyFeeMinor) ||
    !bounded(input.agreementEvidence, 2000)
  )
    fail("BUSINESS_TERMS_INVALID");
  keys(input.aiCredits, ["payer", "policy"]);
  if (
    !["principal", "operator"].includes(input.aiCredits.payer) ||
    !bounded(input.aiCredits.policy, 2000)
  )
    fail("BUSINESS_TERMS_INVALID");
  if (
    input.mode === "factory_sales" &&
    (input.monthlyFeeMinor !== null || input.aiCredits.payer !== "principal")
  )
    fail("BUSINESS_FEE_CONFLICT");
  if (
    input.mode === "channel_subscription" &&
    (input.fixedFeeMinor !== null || input.commission !== null)
  )
    fail("BUSINESS_FEE_CONFLICT");
  if (
    input.mode === "sourcing_commission" &&
    (input.fixedFeeMinor !== null ||
      input.monthlyFeeMinor !== null ||
      input.aiCredits.payer !== "operator")
  )
    fail("BUSINESS_FEE_CONFLICT");
  if (input.mode !== "channel_subscription") {
    keys(input.commission, ["rateBps", "basis", "trigger", "refundRule"]);
    const c = input.commission;
    if (
      !(
        c.rateBps === null ||
        (Number.isInteger(c.rateBps) && c.rateBps >= 0 && c.rateBps <= 10000)
      ) ||
      ![null, "net_collected_goods"].includes(c.basis) ||
      ![null, "verified_collection"].includes(c.trigger) ||
      ![null, "proportional_reversal"].includes(c.refundRule)
    )
      fail("BUSINESS_COMMISSION_INVALID");
    if (input.mode === "sourcing_commission" && c.rateBps === 0)
      fail("BUSINESS_COMMISSION_INVALID");
  }
  if (complete) {
    if (
      !input.startDate ||
      !input.endDate ||
      !input.aiCredits.policy.trim() ||
      !input.agreementEvidence.trim()
    )
      fail("BUSINESS_TERMS_INCOMPLETE");
    // End date includes that UTC calendar day; display the explicit convention.
    if (Date.parse(input.endDate) + 86400_000 <= now)
      fail("BUSINESS_TERMS_EXPIRED");
    if (
      (input.mode === "factory_sales" && input.fixedFeeMinor === null) ||
      (input.mode === "channel_subscription" && input.monthlyFeeMinor === null)
    )
      fail("BUSINESS_TERMS_INCOMPLETE");
    if (
      input.commission &&
      Object.values(input.commission).some((v) => v === null)
    )
      fail("BUSINESS_TERMS_INCOMPLETE");
  }
  return structuredClone(input);
}

export function businessTermStatus(mandate, now = Date.now()) {
  if (!mandate.businessTerms || mandate.status !== "active")
    return mandate.status;
  const t = mandate.businessTerms;
  if (t.endDate && Date.parse(t.endDate) + 86400_000 <= now) return "expired";
  if (t.startDate && Date.parse(t.startDate) > now) return "scheduled";
  return "active";
}
