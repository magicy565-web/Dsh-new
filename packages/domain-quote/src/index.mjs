import {
  keys,
  text,
  integer,
  iso,
  fail,
  sha,
} from "@workspace-agent/dsh-commerce-contracts/validation";
export const currencies = ["USD", "EUR", "GBP", "CNY"];
export const disclosureFields = [
  "productName",
  "sku",
  "quantity",
  "unit",
  "currency",
  "unitPriceMinor",
  "totalMinor",
  "incoterm",
  "namedPlace",
  "leadTimeDays",
  "validUntil",
];
export function validatePolicy(p) {
  keys(p, [
    "productId",
    "productRevision",
    "skuId",
    "currency",
    "minimumUnitPriceMinor",
    "floorEvidence",
    "sourceReviewEvidence",
    "incoterm",
    "namedPlace",
    "leadTimeDays",
    "validUntil",
    "disclosureFields",
    "revision",
  ]);
  text(p.productId, "productId");
  text(p.skuId, "skuId");
  integer(p.productRevision, "productRevision", 1);
  integer(p.revision, "revision", 1);
  if (!currencies.includes(p.currency)) fail("CURRENCY_UNSUPPORTED");
  integer(p.minimumUnitPriceMinor, "minimumUnitPriceMinor");
  text(p.floorEvidence, "floorEvidence");
  text(p.sourceReviewEvidence, "sourceReviewEvidence");
  if (
    ![
      "EXW",
      "FCA",
      "FAS",
      "FOB",
      "CFR",
      "CIF",
      "CPT",
      "CIP",
      "DAP",
      "DPU",
      "DDP",
    ].includes(p.incoterm)
  )
    fail("QUOTE_BLOCKED_MISSING_EVIDENCE", "Explicit Incoterm required");
  text(p.namedPlace, "namedPlace");
  integer(p.leadTimeDays, "leadTimeDays", 0, 3650);
  iso(p.validUntil);
  if (
    !Array.isArray(p.disclosureFields) ||
    disclosureFields.some((f) => !p.disclosureFields.includes(f)) ||
    p.disclosureFields.some((f) => !disclosureFields.includes(f))
  )
    fail(
      "DISCLOSURE_DENIED",
      "Only the exact buyer quote field allowlist may be disclosed",
    );
  return p;
}
export function calculate({
  catalog,
  policy,
  quantity,
  productRevision,
  currency,
  now,
}) {
  if (!catalog || !policy) fail("QUOTE_BLOCKED_MISSING_EVIDENCE");
  validatePolicy(policy);
  integer(quantity, "quantity", 1);
  if (
    catalog.revision !== productRevision ||
    policy.productRevision !== productRevision ||
    catalog.productId !== policy.productId ||
    catalog.skuId !== policy.skuId
  )
    fail("SOURCE_CHANGED");
  if (Date.parse(policy.validUntil) <= now) fail("POLICY_EXPIRED");
  if (catalog.unitPriceMinor === null)
    fail(
      "QUOTE_BLOCKED_MISSING_EVIDENCE",
      catalog.quoteReason || "Price is unknown",
    );
  if (
    !currencies.includes(currency) ||
    currency !== catalog.currency ||
    currency !== policy.currency
  )
    fail("CURRENCY_UNSUPPORTED");
  integer(catalog.unitPriceMinor, "unitPriceMinor");
  if (catalog.unitPriceMinor < policy.minimumUnitPriceMinor)
    fail("PRICE_FLOOR", "Source price is below the owner-reviewed price floor");
  const totalMinor = catalog.unitPriceMinor * quantity;
  if (!Number.isSafeInteger(totalMinor)) fail("AMOUNT_OVERFLOW");
  return {
    quantity,
    currency,
    unitPriceMinor: catalog.unitPriceMinor,
    totalMinor,
    incoterm: policy.incoterm,
    namedPlace: policy.namedPlace,
    leadTimeDays: policy.leadTimeDays,
    pricingRuleRevision: policy.revision,
    sourceSnapshotSha256: sha({
      product: catalog.product,
      sku: catalog.sku,
      policy,
    }),
    profitStatus: "unknown",
    chargesIncluded: "goods_subtotal_only",
  };
}
export function transition(status, next) {
  const allowed = {
    draft: ["review_required", "withdrawn"],
    review_required: ["approved", "withdrawn", "expired"],
    approved: ["sending", "withdrawn", "expired"],
    sending: ["sent", "approved"],
    sent: ["accepted", "withdrawn", "expired"],
    accepted: [],
    expired: [],
    withdrawn: [],
  };
  if (!allowed[status]?.includes(next)) fail("QUOTE_TRANSITION_DENIED");
  return next;
}
