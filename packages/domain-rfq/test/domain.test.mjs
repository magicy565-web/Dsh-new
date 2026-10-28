import test from "node:test";
import assert from "node:assert/strict";
import {
  source,
  requirements,
  transition,
  extraction,
  missing,
} from "../src/index.mjs";
import { sha } from "@workspace-agent/dsh-commerce-contracts/validation";
test("RFQ required fields, states and unsupported extracted authorities fail closed", () => {
  assert.deepEqual(
    missing({
      quantity: 5,
      unit: "piece",
      destination: "US",
      incoterm: "FOB",
      namedPlace: "Shanghai",
      currency: "USD",
    }),
    [],
  );
  assert.throws(() => requirements({ quantity: -1 }), { code: "INPUT" });
  assert.throws(() => requirements({ buyerVerified: true }), { code: "INPUT" });
  assert.throws(() => transition("received", "ready_for_quote"), {
    code: "RFQ_TRANSITION_DENIED",
  });
  assert.throws(() => transition("closed", "qualified"), {
    code: "RFQ_TRANSITION_DENIED",
  });
  assert.equal(transition("received", "qualified"), "qualified");
});
test("raw source hash and per-field evidence must match exact original bytes/spans", () => {
  const raw = "10 units";
  const s = {
    channel: "import",
    accountRef: "fixture",
    externalMessageId: "1",
    receivedAt: "2026-10-28T00:00:00Z",
    rawEvidenceSha256: sha(raw),
  };
  assert.equal(source(s, raw).externalMessageId, "1");
  assert.throws(() => source(s, "11 units"), { code: "SOURCE_CHANGED" });
  assert.throws(
    () =>
      extraction(
        {
          requirements: { quantity: 10 },
          fieldEvidence: {},
          sourceSha256: sha(raw),
          provider: "test",
          model: "test",
        },
        raw,
        sha(raw),
      ),
    { code: "INPUT" },
  );
});
