import {
  createAccess,
  keys,
  fail,
  dependency,
} from "@workspace-agent/dsh-commerce-contracts";
export function createQuoteGuard({
  registry,
  erp,
  trade = () => null,
  transport = () => null,
}) {
  const access = createAccess(registry);
  const ledger = () => dependency(erp, "Mini ERP quote service");
  return {
    toolPreview(input, execution) {
      return ledger().preview(access.tool(execution), input);
    },
    toolPropose(input, execution) {
      return ledger().propose(access.tool(execution), input);
    },
    async http(method, action, body, recheck = async () => {}) {
      const { sessionId, ...input } = body;
      const scope = access.owner(sessionId, recheck.sync);
      if (method === "GET" && action === "status") {
        keys(input, []);
        return {
          transport: transport()
            ? { status: "configured", accountRef: transport().accountRef }
            : { status: "UNCONFIGURED" },
          payment: "UNCONFIGURED",
          whatsapp: "UNCONFIGURED",
        };
      }
      if (method === "GET" && action === "read") {
        if (input.version) input.version = Number(input.version);
        if (input.limit) input.limit = Number(input.limit);
        return ledger().read(scope, input);
      }
      if (method === "GET" && action === "review")
        return ledger().review(scope, input, transport());
      if (method === "POST" && action === "upload-evidence") {
        await recheck();
        return dependency(trade, "Mini ERP trade records").uploadEvidence(
          scope,
          input,
        );
      }
      if (method === "POST" && action === "record_evidence") {
        await recheck();
        return dependency(trade, "Mini ERP trade records").recordFinancial(
          scope,
          input,
        );
      }
      if (method === "POST" && action === "approve") {
        await recheck();
        return ledger().approve(scope, input, transport());
      }
      if (
        method === "POST" &&
        ["policy", "withdraw", "accept", "link_order"].includes(action)
      ) {
        await recheck();
        return ledger()[action === "link_order" ? "linkOrder" : action](
          scope,
          input,
        );
      }
      if (method === "POST" && ["send", "reconcile"].includes(action)) {
        await recheck();
        return ledger()[action](scope, input, transport());
      }
      fail("NOT_FOUND", "Unknown QuoteGuard endpoint", 404);
    },
    close() {
      access.close();
    },
  };
}
