#!/usr/bin/env python3
"""Package committed source using Git blob bytes, without checkout conversion."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--ref', default='HEAD')
parser.add_argument('--output')
args = parser.parse_args()
def git(*values):
    return subprocess.check_output(['git', *values], cwd=root)
commit = git('rev-parse', args.ref + '^{commit}').decode().strip()
tree = git('rev-parse', commit + '^{tree}').decode().strip()
output = pathlib.Path(args.output) if args.output else root / 'release' / f'Workspace-Agent-Pi-{commit[:12]}-Source.zip'
output.parent.mkdir(parents=True, exist_ok=True)
files = []
excluded = []
entries = git('ls-tree', '-rz', commit).split(b'\0')
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for entry in entries:
        if not entry: continue
        metadata, raw_path = entry.split(b'\t', 1)
        mode, kind, blob = metadata.decode().split()
        filename = raw_path.decode('utf-8')
        parts = pathlib.PurePosixPath(filename).parts
        if filename.startswith(('.env',)) and filename != '.env.example' or any(part in {'.git', 'node_modules', '.data', 'data', 'evidence', 'release', 'deliverables', '.mini-build'} for part in parts):
            excluded.append(filename); continue
        if kind != 'blob' or mode not in {'100644', '100755'}: raise RuntimeError('Unsupported source entry: ' + filename)
        if filename.startswith('/') or '..' in parts: raise RuntimeError('Unsafe source path: ' + filename)
        data = git('cat-file', 'blob', blob)
        item = {'path': filename, 'gitBlob': blob, 'mode': mode, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        files.append(item)
        info = zipfile.ZipInfo('Workspace-Agent/' + filename, date_time=(2026, 10, 12, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = (int(mode, 8) << 16)
        archive.writestr(info, data)
    manifest = {'schemaVersion': 1, 'packageKind': 'git-raw-byte-pi-source', 'sourceCommit': commit, 'sourceTree': tree,
        'launchReady': False, 'byteSource': 'git cat-file blob; no text decoding/newline conversion',
        'runtime': {'pi': '1.1.0', 'officialSource': 'abe508e1b89912adde45528136c3221eb69acdd7', 'dshRequired': False},
        'excluded': excluded, 'files': files}
    archive.writestr('Workspace-Agent/PI-SOURCE-MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2).encode() + b'\n')
    archive.writestr('Workspace-Agent/PI-SOURCE-SHA256SUMS.txt', ''.join(f"{item['sha256']}  {item['path']}\n" for item in files).encode())
digest = hashlib.sha256(output.read_bytes()).hexdigest()
output.with_suffix(output.suffix + '.sha256').write_text(digest + '  ' + output.name + '\n')
output.with_suffix('.manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'archive': str(output), 'bytes': output.stat().st_size, 'sha256': digest, 'sourceCommit': commit, 'sourceTree': tree, 'files': len(files), 'dshRequired': False}, indent=2))
