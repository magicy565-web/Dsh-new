/** Exact two-read/two-write merchant projection, matching the existing website.
 * Buyer identity, share consent, RFQ creation and model execution stay outside. */
export type Inquiry = { id: string; createdBy?: string; revision: number; quantity: number; destination: string; notes: string; status: string;
  share: null | { status: string; reviewHash: string; snapshot: { recipient: { displayName: string; merchantSubject?: string }; listingId: string; listingRevision: number; productRef: { productId: string; revision: number; skuId: string; skuCode: string } } };
  merchantConversation?: { conversationId: string }; replies: { id: string; content: string; createdAt: string; bindingQuote: false }[] };
export function inquiryValid(value: Inquiry) {
  return value && typeof value.id === 'string' && Number.isInteger(value.revision) && typeof value.quantity === 'number' && typeof value.destination === 'string' && typeof value.notes === 'string' && Array.isArray(value.replies) && value.share?.status === 'active' && /^[a-f0-9]{64}$/.test(value.share.reviewHash) && value.share.snapshot?.recipient && value.share.snapshot.productRef;
}
export function inquiryScope(value: Inquiry) {
  const share = value.share!;
  return `${share.snapshot.recipient.displayName} · 原采购需求 ${value.id}\n数量 ${value.quantity} · 目的地 ${value.destination}\n${value.notes}\n原 SKU ${share.snapshot.productRef.skuCode} · 企业产品修订 ${share.snapshot.productRef.revision} · 供货修订 ${share.snapshot.listingRevision}\n采购方已确认的共享范围 ${share.reviewHash}`;
}
export function procurementMessage(content: string, inquiryId: unknown) {
  try { const value = JSON.parse(content); if (value.inquiryId !== inquiryId) return content;
    if (value.kind === 'procurement_shared') return '采购需求已明确关联本会话。可按需展开当前范围与回复。';
    if (value.kind === 'merchant_reply' && typeof value.content === 'string') return `已提交给原采购方的回复：\n${value.content}\n（商家回复，不是采购订单或付款证明。）`;
  } catch { /* Preserve original truthful content. */ }
  return content;
}
