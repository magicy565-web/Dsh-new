#!/usr/bin/env python3
"""Package the exact supplied Harness working tree without dependencies or credentials."""
import hashlib, json, os, pathlib, subprocess, sys, tarfile, io
source=pathlib.Path(sys.argv[1]).resolve(); destination=pathlib.Path(sys.argv[2]).resolve(); destination.mkdir(parents=True,exist_ok=True)
tracked=subprocess.check_output(['git','ls-files','-s','-z'],cwd=source).split(b'\0')
modes={}
for entry in tracked:
 if entry:
  meta,name=entry.split(b'\t',1);modes[name.decode()]=meta.split()[0].decode()
extra=subprocess.check_output(['git','ls-files','--others','--exclude-standard','-z'],cwd=source).decode().split('\0')
for name in extra:
 if name:modes[name]='120000' if (source/name).is_symlink() else '100755' if os.access(source/name,os.X_OK) else '100644'
root={}; manifest=[]
for name,mode in sorted(modes.items()):
 p=source/name
 if not p.exists() and not p.is_symlink():continue
 data=os.readlink(p).encode() if p.is_symlink() else p.read_bytes()
 if name.endswith('.cmd'): data=data.replace(b'\r\n',b'\n')
 blob=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).digest()
 node=root;parts=name.split('/')
 for part in parts[:-1]:node=node.setdefault(part,{})
 node[parts[-1]]=(mode,blob)
 manifest.append({'path':name,'mode':mode,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
def tree(node):
 output=b''
 for name,value in sorted(node.items(),key=lambda item:(item[0]+('/' if isinstance(item[1],dict) else '')).encode()):
  mode,sha=('40000',tree(value)) if isinstance(value,dict) else value
  output+=mode.encode()+b' '+name.encode()+b'\0'+sha
 return hashlib.sha1(b'tree '+str(len(output)).encode()+b'\0'+output).digest()
digest=tree(root).hex()
if digest!='bccf02f2636f7213be321d487aa763eb51396584':raise SystemExit('Unexpected source tree: '+digest)
archive=destination/'deepseek-harness-source.tar.gz'
with tarfile.open(archive,'w:gz',compresslevel=6) as tar:
 for item in manifest:
  file=source/item['path']; info=tar.gettarinfo(str(file),arcname='deepseek-harness/'+item['path'])
  if file.is_symlink():tar.addfile(info)
  else:
   data=file.read_bytes(); data=data.replace(b'\r\n',b'\n') if item['path'].endswith('.cmd') else data
   info.size=len(data); tar.addfile(info,io.BytesIO(data))
metadata={'package':'DeepSeek Harness','version':'0.2.0-rc.2','license':'MIT (additional notices in source)','workingTree':digest,'sourceFiles':len(manifest),'sourceBytes':sum(item['bytes'] for item in manifest),'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'includes':'Current working tree including multi-worker, queue consumer and compatibility changes. Does not use HEAD alone.','excludes':['node_modules','build outputs','git database','runtime data','credentials'],'files':manifest}
(destination/'SOURCE-MANIFEST.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in metadata.items() if k!='files'})); print('Archive bytes',archive.stat().st_size)
