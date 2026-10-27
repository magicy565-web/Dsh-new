// The canvas submits explicit user actions to the existing native session.
// No model, agent loop or synthetic conversation lives in this plugin client.
export function createNativePromptDispatcher(ctx) {
  const attempts=new Map();
  return async function submit(sessionId,text,requestId,signal) {
    if(typeof text!=='string'||!text.trim()||text.length>8000)throw new Error('请输入不超过 8000 字的具体要求。');
    const key=`${sessionId}:${requestId}`, fingerprint=JSON.stringify([sessionId,text]);
    const previous=attempts.get(key);
    if(previous){if(previous.fingerprint!==fingerprint)throw new Error('请求标识冲突，请核对当前会话。');return previous.promise;}
    if(attempts.size>=128)throw new Error('请继续使用左侧原生会话发送指令。');
    const binding=ctx.sessions.binding(sessionId);
    if(!binding||binding.sessionId!==sessionId||ctx.sidebarRight.mounted.getSnapshot()!==sessionId)throw new Error('请在当前原生会话中打开画布。');
    const promise=(async()=>{
      try{
        const result=await binding.session.prompt([{type:'text',text}], 'queue', signal, requestId);
        if(result?.ok===true && result.value?.accepted===true)return result;
        throw new Error(result?.error?.message || '原生会话未确认接收，请到左侧核对，勿重复提交。');
      }catch(error){throw new Error(error?.message||'接收结果未知，请到左侧会话核对。');}
    })();
    attempts.set(key,{fingerprint,promise});
    return promise;
  };
}

// Observe real successful tool receipts only to request a fresh authorized read.
// The receipt never directly changes canvas business state.
export function watchNativeCommerce(source,onChange) {
  const calls=new Map();let revision=-1,seq=-1,disposed=false;
  const sync=()=>{
    if(disposed)return;
    const snapshot=source.getSnapshot();
    if(snapshot.revision===revision)return;
    const initial=revision===-1;revision=snapshot.revision;
    if(snapshot.change?.kind==='replace')calls.clear();
    const entries=snapshot.change?.kind==='append'&&snapshot.change.entries?snapshot.change.entries:snapshot.entries;
    let changed=false;
    for(const entry of entries||[]){
      const event=entry?.type==='event'?entry.event:null;
      if(!event)continue;
      const data=event.data;
      if(event.type==='tool/call'&&typeof data?.callId==='string')calls.set(data.callId,data.name);
      if(event.type==='tool/ptc-dispatch-start'&&typeof data?.subCallId==='string')calls.set(data.subCallId,data.name);
      if(calls.size>512)calls.delete(calls.keys().next().value);
      if(!Number.isSafeInteger(event.seq))continue;
      if(event.seq>seq){
        const native=event.type==='tool/result'&&data?.message?.role==='tool'&&data.message.isError!==true&&/^commerce_network_/.test(calls.get(data.message.toolCallId)||'');
        const ptc=event.type==='tool/ptc-dispatch'&&data?.isError===false&&/^commerce_network_/.test(calls.get(data.subCallId)||'')&&calls.get(data.subCallId)===data.name;
        if(!initial&&snapshot.change?.kind==='append'&&(native||ptc))changed=true;
        seq=event.seq;
      }
    }
    if(changed)onChange();
  };
  sync();const unsubscribe=source.subscribe(sync);
  return ()=>{disposed=true;unsubscribe();calls.clear();};
}

export function nativeInstruction(projectId,text,selection) {
  const reference=selection?`当前选中节点 ${selection.id}，业务引用 ${selection.refId}（${selection.kind}）。`:'';
  return `${text}\n\n[Commerce Network 当前画布上下文]\n项目：${projectId||'尚未创建'}。${reference}\n请用 commerce_network_read 读取当前会话工作区，再使用 commerce_network_plan 或 commerce_network_propose_order 提交可追溯的业务计划。保留已有业务记录和手动布局。缺失的资料应在当前对话中询问。第三方 Agent 自报能力不能当作已核验。未获得批准的委托保持 proposed，不发送消息、不报价、不扣费。commerce_network_dispatch 只能在真实批准和连接核验完成后调度原生任务。`;
}
