#!/usr/bin/env python3
"""Package reviewed source/build output only; never include local credentials or data."""
import hashlib
import json
import pathlib
import sys
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
arguments = [value for value in sys.argv[1:] if value != '--light']
light = '--light' in sys.argv[1:]
version = json.loads((root / 'package.json').read_text())['version']
output = pathlib.Path(arguments[0]).resolve() if arguments else root / 'release' / (f'Workspace-Agent-v{version}-App.zip' if light else f'Workspace-Agent-v{version}-Backend.zip')
files = []
for name in ['00_READ_FIRST_WORK_HANDOFF.md', 'README.md', 'NATIVE-HARNESS.md', 'VALIDATION.md', 'THIRD_PARTY_NOTICES.md', '.env.example', '.gitignore', 'START.bat', 'START.command', 'start.sh', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.mjs']:
    files.append(root / name)
for name in ['server', 'src', 'public', 'dist', 'vendor', 'docs', 'test', 'scripts', 'deploy']:
    files += sorted(path for path in (root / name).rglob('*') if path.is_file())
for name in ['SOURCE-INFO.json', 'SOURCE-MANIFEST.json', 'SOURCE-PARTS.json'] + ([] if light else ['deepseek-harness-source.tar.gz']):
    files.append(root / 'backend' / name)
for name in ['handoff-verification.json', 'backend-business-checkpoint.log', 'release-check-candidate.json', 'local-verification.json', 'launch-gates.json', 'dependency-audit.json', 'full-validation-candidate.log', 'native-relay-candidate.log', 'native-recovery-candidate.log', 'native-acceptance-candidate.log', 'clean-build-rc2.log']:
    source = root / 'evidence' / name
    if source.exists(): files.append(source)
for file in files:
    if file.is_symlink(): raise SystemExit(f'Release rejects symbolic file: {file.relative_to(root)}')
    if any(part in ['node_modules', '.data', '.git', '__pycache__'] for part in file.relative_to(root).parts): raise SystemExit('Forbidden release path')
    if file.name == '.env' or file.name.endswith(('.pyc', '.lock', '.tmp')): raise SystemExit('Forbidden release file')
source = json.loads((root / 'backend/SOURCE-INFO.json').read_text())
actual = hashlib.sha256((root / 'backend/deepseek-harness-source.tar.gz').read_bytes()).hexdigest()
if actual != source['archiveSha256']: raise SystemExit('Native source archive digest mismatch')
manifest = {'name': 'Workspace Agent release candidate', 'version': version, 'launchReady': False, 'sourceWorkingTree': source['workingTree'], 'nativeSourceArchiveSha256': actual, 'files': []}
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(set(files)):
        content = file.read_bytes()
        relative = file.relative_to(root).as_posix()
        if relative == 'backend/SOURCE-INFO.json':
            packaged_source = json.loads(content); packaged_source['archiveIncludedInAppBundle'] = not light; packaged_source['sourcePartsManifest'] = 'backend/SOURCE-PARTS.json'; content = (json.dumps(packaged_source, indent=2) + '\n').encode()
        manifest['files'].append({'path': relative, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
        info = zipfile.ZipInfo('Workspace-Agent/' + relative, date_time=(2026, 10, 4, 0, 0, 0))
        info.external_attr = (0o100755 if file.stat().st_mode & 0o111 else 0o100644) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, content)
    archive.writestr('Workspace-Agent/RELEASE-MANIFEST.json', json.dumps(manifest, indent=2) + '\n')
with zipfile.ZipFile(output) as archive:
    if archive.testzip() is not None: raise SystemExit('ZIP integrity failure')
print(json.dumps({'file': str(output), 'files': len(files) + 1, 'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}, indent=2))
