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
      if(body?.email!==email||body?.password!==password)return send(401,{message:'Synthetic fixture input mismatch'});
      return send(200,{token});
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
test('invalid local credentials are INPUT_REFUSED with no HTTP attempt',async()=>{
  for(const invalid of [{email:'',password},{email,password:''},{email:'not-an-email',password},{email,password:'synthetic\nsecond-line'},{email,password:'synthetic\0value'}]){
    let called=false;
    const r=await retainedProductCheck({baseUrl:'http://127.0.0.1:1',...invalid,fetchImpl:()=>{called=true;throw Error('must not call');}});
    assert.equal(called,false);assert.equal(r.status,'input_refused');assert.equal(r.reason,'INPUT_REFUSED');
    assert.equal(r.failure.stage,'input');assert.equal(r.failure.kind,'input_refused');assert.deepEqual(r.requests,[]);assert.equal(r.creation,'not_attempted');
  }
});

// Real PTY, native Node readline, finite loopback fixture. No input trace is
// returned: only the child's already-redacted report and process exit status.
async function interactivePty(baseUrl, scenario) {
  const program=`import json,os,pty,select,subprocess,sys,time
p=json.load(sys.stdin);master,slave=pty.openpty();output_master,output_slave=pty.openpty() if p['scenario']=='stream-eof-partial' else (master,slave)
child=subprocess.Popen(p['args'],stdin=slave,stdout=output_slave,stderr=output_slave,env={'PATH':os.environ['PATH'],'HOME':'/tmp'});os.close(slave)
if output_slave!=slave:os.close(output_slave)
output=b'';email_sent=False;password_sent=False;scheduled=[];deadline=time.monotonic()+5

def write(value):os.write(master,value)
def schedule(delay,value):scheduled.append((time.monotonic()+delay,value))
def input_email():
 name=p['scenario'];e=p['email'].encode();w=p['password'].encode()
 if name.startswith('paste-'):
  sep={'paste-LF':b'\\n','paste-CR':b'\\r','paste-CRLF':b'\\r\\n','paste-extra-line':b'\\n'}[name]
  write(e+sep+w+sep+(b'extra-synthetic-line\\n' if name=='paste-extra-line' else b''))
 elif name=='cancel-email':write(b'\\x03')
 elif name=='eof-email':write(b'\\x04')
 elif name=='empty-email':write(b'\\n')
 elif name=='invalid-email':write(b'not-an-email\\n')
 elif name=='characters':
  for i,c in enumerate(e+b'\\n'):schedule(i*0.002,bytes([c]))
 elif name in ['LF','empty-password','cancel-password','cancel-partial','eof-password']:write(e+b'\\n')
 elif name=='CRLF':write(e+b'\\r\\n')
 else:write(e+b'\\r')
def input_password():
 name=p['scenario'];w=p['password'].encode()
 if name.startswith('paste-'):return
 if name in ['cancel-email','eof-email']:return
 if name in ['cancel-password','cancel-partial']:
  if name=='cancel-partial':write(w[:5])
  schedule(0.03,b'\\x03')
 elif name=='eof-password':write(b'\\x04')
 elif name=='empty-password':write(b'\\n')
 elif name=='stream-eof-partial':write(w[:5]);schedule(0.03,None)
 elif name=='partial-before-delayed-LF':
  write(w[:5]);schedule(0.2,b'\\n');schedule(0.25,w[5:]+b'\\r')
 elif name.startswith('split-CRLF-'):
  delay=float(name.split('-')[-1])/1000
  schedule(delay,b'\\n');schedule(delay+0.03,w+b'\\r\\n')
 elif name=='characters':
  for i,c in enumerate(w+b'\\n'):schedule(i*0.002,bytes([c]))
 elif name in ['LF','empty-email','invalid-email']:write(w+b'\\n')
 elif name=='CRLF':write(w+b'\\r\\n')
 else:write(w+b'\\r')
try:
 while time.monotonic()<deadline:
  ready,_,_=select.select([output_master],[],[],0.01)
  if ready:
   try:chunk=os.read(output_master,65536)
   except OSError:break
   if not chunk:break
   output+=chunk
  if b'Admin email (hidden): ' in output and not email_sent:email_sent=True;input_email()
  if b'Admin password (hidden): ' in output and not password_sent:password_sent=True;input_password()
  for when,value in scheduled[:]:
   if time.monotonic()>=when:
    scheduled.remove((when,value))
    if child.poll() is None:
     if value is None:os.close(master);master=None
     else:write(value)
  if child.poll() is not None:break
 timed_out=time.monotonic()>=deadline and child.poll() is None
 if timed_out:child.terminate()
 code=child.wait(timeout=3)
 print(json.dumps({'exit':code,'output':output.decode('utf8','replace'),'timedOut':timed_out}))
finally:
 if child.poll() is None:child.kill();child.wait()
 if master is not None:os.close(master)
 if output_master!=master:os.close(output_master)
`;
  const child=spawn('python3',['-c',program],{env:{PATH:process.env.PATH,HOME:'/tmp'},stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
  child.stdin.end(JSON.stringify({args:[process.execPath,process.cwd()+'/scripts/medusa-catalog-interactive-smoke.mjs','--confirm-keep-synthetic-product','--base-url',baseUrl],email,password,scenario}));
  assert.equal(await new Promise(r=>child.on('exit',r)),0,'PTY harness must complete without a traceback');assert.equal(err,'');
  return JSON.parse(out);
}
const successfulInputs=['CR','LF','CRLF','split-CRLF-30','split-CRLF-200','split-CRLF-1000','characters','paste-LF','paste-CR','paste-CRLF'];
for(const scenario of [...successfulInputs,'auth-fail','partial-before-delayed-LF','paste-extra-line','empty-email','invalid-email','empty-password','cancel-email','cancel-password','cancel-partial','eof-email','eof-password','stream-eof-partial'])test('real PTY hidden input: '+scenario,async t=>{
  const authFailure=scenario==='auth-fail',passes=successfulInputs.includes(scenario);
  const f=await fixture(t,authFailure?'auth-fail':'normal');
  const r=await interactivePty(f.baseUrl,scenario);
  assert.equal(r.timedOut,false,'input must complete or refuse without hanging');
  assert.equal(f.calls.length,passes?5:authFailure?1:0,'HTTP attempt count must respect input refusal and the five-request contract');
  assert.equal(r.exit,passes?0:authFailure?1:2);
  for(const value of [email,password,token,encodeURIComponent(password),Buffer.from(password).toString('base64')])assert.ok(!r.output.includes(value),'terminal must not expose synthetic credentials');
  const report=JSON.parse(r.output.slice(r.output.indexOf('{'),r.output.lastIndexOf('}')+1));
  assert.equal(report.status,passes?'passed':authFailure?'authentication_refused':scenario.startsWith('cancel-')?'cancelled':'input_refused');
  if(passes||authFailure)assert.ok(f.calls[0].body?.email===email&&f.calls[0].body?.password===password,'actual synthetic authentication payload must match both complete inputs exactly');
  else {
    assert.deepEqual(report.requests,[]);assert.equal(report.creation,'not_attempted');assert.equal(report.failure.stage,'input');
    assert.equal(report.reason,scenario.startsWith('cancel-')?'INPUT_CANCELLED':'INPUT_REFUSED');
    assert.ok(!r.output.includes('transport_or_response_unknown'));
  }
  assert.equal(Boolean(f.product()),passes);assert.ok(!f.calls.some(c=>c.method==='DELETE'));
});
