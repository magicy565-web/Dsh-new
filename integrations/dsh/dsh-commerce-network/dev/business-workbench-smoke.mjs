import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { progressFixture } from "../test/business-progress-fixture.mjs";
const f = await progressFixture();
const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/BusinessWorkbench.jsx", import.meta.url)),
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports,
);
const { BusinessWorkbench } = module.exports;
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
let lost = true,
  asked,
  opened,
  state = f.state();
const requests = [];
expose("fetch", async (url, { body }) => {
  const { sessionId, ...input } = JSON.parse(body);
  requests.push(JSON.parse(body));
  let result;
  try {
    result = await f.service.command(sessionId, input);
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
  if (lost) {
    lost = false;
    throw new TypeError("Synthetic committed response lost");
  }
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: result }),
  };
});
const root = createRoot(document.getElementById("app"));
const render = () =>
  root.render(
    React.createElement(BusinessWorkbench, {
      state,
      sessionId: "session",
      onClose() {},
      onChanged: async () => {
        state = f.state();
        render();
      },
      onAsk: (...args) => {
        asked = args;
      },
      onWork: (id) => {
        opened = id;
      },
      onMandate() {},
      onArtifact() {},
    }),
  );
const button = (text) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text);
const click = async (text) => {
  assert.ok(button(text), text);
  assert.equal(button(text).disabled, false, text);
  await act(async () =>
    button(text).dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
};
const fill = async (label, value) => {
  const el = document.querySelector(`[aria-label="${label}"]`);
  assert.ok(el);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el),
      "value",
    ).set.call(el, value);
    Simulate.change(el);
  });
};
async function edit() {
  await click("更新业务进展");
  await fill("业务阶段", "channel_development");
  await fill("下一步", "Review supplier-ready product notes");
  await fill("更新依据", "Synthetic owner assessment");
}
async function review() {
  await act(async () => Simulate.submit(document.querySelector("form")));
}
try {
  await act(async () => render());
  await edit();
  await act(async () => {
    const input = document.querySelector("input[type=checkbox]");
    input.checked = true;
    Simulate.change(input);
  });
  await review();
  await click("确认保存进展");
  assert.equal(f.record().progressHistory.length, 1);
  assert.ok(document.body.textContent.includes("上次提交结果待核对"));
  assert.ok(button("返回画布").disabled);
  await act(async () => root.render(null));
  state = f.state();
  await act(async () => render());
  await click("用原请求核对结果");
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(f.record().progressHistory.length, 1);
  assert.equal(sessionStorage.length, 0);
  assert.match(document.body.textContent, /待授权/);
  await click("请 Assistant 分析下一步");
  assert.equal(asked[0].refId, "mandate");
  assert.match(asked[1], /不要自动派工/);
  await act(async () =>
    document
      .querySelector(".cn-workbench-row")
      .dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  assert.equal(opened, "work");
  await edit();
  await review();
  await f.command("upsert_party", {
    id: "operator",
    type: "provider",
    displayName: "Changed by another owner window",
  });
  await click("确认保存进展");
  assert.match(document.body.textContent, /未覆盖其他人的修改/);
  assert.equal(f.record().progressHistory.length, 1);
  assert.equal(sessionStorage.length, 0);
  await click("刷新进展");
  assert.ok(button("更新业务进展"));
  console.log(
    JSON.stringify({
      ok: true,
      realLocalService: true,
      originalRequestRecovery: true,
      staleEditRejected: true,
      sameSourceDecisions: true,
      nativePromptContextOnly: true,
      miniErpModified: false,
    }),
  );
} finally {
  await act(async () => root.unmount());
  dom.window.close();
  f.service.close();
  for (const [k, desc] of saved) {
    if (desc) Object.defineProperty(globalThis, k, desc);
    else delete globalThis[k];
  }
}
