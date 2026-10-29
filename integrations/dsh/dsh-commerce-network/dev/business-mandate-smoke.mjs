import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
const bundle = await build({
    entryPoints: [
      fileURLToPath(new URL("../src/Mandates.jsx", import.meta.url)),
    ],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    packages: "external",
  }),
  module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports,
);
const { Mandates, decimalMinor } = module.exports;
assert.equal(decimalMinor("0.29"), 29);
assert.equal(decimalMinor(""), null);
assert.throws(() => decimalMinor("1e2"));
assert.throws(() => decimalMinor("1.001"));
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" }),
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
let state = {
    workspaceId: "workspace",
    projectId: "project",
    revision: 1,
    products: [],
    routes: [],
    commerceNetwork: {
      parties: [
        { id: "seller", type: "distributor", displayName: "Synthetic Seller" },
        { id: "operator", type: "provider", displayName: "Synthetic Operator" },
      ],
      salesAuthorizations: [],
      workOrders: [],
    },
  },
  lost = true;
const requests = [];
expose("fetch", async (url, { body }) => {
  const request = JSON.parse(body);
  requests.push(request);
  if (request.command === "propose_business_mandate") {
    if (!state.commerceNetwork.salesAuthorizations.length) {
      state = {
        ...state,
        revision: 2,
        commerceNetwork: {
          ...state.commerceNetwork,
          salesAuthorizations: [
            { ...request.payload, id: "m1", status: "proposed" },
          ],
        },
      };
    }
    if (lost) {
      lost = false;
      throw new TypeError("Synthetic dropped response after commit");
    }
  } else if (request.command === "approve_mandate") {
    assert.equal(request.expectedRevision, 2);
    state = {
      ...state,
      revision: 3,
      commerceNetwork: {
        ...state.commerceNetwork,
        salesAuthorizations: state.commerceNetwork.salesAuthorizations.map(
          (r) => ({ ...r, status: "active" }),
        ),
      },
    };
  }
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: state }),
  };
});
const root = createRoot(document.getElementById("root"));
let closed = false;
const render = () =>
  root.render(
    React.createElement(Mandates, {
      state,
      sessionId: "session",
      onClose: () => (closed = true),
      onChanged: async () => render(),
    }),
  );
const button = (text) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text);
const click = async (text) => {
  const b = button(text);
  assert.ok(b, text);
  await act(async () =>
    b.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
};
const field = (text) =>
  [...document.querySelectorAll("label")]
    .find((l) => l.querySelector("span")?.textContent === text)
    ?.querySelector("input,select,textarea");
async function fill(label, value) {
  const input = field(label);
  assert.ok(input, label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value",
    ).set.call(input, value);
    Simulate.change(input);
  });
}
try {
  await act(async () => render());
  await click("新建委托");
  await fill("业务模式", "channel_subscription");
  await fill("委托名称", "Synthetic subscription");
  await fill("委托方", "seller");
  await fill("服务方", "operator");
  await fill("目标市场", "US");
  await fill("业务范围与交付约定", "Synthetic only");
  await fill("月订阅费（USD，空白为待约定）", "29.99");
  await act(async () =>
    document
      .querySelector("form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  assert.equal(requests[0].payload.businessTerms.monthlyFeeMinor, 2999);
  assert.equal(requests[0].payload.businessTerms.fixedFeeMinor, null);
  assert.equal(requests[0].payload.businessTerms.commission, null);
  assert.ok(sessionStorage.length);
  assert.ok(button("关闭").disabled);
  assert.equal(closed, false);
  // Remount simulates the sidebar closing after an uncertain request.
  await act(async () => root.render(null));
  await act(async () => render());
  await click("用原请求重试");
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(state.commerceNetwork.salesAuthorizations.length, 1);
  assert.equal(sessionStorage.length, 0);
  await click("Synthetic subscription · 待授权");
  await click("核对并审核");
  // An unrelated poll must not update the version the owner actually reviewed.
  state = { ...state, revision: 99 };
  await act(async () => render());
  await click("确认审核条款");
  assert.equal(requests[2].expectedRevision, 2);
  assert.ok(document.body.textContent.includes("生效中"));
  assert.ok(document.body.textContent.includes("不适用"));
  console.log(
    "Business mandate UI: exact decimal units, draft modes, durable same-request retry, frozen owner review, and no duplicate creation passed.",
  );
} finally {
  await act(async () => root.unmount());
  for (const [k, v] of saved)
    v ? Object.defineProperty(globalThis, k, v) : delete globalThis[k];
  dom.window.close();
}
