import assert from "node:assert/strict";
import { join } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const outputDir = process.env.COMMERCE_ACCEPTANCE_DIR;
if (!outputDir || !process.env.DSH_WEB_LOG || !process.env.DSH_BROWSER_STATE)
  throw new Error(
    "Set COMMERCE_ACCEPTANCE_DIR, DSH_WEB_LOG and DSH_BROWSER_STATE to isolated test paths.",
  );
import { readFile, writeFile } from "node:fs/promises";
const launch = (await readFile(process.env.DSH_WEB_LOG, "utf8")).match(
  /https?:\/\/[^\s\u001b]+/,
)[0];
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(launch).hostname))
  throw new Error("Use an isolated localhost DSH host.");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
    storageState: process.env.DSH_BROWSER_STATE,
    viewport: { width: 1600, height: 1050 },
  }),
  page = await context.newPage();
let sessionId;
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.pathname === "/commerce-network-api/workspace")
    sessionId = u.searchParams.get("sessionId");
});
try {
  await page.goto(launch);
  await page.waitForTimeout(1000);
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
  await page.waitForTimeout(500);
  assert.ok(sessionId);
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
  let projectId;
  const state = async () => {
    const r = await api(
      "/commerce-network-api/workspace?" +
        new URLSearchParams({ sessionId, ...(projectId ? { projectId } : {}) }),
    );
    assert.equal(r.status, 200);
    return r.value.data;
  };
  const command = async (command, payload) => {
    const s = await state();
    const r = await api("/commerce-network-api/command", {
      sessionId,
      projectId,
      expectedRevision: s.revision,
      requestId: crypto.randomUUID(),
      command,
      payload,
    });
    assert.equal(r.status, 200, JSON.stringify(r));
    return r.value.data;
  };
  let restartPreserved = false;
  try {
    const prior = JSON.parse(
      await readFile(
        join(outputDir, "commerce-mvp-browser-fixture.json"),
        "utf8",
      ),
    );
    assert.equal(prior.sessionId, sessionId);
    projectId = prior.projectId;
    const restored = await state();
    assert.equal(restored.commerceNetwork.salesAuthorizations.length, 3);
    assert.equal(
      restored.commerceNetwork.salesAuthorizations.find(
        (r) => r.id === prior.mandateIds[2],
      ).businessTerms.version,
      2,
    );
    assert.ok(
      restored.canvasLayouts
        .find((l) => l.projectId === projectId)
        .nodes.some((n) => n.id === "business_mandate:" + prior.mandateIds[0]),
    );
    restartPreserved = true;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const title = "SYNTHETIC MVP " + Date.now();
  projectId = (await command("create_project", { title })).projectId;
  await command("upsert_product", {
    id: "mvp-product-" + Date.now(),
    name: "Synthetic MVP product",
    source: "Isolated synthetic acceptance",
  });
  await page.getByRole("button", { name: "刷新真实状态", exact: true }).click();
  await page.getByLabel("当前协作项目").selectOption(projectId);
  await page.getByRole("button", { name: "业务委托", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "业务委托" });
  await dialog.waitFor();
  await dialog.getByText("登记委托方或服务方", { exact: true }).click();
  for (const [type, name] of [
    ["factory", "Synthetic Factory"],
    ["distributor", "Synthetic Seller"],
    ["provider", "Synthetic Operator"],
  ]) {
    await dialog.getByLabel("主体名称", { exact: true }).fill(name);
    await dialog.getByLabel("主体类型").selectOption(type);
    await dialog.getByRole("button", { name: "保存主体", exact: true }).click();
    await page.waitForFunction(
      (name) =>
        document.querySelector(".cn-business fieldset") &&
        !document.querySelector(".cn-business fieldset").disabled,
      name,
    );
    assert.ok(
      (await state()).commerceNetwork.parties.some(
        (p) => p.displayName === name,
      ),
    );
  }
  const rows = [];
  for (const [mode, name] of [
    ["factory_sales", "Synthetic factory mandate"],
    ["channel_subscription", "Synthetic channel mandate"],
    ["sourcing_commission", "Synthetic intermediary mandate"],
  ]) {
    await dialog.getByRole("button", { name: "新建委托", exact: true }).click();
    await dialog.getByLabel("业务模式").selectOption(mode);
    await dialog.getByLabel("委托名称", { exact: true }).fill(name);
    await dialog
      .getByLabel(/^委托方/)
      .selectOption({
        label:
          mode === "channel_subscription"
            ? "Synthetic Seller"
            : "Synthetic Factory",
      });
    await dialog
      .getByLabel(/^服务方/)
      .selectOption({ label: "Synthetic Operator" });
    await dialog.getByLabel("目标市场", { exact: true }).fill("US");
    await dialog
      .getByLabel("业务范围与交付约定", { exact: true })
      .fill("Synthetic acceptance only; no messages or payments");
    await dialog
      .getByLabel("开始日期（UTC）", { exact: true })
      .fill("2026-10-28");
    await dialog
      .getByLabel("结束日期（UTC）", { exact: true })
      .fill("2027-10-28");
    await dialog
      .getByLabel("AI 用量与费用约定", { exact: true })
      .fill(
        mode === "sourcing_commission"
          ? "Operator covers AI cost; no charge to principal"
          : "Synthetic policy only, no actual charge",
      );
    await dialog
      .getByLabel("协议依据（文件引用或约定说明）", { exact: true })
      .fill("Synthetic test agreement");
    if (mode === "factory_sales")
      await dialog
        .getByLabel("固定委托费（USD，空白为待约定）", { exact: true })
        .fill("1500");
    if (mode === "channel_subscription")
      await dialog
        .getByLabel("月订阅费（USD，空白为待约定）", { exact: true })
        .fill("29.99");
    else {
      await dialog
        .getByLabel("佣金比例（%，空白为待约定）", { exact: true })
        .fill("5");
      await dialog
        .getByLabel(
          "约定按净商品实收金额计算，核实收款后计提，退款按比例冲回",
          { exact: true },
        )
        .check();
    }
    await dialog.getByLabel("Synthetic MVP product", { exact: true }).check();
    await dialog
      .getByRole("button", { name: "保存待审核版本", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: name + " · 待授权", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "核对并审核", exact: true })
      .click();
    assert.ok((await dialog.innerText()).includes("尚未接通"));
    await dialog
      .getByRole("button", { name: "确认审核条款", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: name + " · 生效中", exact: true })
      .waitFor();
    const r = (await state()).commerceNetwork.salesAuthorizations.find(
      (r) => r.title === name,
    );
    assert.equal(r.status, "active");
    rows.push(r);
  }
  await dialog.getByRole("button", { name: "修改条款", exact: true }).click();
  await dialog
    .getByLabel("业务范围与交付约定", { exact: true })
    .fill("Synthetic amended scope");
  await dialog
    .getByRole("button", { name: "保存待审核版本", exact: true })
    .click();
  await dialog
    .getByRole("button", {
      name: "Synthetic intermediary mandate · 待授权",
      exact: true,
    })
    .waitFor();
  let amended = (await state()).commerceNetwork.salesAuthorizations.find(
    (r) => r.id === rows[2].id,
  );
  assert.equal(amended.businessTerms.version, 2);
  assert.equal(amended.history[0].status, "active");
  assert.equal(amended.approvalReceiptId, undefined);
  await dialog.getByRole("button", { name: "核对并审核", exact: true }).click();
  await dialog
    .getByRole("button", { name: "确认审核条款", exact: true })
    .click();
  await dialog
    .getByRole("button", {
      name: "Synthetic intermediary mandate · 生效中",
      exact: true,
    })
    .waitFor();
  await page.screenshot({
    path: join(outputDir, "commerce-mvp-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 430, height: 900 });
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.width <= 430);
  await page.screenshot({
    path: join(outputDir, "commerce-mvp-narrow.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "关闭", exact: true })
    .last()
    .click();
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.getByRole("button", { name: "商业网络", exact: true }).click();
  await page
    .getByRole("button", { name: "自动整理并保存布局", exact: true })
    .click();
  await page.waitForTimeout(500);
  const node = page.locator(`[data-id="business_mandate:${rows[0].id}"]`);
  await node.waitFor();
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  await node.click();
  await dialog.waitFor();
  assert.ok((await dialog.innerText()).includes("Synthetic factory mandate"));
  const final = await state();
  assert.equal(final.budget.accruedMinor, 0);
  assert.equal(final.budget.reservedMinor, 0);
  assert.equal(final.commerceNetwork.grants.length, 0);
  assert.equal(final.commerceNetwork.salesAuthorizations.length, 3);
  assert.ok(
    final.canvasLayouts
      .find((l) => l.projectId === projectId)
      .nodes.some((n) => n.id === `business_mandate:${rows[0].id}`),
  );
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const receipt = {
    ok: true,
    officialHost: "@deepseek-ai/dsh@0.2.1-rc.3",
    packageVersion: "1.2.0-rc.1",
    actualNativeSession: true,
    actualOwnerHttp: true,
    syntheticFixture: true,
    restartPreserved,
    checks: [
      "native-installed-client",
      "party-registration-ui",
      "all-three-modes-create-and-owner-review",
      "fixed-monthly-and-commission-terms",
      "product-references",
      "amendment-preserves-history-and-resets-approval",
      "business-canvas-node-opens-terms",
      "saved-business-node-layout",
      "430px-dialog",
      "no-automatic-charges-or-grants",
    ],
    observed: {
      mandates: 3,
      accruedMinor: 0,
      reservedMinor: 0,
      externalMessages: 0,
      modelCalls: 0,
    },
    pageErrors: errors,
  };
  await writeFile(
    join(outputDir, "commerce-mvp-browser-receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  await writeFile(
    join(outputDir, "commerce-mvp-browser-fixture.json"),
    JSON.stringify({ sessionId, projectId, mandateIds: rows.map((r) => r.id) }),
  );
  await context.storageState({ path: process.env.DSH_BROWSER_STATE });
  console.log(JSON.stringify(receipt));
} catch (e) {
  await page.screenshot({
    path: join(outputDir, "commerce-mvp-failure.png"),
    fullPage: true,
  });
  console.log(
    await page
      .locator(".cn-business")
      .innerText()
      .catch(() => ""),
  );
  console.log(
    await page
      .locator(".cn-business label")
      .evaluateAll((rows) =>
        rows.map((r) => ({
          text: r.textContent,
          html: r.outerHTML.slice(0, 400),
        })),
      ),
  );
  throw e;
} finally {
  await browser.close();
}
