import { sha } from "@workspace-agent/dsh-commerce-contracts";
export async function accepted(f, { prefix = "" } = {}) {
  let q = await f.approve(await f.setup());
  q = (
    await f.quotes.send(
      f.owner,
      {
        requestId: `${prefix}send`,
        expectedRevision: q.revision,
        quoteId: q.quoteId,
        version: q.version,
        approvalReceiptId: q.approval.id,
      },
      {
        accountRef: "test",
        send: async () => ({
          status: "sent",
          provider: "test",
          providerMessageId: `${prefix}synthetic-message`,
          at: "2026-10-28T08:00:00Z",
        }),
      },
    )
  ).current;
  const raw = "Yes, I accept this synthetic quote.";
  let r = f.rfq.ownerWrite(f.session, {
    ...f.importBody,
    requestId: `${prefix}reply`,
    rawText: raw,
    source: {
      ...f.importBody.source,
      externalMessageId: `${prefix}reply1`,
      receivedAt: "2026-10-28T08:01:00Z",
      rawEvidenceSha256: sha(raw),
    },
  }).current;
  r = f.rfq.toolWrite(
    "propose_extraction",
    {
      id: r.id,
      requestId: `${prefix}reply-extract`,
      expectedRevision: r.revision,
      extraction: {
        requirements: {},
        fieldEvidence: {},
        sourceSha256: sha(raw),
        model: "synthetic",
        provider: "none",
      },
    },
    { agent: { session: { id: f.session } }, callId: "reply" },
  ).current;
  r = f.rfq.ownerWrite(f.session, {
    action: "review",
    id: r.id,
    requestId: `${prefix}reply-review`,
    expectedRevision: r.revision,
    candidateId: r.candidates[0].id,
    status: "needs_info",
    buyerRef: "buyer1",
    identityEvidence: "Synthetic buyer identity reviewed",
  }).current;
  return (
    await f.quotes.accept(f.owner, {
      requestId: `${prefix}accept`,
      expectedRevision: q.revision,
      quoteId: q.quoteId,
      version: q.version,
      replyRfqId: r.id,
      replyRevision: r.revision,
      evidenceQuote: raw,
      evidenceStart: 0,
      evidenceEnd: raw.length,
    })
  ).current;
}
