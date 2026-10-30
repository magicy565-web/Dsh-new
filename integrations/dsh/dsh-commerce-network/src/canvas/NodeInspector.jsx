import React, { useId, useState } from 'react';
import { X, ArrowUpRight, FileText, ShieldCheck, Clock3, Check, KeyRound, ChevronRight, AlertCircle, Link2, ArrowRight, ArrowLeft, LoaderCircle } from 'lucide-react';
import { KindIcon, Status, familyClass } from '../NodeCard.jsx';
import { KINDS, ACTION_LABELS, EDGE_LABELS, money, timestamp, selectedRecord, eventLabel } from '../model.mjs';
import { Detail, TagList } from '../ui.jsx';
import { isRunningStatus } from './kinds.mjs';

const TABS = [['overview', '概览'], ['relations', '关系'], ['records', '记录'], ['activity', '活动']];
const FIELD_LABELS = { marketCode: '市场', stage: '业务阶段', channel: '渠道', source: '来源', verifiedAt: '核验时间', externalOrderId: '订单号', assetCount: '附件数量' };

function Overview({ node, state, record, info, busy, onAsk, onAction, onArtifact }) {
  const artifacts = (state.deliverables || []).filter((item) => item.orderId === node.refId || item.workOrderId === node.refId);
  const dependencies = (record.dependsOn || []).map((id) => state.commerceNetwork?.workOrders?.find((order) => order.id === id)).filter(Boolean);
  const waitingOnDependencies = dependencies.some((order) => order.status !== 'accepted');

  if (node.kind === 'service_order') {
    return (
      <>
        {info.failure && <div className="cv-alert" role="alert"><AlertCircle size={16} aria-hidden="true" /><p>{info.failure}</p></div>}
        {isRunningStatus(node.status) && <div className="cv-progress"><LoaderCircle size={15} className="cn-spin" aria-hidden="true" /><span>{node.status === 'stop_requested' ? '正在等待服务商确认停止' : '正在由 Personal AI Worker 执行'}{record.leaseExpiresAt ? ` · 租约至 ${timestamp(record.leaseExpiresAt)}` : ''}</span></div>}
        <section><h3>服务范围</h3><p>{record.brief || info.brief || '任务说明尚未补全。请在对话中明确预期交付。'}</p><Detail label="本次费用上限" value={money(record.maximumMinor, record.currency)} /><Detail label="原生任务" value={record.dshTaskRef} mono /><Detail label="最后更新" value={record.updatedAt ? timestamp(record.updatedAt) : null} /></section>
        <section><h3>允许的服务</h3><TagList items={record.allowedActions} labels={ACTION_LABELS} /><h3>可访问的资料</h3><TagList items={record.allowedResourceRefs} /></section>
        {dependencies.length > 0 && <section><h3>等待前序交付验收</h3>{dependencies.map((order) => <div className="cn-dependency-row" key={order.id}><span>{order.title}</span><Status value={order.status} /></div>)}</section>}
        {node.status === 'proposed' && <div className="cn-decision-card"><ShieldCheck size={20} aria-hidden="true" /><h3>等待你授权</h3><p>核对任务范围、服务商和费用上限后，这项委托才可进入原生调度。</p><button type="button" className="cn-button cn-primary" disabled={busy} onClick={() => onAction('approve_order', record)}>审核并授权</button></div>}
        {node.status === 'authorized' && <div className="cn-decision-card"><Clock3 size={20} aria-hidden="true" /><h3>{waitingOnDependencies ? '已授权，等待前序验收' : '已授权，等待调度'}</h3><p>{waitingOnDependencies ? '所有前序委托完成验收后，才能启动这一步。' : '由当前会话创建原生执行任务。'}</p><button type="button" className="cn-button cn-primary" disabled={waitingOnDependencies} onClick={() => onAsk(node, '请核验这项委托的批准记录和 Agent 连接，然后通过原生 DSH 工具调度执行。')}>交给当前 Assistant 调度</button></div>}
        {artifacts.length > 0 && <section><h3>交付物 · {artifacts.length}</h3>{artifacts.map((item, index) => <button type="button" className="cn-artifact" key={item.id || index} onClick={() => onArtifact(item)}><FileText size={19} aria-hidden="true" /><span><b>{item.title || item.name || item.id || '任务交付'}</b><small>{item.createdAt ? timestamp(item.createdAt) : item.sha256 ? `SHA-256 ${item.sha256.slice(0, 12)}…` : '查看交付内容与凭据'}</small></span><ChevronRight size={15} aria-hidden="true" /></button>)}</section>}
        {node.status === 'delivered' && <div className="cn-decision-card"><Check size={21} aria-hidden="true" /><h3>交付已到，等待验收</h3><p>请核对实际交付内容和来源，再决定接收或退回。</p><div className="cn-two-buttons"><button type="button" className="cn-button" disabled={busy} onClick={() => onAction('reject_delivery', record)}>拒收交付</button><button type="button" className="cn-button cn-primary" disabled={busy} onClick={() => onAction('accept_delivery', record)}>验收交付</button></div></div>}
        {['proposed', 'authorized', 'queued', 'claimed', 'running'].includes(node.status) && <button type="button" className="cn-text-button cn-danger-text" disabled={busy} onClick={() => onAction('cancel_order', record)}>取消这项委托</button>}
        {node.status === 'failed' && record.stopUnconfirmed && <div className="cn-decision-card"><AlertCircle size={20} aria-hidden="true" /><h3>外部执行需要核对</h3><p>{record.stopAcknowledgedAt ? '已收到外部停止回执。核对后可释放本项委托的费用预留。' : '执行租约已到期，尚未收到停止回执。费用预留保持冻结，避免重复委托。'}</p>{record.stopAcknowledgedAt && <button type="button" className="cn-button" disabled={busy} onClick={() => onAction('resolve_failed_order', record)}>核对并释放预留</button>}</div>}
      </>
    );
  }
  if (node.kind === 'personal_agent') {
    return (
      <>
        <section><h3>独立服务商</h3><Detail label="提供者" value={info.providerName} /><Detail label="接入方式" value="Pull Gateway" /><Detail label="首次连接" value={record.endpointVerifiedAt ? timestamp(record.endpointVerifiedAt) : null} /><Detail label="最近心跳" value={record.lastSeenAt ? timestamp(record.lastSeenAt) : record.lastHeartbeatAt ? timestamp(record.lastHeartbeatAt) : null} /></section>
        <section><h3>登记能力</h3><TagList items={record.skills || info.skills} labels={ACTION_LABELS} /><p className="cn-field-note">登记能力由服务商提供；实际交付需逐项验收。</p></section>
        {node.status !== 'revoked' && <section><h3>连接与访问</h3><p>{['unverified', 'credential_issued'].includes(node.status) ? '为这位 Agent 创建受限连接凭据，完成握手后即可承接已授权的任务。' : '此 Agent 只能领取分配给自己的委托。更新凭据将撤销此前的凭据。'}</p><button type="button" className="cn-button cn-primary" disabled={busy} onClick={() => onAction('issue_agent_credential', record)}><KeyRound size={15} aria-hidden="true" />{node.status === 'endpoint_verified' ? '更新连接凭据' : '创建连接凭据'}</button><button type="button" className="cn-text-button cn-danger-text" disabled={busy} onClick={() => onAction('revoke_agent', record)}>撤销 Agent 访问</button></section>}
      </>
    );
  }
  return (
    <>
      <section><h3>业务资料</h3><p>{node.raw?.description || node.subtitle || '在当前会话中补全业务资料。'}</p>{Object.entries(info).filter(([key, value]) => FIELD_LABELS[key] && value !== undefined && value !== null).map(([key, value]) => <Detail key={key} label={FIELD_LABELS[key]} value={value} />)}</section>
      {['factory', 'distributor'].includes(node.kind) && <button type="button" className="cn-button cn-primary" onClick={() => onAsk(node, '为这个商业主体规划一项第三方 Personal AI Worker 服务委托。先核对已有产品和可用服务商，生成待我审批的草案。')}>规划服务委托 <ArrowUpRight size={15} aria-hidden="true" /></button>}
    </>
  );
}

function Relations({ node, graph, onSelectNode, onSelectEdge }) {
  const rows = (graph?.edges || []).filter((edge) => edge.source === node.id || edge.target === node.id).map((edge) => {
    const outgoing = edge.source === node.id;
    return { edge, outgoing, other: graph.nodes.find((candidate) => candidate.id === (outgoing ? edge.target : edge.source)) };
  }).filter((row) => row.other);
  if (!rows.length) return <section><h3>业务关系</h3><p className="cn-field-note">这个节点还没有与其他节点的关系。可以拖动右侧端口发起连线，或在对话中让 Assistant 建立。</p></section>;
  return (
    <section>
      <h3>业务关系 · {rows.length}</h3>
      <ul className="cv-relations">
        {rows.map(({ edge, outgoing, other }) => (
          <li key={edge.id}>
            <button type="button" className="cv-relation" onClick={() => onSelectNode(other.id)}>
              <span className={`cn-node-icon ${familyClass(other.kind)}`}><KindIcon kind={other.kind} size={16} /></span>
              <span><b>{other.title}</b><small>{outgoing ? <ArrowRight size={11} aria-hidden="true" /> : <ArrowLeft size={11} aria-hidden="true" />}{EDGE_LABELS[edge.kind] || edge.kind} · {KINDS[other.kind]}</small></span>
            </button>
            <button type="button" className="cn-icon-button" aria-label={`查看关系：${EDGE_LABELS[edge.kind] || edge.kind}`} title="关系详情" onClick={() => onSelectEdge(edge.id)}><Link2 size={14} /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Records({ node }) {
  return (
    <>
      <section><h3>证据与凭据</h3>{node.evidenceIds?.length ? <div className="cn-receipts">{node.evidenceIds.map((id) => <div key={id}><ShieldCheck size={13} aria-hidden="true" /><code title={id}>{id}</code></div>)}</div> : <p className="cn-field-note">尚无核验凭据。</p>}</section>
      <div className="cn-record-id"><span>业务引用</span><code>{node.refId}</code></div>
      <div className="cn-record-id"><span>画布节点</span><code>{node.id}</code></div>
    </>
  );
}

function Activity({ node, state }) {
  const events = (state.events || []).filter((event) => event.entityId === node.refId || event.orderId === node.refId || event.agentServiceId === node.refId).slice(-20).reverse();
  if (!events.length) return <section><h3>活动</h3><p className="cn-field-note">这个节点还没有协作记录。</p></section>;
  return <section><h3>活动 · {events.length}</h3><div className="cn-mini-timeline">{events.map((event, index) => <div key={event.id || index}><i /><span>{eventLabel(event)}<small className="cn-mono">{timestamp(event.at || event.createdAt)}</small></span></div>)}</div></section>;
}

export function Inspector({ node, state, graph, onClose, onAsk, onAction, busy, onFocus, onArtifact, onSelectNode = () => {}, onSelectEdge = () => {} }) {
  const [tab, setTab] = useState('overview');
  const [expanded, setExpanded] = useState(false);
  const base = useId();
  const record = selectedRecord(state, node) || {};
  const info = node.info || {};
  const title = KINDS[node.kind] || node.kind;
  return (
    <aside className={`cn-inspector${expanded ? ' cn-inspector-expanded' : ''}`} aria-label={`${title}详情`}>
      <button type="button" className="cv-sheet-handle" aria-label={expanded ? '收起详情' : '展开详情'} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}><i /></button>
      <header>
        <span className={`cn-inspector-icon cn-node-icon ${familyClass(node.kind)}`}><KindIcon kind={node.kind} /></span>
        <span>{title}</span>
        <button type="button" className="cn-icon-button" onClick={onClose} aria-label="关闭节点详情"><X size={17} /></button>
      </header>
      <div className="cv-inspector-head"><h2>{node.title}</h2><Status value={node.status} /></div>
      <div className="cv-tabs" role="tablist" aria-label="节点详情分区">
        {TABS.map(([id, label]) => <button type="button" key={id} role="tab" id={`${base}-${id}`} aria-selected={tab === id} aria-controls={`${base}-panel`} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'cv-selected' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <div className="cn-inspector-scroll" role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${tab}`} tabIndex={0}>
        {tab === 'overview' && <Overview node={node} state={state} record={record} info={info} busy={busy} onAsk={onAsk} onAction={onAction} onArtifact={onArtifact} />}
        {tab === 'relations' && <Relations node={node} graph={graph} onSelectNode={onSelectNode} onSelectEdge={onSelectEdge} />}
        {tab === 'records' && <Records node={node} />}
        {tab === 'activity' && <Activity node={node} state={state} />}
      </div>
      <footer className="cv-inspector-foot"><button type="button" className="cn-button cn-soft" onClick={() => onAsk(node)}><ArrowUpRight size={14} aria-hidden="true" />在对话中处理</button><button type="button" className="cn-icon-button cn-bordered" onClick={onFocus} title="查看相关节点" aria-label="查看相关节点"><Link2 size={15} /></button></footer>
    </aside>
  );
}
