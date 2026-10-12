import { supplierFieldLabels } from './supplier-view';
import type { SupplierProfile, SupplierPreview } from './supplier-view';
export type SupplierService = { id: string; serviceId: string; conversationId: string; revision: number; phase: string; profile: SupplierProfile; profileHash: string;
  missingFields: string[]; questions: { field: string; question: string }[]; suggestions: { field: string; value: unknown; confirmed: false }[]; runId: string | null; error: { code: string; message?: string } | null;
  preview: (SupplierPreview & { id: string; revision: number; profileHash: string; previewHash: string; contentHash: string; generatedAt: string }) | null;
  productReference: { productId: string; productRevision: number } | null; externalStatus: string;
  external: { shopId: string; productId: string; variantIds: string[]; productStatus: string; published: boolean; publishedAt: string | null; publicationTimeSource: string | null; status: string; observedAt: string } | null;
};
export type SupplierSample = { salesStatus: string; trafficStatus: string; sales: { grossUnits: number; cancelledUnits: number; refundedUnits: number; retainedUnits: number; revenue: null } | null;
  traffic: { sessions: number; sampledAt: string; coverage: { from: string; to: string }; complete: boolean; dataLagSeconds: number | null; source: string } | null;
  sampledAt: string; coverage: { from: string; to: string }; dataLagSeconds: number | null; completePagination?: boolean; errors: { code: string }[]; source?: string;
};
export type SupplierSummary = SupplierSample & { monitorId: string; startAt: string; endAt: string; revision: number; contentHash: string; corrected: boolean; provisional: boolean; notificationCount: number; messageId: string };
export type SupplierMonitor = { id: string; serviceId: string; conversationId: string; scopeHash: string; status: string; scheduleEnabled: boolean; externalNotifications: string;
  scope: { productId: string; variantIds: string[]; startAt: string; endAt: string; startSource: string; shopId: string | null }; goalId: string | null; scheduleId: string | null;
  latestSample: SupplierSample | null; summary: SupplierSummary | null; stoppedAt: string | null };
export function validSupplier(value: SupplierService, cid: string) {
  return value && value.id === value.serviceId && value.conversationId === cid && Number.isInteger(value.revision) && value.revision > 0 && /^[a-f0-9]{64}$/.test(value.profileHash) && value.profile && Array.isArray(value.profile.images) &&
    ['pending','needs_information','preview_ready','blocked','failed','interrupted','cancelled','rejected'].includes(value.phase) && Array.isArray(value.questions) && value.questions.every(item => typeof item.field === 'string' && typeof item.question === 'string') && Array.isArray(value.suggestions) &&
    (!value.preview || value.preview.revision <= value.revision && value.preview.profileHash === value.profileHash && /^[a-f0-9]{64}$/.test(value.preview.previewHash) && value.preview.contentHash === value.preview.previewHash && value.preview.externalStatus === 'preview' && value.preview.published === false);
}
const show = (value: unknown) => value === null || value === undefined ? '未知' : String(value);
export const supplierErrorText = (code: string) => ({ SHOPIFY_SETUP_REQUIRED: 'Shopify 尚未配置；没有创建或发布商品', SHOPIFY_PRODUCT_WRITE_NOT_AUTHORIZED: 'Shopify 商品写入尚未授权；没有创建或发布', SUPPLIER_SAVE_PENDING: '原产品保存回执待服务端核对；没有另建产品', SUPPLIER_REVISION_CONFLICT: '原商品修订已改变，请重新读取后审阅', SUPPLIER_MONITOR_START_REQUIRED: '需要明确的 UTC 开始时间', SUPPLIER_PUBLICATION_TIME_REQUIRED: '没有可用的已核验在线商店发布时间', SUPPLIER_IMAGE_UNAVAILABLE: '原图片版本或 SHA 无法核对' } as Record<string,string>)[code] || code;
export function presentSupplier(value: SupplierService) {
  const p = value.profile;
  return { id: value.id, revision: value.revision, phase: value.phase, title: p.name || '正在整理商品事实', preview: value.preview,
    detail: `销售国家 ${show(p.targetMarket)} · 消费售价 ${show(p.consumerPrice)} ${show(p.currency)}\n零售 ${show(p.unitsPerPack)} ${show(p.retailUnit)} / 包\n内部供货：MOQ ${show(p.supplierMoq)} ${show(p.supplierUnit)} · 批发 ${show(p.wholesaleUnitPrice)} ${show(p.wholesaleCurrency)} · 生产 ${show(p.productionDays)} 天`,
    questions: value.questions.slice(0,3).map(item => item.question.replace(item.field,supplierFieldLabels[item.field] || item.field)), extraQuestions: Math.max(0,value.questions.length-3),
    suggestions: value.suggestions.map(item => `${supplierFieldLabels[item.field] || item.field}：${show(item.value)}（未确认建议）`),
    status: ({ pending:'Pi 正在保存商品事实', needs_information:'商品事实已保存，等待必要信息或预览范围', preview_ready:'原服务预览已就绪', blocked:'原服务阻挡', failed:'原整理未完成', interrupted:'原整理中断', cancelled:'原整理已取消', rejected:'原服务已拒绝' } as Record<string,string>)[value.phase],
    external: value.external?.published === true && value.externalStatus === 'published' ? `已观察到实际发布 · ${value.external.productId}` : value.externalStatus === 'shopify_draft' ? `已观察到 Shopify 草稿 · ${value.external?.productId}` : value.externalStatus === 'unpublished' ? `实际商品尚未发布（${value.external?.productStatus || '状态未知'}）` : '尚未创建或发布到 Shopify',
    product: value.productReference ? `原资料库产品 ${value.productReference.productId} · 修订 ${value.productReference.productRevision}` : '', editable: !['pending','cancelled','rejected'].includes(value.phase), error: value.error?.message || (value.error ? supplierErrorText(value.error.code) : '') };
}
export function sampleText(sample: SupplierSample | null) {
  if (!sample) return '尚未读取销量与产品流量；缺数不能当作零。';
  return `${sample.salesStatus === 'available' && sample.sales ? `保留销量 ${show(sample.sales.retainedUnits)}；原下单 ${show(sample.sales.grossUnits)}，取消 ${show(sample.sales.cancelledUnits)}，退款 ${show(sample.sales.refundedUnits)}（可重叠，不重复扣减）` : '销量不可用，未按零处理'}\n${sample.traffic && ['available','partial'].includes(sample.trafficStatus) ? `产品流量 ${show(sample.traffic.sessions)} · ${sample.trafficStatus === 'partial' ? '覆盖不完整' : '原来源可用'}` : `产品流量 ${sample.trafficStatus === 'unsupported' ? '当前来源不支持产品归因' : '不可用'}`}\n采样 ${sample.sampledAt}\n覆盖 ${sample.coverage.from} 至 ${sample.coverage.to}\n延迟 ${sample.dataLagSeconds === null ? '未知' : sample.dataLagSeconds + ' 秒'} · 分页 ${sample.completePagination === undefined ? '总结未提供，见原采样' : sample.completePagination ? '完整' : '不完整'}\n数据源 ${sample.source || '总结未提供，见原采样'}\n${sample.errors.map(item=>supplierErrorText(item.code)).join('；')}`;
}
export function presentMonitor(value: SupplierMonitor) {
  return { ...value, detail: `${value.scope.productId}\n变体 ${value.scope.variantIds.length ? value.scope.variantIds.join('、') : '产品全部变体（原范围）'}\n开始依据 ${value.scope.startSource === 'verified_online_store_publication' ? '已核验在线商店发布时间' : '用户明确 UTC 时间'}\n${value.scope.startAt} 至 ${value.scope.endAt}\n${value.scheduleEnabled ? '原 Schedule 已启用，以服务端执行记录为准' : '配置尚未启用，需要原 Schedule 明确审批'}\n${value.stoppedAt ? '已停止原监测' : '状态 ' + value.status}\n${sampleText(value.latestSample)}\n外部通知${value.externalNotifications === 'not_configured' ? '未配置' : '待核对'}`,
    summaryText: value.summary ? `原会话总结已保存 · 修订 ${value.summary.revision}${value.summary.corrected ? ' · 已更正同一消息' : ''}${value.summary.provisional ? ' · 数据未齐，等待原来源更正' : ''}\n外部通知未配置；后续更正复用原消息。` : '' };
}
