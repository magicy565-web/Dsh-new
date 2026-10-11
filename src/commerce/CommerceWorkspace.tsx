import { useState } from 'react';
import { Icon } from '../icons';
import { Field, Notice, pid, stamp, useDirty, useRead, useWrite, WriteNotice } from '../library/common';
import type { Product, ListResult } from '../library/types';
import type { CommerceProject, CommerceStatus } from './types';
import SupplyNetworkPanel from './SupplyNetworkPanel';
import './commerce.css';

type Props = { id?: string; readOnly: boolean; isAdmin: boolean; onNavigate: (id?: string) => void; onLibrary: () => void; onGoal: (id: string) => void; onOrder: (id: string) => void; onDirty: (dirty: boolean) => void; onRefresh: () => Promise<void> };
const stateLabel = (status: string) => ({ draft: '等待研究', research_preparing: '研究目标准备中', research_staged: '研究目标已创建' } as Record<string, string>)[status] || status;
export default function CommerceWorkspace(props: Props) {
  const status = useRead<CommerceStatus>('/commerce-status');
  return <div className="commerce-workspace">
    <header className="commerce-heading"><h1>产品与供货资料</h1><p>可在业务对话中使用的企业资源。</p></header>
    {props.id && <ConnectionCard status={status} isAdmin={props.isAdmin}/>}
    {props.id === 'new' ? <ProjectForm {...props}/> : props.id ? <ProjectDetail {...props} id={props.id} connection={status.value?.shopify}/> : <SupplyNetworkPanel readOnly={props.readOnly} isAdmin={props.isAdmin} shopify={status.value?.shopify} onDirty={props.onDirty}/>}
  </div>;
}
function ConnectionCard({ status, isAdmin }: { status: ReturnType<typeof useRead<CommerceStatus>>; isAdmin: boolean }) {
  const writer = useWrite(), shop = status.value?.shopify;
  async function verify() { if (await writer.write('/commerce-shopify/verify', 'POST', {})) status.retry(); }
  return <section className="commerce-connections" aria-label="执行与店铺连接">
    <Notice error={status.error} retry={status.retry}/>
    <div className="commerce-connection"><Icon name="bolt" size={19}/><span><strong>Agent Runtime</strong><small>{status.loading ? '读取连接状态…' : status.error ? '状态未确认' : status.value?.harness.native && status.value.harness.configured ? 'Harness 已配置 · 在线运行待验证' : '原生 Harness 待配置'}</small></span></div>
    <div className="commerce-connection"><Icon name="fingerprint" size={19}/><span><strong>Muse Personal</strong><small>{status.loading ? '读取连接状态…' : status.error ? '状态未确认' : !status.value?.muse.installed ? '等待连接个人 Muse' : status.value.muse.approved ? '执行范围已配置 · 等待实际任务验证' : '接口已配置 · 等待执行范围审核'}</small></span></div>
    {status.value?.muse.lastSeenAt && <p className="commerce-caption">最近接口访问：{stamp(status.value.muse.lastSeenAt)} · 任务领取和交付请查看任务单。</p>}
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
    {products.loading ? <p role="status">读取产品库…</p> : !products.error && !options.length ? <div className="commerce-empty"><h3>先保存企业自有产品</h3><p>公开参考样本不能作为本企业库存或供货承诺。</p><button type="button" className="secondary-button" onClick={() => onLibrary()}>打开产品库</button></div> : <form className="commerce-form" onSubmit={event => { event.preventDefault(); void save(); }}>
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
function ProjectDetail({ id, readOnly, isAdmin, onNavigate, onGoal, onOrder, onRefresh, onDirty, connection }: Props & { id: string; connection?: CommerceStatus['shopify'] }) {
  const read = useRead<{ project: CommerceProject }>(`/commerce-projects/${pid(id)}`), stageWriter = useWrite(), orderWriter = useWrite(), project = read.value?.project;
  const [researchDirty, setResearchDirty] = useState(false);
  useDirty(researchDirty || stageWriter.busy || stageWriter.uncertain || orderWriter.busy || orderWriter.uncertain, onDirty);
  const [confirmOrders, setConfirmOrders] = useState(false);
  async function stage() { if (researchDirty || orderWriter.busy || orderWriter.uncertain) return; const result = await stageWriter.write<{ project: CommerceProject }>(`/commerce-projects/${pid(id)}/stage-research`, 'POST', { confirmed: true }); if (result) { read.retry(); await onRefresh(); if (result.project.researchGoalId) onGoal(result.project.researchGoalId); } }
  async function sync() { if (researchDirty || stageWriter.busy || stageWriter.uncertain) return; if (await orderWriter.write(`/commerce-projects/${pid(id)}/sync-orders`, 'POST', { confirmed: confirmOrders })) read.retry(); }
  return <section><button type="button" className="bl-back" onClick={() => onNavigate()}><Icon name="back" size={18}/>托管任务</button><Notice error={read.error} retry={read.retry}/>{read.loading ? <p role="status">读取托管范围…</p> : project && <>
    <div className="commerce-detail-header"><span className="commerce-product-symbol"><Icon name="box" size={26}/></span><div><h2>{project.productName}</h2><p>{project.market} · 产品修订 {project.productRevision}</p></div></div>
    <p className="commerce-objective">{project.objective}</p><div className="commerce-facts"><div><small>经营预算计划</small><strong>{project.budget.amount} {project.budget.currency}</strong></div><div><small>验证期</small><strong>{project.durationDays} 天</strong></div><div><small>目标</small><strong>{project.validationOrderTarget} 笔有效订单</strong></div></div>
    <div className="commerce-section-heading"><h3>研究与运营准备</h3><span className="commerce-caption">{stateLabel(project.status)}</span></div><p className="commerce-caption">创建目标由原生 Harness 研究，或准备任务单交给已审核的 Muse 与云端 Worker。</p>
    {project.researchGoalId ? <button type="button" className="primary-button" onClick={() => onGoal(project.researchGoalId!)}>查看研究目标<Icon name="arrow-right" size={17}/></button> : <button type="button" className="primary-button" disabled={readOnly || researchDirty || stageWriter.busy || orderWriter.busy || orderWriter.uncertain} onClick={() => void stage()}>{stageWriter.busy ? '准备中…' : stageWriter.uncertain ? '重试原请求' : '创建研究目标'}<Icon name="arrow-right" size={17}/></button>}
    <ResearchOrder project={project} readOnly={readOnly || stageWriter.busy || stageWriter.uncertain || orderWriter.busy || orderWriter.uncertain} onOrder={onOrder} onDirty={setResearchDirty} onSaved={read.retry}/>
    <section className="commerce-results" aria-label="经营结果"><h3>经营结果</h3>{!project.results.observedAt ? <p>尚未读取实际订单。连接店铺后，按托管任务标签读取并核验。</p> : <><div className="commerce-facts"><div><small>观察到的订单</small><strong>{project.results.observedOrders}</strong></div><div><small>非测试 · 已收款履约</small><strong>{project.results.paidFulfilledOrders}</strong></div></div><p className="commerce-caption">{project.results.complete ? '本轮标签订单已读完' : '分页读取未完成，金额汇总为部分结果'} · {stamp(project.results.observedAt)}</p>{project.results.netReceipts.map(receipt => <p key={receipt.currency}>标签订单净收款：{receipt.amount} {receipt.currency}</p>)}</>}
      <p className="commerce-caption">这份记录是店铺订单证据，归因待审核。退款窗口、经营成本和服务费条款确认后再结算。</p>
      <details><summary>订单识别方式</summary><p className="commerce-caption">Shopify 中归属于本次验证的订单应标记：</p><code className="commerce-tag">workspace-project-{project.id}</code><p className="commerce-caption">标签属于店铺记录，仍需审核订单来源和任务归因。</p></details>
      <label className="commerce-confirm"><input type="checkbox" checked={confirmOrders} onChange={event => setConfirmOrders(event.target.checked)} disabled={!isAdmin || researchDirty || stageWriter.busy || stageWriter.uncertain || orderWriter.busy || orderWriter.uncertain}/><span>读取已授权店铺中本次任务的订单</span></label><button type="button" className="secondary-button" disabled={!isAdmin || researchDirty || !connection?.orderReadAvailable || !confirmOrders || stageWriter.busy || stageWriter.uncertain || orderWriter.busy} onClick={() => void sync()}>{orderWriter.busy ? '读取中…' : orderWriter.uncertain ? '重试原读取' : project.orderEvidence?.complete === false ? '读取下一页订单' : '刷新订单证据'}</button>
      {project.orderEvidence?.orders.length ? <div className="commerce-orders">{project.orderEvidence.orders.map(order => <div key={order.id}><strong>{order.name}{order.test ? ' · 测试单' : ''}</strong><small>{order.salesEvidence ? '已收款并履约 · 待归因' : order.cancelledAt ? '已取消 · 不计入验证' : '尚不满足有效销售条件'}</small><span>{order.netReceived} {order.currency} 净收款</span></div>)}</div> : null}
    </section><WriteNotice writer={stageWriter}/><WriteNotice writer={orderWriter}/>
  </>}</section>;
}

const orderLabels: Record<string, string> = { draft: '等待审核与分配', approved: '已授权 · 待派发', dispatching: '正在提交', queued: '等待 Worker 领取',
  running: '执行中', input_required: '等待补充信息', dispatch_uncertain: '提交结果待核对', cancel_requested: '等待停止确认', cancelled: '已取消',
  review_required: '已交付 · 等待验收', accepted: '已验收', failed: '执行失败', result_incomplete: '交付不完整', budget_dispute: '额度待核对' };
function ResearchOrder({ project, readOnly, onOrder, onDirty, onSaved }: { project: CommerceProject; readOnly: boolean; onOrder: Props['onOrder']; onDirty: Props['onDirty']; onSaved: () => void }) {
  const [editing, setEditing] = useState(false), [service, setService] = useState('buyer-discovery'), [budget, setBudget] = useState('5');
  const [brief, setBrief] = useState(`${project.publicDescription}\n研究目标：${project.objective}`), [confirmed, setConfirmed] = useState(false);
  const [deadline, setDeadline] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const writer = useWrite(), order = project.researchOrder;
  useDirty(editing || writer.busy || writer.uncertain, onDirty);
  async function save() {
    const result = await writer.write<{ project: CommerceProject }>(`/commerce-projects/${pid(project.id)}/stage-worker-research`, 'POST', {
      confirmed, serviceId: service, brief, budgetCredits: Number(budget), deadlineAt: new Date(`${deadline}T18:00:00`).toISOString(),
    });
    if (result) { setEditing(false); onDirty(false); onSaved(); }
  }
  return <section className="commerce-research-order" aria-label="研究委托">
    <h3>海外研究委托</h3>{order ? <>
      <p><strong>{order.serviceTitle}</strong><span className="commerce-order-status">{orderLabels[order.status] || '状态待核对'}</span></p>
      <p className="commerce-caption">{order.workerId ? `执行者：${order.workerId}` : '尚未分配执行者'} · 额度上限 {order.budgetCredits} credits · 截止 {stamp(order.deadlineAt)}</p>
      {order.deliverableCount > 0 && <p className="commerce-caption">已返回 {order.deliverableCount} 份成果、{order.evidenceCount} 条来源、{order.prospectCount} 个候选客户。外部信息仍需核验。</p>}
      {order.acceptedAt && <p className="commerce-caption">验收于 {stamp(order.acceptedAt)} · 研究成果与销售订单分别审核。</p>}
      <button type="button" className="secondary-button" onClick={() => onOrder(order.id)}>查看与审核任务单<Icon name="arrow-right" size={16}/></button>
    </> : editing ? <form className="commerce-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={readOnly || writer.busy || writer.uncertain}>
        <Field label="研究内容"><select aria-label="研究内容" value={service} onChange={event => setService(event.target.value)}><option value="buyer-discovery">海外经销商开发</option><option value="channel-validation">海外销售渠道验证</option></select></Field>
        <Field label="可公开共享的委托说明"><textarea aria-label="可公开共享的委托说明" required maxLength={2000} rows={5} value={brief} onChange={event => setBrief(event.target.value)}/></Field>
        <p className="commerce-caption">只共享产品名称、目标市场和以上说明。{brief.length}/2000 字{brief.length > 2000 ? '，请缩短说明后保存。' : '。'}</p>
        <div className="commerce-two-columns"><Field label="研究额度上限（credits）"><input required type="number" min={5} max={10000} value={budget} onChange={event => setBudget(event.target.value)}/></Field><Field label="交付截止日期"><input required type="date" value={deadline} onChange={event => setDeadline(event.target.value)}/></Field></div>
        <p className="commerce-caption">Credits 为 Worker 的独立授权额度，不与经营预算币种换算；保存后由管理员审核、选择执行者并派发。</p>
        <label className="commerce-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>我确认以上说明可以共享给外部研究 Worker。</span></label>
      </fieldset><WriteNotice writer={writer}/><div className="commerce-research-actions"><button type="button" className="secondary-button" disabled={writer.busy || writer.uncertain} onClick={() => setEditing(false)}>收起</button><button type="submit" className="primary-button" disabled={readOnly || !confirmed || brief.length > 2000 || writer.busy}>{writer.busy ? '准备中…' : writer.uncertain ? '重试原委托' : '保存研究任务单'}</button></div>
    </form> : <><p className="commerce-caption">确认公开说明、额度和截止时间，准备一份待审核的研究任务单。</p><button type="button" className="secondary-button" disabled={readOnly} onClick={() => setEditing(true)}>准备研究委托</button></>}
  </section>;
}
