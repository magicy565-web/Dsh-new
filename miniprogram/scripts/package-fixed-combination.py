#!/usr/bin/env python3
"""Archive an exact selected Git tree and its clean compiled mini client.

No credentials, dependencies, local .git, runtime data, account or deployment
operations. All tracked historical deliverables remain original Git blobs and
are explicitly labelled historical, never relabelled as the current client.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--repository', type=Path, required=True)
parser.add_argument('--commit', required=True)
parser.add_argument('--backend', default='1ebc5f7e6a34fa4965fb2abfc61f73b891a920d9')
parser.add_argument('--compiled', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
repo, compiled, output = args.repository.resolve(), args.compiled.resolve(), args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
git = lambda *items: subprocess.check_output(['git', '-C', str(repo), *items])
commit = git('rev-parse', args.commit+'^{commit}').decode().strip()
tree = git('rev-parse', commit+'^{tree}').decode().strip()
backend = git('rev-parse', args.backend+'^{commit}').decode().strip()
subprocess.run(['git','-C',str(repo),'merge-base','--is-ancestor',backend,commit],check=True)
assert len(commit) == 40 and len(tree) == 40
digest = lambda b: hashlib.sha256(b).hexdigest()
encode = lambda v: (json.dumps(v, ensure_ascii=False, indent=2)+'\n').encode()
def entry(z, name, data, mode=0o100644):
    path = PurePosixPath(name)
    assert not path.is_absolute() and '..' not in path.parts and '\\' not in name
    info = zipfile.ZipInfo(name, (2026, 10, 12, 0, 0, 0))
    info.create_system = 3
    info.external_attr = mode << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    z.writestr(info, data)
def file_record(name, data, mode, blob=None):
    return {'path':name, 'bytes':len(data), 'mode':format(mode,'06o'), 'sha256':digest(data), **({'gitBlob':blob} if blob else {})}
records, blobs, legacy = [], [], []
for row in git('ls-tree', '-rz', commit).split(b'\0'):
    if not row: continue
    meta, raw_path = row.split(b'\t', 1)
    mode, kind, oid = meta.decode().split()
    name = raw_path.decode('utf-8')
    assert kind == 'blob' and mode in {'100644','100755'}, 'No symlink/submodule extraction is authorized'
    parts = PurePosixPath(name).parts
    assert not any(p in {'.git','node_modules','.data','.aws'} for p in parts)
    assert not any(p == '.env' or p.startswith('.env.') and p != '.env.example' for p in parts)
    assert Path(name).suffix.lower() not in {'.key','.pem','.p12','.pfx'}, 'Private-key file is not a source deliverable'
    data = git('cat-file', 'blob', oid)
    assert hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest() == oid
    records.append(file_record(name, data, int(mode,8), oid)); blobs.append((name,data,int(mode,8)))
    if name.endswith(('.zip','.tar.gz','.bundle')): legacy.append(name)
compiled_files = sorted(p for p in compiled.rglob('*') if p.is_file())
assert compiled_files and not any(p.is_symlink() for p in compiled.rglob('*'))
config = json.loads((compiled/'project.config.json').read_text())
assert config['appid'] == 'touristappid' and config['setting']['urlCheck'] is True
assert "baseUrl = ''" in (compiled/'app.js').read_text()
client_records = []
for path in compiled_files:
    relative = path.relative_to(compiled).as_posix()
    assert not any(p in {'server','test','node_modules','.git','.env'} for p in PurePosixPath(relative).parts)
    assert path.suffix.lower() not in {'.pem','.key','.p12','.pfx'}
    data = path.read_bytes()
    if path.suffix in {'.js','.json'}: assert not any(marker in data for marker in [b'-----BEGIN PRIVATE KEY',b'sk-proj-',b'sk-ant-'])
    client_records.append(file_record(relative,data,0o100644))
version = {'schema':'workspace.fixed-source-delivery.v1','sourceCommit':commit,'sourceTree':tree,
 'backendCommit':backend,'officialApiTypings':'miniprogram-api-typings@5.2.3',
 'trackedFiles':len(records),'exactGitTree':True,'sourceExclusions':[],
 'historicalArchives':legacy,'historyIncluded':False,
 'accountConfiguration':{'appid':'touristappid','urlCheck':True,'baseUrl':'','productionConfigured':False},
 'realWechatAcceptance':False,'realShopifyAcceptance':False,'liveDeployment':False}
source_manifest={**version,'files':records}
client_manifest={**version,'compiledFiles':len(client_records),'files':client_records}
short=commit[:7]
source=output/f'Workspace-Agent-Source-{short}.zip'
client=output/f'Workspace-Agent-WeChat-Import-{short}.zip'
source_readme=f'''当前准确源码：{commit}\nGit tree：{tree}\n后端：{version['backendCommit']}\n
Workspace-Agent/包含该Git提交的全部{len(records)}个原始blob文件；路径、执行权限、Git blob ID与SHA256见SOURCE-MANIFEST.json。
旧ZIP是该树已跟踪的历史文件，保留原字节；它们不含当前PR52增量，不是当前导入包。请仅使用同批Workspace-Agent-WeChat-Import-{short}.zip。
不包含本机.git/认证信息、node_modules、运行数据库、上传数据或实际账号秘密；只有公开.env.example。Git历史不在本包；可恢复和核对该提交的完整工作树，不能把新init的提交ID冒充原历史。
干净目录：cd Workspace-Agent；npm ci --ignore-scripts；npm run build；npm run build:mini；node --test miniprogram/test/*test.mjs test/miniprogram-client.test.mjs。
当前微信/Shopify真实验收未执行，baseUrl为空、appid为touristappid，配置阻挡是预期。Native弹窗仅认证客户端报告，不是独立微信授权证明。
参见Workspace-Agent/miniprogram/NOTIFICATION-CLOSURE-ACCEPTANCE.md。勿以旧包或本地fixture当作上线/真机/真实商店授权。
'''.encode()
client_readme=f'''当前小程序导入包：源提交{commit}，后端{version['backendCommit']}。
解压后在微信开发者工具选择含project.config.json的本目录。使用原会话/精灵/素材，含draft/publish/repair、商品事件流量、七天与独立首次采样通知。
本包不是旧20:30/v2包。BUILD-MANIFEST.json逐文件SHA应与同源干净build:mini输出一致。
appid=touristappid，urlCheck=true，baseUrl为空；无实际账号/企业授权时清晰阻挡，不生成假身份。需负责人配置既有AppID、受信loginBroker/baseUrl/合法域名及原权限；不能只登录商店就声称服务端就绪。
客户端不带server、node_modules、测试、私有配置、token或OpenID。wx原生弹窗决定仅客户端报告，平台授权待发送核验。
真实WeChat工具/真机/审核、实际Shopify/GA4/通知/连续七天未通过；当前截图是原源文件Chromium与本地HTTP/callback fixture。
'''.encode()
with zipfile.ZipFile(source,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name,data,mode in blobs: entry(z,'Workspace-Agent/'+name,data,mode)
    entry(z,'SOURCE-MANIFEST.json',encode(source_manifest));entry(z,'DELIVERY-README.txt',source_readme)
    entry(z,'ORIGINAL-COMMIT.txt',git('cat-file','commit',commit))
with zipfile.ZipFile(client,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for path in compiled_files: entry(z,path.relative_to(compiled).as_posix(),path.read_bytes())
    entry(z,'BUILD-MANIFEST.json',encode(client_manifest));entry(z,'IMPORT-README.txt',client_readme)
result={**version,'source':{'file':source.name,'bytes':source.stat().st_size,'sha256':digest(source.read_bytes())},
 'client':{'file':client.name,'bytes':client.stat().st_size,'sha256':digest(client.read_bytes()),'files':len(client_records)}}
(output/'SOURCE-MANIFEST.json').write_bytes(encode(source_manifest))
(output/'BUILD-MANIFEST.json').write_bytes(encode(client_manifest))
(output/'FIXED-VERSION.json').write_bytes(encode(result))
(output/'SHA256SUMS.txt').write_text(''.join(f'{result[k]["sha256"]}  {result[k]["file"]}\n' for k in ['source','client']))
print(json.dumps(result,ensure_ascii=False))
