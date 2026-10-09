import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, requestId } from './api';
import { Icon } from './icons';
import type { IconName } from './icons';

type Worker = { id: string; name: string; budgetEnforced: boolean };
type Service = {
  id: string; title: string; category: string; description: string; deliverables: string[];
  acceptance: string[]; minimumCredits: number; dataMode: string; workers: Worker[];
  executable: boolean; limitation?: string | null;
};
type Evidence = { title: string; url: string | null; detail: string };
type Deliverable = { name: string; type: string; summary: string; sha256: string | null; url: string | null };
type Order = {
  id: string; serviceId: string; serviceTitle: string; product: string; market: string;
  objective: string; budgetCredits: number; deadlineAt: string; dataMode: 'public';
  status: string; workerId: string | null; remoteJobId: string | null;
  createdAt: string; updatedAt: string; error?: { code: string; message: string } | null;
  workerReport?: { deliverables: Deliverable[]; evidence: Evidence[]; independentlyVerified: false } | null;
  reportedCostCredits?: number | null;
};
type Role = 'admin' | 'operator' | 'viewer';
const icons: Record<string, IconName> = {
  'buyer-discovery': 'people', 'channel-validation': 'work',
  'sales-assets': 'file', 'rfq-recovery': 'activity',
};
const statuses: Record<string, string> = {
  draft: '待分配', approved: '已授权', dispatching: '正在提交',
  dispatch_uncertain: '提交待核验', running: '执行中', input_required: '等待补充信息',
  cancel_requested: '取消待确认', cancelled: '已取消', review_required: '等待验收',
  result_incomplete: '成果不完整', budget_dispute: '预算异常',
  accepted: '已验收', failed: '执行失败',
};
const dateText = (value: string) => new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
const sampleDate = () => { const date = new Date(); date.setDate(date.getDate() + 7); return date.toISOString().slice(0, 10); };
const errorText = (value: unknown) => value instanceof Error ? value.message : '操作未完成，请检查连接状态';
const liveStatuses = new Set(['running', 'dispatch_uncertain', 'cancel_requested', 'input_required']);
const serviceSteps = [
  { title: '明确工作成果', detail: '选择业务场景和验收标准', icon: 'work' as IconName },
  { title: '分配专业 Worker', detail: '只使用审核过的插件和执行者', icon: 'shield' as IconName },
  { title: '验证交付价值', detail: '来源证据、人工验收和费用记录', icon: 'check' as IconName },
];

export default function Workers({ role }: { role: Role }) {
  const [services, setServices] = useState<Service[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selection, setSelection] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [product, setProduct] = useState('');
  const [market, setMarket] = useState('美国');
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState('20');
  const [deadline, setDeadline] = useState(sampleDate);
  const [workerId, setWorkerId] = useState('');
  const [confirmedPublic, setConfirmedPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const retryId = useRef(requestId());
  const load = useCallback(async () => {
    const [catalog, tasks] = await Promise.all([
      api<{ services: Service[] }>('/worker-services'),
      api<{ orders: Order[] }>('/worker-orders'),
    ]);
    setServices(catalog.services); setOrders(tasks.orders); setLoaded(true);
  }, []);
  useEffect(() => {
    let mounted = true;
    void load().catch(error => { if (mounted) setNotice({ text: errorText(error), error: true }); });
    const timer = window.setInterval(() => void load().catch(() => {}), 15000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [load]);
  const availableWorkers = useMemo(() => new Set(services.flatMap(item => item.executable ? item.workers.map(worker => worker.id) : [])).size, [services]);
  const selectedService = services.find(item => item.id === selection);
  const selectedOrder = orders.find(item => item.id === focused);
  // Dialog keyboard dismissal and background scroll lock on mobile and desktop.
  useEffect(() => {
    if (!selection && !focused) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelection(null);
        setFocused(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selection, focused]);
  const summary = useMemo(() => ({
    working: orders.filter(order => ['running', 'input_required', 'cancel_requested'].includes(order.status)).length,
    review: orders.filter(order => ['review_required', 'result_incomplete'].includes(order.status)).length,
    accepted: orders.filter(order => order.status === 'accepted').length,
  }), [orders]);
  const resetDraft = () => {
    setSelection(null); setProduct(''); setMarket('美国'); setObjective(''); setBudget('20');
    setDeadline(sampleDate()); setWorkerId(''); setConfirmedPublic(false); retryId.current = requestId();
  };
  const open = (service: Service) => {
    if (service.dataMode !== 'public') return;
    resetDraft(); setFocused(null); setSelection(service.id);
    setBudget(String(Math.max(20, service.minimumCredits)));
    setWorkerId(service.workers[0]?.id || '');
    setNotice(null);
  };
  async function create(event: FormEvent) {
    event.preventDefault(); if (!selectedService || role === 'viewer' || busy) return;
    const deadlineAt = new Date(deadline + 'T18:00:00').toISOString();
    setBusy(true);
    try {
      const result = await api<{ order: Order }>('/worker-orders', 'POST', {
        serviceId: selectedService.id, product, market, objective,
        budgetCredits: Number(budget), deadlineAt, requestId: retryId.current,
        publicDataConfirmed: confirmedPublic, ...(workerId ? { workerId } : {}),
      });
      await load(); resetDraft(); setFocused(result.order.id);
      setNotice({ text: '任务单已保存。只有管理员明确批准后，才能调用外部 Worker。', error: false });
    } catch (error) { setNotice({ text: errorText(error), error: true }); }
    finally { setBusy(false); }
  }
  async function action(id: string, actionName: string, payload: object = {}) {
    if (busy) return;
    setBusy(true);
    try {
      await api('/worker-orders/' + id + '/' + actionName, 'POST', payload);
      await load();
      const actionLabels: Record<string, string> = {
        approve: '已锁定工作范围与预算，尚未执行外部任务',
        dispatch: '执行者已确认接单，正在等待真实进度',
        refresh: '已从 Worker 获取状态；结果仍需要人工验收',
        accept: '已人工验收本次交付',
        cancel: '已记录取消请求；运行中任务必须等待执行者确认',
      };
      setNotice({ text: actionLabels[actionName] || '操作已完成', error: false });
    } catch (error) { await load().catch(() => {}); setNotice({ text: errorText(error), error: true }); }
    finally { setBusy(false); }
  }

  return <div className="worker-desk">
    <div className="worker-topbar">
      <div className="worker-breadcrumb"><span>WORKSPACE</span><span className="worker-breadcrumb-divider">/</span><strong>AI Worker</strong></div>
      <div className="worker-topbar-actions">
        <span className={'worker-provider-chip' + (availableWorkers > 0 ? ' has-workers' : '')}><i />
          {!loaded ? '检查执行者连接…' : availableWorkers > 0 ? availableWorkers + ' 位可委托执行者' : '尚未接入执行者'}
        </span>
        <span className="worker-profile-dot" title="企业工作空间">W</span>
      </div>
    </div>
    <header className="worker-head">
      <div className="worker-headline"><div className="worker-kicker"><span className="worker-kicker-dot" /> BUSINESS OPERATIONS</div>
        <h1>让增长工作真正发生<span className="worker-head-period">.</span></h1>
        <p>像雇佣顾问一样委托专业 AI Worker。定义任务、控制成本、审阅交付，而不是花时间和机器人聊天。</p>
      </div>
      <div className="worker-head-signet" aria-hidden="true"><span className="worker-signet-orbit"><Icon name="work" size={35} /></span><span className="worker-signet-tick">✦</span></div>
    </header>

    <section className="worker-metrics" aria-label="工作概览">
      <div><span className="worker-metric-label">执行中的委托</span><strong>{summary.working}</strong><span className="worker-metric-foot">来自真实任务记录</span></div>
      <div><span className="worker-metric-label">等待验收</span><strong>{summary.review}</strong><span className="worker-metric-foot">需要审核成果与证据</span></div>
      <div><span className="worker-metric-label">已验收交付</span><strong>{summary.accepted}</strong><span className="worker-metric-foot">不包含草稿和模拟任务</span></div>
    </section>

    {notice && <div className={'worker-notice' + (notice.error ? ' is-error' : '')} role={notice.error ? 'alert' : 'status'}><Icon name={notice.error ? 'info' : 'check'} size={17}/><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)} aria-label="关闭提示"><Icon name="close" size={14}/></button></div>}

    <div className="worker-section-heading"><div><span className="worker-eyebrow">GROWTH SERVICES</span><h2>增长服务</h2><p>选择具体业务成果，平台负责匹配与监督执行者。</p></div><span className="worker-quiet-tag">{services.length} 项标准服务</span></div>
    <section className="worker-service-grid" aria-label="服务目录">
      {services.map((service, index) => <article className="worker-service-card" key={service.id}>
        <div className="worker-service-top"><span className={'worker-service-icon tone-' + index}><Icon name={icons[service.id] || 'work'} size={24}/></span>
          <span className="worker-service-category">{service.category}</span></div>
        <h3>{service.title}</h3><p>{service.description}</p>
        <div className="worker-service-outputs"><span>交付内容</span>{service.deliverables.slice(0, 2).map(item => <div key={item}><Icon name="check" size={13}/>{item}</div>)}</div>
        <div className="worker-service-bottom">
          <span className={'worker-availability' + (service.executable ? ' is-ready' : '')}><i/>{service.dataMode !== 'public' ? '需要私有数据通道' : service.executable ? service.workers.length + ' 位可用执行者' : '尚未连接执行者'}</span>
          <button disabled={service.dataMode !== 'public' || role === 'viewer'} onClick={() => open(service)}>{service.dataMode === 'public' ? '创建任务单' : '待开放'}<Icon name="chevron" size={16}/></button>
        </div>
      </article>)}
    </section>

    <div className="worker-section-heading order-head"><div><span className="worker-eyebrow">WORK ORDERS</span><h2>我的工作委托</h2><p>查看真实进度、执行回执和可验收成果。</p></div><button className="worker-reload" onClick={() => void load().catch(error => setNotice({ text: errorText(error), error: true }))}><Icon name="refresh" size={16}/>刷新</button></div>
    <section className="worker-orders" aria-label="任务单">
      {!loaded ? <div className="worker-empty"><span><Icon name="refresh" size={26}/></span><strong>正在加载任务记录</strong><p>从企业 Workspace API 读取实时状态。</p></div> : orders.length === 0 ? <div className="worker-empty"><span><Icon name="work" size={28}/></span><strong>还没有委托任务</strong><p>先选择一项增长服务，填写简短业务需求。</p></div> :
        [...orders].reverse().map(order => <button className={'worker-order-row' + (focused === order.id ? ' is-focused' : '')} key={order.id} onClick={() => { setFocused(order.id); setSelection(null); }}>
          <span className="worker-order-mark"><Icon name={icons[order.serviceId] || 'work'} size={20}/></span>
          <span className="worker-order-main"><strong>{order.serviceTitle}</strong><small>{order.product} · {order.market} · {dateText(order.updatedAt)}</small></span>
          <span className={'worker-state worker-state-' + order.status}>{statuses[order.status] || order.status}</span>
          <Icon name="chevron" size={17}/>
        </button>)}
    </section>

    <div className="worker-bottom-note"><Icon name="shield" size={17}/><p>企业私有资料不会自动发送给第三方。外部 Worker 必须经过后台登记、预算与权限核验；未接入时不得显示虚假的执行结果。</p></div>
    <div className="worker-how">{serviceSteps.map((step, index) => <div key={step.title}><span>{index + 1}</span><Icon name={step.icon} size={20}/><strong>{step.title}</strong><small>{step.detail}</small></div>)}</div>

    {selectedService && <div className="worker-drawer-backdrop" role="presentation" onClick={resetDraft}>
      <section className="worker-drawer" role="dialog" aria-modal="true" aria-labelledby="worker-form-title" onClick={event => event.stopPropagation()}>
        <header><span className="worker-eyebrow">NEW SERVICE ORDER</span><button type="button" onClick={resetDraft} aria-label="关闭"><Icon name="close" size={19}/></button></header>
        <div className="worker-drawer-title"><span className="worker-service-icon"><Icon name={icons[selectedService.id] || 'work'} size={22}/></span><h2 id="worker-form-title">{selectedService.title}</h2><p>生成一份可以授权与验收的工作任务单。</p></div>
        <form onSubmit={event => void create(event)} className="worker-form">
          <label>产品或服务<input autoFocus required maxLength={240} value={product} onChange={event => setProduct(event.target.value)} placeholder="例如：印花粘胶面料" /></label>
          <label>目标市场<input required maxLength={100} value={market} onChange={event => setMarket(event.target.value)} placeholder="国家或地区" /></label>
          <label>期望成果<textarea required maxLength={2500} rows={4} value={objective} onChange={event => setObjective(event.target.value)} placeholder="说明目标客户、数量、筛选要求或业务问题" /></label>
          <div className="worker-form-two"><label>任务预算上限 · Credits<input type="number" min={selectedService.minimumCredits} max={10000} step={1} required value={budget} onChange={event => setBudget(event.target.value)}/></label>
          <label>交付截止日期<input type="date" required value={deadline} onChange={event => setDeadline(event.target.value)}/></label></div>
          <label>指定执行者<select value={workerId} onChange={event => setWorkerId(event.target.value)}><option value="">暂不分配 · 保存草稿</option>{selectedService.workers.map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>
          <div className="worker-acceptance"><strong>交付验收标准</strong>{selectedService.acceptance.map(line => <div key={line}><Icon name="check" size={15}/>{line}</div>)}</div>
          <label className="worker-permission"><input type="checkbox" checked={confirmedPublic} onChange={event => setConfirmedPublic(event.target.checked)} required/><span>我确认上述产品、市场和目标信息可以在后续经审批后共享给第三方。不会自动授权私有文件、账号或对外联系。</span></label>
          <div className="worker-form-foot"><span>此处预算为内部任务 Credits，非支付报价；保存草稿不执行任务。</span><button type="submit" disabled={busy || !confirmedPublic}>{busy ? '正在保存' : '保存任务单'}<Icon name="arrow" size={16}/></button></div>
        </form>
      </section>
    </div>}

    {selectedOrder && <div className="worker-drawer-backdrop" role="presentation" onClick={() => setFocused(null)}>
      <section className="worker-drawer" role="dialog" aria-modal="true" aria-labelledby="worker-order-title" onClick={event => event.stopPropagation()}>
        <header><span className="worker-eyebrow">SERVICE DELIVERY</span><button type="button" onClick={() => setFocused(null)} aria-label="关闭"><Icon name="close" size={19}/></button></header>
        <div className="worker-drawer-title"><span className="worker-service-icon"><Icon name={icons[selectedOrder.serviceId] || 'work'} size={22}/></span>
          <h2 id="worker-order-title">{selectedOrder.serviceTitle}</h2><span className={'worker-state worker-state-' + selectedOrder.status}>{statuses[selectedOrder.status] || selectedOrder.status}</span></div>
        <div className="worker-order-detail">
          <div><small>产品 / 市场</small><strong>{selectedOrder.product} · {selectedOrder.market}</strong></div>
          <div><small>任务目标</small><p>{selectedOrder.objective}</p></div>
          <div className="worker-detail-split"><div><small>授权上限</small><strong>{selectedOrder.budgetCredits} Credits</strong></div><div><small>截止时间</small><strong>{dateText(selectedOrder.deadlineAt)}</strong></div></div>
          <div className="worker-detail-split"><div><small>执行者</small><strong>{selectedOrder.workerId || '待分配'}</strong></div><div><small>真实回执</small><strong>{selectedOrder.remoteJobId || '尚未提交'}</strong></div></div>
          {selectedOrder.error && <div className="worker-detail-warning"><Icon name="info" size={16}/>{selectedOrder.error.message}</div>}
          {selectedOrder.workerReport && <div className="worker-delivery"><h3>交付成果 <span>待人工核验</span></h3>
            {selectedOrder.workerReport.deliverables.map((item, index) => <div className="worker-result" key={index}><Icon name="file" size={18}/><div><strong>{item.name}</strong><p>{item.summary}</p>{item.url && <a href={item.url} target="_blank" rel="noopener noreferrer">打开原始交付 <Icon name="external" size={12}/></a>}</div></div>)}
            <h3>证据来源</h3>{selectedOrder.workerReport.evidence.map((item, index) => <div className="worker-evidence" key={index}><strong>{item.title}</strong><p>{item.detail}</p>{item.url && <a href={item.url} target="_blank" rel="noopener noreferrer">{item.url}</a>}</div>)}
            <small>执行者报告的数据并未经过平台独立验证。验收不等于线索一定转化为订单。</small></div>}
          <div className="worker-detail-actions">
            {selectedOrder.status === 'draft' && <>{role === 'admin' && services.find(s => s.id === selectedOrder.serviceId)?.workers.length ? <button type="button" className="worker-primary" disabled={busy} onClick={() => {
              const service = services.find(s => s.id === selectedOrder.serviceId);
              const selected = selectedOrder.workerId || service?.workers[0]?.id;
              if (selected) void action(selectedOrder.id, 'approve', { confirmed: true, workerId: selected });
            }}>批准预算与委托范围</button> : <span className="worker-disabled-action">等待管理员及已审核执行者接入</span>}</>}
            {selectedOrder.status === 'approved' && role === 'admin' && <button type="button" className="worker-primary" disabled={busy} onClick={() => void action(selectedOrder.id, 'dispatch')}>正式委托执行</button>}
            {liveStatuses.has(selectedOrder.status) && role === 'admin' && <button type="button" className="worker-primary" disabled={busy} onClick={() => void action(selectedOrder.id, 'refresh')}>查询 Worker 进度</button>}
            {selectedOrder.status === 'review_required' && role === 'admin' && <button type="button" className="worker-primary" disabled={busy} onClick={() => void action(selectedOrder.id, 'accept', { confirmed: true })}>验收并确认交付</button>}
            {['draft', 'approved', 'running', 'input_required', 'cancel_requested'].includes(selectedOrder.status) && role === 'admin' &&
              <button type="button" className="worker-secondary" disabled={busy} onClick={() => void action(selectedOrder.id, 'cancel')}>取消这次委托</button>}
          </div>
        </div>
      </section>
    </div>}
  </div>;
}
