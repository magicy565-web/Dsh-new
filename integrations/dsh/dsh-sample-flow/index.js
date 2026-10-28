import {
  createAccess,
  dependency,
  ownerHttp,
  register,
  schema,
  identifier,
  fail,
  keys,
} from "@workspace-agent/dsh-commerce-contracts";
export const inject = ["tools", "workspaceRegistry"];
export function createSampleService({ registry, erp }) {
  const access = createAccess(registry),
    ledger = () => dependency(erp, "Mini ERP trade records");
  return {
    toolRead(args, execution) {
      keys(args, ["id", "projectId", "afterId", "limit"]);
      const s = access.tool(execution);
      return args.id ? ledger().get(s, args.id) : ledger().list(s, args);
    },
    toolPropose(args, execution) {
      keys(args, [
        "requestId",
        "expectedRevision",
        "quoteId",
        "quoteVersion",
        "quantity",
        "address",
      ]);
      return ledger().write(access.tool(execution), {
        ...args,
        action: "propose",
      });
    },
    async http(method, action, body, recheck) {
      const { sessionId, ...args } = body,
        s = access.owner(sessionId, recheck.sync);
      if (method === "GET" && action === "read") {
        if (args.limit) args.limit = Number(args.limit);
        keys(args, ["id", "projectId", "afterId", "limit"]);
        return args.id ? ledger().get(s, args.id) : ledger().list(s, args);
      }
      if (method === "POST" && action === "upload-evidence") {
        await recheck();
        return ledger().uploadEvidence(s, args);
      }
      if (method === "POST" && action === "command") {
        await recheck();
        return ledger().write(s, args);
      }
      fail("NOT_FOUND");
    },
    close() {
      access.close();
    },
  };
}
export function apply(ctx) {
  const service = createSampleService({
    registry: ctx.workspaceRegistry,
    erp: () => ctx.get("miniErpTrade"),
  });
  ctx.effect(() => () => service.close(), "sample lifetime");
  ctx.effect(
    () => ctx.reflect.provide("sampleFlow", service),
    "sample service",
  );
  register(
    ctx,
    "sample_read",
    "Read current workspace sample requests. Shipping and payment remain unknown without separately recorded evidence.",
    schema({
      id: identifier,
      projectId: identifier,
      afterId: identifier,
      limit: { type: "integer", minimum: 1, maximum: 100 },
    }),
    (a, e) => service.toolRead(a, e),
  );
  register(
    ctx,
    "sample_propose",
    "Prepare an unapproved sample request from an evidenced sent and accepted quotation. Does not ship, charge money or adjust stock.",
    {
      ...schema({
        requestId: identifier,
        expectedRevision: { type: "integer", enum: [0] },
        quoteId: identifier,
        quoteVersion: { type: "integer", minimum: 1 },
        quantity: { type: "integer", minimum: 1, maximum: 1000 },
        address: { type: "string", maxLength: 2000 },
      }),
      required: [
        "requestId",
        "expectedRevision",
        "quoteId",
        "quoteVersion",
        "quantity",
        "address",
      ],
    },
    (a, e) => service.toolPropose(a, e),
  );
  ctx.inject(["webServer", "connection"], (web) =>
    web.effect(
      () =>
        web.webServer.register({
          kind: "prefix",
          path: "/sample-flow-api",
          handler: ownerHttp("/sample-flow-api", service, {
            authorize: (r) => web.connection.requestRejection(r),
          }),
        }),
      "sample HTTP",
    ),
  );
}
export default { inject, apply };
