import { useState } from 'react';
import { Icon } from '../icons';
import { Field, Notice, pid, stamp, useDirty, useRead, useWrite, WriteNotice } from '../library/common';
import type { Product, ListResult } from '../library/types';
import type { CommerceProject, CommerceStatus } from './types';
import './commerce.css';

type Props = { id?: string; readOnly: boolean; isAdmin: boolean; onNavigate: (id?: string) => void; onLibrary: () => void; onGoal: (id: string) => void; onDirty: (dirty: boolean) => void; onRefresh: () => Promise<void> };
const stateLabel = (status: string) => ({ draft: '等待研究', research_preparing: '研究目标准备中', research_staged: '研究目标已创建' } as Record<string, string>)[status] || status;
export default function CommerceWorkspace(props: Props) {
  const status = useRead<CommerceStatus>('/commerce-status');
  return <div className="commerce-workspace">
    <header className="commerce-heading"><span className="eyebrow">让产品在海外得到真实验证</span><h1>产品托管</h1><p>从产品和供货资料出发，寻找分销机会，用订单验证市场。</p></header>
    <ConnectionCard status={status} isAdmin={props.isAdmin}/>
    {props.id === 'new' ? <ProjectForm {...props}/> : props.id ? <ProjectDetail {...props} id={props.id} connection={status.value?.shopify}/> : <ProjectList {...props}/>}
  </div>;
}
function ConnectionCard({ status, isAdmin }: { status: ReturnType<typeof useRead<CommerceStatus>>; isAdmin: boolean }) {
  const writer = useWrite(), shop = status.value?.shopify;
  async function verify() { if (await writer.write('/commerce-shopify/verify', 'POST', {})) status.retry(); }
  return <section className="commerce-connections" aria-label="执行与店铺连接">
    <Notice error={status.error} retry={status.retry}/>
    <div className="commerce-connection"><Icon name="bolt" size={19}/><span><strong>Agent Runtime</strong><small>{status.loading ? '读取连接状态…' : status.error ? '状态未确认' : status.value?.harness.native && status.value.harness.configured ? 'Harness 已配置 · 在线运行待验证' : '原生 Harness 待配置'}</small></span></div>
    <div className="commerce-connection"><Icon name="store" size={19}/><span><strong>Shopify</strong><small>{status.loading ? '读取连接状态…' : status.error ? '状态未确认' : shop?.status === 'verified' ? `${shop.shop?.name} · 已验证授权` : shop?.configured ? '已配置 · 等待验证授权' : '等待连接店铺'}</small></span>{shop?.configured && <button type="button" disabled={!isAdmin || writer.busy} onClick={() => void verify()}>{writer.busy ? '验证中…' : writer.uncertain ? '重试验证' : '验证授权'}</button>}</div>
    {shop?.verifiedAt && <p className="commerce-caption">授权验证于 {stamp(shop.verifiedAt)} · {shop.orderReadAvailable ? '允许读取订单' : '尚未授权订单读取'}</p>}
    {!status.loading && !status.error && !shop?.configured && <p className="commerce-caption">由管理员完成店铺授权后，可以读取真实订单和履约状态。</p>}
    <WriteNotice writer={writer}/>
    <details className="commerce-capability-details"><summary>运营与结算状态</summary><p>云电脑：{status.value?.cloudComputer.executionAvailable ? '可执行' : '等待接入'}</p><p>按经营结果付费：等待确认归因规则和费率，当前未启用自动扣费。</p></details>
  </section>;
}
function ProjectList({ readOnly, onNavigate }: Props) {
  const read = useRead<{ projects: CommerceProject[] }>('/commerce-projects');
  return <section><div className="commerce-section-heading"><h2>托管任务</h2><button type="button" className="primary-button" disabled={readOnly} onClick={() => onNavigate('new')}><Icon name="plus" size={16}/>托管产品</button></div><Notice error={read.error} retry={read.retry}/>
    {read.loading ? <p role="status">正在读取托管任务…</p> : read.value?.projects.length ? <div className="commerce-project-list">{[...read.value.projects].reverse().map(project => <button type="button" className="commerce-project-row" key={project.id} onClick={() => onNavigate(project.id)}><span className="commerce-product-symbol"><Icon name="box" size={23}/></span><span><strong>{project.productName}</strong><small>{project.market} · {stateLabel(project.status)}</small></span><Icon name="chevron" size={18}/></button>)}</div> : !read.error && <div className="commerce-empty"><Icon name="box" size={32}/><h3>让第一个产品走向海外</h3><p>选择已保存的产品，确认目标市场和验证预算。</p></div>}
  </section>;
}
function ProjectForm({ readOnly, onNavigate, onLibrary, onDirty }: Props) {
  const products = useRead<ListResult<Product>>('/library/products?status=draft&limit=100');
  const writer = useWrite();
  const [productId, setProductId] = useState(''), [description, setDescription] = useState(''), [market, setMarket] = useState(''), [objective, setObjective] = useState('');
  const [amount, setAmount] = useState(''), [currency, setCurrency] = useState('USD'), [days, setDays] = useState('30'), [target, setTarget] = useState('3'), [confirmed, setConfirmed] = useState(false);
  const options = products.value?.items.filter(product => product.source?.kind !== 'public_reference') || [], selected = options.find(product => product.id === productId);
  useDirty(!!productId || !!description || !!market || !!objective || !!amount || writer.busy || writer.uncertain, onDirty);
  async function save() {
    if (!selected || !confirmed || readOnly) return;
    const result = await writer.write<{ project: CommerceProject }>('/commerce-projects', 'POST', { productId: selected.id, productRevision: selected.revision,
      publicDescription: description, market, objective, budget: { amount, currency }, durationDays: Number(days), validationOrderTarget: Number(target), confirmed });
    if (result) { onDirty(false); onNavigate(result.project.id); }
  }
  return <section><button type="button" className="bl-back" onClick={() => onNavigate()}><Icon name="back" size={18}/>托管任务</button><h2>托管一个产品</h2><Notice error={products.error} retry={products.retry}/>
    {products.loading ? <p role="status">读取产品库…</p> : !products.error && !options.length ? <div className="commerce-empty"><h3>先保存企业自有产品</h3><p>公开参考样本不能作为本企业库存或供货承诺。</p><button type="button" className="secondary-button" onClick={onLibrary}>打开产品库</button></div> : <form className="commerce-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={readOnly || writer.busy || writer.uncertain}>
        <Field label="企业产品"><select required value={productId} onChange={event => { const product = options.find(item => item.id === event.target.value); setProductId(event.target.value); setDescription(product?.description || ''); setConfirmed(false); }}><option value="">选择已保存的产品</option>{options.map(product => <option key={product.id} value={product.id}>{product.name} · 修订 {product.revision}</option>)}</select></Field>
        <Field label="可以共享给 Agent 的产品介绍"><textarea required value={description} maxLength={8000} rows={4} onChange={event => { setDescription(event.target.value); setConfirmed(false); }}/></Field>
        <Field label="目标市场"><input required maxLength={100} value={market} placeholder="例如：美国" onChange={event => setMarket(event.target.value)}/></Field>
        <Field label="本次验证目标"><textarea required maxLength={2000} rows={3} value={objective} placeholder="例如：寻找合适的海外分销商，并验证首批订单" onChange={event => setObjective(event.target.value)}/></Field>
        <div className="commerce-two-columns"><Field label="经营预算上限"><input required type="number" min="0.01" max="99999999" step="0.01" value={amount} onChange={event => setAmount(event.target.value)}/></Field><Field label="币种"><select value={currency} onChange={event => setCurrency(event.target.value)}>{['USD','EUR','GBP','CNY'].map(item => <option key={item}>{item}</option>)}</select></Field></div>
        <div className="commerce-two-columns"><Field label="验证天数"><input required type="number" min={1} max={60} value={days} onChange={event => setDays(event.target.value)}/></Field><Field label="目标有效订单数"><input required type="number" min={1} max={1000} value={target} onChange={event => setTarget(event.target.value)}/></Field></div>
        <p className="commerce-caption">预算是本次经营计划。联系客户、上架、投放和履约支出均须另行授权。</p>
        <label className="commerce-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>我确认该产品属于本企业，以上介绍可以用于 Agent 研究；保存任务不会发布产品或支出。</span></label>
      </fieldset><WriteNotice writer={writer}/><button type="submit" className="primary-button full-width" disabled={readOnly || !selected || !confirmed || writer.busy}>{writer.busy ? '保存中…' : writer.uncertain ? '重试原保存请求' : '保存托管任务'}</button>
    </form>}
  </section>;
}
function ProjectDetail({ id, readOnly, isAdmin, onNavigate, onGoal, onRefresh, onDirty, connection }: Props & { id: string; connection?: CommerceStatus['shopify'] }) {
  const read = useRead<{ project: CommerceProject }>(`/commerce-projects/${pid(id)}`), stageWriter = useWrite(), orderWriter = useWrite(), project = read.value?.project;
  useDirty(stageWriter.busy || stageWriter.uncertain || orderWriter.busy || orderWriter.uncertain, onDirty);
  const [confirmOrders, setConfirmOrders] = useState(false);
  async function stage() { if (orderWriter.busy || orderWriter.uncertain) return; const result = await stageWriter.write<{ project: CommerceProject }>(`/commerce-projects/${pid(id)}/stage-research`, 'POST', { confirmed: true }); if (result) { read.retry(); await onRefresh(); if (result.project.researchGoalId) onGoal(result.project.researchGoalId); } }
  async function sync() { if (stageWriter.busy || stageWriter.uncertain) return; if (await orderWriter.write(`/commerce-projects/${pid(id)}/sync-orders`, 'POST', { confirmed: confirmOrders })) read.retry(); }
  return <section><button type="button" className="bl-back" onClick={() => onNavigate()}><Icon name="back" size={18}/>托管任务</button><Notice error={read.error} retry={read.retry}/>{read.loading ? <p role="status">读取托管范围…</p> : project && <>
    <div className="commerce-detail-header"><span className="commerce-product-symbol"><Icon name="box" size={26}/></span><div><h2>{project.productName}</h2><p>{project.market} · 产品修订 {project.productRevision}</p></div></div>
    <p className="commerce-objective">{project.objective}</p><div className="commerce-facts"><div><small>经营预算计划</small><strong>{project.budget.amount} {project.budget.currency}</strong></div><div><small>验证期</small><strong>{project.durationDays} 天</strong></div><div><small>目标</small><strong>{project.validationOrderTarget} 笔有效订单</strong></div></div>
    <div className="commerce-section-heading"><h3>研究与运营准备</h3><span className="commerce-caption">{stateLabel(project.status)}</span></div><p className="commerce-caption">创建研究目标后，可选择原生 Harness 启动，或使用云端专家的待审批任务单。</p>
    {project.researchGoalId ? <button type="button" className="primary-button" onClick={() => onGoal(project.researchGoalId!)}>查看研究目标<Icon name="arrow-right" size={17}/></button> : <button type="button" className="primary-button" disabled={readOnly || stageWriter.busy || orderWriter.busy || orderWriter.uncertain} onClick={() => void stage()}>{stageWriter.busy ? '准备中…' : stageWriter.uncertain ? '重试原请求' : '创建研究目标'}<Icon name="arrow-right" size={17}/></button>}
    <section className="commerce-results" aria-label="经营结果"><h3>经营结果</h3>{!project.results.observedAt ? <p>尚未读取实际订单。连接店铺后，按托管任务标签读取并核验。</p> : <><div className="commerce-facts"><div><small>观察到的订单</small><strong>{project.results.observedOrders}</strong></div><div><small>非测试 · 已收款履约</small><strong>{project.results.paidFulfilledOrders}</strong></div></div><p className="commerce-caption">{project.results.complete ? '本轮标签订单已读完' : '分页读取未完成，金额汇总为部分结果'} · {stamp(project.results.observedAt)}</p>{project.results.netReceipts.map(receipt => <p key={receipt.currency}>标签订单净收款：{receipt.amount} {receipt.currency}</p>)}</>}
      <p className="commerce-caption">这份记录是店铺订单证据，归因待审核。退款窗口、经营成本和服务费条款确认后再结算。</p>
      <details><summary>订单识别方式</summary><p className="commerce-caption">Shopify 中归属于本次验证的订单应标记：</p><code className="commerce-tag">workspace-project-{project.id}</code><p className="commerce-caption">标签属于店铺记录，仍需审核订单来源和任务归因。</p></details>
      <label className="commerce-confirm"><input type="checkbox" checked={confirmOrders} onChange={event => setConfirmOrders(event.target.checked)} disabled={!isAdmin || stageWriter.busy || stageWriter.uncertain || orderWriter.busy || orderWriter.uncertain}/><span>读取已授权店铺中本次任务的订单</span></label><button type="button" className="secondary-button" disabled={!isAdmin || !connection?.orderReadAvailable || !confirmOrders || stageWriter.busy || stageWriter.uncertain || orderWriter.busy} onClick={() => void sync()}>{orderWriter.busy ? '读取中…' : orderWriter.uncertain ? '重试原读取' : project.orderEvidence?.complete === false ? '读取下一页订单' : '刷新订单证据'}</button>
      {project.orderEvidence?.orders.length ? <div className="commerce-orders">{project.orderEvidence.orders.map(order => <div key={order.id}><strong>{order.name}{order.test ? ' · 测试单' : ''}</strong><small>{order.salesEvidence ? '已收款并履约 · 待归因' : order.cancelledAt ? '已取消 · 不计入验证' : '尚不满足有效销售条件'}</small><span>{order.netReceived} {order.currency} 净收款</span></div>)}</div> : null}
    </section><WriteNotice writer={stageWriter}/><WriteNotice writer={orderWriter}/>
  </>}</section>;
}
