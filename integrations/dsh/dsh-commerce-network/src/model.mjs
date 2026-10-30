import { appendTrade } from './projection/trade.mjs';
import { buildCommerceGraph } from './projection/network.mjs';
export const KINDS={business_mandate:'业务委托',rfq:'询盘',sample:'样品',erp_order:'ERP 订单',factory:'工厂',distributor:'海外代理',personal_agent:'Personal AI Worker',service_order:'服务委托',product:'产品',market:'目标市场',channel:'销售渠道',worker:'执行任务',buyer:'买手',quote:'报价',order:'订单',approval:'决策',evidence:'证据'};
export const STATUSES={active:'生效中',scheduled:'待生效',received:'已收录',needs_info:'待补资料',qualified:'字段已核对',ready_for_quote:'可准备报价',closed:'已关闭',draft:'草稿',review_required:'待审阅',sending:'发送待核查',sent:'已发送',withdrawn:'已撤销',expired:'已到期',shipped:'已登记寄送',feedback_received:'已记录反馈',verified:'已核实',unverified:'待核验',planning:'规划中',proposed:'待授权',authorized:'已授权',queued:'待接单',claimed:'已接单',running:'执行中',delivered:'待验收',accepted:'已验收',rejected:'验收未通过',blocked:'待处理',failed:'失败',cancelled:'已取消',stop_requested:'停止中',endpoint_verified:'已连接',connected:'已连接',pending:'待处理',credential_issued:'等待连接',revoked:'已撤销',not_connected:'未连接',configured:'已配置',unconfigured:'待配置',paused:'已暂停',completed:'已完成',approved:'已批准',unknown:'待核对'};
export const ACTION_LABELS={public_web_research:'公开网络研究',read_granted_product_context:'读取授权产品资料',draft_outreach:'撰写触达草稿',classify_opted_in_replies:'整理已获许可的回复',summarize_rfq:'整理采购需求'};
export const EDGE_LABELS={business_link:'业务关联',submitted_rfq:'提交询盘',requested_product:'询问产品',quoted_for:'报价候选',independent_order:'独立交易记录',sample_request:'样品请求',sales_authorized:'业务授权',sales_proposed:'授权待确认',sales_revoked:'授权已撤销',execution_dependency:'前序验收后继续',service_requested:'服务委托',service_delegated:'任务分配',service_proposed:'待授权委托',targets_market:'目标市场',listed_in_plan:'产品上架计划',tracked_by:'持续追踪',generated_lead:'线索来源',requested_quote:'询价',converted_to_order:'订单',requires_approval:'待决策',supported_by:'来源证据'};
const EVENT_LABELS={'project.created':'创建了协作项目','plan.applied':'Assistant 已保存业务计划','party.recorded':'更新了商业主体资料','product.recorded':'更新了产品资料','route.recorded':'更新了市场渠道计划','agent.registered':'登记了 Personal AI Worker','agent.credential_issued':'已创建受限连接凭据','agent.connected':'Personal AI Worker 已连接','agent.revoked':'已撤销 Agent 访问','budget.updated':'已更新项目服务预算','grant.revoked':'已撤销委托资料授权','mandate.proposed':'提出了销售协作授权','mandate.approved':'已批准业务协作范围','mandate.revoked':'已撤销业务协作授权','work_order.proposed':'提出了新的服务委托','work_order.authorized':'已批准委托并预留预算','work_order.queued':'原生 Assistant 已调度委托','work_order.claimed':'Personal AI Worker 已领取任务','work_order.delivered':'已收到服务交付，等待验收','work_order.expired':'任务或租约已到期，需要核对','work_order.cancel_requested':'已请求取消委托','work_order.stopped':'已收到实际停止回执','work_order.reservation_resolved':'已核对停止情况并释放费用预留','delivery.accepted':'已验收实际交付','delivery.rejected':'本次交付未通过验收'};
const FAILURE_LABELS={lease_expired_no_automatic_retry:'执行租约已到期，系统不会自动重试。',task_expired:'任务已过期，未收到交付。',worker_reported_failure:'服务商报告执行失败，需核对停止回执。'};
export const failureText=order=>order?.status==='rejected'&&order.rejectionReason?`拒收原因：${order.rejectionReason}`:order?.status==='failed'?FAILURE_LABELS[order.failureReason]||'执行失败，请在对话中核对。':'';
export const eventLabel=event=>EVENT_LABELS[event.type]||event.summary||event.type||'业务记录已更新';
export const statusTone=value=>['verified','accepted','endpoint_verified','connected','completed','approved'].includes(value)?'green':['running','claimed','queued','authorized'].includes(value)?'blue':['failed','rejected','revoked'].includes(value)?'red':['proposed','pending','delivered','blocked','stop_requested'].includes(value)?'amber':'muted';
export function projectGraph(state) {
  if(!state?.projectId || !state.projects?.some(p=>p.id===state.projectId))return null;
  const network=state.commerceNetwork;
  const input={...state,...network?{commerceNetwork:{...network,agentServices:(network.agentServices||[]).map(agent=>({...agent,skillLabel:agent.skillLabel||(agent.skills||[]).map(x=>ACTION_LABELS[x]||x).join(' · ')}))}}:{}};
  const graph=buildCommerceGraph(input,state.projectId);
  const agents=new Map((network?.agentServices||[]).map(a=>[a.id,a]));
  const workOrders=new Map((network?.workOrders||[]).map(a=>[a.id,a]));
  for(const node of graph.nodes){
    if(node.kind==='personal_agent'){
      const agent=agents.get(node.refId);
      if(agent?.status==='revoked')node.status='revoked';
      else if(agent?.status==='credential_issued'&&!agent.endpointVerifiedAt)node.status='credential_issued';
      node.info={...node.info,providerName:network?.parties?.find(p=>p.id===agent?.providerPartyId)?.displayName||'',skills:agent?.skills||[]};
    }
    if(node.kind==='service_order'){
      const order=workOrders.get(node.refId);node.info={...node.info,brief:order?.brief||'',failure:failureText(order),allowedActions:order?.allowedActions||[],maximumMinor:order?.maximumMinor,currency:order?.currency};
    }
  }
  const ids=new Set(graph.nodes.map(n=>n.id));
  for(const order of network?.workOrders||[]){for(const predecessor of order.dependsOn||[]){
    const source=`service_order:${predecessor}`,target=`service_order:${order.id}`;
    if(ids.has(source)&&ids.has(target))graph.edges.push({id:`dependency:${predecessor}:${order.id}`,source,target,kind:'execution_dependency',status:workOrders.get(predecessor)?.status||'unknown'});
  }}
  return appendTrade(graph,state);
}
export function autoLayout(nodes) {
  const rank={factory:0,product:1,market:2,distributor:2,channel:3,personal_agent:3,service_order:4,worker:4,buyer:5,rfq:6,sample:8,erp_order:8,approval:5,evidence:5,quote:6,order:7};
  const rows=new Map();
  return [...nodes].sort((a,b)=>(rank[a.kind]??8)-(rank[b.kind]??8)||a.id.localeCompare(b.id)).map(n=>{
    const col=rank[n.kind]??8,row=rows.get(col)||0;rows.set(col,row+1);
    return {...n,position:{x:col*350,y:row*230+70}};
  });
}
export function initialViewport(graph) {
  if(graph?.viewport)return {...graph.viewport};
  const zoom=.9,nodes=graph?.nodes||[];
  const first=nodes.reduce((start,node)=>!start||node.position.x<start.position.x||node.position.x===start.position.x&&node.position.y<start.position.y?node:start,null);
  if(!first)return {x:32,y:96,zoom};
  // Start at readable cards in the first columns. Distant branches must not
  // shrink the entire network or move this entry view; overview is explicit.
  const nearby=nodes.filter(node=>node.position.x<=first.position.x+480&&Math.abs(node.position.y-first.position.y)<=320);
  const top=Math.min(...nearby.map(node=>node.position.y));
  return {x:32-first.position.x*zoom,y:96-top*zoom,zoom};
}
export function money(minor,currency='USD') {
  if(!Number.isSafeInteger(minor))return '待约定';
  try{return new Intl.NumberFormat('zh-CN',{style:'currency',currency,maximumFractionDigits:2}).format(minor/100);}catch{return `${(minor/100).toFixed(2)} ${currency}`;}
}
export function timestamp(value) { const date=new Date(value);return Number.isNaN(date.valueOf())?'时间未提供':new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date); }
export function selectedRecord(state,node) {
  if(!node)return null;
  const net=state?.commerceNetwork||{};
  const source={factory:net.parties,distributor:net.parties,personal_agent:net.agentServices,service_order:net.workOrders,product:state?.products,channel:state?.routes,buyer:state?.leads,quote:state?.quotes,order:state?.orders,evidence:state?.evidence,approval:state?.approvals}[node.kind];
  return source?.find(r=>r.id===node.refId)||null;
}
