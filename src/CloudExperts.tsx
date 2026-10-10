import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, requestId } from './api';
import { Icon } from './icons';
import type { IconName } from './icons';

type Role = 'admin' | 'operator' | 'viewer';
type Skill = { id: string; title: string };
type WorkerOption = { serviceId: string; workerId: string; name: string };
type ExpertTemplate = {
  id: string; name: string; title: string; category: string; summary: string;
  initials: string; accent: string; serviceIds: string[]; skills: string[];
  result: string; methods: string[]; connectionRequired: string; workerOptions: WorkerOption[];
};
type TeamTemplate = { id: string; title: string; category: string; summary: string; members: string[] };
type Hired = {
  id: string; templateId: string; alias: string; mission: string; serviceId: string | null;
  workerId: string | null; skills: string[]; maxCredits: number; revision: number;
  runnerStatus: 'registered' | 'not_connected'; runtimeReady: boolean;
  template: ExpertTemplate; createdAt: string;
};
type Team = {
  id: string; templateId: string; name: string; mission: string; leadId: string;
  memberIds: string[]; budgetCredits: number; taskCeilingCredits: number;
  registeredMembers: number; runAvailable: false; revision: number;
  readiness: string; members: Hired[];
};
type Plan = {
  mission: string; runnable: false; planningOnly: boolean; projectBudgetCredits: number;
  steps: { expertId: string; role: string; title: string; serviceId: string | null; output: string;
    taskCeilingCredits: number; runnerStatus: string; approvalRequired: true }[];
  blockers: string[];
};
type Catalog = { experts: ExpertTemplate[]; teams: TeamTemplate[]; skills: Skill[] };
type ExpertDraft = { alias: string; mission: string; serviceId: string; workerId: string; skills: string[]; maxCredits: string; confirmed: boolean };
type TeamDraft = { templateId: string; name: string; mission: string; leadId: string; memberIds: string[]; budgetCredits: string; taskCeilingCredits: string };

const serviceLabels: Record<string,string> = {
  'buyer-discovery': '经销商研究', 'channel-validation': '渠道与市场验证', 'sales-assets': '销售素材',
};
const accents: Record<string, string> = {
  violet: 'ce-violet', blue: 'ce-blue', orange: 'ce-orange', teal: 'ce-teal',
  pink: 'ce-pink', fuchsia: 'ce-fuchsia', green: 'ce-green', slate: 'ce-slate',
};
const expertIcons: Record<string,IconName> = {
  'growth-lead': 'goals', 'buyer-hunter': 'people', 'market-analyst': 'activity',
  'channel-planner': 'work', 'sales-specialist': 'chat', 'brand-designer': 'palette',
  'commerce-tester': 'laptop', 'rfq-analyst': 'library',
};
const emptyCatalog: Catalog = { experts: [], teams: [], skills: [] };
const initialDraft = (template: ExpertTemplate): ExpertDraft => ({
  alias: template.name,
  mission: template.summary,
  serviceId: template.serviceIds[0] || '',
  workerId: '',
  skills: template.skills,
  maxCredits: '20', confirmed: false,
});
const initialTeam = (template: TeamTemplate): TeamDraft => ({
  templateId: template.id, name: template.title,
  mission: template.summary, leadId: '', memberIds: [],
  budgetCredits: '120', taskCeilingCredits: '20',
});
const err = (value: unknown) => value instanceof Error ? value.message : '操作失败，请检查企业服务器。';
function Avatar({ label, accent = 'violet', size = 'normal' }: { label: string; accent?: string; size?: 'small'|'normal'|'large' }) {
  return <span className={'ce-avatar '+(accents[accent] || 'ce-violet')+' ce-avatar-'+size}>{label}</span>;
}
function availability(connected: boolean) {
  return <span className={'ce-availability'+(connected?' connected':'')}><i />{connected?'已登记执行器':'待绑定云执行器'}</span>;
}

export default function CloudExperts({ role, onOpenServices }: { role: Role; onOpenServices: () => void }) {
  const [catalog,setCatalog] = useState<Catalog>(emptyCatalog);
  const [hired,setHired] = useState<Hired[]>([]);
  const [teams,setTeams] = useState<Team[]>([]);
  const [tab,setTab] = useState<'market'|'mine'|'teams'>('market');
  const [category,setCategory] = useState('全部');
  const [search,setSearch] = useState('');
  const [selectedTemplate,setSelectedTemplate] = useState<string|null>(null);
  const [editingExpert,setEditingExpert] = useState<string|null>(null);
  const [draft,setDraft] = useState<ExpertDraft|null>(null);
  const [teamDraft,setTeamDraft] = useState<TeamDraft|null>(null);
  const [teamEditing,setTeamEditing] = useState<string|null>(null);
  const [plan,setPlan] = useState<Plan|null>(null);
  const [planName,setPlanName] = useState('');
  const [delegationTarget,setDelegationTarget] = useState<string|null>(null);
  const [taskDraft,setTaskDraft] = useState({product:'',market:'美国',objective:'',budget:'20',deadline:'',confirmed:false});
  const delegationId = useRef(requestId());
  const [busy,setBusy] = useState(false);
  const [loaded,setLoaded] = useState(false);
  const [alert,setAlert] = useState<{text:string;error:boolean}|null>(null);
  const hireId = useRef(requestId());
  const teamId = useRef(requestId());
  const operator = role === 'admin';

  const load = useCallback(async () => {
    const [available,experts,groups] = await Promise.all([
      api<Catalog>('/cloud-expert-catalog'),
      api<{experts:Hired[]}>('/cloud-experts'),
      api<{teams:Team[]}>('/cloud-teams'),
    ]);
    setCatalog(available);setHired(experts.experts);setTeams(groups.teams);setLoaded(true);
  },[]);
  useEffect(()=>{
    let active=true;
    void load().catch(e=>{if(active)setAlert({text:err(e),error:true});});
    return ()=>{active=false;};
  },[load]);
  const shown = useMemo(()=>catalog.experts.filter(template=>
    (category==='全部' || template.category===category) &&
    (!search.trim() || (template.name+' '+template.title+' '+template.summary).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  ),[catalog.experts,category,search]);
  const connected = hired.filter(x=>x.runtimeReady).length;
  const categories = ['全部',...new Set(catalog.experts.map(x=>x.category))];
  const editing = editingExpert ? hired.find(x=>x.id===editingExpert) : undefined;
  const currentTemplate = catalog.experts.find(x=>x.id===selectedTemplate) || editing?.template;
  const alreadyHired = new Set(hired.map(x=>x.templateId));
  const selectedTeamTemplate = teamDraft && catalog.teams.find(x=>x.id===teamDraft.templateId);
  const activeTeam = teamEditing && teams.find(x=>x.id===teamEditing);
  const delegatedExpert = hired.find(x=>x.id===delegationTarget);
  const selectedWorkers = currentTemplate?.workerOptions.filter(option=>option.serviceId===draft?.serviceId) || [];

  useEffect(()=>{
    if (!selectedTemplate && !teamDraft && !plan && !editingExpert && !delegationTarget) return;
    const old=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const onKey=(e:KeyboardEvent)=>{
      if(e.key==='Escape'&&!busy){setSelectedTemplate(null);setEditingExpert(null);setDraft(null);setTeamDraft(null);setTeamEditing(null);setPlan(null);setDelegationTarget(null);}
    };
    window.addEventListener('keydown',onKey);
    return ()=>{document.body.style.overflow=old;window.removeEventListener('keydown',onKey);};
  },[selectedTemplate,teamDraft,plan,editingExpert,delegationTarget,busy]);

  function openExpert(template: ExpertTemplate) {
    setSelectedTemplate(template.id);setEditingExpert(null);setDraft(initialDraft(template));
    hireId.current=requestId();setAlert(null);
  }
  function editExpert(expert: Hired) {
    setEditingExpert(expert.id);setSelectedTemplate(null);
    setDraft({alias:expert.alias,mission:expert.mission,serviceId:expert.serviceId||'',workerId:expert.workerId||'',
      skills:[...expert.skills],maxCredits:String(expert.maxCredits),confirmed:true});
    setAlert(null);
  }
  function openTeam(template?: TeamTemplate) {
    const selected=template||catalog.teams[0];
    if(!selected)return;
    const staff=selected.members.map(tid=>hired.find(x=>x.templateId===tid)).filter((x):x is Hired=>!!x);
    setTeamEditing(null);setSelectedTemplate(null);setEditingExpert(null);
    setTeamDraft({...initialTeam(selected),
      leadId:staff[0]?.id||hired[0]?.id||'',
      memberIds:(staff.length>1?staff.slice(1):hired.slice(1,4)).map(x=>x.id)});
    teamId.current=requestId();setAlert(null);
  }
  function editTeam(team:Team){
    setTeamEditing(team.id);
    setTeamDraft({templateId:team.templateId,name:team.name,mission:team.mission,
      leadId:team.leadId,memberIds:[...team.memberIds],
      budgetCredits:String(team.budgetCredits),taskCeilingCredits:String(team.taskCeilingCredits)});
    setAlert(null);
  }
  function close(){setSelectedTemplate(null);setEditingExpert(null);setDraft(null);setTeamDraft(null);setTeamEditing(null);setPlan(null);setDelegationTarget(null);}

  async function saveExpert(event:FormEvent) {
    event.preventDefault();if(!operator||!draft||!currentTemplate||busy)return;
    setBusy(true);
    try{
      const input={alias:draft.alias,mission:draft.mission,serviceId:draft.serviceId||null,
        workerId:draft.workerId||null,skills:draft.skills,maxCredits:Number(draft.maxCredits)};
      if(editing){
        await api('/cloud-experts/'+editing.id,'PATCH',{...input,expectedRevision:editing.revision});
      }else{
        if(!draft.confirmed)throw new Error('请确认公开资料边界和权限设置。');
        await api('/cloud-experts','POST',{...input,templateId:currentTemplate.id,publicDataConfirmed:true,requestId:hireId.current});
      }
      await load();close();setTab('mine');
      setAlert({text:editing?'专家岗位配置已更新。':'专家已加入企业团队。未绑定云执行器时不会自动执行任务。',error:false});
    }catch(e){setAlert({text:err(e),error:true});}
    finally{setBusy(false);}
  }
  async function saveTeam(event:FormEvent) {
    event.preventDefault();if(!operator||!teamDraft||busy)return;
    setBusy(true);
    try{
      const input={name:teamDraft.name,mission:teamDraft.mission,leadId:teamDraft.leadId,
        memberIds:teamDraft.memberIds,budgetCredits:Number(teamDraft.budgetCredits),
        taskCeilingCredits:Number(teamDraft.taskCeilingCredits)};
      if(activeTeam)await api('/cloud-teams/'+activeTeam.id,'PATCH',{...input,expectedRevision:activeTeam.revision});
      else await api('/cloud-teams','POST',{...input,templateId:teamDraft.templateId,requestId:teamId.current});
      await load();close();setTab('teams');
      setAlert({text:'团队编制已保存。团队协作需在受审核运行引擎接通后才可启动。',error:false});
    }catch(e){setAlert({text:err(e),error:true});}
    finally{setBusy(false);}
  }
  function startDelegation(expert:Hired) {
    if(!expert.runtimeReady)return;
    delegationId.current=requestId();
    const due=new Date();due.setDate(due.getDate()+7);
    setTaskDraft({product:'',market:'美国',objective:expert.mission,budget:String(expert.maxCredits),
      deadline:due.toISOString().slice(0,10),confirmed:false});
    setDelegationTarget(expert.id);
  }
  async function sendDelegation(event:FormEvent) {
    event.preventDefault();
    if(!operator||!delegatedExpert||!taskDraft.confirmed||busy)return;
    setBusy(true);
    try {
      const deadlineAt=new Date(taskDraft.deadline+'T18:00:00').toISOString();
      await api('/cloud-experts/'+delegatedExpert.id+'/delegate','POST',{
        product:taskDraft.product,market:taskDraft.market,objective:taskDraft.objective,
        budgetCredits:Number(taskDraft.budget),deadlineAt,
        publicDataConfirmed:true,requestId:delegationId.current,
      });
      await load();close();setAlert({text:'任务单已创建，等待管理员逐项审核后才允许提交给云端执行器。',error:false});
      onOpenServices();
    }catch(e){setAlert({text:err(e),error:true});}
    finally{setBusy(false);}
  }
  async function viewPlan(team:Team){
    setBusy(true);
    try{
      const response=await api<{plan:Plan}>('/cloud-teams/'+team.id+'/plan');
      setPlan(response.plan);setPlanName(team.name);
    }catch(e){setAlert({text:err(e),error:true});}
    finally{setBusy(false);}
  }

  return <div className="ce-page">
    <div className="ce-topbar">
      <div className="ce-breadcrumb"><span>WORKSPACE</span><Icon name="chevron" size={12}/><strong>云端专家团队</strong></div>
      <div className="ce-top-actions"><span className="ce-connector-status"><i/>{connected} 位已绑定执行器</span><button onClick={onOpenServices} type="button" className="ce-link-button">业务任务 <Icon name="chevron" size={13}/></button></div>
    </div>
    <section className="ce-hero">
      <div className="ce-hero-text">
        <span className="ce-eyebrow"><span className="ce-eyebrow-point"/> YOUR CLOUD WORKFORCE</span>
        <h1>你的 AI 专家团队<span className="ce-accent-dot">.</span></h1>
        <p>像组织真实团队一样，挑选专家、配置岗位、分配预算与权限。每位专家都可以绑定经过审核的云端 AI Worker。</p>
        <div className="ce-hero-buttons">
          <button className="ce-primary" type="button" onClick={()=>{setTab('market');document.getElementById('ce-expert-catalog')?.scrollIntoView({behavior:'smooth'});}}>浏览专家 <Icon name="arrow" size={16}/></button>
          <button className="ce-secondary" type="button" onClick={()=>openTeam()}>组建专家团 <Icon name="plus" size={16}/></button>
        </div>
      </div>
      <div className="ce-hero-art" aria-hidden="true">
        <div className="ce-hero-orbit ce-hero-orbit-one"/>
        <div className="ce-hero-orbit ce-hero-orbit-two"/>
        <div className="ce-hero-avatar ce-ha-one"><Avatar label="GL" accent="violet" size="large"/></div>
        <div className="ce-hero-avatar ce-ha-two"><Avatar label="BD" accent="blue" /></div>
        <div className="ce-hero-avatar ce-ha-three"><Avatar label="MI" accent="orange" /></div>
        <div className="ce-hero-avatar ce-ha-four"><Avatar label="BR" accent="fuchsia" /></div>
        <span className="ce-hero-caption">ONE WORKSPACE · MANY EXPERTS</span>
      </div>
    </section>

    <div className="ce-metrics">
      <div><Icon name="people" size={17}/><strong>{hired.length}</strong><span>已配置专家</span></div>
      <div><Icon name="work" size={17}/><strong>{teams.length}</strong><span>我的专家团</span></div>
      <div><Icon name="bolt" size={17}/><strong>{connected}</strong><span>已登记执行者</span></div>
      <p>岗位配置与云端执行分离。未连接的专家不会产生真实运行费用。</p>
    </div>

    {alert && <div className={'ce-alert'+(alert.error?' error':'')} role={alert.error?'alert':'status'}><Icon name={alert.error?'info':'check'} size={18}/><span>{alert.text}</span><button type="button" onClick={()=>setAlert(null)} aria-label="关闭提示"><Icon name="close" size={16}/></button></div>}

    <div className="ce-section-title"><div><span className="ce-eyebrow">CURATED TEAMS</span><h2>从一个专家团开始</h2><p>先选定岗位组合，再决定每位专家使用哪个云执行器。</p></div><button className="ce-text-action" type="button" onClick={()=>setTab('teams')}>查看我的团队 <Icon name="chevron" size={14}/></button></div>
    <div className="ce-team-presets">
      {catalog.teams.map((t,index)=><button className="ce-team-card" key={t.id} type="button" onClick={()=>openTeam(t)}>
        <span className="ce-team-top"><span className="ce-team-index">TEAM 0{index+1}</span><span className="ce-team-category">{t.category}</span></span>
        <strong>{t.title}</strong><p>{t.summary}</p>
        <span className="ce-team-face-list">{t.members.map(id=>{const x=catalog.experts.find(e=>e.id===id);return x&&<Avatar key={id} label={x.initials} accent={x.accent} size="small"/>;})}</span>
        <span className="ce-team-end"><small>{t.members.length} 个专业岗位</small><span>选择团队 <Icon name="arrow" size={15}/></span></span>
      </button>)}
    </div>

    <section id="ce-expert-catalog" className="ce-market">
      <div className="ce-market-tabs" role="tablist" aria-label="专家板块">
        <button role="tab" aria-selected={tab==='market'} className={tab==='market'?'selected':''} onClick={()=>setTab('market')}>专家市场 <span>{catalog.experts.length}</span></button>
        <button role="tab" aria-selected={tab==='mine'} className={tab==='mine'?'selected':''} onClick={()=>setTab('mine')}>我的专家 <span>{hired.length}</span></button>
        <button role="tab" aria-selected={tab==='teams'} className={tab==='teams'?'selected':''} onClick={()=>setTab('teams')}>我的团队 <span>{teams.length}</span></button>
      </div>
      {tab==='market'&&<>
        <div className="ce-market-heading"><div><h2>发现适合你的专家</h2><p>先聘请合适的 AI 岗位，再根据企业目标配置执行范围。</p></div>
          <label className="ce-search"><Icon name="search" size={17}/><input aria-label="搜索专家" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索专家与职能..."/></label>
        </div>
        <div className="ce-filters">{categories.map(x=><button key={x} className={category===x?'active':''} onClick={()=>setCategory(x)}>{x}</button>)}</div>
        <div className="ce-expert-grid">
          {shown.map(template=><article className="ce-expert-card" key={template.id}>
            <div className="ce-expert-card-head"><Avatar label={template.initials} accent={template.accent}/><span className="ce-role-pill">{template.category}</span></div>
            <h3>{template.name}</h3><span className="ce-role-name">{template.title}</span><p>{template.summary}</p>
            <div className="ce-skill-chips">{template.skills.slice(0,3).map(skill=><span key={skill}>{catalog.skills.find(x=>x.id===skill)?.title||skill}</span>)}</div>
            <div className="ce-card-foot"><span>{alreadyHired.has(template.id)?'已加入专家配置':'可创建岗位配置'}</span><button type="button" onClick={()=>openExpert(template)} disabled={!operator}>配置专家 <Icon name="chevron" size={15}/></button></div>
          </article>)}
        </div>
        {shown.length===0&&<div className="ce-empty"><Icon name="search" size={27}/><h3>没有匹配的专家</h3><p>换个关键词或选择其他领域。</p></div>}
      </>}
      {tab==='mine'&&<div className="ce-owned">
        <div className="ce-section-title ce-owned-title"><div><h2>已聘请的专家</h2><p>每位专家的岗位、工作范围、费用上限都可以单独维护。</p></div><button className="ce-primary ce-small" onClick={()=>setTab('market')}><Icon name="plus" size={15}/>添加专家</button></div>
        {!hired.length?<div className="ce-empty"><Icon name="people" size={30}/><h3>先聘请第一位云专家</h3><p>专家本身是岗位配置；需要绑定经过审核的云 Worker 才能真正执行。</p><button className="ce-primary" onClick={()=>setTab('market')}>前往专家市场</button></div>:
          <div className="ce-hired-grid">{hired.map(item=><article className="ce-hired-card" key={item.id}>
            <div className="ce-hired-top"><Avatar label={item.template.initials} accent={item.template.accent}/>{availability(item.runtimeReady)}</div>
            <h3>{item.alias}</h3><p>{item.mission}</p><dl><div><dt>任务上限</dt><dd>{item.maxCredits} Credits</dd></div><div><dt>专业服务</dt><dd>{item.serviceId?serviceLabels[item.serviceId]: '需私有环境'}</dd></div></dl>
            {item.runtimeReady && <button className="ce-primary" type="button" onClick={()=>startDelegation(item)} disabled={!operator}>委托此专家 <Icon name="arrow" size={14}/></button>}
            <button className="ce-outline" onClick={()=>editExpert(item)} disabled={!operator}>配置岗位 <Icon name="chevron" size={15}/></button>
          </article>)}</div>}
      </div>}
      {tab==='teams'&&<div className="ce-owned">
        <div className="ce-section-title ce-owned-title"><div><h2>我的专家团队</h2><p>定义总控专家、协作成员、项目预算与工作分工。</p></div><button className="ce-primary ce-small" onClick={()=>openTeam()} disabled={!operator}><Icon name="plus" size={15}/>新建专家团</button></div>
        {!teams.length?<div className="ce-empty"><Icon name="work" size={29}/><h3>你的第一支专家团还未建立</h3><p>先在专家市场配置岗位，再把专家加入同一个项目。</p><button className="ce-primary" onClick={()=>openTeam()}>选择团队模板</button></div>:
          <div className="ce-myteams">{teams.map(team=><article className="ce-myteam" key={team.id}>
            <div className="ce-myteam-head"><span className="ce-role-pill">企业专家团队</span><span className="ce-availability"><i/>待接入协作引擎</span></div>
            <h3>{team.name}</h3><p>{team.mission}</p>
            <div className="ce-team-members">{team.members.map((member,i)=><div key={member.id}><Avatar label={member.template.initials} accent={member.template.accent} size="small"/><span>{member.alias}</span><small>{i===0?'总控':'成员'}</small></div>)}</div>
            <div className="ce-myteam-foot"><span>总预算 {team.budgetCredits} Credits · {team.registeredMembers}/{team.members.length} 已登记</span>
              <div><button onClick={()=>editTeam(team)} disabled={!operator}>编辑</button><button onClick={()=>void viewPlan(team)}>查看分工 <Icon name="chevron" size={14}/></button></div>
            </div>
          </article>)}</div>}
      </div>}
    </section>
    <div className="ce-safety"><Icon name="shield" size={18}/><span>企业保密资料不自动交给外部专家。Skill 是能力配置，接入执行器需独立审查；团队 DAG、外部联系和付费动作均需明确授权。</span></div>

    {draft && currentTemplate&&<div className="ce-overlay" role="presentation" onClick={close}>
      <aside className="ce-drawer" role="dialog" aria-modal="true" aria-labelledby="ce-expert-title" onClick={e=>e.stopPropagation()}>
        <div className="ce-drawer-head"><span>EXPERT CONFIGURATION</span><button onClick={close} type="button" aria-label="关闭"><Icon name="close" size={19}/></button></div>
        <div className="ce-drawer-body">
          <div className="ce-profile"><Avatar label={currentTemplate.initials} accent={currentTemplate.accent} size="large"/><div><span className="ce-eyebrow">CLOUD EXPERT</span><h2 id="ce-expert-title">{currentTemplate.name}</h2><p>{currentTemplate.title}</p></div></div>
          <p className="ce-profile-summary">{currentTemplate.summary}</p>
          <form id="ce-expert-form" className="ce-form" onSubmit={e=>void saveExpert(e)}>
            <label>岗位名称<input required maxLength={64} value={draft.alias} onChange={e=>setDraft({...draft,alias:e.target.value})}/></label>
            <label>专家职责与工作要求<textarea required rows={4} maxLength={1800} value={draft.mission} onChange={e=>setDraft({...draft,mission:e.target.value})}/></label>
            <div className="ce-form-section"><h3>1. 专业能力 <small>岗位技能标签，非直接工具授权</small></h3><div className="ce-check-group">{currentTemplate.skills.map(id=><label className="ce-check" key={id}><input type="checkbox" checked={draft.skills.includes(id)} onChange={e=>setDraft({...draft,skills:e.target.checked?[...draft.skills,id]:draft.skills.filter(x=>x!==id)})}/>{catalog.skills.find(x=>x.id===id)?.title||id}</label>)}</div></div>
            <div className="ce-form-section"><h3>2. 云端执行器</h3><label>执行任务类型<select value={draft.serviceId} onChange={e=>setDraft({...draft,serviceId:e.target.value,workerId:''})}>
              {!currentTemplate.serviceIds.length&&<option value="">需要私有数据通道（当前不可执行）</option>}
              {currentTemplate.serviceIds.map(x=><option key={x} value={x}>{serviceLabels[x]||x}</option>)}
            </select></label>
              <label>绑定已审核云 Worker<select value={draft.workerId} onChange={e=>setDraft({...draft,workerId:e.target.value})}><option value="">暂不绑定 · 保存岗位配置</option>{selectedWorkers.map(option=><option value={option.workerId} key={option.workerId}>{option.name}</option>)}</select></label>
              <p className="ce-form-help">未在受审核执行器清单中登记的 Muse、Grokbot 或 Dot 不能直接上线。这里不接受任意 Token 或执行地址。</p>
            </div>
            <div className="ce-form-section"><h3>3. 预算与权限</h3><label>单次任务预算上限 · Credits<input type="number" required min={1} max={10000} value={draft.maxCredits} onChange={e=>setDraft({...draft,maxCredits:e.target.value})}/></label>
              <div className="ce-permission-info"><Icon name="shield" size={17}/><span>仅公开研究、只读与草稿能力；涉及账号操作、发送邮件、客户私密资料和支付必须另行授权。</span></div>
            </div>
            {!editing&&<label className="ce-confirm"><input type="checkbox" checked={draft.confirmed} onChange={e=>setDraft({...draft,confirmed:e.target.checked})}/>我确认只配置公开资料处理范围，并理解保存专家不等于启动远程执行。</label>}
          </form>
        </div>
        <div className="ce-drawer-bottom"><span>{selectedWorkers.length?'可绑定已审核执行者':'无可用执行器，仍可保存岗位'}</span><button type="submit" form="ce-expert-form" className="ce-primary" disabled={busy||!operator||(!editing&&!draft.confirmed)}>{busy?'正在保存':editing?'保存专家配置':'聘请并配置专家'}<Icon name="chevron" size={16}/></button></div>
      </aside>
    </div>}

    {teamDraft&&selectedTeamTemplate&&<div className="ce-overlay" role="presentation" onClick={close}>
      <aside className="ce-drawer ce-team-drawer" role="dialog" aria-modal="true" aria-labelledby="ce-team-title" onClick={e=>e.stopPropagation()}>
        <div className="ce-drawer-head"><span>BUILD YOUR TEAM</span><button onClick={close} type="button" aria-label="关闭"><Icon name="close" size={19}/></button></div>
        <div className="ce-drawer-body">
          <span className="ce-eyebrow">MULTI-EXPERT TEAM</span><h2 id="ce-team-title">配置云端专家团</h2><p className="ce-profile-summary">指定总控和成员，团队配置可保存，但不会自动创建付费远程任务。</p>
          <form className="ce-form" id="ce-team-form" onSubmit={e=>void saveTeam(e)}>
            <label>专家团模板<select value={teamDraft.templateId} onChange={e=>{const next=catalog.teams.find(x=>x.id===e.target.value);if(next)setTeamDraft(initialTeam(next));}}>{catalog.teams.map(x=><option value={x.id} key={x.id}>{x.title}</option>)}</select></label>
            <label>团队名称<input value={teamDraft.name} required maxLength={90} onChange={e=>setTeamDraft({...teamDraft,name:e.target.value})}/></label>
            <label>团队最高作战指令<textarea value={teamDraft.mission} rows={4} required maxLength={1800} onChange={e=>setTeamDraft({...teamDraft,mission:e.target.value})}/></label>
            <div className="ce-form-section"><h3>1. 设定总控专家</h3><label>团队负责人<select value={teamDraft.leadId} required onChange={e=>setTeamDraft({...teamDraft,leadId:e.target.value,memberIds:teamDraft.memberIds.filter(id=>id!==e.target.value)})}><option value="">选择总控专家</option>{hired.map(x=><option key={x.id} value={x.id}>{x.alias}</option>)}</select></label></div>
            <div className="ce-form-section"><h3>2. 分配专家成员 <small>{teamDraft.memberIds.length} / 5</small></h3>
              <div className="ce-team-picker">{hired.filter(x=>x.id!==teamDraft.leadId).map(item=><label key={item.id} className="ce-picker-row"><input type="checkbox" checked={teamDraft.memberIds.includes(item.id)} onChange={e=>setTeamDraft({...teamDraft,memberIds:e.target.checked?[...teamDraft.memberIds,item.id]:teamDraft.memberIds.filter(x=>x!==item.id)})} disabled={!teamDraft.memberIds.includes(item.id)&&teamDraft.memberIds.length>=5}/><Avatar label={item.template.initials} accent={item.template.accent} size="small"/><span><strong>{item.alias}</strong><small>{item.runtimeReady?'已登记执行器':'待绑定云执行器'}</small></span></label>)}</div>
              {hired.length<2&&<div className="ce-missing-staff"><Icon name="info" size={17}/><span>当前岗位不足两人。请先到专家市场配置至少两位专家。</span><button type="button" onClick={()=>{close();setTab('market');}}>选择专家</button></div>}
            </div>
            <div className="ce-form-section"><h3>3. 项目预算</h3><div className="ce-two-columns"><label>项目总预算 · Credits<input type="number" min={1} max={100000} required value={teamDraft.budgetCredits} onChange={e=>setTeamDraft({...teamDraft,budgetCredits:e.target.value})}/></label>
            <label>单任务上限 · Credits<input type="number" min={1} max={10000} required value={teamDraft.taskCeilingCredits} onChange={e=>setTeamDraft({...teamDraft,taskCeilingCredits:e.target.value})}/></label></div>
            <div className="ce-permission-info"><Icon name="shield" size={17}/><span>队长可创建分工计划，但自动协同执行要等原生 Harness DAG 绑定后再独立授权。</span></div></div>
          </form>
        </div>
        <div className="ce-drawer-bottom"><span>{teamDraft.memberIds.length+Number(!!teamDraft.leadId)} 人编制 · 未自动运行</span><button type="submit" form="ce-team-form" className="ce-primary" disabled={busy||!operator||!teamDraft.leadId||teamDraft.memberIds.length<1}>{busy?'保存中':activeTeam?'保存团队配置':'创建专家团队'}<Icon name="chevron" size={15}/></button></div>
      </aside>
    </div>}

    {delegatedExpert&&<div className="ce-overlay" role="presentation" onClick={close}>
      <aside className="ce-drawer" role="dialog" aria-modal="true" aria-labelledby="ce-delegate-title" onClick={e=>e.stopPropagation()}>
        <div className="ce-drawer-head"><span>DELEGATE TO VERIFIED WORKER</span><button onClick={close} type="button" aria-label="关闭"><Icon name="close" size={19}/></button></div>
        <div className="ce-drawer-body"><span className="ce-eyebrow">APPROVAL FIRST</span><h2 id="ce-delegate-title">委托 {delegatedExpert.alias}</h2>
          <p className="ce-profile-summary">这一步仅创建已有 Worker 任务单；管理员还必须单独批准预算和委托范围，才会发生外部执行。</p>
          <form id="ce-delegate-form" className="ce-form" onSubmit={e=>void sendDelegation(e)}>
            <label>产品或服务<input required maxLength={240} value={taskDraft.product} onChange={e=>setTaskDraft({...taskDraft,product:e.target.value})} placeholder="例如：印花粘胶面料"/></label>
            <label>目标市场<input required maxLength={100} value={taskDraft.market} onChange={e=>setTaskDraft({...taskDraft,market:e.target.value})}/></label>
            <label>期望交付<textarea rows={4} required maxLength={2500} value={taskDraft.objective} onChange={e=>setTaskDraft({...taskDraft,objective:e.target.value})}/></label>
            <div className="ce-two-columns"><label>预算上限 · Credits<input required type="number" min={1} max={delegatedExpert.maxCredits} value={taskDraft.budget} onChange={e=>setTaskDraft({...taskDraft,budget:e.target.value})}/></label>
              <label>截止日期<input required type="date" value={taskDraft.deadline} onChange={e=>setTaskDraft({...taskDraft,deadline:e.target.value})}/></label></div>
            <div className="ce-permission-info"><Icon name="shield" size={17}/><span>执行者：{delegatedExpert.workerId} · 单次额度不得超出专家岗位上限。无企业保密文件、无自动消息发送、无支付动作。</span></div>
            <label className="ce-confirm"><input type="checkbox" checked={taskDraft.confirmed} onChange={e=>setTaskDraft({...taskDraft,confirmed:e.target.checked})}/>我确认这些任务信息可共享给受审核的外部执行者，并理解后续仍需管理员独立审批。</label>
          </form>
        </div>
        <div className="ce-drawer-bottom"><span>尚不触发远程执行或费用</span><button className="ce-primary" type="submit" form="ce-delegate-form" disabled={!operator||busy||!taskDraft.confirmed}>创建待审批任务单 <Icon name="chevron" size={15}/></button></div>
      </aside>
    </div>}
    {plan&&<div className="ce-overlay" role="presentation" onClick={close}>
      <aside className="ce-drawer" role="dialog" aria-modal="true" aria-labelledby="ce-plan-title" onClick={e=>e.stopPropagation()}>
        <div className="ce-drawer-head"><span>TEAM COLLABORATION PLAN</span><button onClick={close} type="button" aria-label="关闭"><Icon name="close" size={19}/></button></div>
        <div className="ce-drawer-body"><span className="ce-eyebrow">TEAM PLAN · DRAFT ONLY</span><h2 id="ce-plan-title">{planName}</h2>
          <p className="ce-profile-summary">{plan.mission}</p>
          <div className="ce-plan-budget"><Icon name="money" size={19}/><div><small>项目预算上限</small><strong>{plan.projectBudgetCredits} Credits</strong></div></div>
          <h3 className="ce-plan-heading">拟定分工</h3>
          <div className="ce-plan-steps">{plan.steps.map(step=><div className="ce-plan-step" key={step.expertId}>
            <span className="ce-step-index">{step.order}</span><div><div className="ce-plan-title"><strong>{step.title}</strong><small>{step.role==='leader'?'总控 / 整合交付':'专业执行'}</small></div><p>交付：{step.output}</p><span>{step.taskCeilingCredits} Credits 上限 · {step.runnerStatus==='registered'?'已登记执行器':'等待执行器'}</span></div>
          </div>)}</div>
          <div className="ce-plan-blocked"><Icon name="shield" size={18}/><div><strong>尚未启动团队执行</strong>{plan.blockers.map((x,i)=><p key={i}>{x}</p>)}</div></div>
        </div><div className="ce-drawer-bottom"><span>规划不产生 Token 或第三方费用</span><button className="ce-secondary" type="button" onClick={close}>返回团队配置</button></div>
      </aside>
    </div>}
  </div>;
}
