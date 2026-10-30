import React,{useId,useState} from 'react';
import {ChevronRight,Plus} from 'lucide-react';
import {EmptyState} from './parts.jsx';
import {HireSheet} from './hire.jsx';
import {PriceBlock,StarterTile,VersionList} from './market.jsx';
import {CheckRow,ChipGroup,Field,Notice,Sheet} from './sheet.jsx';
import {ALL_RUNTIMES,INPUT_KINDS,INPUT_LABELS,ISSUE_LABELS,OUTPUT_KINDS,OUTPUT_LABELS,PRICE_NOTE,PRICING_KINDS,PRICING_LABELS,STATUS_ACTIONS,STATUS_LABELS,blankStarter,commandError,draftPayload,hireOf,isDirty,mineOf,minorFromYuan,newDraft,publishPlan,toggleIn,toggleSkill,yuanFromMinor} from './catalog.mjs';
import {SKILL_LABELS,skillLabel} from './model.mjs';

const SKILLS=Object.keys(SKILL_LABELS);
const MAX_STARTERS=4;

function TextField({label,hint,value,onChange,max,multiline=false,rows=4,list,disabled}){
  const id=useId(),Tag=multiline?'textarea':'input';
  return <Field label={label} hint={hint} htmlFor={id}><Tag id={id} className="aw-input" value={value} maxLength={max} rows={multiline?rows:undefined} list={list} disabled={disabled} onChange={e=>onChange(e.target.value)}/></Field>;
}

function StatusTag({status}){return <span className="aw-tag" data-status={status}>{STATUS_LABELS[status]}</span>;}

function StudioRow({template,onOpen,index}){
  const {draft,published,stats}=template;
  return <button type="button" className="aw-badge-row" style={{'--i':index}} onClick={onOpen}>
    <span className="aw-badge-row-main">
      <strong>{draft.name||'未命名 Worker'}</strong>
      <small className="aw-by"><StatusTag status={template.status}/> <span className="aw-mono">{published?`v${published.version}`:'未发布'} · 已招募 {stats.hires} · 已验收 {stats.accepted}</span></small>
      {template.hasUnpublishedChanges&&published&&template.status!=='retired'&&<small className="aw-by">有未发布的改动</small>}
    </span>
    <ChevronRight className="aw-chevron" size={16} aria-hidden="true"/>
  </button>;
}

export function StudioScreen({v}){
  const mine=mineOf(v.templates);
  return <>
    <div className="aw-pagehead"><h2>维护者工作台</h2></div>
    <p className="aw-calm aw-lead">把你的做法打包成 Worker：写好岗位指令，选定能力，先用真实任务试运行并验收，再发布。</p>
    <section className="aw-section"><div className="aw-section-head"><h3>我维护的 Worker</h3>{mine.length>0&&<span className="aw-count aw-mono">{mine.length}</span>}</div>
      {mine.length?<div className="aw-list">{mine.map((t,i)=><StudioRow key={t.id} index={i} template={t} onOpen={()=>v.go('editor',t.id)}/>)}</div>
        :<EmptyState title="还没有自己的 Worker" hint="新建 → 招募到项目试运行 → 验收一个真实任务 → 发布 v1。"/>}
    </section>
    <p className="aw-footnote">维护者署名由你填写，DSH 不核验。已发布的版本只出现在当前工作区的招募页。</p>
    <div className="aw-sticky"><button type="button" className="aw-primary" onClick={()=>v.go('editor','new')}><Plus size={16} aria-hidden="true"/>新建 Worker</button></div>
  </>;
}

function StarterEditor({starter,index,skills,disabled,onChange,onRemove}){
  return <div className="aw-starter-edit">
    <div className="aw-starter-edit-head"><strong>预置任务 {index+1}</strong>{!disabled&&<button type="button" className="aw-link" onClick={onRemove}>移除</button>}</div>
    <TextField label="标题" value={starter.title} max={40} disabled={disabled} onChange={title=>onChange({...starter,title})}/>
    <TextField label="任务说明" value={starter.brief} max={2000} multiline rows={3} disabled={disabled} onChange={brief=>onChange({...starter,brief})}/>
    {skills.length?<ChipGroup legend="需要的能力" multiple name={`starter-${index}`} options={skills.map(id=>({id,label:skillLabel(id),disabled}))} value={starter.skills} onChange={id=>onChange({...starter,skills:toggleIn(starter.skills,id)})}/>:<small className="aw-hint">先在上面选择能力。</small>}
  </div>;
}

function PublishSheet({v,template,plan,onClose}){
  const [changelog,setChangelog]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
  async function submit(){
    setBusy(true);setError('');
    try{await v.run('publish_worker_template',{templateId:template.id,changelog:changelog.trim()});setDone(true);}
    catch(e){setError(commandError(e));}finally{setBusy(false);}
  }
  return <Sheet title={done?'已发布':`发布 v${plan.nextVersion}`} onClose={onClose} busy={busy} footer={done
    ?<button type="button" className="aw-primary" onClick={onClose}>完成</button>
    :<button type="button" className="aw-primary" disabled={!changelog.trim()||busy} onClick={()=>void submit()}>{busy?'正在发布…':`发布 v${plan.nextVersion}`}</button>}>
    {error&&<Notice tone="alert">{error}</Notice>}
    {done?<p className="aw-prose">v{plan.nextVersion} 已发布。已招募的 Worker 仍固定在原版本，业主需要自己选择升级。</p>:<>
      <TextField label="这一版改了什么" value={changelog} max={500} multiline rows={3} hint="写给已经招募它的业主看。" onChange={setChangelog}/>
      {plan.added.length>0&&<Notice tone="alert">这一版扩大了权限，新增：{plan.added.map(skillLabel).join('、')}。已招募的 Worker 不会自动获得，业主升级时需要重新授权。</Notice>}
      {plan.priceChanged&&<Notice tone="alert">这一版调整了报价。已招募的业主升级时需要重新确认。</Notice>}
      <Notice>发布后，这个版本会出现在当前工作区的招募页。已发布的版本不能再修改，之后的改动只能发新版本。</Notice>
    </>}
  </Sheet>;
}

const STATUS_COPY=Object.freeze({
  paused:'暂停接单后，招募页仍显示它但不能再招募。已招募的继续可用，进行中的任务不受影响。',
  published:'恢复后，它会重新出现在可招募的状态。',
  retired:'下架不可恢复。招募页不再显示它，你也不能再修改它。已招募的 Worker 继续存在，直到业主自行撤销。',
});
function StatusSheet({v,template,action,onClose}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(){
    setBusy(true);setError('');
    try{await v.run('set_worker_template_status',{templateId:template.id,status:action.to});onClose();}
    catch(e){setError(commandError(e));setBusy(false);}
  }
  const copy=action.to==='retired'&&template.status==='draft'?'放弃后，这个草稿不可恢复，也不会出现在招募页。已在项目里试运行的 Worker 继续存在。':STATUS_COPY[action.to];
  return <Sheet title={action.label} onClose={onClose} busy={busy} footer={<button type="button" className="aw-primary" disabled={busy} onClick={()=>void submit()}>{busy?'正在提交…':`确认${action.label}`}</button>}>
    {error&&<Notice tone="alert">{error}</Notice>}
    <p className="aw-prose">{copy}</p>
  </Sheet>;
}

function PublishPanel({v,template,dirty}){
  const [sheet,setSheet]=useState(null);
  const plan=publishPlan(template),retired=template.status==='retired';
  const trial=hireOf(v.agents,template.id),noTrial=!v.projectId||dirty;
  const proofLine=plan.unproven.length===0
    ?(template.published?'新增的能力都已有被验收的任务。':`已有 ${template.stats.accepted} 个被验收的真实任务。`)
    :(template.published?`新增能力「${plan.unproven.map(skillLabel).join('、')}」还没有被验收的任务。`:'还没有被验收的真实任务。');
  return <section className="aw-section"><div className="aw-section-head"><h3>发布</h3><StatusTag status={template.status}/></div>
    <ul className="aw-todo">
      <li data-ok={plan.issues.length===0||undefined}>{plan.issues.length?`还缺：${plan.issues.map(k=>ISSUE_LABELS[k]).join('、')}`:'必填项已完成'}</li>
      <li data-ok={plan.unproven.length===0||undefined}>{proofLine}</li>
      <li data-ok={template.hasUnpublishedChanges||undefined}>{template.hasUnpublishedChanges?(template.published?'有未发布的改动':'尚未发布'):'没有未发布的改动'}</li>
    </ul>
    {!retired&&<>
      {trial?<Notice>已在当前项目试运行。到「Worker」页查看它的任务，验收后就算数。</Notice>:<Notice>试运行：把这份草稿招募到当前项目，用你自己的真实任务验证。{noTrial?(!v.projectId?'当前会话暂无项目。':'请先保存草稿。'):''}</Notice>}
      <div className="aw-actions">
        {trial?<button type="button" className="aw-secondary" onClick={()=>v.go('worker',trial.id)}>查看试运行的 Worker</button>
          :<button type="button" className="aw-secondary" disabled={noTrial} onClick={()=>setSheet({kind:'trial'})}>试运行</button>}
        <button type="button" className="aw-primary" disabled={!plan.canPublish||dirty} onClick={()=>setSheet({kind:'publish'})}>发布 v{plan.nextVersion}</button>
      </div>
      {dirty&&<small className="aw-hint">有未保存的修改，保存后才能试运行或发布。</small>}
      {!noTrial&&template.draft.starters.length>0&&<><div className="aw-section-head aw-spaced"><h3>用预置任务试运行</h3></div>
        <div className="aw-starters">{template.draft.starters.map(s=><StarterTile key={s.id} starter={s} onOpen={()=>setSheet({kind:trial?'task':'trial',starter:s})}/>)}</div></>}
    </>}
    {template.versions.length>0&&<><div className="aw-section-head aw-spaced"><h3>版本</h3><span className="aw-count aw-mono">{template.versions.length}</span></div><VersionList versions={template.versions}/>
      <div className="aw-section-head aw-spaced"><h3>已发布版本的报价</h3></div><PriceBlock pricing={template.published.pricing}/></>}
    {STATUS_ACTIONS[template.status].length>0&&<div className="aw-actions aw-spaced">{STATUS_ACTIONS[template.status].map(a=><button type="button" key={a.to} className="aw-secondary" onClick={()=>setSheet({kind:'status',action:a})}>{a.label}</button>)}</div>}
    {(sheet?.kind==='trial'||sheet?.kind==='task')&&<HireSheet v={v} template={template} mode={sheet.kind} starter={sheet.starter||null} agent={trial} onClose={()=>setSheet(null)}/>}
    {sheet?.kind==='publish'&&<PublishSheet v={v} template={template} plan={plan} onClose={()=>setSheet(null)}/>}
    {sheet?.kind==='status'&&<StatusSheet v={v} template={template} action={sheet.action} onClose={()=>setSheet(null)}/>}
  </section>;
}

export function EditorScreen({v,id}){
  const template=id==='new'?null:v.templates.find(t=>t.id===id);
  const inherited=mineOf(v.templates)[0]?.draft.maintainerName||'';
  const [draft,setDraft]=useState(()=>template?structuredClone(template.draft):newDraft(inherited));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  if(id!=='new'&&(!template||template.builtin))return <EmptyState title="Worker 已更新" hint="这个 Worker 不在你的工作台中。"/>;
  const locked=template?.status==='retired',saved=template?template.draft:newDraft(inherited),dirty=isDirty(draft,saved);
  const need=[];
  if(!draft.name.trim())need.push('名称');
  if(draft.starters.some(s=>!s.title.trim()||!s.brief.trim()||!s.skills.length))need.push('每个预置任务都要有标题、说明和至少一个能力');
  const set=patch=>setDraft(current=>({...current,...patch}));
  const categories=[...new Set(v.templates.map(t=>t.draft.category).filter(Boolean))];

  async function save(){
    setBusy(true);setError('');
    try{
      const before=new Set(v.templates.map(t=>t.id));
      const next=await v.run('upsert_worker_template',draftPayload(draft,template?.id));
      const list=next.commerceNetwork?.workerTemplates||[];
      const found=template?list.find(t=>t.id===template.id):list.find(t=>!before.has(t.id));
      if(found){setDraft(structuredClone(found.draft));if(!template)v.replace('editor',found.id);}
    }catch(e){setError(commandError(e));}finally{setBusy(false);}
  }

  return <>
    {locked&&<Notice>这个 Worker 已下架，不能再修改。</Notice>}
    {error&&<Notice tone="alert">{error}</Notice>}
    <fieldset className="aw-form" disabled={locked||busy}>
      <section className="aw-section aw-first"><div className="aw-section-head"><h3>基本信息</h3></div>
        <TextField label="名称" value={draft.name} max={40} onChange={name=>set({name})}/>
        <TextField label="一句话介绍" value={draft.tagline} max={80} hint="招募页的列表里只显示这一句。" onChange={tagline=>set({tagline})}/>
        <TextField label="分类" value={draft.category} max={20} list="aw-categories" onChange={category=>set({category})}/>
        <datalist id="aw-categories">{categories.map(c=><option key={c} value={c}/>)}</datalist>
        <TextField label="维护者署名" value={draft.maintainerName} max={40} hint="由你自行填写，DSH 不核验。" onChange={maintainerName=>set({maintainerName})}/>
      </section>
      <section className="aw-section"><div className="aw-section-head"><h3>能力与范围</h3></div>
        <ChipGroup legend="可运行于" multiple options={ALL_RUNTIMES.map(r=>({id:r.id,label:r.name}))} value={draft.runsOn} onChange={rid=>set({runsOn:toggleIn(draft.runsOn,rid)})}/>
        <fieldset className="aw-checks"><legend className="aw-label">能力（只能从 DSH 已支持的动作里选）</legend>
          <div className="aw-check-list">{SKILLS.map(skill=><CheckRow key={skill} label={SKILL_LABELS[skill]} checked={draft.skills.includes(skill)} onChange={()=>setDraft(current=>toggleSkill(current,skill))}/>)}</div></fieldset>
        <ChipGroup legend="接收" multiple options={INPUT_KINDS.map(k=>({id:k,label:INPUT_LABELS[k]}))} value={draft.inputs} onChange={k=>set({inputs:toggleIn(draft.inputs,k)})}/>
        <ChipGroup legend="交付" multiple options={OUTPUT_KINDS.map(k=>({id:k,label:OUTPUT_LABELS[k]}))} value={draft.outputs} onChange={k=>set({outputs:toggleIn(draft.outputs,k)})}/>
      </section>
      <section className="aw-section"><div className="aw-section-head"><h3>工作包指令</h3></div>
        <TextField label="写给 Agent 的岗位说明" value={draft.instructions} max={8000} multiline rows={8} hint="做什么、怎么交付、不做什么。它会固定在每个版本里，随任务一起发给业主选择的 Agent。" onChange={instructions=>set({instructions})}/>
      </section>
      <section className="aw-section"><div className="aw-section-head"><h3>预置任务</h3><span className="aw-count aw-mono">{draft.starters.length}/{MAX_STARTERS}</span></div>
        {draft.starters.map((s,i)=><StarterEditor key={s.id||`new-${i}`} starter={s} index={i} skills={draft.skills} disabled={locked||busy} onChange={next=>set({starters:draft.starters.map((x,j)=>j===i?next:x)})} onRemove={()=>set({starters:draft.starters.filter((_,j)=>j!==i)})}/>)}
        {draft.starters.length<MAX_STARTERS&&<button type="button" className="aw-secondary aw-add" onClick={()=>set({starters:[...draft.starters,{...blankStarter(),skills:draft.skills.slice(0,1)}]})}><Plus size={16} aria-hidden="true"/>添加预置任务</button>}
      </section>
      <section className="aw-section"><div className="aw-section-head"><h3>报价提案</h3></div>
        <ChipGroup legend="计费方式" options={PRICING_KINDS.map(k=>({id:k,label:PRICING_LABELS[k]}))} value={draft.pricing.kind} onChange={kind=>set({pricing:{kind,amountMinor:kind==='free'?0:draft.pricing.amountMinor,currency:'CNY'}})}/>
        {draft.pricing.kind!=='free'&&<TextField label={draft.pricing.kind==='subscription'?'每月价格（元）':'每次验收价格（元）'} value={yuanFromMinor(draft.pricing.amountMinor)} max={12} onChange={value=>set({pricing:{...draft.pricing,amountMinor:minorFromYuan(value)}})}/>}
        <Notice>{PRICE_NOTE}</Notice>
        <TextField label="响应时间（自述）" value={draft.declared.responseTime} max={40} hint="例如「1 个工作日」。这是你的自述，不是 DSH 的承诺。" onChange={responseTime=>set({declared:{responseTime}})}/>
      </section>
    </fieldset>
    {need.length>0&&<Notice>保存前还需要：{need.join('；')}。</Notice>}
    {!locked&&<div className="aw-sticky"><button type="button" className="aw-primary" disabled={!dirty||need.length>0||busy} onClick={()=>void save()}>{busy?'正在保存…':template?'保存草稿':'创建草稿'}</button></div>}
    {template&&<PublishPanel v={v} template={template} dirty={dirty}/>}
  </>;
}
