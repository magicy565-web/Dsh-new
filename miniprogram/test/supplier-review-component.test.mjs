// Actual compiled native component callbacks; not an official WeChat runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { blankSupplierProfile } from '../../server/supplier-profile.mjs';
function fixture() {
  const file = new URL('../../release/miniprogram/components/supplier-public-review/index.js', import.meta.url); let options;
  vm.runInNewContext(readFileSync(file, 'utf8'), {exports:{},require:createRequire(file),Component(value){options=value;},WeakMap,JSON,Number});
  const events=[], component={data:{...options.data,busy:false,uncertain:false},setData(value){Object.assign(this.data,structuredClone(value));},triggerEvent(name,value){events.push({name,value:value?structuredClone(value):null});}};
  Object.assign(component,options.methods);return{component,events,load(value){options.properties.scope.observer.call(component,value);}};
}
const scope=()=>({id:'explicit-local-review-target',revision:2,profile:{...blankSupplierProfile(),name:'真实后端预览输入',consumerPrice:'12.30',currency:'USD'}});
test('preview field checks start empty, exact confirmed selection excludes private supply fields',()=>{
  const f=fixture();f.load(scope());f.component.confirm();assert.equal(f.events.length,0);
  f.component.select({detail:{value:['name','consumerPrice','supplierMoq','wholesaleUnitPrice']}});f.component.confirm();
  assert.deepEqual(f.events[0],{name:'preview',value:{id:scope().id,expectedRevision:2,confirmed:true,publicFields:['name','consumerPrice']}});
  assert.ok(f.component.data.fields.find(value=>value.field==='consumerPrice').content.includes('12.30 USD'));
});
test('unchanged polling preserves checks, changed original facts/revision resets; uncertain state emits no mutation',()=>{
  const f=fixture(),value=scope();f.load(value);f.component.select({detail:{value:['name']}});f.load(value);assert.deepEqual(f.component.data.selected,['name']);
  f.load({...value,revision:3});assert.deepEqual(f.component.data.selected,[]);
  f.component.data.uncertain=true;f.component.select({detail:{value:['name']}});f.component.confirm();assert.equal(f.events.length,0);
  f.component.data.uncertain=false;f.component.close();f.load(value);assert.deepEqual(f.component.data.selected,[]);assert.equal(f.events[0].name,'close');
});
