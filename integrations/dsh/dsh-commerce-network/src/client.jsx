import React,{useCallback,useEffect} from 'react';
import {Network,Sparkles} from 'lucide-react';
import {CommerceApp} from './CommerceApp.jsx';
import {AIWork} from './AIWork.jsx';
import {createNativePromptDispatcher,watchNativeCommerce} from './native.mjs';

export const TAB_ID='dsh-commerce-network/canvas';
export const TAB_KIND='commerce-network';
export const AI_TAB_ID='dsh-commerce-network/ai-work';
export const AI_TAB_KIND='ai-work';
const NAMESPACE='commerceNetwork';

class CanvasBoundary extends React.Component {
  state={error:false};
  static getDerivedStateFromError(){return {error:true};}
  render(){return this.state.error?<div style={{padding:28,fontFamily:'system-ui',lineHeight:1.8,color:'#63745f'}}><h3 style={{fontSize:16}}>画布暂时无法显示</h3><p style={{fontSize:12}}>数据与原生会话仍保留。请重新读取画布。</p><button onClick={()=>this.setState({error:false})} style={{padding:'7px 12px',border:'1px solid #dce4d7',borderRadius:7,background:'#fff',cursor:'pointer'}}>重新打开</button></div>:this.props.children;}
}
function CanvasTab(props){
  const {tab}=props.useTabInfo();
  const bindRefresh=useCallback(fn=>tab.actions.bindCommands({refresh:fn}),[tab.actions]);
  return <CanvasBoundary key={props.sessionId}><CommerceApp sessionId={props.sessionId} active={tab.visible} tabSignal={tab.signal} bindRefresh={bindRefresh} submitPrompt={props.submitPrompt} watchChanges={props.watchChanges}/></CanvasBoundary>;
}
function AIWorkTab(props){
  const {tab}=props.useTabInfo();
  const bindRefresh=useCallback(fn=>tab.actions.bindCommands({refresh:fn}),[tab.actions]);
  return <CanvasBoundary key={props.sessionId}><AIWork sessionId={props.sessionId} active={tab.visible} tabSignal={tab.signal} bindRefresh={bindRefresh} submitPrompt={props.submitPrompt} watchChanges={props.watchChanges} openCanvas={props.openCanvas}/></CanvasBoundary>;
}
function OpenCanvasAction(props){
  useEffect(()=>props.watchChanges?.(props.open),[props.watchChanges,props.open]);
  return <button type="button" onClick={props.open} title="打开商业协作画布" aria-label="打开商业协作画布" style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:32,height:32,padding:5,border:0,borderRadius:7,background:'transparent',color:'inherit',cursor:'pointer'}}><Network size={19} strokeWidth={1.65}/></button>;
}
function OpenAIWorkAction({open}){
  return <button type="button" onClick={open} title="打开 AI Work" aria-label="打开 AI Work" style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:32,height:32,padding:5,border:0,borderRadius:7,background:'transparent',color:'inherit',cursor:'pointer'}}><Sparkles size={18} strokeWidth={1.65}/></button>;
}
export function apply(ctx){
  const submit=createNativePromptDispatcher(ctx);
  const watchers=new Set();
  function watch(sessionId,listener){
    const controller=new AbortController();
    const reference=ctx.sessions.retain(sessionId,{source:'commerce-network-canvas',signal:controller.signal});
    let stop,disposed=false;
    void reference.ready.then(binding=>{
      if(controller.signal.aborted||binding.sessionId!==sessionId)return;
      stop=watchNativeCommerce(binding.eventSource,listener);
    }).catch(()=>{/* Authorized HTTP reads remain the authority if event retention fails. */});
    const dispose=()=>{if(disposed)return;disposed=true;controller.abort();stop?.();reference.release();watchers.delete(dispose);};
    watchers.add(dispose);return dispose;
  }
  const open=sessionId=>{if(ctx.sidebarRight.mounted.getSnapshot()===sessionId)ctx.sidebarRight.openTab(TAB_KIND);};
  const openAI=sessionId=>{if(ctx.sidebarRight.mounted.getSnapshot()===sessionId)ctx.sidebarRight.openTab(AI_TAB_KIND);};
  ctx.effect(()=>()=>{for(const stop of [...watchers])stop();},'commerce-network: native session bindings');
  ctx.effect(()=>ctx.locale.register(NAMESPACE,{zh:{title:'商业网络',aiWork:'AI Work'},en:{title:'Commerce Network',aiWork:'AI Work'}}),'commerce-network: locale');
  const t=ctx.locale.bind(NAMESPACE);
  ctx.effect(()=>ctx.sidebarRightTabs.register({id:TAB_ID,kind:TAB_KIND,title:()=>t('title'),keepMounted:true,guide:[{id:'canvas',order:42,title:()=>t('title'),description:()=> '用当前会话连接工厂、海外代理商与 Personal AI Worker。'}]}),'commerce-network: sidebar type');
  ctx.effect(()=>ctx.sidebarRightTabs.register({id:AI_TAB_ID,kind:AI_TAB_KIND,title:()=>t('aiWork'),keepMounted:true,guide:[{id:'ai-work',order:41,title:()=>t('aiWork'),description:()=> '查看 Grok Bot、Muse Agent 与工作区任务。'}]}),'commerce-network: AI Work sidebar type');
  ctx.effect(()=>ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:TAB_ID,locale:NAMESPACE,inject:sessionId=>({submitPrompt:(text,id,signal)=>submit(sessionId,text,id,signal),watchChanges:listener=>watch(sessionId,listener)})},CanvasTab)),'commerce-network: right canvas');
  ctx.effect(()=>ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:AI_TAB_ID,locale:NAMESPACE,inject:sessionId=>({submitPrompt:(text,id,signal)=>submit(sessionId,text,id,signal),watchChanges:listener=>watch(sessionId,listener),openCanvas:()=>open(sessionId)})},AIWorkTab)),'commerce-network: AI Work');
  ctx.effect(()=>ctx.slots.inject('conversation.session.header.actions',()=>ctx.slots.register({name:'conversation.session.header.actions',id:'commerce-network-canvas',order:42,locale:NAMESPACE,inject:sessionId=>({open:()=>open(sessionId),watchChanges:listener=>watch(sessionId,listener)})},OpenCanvasAction)),'commerce-network: conversation action');
  ctx.effect(()=>ctx.slots.inject('conversation.session.header.actions',()=>ctx.slots.register({name:'conversation.session.header.actions',id:'ai-work',order:41,locale:NAMESPACE,inject:sessionId=>({open:()=>openAI(sessionId)})},OpenAIWorkAction)),'commerce-network: AI Work action');
}
export const inject=['slots','locale','sidebarRightTabs','sidebarRight','sessions'];
