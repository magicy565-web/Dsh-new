export interface FactoryMaterialsInput { productId?: string; limit?: number }
export interface FactoryDocumentInput { documentId: string; documentVersion: number }
export declare const FACTORY_MATERIAL_INPUTS: Readonly<Record<'status' | 'materials' | 'document', {
  type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false;
}>>;
export declare function validateFactoryMaterialInput(method: 'status', input: unknown): Record<string, never>;
export declare function validateFactoryMaterialInput(method: 'materials', input: unknown): FactoryMaterialsInput;
export declare function validateFactoryMaterialInput(method: 'document', input: unknown): FactoryDocumentInput;
