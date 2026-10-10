export type OrderEvidence = { id: string; name: string; test: boolean; cancelledAt: string | null; financialStatus: string; fulfillmentStatus: string; currency: string; received: string; refunded: string; netReceived: string; salesEvidence: boolean };
export type CommerceProject = {
  id: string; revision: number; productId: string; productRevision: number; productName: string; publicDescription: string;
  market: string; objective: string; budget: { amount: string; currency: string }; durationDays: number; validationOrderTarget: number;
  status: string; researchGoalId: string | null; createdAt: string; updatedAt: string;
  researchOrderId?: string | null;
  researchOrder: { id: string; serviceTitle: string; status: string; workerId: string | null; budgetCredits: number; deadlineAt: string;
    reportedCostCredits: number | null; deliveryArtifactId: string | null; acceptedAt: string | null; deliverableCount: number;
    evidenceCount: number; prospectCount: number; independentlyVerified: false } | null;
  orderEvidence: { complete: boolean; observedAt: string; orders: OrderEvidence[] } | null;
  results: { observedOrders: number; testOrders: number; paidFulfilledOrders: number; netReceipts: { currency: string; amount: string }[]; complete: boolean; observedAt: string | null; billableAmount: null };
};
export type ShopifyStatus = { configured: boolean; domain: string | null; status: string; verifiedAt: string | null; shop: { name: string; domain: string } | null; scopes: string[]; orderReadAvailable: boolean; requirements: string[]; lastError: { message: string } | null };
export type CommerceStatus = { harness: { native: boolean; configured: boolean }; shopify: ShopifyStatus;
  muse: { installed: boolean; approved: boolean; onlineVerified: boolean; lastSeenAt: string | null; pending?: number; claimed?: number; completed?: number };
  cloudComputer: { status: string; executionAvailable: boolean }; settlement: { automaticCharge: boolean } };
