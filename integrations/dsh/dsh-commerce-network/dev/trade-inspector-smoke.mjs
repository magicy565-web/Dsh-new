import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
const bundle = await build({
    entryPoints: [
      fileURLToPath(new URL("../src/TradeInspector.jsx", import.meta.url)),
    ],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    packages: "external",
  }),
  require = createRequire(import.meta.url),
  module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
  require,
  module,
  module.exports,
);
const { QuoteReview } = module.exports;
const dom = new JSDOM('<div id="app"></div>', { url: "http://localhost/" }),
  saved = new Map();
function expose(k, v) {
  saved.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
  Object.defineProperty(globalThis, k, {
    value: v,
    writable: true,
    configurable: true,
  });
}
for (const k of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Event",
  "MouseEvent",
  "sessionStorage",
])
  expose(k, dom.window[k]);
expose("IS_REACT_ACT_ENVIRONMENT", true);
const requests = [];
let lost = true;
let quote = {
  quoteId: "q1",
  version: 1,
  revision: 1,
  status: "review_required",
  recipient: "synthetic@example.test",
  currency: "USD",
  totalMinor: 12340,
  productRef: { revision: 1 },
  pricingRuleRevision: 1,
  validUntil: "2030-01-01T00:00:00Z",
  body: "Synthetic test body <script>unsafe()</script>",
  bodySha256: "a".repeat(64),
};
expose("fetch", async (url, options = {}) => {
  requests.push({ url, options });
  const path = new URL(url, dom.window.location.href).pathname;
  let data;
  if (path.endsWith("/read")) data = { ...quote };
  else if (path.endsWith("/review"))
    data = {
      quote: { ...quote },
      reviewDigest: "exact-digest",
      expectedRevision: 1,
      policy: {
        minimumUnitPriceMinor: 100,
        floorEvidence: "Synthetic floor",
        sourceReviewEvidence: "Synthetic source",
      },
    };
  else if (path.endsWith("/approve")) {
    assert.equal(JSON.parse(options.body).reviewDigest, "exact-digest");
    quote = {
      ...quote,
      status: "approved",
      revision: 2,
      approval: {
        id: "approval1",
        channel: { accountRef: "test", from: "sender@example.test" },
      },
    };
    data = { current: quote };
  } else if (path.endsWith("/send")) {
    const body = JSON.parse(options.body);
    assert.equal(body.approvalReceiptId, "approval1");
    quote = {
      ...quote,
      status: "sending",
      revision: 3,
      outbox: { status: "unknown", result: { status: "unknown" } },
    };
    if (lost) {
      lost = false;
      throw Error("Synthetic lost response");
    }
    data = { current: quote };
  } else throw Error("Unexpected route " + path);
  return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
});
const root = createRoot(document.getElementById("app")),
  button = (label) =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent === label,
    );
const render = async () =>
  act(async () =>
    root.render(
      React.createElement(QuoteReview, {
        sessionId: "session1",
        quoteId: "q1",
        onClose() {},
        onRefresh() {},
      }),
    ),
  );
const click = async (label) =>
  act(async () => {
    assert.ok(button(label), label);
    button(label).dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
  });
try {
  await render();
  assert.ok(document.body.textContent.includes(quote.body));
  assert.equal(document.querySelector("script"), null);
  assert.ok(!button("批准此收件人与精确正文"));
  await click("重新核验来源与政策");
  assert.ok(button("批准此收件人与精确正文"));
  await click("批准此收件人与精确正文");
  assert.ok(button("发送这份已批准报价"));
  await click("发送这份已批准报价");
  assert.ok(document.body.textContent.includes("Synthetic lost response"));
  assert.ok(sessionStorage.getItem("dsh:quote-attempt:session1:q1"));
  await click("核对上次提交");
  const sends = requests.filter((r) => r.url.endsWith("/send"));
  assert.equal(sends.length, 2);
  assert.equal(sends[0].options.body, sends[1].options.body);
  assert.equal(sessionStorage.getItem("dsh:quote-attempt:session1:q1"), null);
  assert.ok(document.body.textContent.includes("发送结果不明"));
  assert.ok(!button("发送这份已批准报价"));
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "exact-content-as-text",
        "explicit-source-review-before-approval",
        "approval-and-send-separated",
        "uncertain-request-persisted",
        "retry-identical-envelope",
        "unknown-outcome-no-new-send",
      ],
    }),
  );
} finally {
  await act(async () => root.unmount());
  dom.window.close();
  for (const [k, v] of saved) {
    if (v) Object.defineProperty(globalThis, k, v);
    else delete globalThis[k];
  }
}
