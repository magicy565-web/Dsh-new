import { Icon } from '../icons';
import { pid, stamp, useRead } from '../library/common';
import type { CommerceProject } from './types';
import './goal-commerce.css';

type LinkedProject = Pick<CommerceProject, 'id' | 'productId' | 'productRevision' | 'productName' | 'publicDescription' | 'market' | 'objective' | 'budget' | 'durationDays' | 'validationOrderTarget' | 'researchOrder' | 'results' | 'updatedAt'>;
type Context = { goalId: string; projects: LinkedProject[] };
const orderLabels: Record<string, string> = {
  draft: '等待审核与分配', approved: '已授权 · 待派发', dispatching: '正在提交', queued: '等待领取',
  running: '执行中', input_required: '等待补充信息', dispatch_uncertain: '提交结果待核对',
  cancel_requested: '等待停止确认', cancelled: '已取消', review_required: '交付待验收',
  accepted: '研究已验收', failed: '执行失败', result_incomplete: '交付不完整', budget_dispute: '额度待核对',
};

export function GoalCommerceContext({ goalId, revision, onProject, onOrder, onBrowse }: {
  goalId: string; revision: number; onProject: (id: string) => void; onOrder: (id: string) => void; onBrowse: () => void;
}) {
  const read = useRead<Context>(`/goals/${pid(goalId)}/commerce-context`, revision);
  // Do not render an older goal's scope even if a future caller reuses this component.
  const projects = read.value?.goalId === goalId ? read.value.projects : null;
  return <section id="ys22-commerce-context" className="ys22-commerce-context" aria-label="此目标的托管与渠道">
    <details id="ys22-commerce-details">
    <summary className="ys22-context-summary"><span><Icon name="box" size={18}/>托管与渠道</span><small>{read.loading ? '读取中' : read.error ? '读取失败，可重试' : projects?.length ? `${projects.length} 个关联托管任务` : '未关联托管'}</small><Icon name="chevron" size={16}/></summary>
    <div className="ys22-context-heading"><h2><Icon name="box" size={18}/>托管与渠道</h2><button type="button" onClick={read.retry} disabled={read.loading} aria-label="刷新目标托管信息"><Icon name="refresh" size={16}/></button></div>
    {read.loading ? <p role="status">正在读取关联的产品与托管范围…</p> : read.error ? <div role="alert"><p>暂时无法确认此目标的托管范围。</p><p className="ys22-context-caption">{read.error}</p><button type="button" onClick={read.retry}>重试读取托管范围</button></div> : projects?.length ? projects.map(project => <article className="ys22-context-project" key={project.id}>
      <div className="ys22-context-product"><strong>{project.productName}</strong><span>产品修订 {project.productRevision} · {project.market}</span></div>
      <p>{project.objective}</p>
      <dl className="ys22-context-facts"><div><dt>经营预算上限</dt><dd>{project.budget.amount} {project.budget.currency}</dd></div><div><dt>验证范围</dt><dd>{project.durationDays} 天 · 目标 {project.validationOrderTarget} 笔订单</dd></div></dl>
      <details className="ys22-context-scope"><summary>本次确认的产品说明</summary><p>{project.publicDescription}</p><small>使用托管时确认的产品修订；编辑产品库不会自动改变此范围。内部文件不自动共享。</small></details>
      {project.researchOrder ? <div className="ys22-context-research"><h3>{project.researchOrder.serviceTitle}</h3><span>{orderLabels[project.researchOrder.status] || '状态待核对'}</span><p>研究额度 {project.researchOrder.budgetCredits} Credits · 截止 {stamp(project.researchOrder.deadlineAt)}</p>{project.researchOrder.deliverableCount > 0 && <p>已交付 {project.researchOrder.deliverableCount} 份成果、{project.researchOrder.evidenceCount} 条来源、{project.researchOrder.prospectCount} 个候选客户。候选信息仍需核验。</p>}<button type="button" onClick={() => onOrder(project.researchOrder!.id)}>查看关联研究任务单<Icon name="arrow-right" size={16}/></button></div> : <p className="ys22-context-caption">尚未准备外部研究委托。此目标与 Worker 任务分别审批、派发和验收。</p>}
      <div className="ys22-context-results"><h3>经营证据</h3>{!project.results.observedAt ? <p>尚未读取实际订单，不能判断销售结果。</p> : <><p>{project.results.complete ? '本轮订单已完整读取' : '仅有部分订单，尚未读取完整'} · {stamp(project.results.observedAt)}</p><p>{project.results.paidFulfilledOrders} 笔已收款并履约订单；{project.results.netReceipts.length ? project.results.netReceipts.map(receipt => `${receipt.amount} ${receipt.currency}`).join(' / ') : '当前已读取范围内暂无有效净收款'}。</p></>}<small>研究验收不代表销售达成。订单仍待归因，可结算金额待确认。</small></div>
      <div className="ys22-context-actions"><button type="button" onClick={() => onProject(project.id)}>打开此托管任务<Icon name="arrow-right" size={16}/></button></div>
    </article>) : <div className="ys22-context-empty"><p>此目标尚未关联产品托管。</p><small>在托管任务中创建研究目标后，确认过的产品版本与范围会显示在这里。</small><button type="button" onClick={onBrowse}>查看产品托管<Icon name="arrow-right" size={16}/></button></div>}
    </details>
  </section>;
}
