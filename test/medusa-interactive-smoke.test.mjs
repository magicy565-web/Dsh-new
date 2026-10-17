import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { loopbackOrigin, retainedProductCheck, productCreatePayload, validationFields } from '../scripts/medusa-catalog-interactive-smoke.mjs';
const email='operator@example.test', password='Q7v9Z-synthetic-only-password', token='synthetic-only-native-token';
async function fixture(t, mode='normal', abort) {
  const calls=[]; let product;
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=raw?JSON.parse(raw):undefined;calls.push({method:req.method,path:req.url,body});res.setHeader('content-type','application/json');
    const send=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
    if(req.url==='/auth/user/emailpass') {
      if(mode==='bad-json'){res.statusCode=200;return res.end('synthetic invalid response');}
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
output=b'';email_sent=False;password_sent=False;finish_sent=False;scheduled=[];deadline=time.monotonic()+5

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
  if b'INPUT_DISCARD_ACTIVE.' in output and not finish_sent:
   finish_sent=True;schedule(0.2,'finish')
  for when,value in scheduled[:]:
   if time.monotonic()>=when:
    scheduled.remove((when,value))
    if child.poll() is None:
     if value is None:os.close(master);master=None
     elif value=='finish':
      if master is None:child.terminate()
      else:write(b'\\x03')
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

// Keep a real interactive outer shell on the same PTY after Node exits. The
// queued tail is a harmless synthetic shell command with a private test marker;
// only booleans/statuses leave this harness, never captured input or its trace.
async function outerShellPty(baseUrl, scenario) {
  const program=`import errno,json,os,pty,re,select,shlex,signal,sys,tempfile,time
p=json.load(sys.stdin);prompt=b'SYNTHETIC_OUTER_PROMPT> ';pid,master=pty.fork()
if pid==0:
 os.execve('/bin/bash',['bash','--noprofile','--norc','-i'],{'PATH':os.environ['PATH'],'HOME':'/tmp','TERM':'dumb','PS1':prompt.decode(),'HISTFILE':'/dev/null','HISTSIZE':'0'})
output=b'';launched=False;email_sent=False;password_sent=False;trigger=None;early=False;ack=False;explicit_finish=False;ready=False;held=False;exit_code=None;report=None;start=time.monotonic()
with tempfile.TemporaryDirectory(prefix='medusa-outer-pty-',dir='/tmp') as private:
 marker=os.path.join(private,'synthetic-command-ran');tail=('printf SYNTHETIC_QUEUE_EXECUTED; : > '+shlex.quote(marker)+'\\r').encode();prefix=p['password'].encode()[:5];secret_tail=p['password'].encode()[5:]+b'\\r'
 sent_first=False;sent_late=False
 try:
  while time.monotonic()-start<8:
   readable,_,_=select.select([master],[],[],0.01)
   if readable:
    try:chunk=os.read(master,65536)
    except OSError:break
    if not chunk:break
    output+=chunk
   if not launched and prompt in output:
    os.write(master,(shlex.join(p['args'])+'\\r').encode());launched=True;output=b''
   if launched and b'Admin email (hidden): ' in output and not email_sent:
    email_sent=True;os.write(master,p['email'].encode()+(b'\\r' if p['scenario']=='ambiguous-lf' else b'\\n'))
   if b'Admin password (hidden): ' in output and not password_sent:
    password_sent=True
    if p['scenario']=='ambiguous-lf':os.write(master,prefix);password_at=time.monotonic()
    elif p['scenario']=='cancel':os.write(master,prefix+b'\\x03')
    elif p['scenario']=='signal':os.killpg(os.tcgetpgrp(master),signal.SIGTERM)
    elif p['scenario']=='eof':os.write(master,b'\\x04')
    elif p['scenario'] in ['invalid','ack-tail']:os.write(master,b'\\n')
    else:os.write(master,p['password'].encode()+b'\\n')
   if p['scenario']=='ambiguous-lf' and password_sent and 'password_at' in locals() and time.monotonic()-password_at>=0.2:
    os.write(master,b'\\n');del password_at
   if report is None:
    first=output.find(b'{')
    if first>=0:
     try:report=json.JSONDecoder().raw_decode(output[first:].decode())[0]
     except (ValueError,UnicodeError):pass
   if report is not None and trigger is None:trigger=time.monotonic()
   if p['scenario']=='success' and report is not None and not ack and prompt in output:
    ack=True;before_ack=output;output=b'';os.write(master,b'''printf 'SYNTHETIC_EXIT=%s\\n' "$?"; printf 'SYNTHETIC_SHELL_READY\\n'\\r''');ready=True
   if trigger is not None and not ack and p['scenario']!='success':
    early=early or prompt in output
    elapsed=time.monotonic()-trigger
    if elapsed>=0.05 and not sent_first:os.write(master,secret_tail+tail+b'\\r\\n\\x04');sent_first=True
    if elapsed>=0.9 and not sent_late:os.write(master,tail);sent_late=True
    if elapsed>=1.2:
     held=b'INPUT_DISCARD_ACTIVE.' in output and not early
     os.write(master,b'\\x03'+(tail if p['scenario']=='ack-tail' else b''));ack=True;explicit_finish=True;before_ack=output;output=b''
   elif ack and prompt in output and not ready:
    os.write(master,b'''printf 'SYNTHETIC_EXIT=%s\\n' "$?"; printf 'SYNTHETIC_SHELL_READY\\n'\\r''');ready=True
   if ready and re.search(rb'\\r?\\nSYNTHETIC_SHELL_READY\\r?\\n',output):
    match=re.search(rb'\\r?\\nSYNTHETIC_EXIT=(\\d+)',output)
    if match:exit_code=int(match.group(1))
    break
  before_ack=before_ack if ack else output
  result={'reportStatus':report.get('status') if report else None,'reportReason':report.get('reason') if report else None,'failureKind':report.get('failure',{}).get('kind') if report else None,'requests':report.get('requests') if report else None,'heldUntilExplicitFinish':held,'shellReturnedBeforeAck':early,'prefixEchoed':prefix in before_ack,'queuedSecretTailEchoed':secret_tail.rstrip(b'\\r') in before_ack+output,'queuedTailEchoed':tail.rstrip(b'\\r') in before_ack+output,'queuedTailExecuted':os.path.exists(marker),'lateTailSent':sent_late,'shellResponsiveAfterExit':exit_code is not None,'explicitFinishSent':explicit_finish,'exit':exit_code}
  print(json.dumps(result))
 finally:
  try:os.write(master,b'exit\\r')
  except OSError:pass
  try:os.kill(pid,signal.SIGKILL)
  except ProcessLookupError:pass
  os.waitpid(pid,0);os.close(master)
`;
  const child=spawn('python3',['-c',program],{env:{PATH:process.env.PATH,HOME:'/tmp'},stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
  child.stdin.end(JSON.stringify({args:[process.execPath,process.cwd()+'/scripts/medusa-catalog-interactive-smoke.mjs','--confirm-keep-synthetic-product','--base-url',baseUrl],email,password,scenario}));
  assert.equal(await new Promise(r=>child.on('exit',r)),0,'outer-shell harness must finish without a traceback');assert.equal(err,'');
  return JSON.parse(out);
}
for(const scenario of ['ambiguous-lf','cancel','signal','eof','invalid','auth-fail','http400','bad-json','ack-tail','success'])test('outer shell quarantine: '+scenario,async t=>{
  const mode=['auth-fail','http400','bad-json'].includes(scenario)?scenario:'normal';
  const f=await fixture(t,mode),r=await outerShellPty(f.baseUrl,scenario);
  const expectedCalls=scenario==='success'?5:scenario==='http400'?2:['auth-fail','bad-json'].includes(scenario)?1:0;
  if(scenario==='success'){
    assert.equal(r.explicitFinishSent,false,'successful process must exit naturally without a completion keystroke');
    assert.equal(r.heldUntilExplicitFinish,false);assert.equal(r.lateTailSent,false);
  } else {
    assert.equal(r.heldUntilExplicitFinish,true,'outer-shell evidence '+JSON.stringify({shellReturnedBeforeAck:r.shellReturnedBeforeAck,queuedSecretTailEchoed:r.queuedSecretTailEchoed,queuedTailEchoed:r.queuedTailEchoed,queuedTailExecuted:r.queuedTailExecuted}));
    assert.equal(r.shellReturnedBeforeAck,false,'outer shell must not resume before explicit termination');
    assert.equal(r.explicitFinishSent,true);assert.equal(r.lateTailSent,true);
  }
  assert.equal(r.prefixEchoed,false);assert.equal(r.queuedSecretTailEchoed,false);assert.equal(r.queuedTailEchoed,false,'late queued bytes must remain hidden');
  assert.equal(r.queuedTailExecuted,false,'synthetic queued command must never reach the outer shell');
  assert.equal(r.shellResponsiveAfterExit,true,'completion must restore a usable outer terminal');
  assert.equal(f.calls.length,expectedCalls);
  if(expectedCalls)assert.ok(f.calls[0].body?.email===email&&f.calls[0].body?.password===password,'synthetic authentication payload must match exactly');
  assert.equal(r.exit,scenario==='success'?0:expectedCalls?1:2);
  assert.equal(r.reportStatus,scenario==='success'?'passed':scenario==='auth-fail'?'authentication_refused':expectedCalls?'failed':['cancel','signal'].includes(scenario)?'cancelled':'input_refused');
  if(!expectedCalls)assert.deepEqual(r.requests,[]);
});
