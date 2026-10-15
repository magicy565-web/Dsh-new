export interface CustomerDraftDocument { name: string; content: string }
export interface CustomerDraftInput { requestId: string; documents: CustomerDraftDocument[]; sourceToolCallIds: string[] }
export declare const FACTORY_CUSTOMER_INPUT: {
  type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false;
};
/** Validates public-only policy and aggregate limits as well as the closed DTO. Returns an independent copy. */
export declare function validateCustomerDrafts(input: unknown): CustomerDraftInput;
