export interface FactorySourceBase { workspaceId: string; recordId: string; revision: number; projectionSha256: string; api: string }
export interface FactoryDocumentSource extends FactorySourceBase {
  kind: 'factory-document'; documentVersion: number; artifactId: string; version: number; sha256: string;
}
export interface FactoryProductSource extends FactorySourceBase { kind: 'factory-product' }
export interface InquiryDraftDocument { name: string; content: string }
export interface InquiryDraftInput {
  inquiryDocumentId: string; documentVersion: number; productId: string;
  sources: (FactoryDocumentSource | FactoryProductSource)[];
  documents: InquiryDraftDocument[]; requestId: string;
}
export declare const FACTORY_INQUIRY_INPUT: {
  type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false;
};
/** Validates exact selected source correspondence, aggregate UTF-8 size and unique filenames too. */
export declare function validateInquiryDrafts(input: unknown): InquiryDraftInput;
