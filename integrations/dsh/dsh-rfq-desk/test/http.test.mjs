import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { fixture } from "../../dsh-quote-guard/test/fixture.mjs";
import { createHttpHandler } from "../http.js";
import { createQuoteGuard } from "../../dsh-quote-guard/service.js";
import { createHttpHandler as quoteHttp } from "../../dsh-quote-guard/http.js";
test("real HTTP authenticates Connection, rejects Worker bearer, CSRF, oversized body and scope override", async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const guard = createQuoteGuard({ registry: f.registry, erp: () => f.quotes });
  const authorize = ({ headers }) =>
    headers.cookie === "owner=test" ? 0 : 401;
  const handler = createHttpHandler(f.rfq, { authorize }),
    qh = quoteHttp(guard, { authorize });
  const server = createServer((req, res) =>
    req.url.startsWith("/rfq-") ? handler(req, res) : qh(req, res),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        cookie: "owner=test",
        "content-type": "application/json",
        origin: base,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await fetch(`${base}/rfq-desk-api/read?sessionId=${f.session}`, {
        headers: { authorization: "Bearer cnw_fake" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await post(
        "/rfq-desk-api/command",
        { sessionId: f.session, ...f.importBody },
        { origin: "https://foreign.test" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post("/rfq-desk-api/command", {
        sessionId: f.session,
        ...f.importBody,
        requestId: "override",
        workspaceId: f.other,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/rfq-desk-api/command", {
        sessionId: f.session,
        ...f.importBody,
        rawText: "x".repeat(262145),
      })
    ).status,
    413,
  );
  const r = await fetch(
    `${base}/rfq-desk-api/read?sessionId=session-other&id=${f.r.id}`,
    { headers: { cookie: "owner=test" } },
  );
  assert.equal(r.status, 404);
  const q = await f.setup();
  const review = await (
    await fetch(
      `${base}/quote-guard-api/review?sessionId=${f.session}&quoteId=${q.quoteId}`,
      { headers: { cookie: "owner=test" } },
    )
  ).json();
  assert.ok(review.data.reviewDigest);
  const approved = await (
    await post("/quote-guard-api/approve", {
      sessionId: f.session,
      requestId: "http-approve",
      quoteId: q.quoteId,
      version: q.version,
      expectedRevision: q.revision,
      reviewDigest: review.data.reviewDigest,
    })
  ).json();
  assert.equal(approved.data.current.status, "approved");
  const sent = await post("/quote-guard-api/send", {
    sessionId: f.session,
    requestId: "http-send",
    quoteId: q.quoteId,
    version: 1,
    expectedRevision: approved.data.current.revision,
    approvalReceiptId: approved.data.current.approval.id,
  });
  assert.equal((await sent.json()).error.code, "UNCONFIGURED");
});
