#!/usr/bin/env python3
"""Safe clean extraction, original Git blob/mode/SHA and tree recovery proof."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import subprocess
import zipfile

p=argparse.ArgumentParser()
p.add_argument('--source',type=Path,required=True)
p.add_argument('--client',type=Path,required=True)
p.add_argument('--destination',type=Path,required=True)
p.add_argument('--record',type=Path,required=True)
a=p.parse_args()
root=a.destination.resolve();assert not root.exists(), 'Use a new clean extraction directory'
root.mkdir(parents=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
def extract(archive,directory):
    with zipfile.ZipFile(archive) as z:
        names=z.namelist();assert len(names)==len(set(names))
        for item in z.infolist():
            path=PurePosixPath(item.filename);mode=item.external_attr>>16
            assert not path.is_absolute() and '..' not in path.parts and '\\' not in item.filename
            assert stat.S_ISREG(mode) and mode in {0o100644,0o100755}
            target=directory.joinpath(*path.parts);target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(z.read(item));target.chmod(stat.S_IMODE(mode))
    return names
source_names=extract(a.source,root/'source');client_names=extract(a.client,root/'client')
manifest=json.loads((root/'source/SOURCE-MANIFEST.json').read_text())
client_manifest=json.loads((root/'client/BUILD-MANIFEST.json').read_text())
assert manifest['sourceCommit']==client_manifest['sourceCommit']
def verify(directory,records,blobs=False):
    total=0
    for row in records:
        path=directory/row['path'];data=path.read_bytes();mode=format(stat.S_IFREG|stat.S_IMODE(path.stat().st_mode),'06o')
        assert len(data)==row['bytes'] and sha(data)==row['sha256'] and mode==row['mode'],row['path']
        if blobs:assert hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()==row['gitBlob']
        total+=len(data)
    return total
source_bytes=verify(root/'source/Workspace-Agent',manifest['files'],True)
client_bytes=verify(root/'client',client_manifest['files'])
assert set(source_names)=={'Workspace-Agent/'+r['path'] for r in manifest['files']}|{'SOURCE-MANIFEST.json','DELIVERY-README.txt','ORIGINAL-COMMIT.txt'}
assert set(client_names)=={r['path'] for r in client_manifest['files']}|{'BUILD-MANIFEST.json','IMPORT-README.txt'}
original=(root/'source/ORIGINAL-COMMIT.txt').read_bytes()
assert hashlib.sha1(b'commit '+str(len(original)).encode()+b'\0'+original).hexdigest()==manifest['sourceCommit']
repo=root/'source/Workspace-Agent'
def git(*args,data=None):return subprocess.check_output(['git','-C',str(repo),*args],input=data,stderr=subprocess.PIPE)
git('init','--quiet');git('config','core.autocrlf','false')
index=[]
for row in manifest['files']:
    oid=git('hash-object','-w','--stdin',data=(repo/row['path']).read_bytes()).decode().strip()
    assert oid==row['gitBlob'];index.append(f'{row["mode"]} {oid}\t{row["path"]}\n')
git('update-index','--index-info',data=''.join(index).encode())
tree=git('write-tree').decode().strip();assert tree==manifest['sourceTree']
result={'schema':'workspace.fixed-source-verification.v1','sourceCommit':manifest['sourceCommit'],'sourceTree':tree,
 'sourceSha256':sha(a.source.read_bytes()),'clientSha256':sha(a.client.read_bytes()),
 'sourceFiles':len(manifest['files']),'clientFiles':len(client_manifest['files']),
 'sourceOriginalBytes':source_bytes,'clientOriginalBytes':client_bytes,
 'allOriginalGitBlobsModesShaMatched':True,'exactGitTreeReconstructed':True,'allClientBytesModesShaMatched':True,
 'safeExtraction':True,'gitHistoryRestored':False,'sourceDirectory':str(repo),'clientDirectory':str(root/'client')}
a.record.parent.mkdir(parents=True,exist_ok=True);a.record.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
