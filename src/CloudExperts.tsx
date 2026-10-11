import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Connector, Skill as WorkspaceSkill } from './types';
import { api, requestId } from './api';
import { Icon } from './icons';
import { ExpertMark, ExpertTeamMark } from './expert-icons';
import type { IconName } from './icons';

type Role = 'admin' | 'operator' | 'viewer';
type DotConnection = {
  installed: boolean; approved: boolean; workerId?: string; ownerId: string;
  pending?: number; claimed?: number; completed?: number;
  lastSeenAt?: string | null; onlineVerified?: boolean;
};
type Skill = { id: string; title: string };
type WorkerOption = { serviceId: string; workerId: string; name: string };
type ExpertBrief = {
  headline: string; positioning: string; scenario: string;
  inputs: string[]; steps: { name: string; detail: string }[];
  deliverables: { name: string; format: string; acceptance: string }[];
  toolNeeds: string[]; boundaries: string[];
};
type TeamBrief = {
  mission: string; exampleGoal: string; inputs: string[];
  workflow: { role: string; task: string; output: string }[];
  acceptance: string;
};
type ExpertTemplate = {
  id: string; name: string; title: string; category: string; summary: string;
  initials: string; accent: string; serviceIds: string[]; skills: string[];
  result: string; methods: string[]; connectionRequired: string; workerOptions: WorkerOption[]; brief: ExpertBrief;
};
type TeamTemplate = { id: string; title: string; category: string; summary: string; members: string[]; brief: TeamBrief };
type Hired = {
  id: string; templateId: string; alias: string; mission: string; serviceId: string | null;
  workerId: string | null; skills: string[]; maxCredits: number; revision: number;
  runnerStatus: 'registered' | 'not_connected'; runtimeReady: boolean;
  template: Omit<ExpertTemplate, 'workerOptions'>; createdAt: string;
};
type Team = {
  id: string; templateId: string; name: string; mission: string; leadId: string;
  memberIds: string[]; budgetCredits: number; taskCeilingCredits: number;
  registeredMembers: number; runAvailable: false; revision: number;
  readiness: string; members: Hired[];
  workPlans?: {id:string; requestId:string; status:string; product:string; market:string; reservedCredits:number;
    steps:{expertId:string; objective:string; budgetCredits:number; deadlineAt:string; orderId:string|null; status:string}[]}[];
};
type Plan = {
  teamId: string; mission: string; runnable: false; planningOnly: boolean; projectBudgetCredits: number;
  steps: { order: number; expertId: string; role: string; title: string; serviceId: string | null; output: string;
    instructions: string; reviewCriteria: string;
    taskCeilingCredits: number; runnerStatus: string; approvalRequired: true }[];
  inputs: string[]; acceptance: string; blockers: string[];
};
type Catalog = { experts: ExpertTemplate[]; teams: TeamTemplate[]; skills: Skill[] };
type ExpertDraft = { alias: string; mission: string; serviceId: string; workerId: string; skills: string[]; maxCredits: string; confirmed: boolean };
type TeamDraft = { templateId: string; name: string; mission: string; leadId: string; memberIds: string[]; budgetCredits: string; taskCeilingCredits: string };

const serviceLabels: Record<string,string> = {
  'buyer-discovery': '经销商研究', 'channel-validation': '渠道与市场验证', 'sales-assets': '销售素材',
};
const expertIcons: Record<string,IconName> = {
  'growth-lead': 'goals', 'buyer-hunter': 'people', 'market-analyst': 'activity',
  'channel-planner': 'work', 'sales-specialist': 'chat', 'brand-designer': 'palette',
  'commerce-tester': 'laptop', 'rfq-analyst': 'library',
};
const emptyCatalog: Catalog = { experts: [], teams: [], skills: [] };
const initialDraft = (template: ExpertTemplate): ExpertDraft => ({
  alias: template.name,
  mission: template.brief.headline + '\n' + template.brief.scenario,
  serviceId: template.serviceIds[0] || '',
  workerId: '',
  skills: template.skills,
  maxCredits: '20', confirmed: false,
});
const initialTeam = (template: TeamTemplate): TeamDraft => ({
  templateId: template.id, name: template.title,
  mission: template.brief.mission, leadId: '', memberIds: [],
  budgetCredits: '120', taskCeilingCredits: '20',
});
const err = (value: unknown) => value instanceof Error ? value.message : '操作失败，请检查企业服务器。';
function Avatar({ role, size = 'normal' }: { role: string; size?: 'small'|'normal'|'large' }) {
  return <ExpertMark role={role} size={size === 'normal' ? 'medium' : size}/>;
}
function availability(connected: boolean) {
  return <span className={'ce-availability'+(connected?' connected':'')}><i />{connected?'已登记执行器':'待绑定云执行器'}</span>;
}

export default function CloudExperts({ role, onOpenServices, onManageTools }: { role: Role; onOpenServices: () => void; onManageTools: (tab: 'skills' | 'connectors') => void }) {
  const [catalog,setCatalog] = useState<Catalog>(emptyCatalog);
  const [hired,setHired] = useState<Hired[]>([]);
  const [teams,setTeams] = useState<Team[]>([]);
  const [dotConnection,setDotConnection] = useState<DotConnection | null>(null);
  const [connectors,setConnectors] = useState<Connector[] | null>(null);
  const [installedSkills,setInstalledSkills] = useState<WorkspaceSkill[] | null>(null);
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
  const [stageTeam,setStageTeam] = useState<Team|null>(null);
  const [stagePublic,setStagePublic] = useState({product:'',market:'美国',confirmed:false});
  const [stageSpecs,setStageSpecs] = useState<Record<string,{objective:string;budget:string;deadline:string}>>({});
  const stageRequestId = useRef<string>(requestId());
  const [delegationTarget,setDelegationTarget] = useState<string|null>(null);
  const [taskDraft,setTaskDraft] = useState({product:'',market:'美国',objective:'',budget:'20',deadline:'',confirmed:false});
  const delegationId = useRef<string>(requestId());
  const [busy,setBusy] = useState(false);
  const [loaded,setLoaded] = useState(false);
  const [alert,setAlert] = useState<{text:string;error:boolean}|null>(null);
  const hireId = useRef<string>(requestId());
  const teamId = useRef<string>(requestId());
  const operator = role === 'admin';

  const load = useCallback(async () => {
    const [available,experts,groups,tools,skills,dot] = await Promise.all([
      api<Catalog>('/cloud-expert-catalog'),
      api<{experts:Hired[]}>('/cloud-experts'),
      api<{teams:Team[]}>('/cloud-teams'),
      api<{connectors:Connector[]}>('/connectors').then(x=>x.connectors).catch(()=>null),
      api<{skills:WorkspaceSkill[]}>('/skills').then(x=>x.skills).catch(()=>null),
      api<DotConnection>('/dot-worker-connection').catch(()=>null),
    ]);
    setCatalog(available);setHired(experts.experts);setTeams(groups.teams);
    setConnectors(tools);setInstalledSkills(skills);setDotConnection(dot);setLoaded(true);
  },[]);
  useEffect(()=>{
    let active=true;
    void load().catch(e=>{if(active)setAlert({text:err(e),error:true});});
    return ()=>{active=false;};
  },[load]);
  const shown = useMemo(()=>catalog.experts.filter(template=>
    (category==='全部' || template.category===category) &&
    (!search.trim() || (template.name+' '+template.title+' '+template.summary+' '+template.brief.headline+' '+template.brief.deliverables.map(d=>d.name).join(' ')).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  ),[catalog.experts,category,search]);
  const connected = hired.filter(x=>x.runtimeReady).length;
  const categories = ['全部',...new Set(catalog.experts.map(x=>x.category))];
  const editing = editingExpert ? hired.find(x=>x.id===editingExpert) : undefined;
  const currentTemplate = catalog.experts.find(x=>x.id===(selectedTemplate || editing?.templateId));
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
  function close(){setSelectedTemplate(null);setEditingExpert(null);setDraft(null);setTeamDraft(null);setTeamEditing(null);setPlan(null);setDelegationTarget(null);setStageTeam(null);}

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
      setPlan(response.plan);setPlanName(team.name);setStageTeam(team);
      const existing=team.workPlans?.[0];
      stageRequestId.current=existing?.requestId||requestId();
      const due=new Date();due.setDate(due.getDate()+7);
      const defaultDate=due.toISOString().slice(0,10);
      const each=Math.max(1,Math.floor(team.budgetCredits/response.plan.steps.length));
      setStagePublic({product:existing?.product||'',market:existing?.market||'美国',confirmed:false});
      setStageSpecs(Object.fromEntries(response.plan.steps.map(step=>{
        const fromPrevious=existing?.steps.find(item=>item.expertId===step.expertId);
        return [step.expertId,{
          objective:fromPrevious?.objective||[step.instructions,'交付：'+step.output].join('；').slice(0,1200),
          budget:String(fromPrevious?.budgetCredits||Math.min(step.taskCeilingCredits,each)),
          deadline:fromPrevious?.deadlineAt?.slice(0,10)||defaultDate,
        }];
      })));
    }catch(e){setAlert({text:err(e),error:true});}
    finally{setBusy(false);}
  }

  async function prepareTeamTasks(event: FormEvent) {
    event.preventDefault();
    if(!operator||!plan||!stageTeam||busy||!stagePublic.confirmed)return;
    const total=plan.steps.reduce((sum,step)=>sum+Number(stageSpecs[step.expertId]?.budget||0),0);
    if(!Number.isSafeInteger(total)||total>plan.projectBudgetCredits||total<1){
      setAlert({text:'各专家任务费用之和必须小于或等于项目总预算。',error:true});return;
    }
    setBusy(true);
    try{
      const existing=stageTeam.workPlans?.[0];
      const result=await api<{plan:{status:string;steps:{orderId:string|null}[]}}>('/cloud-teams/'+plan.teamId+'/stage','POST',{
        requestId:stageRequestId.current,confirmed:true,publicDataConfirmed:true,
        product:stagePublic.product,market:stagePublic.market,
        stages:plan.steps.map(step=>{
          const values=stageSpecs[step.expertId];
          return {expertId:step.expertId,objective:values.objective,
            budgetCredits:Number(values.budget),
            deadlineAt:existing?.steps.find(item=>item.expertId===step.expertId)?.deadlineAt ||
              new Date(values.deadline+'T18:00:00').toISOString()};
        }),
      });
      if(result.plan.status!=='awaiting_approval')throw new Error('团队任务仍在准备中，请检查状态后继续。');
      await load();close();
      setAlert({text:'每位专家的待审批任务单已创建；仍需分别授权，尚未执行云端任务。',error:false});
      onOpenServices();
    }catch(error){await load().catch(()=>{});setAlert({text:err(error),error:true});}
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
        <div className="ce-hero-avatar ce-ha-one"><Avatar role="growth-lead" size="large"/></div>
        <div className="ce-hero-avatar ce-ha-two"><Avatar role="buyer-hunter" /></div>
        <div className="ce-hero-avatar ce-ha-three"><Avatar role="market-analyst" /></div>
        <div className="ce-hero-avatar ce-ha-four"><Avatar role="brand-designer" /></div>
        <span className="ce-hero-caption">ONE WORKSPACE · MANY EXPERTS</span>
      </div>
    </section>

    <div className="ce-metrics">
      <div><Icon name="people" size={17}/><strong>{hired.length}</strong><span>已配置专家</span></div>
      <div><Icon name="work" size={17}/><strong>{teams.length}</strong><span>我的专家团</span></div>
      <div><Icon name="bolt" size={17}/><strong>{connected}</strong><span>已登记执行者</span></div>
      <p>岗位配置与云端执行分离。未连接的专家不会产生真实运行费用。</p>
    </div>

    <section className="ce-dot-connection" aria-label="ChatGPT dot 云 Worker">
      <div className="ce-dot-glyph"><Icon name="bolt" size={23}/></div>
      <div className="ce-dot-content">
        <div className="ce-dot-title"><strong>ChatGPT dot · xy</strong>
          <span className={'ce-dot-state'+(dotConnection?.approved?' ce-dot-registered':'')}>
            <i/>{!dotConnection ? '连接信息不可读取' :
              !dotConnection.installed ? '尚未连接 Workspace 插件' :
              !dotConnection.approved ? '待验证身份与预算' :
              dotConnection.lastSeenAt ? '已配置 · 观察到插件握手' : '已配置 · 尚未观察到握手'}
          </span>
        </div>
        <p>通过受控 Workspace 插件领取公开任务、执行云端研究并回传带原始证据的文件；不会模拟 dot 会话或复制 ChatGPT 凭据。</p>
        <div className="ce-dot-metrics">
          <span>等待领取 <b>{dotConnection?.pending ?? 0}</b></span>
          <span>已领取 <b>{dotConnection?.claimed ?? 0}</b></span>
          <span>已提交待验收 <b>{dotConnection?.completed ?? 0}</b></span>
          {dotConnection?.lastSeenAt && <span>最近身份检查 {new Date(dotConnection.lastSeenAt).toLocaleString('zh-CN')}</span>}
        </div>
      </div>
      <button className="ce-dot-action" type="button" onClick={() => { setTab('market');document.getElementById('ce-expert-catalog')?.scrollIntoView({behavior:'smooth'}); }}>
        选择专家岗位 <Icon name="chevron" size={15}/>
      </button>
    </section>

    {alert && <div className={'ce-alert'+(alert.error?' error':'')} role={alert.error?'alert':'status'}><Icon name={alert.error?'info':'check'} size={18}/><span>{alert.text}</span><button type="button" onClick={()=>setAlert(null)} aria-label="关闭提示"><Icon name="close" size={16}/></button></div>}

    <div className="ce-section-title"><div><span className="ce-eyebrow">CURATED TEAMS</span><h2>从一个专家团开始</h2><p>先选定岗位组合，再决定每位专家使用哪个云执行器。</p></div><button className="ce-text-action" type="button" onClick={()=>setTab('teams')}>查看我的团队 <Icon name="chevron" size={14}/></button></div>
    <div className="ce-team-presets">
      {catalog.teams.map((t,index)=><article className="ce-team-card" key={t.id}>
        <span className="ce-team-top"><span className="ce-team-index">TEAM 0{index+1}</span><span className="ce-team-category">{t.category}</span></span>
        <h3>{t.title}</h3><p>{t.brief.mission}</p>
        <div className="ce-team-outcomes">
          {t.brief.workflow.slice(0,3).map(stage=><span key={stage.role}><Icon name="check" size={12}/>{stage.output}</span>)}
        </div>
        <span className="ce-team-face-list"><ExpertTeamMark members={t.members}/></span>
        <div className="ce-team-end"><small>{t.members.length} 个专业岗位</small><button type="button" onClick={()=>openTeam(t)} disabled={!operator}>配置这个专家团 <Icon name="arrow" size={15}/></button></div>
      </article>)}
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
            <div className="ce-expert-card-head"><Avatar role={template.id}/><span className="ce-role-pill">{template.category}</span></div>
            <h3>{template.name}</h3><span className="ce-role-name">{template.title}</span>
            <p>{template.brief.headline}</p>
            <div className="ce-real-output"><Icon name="file" size={15}/><span><b>核心交付</b>{template.brief.deliverables[0].name}</span></div>
            <div className="ce-skill-chips">{template.methods.map(method=><span key={method}>{method}</span>)}</div>
            <div className="ce-card-foot">
              <span className={'ce-template-status'+(template.workerOptions.length?' is-registered':'')}>{template.workerOptions.length?'已登记 '+template.workerOptions.length+' 个可用执行器':'需绑定受审核云执行器'}</span>
              <button type="button" onClick={()=>{const existing=hired.find(x=>x.templateId===template.id);existing?editExpert(existing):openExpert(template);}} disabled={!operator}>
                {alreadyHired.has(template.id)?'管理已聘专家':'查看详情 · 配置专家'} <Icon name="chevron" size={15}/>
              </button>
            </div>
          </article>)}
        </div>
        {shown.length===0&&<div className="ce-empty"><Icon name="search" size={27}/><h3>没有匹配的专家</h3><p>换个关键词或选择其他领域。</p></div>}
      </>}
      {tab==='mine'&&<div className="ce-owned">
        <div className="ce-section-title ce-owned-title"><div><h2>已聘请的专家</h2><p>每位专家的岗位、工作范围、费用上限都可以单独维护。</p></div><button className="ce-primary ce-small" onClick={()=>setTab('market')}><Icon name="plus" size={15}/>添加专家</button></div>
        {!hired.length?<div className="ce-empty"><Icon name="people" size={30}/><h3>先聘请第一位云专家</h3><p>专家本身是岗位配置；需要绑定经过审核的云 Worker 才能真正执行。</p><button className="ce-primary" onClick={()=>setTab('market')}>前往专家市场</button></div>:
          <div className="ce-hired-grid">{hired.map(item=><article className="ce-hired-card" key={item.id}>
            <div className="ce-hired-top"><Avatar role={item.templateId}/>{availability(item.runtimeReady)}</div>
            <h3>{item.alias}</h3><p>{item.mission}</p>
            <div className="ce-hired-outputs"><Icon name="file" size={14}/><span>交付标准：{item.template.brief.deliverables[0].name}</span></div>
            <dl><div><dt>任务上限</dt><dd>{item.maxCredits} Credits</dd></div><div><dt>专业服务</dt><dd>{item.serviceId?serviceLabels[item.serviceId]: '需私有环境'}</dd></div></dl>
            {item.runtimeReady && <button className="ce-primary" type="button" onClick={()=>startDelegation(item)} disabled={!operator}>委托此专家 <Icon name="arrow" size={14}/></button>}
            <button className="ce-outline" onClick={()=>editExpert(item)} disabled={!operator}>配置岗位 <Icon name="chevron" size={15}/></button>
          </article>)}</div>}
      </div>}
      {tab==='teams'&&<div className="ce-owned">
        <div className="ce-section-title ce-owned-title"><div><h2>我的专家团队</h2><p>定义总控专家、协作成员、项目预算与工作分工。</p></div><button className="ce-primary ce-small" onClick={()=>openTeam()} disabled={!operator}><Icon name="plus" size={15}/>新建专家团</button></div>
        {!teams.length?<div className="ce-empty"><Icon name="work" size={29}/><h3>你的第一支专家团还未建立</h3><p>先在专家市场配置岗位，再把专家加入同一个项目。</p><button className="ce-primary" onClick={()=>openTeam()}>选择团队模板</button></div>:
          <div className="ce-myteams">{teams.map(team=><article className="ce-myteam" key={team.id}>
            <div className="ce-myteam-head"><span className="ce-role-pill">企业专家团队</span><span className="ce-availability"><i/>{team.workPlans?.[0]?.status==='awaiting_approval'?'已生成 '+team.workPlans[0].steps.length+' 张待审批任务':
              team.workPlans?.[0]?.status==='setup_blocked'?'任务准备受阻':
              team.registeredMembers===team.members.length?'执行器已登记 · 待安排':'待绑定云执行器'}</span></div>
            <h3>{team.name}</h3><p>{team.mission}</p>
            <div className="ce-team-members">{team.members.map((member,i)=><div key={member.id}><Avatar role={member.templateId} size="small"/><span>{member.alias}</span><small>{i===0?'总控':'成员'}</small></div>)}</div>
            <div className="ce-myteam-foot"><span>项目预算 {team.budgetCredits} Credits · 已预留 {team.workPlans?.[0]?.reservedCredits||0} Credits · {team.registeredMembers}/{team.members.length} 执行器已登记</span>
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
          <div className="ce-profile"><Avatar role={currentTemplate.id} size="large"/><div><span className="ce-eyebrow">CLOUD EXPERT</span><h2 id="ce-expert-title">{currentTemplate.name}</h2><p>{currentTemplate.title}</p></div></div>
          <p className="ce-profile-summary ce-profile-intent">{currentTemplate.brief.headline}</p>
          <div className="ce-expert-case"><Icon name="goals" size={17}/><div><strong>适用业务</strong><p>{currentTemplate.brief.scenario}</p></div></div>
          <section className="ce-expert-playbook" aria-label="专家工作方法">
            <div className="ce-brief-heading"><h3>实际工作步骤</h3><span>官方岗位作业规范</span></div>
            <div className="ce-brief-steps">{currentTemplate.brief.steps.map((step,i)=><div className="ce-brief-step" key={step.name}>
              <span className="ce-brief-step-index">{String(i+1).padStart(2,'0')}</span>
              <div><strong>{step.name}</strong><p>{step.detail}</p></div>
            </div>)}</div>
          </section>
          <section className="ce-expert-playbook" aria-label="可验收交付物">
            <div className="ce-brief-heading"><h3>交付物与验收标准</h3><Icon name="check" size={17}/></div>
            <div className="ce-brief-deliverables">{currentTemplate.brief.deliverables.map(d=><div className="ce-brief-deliverable" key={d.name}>
              <div><Icon name="file" size={15}/><strong>{d.name}</strong><span>{d.format}</span></div>
              <p>{d.acceptance}</p>
            </div>)}</div>
          </section>
          <section className="ce-expert-playbook">
            <div className="ce-brief-heading"><h3>企业需要提供</h3></div>
            <div className="ce-required-inputs">{currentTemplate.brief.inputs.map(x=><span key={x}><Icon name="check" size={13}/>{x}</span>)}</div>
          </section>
          <form id="ce-expert-form" className="ce-form" onSubmit={e=>void saveExpert(e)}>
            <label>岗位名称<input required maxLength={64} value={draft.alias} onChange={e=>setDraft({...draft,alias:e.target.value})}/></label>
            <label>专家职责与工作要求<textarea required rows={4} maxLength={1800} value={draft.mission} onChange={e=>setDraft({...draft,mission:e.target.value})}/></label>
            <div className="ce-form-section"><h3>1. 专业能力 <small>岗位技能标签 ≠ 直接工具授权</small></h3>
              <div className="ce-check-group">{currentTemplate.skills.map(id=><label className="ce-check" key={id}>
                <input type="checkbox" checked={draft.skills.includes(id)} onChange={e=>setDraft({...draft,skills:e.target.checked?[...draft.skills,id]:draft.skills.filter(x=>x!==id)})}/>{catalog.skills.find(x=>x.id===id)?.title||id}
              </label>)}</div>
              <div className="ce-installed-tools"><div><strong>企业已安装的真实 Skill</strong><button type="button" onClick={()=>{close();onManageTools('skills');}}>管理技能 <Icon name="chevron" size={12}/></button></div>
                {installedSkills===null ? <p>技能清单读取失败，暂不能确认连接状态。</p> :
                  installedSkills.length===0 ? <p>尚无已登记的企业 Skill。岗位标签本身不具备执行权限。</p> :
                  installedSkills.map(skill=><div className="ce-real-connector" key={skill.id}><Icon name="file" size={14}/><span>{skill.name}</span><small>{skill.enabled?'已启用':'未启用'}</small></div>)}
              </div>
            </div>
            <div className="ce-form-section"><h3>2. 云端执行器</h3><label>执行任务类型<select value={draft.serviceId} onChange={e=>setDraft({...draft,serviceId:e.target.value,workerId:''})}>
              {!currentTemplate.serviceIds.length&&<option value="">需要私有数据通道（当前不可执行）</option>}
              {currentTemplate.serviceIds.map(x=><option key={x} value={x}>{serviceLabels[x]||x}</option>)}
            </select></label>
              <label>绑定已审核云 Worker<select value={draft.workerId} onChange={e=>setDraft({...draft,workerId:e.target.value})}><option value="">暂不绑定 · 保存岗位配置</option>{selectedWorkers.map(option=><option value={option.workerId} key={option.workerId}>{option.name}</option>)}</select></label>
              <p className="ce-form-help">未在受审核执行器清单中登记的 Muse、Grokbot 或 Dot 不能直接上线。这里不接受任意 Token 或执行地址。</p>
              <div className="ce-installed-tools">
                <div><strong>执行此岗位通常需要</strong><span>按需由企业授权</span></div>
                {currentTemplate.brief.toolNeeds.map(x=><div className="ce-tool-need" key={x}><Icon name="check" size={14}/>{x}</div>)}
                <div className="ce-connector-heading"><strong>当前 Workspace 连接器</strong><button type="button" onClick={()=>{close();onManageTools('connectors');}}>打开连接器管理 <Icon name="chevron" size={12}/></button></div>
                {connectors===null ? <p>无法读取企业连接器状态，请检查服务器权限与连接。</p> :
                  connectors.length===0 ? <p>没有已登记的执行连接器；实际工具调用和付费执行将被阻断。</p> :
                  connectors.map(item=><div className="ce-real-connector" key={item.id}>
                    <Icon name="work" size={14}/><span>{item.name}</span><small className={item.status==='ready'?'ce-runtime-configured':''}>{item.status==='ready'?'配置就绪 · 未验证外网':item.enabled?'配置受限':'未启用'}</small>
                  </div>)}
              </div>
            </div>
            <div className="ce-form-section"><h3>3. 预算与权限</h3><label>单次任务预算上限 · Credits<input type="number" required min={1} max={10000} value={draft.maxCredits} onChange={e=>setDraft({...draft,maxCredits:e.target.value})}/></label>
              <div className="ce-permission-info"><Icon name="shield" size={17}/><span>仅公开研究、只读与草稿能力；涉及账号操作、发送邮件、客户私密资料和支付必须另行授权。</span></div>
              <div className="ce-guardrails">{currentTemplate.brief.boundaries.map(x=><p key={x}><Icon name="info" size={13}/>{x}</p>)}</div>
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
          <span className="ce-eyebrow">MULTI-EXPERT TEAM</span><h2 id="ce-team-title">配置云端专家团</h2>
          <p className="ce-profile-summary">指定总控和成员，团队配置可保存，但不会自动创建付费远程任务。</p>
          <div className="ce-team-playbook">
            <div className="ce-brief-heading"><h3>{selectedTeamTemplate.title} · 推荐协作流程</h3><span>由 Workspace 保存的作业标准</span></div>
            {selectedTeamTemplate.brief.workflow.map((stage,index)=><div className="ce-team-stage" key={stage.role}>
              <ExpertMark role={stage.role} size="small"/>
              <div><strong>{index+1}. {catalog.experts.find(item=>item.id===stage.role)?.name||stage.role}</strong>
                <p>{stage.task}</p><small>预期交付：{stage.output}</small>
              </div>
            </div>)}
            <div className="ce-team-acceptance"><Icon name="check" size={15}/>{selectedTeamTemplate.brief.acceptance}</div>
          </div>
          <form className="ce-form" id="ce-team-form" onSubmit={e=>void saveTeam(e)}>
            <label>专家团模板<select value={teamDraft.templateId} onChange={e=>{const next=catalog.teams.find(x=>x.id===e.target.value);if(next)setTeamDraft(initialTeam(next));}}>{catalog.teams.map(x=><option value={x.id} key={x.id}>{x.title}</option>)}</select></label>
            <label>团队名称<input value={teamDraft.name} required maxLength={90} onChange={e=>setTeamDraft({...teamDraft,name:e.target.value})}/></label>
            <label>团队最高作战指令<textarea value={teamDraft.mission} rows={4} required maxLength={1800} onChange={e=>setTeamDraft({...teamDraft,mission:e.target.value})}/></label>
            <div className="ce-form-section"><h3>1. 设定总控专家</h3><label>团队负责人<select value={teamDraft.leadId} required onChange={e=>setTeamDraft({...teamDraft,leadId:e.target.value,memberIds:teamDraft.memberIds.filter(id=>id!==e.target.value)})}><option value="">选择总控专家</option>{hired.map(x=><option key={x.id} value={x.id}>{x.alias}</option>)}</select></label></div>
            <div className="ce-form-section"><h3>2. 分配专家成员 <small>{teamDraft.memberIds.length} / 5</small></h3>
              <div className="ce-team-picker">{hired.filter(x=>x.id!==teamDraft.leadId).map(item=><label key={item.id} className="ce-picker-row"><input type="checkbox" checked={teamDraft.memberIds.includes(item.id)} onChange={e=>setTeamDraft({...teamDraft,memberIds:e.target.checked?[...teamDraft.memberIds,item.id]:teamDraft.memberIds.filter(x=>x!==item.id)})} disabled={!teamDraft.memberIds.includes(item.id)&&teamDraft.memberIds.length>=5}/><Avatar role={item.templateId} size="small"/><span><strong>{item.alias}</strong><small>{item.runtimeReady?'已登记执行器':'待绑定云执行器'}</small></span></label>)}</div>
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
            <label>企业业务目标（将附上专家作业规范）<textarea rows={4} required maxLength={1200} value={taskDraft.objective} onChange={e=>setTaskDraft({...taskDraft,objective:e.target.value})}/></label>
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
          <div className="ce-plan-steps">{plan.steps.map((step,index)=><div className="ce-plan-step" key={step.expertId}>
            <span className="ce-step-index">{index+1}</span><div><div className="ce-plan-title"><strong>{step.title}</strong><small>{step.role==='leader'?'总控 / 整合交付':'专业执行'}</small></div>
            <p>{step.instructions}</p><p>交付：{step.output}</p>
            <div className="ce-plan-review"><Icon name="check" size={13}/>{step.reviewCriteria}</div>
            <span>{step.taskCeilingCredits} Credits 上限 · {step.runnerStatus==='registered'?'已登记执行器':'等待执行器'}</span></div>
          </div>)}</div>
          <div className="ce-plan-blocked"><Icon name="shield" size={18}/><div><strong>自动团队 DAG 尚未启用</strong>{plan.blockers.map((x,i)=><p key={i}>{x}</p>)}</div></div>
          {stageTeam?.workPlans?.[0]?.status==='awaiting_approval' && <div className="ce-team-staged">
            <Icon name="check" size={20}/><div><strong>{stageTeam.workPlans[0].steps.length} 张专家任务已进入审批队列</strong>
            <p>已预留 {stageTeam.workPlans[0].reservedCredits} Credits，但没有自动派发或产生远端费用。下一步逐项审核和授权。</p>
            <button type="button" onClick={()=>{close();onOpenServices();}}>前往审批任务 <Icon name="chevron" size={14}/></button></div>
          </div>}
          {stageTeam&&stageTeam.registeredMembers===plan.steps.length&&
            stageTeam.workPlans?.[0]?.status!=='awaiting_approval'&&
            <form id="ce-stage-form" className="ce-form ce-stage-form" onSubmit={e=>void prepareTeamTasks(e)}>
              <div className="ce-brief-heading"><h3>将分工创建为真实待审批任务单</h3><span>不自动执行</span></div>
              <label>共享公开产品<input required maxLength={240} value={stagePublic.product} onChange={e=>setStagePublic({...stagePublic,product:e.target.value})} placeholder="例如：印花粘胶面料"/></label>
              <label>目标国家 / 市场<input required maxLength={100} value={stagePublic.market} onChange={e=>setStagePublic({...stagePublic,market:e.target.value})}/></label>
              <div className="ce-stage-budget"><Icon name="money" size={17}/><strong>当前任务合计：{plan.steps.reduce((sum,step)=>sum+Number(stageSpecs[step.expertId]?.budget||0),0)} / {plan.projectBudgetCredits} Credits</strong></div>
              {plan.steps.map((step,index)=><div className="ce-stage-task" key={step.expertId}>
                <div className="ce-stage-task-head"><Avatar role={stageTeam.members.find(m=>m.id===step.expertId)?.templateId||'growth-lead'} size="small"/>
                  <div><strong>{step.title}</strong><small>交付：{step.output}</small></div></div>
                <label>本专家任务目标<textarea required rows={3} maxLength={1200}
                  value={stageSpecs[step.expertId]?.objective||''} onChange={e=>setStageSpecs(prev=>({...prev,[step.expertId]:{...prev[step.expertId],objective:e.target.value}}))}/></label>
                <div className="ce-two-columns"><label>本任务 Credits<input required type="number" min={1} max={step.taskCeilingCredits}
                  value={stageSpecs[step.expertId]?.budget||''} onChange={e=>setStageSpecs(prev=>({...prev,[step.expertId]:{...prev[step.expertId],budget:e.target.value}}))}/></label>
                  <label>交付期限<input required type="date"
                    value={stageSpecs[step.expertId]?.deadline||''} onChange={e=>setStageSpecs(prev=>({...prev,[step.expertId]:{...prev[step.expertId],deadline:e.target.value}}))}/></label></div>
              </div>)}
              <label className="ce-confirm"><input type="checkbox" checked={stagePublic.confirmed} onChange={e=>setStagePublic({...stagePublic,confirmed:e.target.checked})}/>
                我确认这些字段均可向已审核云 Worker 共享；所有子任务仍需管理员单独审批才能派发。
              </label>
              <button type="submit" className="ce-primary" disabled={!operator||busy||!stagePublic.confirmed||
                plan.steps.reduce((sum,step)=>sum+Number(stageSpecs[step.expertId]?.budget||0),0)>plan.projectBudgetCredits}>
                <Icon name="check" size={16}/>{stageTeam.workPlans?.[0]?.status==='setup_blocked'?'使用原请求恢复创建任务':'生成 '+plan.steps.length+' 张待审批任务单'}
              </button>
            </form>}
        </div><div className="ce-drawer-bottom"><span>计划与任务草稿不产生远程费用</span><button className="ce-secondary" type="button" onClick={close}>返回我的团队</button></div>
      </aside>
    </div>}
  </div>;
}
