import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  ownerHttp,
  register,
  schema,
  identifier,
} from "@workspace-agent/dsh-commerce-contracts";
import { ServiceBillingStore } from "./store.js";
import { createServiceBilling } from "./service.js";
export const inject = ["tools", "workspaceRegistry"];
export function dataDirectory(config = {}) {
  if (config.dataDir) return resolve(config.dataDir);
  const home = process.env.DSH_HOME;
  const root =
    home === "~"
      ? homedir()
      : home?.startsWith("~/")
        ? join(homedir(), home.slice(2))
        : home;
  return join(
    root
      ? resolve(root)
      : process.env.DSH_PROFILE_DIR
        ? resolve(process.env.DSH_PROFILE_DIR, "..", "..")
        : join(homedir(), ".dsh"),
    "service-billing",
  );
}
export function apply(ctx, config = {}) {
  const store = new ServiceBillingStore(
    join(dataDirectory(config), "billing.sqlite"),
  );
  const billing = createServiceBilling(store, {
    registry: ctx.workspaceRegistry,
    commerce: () => ctx.get("commerceNetwork"),
    attachments: () => ctx.get("attachments"),
  });
  ctx.effect(
    () => () => {
      billing.close();
      store.close();
    },
    "service billing lifetime",
  );
  ctx.effect(
    () => ctx.reflect.provide("serviceBilling", billing),
    "service billing service",
  );
  register(
    ctx,
    "service_billing_read",
    "Read internal service fee statements and evidenced receipts/refunds for the current workspace. These are distinct from product sales, commissions, tax invoices and AI usage. No payment provider is connected.",
    {
      ...schema({
        projectId: identifier,
        mandateId: identifier,
        afterId: identifier,
        limit: { type: "integer", minimum: 1, maximum: 100 },
      }),
      required: ["projectId"],
    },
    (input, execution) => billing.toolRead(input, execution),
  );
  register(
    ctx,
    "service_billing_propose",
    "Draft an internal service statement from an already owner-reviewed business mandate. Only factory fixed fees and channel full-month service fees are supported. Amount and currency derive from exact mandate terms. Monthly periodStart must be an elapsed or current service anniversary. This cannot issue a statement, record payment, bill a commission-only mandate or trigger a real charge. Do not invent usage or proration.",
    {
      ...schema({
        projectId: identifier,
        mandateId: identifier,
        requestId: identifier,
        expectedMandateRevision: { type: "integer", minimum: 1 },
        kind: { enum: ["fixed_fee", "monthly_fee"] },
        periodStart: { type: "string" },
      }),
      required: [
        "projectId",
        "mandateId",
        "requestId",
        "expectedMandateRevision",
        "kind",
      ],
    },
    (input, execution) => billing.toolDraft(input, execution),
  );
  ctx.inject(["webServer", "connection"], (web) =>
    web.effect(
      () =>
        web.webServer.register({
          kind: "prefix",
          path: "/service-billing-api",
          handler: ownerHttp("/service-billing-api", billing, {
            authorize: (req) => web.connection.requestRejection(req),
          }),
        }),
      "service billing Owner HTTP",
    ),
  );
}
export default { inject, apply };
