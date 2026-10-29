// Render the actual Inspector; synthetic records only, no host or Worker calls.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/Inspector.jsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});
const require=createRequire(import.meta.url),module={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(require,module,module.exports);
const {Inspector}=module.exports;
const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://workspace.example.test/'});
const saved=new Map();
function expose(key,value){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
for(const key of ['window','document','navigator','HTMLElement','Element','Event','MouseEvent'])expose(key,dom.window[key]);
expose('IS_REACT_ACT_ENVIRONMENT',true);
const root=createRoot(document.getElementById('app'));
const actions=[];
const baseOrder={id:'test-order',projectId:'test-project',title:'TEST ONLY delivery',brief:'Review this synthetic delivery.',maximumMinor:0,currency:'USD',allowedActions:['public_web_research'],allowedResourceRefs:[]};
const button=label=>[...document.querySelectorAll('button')].find(item=>item.textContent===label);
async function render(status,busy=false){
  const order={...baseOrder,status};
  await act(async()=>root.render(React.createElement(Inspector,{
    node:{id:`service_order:${order.id}`,kind:'service_order',refId:order.id,title:order.title,status},
    state:{commerceNetwork:{workOrders:[order]},events:[],deliverables:[]},
    busy,onClose(){},onAsk(){},onFocus(){},onArtifact(){},onAction:(command,record)=>actions.push({command,record}),
  })));
  return order;
}
async function click(label){
  const target=button(label);
  assert.ok(target,`Expected action: ${label}`);
  await act(async()=>target.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
}
try{
  const delivered=await render('delivered');
  assert.ok(!button('取消这项委托'),'delivered work must be reviewed, not cancelled');
  await click('验收交付');await click('拒收交付');
  assert.deepEqual(actions,[{command:'accept_delivery',record:delivered},{command:'reject_delivery',record:delivered}]);

  for(const status of ['proposed','authorized','queued','claimed','running']){
    const order=await render(status);
    assert.ok(!button('验收交付'),`${status} must not offer acceptance before delivery`);
    assert.ok(!button('拒收交付'),`${status} must not offer rejection before delivery`);
    await click('取消这项委托');
    assert.deepEqual(actions.at(-1),{command:'cancel_order',record:order});
  }
  for(const status of ['accepted','rejected','stop_requested','cancelled','failed']){
    await render(status);
    assert.ok(!button('取消这项委托'),`${status} must not offer a new cancellation`);
    assert.ok(!button('验收交付'),`${status} must not offer repeat acceptance`);
    assert.ok(!button('拒收交付'),`${status} must not offer repeat rejection`);
  }
  const count=actions.length;
  await render('delivered',true);
  assert.ok(button('验收交付').disabled);assert.ok(button('拒收交付').disabled);
  await click('验收交付');await click('拒收交付');
  await render('running',true);
  assert.ok(button('取消这项委托').disabled);await click('取消这项委托');
  assert.equal(actions.length,count,'busy controls must not dispatch another action');
  console.log(JSON.stringify({ok:true,checks:['delivered-review-only','review-action-record','pre-delivery-cancellation','terminal-and-stopping-actions','busy-actions-disabled']}));
}finally{
  await act(async()=>root.unmount());dom.window.close();
  for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
}
