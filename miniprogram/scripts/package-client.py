#!/usr/bin/env python3
"""Package only the existing compiled mini client; never upload/deploy."""
import hashlib
import argparse
import json
from pathlib import Path
import subprocess
import zipfile

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--name', default='Workspace-Agent-WeChat-Client')
parser.add_argument('--readme', default='miniprogram/IMPORT.md')
args = parser.parse_args()
assert args.name.replace('-', '').isalnum()
compiled = root / 'release/miniprogram'
output = root / 'miniprogram/deliverables'
output.mkdir(exist_ok=True)
source_commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
files = sorted(path for path in compiled.rglob('*') if path.is_file())
assert files and (compiled / 'app.js').exists()
config = json.loads((compiled / 'project.config.json').read_text())
assert config['appid'] == 'touristappid' and config['setting']['urlCheck'] is True
assert "const baseUrl = ''" in (compiled / 'app.js').read_text() or "baseUrl: ''" in (compiled / 'app.js').read_text()
entries = []
for path in files:
    relative = path.relative_to(compiled).as_posix()
    assert not any(part in {'.env', 'node_modules', '.data', 'server', 'test'} for part in path.relative_to(compiled).parts)
    assert path.suffix not in {'.pem', '.key', '.p12', '.pfx'}
    data = path.read_bytes()
    if path.suffix in {'.js', '.json'}:
        assert b'PRIVATE KEY' not in data and b'sk-proj-' not in data and b'sk-ant-' not in data
    entries.append({'path': relative, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
manifest = {'sourceCommit': source_commit, 'officialApiTypings': 'miniprogram-api-typings@5.2.3', 'mode': 'Importable compiled development client; no WeChat account/device/platform acceptance', 'configuration': {'appid': 'touristappid', 'urlCheck': True, 'baseUrl': '', 'loginBroker': 'absent; fails closed'}, 'files': entries}
archive = output / (args.name + '.zip')
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for path in files:
        info = zipfile.ZipInfo(path.relative_to(compiled).as_posix(), (2026, 10, 12, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, path.read_bytes())
    z.writestr('BUILD-MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    z.writestr('IMPORT-README.txt', (root / args.readme).read_bytes())
sha = hashlib.sha256(archive.read_bytes()).hexdigest()
(output / (args.name + '.zip.sha256')).write_text(f'{sha}  {archive.name}\n')
(output / (args.name + '-BUILD-MANIFEST.json')).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'archive': str(archive), 'sourceCommit': source_commit, 'files': len(files), 'bytes': archive.stat().st_size, 'sha256': sha}))
