import {
  keys,
  fail,
  integer,
  iso,
  text,
} from "@workspace-agent/dsh-commerce-contracts/validation";
export function validateMandateTerms(terms, products, now) {
  keys(terms, [
    "validUntil",
    "productPins",
    "disclosureScope",
    "customerOwnershipRule",
    "commissionBps",
    "commissionEvidence",
    "version",
  ]);
  iso(terms.validUntil);
  if (Date.parse(terms.validUntil) <= now) fail("MANDATE_EXPIRED");
  integer(terms.version, "version", 1);
  integer(terms.commissionBps, "commissionBps", 0, 10000);
  text(terms.commissionEvidence, "commissionEvidence");
  text(terms.customerOwnershipRule, "customerOwnershipRule");
  if (
    !Array.isArray(terms.disclosureScope) ||
    terms.disclosureScope.some(
      (v) => !["public_specs", "owner_approved_quote_only"].includes(v),
    )
  )
    fail("DISCLOSURE_DENIED");
  if (
    !Array.isArray(terms.productPins) ||
    terms.productPins.length !== products.length
  )
    fail("MANDATE_PRODUCT_PIN");
  for (const p of products) {
    const pin = terms.productPins.find((v) => v.contextId === p.id);
    if (!pin) fail("MANDATE_PRODUCT_PIN");
    keys(pin, ["contextId", "productId", "revision"]);
    if (
      !p.sourceRef ||
      pin.productId !== p.sourceRef.id ||
      pin.revision !== p.sourceRef.revision
    )
      fail("MANDATE_PRODUCT_PIN");
  }
  return structuredClone(terms);
}
