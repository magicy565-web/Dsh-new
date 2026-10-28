import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CommerceStore } from "../store.js";
import { createCommerceService } from "../service.js";
import { buildCommerceGraph } from "../src/projection/network.mjs";
import { now, progressFixture } from "./business-progress-fixture.mjs";

test("business progress preserves terms, billing revision, task authority and legacy records; canvas and read share references", async () => {
  const f = await progressFixture();
  try {
    const before = f.record(),
      budget = f.state().budget;
    await f.command("record_business_progress", f.input());
    const after = f.record();
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.businessTerms, before.businessTerms);
    assert.equal(after.approvalReceiptId, before.approvalReceiptId);
    assert.equal(after.progress.revision, 1);
    assert.equal(after.progressHistory.length, 1);
    assert.equal(after.progressView.needsReview, false);
    assert.equal(after.progressView.decisions[0].id, "work");
    assert.equal(f.state().commerceNetwork.workOrders[0].status, "proposed");
    assert.deepEqual(f.state().budget, budget);
    assert.deepEqual(f.state().commerceNetwork.grants, []);
    const graph = buildCommerceGraph(f.state(), f.projectId);
    assert.match(
      graph.nodes.find((n) => n.id === "business_mandate:mandate").subtitle,
      /渠道开发/,
    );
    assert.ok(
      graph.edges.some(
        (e) =>
          e.source === "business_mandate:mandate" &&
          e.target === "service_order:work",
      ),
    );
    await f.command(
      "record_business_progress",
      f.input({
        stage: "product_readiness",
        status: "blocked",
        blocker: "Missing product dimensions",
      }),
    );
    assert.equal(f.record().progressHistory[0].stage, "channel_development");
    assert.equal(f.record().progress.stage, "product_readiness");
  } finally {
    f.service.close();
  }
});
test("owner-only progress rejects unapproved, foreign, stale, invalid and expired writes without changing history", async () => {
  const f = await progressFixture();
  try {
    await assert.rejects(
      () => f.tool("record_business_progress", f.input()),
      (e) => e.code === "OWNER_ACTION_REQUIRED",
    );
    for (const patch of [
      { responsiblePartyId: "foreign" },
      { workOrderIds: ["foreign"] },
      { workOrderIds: ["work", "work"] },
      { outcomeIds: ["fake"] },
      { status: "blocked" },
      { nextAction: "" },
      { stage: "sold" },
      { reason: "" },
      { chargeNow: true },
    ])
      await assert.rejects(() =>
        f.command("record_business_progress", f.input(patch)),
      );
    assert.equal(f.record().progress, undefined);
    const stale = f.envelope("record_business_progress", f.input());
    await f.command("record_business_progress", f.input());
    await assert.rejects(
      () => f.service.command("session", stale),
      (e) => e.code === "REVISION_CONFLICT",
    );
    await assert.rejects(
      () =>
        f.command(
          "record_business_progress",
          f.input({ expectedProgressRevision: 0 }),
        ),
      (e) => e.code === "REVISION_CONFLICT",
    );
    await assert.rejects(() =>
      f.service.command("other", {
        ...stale,
        requestId: randomUUID(),
        expectedRevision: 0,
      }),
    );
    assert.equal(f.record().progressHistory.length, 1);
    const late = createCommerceService({
      store: f.store,
      registry: f.registry,
      clock: () => Date.parse("2028-01-01T00:00:00Z"),
    });
    await assert.rejects(
      () =>
        late.command(
          "session",
          f.envelope("record_business_progress", f.input()),
        ),
      (e) => e.code === "BUSINESS_PROGRESS_UNAVAILABLE",
    );
    await f.command("revoke_mandate", { mandateId: "mandate" });
    await assert.rejects(
      () => f.command("record_business_progress", f.input()),
      (e) => e.code === "BUSINESS_PROGRESS_UNAVAILABLE",
    );
  } finally {
    f.service.close();
  }
});
test("outcomes require accepted intact delivery from linked project and keep immutable historical evidence", async () => {
  const f = await progressFixture();
  try {
    // Seed an accepted worker fixture; live worker transitions have their own native integration suite.
    const content = "Synthetic accepted findings",
      sha256 = createHash("sha256").update(content).digest("hex");
    f.store.transaction(() => {
      const s = f.store.load(f.workspaceId),
        o = s.workOrders[0];
      Object.assign(o, {
        status: "delivered",
        deliverableId: "delivery",
        deliverableSha256: sha256,
        acceptanceReceiptId: "acceptance",
      });
      s.deliverables.push({
        id: "delivery",
        projectId: f.projectId,
        orderId: o.id,
        title: "Synthetic findings",
        content,
        sha256,
        sourceUrls: [],
      });
      f.store.save(f.workspaceId, s);
    });
    await assert.rejects(() =>
      f.command(
        "record_business_progress",
        f.input({ outcomeIds: ["delivery"] }),
      ),
    );
    f.store.transaction(() => {
      const s = f.store.load(f.workspaceId);
      s.workOrders[0].status = "accepted";
      f.store.save(f.workspaceId, s);
    });
    await f.command(
      "record_business_progress",
      f.input({ outcomeIds: ["delivery"] }),
    );
    assert.equal(f.record().progress.outcomes[0].sha256, sha256);
    assert.equal(f.record().progressView.deliveries[0].accepted, true);
    await assert.rejects(() =>
      f.command(
        "record_business_progress",
        f.input({ workOrderIds: [], outcomeIds: ["delivery"] }),
      ),
    );
    f.store.transaction(() => {
      const s = f.store.load(f.workspaceId);
      s.deliverables[0].content = "corrupt";
      f.store.save(f.workspaceId, s);
    });
    await assert.rejects(() =>
      f.command(
        "record_business_progress",
        f.input({ outcomeIds: ["delivery"] }),
      ),
    );
    assert.equal(f.record().progressHistory.length, 1);
  } finally {
    f.service.close();
  }
});
test("new terms preserve progress and signal review; reaffirmation pins the new approval separately", async () => {
  const f = await progressFixture();
  try {
    await f.command("record_business_progress", f.input());
    const { id, ...amend } = f.mandate;
    await f.command("amend_business_mandate", {
      ...amend,
      mandateId: id,
      businessTerms: { ...amend.businessTerms, version: 2 },
    });
    assert.equal(f.record().progressView.needsReview, true);
    assert.equal(f.record().history[0].progressHistory, undefined);
    await assert.rejects(() =>
      f.command("record_business_progress", f.input()),
    );
    await f.command("approve_mandate", { mandateId: id });
    await f.command("record_business_progress", f.input());
    assert.equal(f.record().progressView.needsReview, false);
    assert.equal(f.record().progressHistory[0].termsVersion, 1);
    assert.equal(f.record().progressHistory[1].termsVersion, 2);
  } finally {
    f.service.close();
  }
});
test("original request survives restart and duplicate replay appends no second history record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "business-progress-")),
    file = join(dir, "db.sqlite");
  const f = await progressFixture(file);
  let restored;
  try {
    const request = f.envelope("record_business_progress", f.input());
    await f.service.command("session", request);
    f.service.close();
    restored = createCommerceService({
      store: new CommerceStore(file),
      registry: f.registry,
      clock: () => now,
    });
    const replay = await restored.command("session", request);
    assert.equal(replay.receipt.replayed, true);
    assert.equal(
      replay.commerceNetwork.salesAuthorizations[0].progressHistory.length,
      1,
    );
    await assert.rejects(
      () =>
        restored.command("session", {
          ...request,
          payload: { ...request.payload, nextAction: "changed" },
        }),
      (e) => e.code === "REQUEST_ID_CONFLICT",
    );
  } finally {
    (restored || f.service).close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("actual progress HTTP route requires authenticated same-origin Owner and rejects worker endpoint", async () => {
  const { createServer } = await import("node:http"),
    { once } = await import("node:events");
  const { createHttpHandler, createWorkerHandler } = await import("../http.js");
  const f = await progressFixture();
  const owner = createHttpHandler(f.service, {
    authorize: (req) => (req.headers.cookie === "owner=fixture" ? null : 401),
  });
  const worker = createWorkerHandler(f.service);
  const server = createServer((req, res) =>
    req.url.startsWith("/commerce-worker-api/")
      ? worker(req, res)
      : owner(req, res),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({
    sessionId: "session",
    ...f.envelope("record_business_progress", f.input()),
  });
  const post = (headers) =>
    fetch(base + "/commerce-network-api/command", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  try {
    assert.equal((await post({ origin: base })).status, 401);
    assert.equal(
      (
        await post({
          cookie: "owner=fixture",
          origin: "https://foreign.example",
        })
      ).status,
      403,
    );
    const response = await post({ cookie: "owner=fixture", origin: base });
    assert.equal(response.status, 200);
    assert.equal(
      (await response.json()).data.commerceNetwork.salesAuthorizations[0]
        .progress.revision,
      1,
    );
    assert.equal(
      (
        await fetch(base + "/commerce-worker-api/record_business_progress", {
          method: "POST",
          body,
        })
      ).status,
      404,
    );
  } finally {
    server.close();
    await once(server, "close");
    f.service.close();
  }
});
