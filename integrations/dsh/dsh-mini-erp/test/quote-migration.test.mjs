import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErpStore } from "../store.js";
test("v3 to v4 preserves every legacy buyer, offer, order, price and request receipt through restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "quote-migration-")),
    file = join(dir, "erp.sqlite");
  let store = new ErpStore(file);
  try {
    store.write("w", {
      action: "add_buyer",
      requestId: "b",
      id: "b",
      name: "Synthetic legacy",
      contact: "old@example.test",
    });
    store.write("w", {
      action: "add_product",
      requestId: "p",
      id: "p",
      name: "Legacy",
      currency: "USD",
      unitPriceMinor: 1234,
      stockTotal: 100,
      source: "fixture",
    });
    store.write("w", {
      action: "add_offer",
      requestId: "o",
      id: "o",
      productId: "p",
      territory: "US",
      channel: "wholesale",
      term: "fixture",
      conditions: "fixture",
      capacity: 3,
      validUntil: "2030-01-01T00:00:00Z",
      source: "fixture",
    });
    const command = {
      action: "reserve",
      requestId: "reserve",
      productId: "p",
      buyerId: "b",
      offerId: "o",
      expectedRevision: 1,
      quantity: 2,
    };
    const receipt = store.write("w", command);
    const tables = [
        "products",
        "buyers",
        "offers",
        "orders",
        "requests",
        "events",
        "catalog_links",
      ],
      before = Object.fromEntries(
        tables.map((t) => [t, store.db.prepare(`SELECT * FROM ${t}`).all()]),
      );
    for (const t of [
      "quote_requests",
      "quote_events",
      "quote_delivery_outbox",
      "quote_versions",
      "quotes",
      "quote_policies",
      "sample_commands",
      "sample_events",
      "sample_requests",
      "channel_evidence",
    ])
      store.db.exec(`DROP TABLE ${t}`);
    store.db.exec("PRAGMA user_version=3");
    store.close();
    store = new ErpStore(file);
    assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 4);
    for (const t of tables)
      assert.deepEqual(store.db.prepare(`SELECT * FROM ${t}`).all(), before[t]);
    assert.equal(store.write("w", command).id, receipt.id);
    store.close();
    store = new ErpStore(file);
    assert.equal(
      store.read("w", { entity: "order", id: receipt.id }).totalMinor,
      2468,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
