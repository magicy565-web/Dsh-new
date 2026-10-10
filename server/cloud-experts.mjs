import { createHash, randomUUID } from 'node:crypto';

/**
 * Enterprise expert definitions are staffed positions, NOT automatically
 * instantiated personal agents. Execution stays within the reviewed Worker
 * registry and existing business orders. Do not fork or emulate an Agent.
 */
export const EXPERT_SKILLS = Object.freeze([
  { id: 'web-research', title: '公开资料研究' },
  { id: 'evidence-review', title: '证据核查' },
  { id: 'buyer-screening', title: '目标买手筛选' },
  { id: 'market-analysis', title: '市场与竞争分析' },
  { id: 'channel-strategy', title: '渠道策略' },
  { id: 'sales-writing', title: '英文销售文案' },
  { id: 'asset-planning', title: '销售素材规划' },
  { id: 'delivery-review', title: '成果与预算审查' },
]);
const t = (id, name, title, category, summary, initials, accent, serviceIds, skills, result, methods) =>
  ({ id, name, title, category, summary, initials, accent, serviceIds, skills, result, methods });
export const EXPERT_TEMPLATES = Object.freeze([
  t('growth-lead', '增长总控专家', 'Team Lead', '管理', '把企业目标拆解为可验收的分工，监督预算、依赖和结果。', 'GL', 'violet', ['buyer-discovery', 'channel-validation'], ['market-analysis','delivery-review'], '项目计划与验收清单', ['澄清目标','拆分工作','汇总证据']),
  t('buyer-hunter', '海外渠道开发专家', 'Distributor Development', '市场', '面向批发商、进口商和经销商构建有来源证据的候选名单。', 'BD', 'blue', ['buyer-discovery'], ['web-research','buyer-screening','evidence-review'], '来源可追溯的买手名单', ['目标画像','公开搜索','匹配筛选']),
  t('market-analyst', '海外市场研究专家', 'Market Intelligence', '研究', '从竞争产品、价格和公开市场信息中寻找进入机会。', 'MI', 'orange', ['channel-validation'], ['web-research','market-analysis','evidence-review'], '市场研究简报', ['竞争研究','机会判断','验证假设']),
  t('channel-planner', '渠道策略专家', 'Channel Strategy', '市场', '评估批发、电商和经销渠道，并设计低成本的市场验证路径。', 'CS', 'teal', ['channel-validation'], ['channel-strategy','market-analysis'], '渠道优先级与试验计划', ['渠道评分','成本评估','试验设计']),
  t('sales-specialist', '国际销售专家', 'B2B Sales', '销售', '整理买手沟通策略、FAQ 和报价前的问题清单。', 'SA', 'pink', ['sales-assets'], ['sales-writing','delivery-review'], '英文销售资料与跟进草稿', ['买手痛点','话术设计','人工审核']),
  t('brand-designer', '品牌内容专家', 'Brand & Creative', '设计', '面向海外买手组织产品故事、落地页和销售资料。', 'BR', 'fuchsia', ['sales-assets'], ['asset-planning','sales-writing'], 'Landing Page 与 Sales Pack 草稿', ['价值提炼','文案结构','素材验收']),
  t('commerce-tester', '电商验证专家', 'E-commerce Validation', '增长', '验证海外渠道、竞品和小预算销售机会。', 'EC', 'green', ['channel-validation'], ['market-analysis','channel-strategy'], '销售可行性验证计划', ['渠道假设','竞争分析','测试方案']),
  t('rfq-analyst', '历史询盘分析专家', 'RFQ Recovery', '销售', '复盘历史询盘，形成客户判断。需要企业私有资料隔离后才能执行。', 'RF', 'slate', [], ['buyer-screening','delivery-review'], '待批准的询盘复盘建议', ['权限隔离','历史比对','人工跟进']),
]);
export const TEAM_TEMPLATES = Object.freeze([
  { id: 'overseas-growth', title: '海外增长专家团', category: '市场', summary: '市场机会、海外分销商和渠道验证协同推进。', members: ['growth-lead','buyer-hunter','market-analyst','channel-planner'] },
  { id: 'sales-conversion', title: '外贸销售增长团队', category: '销售', summary: '销售策略、买手资料与英文素材形成可验收交付。', members: ['growth-lead','buyer-hunter','sales-specialist','brand-designer'] },
  { id: 'brand-launch', title: '新品海外上市团队', category: '品牌', summary: '验证市场方向并制作海外销售页面和渠道素材。', members: ['growth-lead','market-analyst','brand-designer','commerce-tester'] },
]);
const serviceIndex = new Map(EXPERT_TEMPLATES.map(x => [x.id,x]));
const teamIndex = new Map(TEAM_TEMPLATES.map(x => [x.id,x]));
const skillIds = new Set(EXPERT_SKILLS.map(x=>x.id));
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const only = (value,fields) => object(value) && Object.keys(value).every(x => fields.includes(x));
const identity = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(x);
const stamp = () => new Date().toISOString();
const fingerprint = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export class CloudExpertError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const fail=(status,code,message)=>{throw new CloudExpertError(status,code,message);};
function text(value,label,max=700) {
  if(typeof value !== 'string' || !value.trim() || value.length>max || /[\u0000-\u001f\u007f]/u.test(value))
    fail(400,'INVALID_INPUT',label+' must be meaningful bounded text.');
  return value.trim();
}
function revision(value) {
  if(!Number.isSafeInteger(value) || value<1) fail(400,'INVALID_REVISION','Expected revision required.');
  return value;
}
function quota(value,label,max) {
  if(!Number.isSafeInteger(value) || value<1 || value>max) fail(400,'INVALID_BUDGET',label+' must be positive bounded credits.');
  return value;
}
function getExpert(state,id) {
  const value=(state.cloudExperts||[]).find(x=>x.id===id);
  if(!value) fail(404,'EXPERT_NOT_FOUND','The expert has not been hired in this Workspace.');
  return value;
}
function getTeam(state,id) {
  const value=(state.cloudTeams||[]).find(x=>x.id===id);
  if(!value) fail(404,'TEAM_NOT_FOUND','The team does not exist in this Workspace.');
  return value;
}
function availableWorkers(catalog,template,serviceId) {
  return catalog.filter(x=>x.id===serviceId).flatMap(x=>x.workers||[]).filter(x=>x.budgetEnforced===true);
}
function configureExpert(input,catalog,current=null) {
  if(!only(input,current ? ['alias','mission','serviceId','workerId','skills','maxCredits','expectedRevision'] :
     ['templateId','alias','mission','serviceId','workerId','skills','maxCredits','requestId','publicDataConfirmed']))
    fail(400,'INVALID_INPUT','Unsupported expert configuration.');
  const template=serviceIndex.get(current?.templateId||input.templateId);
  if(!template) fail(404,'EXPERT_TEMPLATE_NOT_FOUND','Select a reviewed official expert template.');
  const alias=text(input.alias??current?.alias,'Expert name',64);
  const mission=text(input.mission??current?.mission,'Expert responsibility',1800);
  const serviceId=input.serviceId === undefined ? current?.serviceId??null : input.serviceId;
  if(serviceId!==null && !template.serviceIds.includes(serviceId))
    fail(400,'SERVICE_SCOPE_INVALID','The expert cannot perform this service.');
  const skills=input.skills??current?.skills??[];
  if(!Array.isArray(skills) || skills.length>8 || new Set(skills).size!==skills.length ||
    !skills.every(x=>skillIds.has(x)&&template.skills.includes(x)))
    fail(400,'SKILL_SCOPE_INVALID','Choose only skills in this expert template.');
  const workerId=input.workerId===undefined ? current?.workerId??null : input.workerId;
  if(workerId!==null && (!identity(workerId) || !serviceId ||
    !availableWorkers(catalog,template,serviceId).some(x=>x.id===workerId)))
    fail(409,'WORKER_UNAVAILABLE','Only explicitly reviewed budget-guarded Workers can be selected.');
  const maxCredits=quota(input.maxCredits??current?.maxCredits,'Expert task ceiling',10000);
  return { templateId:template.id,alias,mission,serviceId,workerId,skills:[...skills],maxCredits,
    dataScope:'public_only',externalActions:'separate_approval_required' };
}
function configureTeam(input,state,current=null) {
  if(!only(input,current ? ['name','mission','leadId','memberIds','budgetCredits','taskCeilingCredits','expectedRevision'] :
    ['templateId','name','mission','leadId','memberIds','budgetCredits','taskCeilingCredits','requestId']))
    fail(400,'INVALID_INPUT','Unsupported team configuration.');
  const template=teamIndex.get(current?.templateId||input.templateId);
  if(!template) fail(404,'TEAM_TEMPLATE_NOT_FOUND','Choose a reviewed team composition.');
  const name=text(input.name??current?.name,'Team name',90);
  const mission=text(input.mission??current?.mission,'Team mission',1800);
  const leadId=input.leadId??current?.leadId;
  const memberIds=input.memberIds??current?.memberIds;
  if(!identity(leadId)||!Array.isArray(memberIds)||memberIds.length<1||memberIds.length>5||
    new Set(memberIds).size!==memberIds.length || memberIds.includes(leadId) || !memberIds.every(identity))
    fail(400,'INVALID_TEAM','Use one leader and one to five distinct team members.');
  const staffed=[leadId,...memberIds].map(id=>getExpert(state,id));
  if(new Set(staffed.map(x=>x.templateId)).size!==staffed.length)
    fail(409,'DUPLICATE_ROLE','The first version allows only one expert of each role in a team.');
  const budgetCredits=quota(input.budgetCredits??current?.budgetCredits,'Team budget',100000);
  const taskCeilingCredits=quota(input.taskCeilingCredits??current?.taskCeilingCredits,'Per-task ceiling',10000);
  if(taskCeilingCredits>budgetCredits) fail(400,'INVALID_BUDGET','Task ceiling cannot exceed total team budget.');
  return {templateId:template.id,name,mission,leadId,memberIds:[...memberIds],budgetCredits,taskCeilingCredits,
    collaboration:'leader_reviewed_delegation',externalActions:'separate_approval_required',dataScope:'public_only'};
}
export function createCloudExpertService({store,workerCatalog=()=>[],workerDesk=null}={}) {
  if(typeof store?.read!=='function'||typeof store?.update!=='function'||typeof workerCatalog!=='function')
    throw new TypeError('Cloud experts require the durable enterprise Workspace and reviewed Worker catalog.');
  const update=fn=>store.update(s=>{s.cloudExperts??=[];s.cloudTeams??=[];return fn(s);});
  function viewExpert(expert) {
    const template=serviceIndex.get(expert.templateId);
    const registered=!!expert.workerId && availableWorkers(workerCatalog(),template,expert.serviceId)
      .some(x=>x.id===expert.workerId);
    return {...expert,template,runnerStatus:registered?'registered':'not_connected',runtimeReady:registered,
      delegatedActionsAvailable:registered && template.serviceIds.includes(expert.serviceId)};
  }
  function viewTeam(team) {
    const staffed=[team.leadId,...team.memberIds].map(x=>viewExpert(getExpert(store.read(),x)));
    const ready=staffed.filter(x=>x.runtimeReady).length;
    return {...team,members:staffed,registeredMembers:ready,
      runAvailable:false,readiness:ready===staffed.length?'awaiting_team_orchestrator':'workers_not_connected',
      note:'Team plans are configuration drafts; no parallel execution without a reviewed native Harness team DAG.'};
  }
  return {
    catalog() {
      const provider=workerCatalog();
      return {experts:EXPERT_TEMPLATES.map(x=>({
        ...x,workerOptions:x.serviceIds.flatMap(serviceId=>availableWorkers(provider,x,serviceId)
          .map(worker=>({serviceId,workerId:worker.id,name:worker.name}))),
        connectionRequired:x.serviceIds.length===0?'private_data_gateway_required':'reviewed_remote_worker',
      })),teams:TEAM_TEMPLATES,skills:EXPERT_SKILLS};
    },
    experts(){return (store.read().cloudExperts||[]).map(viewExpert);},
    teams(){return (store.read().cloudTeams||[]).map(viewTeam);},
    getExpert(id){return viewExpert(getExpert(store.read(),id));},
    getTeam(id){return viewTeam(getTeam(store.read(),id));},
    hire(input,actor) {
      if(!identity(actor)||!identity(input?.requestId)||input.publicDataConfirmed!==true)
        fail(400,'EXPLICIT_CONFIRMATION_REQUIRED','Stable request and confirmed public-only data boundary required.');
      const config=configureExpert(input,workerCatalog());
      const hash=fingerprint({actor,config});
      return update(state=>{
        const previous=state.cloudExperts.find(x=>x.requestId===input.requestId && x.createdBy===actor);
        if(previous){
          if(previous.requestFingerprint!==hash) fail(409,'IDEMPOTENCY_CONFLICT','This request id refers to another expert configuration.');
          return {expert:viewExpert(previous),duplicate:true};
        }
        if(state.cloudExperts.length>=100) fail(409,'EXPERT_LIMIT','This enterprise has reached its specialist capacity.');
        const at=stamp(),expert={id:randomUUID(),...config,revision:1,requestId:input.requestId,
          requestFingerprint:hash,createdBy:actor,createdAt:at,updatedAt:at};
        state.cloudExperts.push(expert);
        return {expert:viewExpert(expert),duplicate:false};
      });
    },
    configure(id,input,actor) {
      if(!identity(actor)) fail(403,'INVALID_ACTOR','Workspace actor required.');
      return update(state=>{
        const current=getExpert(state,id);
        if(revision(input?.expectedRevision)!==current.revision)
          fail(409,'REVISION_CONFLICT','Expert was modified. Reload before changing its settings.');
        const config=configureExpert(input,workerCatalog(),current);
        Object.assign(current,config,{revision:current.revision+1,updatedAt:stamp(),configuredBy:actor});
        return {expert:viewExpert(current)};
      });
    },
    formTeam(input,actor) {
      if(!identity(actor)||!identity(input?.requestId)) fail(400,'INVALID_INPUT','Stable actor and request required.');
      const hash=fingerprint({actor,body:input});
      return update(state=>{
        const previous=state.cloudTeams.find(x=>x.requestId===input.requestId && x.createdBy===actor);
        if(previous){
          if(previous.requestFingerprint!==hash) fail(409,'IDEMPOTENCY_CONFLICT','This request id refers to another team.');
          return {team:viewTeam(previous),duplicate:true};
        }
        const config=configureTeam(input,state);
        if(state.cloudTeams.length>=30) fail(409,'TEAM_LIMIT','Team count exceeds the reviewed single-enterprise maximum.');
        const at=stamp(),team={id:randomUUID(),...config,revision:1,requestId:input.requestId,requestFingerprint:hash,createdBy:actor,
          createdAt:at,updatedAt:at};
        state.cloudTeams.push(team);
        return {team:viewTeam(team),duplicate:false};
      });
    },
    configureTeam(id,input,actor) {
      if(!identity(actor)) fail(403,'INVALID_ACTOR','Workspace actor required.');
      return update(state=>{
        const current=getTeam(state,id);
        if(revision(input?.expectedRevision)!==current.revision)
          fail(409,'REVISION_CONFLICT','Team changed. Reload before updating.');
        const config=configureTeam(input,state,current);
        Object.assign(current,config,{revision:current.revision+1,updatedAt:stamp(),configuredBy:actor});
        return {team:viewTeam(current)};
      });
    },
    /**
     * Delegate to the existing reviewed single-Worker order machinery.
     * Configuration cannot bypass exact service, approved executor, public
     * consent, expert ceiling or subsequent admin approval/dispatch.
     * No direct SDK or model call is initiated by this action.
     */
    async delegateExpert(id,input,actor) {
      if(!identity(actor)||!only(input,['product','market','objective','budgetCredits','deadlineAt','requestId','publicDataConfirmed']))
        fail(400,'INVALID_DELEGATION','Only the exact published work-order fields are accepted.');
      if(input.publicDataConfirmed!==true || !identity(input.requestId))
        fail(400,'EXPLICIT_CONFIRMATION_REQUIRED','Public data consent and stable request identity required.');
      const expert=this.getExpert(id);
      if(!expert.runtimeReady||!expert.serviceId||!expert.workerId)
        fail(409,'WORKER_UNAVAILABLE','The expert has no reviewed budget-guarded cloud executor.');
      const ceiling=quota(input.budgetCredits,'Delegation ceiling',expert.maxCredits);
      if(!workerDesk || typeof workerDesk.create!=='function')
        fail(503,'WORKER_UNAVAILABLE','The service order platform is unavailable.');
      const response=await workerDesk.create({
        serviceId:expert.serviceId,workerId:expert.workerId,
        product:text(input.product,'Product',240),
        market:text(input.market,'Market',100),
        objective:text(input.objective,'Task goal',2500),
        budgetCredits:ceiling,deadlineAt:input.deadlineAt,
        publicDataConfirmed:true,requestId:input.requestId,
      },actor);
      await update(state=>{
        const current=getExpert(state,id);
        current.delegations??=[];
        if(!current.delegations.some(item=>item.orderId===response.order.id))
          current.delegations.push({orderId:response.order.id,at:stamp(),requestId:input.requestId,createdBy:actor});
      });
      return {...response,expertId:id,dispatchRequiresAdminApproval:true};
    },
    planTeam(id) {
      const team=viewTeam(getTeam(store.read(),id));
      const steps=team.members.map((member,index)=>{
        const template=serviceIndex.get(member.templateId);
        return {order:index+1,expertId:member.id,role:index===0?'leader':'member',title:member.alias,
          serviceId:member.serviceId,taskCeilingCredits:Math.min(member.maxCredits,team.taskCeilingCredits),
          output:template.result,runnerStatus:member.runnerStatus,
          approvalRequired:true};
      });
      return {teamId:team.id,mission:team.mission,projectBudgetCredits:team.budgetCredits,
        runnable:false,planningOnly:true,steps,
        blockers:[
          ...steps.filter(x=>x.runnerStatus==='not_connected').map(x=>x.title+' 尚未绑定已审核云执行器'),
          '团队 DAG / 人工审批节点尚未连接原生 Harness。仅提供配置计划，不执行任务、不计费。',
        ]};
    },
  };
}
