import { ownerHttp } from "@workspace-agent/dsh-commerce-contracts";
export const API_PREFIX = "/quote-guard-api";
export const createHttpHandler = (service, options) =>
  ownerHttp(API_PREFIX, service, options);
