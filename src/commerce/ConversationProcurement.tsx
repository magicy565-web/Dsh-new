import { useState } from 'react';
import { Modal } from '../Modal';
import { Notice, stamp, useDirty, useRead } from '../library/common';
import { useSupplyCommand } from './useSupplyCommand';
import type { Message } from '../types';

type Inquiry = { id: string; revision: number; quantity: number; destination: string; notes: string; status: string;
  share: null | { status: string; reviewHash: string; snapshot: { recipient: { displayName: string }; listingId: string; listingRevision: number; productRef: { productId: string; revision: number; skuId: string; skuCode: string } } };
  merchantConversation?: { conversationId: string }; replies: { id: string; content: string; createdAt: string; bindingQuote: false }[] };
export function ProcurementMessage({ message }: { message: Message }) {
  let data: { kind?: unknown; inquiryId?: unknown; content?: unknown };
  try { data = JSON.parse(message.content); } catch { return <p>采购引用记录，请展开本会话采购需求核对。</p>; }
  if (!data || !['procurement_shared', 'merchant_reply'].includes(String(data.kind)) || data.inquiryId !== message.supplyInquiryId) return <p>采购引用记录待核对，请展开本会话采购需求。</p>;
  return <><p>{data.kind === 'merchant_reply' ? '已提交原采购需求的商家回复。' : '采购需求已关联到本会话。'}</p>{data.kind === 'merchant_reply' && typeof data.content === 'string' && <p>{data.content}</p>}<p className="control-input-note">展开本会话采购需求查看当前共享状态与回复；此记录不会自动派发 Muse。</p></>;
}
export function ConversationProcurement({ conversationId, scope, revision, readOnly, onDirty, onUpdated }: { conversationId: string; scope: string; revision: number; readOnly: boolean; onDirty: (value: boolean) => void; onUpdated: () => void }) {
  const current = useRead<{ inquiries: Inquiry[] }>(`/conversations/${encodeURIComponent(conversationId)}/procurement`, revision);
  const inbox = useRead<{ inquiries: Inquiry[] }>('/supply/inquiries', revision);
  const writer = useSupplyCommand('conversation-procurement:' + scope);
  const [selection, setSelection] = useState<{ kind: 'bind' | 'reply'; inquiry: Inquiry } | null>(null), [content, setContent] = useState(''), [confirmed, setConfirmed] = useState(false);
  const unavailable = current.loading || inbox.loading || !!current.error || !!inbox.error;
  const blocked = readOnly || unavailable || writer.busy || writer.uncertain;
  useDirty(!!selection || writer.busy || writer.uncertain, onDirty);
  const associated = current.value?.inquiries || [], unbound = (inbox.value?.inquiries || []).filter(item => item.share?.status === 'active' && !item.merchantConversation);
  function reload() { current.retry(); inbox.retry(); onUpdated(); }
  function committed() { setSelection(null); setContent(''); setConfirmed(false); reload(); }
  function open(kind: 'bind' | 'reply', inquiry: Inquiry) { setSelection({ kind, inquiry }); setContent(''); setConfirmed(false); writer.clearError(); }
  async function save() {
    if (blocked || !selection || !confirmed) return;
    const { inquiry, kind } = selection;
    const result = await writer.write(kind === 'bind' ? 'inquiry.bind' : 'inquiry.reply', kind === 'bind' ? '关联本会话采购需求' : '提交原采购需求回复', `/supply/inquiries/${encodeURIComponent(inquiry.id)}/${kind === 'bind' ? 'conversation' : 'reply'}`, 'POST', { expectedRevision: inquiry.revision, confirmed: true, ...(kind === 'bind' ? { conversationId } : { content, expectedShareHash: inquiry.share!.reviewHash }) });
    if (result) committed();
  }
  async function retry() { if (readOnly || writer.busy) return; if (await writer.retry()) committed(); }
  const feedback = <><Notice error={writer.error}/>{writer.uncertain && <p role="alert">原请求结果待核对。<button type="button" disabled={readOnly || writer.busy} onClick={() => void retry()}>核对原采购操作</button></p>}{writer.storageError && <p role="alert">待核对请求无法在浏览器保存，请留在本页完成核对。</p>}</>;
  if (!unavailable && !associated.length && !unbound.length && !selection && !writer.pending) return null;
  return <section className="conversation-procurement" aria-label="本会话采购需求"><details className="conversation-task-list"><summary>采购需求 · {associated.length}{unbound.length ? ` · ${unbound.length} 项待关联` : ''}</summary>
    <Notice error={current.error} retry={reload}/><Notice error={inbox.error} retry={reload}/>{unavailable && !current.error && !inbox.error && <p role="status">读取原采购需求…</p>}
    {[...associated, ...unbound].map(inquiry => <details className="conversation-run" key={inquiry.id} data-inquiry-id={inquiry.id}><summary>{inquiry.share?.snapshot.recipient.displayName || '指定商家'} · 数量 {inquiry.quantity} · {inquiry.destination}</summary><div className="conversation-order-body">
      <p>{inquiry.notes}</p><p>共享状态：{inquiry.share?.status === 'active' ? '采购方已确认原范围' : '共享已撤销或不可访问'}</p>
      {inquiry.share && <p>原 SKU {inquiry.share.snapshot.productRef.skuCode} · 企业产品修订 {inquiry.share.snapshot.productRef.revision} · 供货修订 {inquiry.share.snapshot.listingRevision}</p>}
      {inquiry.replies.map(reply => <article key={reply.id}><p>{reply.content}</p><small>{stamp(reply.createdAt)} · 商家回复，非约束性采购订单或付款证明</small></article>)}
      {!inquiry.merchantConversation ? <button className="secondary-button" disabled={blocked || inquiry.share?.status !== 'active'} onClick={() => open('bind', inquiry)}>关联到本会话</button> : <button className="secondary-button" disabled={blocked || inquiry.share?.status !== 'active'} onClick={() => open('reply', inquiry)}>回复原采购方</button>}
    </div></details>)}
  </details>{feedback}
  {selection && <Modal title={selection.kind === 'bind' ? '关联原采购需求' : '回复原采购方'} className="note-modal" onClose={() => { if (!writer.busy && !writer.uncertain) setSelection(null); }}><h2>{selection.kind === 'bind' ? '关联原采购需求' : '回复原采购方'}</h2><p>数量 {selection.inquiry.quantity} · {selection.inquiry.destination} · 原需求修订 {selection.inquiry.revision}</p><p>{selection.inquiry.notes}</p><form onSubmit={event => { event.preventDefault(); void save(); }}>
    {selection.kind === 'reply' && <label className="field-label">给原采购方的回复<textarea required maxLength={2400} rows={5} disabled={blocked} value={content} onChange={event => { setContent(event.target.value); setConfirmed(false); }}/></label>}
    <label className="commerce-confirm"><input type="checkbox" checked={confirmed} disabled={blocked} onChange={event => setConfirmed(event.target.checked)}/>{selection.kind === 'bind' ? '确认将已共享的需求关联到此原会话，不执行或转发给 Muse。' : '确认向此原需求的采购方提交以上回复，不代表采购订单、付款或额外执行授权。'}</label>{feedback}<div className="modal-actions"><button className="primary-button" disabled={blocked || !confirmed}>{selection.kind === 'bind' ? '确认关联本会话' : '确认提交原回复'}</button></div>
  </form></Modal>}</section>;
}
