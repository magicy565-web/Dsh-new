import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../../dsh-quote-guard/test/fixture.mjs";
import { createChannelLedger } from "../index.js";
test("unknown cash and commission stay null; service cost and order value are separate", (t) => {
  const f = fixture();
  t.after(() => f.close());
  const network = {
    state: () => ({
      workspaceId: f.w,
      projectId: "p1",
      revision: 1,
      budget: { currency: "USD", maximumMinor: 5000 },
      commerceNetwork: {
        salesAuthorizations: [],
        workOrders: [
          { currency: "USD", status: "delivered", actualMinor: 100 },
          { currency: "USD", status: "accepted", actualMinor: 200 },
        ],
      },
    }),
  };
  const ledger = createChannelLedger({
    registry: f.registry,
    commerce: () => network,
    quotes: () => ({
      read: () => ({
        items: [{ currency: "USD", status: "approved", totalMinor: 999 }],
        hasMore: false,
      }),
      orderRefs: () => [
        {
          id: "o1",
          currency: "USD",
          status: "confirmed",
          totalMinor: 400,
          buyerId: "b1",
        },
      ],
    }),
    trade: () => ({ financial: () => [] }),
  });
  const r = ledger.read(f.owner, { projectId: "p1" }).metrics[0];
  assert.equal(r.plannedBudgetMinor, 5000);
  assert.equal(r.workerReportedCostMinor, 300);
  assert.equal(r.approvedCostMinor, 200);
  assert.equal(r.quotedValueMinor, 999);
  assert.equal(r.confirmedOrderValueMinor, 400);
  assert.equal(r.collectedRevenueMinor, null);
  assert.equal(r.commissionPaidMinor, null);
  assert.equal(r.commissionAccruedMinor, null);
  assert.equal(r.attributionStatus, "requires_owner_resolution");
  assert.equal(r.settlementStatus, "not_connected");
  assert.throws(
    () => ledger.read(f.access.owner("session-other"), { projectId: "p1" }),
    { code: "PROJECT_SCOPE" },
  );
});
