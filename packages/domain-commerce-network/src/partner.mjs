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

// Customer attribution alone does not authorize every product or market.
// Resolve against the exact accepted quote version linked to the ERP order.
export function mandateCoversOrder(mandate, order, now) {
  const terms = mandate?.terms,
    quote = order?.quoteRef;
  const product = quote?.productRef,
    catalog = order?.catalogRef;
  if (
    mandate?.status !== "active" ||
    !terms ||
    !(Date.parse(terms.validUntil) > now) ||
    !Number.isInteger(terms.commissionBps) ||
    terms.commissionBps < 0 ||
    terms.commissionBps > 10000
  )
    return false;
  if (
    !mandate.customerAssignments?.some(
      (a) => a.buyerId === order.buyerId && a.status === "assigned",
    )
  )
    return false;
  if (
    !product ||
    !catalog ||
    product.id !== catalog.id ||
    product.revision !== catalog.revision ||
    product.skuId !== catalog.skuId
  )
    return false;
  if (
    typeof quote.destination !== "string" ||
    !quote.destination.trim() ||
    typeof mandate.marketCode !== "string" ||
    quote.destination.trim().toUpperCase() !==
      mandate.marketCode.trim().toUpperCase()
  )
    return false;
  return (
    terms.productPins?.some(
      (pin) =>
        mandate.productIds?.includes(pin.contextId) &&
        pin.productId === product.id &&
        pin.revision === product.revision,
    ) === true
  );
}
