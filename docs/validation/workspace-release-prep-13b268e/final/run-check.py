import datetime,hashlib,json,os,pathlib,re,subprocess,sys,time
root=pathlib.Path('/workspace/workspace-release-20261013')
name=sys.argv[1];out=pathlib.Path(sys.argv[2]);command=sys.argv[3:];out.mkdir(parents=True,exist_ok=True)
def git(*args):return subprocess.check_output(['git',*args],cwd=root,text=True).strip()
env={k:os.environ[k] for k in ['PATH','HOME','LANG','LC_ALL','TERM'] if k in os.environ}
env['npm_config_cache']='/tmp/workspace-supplier-npm-cache'
for scope in ['user','global']:
 p=out/f'empty-{scope}.npmrc'
 if not p.exists():p.write_text('')
 env[f'npm_config_{scope}config']=str(p)
log=out/(name+'.log');assert not log.exists(), 'Refuse to overwrite prior evidence'
r={'name':name,'command':command,'sourceBefore':git('rev-parse','HEAD'),'treeBefore':git('rev-parse','HEAD^{tree}'),'statusBefore':git('status','--porcelain'),'environmentNames':sorted(env),'cwd':str(root),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
start=time.monotonic()
with log.open('w') as f:
 f.write(json.dumps(r)+'\n');f.flush();p=subprocess.run(command,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT)
r.update(exitCode=p.returncode,durationSeconds=round(time.monotonic()-start,3),sourceAfter=git('rev-parse','HEAD'),statusAfter=git('status','--porcelain'),finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),log=log.name,logSha256=hashlib.sha256(log.read_bytes()).hexdigest())
text=log.read_text(errors='replace');r['counts']={k:int(v) for k,v in re.findall(r'^[#ℹ] (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)',text,re.M)}
(out/(name+'.json')).write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r),flush=True)
sys.exit(p.returncode)
