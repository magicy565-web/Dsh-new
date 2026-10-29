import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { fixture } from "../../dsh-service-billing/test/fixture.mjs";
const f = await fixture(),
  mandate = await f.mandate();
const bundle = await build({
    entryPoints: [
      fileURLToPath(new URL("../src/ServiceBilling.jsx", import.meta.url)),
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
const { ServiceBilling } = module.exports;
const dom = new JSDOM('<div id="app"></div>', { url: "http://localhost/" }),
  saved = new Map();
const expose = (k, v) => {
  saved.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
  Object.defineProperty(globalThis, k, {
    value: v,
    writable: true,
    configurable: true,
  });
};
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
let lost = true;
const requests = [];
expose("fetch", async (url, options = {}) => {
  const parsed = new URL(url, "http://localhost"),
    input = options.body
      ? JSON.parse(options.body)
      : Object.fromEntries(parsed.searchParams),
    method = options.body ? "POST" : "GET",
    action = parsed.pathname.split("/").at(-1);
  if (options.body) requests.push(input);
  let value;
  try {
    value = await f.service.http(method, action, input);
  } catch (e) {
    return {
      ok: false,
      status: e.status || 500,
      text: async () =>
        JSON.stringify({
          ok: false,
          error: { code: e.code, message: e.message },
        }),
    };
  }
  if (input.action === "issue" && lost) {
    lost = false;
    throw new TypeError("Synthetic response dropped after committed issue");
  }
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true, data: value }),
  };
});
const root = createRoot(document.getElementById("app"));
const render = () =>
  root.render(
    React.createElement(ServiceBilling, {
      sessionId: "session",
      workspaceId: f.owner.workspaceId,
      projectId: f.projectId,
      mandate,
      onClose: () => {},
    }),
  );
const button = (text) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text);
async function click(text) {
  assert.ok(button(text), text);
  await act(async () =>
    button(text).dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
}
async function fill(text, value) {
  const el = [...document.querySelectorAll("label")]
    .find((l) => l.querySelector("span")?.textContent === text)
    ?.querySelector("input,select");
  assert.ok(el, text);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el),
      "value",
    ).set.call(el, value);
    Simulate.change(el);
  });
}
try {
  await act(async () => render());
  await click("生成账单草稿");
  assert.ok(document.body.textContent.includes("待确认"));
  await click("核对并确认账单");
  await click("确认记录");
  assert.ok(document.body.textContent.includes("已保留原请求"));
  assert.ok(button("返回业务委托").disabled);
  await act(async () => root.render(null));
  await act(async () => render());
  await click("用原请求重试");
  const issues = requests.filter((r) => r.action === "issue");
  assert.deepEqual(issues[0], issues[1]);
  assert.equal(
    f.service.list(f.owner, { projectId: f.projectId }).items.length,
    1,
  );
  assert.equal(sessionStorage.length, 0);
  await click("登记收款凭据");
  await fill("本次金额（USD）", "40.00");
  await fill("机构与账号标识（不填密码）", "Synthetic bank/account");
  await fill("外部交易编号", "synthetic-ui-receipt");
  await fill("实际发生时间（UTC）", "2026-11-30T12:00");
  const bytes = Buffer.from("Synthetic evidence only"),
    file = {
      name: "synthetic.txt",
      size: bytes.length,
      arrayBuffer: async () => bytes,
    };
  await act(async () => {
    const input = document.querySelector("input[type=file]");
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    Simulate.change(input);
  });
  await click("上传并核对凭据");
  assert.ok(document.body.textContent.includes("凭据 SHA-256"));
  await click("确认记录");
  const b = f.service.list(f.owner, { projectId: f.projectId }).items[0];
  assert.equal(b.netCollectedMinor, 4000);
  assert.equal(b.outstandingMinor, 6000);
  assert.ok(document.body.textContent.includes("部分收款"));
  await click("生成账单草稿");
  assert.ok(document.body.textContent.includes("不能重复收费"));
  assert.equal(
    f.service.list(f.owner, { projectId: f.projectId }).items.length,
    1,
  );
  console.log(
    "Standalone billing UI + real SQLite: draft, reviewed issue, lost response/remount replay, native attachment adapter, partial collection and duplicate-period message passed; Mini ERP absent.",
  );
} finally {
  await act(async () => root.unmount());
  for (const [k, v] of saved)
    v ? Object.defineProperty(globalThis, k, v) : delete globalThis[k];
  dom.window.close();
  f.close();
}
