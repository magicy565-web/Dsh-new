import React,{useState} from 'react';
import {ArrowUpRight,Check} from 'lucide-react';
import {RuntimeIcon} from './parts.jsx';
import {CheckRow,ChipGroup,Field,Notice,Sheet} from './sheet.jsx';
import {ALL_RUNTIMES,PRICE_NOTE,commandError,priceLabel,requestersOf,runtimeChoices,toggleIn,upgradeOffer} from './catalog.mjs';
import {skillLabel} from './model.mjs';

function RuntimePicker({spec,value,onChange}){
  return <fieldset className="aw-picker"><legend className="aw-label">运行在哪个 Agent</legend>
    {runtimeChoices(spec).map(r=><label key={r.id} className="aw-pick" data-on={value===r.id||undefined} data-disabled={!r.supported||undefined}>
      <input type="radio" name="aw-runtime" value={r.id} checked={value===r.id} disabled={!r.supported} onChange={()=>onChange(r.id)}/>
      <RuntimeIcon id={r.id} size={32}/>
      <span><strong>{r.name}</strong><small>{r.supported?'支持':'这个 Worker 不支持'}</small></span>
    </label>)}
  </fieldset>;
}

function SkillChecks({legend,skills,granted,onToggle,notes={}}){
  return <fieldset className="aw-checks"><legend className="aw-label">{legend}</legend>
    <div className="aw-check-list">{skills.map(skill=><CheckRow key={skill} label={skillLabel(skill)} note={notes[skill]} checked={granted.includes(skill)} onChange={()=>onToggle(skill)}/>)}</div>
  </fieldset>;
}

function Steps({items}){return <ol className="aw-steps">{items.map(item=><li key={item}>{item}</li>)}</ol>;}

/**
 * One sheet for three intents: hire a published Worker, run a trial from a maintainer's draft, or draft a
 * starter task for a Worker that is already hired. Every write is an owner command the service re-validates.
 */
export function HireSheet({v,template,starter=null,mode='hire',agent=null,onClose}){
  const spec=mode==='trial'?template.draft:template.published||template.draft,task=mode==='task';
  const requesters=requestersOf(v.parties);
  const [runtime,setRuntime]=useState(()=>ALL_RUNTIMES.find(r=>spec.runsOn.includes(r.id))?.id||'');
  const [skills,setSkills]=useState(()=>[...spec.skills]);
  const [requester,setRequester]=useState(requesters[0]?.id||'');
  const [products,setProducts]=useState([]);
  const [ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(null);
  const granted=task?agent.skills:skills,gap=starter?starter.skills.filter(s=>!granted.includes(s)):[];
  const paid=mode==='hire'&&spec.pricing.kind!=='free';
  const needsRequester=!!starter;
  const wantsProducts=!!starter&&starter.skills.includes('read_granted_product_context')&&(v.products||[]).length>0;
  const valid=!gap.length&&(!needsRequester||requester)&&(task||(runtime&&skills.length>0))&&(!paid||ack);
  const refs=products.map(id=>`product:${id}`);

  async function submit(){
    setBusy(true);setError('');
    try{
      let next;
      if(task)next=await v.run('propose_order',{requesterPartyId:requester,agentServiceId:agent.id,title:starter.title,brief:starter.brief,allowedActions:starter.skills,allowedResourceRefs:refs,maximumMinor:0,currency:'USD'});
      else next=await v.run('hire_worker',{templateId:template.id,runtime,grantedSkills:skills,...(mode==='trial'?{trial:true}:{}),...(starter?{starterId:starter.id,requesterPartyId:requester,allowedResourceRefs:refs}:{})});
      const hired=task?agent:(next.commerceNetwork?.agentServices||[]).find(a=>a.workerTemplate?.templateId===template.id&&a.status!=='revoked');
      setDone({agentId:hired?.id||null});
    }catch(e){setError(commandError(e));}finally{setBusy(false);}
  }

  const title=task?'起草任务':mode==='trial'?'试运行':`招募「${spec.name}」`;
  const footer=done
    ?<><button type="button" className="aw-primary" onClick={()=>{onClose();v.openCanvas?.();}}>{task?'在协作画布中审批':'打开协作画布'}<ArrowUpRight size={16} aria-hidden="true"/></button>
      <button type="button" className="aw-secondary" onClick={()=>{onClose();if(done.agentId&&!task)v.go('worker',done.agentId);}}>{task?'完成':'查看这个 Worker'}</button></>
    :<button type="button" className="aw-primary" disabled={!valid||busy} onClick={()=>void submit()}>{busy?'正在提交…':task?'起草任务':mode==='trial'?'开始试运行':'确认招募'}</button>;

  return <Sheet title={title} onClose={onClose} busy={busy} footer={footer}>
    {error&&<Notice tone="alert">{error}</Notice>}
    {done?<div className="aw-done"><span className="aw-done-mark" aria-hidden="true"><Check size={20} strokeWidth={3}/></span>
      <h3>{task?'任务草稿已创建':mode==='trial'?'试运行已开始':'已招募'}</h3>
      <Steps items={task?['任务草稿在你审批之前不会派发。','审批时可以再核对授权的资料与预算。']:['在协作画布为它签发专用凭证，并完成握手。',starter?`审批已起草的任务「${starter.title}」后再派发。`:'创建并审批第一个任务。']}/>
    </div>:<>
      <p className="aw-sheet-lead">项目 <strong>{v.projectName||'—'}</strong></p>
      {mode==='trial'&&<Notice>试运行会把这份草稿招募到当前项目，用真实任务验证它；它不会出现在招募页。</Notice>}
      {!task&&<RuntimePicker spec={spec} value={runtime} onChange={setRuntime}/>}
      {!task&&<SkillChecks legend="授予能力" skills={spec.skills} granted={skills} onToggle={skill=>setSkills(list=>toggleIn(list,skill))}/>}
      {starter&&<section className="aw-sheet-section"><h3>{task?'任务':'同时起草任务'}：{starter.title}</h3><p className="aw-prose aw-muted">{starter.brief}</p>
        {gap.length>0&&<Notice tone="alert">这个任务需要尚未授予的能力：{gap.map(skillLabel).join('、')}。</Notice>}
        {requesters.length?<Field label="谁发起这个任务" htmlFor="aw-requester"><select id="aw-requester" className="aw-input" value={requester} onChange={e=>setRequester(e.target.value)}>{requesters.map(p=><option key={p.id} value={p.id}>{p.displayName}</option>)}</select></Field>
          :<Notice tone="alert">项目里还没有工厂或分销商，无法起草任务。请先在协作画布登记发起方。</Notice>}
        {wantsProducts&&<ChipGroup legend="授权给它读取的产品资料" multiple options={v.products.map(p=>({id:p.id,label:p.name||p.id}))} value={products} onChange={id=>setProducts(list=>toggleIn(list,id))}/>}
        {wantsProducts&&<small className="aw-hint">不选则它读不到任何产品资料。</small>}
      </section>}
      {paid&&<section className="aw-sheet-section"><h3>计费确认</h3><p className="aw-price-line"><span className="aw-mono">{priceLabel(spec.pricing)}</span></p><Notice>{PRICE_NOTE}</Notice>
        <CheckRow label="我已了解：这只是报价提案，暂不扣款" checked={ack} onChange={setAck}/></section>}
      {!task&&<Notice>维护者「{spec.maintainerName||'未署名'}」看不到你的项目数据，也拿不到你的凭证。工作包指令会随任务发送给你选择的 Agent，Agent 会读到它。</Notice>}
    </>}
  </Sheet>;
}

/** Moving a hire to a newer version. Scope never widens on its own: new skills stay off until the owner ticks them. */
export function UpgradeSheet({v,agent,template,onClose}){
  // Frozen on open: once the upgrade lands the Worker is pinned to the new version and a fresh offer would be empty.
  const [opening]=useState(()=>({offer:upgradeOffer(agent,template),pin:agent.workerTemplate}));
  const {offer,pin}=opening;
  const [skills,setSkills]=useState(()=>offer?[...offer.keep]:[]);
  const [ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
  if(!offer)return null;
  const {target}=offer,valid=offer.runtimeOk&&skills.length>0&&(!offer.priceChanged||ack);
  async function submit(){
    setBusy(true);setError('');
    try{await v.run('upgrade_worker_hire',{agentServiceId:agent.id,version:target.version,grantedSkills:skills,...(offer.priceChanged?{acceptPricing:true}:{})});setDone(true);}
    catch(e){setError(commandError(e));}finally{setBusy(false);}
  }
  const notes=Object.fromEntries(offer.added.map(skill=>[skill,'新增：默认不授予']));
  return <Sheet title={`升级到 v${target.version}`} onClose={onClose} busy={busy} footer={done
    ?<button type="button" className="aw-primary" onClick={onClose}>完成</button>
    :<button type="button" className="aw-primary" disabled={!valid||busy} onClick={()=>void submit()}>{busy?'正在升级…':`升级到 v${target.version}`}</button>}>
    {error&&<Notice tone="alert">{error}</Notice>}
    {done?<div className="aw-done"><span className="aw-done-mark" aria-hidden="true"><Check size={20} strokeWidth={3}/></span><h3>已升级</h3><Steps items={['已有的任务保持它们各自审批时的授权。','新任务将使用新版本的工作包。']}/></div>:<>
      <p className="aw-sheet-lead"><span className="aw-mono">{pin.version==null?'试运行草稿':`v${pin.version}`} → v{target.version}</span></p>
      {target.changelog&&<p className="aw-prose aw-quote">{target.changelog}</p>}
      {!offer.runtimeOk&&<Notice tone="alert">新版本不再支持这个 Worker 当前运行的 Agent，无法升级。</Notice>}
      {offer.added.length>0&&<Notice tone="alert">新版本新增能力：{offer.added.map(skillLabel).join('、')}。它们不会自动授予，勾选后才生效。</Notice>}
      {offer.removed.length>0&&<Notice>新版本移除了：{offer.removed.map(skillLabel).join('、')}，会同时取消授予。</Notice>}
      <SkillChecks legend="授予能力" skills={target.skills} granted={skills} notes={notes} onToggle={skill=>setSkills(list=>toggleIn(list,skill))}/>
      {offer.priceChanged&&<section className="aw-sheet-section"><h3>报价有调整</h3><p className="aw-price-line"><span className="aw-mono">{priceLabel(pin.billing)} → {priceLabel(target.pricing)}</span></p><Notice>{PRICE_NOTE}</Notice><CheckRow label="我已了解报价调整" checked={ack} onChange={setAck}/></section>}
    </>}
  </Sheet>;
}
