#!/usr/bin/env python3
"""Package reviewed source/build output only; never include local credentials or data."""
import hashlib
import json
import pathlib
import sys
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
arguments = [value for value in sys.argv[1:] if value not in ['--light', '--application-overlay']]
light = '--light' in sys.argv[1:]
application_overlay = '--application-overlay' in sys.argv[1:]
if light and application_overlay: raise SystemExit('Choose exactly one explicit package mode')
version = json.loads((root / 'package.json').read_text())['version']
output = pathlib.Path(arguments[0]).resolve() if arguments else root / 'release' / (f'Workspace-Agent-v{version}-App.zip' if light else f'Workspace-Agent-v{version}-Backend.zip')
files = []
for name in ['00_READ_FIRST_WORK_HANDOFF.md', 'README.md', 'NATIVE-HARNESS.md', 'VALIDATION.md', 'THIRD_PARTY_NOTICES.md', '.env.example', '.gitignore', 'START.bat', 'START.command', 'start.sh', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.mjs']:
    files.append(root / name)
for name in ['server', 'src', 'public', 'dist', 'vendor', 'docs', 'test', 'scripts', 'deploy']:
    files += sorted(path for path in (root / name).rglob('*') if path.is_file())
native_members = ['SOURCE-INFO.json', 'SOURCE-MANIFEST.json', 'SOURCE-PARTS.json'] + ([] if light or application_overlay else ['deepseek-harness-source.tar.gz'])
for name in native_members:
    candidate = root / 'backend' / name
    if not application_overlay or candidate.is_file(): files.append(candidate)
for name in ['handoff-verification.json', 'backend-business-checkpoint.log', 'release-check-candidate.json', 'local-verification.json', 'launch-gates.json', 'dependency-audit.json', 'full-validation-candidate.log', 'native-relay-candidate.log', 'native-recovery-candidate.log', 'native-acceptance-candidate.log', 'clean-build-rc2.log']:
    source = root / 'evidence' / name
    if source.exists(): files.append(source)
for file in files:
    if file.is_symlink(): raise SystemExit(f'Release rejects symbolic file: {file.relative_to(root)}')
    if any(part in ['node_modules', '.data', '.git', '__pycache__'] for part in file.relative_to(root).parts): raise SystemExit('Forbidden release path')
    if file.name == '.env' or file.name.endswith(('.pyc', '.lock', '.tmp')): raise SystemExit('Forbidden release file')
source = json.loads((root / 'backend/SOURCE-INFO.json').read_text())
actual = None
if not application_overlay:
    actual = hashlib.sha256((root / 'backend/deepseek-harness-source.tar.gz').read_bytes()).hexdigest()
    if actual != source['archiveSha256']: raise SystemExit('Native source archive digest mismatch')
else:
    if not (root / 'dist/index.html').is_file() or not (root / 'deploy/muse-native-overlay/INTEGRATION-MANIFEST.json').is_file():
        raise SystemExit('Application/overlay candidates require a built frontend and current payload manifest')
manifest = {'name': 'Workspace Agent release candidate', 'version': version, 'launchReady': False,
    'packageKind': 'application-and-original-host-overlay' if application_overlay else 'app' if light else 'backend',
    'sourceWorkingTree': source['workingTree'], 'sourceWorkingTreeMeaning': 'historical Harness provenance; not this application commit',
    'nativeSourceArchiveSha256': actual, 'nativeSourceArchiveVerified': actual is not None,
    'externalDependencies': ['the original complete PersonalMuse/DeepSeek Harness Host at the reviewed source version'] if application_overlay else [],
    'blockedGates': ['current original Host baseline and complete source boot', 'actual bound Muse Connector execution and account wake capability', 'latest conversation UI browser acceptance', 'production authorization'] if application_overlay else [],
    'files': []}
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(set(files)):
        content = file.read_bytes()
        relative = file.relative_to(root).as_posix()
        if relative == 'backend/SOURCE-INFO.json':
            packaged_source = json.loads(content); packaged_source['archiveIncludedInAppBundle'] = not light and not application_overlay; packaged_source['sourcePartsManifest'] = 'backend/SOURCE-PARTS.json'; content = (json.dumps(packaged_source, indent=2) + '\n').encode()
        manifest['files'].append({'path': relative, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
        info = zipfile.ZipInfo('Workspace-Agent/' + relative, date_time=(2026, 10, 4, 0, 0, 0))
        info.external_attr = (0o100755 if file.stat().st_mode & 0o111 else 0o100644) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, content)
    archive.writestr('Workspace-Agent/RELEASE-MANIFEST.json', json.dumps(manifest, indent=2) + '\n')
with zipfile.ZipFile(output) as archive:
    if archive.testzip() is not None: raise SystemExit('ZIP integrity failure')
print(json.dumps({'file': str(output), 'files': len(files) + 1, 'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}, indent=2))
