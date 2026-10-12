/** Stable product/preview fields from SUPPLIER-SERVICE-CONTRACT.md at 0f12d2a.
 * This view never infers consumer price, pack quantity or delivery from private supply facts. */
export type SupplierImage = { kind: 'artifact'; asset: { artifactId: string; version: number; sha256: string }; sourceNote: string } | { kind: 'public_url'; url: string; sourceNote: string };
export type SupplierProfile = {
  name: string | null; description: string | null; targetMarket: string | null; currency: string | null; skuCode: string | null;
  supplierUnit: string | null; supplierMoq: number | null; wholesaleUnitPrice: string | null; wholesaleCurrency: string | null;
  internalUnitCost: string | null; internalCostCurrency: string | null; recommendedRetailPrice: string | null;
  retailUnit: string | null; unitsPerPack: number | null; consumerPrice: string | null;
  productionDays: number | null; handlingDays: number | null; shippingDays: number | null; images: SupplierImage[];
};
export const publicListingFields = ['name', 'description', 'skuCode', 'retailUnit', 'unitsPerPack', 'consumerPrice', 'handlingDays', 'shippingDays', 'images'] as const;
export type PublicListingField = typeof publicListingFields[number];
export const supplierFieldLabels: Record<string, string> = {
  name: '商品名称', description: '商品描述', targetMarket: '销售国家代码', currency: '消费币种', skuCode: 'SKU',
  supplierUnit: '供货单位', supplierMoq: '供货起订量', wholesaleUnitPrice: '批发单价', wholesaleCurrency: '批发币种',
  internalUnitCost: '内部成本', internalCostCurrency: '成本币种', recommendedRetailPrice: '建议零售价',
  retailUnit: '零售单位', unitsPerPack: '每包装件数', consumerPrice: '消费者实际售价', productionDays: '生产天数',
  handlingDays: '处理及发货天数', shippingDays: '运输天数', images: '图片来源', usableImage: '可用图片',
};
export type SupplierPreview = {
  schema: 'workspace.supplier-listing.v1'; phase: 'needs_information' | 'preview_ready'; missingFields: string[];
  market: { countryCode: string | null; currency: string | null };
  saleUnit: { unit: string | null; unitsPerPack: number | null; consumerPrice: string | null };
  product: { title: string | null; descriptionHtml: string; status: 'DRAFT' };
  variants: { sku: string | null; price: string | null }[];
  fulfillment: { handlingDays: number | null; shippingDays: number | null };
  images: (SupplierImage & { availability: string; transferStatus: string })[];
  display: { title: string | null; paragraphs: string[]; imageStatus: string };
  externalStatus: 'preview'; published: false; shopifyProductId: null; publicFields: PublicListingField[];
};
const explicit = (value: string | number | null | undefined) => value === null || value === undefined ? '尚未提供' : String(value);
export function listingFieldText(profile: SupplierProfile, field: PublicListingField) {
  if (field === 'images') return profile.images.map(image => `${image.sourceNote}\n${image.kind === 'artifact' ? `原文件 ${image.asset.artifactId} · v${image.asset.version}\nSHA256 ${image.asset.sha256}` : `公开来源 ${image.url} · 可用性待核验`}`).join('\n\n') || '尚未提供';
  return `${supplierFieldLabels[field]}：${explicit(profile[field])}${field === 'consumerPrice' ? ` ${explicit(profile.currency)}` : ''}`;
}
export function presentSupplierPreview(preview: SupplierPreview) {
  if (!preview || preview.schema !== 'workspace.supplier-listing.v1' || preview.externalStatus !== 'preview' || preview.published !== false || preview.shopifyProductId !== null) throw new Error('商品预览状态无法核对，请读取原服务。');
  return {
    title: preview.display.title || '商品名称尚未提供', paragraphs: preview.display.paragraphs,
    price: `${explicit(preview.saleUnit.consumerPrice)} ${explicit(preview.market.currency)}`,
    pack: `${explicit(preview.saleUnit.unitsPerPack)} ${explicit(preview.saleUnit.unit)} / 包`,
    market: explicit(preview.market.countryCode), sku: preview.variants.map(value => explicit(value.sku)).join('、'),
    fulfillment: `处理及发货 ${explicit(preview.fulfillment.handlingDays)} 天 · 运输 ${explicit(preview.fulfillment.shippingDays)} 天`,
    missing: preview.missingFields.map(field => supplierFieldLabels[field] || field),
    images: preview.images.map((image,index) => ({ ...image, key: String(index), label: image.kind === 'artifact' ? `原图片 v${image.asset.version} · SHA256 ${image.asset.sha256}` : image.url,
      status: image.availability === 'available' ? '原服务已核验可用性；对外传输仍需明确审阅' : '图片可用性尚未核验' })),
    status: '服务端商品预览 · 尚未创建或发布到 Shopify',
  };
}
