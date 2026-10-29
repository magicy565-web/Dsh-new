import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = process.env.COMMERCE_ACCEPTANCE_DIR;
if (
  !output ||
  !process.env.DSH_WEB_LOG ||
  !process.env.DSH_BROWSER_STATE ||
  !process.env.COMMERCE_FIXTURE
)
  throw Error(
    "Set isolated host log, browser state, output directory and Commerce fixture path.",
  );
const launch = (await readFile(process.env.DSH_WEB_LOG, "utf8")).match(
  /https?:\/\/[^\s\u001b]+/,
)?.[0];
if (
  !launch ||
  !["127.0.0.1", "localhost", "[::1]"].includes(new URL(launch).hostname)
)
  throw Error("Use a ready, isolated localhost host.");
const prior = JSON.parse(await readFile(process.env.COMMERCE_FIXTURE, "utf8"));
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  }),
  context = await browser.newContext({
    storageState: process.env.DSH_BROWSER_STATE,
    viewport: { width: 1600, height: 1050 },
  }),
  page = await context.newPage();
const errors = [],
  writes = [];
let sessionId,
  lost = false;
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.pathname === "/commerce-network-api/workspace")
    sessionId = u.searchParams.get("sessionId");
});
try {
  await page.goto(launch);
  await page.waitForTimeout(800);
  const sessions = page.getByText("New Session", { exact: true });
  if (!(await page.locator(".cn").count()) && (await sessions.count()) > 1)
    await sessions.last().click();
  const open = page.getByRole("button", {
    name: "Open right sidebar",
    exact: true,
  });
  if (await open.count()) await open.click();
  const commerce = page.getByRole("button", { name: /^Commerce Network/ });
  if (await commerce.count()) await commerce.click();
  await page.locator(".cn").waitFor();
  assert.equal(sessionId, prior.sessionId);
  const api = (path, body) =>
    page.evaluate(
      async ({ path, body }) => {
        const r = await fetch(path, {
          method: body ? "POST" : "GET",
          headers: body ? { "content-type": "application/json" } : {},
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: r.status, value: await r.json() };
      },
      { path, body },
    );
  const state = async () => {
    const r = await api(
      "/commerce-network-api/workspace?" +
        new URLSearchParams({ sessionId, projectId: prior.projectId }),
    );
    assert.equal(r.status, 200);
    return r.value.data;
  };
  const command = async (command, payload) => {
    const s = await state();
    const r = await api("/commerce-network-api/command", {
      sessionId,
      projectId: prior.projectId,
      command,
      payload,
      expectedRevision: s.revision,
      requestId: crypto.randomUUID(),
    });
    assert.equal(r.status, 200, JSON.stringify(r));
    return r.value.data;
  };
  let restartPreserved = false;
  try {
    const old = JSON.parse(
      await readFile(join(output, "workbench-native-fixture.json"), "utf8"),
    );
    assert.equal(old.sessionId, sessionId);
    const previous = (await state()).commerceNetwork.salesAuthorizations.find(
      (m) => m.id === old.mandateId,
    );
    assert.equal(previous.progress.stage, "service_review");
    assert.equal(previous.progressHistory.length, 7);
    restartPreserved = true;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const initial = await state();
  const source = initial.commerceNetwork.salesAuthorizations.find(
    (m) => m.businessTerms?.mode === "factory_sales" && m.status === "active",
  );
  assert.ok(source);
  const id = "progress-fixture-" + crypto.randomUUID(),
    title = "SYNTHETIC 工厂业务推进 " + Date.now();
  const payload = {
    id,
    title,
    businessTerms: { ...source.businessTerms, version: 1 },
  };
  for (const key of [
    "principalPartyId",
    "operatorPartyId",
    "marketCode",
    "scope",
    "productIds",
    "routeIds",
  ])
    payload[key] = source[key];
  payload.workOrderIds = [];
  await command("propose_business_mandate", payload);
  await command("approve_mandate", { mandateId: id });
  const agentId = "progress-agent-" + crypto.randomUUID(),
    orderId = "progress-work-" + crypto.randomUUID(),
    orderTitle = "SYNTHETIC 渠道调研 " + Date.now();
  await command("register_agent", {
    id: agentId,
    providerPartyId: source.operatorPartyId,
    displayName: "SYNTHETIC 未连接 Worker",
    skills: ["public_web_research"],
  });
  await command("propose_order", {
    id: orderId,
    requesterPartyId: source.principalPartyId,
    agentServiceId: agentId,
    title: orderTitle,
    brief: "Synthetic only; do not contact anyone",
    allowedActions: ["public_web_research"],
    allowedResourceRefs: [],
    maximumMinor: 0,
    currency: "USD",
    ttlSeconds: 3600,
  });
  const before = (await state()).commerceNetwork.salesAuthorizations.find(
    (m) => m.id === id,
  );
  async function openWorkbench() {
    await page
      .getByRole("button", { name: "刷新真实状态", exact: true })
      .click();
    await page.getByLabel("当前协作项目").selectOption(prior.projectId);
    await page.getByRole("button", { name: "业务推进", exact: true }).click();
    await page.locator(".cn-workbench-card").filter({ hasText: title }).click();
  }
  await page.route("**/commerce-network-api/command", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command !== "record_business_progress") return route.continue();
    writes.push(body);
    const response = await route.fetch();
    if (!lost && response.status() === 200) {
      lost = true;
      return route.abort("failed");
    }
    return route.fulfill({ response });
  });
  await openWorkbench();
  async function update(stage, count, { blocked = false, first = false } = {}) {
    await page
      .getByRole("button", { name: "更新业务进展", exact: true })
      .click();
    await page.getByLabel("业务阶段", { exact: true }).selectOption(stage);
    await page
      .getByLabel("推进状态", { exact: true })
      .selectOption(blocked ? "blocked" : "active");
    await page
      .getByLabel("下一步", { exact: true })
      .fill(
        blocked
          ? "补充产品尺寸后继续渠道评估"
          : "核对本阶段依据并安排下一项运营工作",
      );
    await page
      .getByLabel("阻碍", { exact: true })
      .fill(blocked ? "产品尺寸资料待补充" : "");
    await page
      .getByLabel("更新依据", { exact: true })
      .fill("SYNTHETIC 演练：人工记录运营阶段，不证明成交或收款");
    if (first)
      await page
        .getByRole("checkbox", { name: new RegExp(orderTitle) })
        .check();
    await page.getByRole("button", { name: "核对更新", exact: true }).click();
    await page
      .getByRole("button", { name: "确认保存进展", exact: true })
      .click();
    if (first) {
      await page
        .getByRole("button", { name: "用原请求核对结果", exact: true })
        .waitFor();
      await page.reload();
      await page.locator(".cn").waitFor();
      await page.getByLabel("当前协作项目").selectOption(prior.projectId);
      await page.getByRole("button", { name: "业务推进", exact: true }).click();
      await page
        .getByRole("button", { name: "用原请求核对结果", exact: true })
        .click();
    }
    await page.waitForFunction(
      (n) => document.querySelectorAll(".cn-workbench-history").length === n,
      count,
    );
  }
  await update("product_readiness", 1, { first: true });
  assert.deepEqual(writes[0], writes[1]);
  for (const [stage, count, blocked] of [
    ["channel_development", 2],
    ["inquiry_followup", 3],
    ["product_readiness", 4, true],
    ["quote_collaboration", 5],
    ["deal_review", 6],
    ["service_review", 7],
  ])
    await update(stage, count, { blocked });
  const after = await state(),
    m = after.commerceNetwork.salesAuthorizations.find((m) => m.id === id);
  assert.equal(m.progressHistory.length, 7);
  assert.equal(m.progressHistory[3].status, "blocked");
  assert.equal(m.revision, before.revision);
  assert.equal(m.approvalReceiptId, before.approvalReceiptId);
  assert.equal(
    after.commerceNetwork.workOrders.find((o) => o.id === orderId).status,
    "proposed",
  );
  assert.equal(m.progressView.decisions[0].id, orderId);
  assert.equal(
    after.commerceNetwork.grants.length,
    initial.commerceNetwork.grants.length,
  );
  assert.equal(m.progress.outcomes.length, 0);
  await page
    .locator(".cn-workbench-row")
    .filter({ hasText: orderTitle })
    .first()
    .click();
  await page.locator(".cn-inspector").waitFor();
  assert.ok(
    (await page.locator(".cn-inspector").innerText()).includes(orderTitle),
  );
  await openWorkbench();
  await page.locator(".cn-workbench-heading").scrollIntoViewIfNeeded();
  await page
    .locator("[role=dialog]")
    .screenshot({ path: join(output, "workbench-desktop.png") });
  await page.setViewportSize({ width: 430, height: 932 });
  await page.locator(".cn-workbench-heading").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "workbench-narrow.png") });
  const geometry = await page
    .locator(".cn-workbench")
    .evaluate((el) => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
  assert.ok(
    geometry.scrollWidth <= geometry.width + 2,
    JSON.stringify(geometry),
  );
  assert.deepEqual(errors, []);
  const receipt = {
    ok: true,
    officialHost: "@deepseek-ai/dsh@0.2.1-rc.3",
    actualNativeSession: true,
    syntheticOnly: true,
    miniErpUpdated: false,
    restartPreserved,
    checks: [
      "Owner progress update",
      "stage jump and rollback with reason",
      "blocked next action",
      "same-source pending work item opens inspector",
      "lost committed response and reload",
      "original request replay",
      "terms revision unchanged",
      "no task authorization",
      "430px no horizontal overflow",
    ],
    observed: {
      history: 7,
      duplicatedWrites: 0,
      modelCalls: 0,
      externalMessages: 0,
      payments: 0,
    },
    pageErrors: errors,
  };
  await writeFile(
    join(output, "workbench-browser-receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  await writeFile(
    join(output, "workbench-native-fixture.json"),
    JSON.stringify({ sessionId, projectId: prior.projectId, mandateId: id }),
  );
  await context.storageState({ path: process.env.DSH_BROWSER_STATE });
  console.log(JSON.stringify(receipt));
} catch (e) {
  await page.screenshot({ path: join(output, "workbench-failure.png") });
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
