// Safety gate for the unconfigured native frontend preview. No model transport.
export default function previewGate(pi) {
  pi.on('session_start',(_event,ctx)=>{
    const tools=pi.getAllTools().filter(t=>t.name.startsWith('workspace_'));
    ctx.ui.setStatus('workspace','Native OMP · '+tools.length+' plugin tools loaded · offline · model unconfigured · no HTTP');
  });
  pi.on('input',(_event,ctx)=>{ctx.ui.notify('Model is unconfigured. This native preview makes zero model requests. Use the existing bounded local entry with explicitly reviewed model configuration for execution.','warning');return {handled:true};});
  pi.on('before_agent_start',()=>{throw Error('NATIVE_PREVIEW_MODEL_UNCONFIGURED');});
  pi.on('user_bash',()=>({result:{output:'Native frontend preview: shell execution disabled.',exitCode:1,cancelled:false,truncated:false}}));
}
