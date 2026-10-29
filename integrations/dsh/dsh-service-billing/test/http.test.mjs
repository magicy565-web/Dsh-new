import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { ownerHttp } from "@workspace-agent/dsh-commerce-contracts";
import { fixture } from "./fixture.mjs";
test("independent Owner route denies unauthenticated, cross-origin and unbound sessions; upload and draft use native scope", async () => {
  const f = await fixture();
  let server;
  try {
    const m = await f.mandate();
    server = createServer(
      ownerHttp("/service-billing-api", f.service, {
        authorize: (r) =>
          r.headers["x-test-auth"] === "synthetic" ? null : 401,
      }),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`,
      input = {
        sessionId: "session",
        action: "draft",
        projectId: f.projectId,
        mandateId: m.id,
        expectedMandateRevision: m.revision,
        kind: "fixed_fee",
        requestId: randomUUID(),
      };
    const post = (body, extra = {}) =>
      fetch(origin + "/service-billing-api/write", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-auth": "synthetic",
          origin,
          ...extra,
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await fetch(
          origin +
            "/service-billing-api/list?sessionId=session&projectId=" +
            f.projectId,
        )
      ).status,
      401,
    );
    assert.equal(
      (await post(input, { origin: "https://example.test" })).status,
      403,
    );
    assert.equal((await post({ ...input, sessionId: "unbound" })).status, 403);
    const response = await post(input);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.data.current.status, "draft");
    assert.equal((await post(input)).status, 200);
    const uploaded = await fetch(
      origin + "/service-billing-api/upload-evidence",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-auth": "synthetic",
          origin,
        },
        body: JSON.stringify({
          sessionId: "session",
          fileName: "synthetic.txt",
          dataBase64: Buffer.from("synthetic evidence").toString("base64"),
        }),
      },
    );
    assert.equal(uploaded.status, 200);
    const ref = (await uploaded.json()).data;
    assert.equal(ref.bytes, 18);
    assert.match(ref.attachmentId, /^sha256:/);
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
    f.close();
  }
});
