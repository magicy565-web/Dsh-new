import {
  keys,
  text,
  integer,
  iso,
  hash,
  fail,
  sha,
} from "@workspace-agent/dsh-commerce-contracts/validation";
export const requirementFields = [
  "quantity",
  "unit",
  "destination",
  "customization",
  "packaging",
  "incoterm",
  "namedPlace",
  "neededBy",
  "currency",
];
export function requirements(value) {
  keys(value, requirementFields);
  for (const [k, v] of Object.entries(value)) {
    if (k === "quantity") integer(v, k, 1);
    else text(v, k, 1000);
  }
  if (value.currency && !["USD", "EUR", "GBP", "CNY"].includes(value.currency))
    fail("CURRENCY_UNSUPPORTED");
  return structuredClone(value);
}
export const missing = (v) =>
  [
    "quantity",
    "unit",
    "destination",
    "incoterm",
    "namedPlace",
    "currency",
  ].filter((k) => v[k] === undefined || v[k] === "");
export function source(value, rawText) {
  keys(value, [
    "channel",
    "accountRef",
    "externalMessageId",
    "threadId",
    "receivedAt",
    "rawEvidenceSha256",
  ]);
  if (!["email", "whatsapp", "import"].includes(value.channel))
    fail("SOURCE_INVALID");
  for (const key of ["accountRef", "externalMessageId"])
    text(value[key], key, 300);
  if (value.threadId !== undefined) text(value.threadId, "threadId", 300);
  iso(value.receivedAt);
  hash(value.rawEvidenceSha256);
  if (sha(text(rawText, "rawText", 65536)) !== value.rawEvidenceSha256)
    fail("SOURCE_CHANGED");
  return structuredClone(value);
}
export function extraction(value, rawText, sourceSha) {
  keys(value, [
    "requirements",
    "fieldEvidence",
    "sourceSha256",
    "model",
    "provider",
    "productRef",
  ]);
  if (value.sourceSha256 !== sourceSha) fail("SOURCE_CHANGED");
  requirements(value.requirements);
  keys(value.fieldEvidence, Object.keys(value.requirements));
  for (const [field, result] of Object.entries(value.requirements)) {
    const evidence = value.fieldEvidence[field];
    keys(evidence, ["quote", "start", "end"]);
    integer(evidence.start, "start", 0, rawText.length);
    integer(evidence.end, "end", evidence.start + 1, rawText.length);
    if (
      rawText.slice(evidence.start, evidence.end) !== evidence.quote ||
      !String(evidence.quote).trim()
    )
      fail("FIELD_EVIDENCE_INVALID", `Missing exact source span for ${field}`);
    // Spans prove provenance, not model correctness; owner review remains required.
  }
  text(value.model, "model", 200);
  text(value.provider, "provider", 200);
  return structuredClone(value);
}
export function transition(status, next) {
  const allowed = {
    received: ["needs_info", "qualified", "closed"],
    needs_info: ["needs_info", "qualified", "closed"],
    qualified: ["needs_info", "ready_for_quote", "closed"],
    ready_for_quote: ["needs_info", "closed"],
    closed: [],
  };
  if (!allowed[status]?.includes(next)) fail("RFQ_TRANSITION_DENIED");
  return next;
}
