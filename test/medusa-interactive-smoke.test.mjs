import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { loopbackOrigin, retainedProductCheck, productCreatePayload, validationFields } from '../scripts/medusa-catalog-interactive-smoke.mjs';
const email='operator@example.test', password='synthetic-only-password', token='synthetic-only-native-token';
async function fixture(t, mode='normal', abort) {
  const calls=[]; let product;
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=raw?JSON.parse(raw):undefined;calls.push({method:req.method,path:req.url,body});res.setHeader('content-type','application/json');
    const send=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
    if(req.url==='/auth/user/emailpass') {
      if(mode==='auth-fail')return send(401,{message:email+password+token});
      if(mode==='mfa')return send(200,{token,mfa_required:true});
      if(mode==='redirect'){res.writeHead(302,{Location:'http://127.0.0.1:1/never'});return res.end();}
      assert.deepEqual(body,{email,password});return send(200,{token});
    }
    if(req.headers.authorization!=='Bearer '+token)return send(401,{});
    if(req.url==='/admin/products'&&req.method==='POST') {
      if(mode==='http400')return send(400,{type:'invalid_data',message:'Product options are not provided for: ['+email+password+token+'].'});
      product={...body,id:'prod_acceptance123'};if(mode==='foreign-create')product.metadata={};return send(200,{product});
    }
    if(req.url.startsWith('/admin/products/prod_acceptance123?')&&req.method==='GET') {
      if(mode==='foreign-read')return send(200,{product:{...product,handle:'someone-else'}});
      if(mode==='cancel')abort.abort();return send(200,{product});
    }
    if(req.url==='/admin/products/prod_acceptance123'&&req.method==='POST') {product={...product,...body};return send(200,{product});}
    send(404,{});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
  return {baseUrl:'http://127.0.0.1:'+server.address().port,calls,product:()=>product};
}
test('retained API subset creates and edits only its own synthetic draft, rereads exactly and never deletes or lists business records',async t=>{
  const f=await fixture(t),r=await retainedProductCheck({...f,email,password});
  assert.equal(r.ok,true);assert.equal(r.retained,true);assert.equal(r.checks.length,5);
  assert.equal(f.calls.length,5);assert.deepEqual(f.calls.map(c=>c.method),['POST','POST','GET','POST','GET']);
  assert.equal(f.calls[1].body.status,'draft');assert.equal(f.calls[1].body.metadata.synthetic,true);
  assert.deepEqual(f.calls[1].body,productCreatePayload(r.marker));
  assert.deepEqual(f.calls[1].body.options,[{title:'Acceptance',values:['Synthetic']}]);assert.deepEqual(f.calls[1].body.variants,[]);
  assert.deepEqual(r.requests.map(q=>q.httpStatus),[200,200,200,200,200]);
  assert.deepEqual(Object.keys(f.calls[3].body).sort(),['subtitle','title']);
  assert.equal(f.product().id,r.productId);assert.equal(f.product().handle,r.marker);assert.equal(f.product().status,'draft');
  assert.equal(r.clientUseWindowSeconds,120);assert.equal(r.serverTokenExpiry,'unchanged');
  for(const value of [email,password,token])assert.ok(!JSON.stringify(r).includes(value));
});
test('HTTP failure reports status and only fixed validation fields without retry or assuming no write',async t=>{
  const f=await fixture(t,'http400'),r=await retainedProductCheck({...f,email,password});
  assert.equal(r.ok,false);assert.equal(f.calls.length,2);assert.equal(r.creation,'unknown');
  assert.deepEqual(r.requests,[{stage:'authentication',httpStatus:200},{stage:'create',httpStatus:400}]);
  assert.deepEqual(r.failure,{stage:'create',httpStatus:400,kind:'http_rejected',validationFields:['options']});
  for(const value of [email,password,token,encodeURIComponent(password),Buffer.from(password).toString('base64')])assert.ok(!JSON.stringify(r).includes(value));
});
test('validation diagnostic allowlists root fields rather than echoing untrusted issue paths or messages',()=>{
  assert.deepEqual(validationFields({issues:[{path:[password]},{path:['options',0,'title']},{path:['variants',0,'prices']}],message:"Field 'status' is required; Field '"+token+"' is required"}),['options','status','variants']);
  assert.deepEqual(validationFields({message:"Expected type for field 'options, 0, title', got private value"}),['options']);
  assert.deepEqual(validationFields({message:password+token}),[]);
});
for(const mode of ['auth-fail','mfa','redirect','foreign-create','foreign-read','cancel'])test(mode+' refuses without further writes and never emits a response credential',async t=>{
  const abort=new AbortController(),f=await fixture(t,mode,abort),r=await retainedProductCheck({...f,email,password,signal:abort.signal});
  assert.equal(r.ok,false);assert.ok(f.calls.length<4);assert.ok(!f.calls.some(c=>c.method==='DELETE'));
  if(['auth-fail','mfa','redirect'].includes(mode))assert.equal(f.calls.length,1);
  for(const value of [email,password,token])assert.ok(!JSON.stringify(r).includes(value));
});
test('URL/argv/noninteractive guards reject credentials supplied outside hidden prompts',()=>{
  for(const url of ['https://example.test','http://user:secret@127.0.0.1:9000','http://127.0.0.1:9000/admin','http://127.0.0.1:9000?secret=x'])assert.throws(()=>loopbackOrigin(url));
  const env={PATH:process.env.PATH,HOME:'/tmp',MEDUSA_ADMIN_EMAIL:email,MEDUSA_ADMIN_PASSWORD:password};
  const r=spawnSync(process.execPath,['scripts/medusa-catalog-interactive-smoke.mjs','--confirm-keep-synthetic-product'],{env,encoding:'utf8'});
  assert.equal(r.status,2);assert.match(r.stderr,/PRIVATE|INTERACTIVE/);for(const v of [email,password])assert.ok(!(r.stdout+r.stderr).includes(v));
});
for(const mode of ['normal','auth-fail'])test('real PTY hides both inputs and safely completes '+mode+' against a finite local native-API stand-in',async t=>{
  const f=await fixture(t,mode);
  const program=`import json,os,pty,select,subprocess,sys,time
p=json.load(sys.stdin);master,slave=pty.openpty();child=subprocess.Popen(p['args'],stdin=slave,stdout=slave,stderr=slave,env={'PATH':os.environ['PATH'],'HOME':'/tmp'});os.close(slave);output=b'';sent_email=False;sent_password=False;end=time.monotonic()+15
try:
 while time.monotonic()<end:
  ready,_,_=select.select([master],[],[],0.1)
  if ready:
   try:chunk=os.read(master,65536)
   except OSError:break
   if not chunk:break
   output+=chunk
  if b'Admin email (hidden): ' in output and not sent_email:os.write(master,p['email'].encode()+b'\\r');sent_email=True
  if b'Admin password (hidden): ' in output and not sent_password:os.write(master,p['password'].encode()+b'\\r');sent_password=True
  if child.poll() is not None:break
 if child.poll() is None:child.terminate()
 code=child.wait(timeout=3)
 print(json.dumps({'exit':code,'output':output.decode('utf8','replace'),'sent':sent_email and sent_password}))
finally:os.close(master)
`;
  const child=spawn('python3',['-c',program],{env:{PATH:process.env.PATH,HOME:'/tmp'},stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
  child.stdin.end(JSON.stringify({args:[process.execPath,process.cwd()+'/scripts/medusa-catalog-interactive-smoke.mjs','--confirm-keep-synthetic-product','--base-url',f.baseUrl],email,password}));
  assert.equal(await new Promise(r=>child.on('exit',r)),0,err);const r=JSON.parse(out);
  assert.equal(r.sent,true);assert.equal(r.exit,mode==='normal'?0:1,r.output);assert.match(r.output,mode==='normal'?/"passed"/:/"authentication_refused"/);
  for(const value of [email,password,token])assert.ok(!r.output.includes(value));
  assert.equal(f.calls.length,mode==='normal'?5:1);assert.equal(Boolean(f.product()),mode==='normal');
});
