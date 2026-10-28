import { ownerHttp } from "@workspace-agent/dsh-commerce-contracts";
export const API_PREFIX = "/rfq-desk-api";
export const createHttpHandler = (service, options) =>
  ownerHttp(API_PREFIX, service, options);
