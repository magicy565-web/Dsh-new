export interface ProductSelector { productId: string }
export interface ProductImageInput extends ProductSelector { imageId: string }
export interface ProductListingDraft {
  title: string; description: string; targetMarket: string; currency: string;
  retailUnit: string; unitsPerPack: number; consumerPrice: string;
  handlingDays: number; shippingDays: number; skuCode: string | null; imageIds: string[];
}
export interface ProductProposalInput extends ProductSelector { sourceHash: string; requestId: string; draft: ProductListingDraft }
export type PublicationReviewInput = { serviceId: string; requestId: string } & (
  { action: 'draft'; publicationId?: never } | { action: 'publish'; publicationId: string });
export interface PublicationOperationInput { serviceId: string; operationId: string; expectedScopeHash: string; requestId: string }
export interface ProductInputMap {
  status: Record<string, never>; read: ProductSelector; readiness: ProductSelector; image: ProductImageInput;
  propose: ProductProposalInput; review: PublicationReviewInput; execute: PublicationOperationInput; reconcile: PublicationOperationInput; result: { serviceId: string };
}
export type ShopifyProductMethod = keyof ProductInputMap;
export declare const SHOPIFY_PRODUCT_PLUGIN: 'workspace-shopify-product';
export declare const SHOPIFY_PRODUCT_INPUTS: Readonly<Record<ShopifyProductMethod, {
  type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false;
}>>;
export declare function validateShopifyProductInput<M extends ShopifyProductMethod>(method: M, input: unknown): ProductInputMap[M];
