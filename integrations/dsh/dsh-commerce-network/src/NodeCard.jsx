import React, { memo } from 'react';
import { Handle, Position, useStore } from '@xyflow/react';
import { Factory, Store, Bot, ClipboardList, Package, Radio, Globe, FileText, BadgeCheck, Receipt, ContactRound, ShoppingBag, Inbox, PackageOpen, Radar, FileCheck, Network, ArrowUpRight, ShieldCheck, Megaphone } from 'lucide-react';
import { KINDS, STATUSES, statusTone, money } from './model.mjs';
import { safeUrl } from './api.mjs';
import { kindFamily, portsOf, isRunningStatus } from './canvas/kinds.mjs';
import { canStartConnection, canReceiveConnection } from './canvas/connect-rules.mjs';

export const ICONS = {
  factory: Factory, distributor: Store, personal_agent: Bot, service_order: ClipboardList, product: Package, channel: Megaphone, worker: Radar,
  market: Globe, business_mandate: FileText, approval: BadgeCheck, evidence: FileCheck, quote: Receipt, buyer: ContactRound, rfq: Inbox,
  order: ShoppingBag, erp_order: ShoppingBag, sample: PackageOpen,
};
export const familyClass = (kind) => `cn-family-${kindFamily(kind)}`;
export function KindIcon({ kind, size = 18, ...props }) {
  const Icon = ICONS[kind] || Network;
  return <Icon size={size} strokeWidth={1.6} aria-hidden="true" {...props} />;
}
export function Status({ value }) {
  return <span className={`cn-status cn-tone-${statusTone(value)}`}><i />{STATUSES[value] || '待核对'}</span>;
}

const lodOf = (zoom) => (zoom < 0.45 ? 'compact' : zoom < 0.9 ? 'standard' : 'full');
export const useDetailLevel = () => useStore((state) => lodOf(state.transform[2]));

function Facts({ item }) {
  const i = item.info || {};
  if (item.kind === 'personal_agent') return <><p className="cn-node-summary">{i.skill || '能力待登记'}</p><div className="cn-node-detail"><span>{i.providerName || '独立服务商'}</span><span className="cn-mono">PULL</span></div></>;
  if (item.kind === 'service_order') {
    return <>
      <p className="cn-node-summary">{i.failure || i.brief || '任务范围待完善'}</p>
      <div className="cn-node-detail"><span>本次费用上限</span><b className="cn-mono">{money(i.maximumMinor, i.currency)}</b></div>
    </>;
  }
  if (item.kind === 'product') return <div className="cn-product-preview"><span className="cn-product-thumb">{safeUrl(item.imageUrl) ? <img src={safeUrl(item.imageUrl)} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Package size={22} aria-hidden="true" />}</span><div><span className="cn-mono">{item.raw?.sku || '产品资料'}</span><small>{i.available || 0}/{i.total || 6} 项基础资料 · {i.assetCount || 0} 个附件</small></div></div>;
  if (item.kind === 'factory') return <><p className="cn-node-summary">{item.subtitle || '产品与交付能力提供方'}</p><div className="cn-node-detail"><span>{i.marketCode ? `目标市场 · ${i.marketCode}` : '供应能力待完善'}</span><span>{i.identityReceiptPresent ? '身份有凭据' : '身份待核验'}</span></div></>;
  if (item.kind === 'distributor') return <><p className="cn-node-summary">海外销售与客户关系</p><div className="cn-node-detail"><span>合作区域</span><b>{i.marketCode || '待约定'}</b></div></>;
  if (item.kind === 'market') return <><p className="cn-node-summary">{item.subtitle}</p><div className="cn-node-detail"><span>规划中的渠道</span><b>{i.channelCount ?? 0}</b></div></>;
  if (item.kind === 'channel') return <><p className="cn-node-summary">{i.goal || item.subtitle || '渠道计划'}</p><div className="cn-node-detail"><span>{i.productCount ?? 0} 个关联产品</span><b>{i.metrics ? `${i.metrics.inquiries ?? '—'} 条询盘` : '尚无业务回执'}</b></div></>;
  if (item.kind === 'worker') return <><p className="cn-node-summary">{i.goal || '执行范围待完善'}</p><div className="cn-node-detail"><span>{i.frequencyHours ? `每 ${i.frequencyHours} 小时` : '按需执行'}</span><b>{i.run?.taskRef ? '已关联任务' : '尚未启动'}</b></div></>;
  if (item.kind === 'business_mandate') return <><p className="cn-node-summary">{item.subtitle}</p><div className="cn-node-detail"><span>{i.marketCode ? `市场 · ${i.marketCode}` : '市场待约定'}</span><span>{item.evidenceIds?.length ? '已有批准凭据' : '待批准'}</span></div></>;
  return <><p className="cn-node-summary">{i.nextAction || STATUSES[item.subtitle] || item.subtitle || '在当前对话中查看原始资料'}</p><div className="cn-node-detail"><span>{i.authority || '来源证据'}</span><b>{item.evidenceIds?.length || 0} 条</b></div></>;
}

export const NodeCard = memo(function NodeCard({ data, selected }) {
  const { item } = data;
  const level = useDetailLevel();
  const ports = portsOf(item.kind);
  const running = isRunningStatus(item.status);
  const failed = item.status === 'failed' || item.status === 'rejected';
  const className = `cn-node ${familyClass(item.kind)} cn-lod-${level}${selected ? ' cn-node-selected' : ''}${running ? ' cn-node-running' : ''}${failed ? ' cn-node-failed' : ''}${item.saveable === false ? ' cn-node-fixed' : ''}`;
  return (
    <article className={className} data-kind={item.kind} aria-label={`${KINDS[item.kind]}：${item.title}，${STATUSES[item.status] || '待核对'}`}>
      <Handle type="target" position={Position.Left} isConnectable={canReceiveConnection(item.kind)} className={ports.in ? undefined : 'cn-port-quiet'} />
      <span className="cn-node-bar" aria-hidden="true" />
      {level === 'compact' ? (
        <div className="cn-node-compact"><span className="cn-node-icon"><KindIcon kind={item.kind} size={20} /></span><h3 title={item.title}>{item.title}</h3><i className={`cn-status-dot cn-tone-${statusTone(item.status)}`} aria-hidden="true" /></div>
      ) : (
        <>
          <div className="cn-node-top">
            <span className="cn-node-icon"><KindIcon kind={item.kind} /></span>
            <span className="cn-node-type">{KINDS[item.kind]}</span>
            <button type="button" className="cn-node-menu nodrag nopan" title="在当前会话中处理" aria-label={`在对话中处理${item.title}`} onClick={(event) => { event.stopPropagation(); data.onAsk(item); }}><ArrowUpRight size={15} /></button>
          </div>
          <h3 title={item.title}>{item.title}</h3>
          <Facts item={item} />
          <footer>
            <Status value={item.status} />
            <span className="cn-node-proof">{item.evidenceIds?.length ? <><ShieldCheck size={11} aria-hidden="true" />{item.evidenceIds.length} 条凭据</> : item.kind === 'service_order' ? '等待真实回执' : null}</span>
          </footer>
        </>
      )}
      <Handle type="source" position={Position.Right} isConnectable={canStartConnection(item.kind)} className={ports.out ? undefined : 'cn-port-quiet'} />
    </article>
  );
});
