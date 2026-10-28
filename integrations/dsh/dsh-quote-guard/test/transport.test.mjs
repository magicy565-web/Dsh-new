import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { createResendTransport, verifyResendWebhook } from "../transport.js";
import { createInboundHandler } from "../ingress.js";
import { createServer } from "node:http";
import { once } from "node:events";
import { fixture } from "./fixture.mjs";
test("Resend adapter preserves one idempotency key and never retries timeout or mismatched lookup", async () => {
  const calls = [];
  const adapter = createResendTransport({
    apiKey: "synthetic-key",
    from: "sender@example.test",
    accountRef: "test",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === "POST")
        return new Response(JSON.stringify({ id: "provider-fixture" }), {
          status: 200,
        });
      return new Response(
        JSON.stringify({ id: "provider-fixture", text: "wrong" }),
        { status: 200 },
      );
    },
  });
  const intent = {
    quoteId: "q1",
    version: 1,
    requestId: "send1",
    recipient: "buyer@example.test",
    subject: "Synthetic",
    text: "Test only",
  };
  assert.equal((await adapter.send(intent)).status, "sent");
  assert.ok(calls[0].options.headers["idempotency-key"]);
  assert.equal(
    (await adapter.lookup(intent, { providerMessageId: "provider-fixture" }))
      .status,
    "unknown",
  );
  const length = calls.length;
  assert.equal(
    (await adapter.lookup(intent, { status: "unknown" })).status,
    "unknown",
  );
  assert.equal(calls.length, length);
  assert.equal(createResendTransport({}), null);
});
test("Svix signatures bind original bytes, timestamp and event ID", () => {
  const key = randomBytes(32),
    now = Date.now(),
    timestamp = String(Math.floor(now / 1000)),
    message = "evt1",
    raw = Buffer.from('{"type":"email.received"}');
  const sign = createHmac("sha256", key)
    .update(`${message}.${timestamp}.`)
    .update(raw)
    .digest("base64");
  const headers = {
    "svix-id": message,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${sign}`,
  };
  assert.equal(
    verifyResendWebhook(raw, headers, `whsec_${key.toString("base64")}`, now)
      .event.type,
    "email.received",
  );
  assert.throws(
    () =>
      verifyResendWebhook(
        Buffer.from("{}"),
        headers,
        key.toString("base64"),
        now,
      ),
    { code: "WEBHOOK_SIGNATURE" },
  );
  assert.throws(
    () =>
      verifyResendWebhook(raw, headers, key.toString("base64"), now + 360000),
    { code: "WEBHOOK_SIGNATURE" },
  );
});
test("signed real HTTP ingress retrieves provider bytes, deduplicates and does not send", async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const key = randomBytes(32),
    timestamp = String(Math.floor(Date.now() / 1000));
  let reads = 0;
  const handler = createInboundHandler({
    secret: key.toString("base64"),
    sessionId: f.session,
    inbox: "inbox@example.test",
    rfq: () => f.rfq,
    transport: {
      accountRef: "fixture",
      received: async (id) => {
        reads++;
        return {
          id,
          to: ["inbox@example.test"],
          from: "buyer@example.test",
          subject: "Synthetic RFQ",
          text: "10 units please",
          created_at: "2026-10-28T08:00:00Z",
        };
      },
    },
  });
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const raw = JSON.stringify({
      type: "email.received",
      data: { email_id: "inbound1" },
    }),
    message = "evt1",
    signature = createHmac("sha256", key)
      .update(`${message}.${timestamp}.${raw}`)
      .digest("base64");
  const url = `http://127.0.0.1:${server.address().port}/quote-guard-inbound/resend`,
    options = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": message,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${signature}`,
      },
      body: raw,
    };
  const first = await (await fetch(url, options)).json();
  assert.equal(first.ok, true);
  assert.equal((await (await fetch(url, options)).json()).id, first.id);
  assert.equal(f.rfq.read(f.owner, {}).items.length, 2);
  assert.equal(f.rfq.read(f.owner, { id: first.id }).source.channel, "email");
  assert.equal((await fetch(url, { ...options, body: raw + " " })).status, 401);
  assert.equal(reads, 2);
  assert.equal(f.erp.read(f.w, { entity: "order" }).items.length, 0);
});
