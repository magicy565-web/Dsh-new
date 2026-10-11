import { useState } from 'react';
import { Modal } from '../Modal';
import { requestId } from '../api';
import { Field, Notice, stamp, useDirty, useRead } from '../library/common';
import { MuseFiles } from './MuseFiles';
import { cloudId, cloudSha } from './museControl';
import { useMuseConversationCommand } from './useMuseConversationCommand';

type Delegation = { provider: 'muse'; conversationId: string; orderId: string; requestId: string; reviewHash: string;
  review: { serviceId: string; product: string; market: string; objective: string; budgetCredits: number; deadlineAt: string };
  phase: string; orderStatus: string; taskRef: string | null; attemptId: string | null; fence: number; leaseUntil: string | null;
  receipt: null | { summary?: string; files: unknown[] }; receiptHash: string | null; returnedHash: string | null; acceptedAt: string | null;
  executionStartedAt: null; independentlyVerified: false; wake: { supported: boolean; observed: boolean } };
type Operation = 'approve' | 'dispatch' | 'cancel' | 'accept';
const labels: Record<string, string> = { review_required: '待确认范围', approved: '已批准，尚未派发', dispatching: '原派发结果待确认', reconciliation_required: '原任务待核对', queued: '待领取', deadline_expired: '截止时间已过', claimed: '已领取，模型启动未证实', lease_expired: '原租约已过期', cancel_requested: '等待原执行端确认停止', cancelled: '原任务已停止', failed: '执行失败', result_ready: '文件已记录，尚未送达原会话', result_returned: '已送达原会话，待人工验收', enterprise_accepted: '人工已验收此回执' };
const actionLabels = { approve: '批准此范围', dispatch: '派发此原订单', cancel: '请求停止原任务', accept: '人工验收此回执' };
const initial = { content: '', product: '', market: '', objective: '', serviceId: 'channel-validation', budget: '5', deadline: '' };
function valid(item: Delegation, conversationId: string) {
  return item?.provider === 'muse' && item.conversationId === conversationId && cloudId(item.orderId) && cloudId(item.requestId) && cloudSha(item.reviewHash) && !!item.review && typeof item.review.product === 'string' && typeof item.review.objective === 'string' && typeof item.review.budgetCredits === 'number' && typeof item.phase === 'string';
}

export function MuseConversation({ conversationId, scope, revision, readOnly, onDirty, onUpdated }: { conversationId: string; scope: string; revision: number; readOnly: boolean; onDirty: (value: boolean) => void; onUpdated: () => void }) {
  const prefix = `/conversations/${encodeURIComponent(conversationId)}/muse-delegations`;
  const read = useRead<{ delegations: Delegation[] }>(prefix, revision), writer = useMuseConversationCommand(scope, conversationId);
  const [form, setForm] = useState(initial), [prepareOpen, setPrepareOpen] = useState(false), [publicConfirmed, setPublicConfirmed] = useState(false);
  const [action, setAction] = useState<{ operation: Operation; item: Delegation } | null>(null), [confirmed, setConfirmed] = useState(false);
  const items = read.value?.delegations;
  const compatible = Array.isArray(items) && items.every(item => valid(item, conversationId));
  const blocked = readOnly || writer.busy || writer.uncertain || read.loading || !!read.error || !compatible;
  useDirty(writer.busy || writer.uncertain || prepareOpen && (publicConfirmed || JSON.stringify(form) !== JSON.stringify(initial)) || !!action, onDirty);
  function committed(operation: string) { if (operation === 'prepare') { setForm(initial); setPublicConfirmed(false); setPrepareOpen(false); } else { setAction(null); setConfirmed(false); } read.retry(); onUpdated(); }
  async function prepare() {
    if (blocked || !publicConfirmed || !form.deadline) return;
    const result = await writer.write({ operation: 'prepare', path: prefix, label: '准备原会话 Muse 委托', body: { provider: 'muse', conversationId, requestId: requestId(), content: form.content, order: { serviceId: form.serviceId, product: form.product, market: form.market, objective: form.objective, budgetCredits: Number(form.budget), deadlineAt: new Date(form.deadline).toISOString(), publicDataConfirmed: true } } });
    if (result) committed(result.operation);
  }
  function review(operation: Operation, item: Delegation) { setAction({ operation, item }); setConfirmed(false); writer.clearError(); }
  async function authorize() {
    if (blocked || !action || !confirmed) return;
    const { operation, item } = action;
    const result = await writer.write({ operation, path: `${prefix}/${encodeURIComponent(item.orderId)}/${operation}`, label: actionLabels[operation], body: { confirmed: true, expectedReviewHash: item.reviewHash, ...(operation === 'accept' ? { receiptHash: item.receiptHash } : {}) } });
    if (result) committed(result.operation);
  }
  async function refresh(item: Delegation) { if (blocked) return; const result = await writer.write({ operation: 'refresh', path: `${prefix}/${encodeURIComponent(item.orderId)}/refresh`, label: '核对原订单与任务', body: {} }); if (result) committed(result.operation); }
  async function retry() { if (readOnly || writer.busy) return; const result = await writer.retry(); if (result) committed(result.operation); }
  return <section className="conversation-native" aria-label="原会话 Muse 委托">
    <details className="conversation-task-list"><summary>原会话委托{compatible && items!.length ? ` · ${items!.length}` : ''}</summary>
      <Notice error={read.error} retry={read.retry}/>{read.loading && <p role="status">读取原会话任务…</p>}
      {!read.loading && !compatible && !read.error && <p role="alert">原会话任务格式不可核对，未启用委托操作。</p>}
      {read.error && <p>尚未读取到本会话的已审查原生绑定。未派发任务，也未切换到其他执行器。</p>}
      {compatible && items!.map(item => <details className="conversation-run" key={item.orderId} data-order-id={item.orderId}><summary>{item.review.product} · {labels[item.phase] || '状态待核对'}</summary>
        <div className="conversation-order-body"><p>{item.review.objective}</p><p>{labels[item.phase] || '状态待核对'}</p>
          <p>{item.review.market} · 上限 {item.review.budgetCredits} credits · 截止 {stamp(item.review.deadlineAt)}</p>
          <p className="control-input-note">领取不代表模型已启动。唤醒及当前账号执行尚未验收；外部成果未经独立核验。</p>
          {item.receipt && <><p>{item.receipt.summary}</p><MuseFiles files={item.receipt.files} authorized={!readOnly}/></>}
          <div className="modal-actions">
            {item.phase === 'review_required' && <button className="primary-button" disabled={blocked} onClick={() => review('approve', item)}>审阅并批准范围</button>}
            {item.phase === 'approved' && <button className="primary-button" disabled={blocked} onClick={() => review('dispatch', item)}>确认派发原订单</button>}
            {item.phase === 'result_returned' && item.receiptHash && item.returnedHash === item.receiptHash && <button className="primary-button" disabled={blocked} onClick={() => review('accept', item)}>审阅并人工验收</button>}
            {!['enterprise_accepted', 'cancelled', 'failed'].includes(item.phase) && <button className="secondary-button" disabled={blocked} onClick={() => void refresh(item)}>核对原任务状态</button>}
            {!['enterprise_accepted', 'cancelled', 'failed', 'cancel_requested'].includes(item.phase) && <button className="secondary-button" disabled={blocked} onClick={() => review('cancel', item)}>请求停止</button>}
          </div><details><summary>原订单与回执标识</summary><p>订单 {item.orderId}</p><p>请求 {item.requestId}</p><p>任务 {item.taskRef || '尚未派发'}</p><p>原尝试 {item.attemptId || '尚未领取'} · fence {item.fence}</p>{item.leaseUntil && <p>原租约至 {stamp(item.leaseUntil)}</p>}</details>
        </div></details>)}
      {compatible && <button className="secondary-button" disabled={blocked || items!.some(item => !['enterprise_accepted', 'cancelled', 'failed'].includes(item.phase))} onClick={() => { setPrepareOpen(true); setPublicConfirmed(false); }}>准备 Muse 委托</button>}
    </details>
    <Notice error={writer.error}/>{writer.uncertain && <p role="alert">原操作结果待核对：{writer.pending?.label}。<button type="button" disabled={readOnly || writer.busy} onClick={() => void retry()}>核对原操作结果</button></p>}
    {writer.storageError && <p role="alert">浏览器无法保存待核对操作，请在本页核对后再离开。</p>}
    {prepareOpen && <Modal title="准备原会话 Muse 委托" className="note-modal" onClose={() => { if (!writer.busy && !writer.uncertain) setPrepareOpen(false); }}><h2>准备原会话委托</h2><p className="control-input-note">产品与资料引用不会自动成为公开授权。仅填写本次可以公开的事实；此步只准备原订单。</p><form onSubmit={event => { event.preventDefault(); void prepare(); }}><fieldset disabled={blocked} className="conversation-public-scope">
      <Field label="公开请求正文"><textarea required maxLength={4000} rows={3} value={form.content} onChange={event => { setForm({ ...form, content: event.target.value }); setPublicConfirmed(false); }}/></Field>
      <Field label="公开产品说明"><input required maxLength={240} value={form.product} onChange={event => { setForm({ ...form, product: event.target.value }); setPublicConfirmed(false); }}/></Field>
      <Field label="市场"><input required maxLength={100} value={form.market} onChange={event => { setForm({ ...form, market: event.target.value }); setPublicConfirmed(false); }}/></Field>
      <Field label="范围与验收要求"><textarea required maxLength={2500} rows={3} value={form.objective} onChange={event => { setForm({ ...form, objective: event.target.value }); setPublicConfirmed(false); }}/></Field>
      <Field label="原服务"><select value={form.serviceId} onChange={event => { setForm({ ...form, serviceId: event.target.value }); setPublicConfirmed(false); }}><option value="channel-validation">渠道验证</option><option value="buyer-discovery">买家研究</option></select></Field>
      <Field label="额度上限（credits）"><input required type="number" min={5} max={10000} value={form.budget} onChange={event => { setForm({ ...form, budget: event.target.value }); setPublicConfirmed(false); }}/></Field>
      <Field label="明确截止时间"><input required type="datetime-local" value={form.deadline} onChange={event => { setForm({ ...form, deadline: event.target.value }); setPublicConfirmed(false); }}/></Field>
      <label className="commerce-confirm"><input type="checkbox" checked={publicConfirmed} onChange={event => setPublicConfirmed(event.target.checked)}/>确认以上仅为可公开资料，不授权外部联系、发布或额外付款。</label>
    </fieldset><Notice error={writer.error}/>{writer.uncertain && <button type="button" disabled={readOnly || writer.busy} onClick={() => void retry()}>核对原操作结果</button>}<button className="primary-button" disabled={blocked || !publicConfirmed}>准备待审原订单</button></form></Modal>}
    {action && <Modal title={actionLabels[action.operation]} className="note-modal" onClose={() => { if (!writer.busy && !writer.uncertain) setAction(null); }}><h2>{actionLabels[action.operation]}</h2><p>{action.item.review.product} · {action.item.review.market}</p><p>{action.item.review.objective}</p><p>上限 {action.item.review.budgetCredits} credits · 截止 {stamp(action.item.review.deadlineAt)}</p><p className="control-input-note">{action.operation === 'approve' ? '批准只保存原订单范围，不派发任务。' : action.operation === 'dispatch' ? '使用已经批准的同一原订单派发；派发不代表唤醒或模型执行。' : action.operation === 'accept' ? '验收同一原会话已持久收到的确切回执；外部结论仍未经独立核验。' : '请求停止同一原任务，等待执行端确认后才显示停止。'}</p><label className="commerce-confirm"><input type="checkbox" checked={confirmed} disabled={blocked} onChange={event => setConfirmed(event.target.checked)}/>我确认以上原范围与本次操作。</label><Notice error={writer.error}/>{writer.uncertain && <button type="button" disabled={readOnly || writer.busy} onClick={() => void retry()}>核对原操作结果</button>}<div className="modal-actions"><button className="primary-button" disabled={blocked || !confirmed} onClick={() => void authorize()}>{actionLabels[action.operation]}</button></div></Modal>}
  </section>;
}
