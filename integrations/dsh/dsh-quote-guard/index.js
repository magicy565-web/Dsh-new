import {
  ownerHttp,
  register,
  schema,
  identifier,
} from "@workspace-agent/dsh-commerce-contracts";
import { createQuoteGuard } from "./service.js";
import { createResendTransport } from "./transport.js";
import { createInboundHandler } from "./ingress.js";
export const inject = ["tools", "workspaceRegistry"];
export function registerTools(ctx, service) {
  const proposal = {
    rfqRef: identifier,
    rfqRevision: { type: "integer", minimum: 1 },
    productId: identifier,
    productRevision: { type: "integer", minimum: 1 },
    validUntil: { type: "string" },
  };
  register(
    ctx,
    "quote_preview",
    "Read a deterministic quote candidate from the exact reviewed source SKU and owner pricing/disclosure policy. Missing evidence blocks pricing. Does not approve or send.",
    { ...schema(proposal), required: Object.keys(proposal) },
    (a, e) => service.toolPreview(a, e),
  );
  register(
    ctx,
    "quote_propose",
    "Create a NEW unapproved quote version in Mini ERP. Never supply a price, buyer identity, approval or arbitrary message body. Current RFQ, source and policy determine the price. Owner separately reviews and approves exact recipient and content.",
    {
      ...schema({
        ...proposal,
        quoteId: identifier,
        requestId: identifier,
        expectedRevision: { type: "integer", minimum: 0 },
      }),
      required: [...Object.keys(proposal), "requestId", "expectedRevision"],
    },
    (a, e) => service.toolPropose(a, e),
  );
}
export function apply(ctx, config = {}) {
  const adapter = createResendTransport({
    apiKey: config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined,
    from: config.from,
    accountRef: config.accountRef,
  });
  const service = createQuoteGuard({
    registry: ctx.workspaceRegistry,
    erp: () => ctx.get("miniErpQuotes"),
    trade: () => ctx.get("miniErpTrade"),
    transport: () => adapter,
  });
  ctx.effect(() => () => service.close(), "quote-guard: lifetime");
  ctx.effect(
    () => ctx.reflect.provide("quoteGuard", service),
    "quote-guard: service",
  );
  registerTools(ctx, service);
  ctx.inject(["webServer"], (web) =>
    web.effect(
      () =>
        web.webServer.register({
          kind: "prefix",
          path: "/quote-guard-inbound",
          handler: createInboundHandler({
            secret: config.webhookSecretEnv
              ? process.env[config.webhookSecretEnv]
              : undefined,
            transport: adapter,
            rfq: () => ctx.get("rfqDesk"),
            sessionId: config.inboundSessionId,
            projectId: config.inboundProjectId,
            inbox: config.inboundInbox,
            allowRemote: config.allowRemoteIngress === true,
          }),
        }),
      "quote-guard: signed provider ingress",
    ),
  );
  ctx.inject(["webServer", "connection"], (web) =>
    web.effect(
      () =>
        web.webServer.register({
          kind: "prefix",
          path: "/quote-guard-api",
          handler: ownerHttp("/quote-guard-api", service, {
            authorize: (r) => web.connection.requestRejection(r),
          }),
        }),
      "quote-guard: owner HTTP",
    ),
  );
}
export default { inject, apply };
