import datetime,hashlib,json,os,pathlib,subprocess,sys,time
source=sys.argv[1];short=source[:7];base=pathlib.Path('/tmp/workspace-launch-20261013');root=base/('reconstruction-'+short)/'source/Workspace-Agent';out=base/('final-'+short)/'reconstruction';out.mkdir(parents=True,exist_ok=True)
manifest=json.loads((root.parent/'SOURCE-MANIFEST.json').read_text());assert manifest['sourceCommit']==source
allow=['PATH','HOME','LANG','LC_ALL','TERM','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR','REQUESTS_CA_BUNDLE','CURL_CA_BUNDLE'];env={k:os.environ[k] for k in allow if k in os.environ}
for scope in ['user','global']:
 p=out/f'empty-{scope}.npmrc';p.write_text('');env[f'npm_config_{scope}config']=str(p)
env['npm_config_cache']='/tmp/workspace-supplier-npm-cache';records=[]
def run(name,command):
 log=out/(name+'.log');start=time.monotonic();r={'name':name,'sourceCommit':source,'sourceTree':manifest['sourceTree'],'command':command,'cwd':str(root),'environmentNames':sorted(env),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 with log.open('w') as f:
  f.write(json.dumps(r)+'\n');f.flush();p=subprocess.run(command,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT)
 r.update(exitCode=p.returncode,durationSeconds=round(time.monotonic()-start,3),log=log.name,logSha256=hashlib.sha256(log.read_bytes()).hexdigest());records.append(r);(out/'commands.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(r),flush=True)
 if p.returncode:sys.exit('Clean reconstruction command failed; preserved original log; no silent fallback.')
run('npm-ci-offline',['npm','ci','--ignore-scripts','--offline','--no-audit','--no-fund'])
run('web-build',['npm','run','build']);run('mini-build',['npm','run','build:mini'])
client=json.loads((base/('packages-'+short)/'BUILD-MANIFEST.json').read_text());assert client['sourceCommit']==source
expected={r['path']:r for r in client['files']};actual={p.relative_to(root/'release/miniprogram').as_posix():p for p in (root/'release/miniprogram').rglob('*') if p.is_file()};assert actual.keys()==expected.keys()
for name,p in actual.items():assert not p.is_symlink() and p.stat().st_size==expected[name]['bytes'] and hashlib.sha256(p.read_bytes()).hexdigest()==expected[name]['sha256'],name
for row in manifest['files']:
 p=root/row['path'];assert not p.is_symlink() and hashlib.sha256(p.read_bytes()).hexdigest()==row['sha256'],row['path']
def hashes(directory):return {p.relative_to(directory).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(directory.rglob('*')) if p.is_file()}
web=hashes(root/'dist');assert web==hashes(pathlib.Path('/workspace/workspace-release-20261013/dist'))
r={'sourceCommit':source,'sourceTree':manifest['sourceTree'],'freshLockedOfflineInstall':True,'webBuildFiles':len(web),'allWebBytesMatchTestedBuild':True,'miniBuildFiles':len(expected),'allMiniBytesMatchClientManifest':True,'allOriginalSourceBytesUnchanged':True,'providerOrAccountConfigurationUsed':False,'webBuildHashes':web,'commands':records};(out/'REBUILD-VERIFICATION.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({k:v for k,v in r.items() if k!='commands'}),flush=True)
