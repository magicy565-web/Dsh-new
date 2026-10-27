import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativePromptDispatcher,watchNativeCommerce,nativeInstruction} from '../src/native.mjs';
import {projectGraph,autoLayout,initialViewport,STATUSES,ACTION_LABELS} from '../src/model.mjs';

function context(){let calls=0,mounted='native-1';const session={prompt:async()=>{calls++;return {ok:true,value:{accepted:true}};}};return {ctx:{sessions:{binding:id=>({sessionId:id,session})},sidebarRight:{mounted:{getSnapshot:()=>mounted}}},calls:()=>calls,setMounted:id=>{mounted=id;}};}
test('explicit native actions deduplicate without a second model session',async()=>{
  const h=context(),submit=createNativePromptDispatcher(h.ctx);
  await Promise.all([submit('native-1','读取网络','request-1'),submit('native-1','读取网络','request-1')]);
  assert.equal(h.calls(),1);
  await assert.rejects(submit('native-1','修改预算','request-1'),/冲突/);
  assert.equal(h.calls(),1);
});
test('an inactive session cannot submit a canvas instruction',async()=>{const h=context();h.setMounted('native-2');await assert.rejects(createNativePromptDispatcher(h.ctx)('native-1','读取','request-1'),/当前原生会话/);assert.equal(h.calls(),0);});
test('native receipt observer only requests a new read for paired new successful calls',()=>{
  let snapshot={revision:0,entries:[],change:{kind:'replace'}},subscriber,changes=0;
  const source={getSnapshot:()=>snapshot,subscribe:fn=>{subscriber=fn;return()=>{subscriber=null;};}};
  const stop=watchNativeCommerce(source,()=>changes++);
  const append=(events)=>{const entries=events.map(event=>({type:'event',event}));snapshot={revision:snapshot.revision+1,entries:[...snapshot.entries,...entries],change:{kind:'append',entries}};subscriber();};
  append([{seq:1,type:'tool/result',data:{message:{role:'tool',toolCallId:'unknown',content:[]}}}]);assert.equal(changes,0);
  append([{seq:2,type:'tool/call',data:{callId:'a',name:'commerce_network_plan'}},{seq:3,type:'tool/result',data:{message:{role:'tool',toolCallId:'a',isError:true,content:[]}}}]);assert.equal(changes,0);
  append([{seq:4,type:'tool/call',data:{callId:'b',name:'commerce_network_plan'}},{seq:5,type:'tool/result',data:{message:{role:'tool',toolCallId:'b',content:[]}}}]);assert.equal(changes,1);
  stop();assert.equal(subscriber,null);
});
test('native prompt names match shipped tools and avoid nonexistent general command',()=>{const text=nativeInstruction('project','扩展网络');assert.match(text,/commerce_network_plan/);assert.match(text,/commerce_network_dispatch/);assert.doesNotMatch(text,/commerce_network_command/);});
function fixture(){return {revision:1,projectId:'p1',projects:[{id:'p1',name:'TEST ONLY'}],products:[],routes:[],canvasLayouts:[],commerceNetwork:{projectId:'p1',revision:1,parties:[{id:'f1',projectId:'p1',type:'factory',displayName:'TEST factory'},{id:'provider',projectId:'p1',type:'provider',displayName:'TEST provider'}],agentServices:[{id:'a1',projectId:'p1',providerPartyId:'provider',displayName:'TEST agent',skills:['public_web_research'],protocol:'pull_gateway',status:'pending'}],workOrders:[{id:'o1',projectId:'p1',requesterPartyId:'f1',agentServiceId:'a1',title:'TEST research',status:'proposed',allowedActions:['public_web_research'],allowedResourceRefs:[],maximumMinor:0,currency:'USD'},{id:'o2',projectId:'p1',requesterPartyId:'f1',agentServiceId:'a1',title:'TEST followup',status:'proposed',dependsOn:['o1']}],salesAuthorizations:[],layoutWriteSupported:true,layoutContractVersion:'commerce-layout-v1'}};}
test('no business records are fabricated by an empty canvas',()=>{assert.equal(projectGraph({projects:[],projectId:null}),null);const state=fixture();state.commerceNetwork.parties=[];state.commerceNetwork.agentServices=[];state.commerceNetwork.workOrders=[];assert.equal(projectGraph(state).nodes.length,0);});
test('explicit execution dependencies render between the actual service orders',()=>{const graph=projectGraph(fixture());assert.equal(graph.nodes.length,4);assert.deepEqual(graph.edges.find(e=>e.kind==='execution_dependency'),{id:'dependency:o1:o2',source:'service_order:o1',target:'service_order:o2',kind:'execution_dependency',status:'proposed'});assert.equal(graph.nodes.find(n=>n.kind==='personal_agent').info.skill,'公开网络研究');});
test('unproven completed work cannot display accepted and revoked connections stay revoked',()=>{const state=fixture();state.commerceNetwork.workOrders[0].status='accepted';state.commerceNetwork.agentServices[0].status='revoked';state.commerceNetwork.agentServices[0].endpointVerifiedAt='2026-10-28';state.commerceNetwork.agentServices[0].endpointVerificationReceiptId='r1';const graph=projectGraph(state);assert.equal(graph.nodes.find(n=>n.refId==='o1').status,'blocked');assert.equal(graph.nodes.find(n=>n.refId==='a1').status,'revoked');});
test('saved coordinates survive source projection and auto layout is deterministic',()=>{const state=fixture();state.canvasLayouts=[{projectId:'p1',revision:2,nodes:[{id:'factory:f1',position:{x:9,y:71}}]}];const graph=projectGraph(state);assert.deepEqual(graph.nodes.find(n=>n.id==='factory:f1').position,{x:9,y:71});assert.deepEqual(autoLayout(graph.nodes),autoLayout([...graph.nodes].reverse()));});
test('first view keeps the source and product readable in a 720px sidebar as the network grows',()=>{
  const graph={nodes:[{id:'factory:f1',position:{x:-400,y:395}},{id:'product:p1',position:{x:0,y:110}},{id:'service_order:o1',position:{x:1500,y:180}}]};
  const before=structuredClone(graph),viewport=initialViewport(graph);
  assert.ok(viewport.zoom>=.85,'card text must not be reduced to overview size');
  for(const node of graph.nodes.slice(0,2)){
    const x=node.position.x*viewport.zoom+viewport.x,y=node.position.y*viewport.zoom+viewport.y;
    assert.ok(x>=24&&x+270*viewport.zoom<=720,'first source and product cards fit horizontally');
    assert.ok(y>=80&&y+185*viewport.zoom<=795,'first cards remain below the search and above the canvas bottom');
  }
  assert.deepEqual(initialViewport({nodes:[...graph.nodes,{id:'order:far',position:{x:12000,y:-5000}}].reverse()}),viewport,'remote branches cannot zoom or pan the first view');
  assert.deepEqual(graph,before,'the camera must not move any graph nodes');
});
test('a saved user viewport is preserved exactly even at overview scale',()=>{
  const state=fixture();state.canvasLayouts=[{projectId:'p1',revision:2,nodes:[],viewport:{x:-173.25,y:62.5,zoom:.28}}];
  const graph=projectGraph(state),viewport=initialViewport(graph);
  assert.deepEqual(viewport,state.canvasLayouts[0].viewport);
  assert.notEqual(viewport,graph.viewport,'the starting camera must not mutate the stored viewport object');
});
test('approval receipt projects a business mandate without claiming legal signature',()=>{const state=fixture();state.commerceNetwork.parties.push({id:'d1',projectId:'p1',type:'distributor',displayName:'TEST distributor'});state.commerceNetwork.salesAuthorizations=[{id:'m1',projectId:'p1',factoryPartyId:'f1',distributorPartyId:'d1',status:'active',approvalReceiptId:'r1',approvedAt:'2026-10-28T00:00:00Z'}];assert.equal(projectGraph(state).edges.find(e=>e.id==='mandate:m1').kind,'sales_authorized');});
