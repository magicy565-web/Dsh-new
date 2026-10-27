import React,{memo} from 'react';
import {Handle,Position} from '@xyflow/react';
import {Factory,UserRound,Network,Bot,Package,Globe2,Store,ClipboardCheck,ContactRound,ReceiptText,ShoppingBag,ShieldCheck,FileText,ArrowUpRight,Check,ExternalLink} from 'lucide-react';
import {KINDS,STATUSES,statusTone,money} from './model.mjs';
import {safeUrl} from './api.mjs';
export const ICONS={factory:Factory,distributor:UserRound,personal_agent:Bot,service_order:ClipboardCheck,product:Package,market:Globe2,channel:Store,worker:Network,buyer:ContactRound,quote:ReceiptText,order:ShoppingBag,approval:ShieldCheck,evidence:FileText};
export function KindIcon({kind,size=18,...props}) {const Icon=ICONS[kind]||Network;return <Icon size={size} strokeWidth={1.7} {...props}/>;}
export function Status({value}){return <span className={`cn-status cn-tone-${statusTone(value)}`}><i/>{STATUSES[value]||'待核对'}</span>;}
function Facts({item}) {
  const i=item.info||{};
  if(item.kind==='personal_agent')return <><div className="cn-node-detail"><span>{i.providerName||'独立服务商'}</span><span className="cn-mono">PULL</span></div><p className="cn-node-summary">{i.skill||'能力待登记'}</p></>;
  if(item.kind==='service_order')return <><p className="cn-node-summary">{i.brief||'任务范围待完善'}</p><div className="cn-node-detail"><span>本次费用上限</span><b>{money(i.maximumMinor,i.currency)}</b></div></>;
  if(item.kind==='product')return <div className="cn-product-preview">{safeUrl(item.imageUrl)?<img src={safeUrl(item.imageUrl)} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<span className="cn-product-icon"><Package size={22}/></span>}<div><span>{item.raw?.sku||'产品资料'}</span><small>{i.available||0}/{i.total||6} 项基础资料 · {i.assetCount||0} 个附件</small></div></div>;
  if(item.kind==='factory')return <><p className="cn-node-summary">{item.subtitle||'产品与交付能力提供方'}</p><div className="cn-node-detail"><span>{i.marketCode?`目标市场 · ${i.marketCode}`:'供应能力待完善'}</span><span>{i.identityReceiptPresent?'身份有凭据':'身份待核验'}</span></div></>;
  if(item.kind==='distributor')return <><p className="cn-node-summary">海外销售与客户关系</p><div className="cn-node-detail"><span>合作区域</span><b>{i.marketCode||'待约定'}</b></div></>;
  if(item.kind==='market')return <><p className="cn-node-summary">{item.subtitle}</p><div className="cn-node-detail"><span>规划中的渠道</span><b>{i.channelCount??0}</b></div></>;
  if(item.kind==='channel')return <><p className="cn-node-summary">{i.goal||item.subtitle||'渠道计划'}</p><div className="cn-node-detail"><span>{i.productCount??0} 个关联产品</span><b>{i.metrics?`${i.metrics.inquiries??'—'} 条询盘`:'尚无业务回执'}</b></div></>;
  if(item.kind==='worker')return <><p className="cn-node-summary">{i.goal||'执行范围待完善'}</p><div className="cn-node-detail"><span>{i.frequencyHours?`每 ${i.frequencyHours} 小时`:'按需执行'}</span><b>{i.run?.taskRef?'已关联任务':'尚未启动'}</b></div></>;
  return <><p className="cn-node-summary">{i.nextAction||item.subtitle||'在当前对话中查看原始资料'}</p><div className="cn-node-detail"><span>来源证据</span><b>{item.evidenceIds?.length||0} 条</b></div></>;
}
export const NodeCard=memo(function NodeCard({data,selected}){
  const {item}=data;
  return <article className={`cn-node cn-kind-${item.kind}${selected?' cn-node-selected':''}`} aria-label={`${KINDS[item.kind]}：${item.title}`}>
    <Handle type="target" position={Position.Left} isConnectable={false}/>
    <div className="cn-node-top"><span className="cn-node-icon"><KindIcon kind={item.kind}/></span><span className="cn-node-type">{KINDS[item.kind]}</span><button type="button" className="cn-node-menu nodrag nopan" title="在当前会话中查看" aria-label={`在对话中查看${item.title}`} onClick={e=>{e.stopPropagation();data.onAsk(item);}}><ArrowUpRight size={15}/></button></div>
    <h3 title={item.title}>{item.title}</h3>
    <Facts item={item}/>
    <footer><Status value={item.status}/><span className="cn-node-proof">{item.evidenceIds?.length?<><FileText size={11}/>{item.evidenceIds.length} 条凭据</>:item.kind==='service_order'?'等待真实回执':null}</span></footer>
    <Handle type="source" position={Position.Right} isConnectable={false}/>
  </article>;
});
