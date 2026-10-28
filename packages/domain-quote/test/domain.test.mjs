import test from "node:test";
import assert from "node:assert/strict";
import {
  transition,
  validatePolicy,
  disclosureFields,
  calculate,
} from "../src/index.mjs";
const policy = {
  productId: "p",
  productRevision: 1,
  skuId: "s",
  currency: "USD",
  minimumUnitPriceMinor: 100,
  floorEvidence: "reviewed synthetic floor",
  sourceReviewEvidence: "synthetic source review",
  incoterm: "FOB",
  namedPlace: "Shanghai",
  leadTimeDays: 7,
  validUntil: "2030-01-01T00:00:00Z",
  disclosureFields,
  revision: 1,
};
test("quote states never imply acceptance, send or payment without intermediate evidence", () => {
  assert.throws(() => transition("draft", "sent"), {
    code: "QUOTE_TRANSITION_DENIED",
  });
  assert.throws(() => transition("review_required", "accepted"), {
    code: "QUOTE_TRANSITION_DENIED",
  });
  assert.throws(() => transition("accepted", "sending"), {
    code: "QUOTE_TRANSITION_DENIED",
  });
  assert.equal(transition("approved", "sending"), "sending");
});
test("currency exponent, sale floor and safe integer total protection", () => {
  assert.throws(() => validatePolicy({ ...policy, currency: "JPY" }), {
    code: "CURRENCY_UNSUPPORTED",
  });
  const catalog = {
    productId: "p",
    revision: 1,
    skuId: "s",
    unitPriceMinor: 99,
    currency: "USD",
    product: {},
    sku: {},
  };
  assert.throws(
    () =>
      calculate({
        catalog,
        policy,
        quantity: 10,
        productRevision: 1,
        currency: "USD",
        now: 0,
      }),
    { code: "PRICE_FLOOR" },
  );
  assert.throws(
    () =>
      calculate({
        catalog: { ...catalog, unitPriceMinor: 1000000000 },
        policy,
        quantity: 1000000000,
        productRevision: 1,
        currency: "USD",
        now: 0,
      }),
    { code: "AMOUNT_OVERFLOW" },
  );
});
