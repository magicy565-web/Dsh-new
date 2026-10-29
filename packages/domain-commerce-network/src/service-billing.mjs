import { validateBusinessTerms } from "./business-mandate.mjs";
const fail = (code) => {
  throw new Error(code);
};
const day = (value) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail("BILLING_PERIOD_INVALID");
  return value;
};
const date = (ms) => day(new Date(ms).toISOString().split("T")[0]);
function anniversary(start, offset) {
  const base = new Date(start),
    year = base.getUTCFullYear(),
    month = base.getUTCMonth() + offset;
  const last = new Date(0);
  last.setUTCFullYear(year, month + 1, 0);
  const result = new Date(0);
  result.setUTCFullYear(
    year,
    month,
    Math.min(base.getUTCDate(), last.getUTCDate()),
  );
  return date(result.valueOf());
}
/** Internal service receivable, never a tax invoice or payment instruction. */
export function serviceBillTerms(mandate, kind, periodStart, now = Date.now()) {
  if (
    mandate?.status !== "active" ||
    !mandate.approvalReceiptId ||
    !mandate.businessTerms
  )
    fail("BILLING_MANDATE_REQUIRED");
  const t = validateBusinessTerms(mandate.businessTerms, {
    complete: true,
    now: Date.parse(mandate.businessTerms.startDate),
  });
  if (Date.parse(t.startDate) > now) fail("BILLING_NOT_STARTED");
  if (t.mode === "sourcing_commission") fail("BILLING_MODE_DENIED");
  let start = t.startDate,
    end = date(Date.parse(t.endDate) + 86400000),
    amount;
  if (kind === "fixed_fee" && t.mode === "factory_sales") {
    if (periodStart !== undefined && periodStart !== null)
      fail("BILLING_PERIOD_INVALID");
    amount = t.fixedFeeMinor;
  } else if (kind === "monthly_fee" && t.mode === "channel_subscription") {
    start = day(periodStart);
    const a = new Date(t.startDate),
      b = new Date(start),
      offset =
        (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
        b.getUTCMonth() -
        a.getUTCMonth();
    if (
      offset < 0 ||
      anniversary(t.startDate, offset) !== start ||
      Date.parse(start) > now
    )
      fail("BILLING_PERIOD_INVALID");
    end = anniversary(t.startDate, offset + 1);
    if (end > date(Date.parse(t.endDate) + 86400000))
      fail("BILLING_PARTIAL_PERIOD_UNSUPPORTED");
    amount = t.monthlyFeeMinor;
  } else fail("BILLING_MODE_DENIED");
  if (!Number.isSafeInteger(amount) || amount <= 0) fail("BILLING_ZERO_FEE");
  return {
    kind,
    periodStart: start,
    periodEndExclusive: end,
    amountMinor: amount,
    currency: t.currency,
  };
}
