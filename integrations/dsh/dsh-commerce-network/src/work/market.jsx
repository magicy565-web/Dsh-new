import React,{useMemo,useState} from 'react';
import {ArrowUpRight,BriefcaseBusiness,ChevronRight,Search} from 'lucide-react';
import {EmptyState,EvidenceNote,MaintainerChip,NeverList,RuntimeIcon,ScopeList} from './parts.jsx';
import {HireSheet,UpgradeSheet} from './hire.jsx';
import {INPUT_LABELS,OUTPUT_LABELS,PRICE_NOTE,categoriesOf,hireState,marketTemplates,priceLabel,runtimeName,searchTemplates,templateEvidence,upgradeOffer} from './catalog.mjs';
import {formatTime,workerNo} from './model.mjs';

export function RuntimeStack({ids,size=22}){
  return <span className="aw-stack" role="img" aria-label={ids.map(runtimeName).join('、')}>{ids.map(id=><RuntimeIcon key={id} id={id} size={size}/>)}</span>;
}

function TemplateRow({template,hired,onOpen,index}){
  const p=template.published;
  return <button type="button" className="aw-badge-row" style={{'--i':index}} onClick={onOpen}>
    <span className="aw-glyph" aria-hidden="true"><BriefcaseBusiness size={20} strokeWidth={1.75}/></span>
    <span className="aw-badge-row-main">
      <strong>{p.name}</strong>
      <small className="aw-clamp">{p.tagline}</small>
      <small className="aw-by">{p.maintainerName||'未署名'} · <span className="aw-mono">v{p.version}</span> · <span className="aw-mono">{priceLabel(p.pricing)}</span></small>
    </span>
    <span className="aw-side"><RuntimeStack ids={p.runsOn}/>{hired?<span className="aw-tag">已招募</span>:template.status==='paused'?<span className="aw-tag">暂停接单</span>:null}</span>
    <ChevronRight className="aw-chevron" size={16} aria-hidden="true"/>
  </button>;
}

export function MarketScreen({v}){
  const all=useMemo(()=>marketTemplates(v.templates),[v.templates]);
  const [query,setQuery]=useState(''),[category,setCategory]=useState('');
  const categories=categoriesOf(all),rows=searchTemplates(all,{query,category});
  return <>
    <div className="aw-pagehead"><h2>招募</h2></div>
    {v.bar}
    <div className="aw-search"><Search size={16} aria-hidden="true"/><input type="search" aria-label="搜索 Worker" placeholder="搜索名称、能力或维护者" value={query} onChange={e=>setQuery(e.target.value)}/></div>
    {categories.length>1&&<div className="aw-cats" role="group" aria-label="按分类筛选">
      {['',...categories].map(name=><button type="button" key={name||'all'} aria-pressed={category===name} onClick={()=>setCategory(name)}>{name||'全部'}</button>)}
    </div>}
    <section className="aw-section"><div className="aw-section-head"><h3>可招募的 Worker</h3><span className="aw-count aw-mono">{rows.length}</span></div>
      {rows.length?<div className="aw-list">{rows.map((t,i)=><TemplateRow key={t.id} index={i} template={t} hired={!!hireState(t,{projectId:v.projectId,agents:v.agents}).agent} onOpen={()=>v.go('template',t.id)}/>)}</div>
        :<EmptyState title={all.length?'没有匹配的 Worker':'还没有发布的 Worker'} hint={all.length?'换个关键词，或清除分类筛选。':'维护者发布后会出现在这里。'}/>}
    </section>
    <p className="aw-footnote">这里只列出当前工作区里已发布的 Worker，跨工作区的公开市场尚未接入。想发布自己的 Worker？到「Worker」页的维护者工作台。</p>
  </>;
}

function TemplateBadge({template}){
  const p=template.published,stats=templateEvidence(template);
  return <article className="aw-badge" aria-label={`${p.name} 工牌`}>
    <span className="aw-hole" aria-hidden="true"/>
    <div className="aw-band"><span className="aw-mono">AI WORKER</span><span className="aw-mono">No.{workerNo(template.id)} · v{p.version}</span></div>
    <span className="aw-badge-glyph" aria-hidden="true"><BriefcaseBusiness size={26} strokeWidth={1.6}/></span>
    <div className="aw-badge-body"><h2>{p.name}</h2><p>{p.tagline}</p></div>
    <div className="aw-sign">
      <div><span className="aw-label">维护者</span><MaintainerChip party={{displayName:p.maintainerName||'未署名',verification:template.maintainerVerification}} note={template.builtin?'DSH 内置':undefined}/></div>
      <div><span className="aw-label">可运行于</span><RuntimeStack ids={p.runsOn} size={28}/></div>
    </div>
    <dl className="aw-stats"><div><dt>已验收</dt><dd>{stats.accepted}</dd></div><div><dt>已退回</dt><dd>{stats.rejected}</dd></div><div><dt>已招募</dt><dd>{stats.hires}</dd></div></dl>
    <p className="aw-badge-foot aw-mono">{p.declared?.responseTime?`维护者自述响应：${p.declared.responseTime}`:'维护者未自述响应时间'}</p>
  </article>;
}

export function StarterTile({starter,disabled,onOpen}){
  return <button type="button" className="aw-starter" disabled={disabled} onClick={onOpen}><span><strong>{starter.title}</strong><small>{starter.brief}</small></span><ArrowUpRight size={16} aria-hidden="true"/></button>;
}

export function PriceBlock({pricing}){
  const plan=pricing.kind==='free'?'免费使用。':pricing.kind==='subscription'?'按月订阅。':'按验收付款：验收之后才计费。';
  return <div className="aw-price"><span className="aw-mono aw-price-figure">{priceLabel(pricing)}</span><span>{plan}</span><small className="aw-hint">{PRICE_NOTE}</small></div>;
}

export function VersionList({versions}){
  return <ol className="aw-versions">{[...versions].reverse().map(ver=><li key={ver.version}>
    <span className="aw-mono aw-ver">v{ver.version}</span>
    <span className="aw-version-main"><small className="aw-mono">{formatTime(ver.publishedAt)}</small><span>{ver.changelog}</span>
      {(ver.widensScope||ver.changesPricing)&&<span className="aw-tags">{ver.widensScope&&<span className="aw-tag">扩大了权限</span>}{ver.changesPricing&&<span className="aw-tag">报价有调整</span>}</span>}
    </span>
  </li>)}</ol>;
}

export function TemplateScreen({v,id}){
  const template=v.templates.find(t=>t.id===id);
  const [sheet,setSheet]=useState(null);
  if(!template||!template.published)return <EmptyState title="Worker 已更新" hint="这个 Worker 已不在招募页中。"/>;
  const p=template.published,state=hireState(template,{projectId:v.projectId,agents:v.agents}),evidence=templateEvidence(template);
  const offer=state.agent?upgradeOffer(state.agent,template):null;
  const openStarter=starter=>setSheet({mode:state.kind==='hired'?'task':'hire',starter});
  return <>
    <TemplateBadge template={template}/>
    {offer&&<section className="aw-section"><div className="aw-offer"><span><strong>你的项目里有新版本</strong><small>已招募 {state.agent.workerTemplate.version==null?'试运行草稿':<span className="aw-mono">v{state.agent.workerTemplate.version}</span>}，最新 <span className="aw-mono">v{offer.target.version}</span></small></span><button type="button" className="aw-secondary" onClick={()=>setSheet({mode:'upgrade'})}>查看并升级</button></div></section>}
    {p.starters.length>0&&<section className="aw-section"><div className="aw-section-head"><h3>直接让它做</h3></div>
      <div className="aw-starters">{p.starters.map(s=><StarterTile key={s.id} starter={s} disabled={state.kind==='blocked'} onOpen={()=>openStarter(s)}/>)}</div>
      <p className="aw-footnote">{state.kind==='hired'?'点一个任务，会为已招募的它起草任务草稿，等你审批。':'点一个任务，会同时招募它并起草任务草稿，等你审批。'}</p></section>}
    <section className="aw-section"><div className="aw-section-head"><h3>能力</h3></div><ScopeList skills={p.skills}/>
      <dl className="aw-kv"><div><dt>接收</dt><dd>{p.inputs.length?p.inputs.map(k=>INPUT_LABELS[k]).join('、'):'任务说明'}</dd></div><div><dt>交付</dt><dd>{p.outputs.map(k=>OUTPUT_LABELS[k]).join('、')}</dd></div></dl></section>
    <section className="aw-section"><div className="aw-section-head"><h3>不会做</h3></div><NeverList/></section>
    <section className="aw-section"><div className="aw-section-head"><h3>报价提案</h3></div><PriceBlock pricing={p.pricing}/></section>
    <section className="aw-section"><div className="aw-section-head"><h3>真实记录</h3></div><EvidenceNote stats={evidence}/></section>
    <section className="aw-section"><div className="aw-section-head"><h3>版本</h3><span className="aw-count aw-mono">{template.versions.length}</span></div><VersionList versions={template.versions}/></section>
    <div className="aw-sticky">
      {state.kind==='blocked'&&<p className="aw-calm">{state.reason}</p>}
      {state.kind==='hired'?<button type="button" className="aw-primary" onClick={()=>v.go('worker',state.agent.id)}>查看已招募的 Worker<ChevronRight size={16} aria-hidden="true"/></button>
        :<button type="button" className="aw-primary" disabled={state.kind==='blocked'} onClick={()=>setSheet({mode:'hire',starter:null})}>招募到「{v.projectName||'当前项目'}」</button>}
    </div>
    {sheet&&sheet.mode==='upgrade'&&<UpgradeSheet v={v} agent={state.agent} template={template} onClose={()=>setSheet(null)}/>}
    {sheet&&sheet.mode!=='upgrade'&&<HireSheet v={v} template={template} starter={sheet.starter} mode={sheet.mode} agent={state.agent} onClose={()=>setSheet(null)}/>}
  </>;
}

/** On a hired Worker: which template and version it is pinned to, what was agreed, and whether a newer one exists. */
export function PackageSection({v,agent}){
  const [upgrading,setUpgrading]=useState(false);
  const pin=agent.workerTemplate;
  if(!pin)return null;
  const template=v.templates.find(t=>t.id===pin.templateId),offer=template?upgradeOffer(agent,template):null;
  const name=template?.published?.name||template?.draft?.name||'已不在目录中的模板';
  return <section className="aw-section"><div className="aw-section-head"><h3>工作包</h3></div>
    <dl className="aw-kv aw-kv-card">
      <div><dt>来源模板</dt><dd>{template?.published?<button type="button" className="aw-link" onClick={()=>v.go('template',template.id)}>{name}</button>:name}</dd></div>
      <div><dt>固定版本</dt><dd className="aw-mono">{pin.version==null?'试运行草稿':`v${pin.version}`}</dd></div>
      <div><dt>报价提案</dt><dd><span className="aw-mono">{priceLabel(pin.billing)}</span><small className="aw-hint">未接入支付，不扣款</small></dd></div>
    </dl>
    {offer&&<div className="aw-offer"><span><strong>有新版本 <span className="aw-mono">v{offer.target.version}</span></strong><small>{offer.added.length?'新增能力需要你重新授权':'权限范围不变'}</small></span><button type="button" className="aw-secondary" onClick={()=>setUpgrading(true)}>查看并升级</button></div>}
    {upgrading&&<UpgradeSheet v={v} agent={agent} template={template} onClose={()=>setUpgrading(false)}/>}
  </section>;
}
