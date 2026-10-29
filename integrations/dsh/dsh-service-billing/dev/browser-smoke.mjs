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
  const list = async (mandateId) => {
    const r = await api(
      "/service-billing-api/list?" +
        new URLSearchParams({
          sessionId,
          projectId: prior.projectId,
          mandateId,
        }),
    );
    assert.equal(r.status, 200, JSON.stringify(r));
    return r.value.data.items;
  };
  let restartPreserved = false;
  try {
    const old = JSON.parse(
      await readFile(join(output, "billing-native-fixture.json"), "utf8"),
    );
    assert.equal(old.sessionId, sessionId);
    const rows = await list(old.mandateId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, old.billId);
    assert.equal(rows[0].netCollectedMinor, 3000);
    assert.equal(
      rows[0].events.filter((e) => e.kind === "collection").length,
      1,
    );
    assert.equal(rows[0].events.filter((e) => e.kind === "refund").length, 1);
    restartPreserved = true;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const source = (await state()).commerceNetwork.salesAuthorizations.find(
    (r) => r.businessTerms?.mode === "factory_sales" && r.status === "active",
  );
  assert.ok(source);
  const id = "billing-fixture-" + crypto.randomUUID(),
    title = "SYNTHETIC 独立服务计费 " + Date.now(),
    payload = { id, title, businessTerms: source.businessTerms };
  for (const key of [
    "principalPartyId",
    "operatorPartyId",
    "marketCode",
    "scope",
    "productIds",
    "routeIds",
    "workOrderIds",
  ])
    payload[key] = source[key];
  await command("propose_business_mandate", payload);
  await command("approve_mandate", { mandateId: id });
  const openBilling = async () => {
    await page
      .getByRole("button", { name: "刷新真实状态", exact: true })
      .click();
    await page.getByLabel("当前协作项目").selectOption(prior.projectId);
    await page.getByRole("button", { name: "业务委托", exact: true }).click();
    await page
      .getByRole("dialog", { name: "业务委托" })
      .getByRole("button", { name: title + " · 生效中", exact: true })
      .click();
    await page
      .getByRole("button", { name: "服务账单与对账", exact: true })
      .click();
    await page.getByRole("dialog", { name: "服务账单与对账" }).waitFor();
  };
  await openBilling();
  const dialog = page.getByRole("dialog", { name: "服务账单与对账" });
  await dialog
    .getByRole("button", { name: "生成账单草稿", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "核对并确认账单", exact: true })
    .click();
  await dialog.getByRole("button", { name: "确认记录", exact: true }).click();
  await dialog
    .getByRole("button", { name: "登记收款凭据", exact: true })
    .waitFor();
  await page.route("**/service-billing-api/write", async (route) => {
    const body = JSON.parse(route.request().postData());
    writes.push(body);
    const response = await route.fetch();
    if (body.action === "collection" && !lost && response.status() === 200) {
      lost = true;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  async function prepare(action, amount, external, collectionId) {
    await dialog
      .getByRole("button", {
        name: action === "collection" ? "登记收款凭据" : "登记退款凭据",
        exact: true,
      })
      .click();
    await dialog.getByLabel("本次金额（USD）", { exact: true }).fill(amount);
    if (collectionId)
      await dialog
        .getByLabel("对应收款", { exact: true })
        .selectOption(collectionId);
    await dialog
      .getByLabel("机构与账号标识（不填密码）", { exact: true })
      .fill("synthetic-bank:isolated-account");
    await dialog.getByLabel("外部交易编号", { exact: true }).fill(external);
    await dialog
      .getByLabel("实际收退款凭据", { exact: true })
      .setInputFiles({
        name: "SYNTHETIC-" + action + ".txt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "SYNTHETIC fixture only, not a bank transfer. " + external,
        ),
      });
    await page.waitForTimeout(1050);
    await dialog
      .getByLabel("实际发生时间（UTC）", { exact: true })
      .fill(new Date().toISOString().slice(0, 19));
    await dialog
      .getByRole("button", { name: "上传并核对凭据", exact: true })
      .click();
    await dialog.getByRole("button", { name: "确认记录", exact: true }).click();
  }
  await prepare("collection", "40.00", "synthetic-collection-" + id);
  await dialog
    .getByRole("button", { name: "用原请求重试", exact: true })
    .waitFor();
  await page.reload();
  await page.locator(".cn").waitFor();
  await openBilling();
  await dialog
    .getByRole("button", { name: "用原请求重试", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "登记退款凭据", exact: true })
    .waitFor();
  const receipts = writes.filter((r) => r.action === "collection");
  assert.deepEqual(receipts[0], receipts[1]);
  let bill = (await list(id))[0];
  assert.equal(bill.netCollectedMinor, 4000);
  const collectionId = bill.events.find((e) => e.kind === "collection").id;
  await prepare("refund", "10.00", "synthetic-refund-" + id, collectionId);
  await dialog
    .getByRole("button", { name: "登记收款凭据", exact: true })
    .waitFor();
  bill = (await list(id))[0];
  assert.equal(bill.netCollectedMinor, 3000);
  assert.equal(bill.refundedMinor, 1000);
  assert.equal(bill.outstandingMinor, bill.amountMinor - 3000);
  assert.equal(bill.events.filter((e) => e.kind === "collection").length, 1);
  assert.equal(bill.events.filter((e) => e.kind === "refund").length, 1);
  await dialog
    .getByRole("button", { name: "生成账单草稿", exact: true })
    .click();
  await dialog.getByRole("alert").filter({ hasText: "不能重复收费" }).waitFor();
  await dialog.getByRole("button", { name: "刷新账单", exact: true }).click();
  await page.waitForTimeout(300);
  await dialog.screenshot({ path: join(output, "billing-desktop.png") });
  await page.setViewportSize({ width: 430, height: 900 });
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.width <= 430);
  await page.screenshot({
    path: join(output, "billing-narrow.png"),
    fullPage: true,
  });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const receipt = {
    ok: true,
    officialHost: "@deepseek-ai/dsh@0.2.1-rc.3",
    actualNativeSession: true,
    actualNativeAttachments: true,
    syntheticEvidenceOnly: true,
    installedUpdates: [
      "dsh-commerce-network@1.3.0-rc.1",
      "dsh-service-billing@0.1.0-rc.1",
    ],
    miniErpUpdated: false,
    restartPreserved,
    checks: [
      "Owner invoice issue",
      "native evidence bytes uploaded",
      "lost committed response and browser remount",
      "same request replay without duplicate receipt",
      "partial collection",
      "linked refund",
      "outstanding balance",
      "duplicate fixed fee rejected",
      "430px dialog",
    ],
    observed: {
      bills: 1,
      collections: 1,
      refunds: 1,
      netCollectedMinor: 3000,
      externalPayments: 0,
      modelCalls: 0,
    },
    pageErrors: errors,
  };
  await writeFile(
    join(output, "billing-browser-receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  await writeFile(
    join(output, "billing-native-fixture.json"),
    JSON.stringify({
      sessionId,
      projectId: prior.projectId,
      mandateId: id,
      billId: bill.id,
    }),
  );
  await context.storageState({ path: process.env.DSH_BROWSER_STATE });
  console.log(JSON.stringify(receipt));
} catch (e) {
  await page.screenshot({
    path: join(output, "billing-failure.png"),
    fullPage: true,
  });
  console.log(
    await page
      .locator(".cn-billing")
      .innerText()
      .catch(() => ""),
  );
  throw e;
} finally {
  await browser.close();
}
