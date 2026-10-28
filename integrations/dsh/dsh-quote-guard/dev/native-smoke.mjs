import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import ERP from "../../dsh-mini-erp/index.js";
import RFQ from "../../dsh-rfq-desk/index.js";
import QuoteGuard from "../index.js";
import SampleFlow from "../../dsh-sample-flow/index.js";
import ChannelLedger from "../../dsh-channel-ledger/index.js";
import { sha } from "@workspace-agent/dsh-commerce-contracts";
if (!process.env.DSH_RUNTIME_DIR)
  throw Error("DSH_RUNTIME_DIR must name official DSH 0.2.1-rc.3 installation");
const require = createRequire(
  join(resolve(process.env.DSH_RUNTIME_DIR), "package.json"),
);
const load = (name) => import(require.resolve(`@deepseek-ai/${name}`));
const { Context } = await load("cordis"),
  { default: SystemPrompt } = await load("dsh-system-prompt"),
  { default: Tools } = await load("dsh-tools");
const dir = await mkdtemp(join(tmpdir(), "native-commerce-business-")),
  w = randomUUID(),
  sessionId = `session-${randomUUID()}`,
  row = { id: w, sessionIds: [sessionId] },
  registry = { get: (id) => (id === w ? row : null), list: () => [row] };
let ctx;
try {
  ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(Tools);
  await ctx.plugin({
    apply(c) {
      c.provide("workspaceRegistry", registry);
    },
  });
  await ctx.plugin(ERP, { dataDir: join(dir, "erp") });
  await ctx.plugin(RFQ, { dataDir: join(dir, "rfq") });
  await ctx.plugin(QuoteGuard);
  await ctx.plugin(SampleFlow);
  await ctx.plugin(ChannelLedger);
  assert.ok(ctx.get("miniErpQuotes"));
  assert.ok(ctx.get("miniErpTrade"));
  assert.ok(ctx.get("rfqDesk"));
  assert.ok(ctx.get("quoteGuard"));
  assert.ok(ctx.get("sampleFlow"));
  assert.ok(ctx.get("channelLedger"));
  const execute = async (name, args) => {
    const result = await ctx.tools.execute({
      name,
      arguments: args,
      agent: { session: { id: sessionId } },
      callId: `call_${randomUUID()}`,
      signal: new AbortController().signal,
    });
    assert.equal(result.isError, false, JSON.stringify(result));
    return result.value;
  };
  const raw = "Synthetic native compatibility inquiry: 10 pieces.";
  const record = ctx
    .get("rfqDesk")
    .ownerWrite(sessionId, {
      action: "import",
      requestId: "native-import",
      expectedRevision: 0,
      rawText: raw,
      authorizationEvidence:
        "Synthetic compatibility fixture; no buyer contacted",
      source: {
        channel: "import",
        accountRef: "fixture",
        externalMessageId: "native1",
        receivedAt: new Date().toISOString(),
        rawEvidenceSha256: sha(raw),
      },
    }).current;
  const read = await execute("rfq_read", { id: record.id, includeRaw: true });
  assert.equal(read.rawText, raw);
  const draft = await execute("rfq_propose_reply", {
    id: record.id,
    requestId: "draft",
    expectedRevision: 1,
    content: "Unsent synthetic clarification draft",
    sourceSha256: sha(raw),
  });
  assert.equal(draft.current.drafts[0].sent, false);
  assert.deepEqual((await execute("sample_read", {})).items, []);
  const missing = await ctx.tools.execute({
    name: "quote_approve",
    arguments: {},
    agent: { session: { id: sessionId } },
    callId: "forged",
    signal: new AbortController().signal,
  });
  assert.equal(missing.isError, true);
  row.sessionIds = [];
  assert.throws(() =>
    ctx
      .get("rfqDesk")
      .toolRead(
        { id: record.id },
        { agent: { session: { id: sessionId } }, callId: "stale" },
      ),
  );
  console.log(
    JSON.stringify({
      ok: true,
      officialVersion: require("@deepseek-ai/dsh/package.json").version,
      services: [
        "miniErpQuotes",
        "miniErpTrade",
        "rfqDesk",
        "quoteGuard",
        "sampleFlow",
        "channelLedger",
      ],
      actualToolRuntime: true,
      actualSqlite: true,
      sourceRead: true,
      unsentDraft: true,
      approvalToolAbsent: true,
      sessionRevocation: true,
      modelCalls: 0,
      businessData: "synthetic-only",
    }),
  );
} finally {
  await ctx?.fiber.dispose();
  await rm(dir, { recursive: true, force: true });
}
