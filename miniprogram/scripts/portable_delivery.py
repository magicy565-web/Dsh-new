"""Portable checkpoint primitives. Only Python's standard library is required.

The pinned Git commit is the trust anchor. A tree's metadata can be verified
without possessing excluded historical blobs; that does not recover their data.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import unicodedata
import zipfile

SCHEMA = 'workspace.portable-checkpoint.v1'
TREE_SCHEMA = 'workspace.expected-git-tree.v1'
PREFIXES = (
    'deliverables/', 'docs/screenshots/', 'docs/validation/',
    'miniprogram/deliverables/', 'miniprogram/evidence/',
    'miniprogram/integration-checkpoints/', 'tui/validation/', 'release/',
)
# This tracked JSON is a live test input, not historical validation output.
REQUIRED_INCLUSIONS = ('docs/validation/managed-commerce-sources.json',)
MODES = {'100644', '100755'}
CONFIG = {'appid': 'touristappid', 'urlCheck': True, 'baseUrl': '',
          'productionConfigured': False}
MAX_FILES = 20000
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
SOURCE_METADATA = {'SOURCE-MANIFEST.json', 'ORIGINAL-COMMIT.txt', 'DELIVERY-README.txt'}
CLIENT_METADATA = {'BUILD-MANIFEST.json', 'IMPORT-README.txt'}
SECRET_PATTERNS = (
    rb'\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}',
    rb'\b(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}',
    rb'\bAKIA[0-9A-Z]{16}\b',
    rb'-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{32,}',
)


class DeliveryError(ValueError):
    """An unsafe, inconsistent or incomplete checkpoint."""


def require(condition, message):
    if not condition:
        raise DeliveryError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git_hash(kind, data):
    return hashlib.sha1(kind.encode() + b' ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def decode(data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f'Duplicate JSON key: {key}')
            result[key] = value
        return result
    try:
        return json.loads(data, object_pairs_hook=pairs)
    except (ValueError, UnicodeDecodeError) as exc:
        raise DeliveryError(f'Invalid JSON: {exc}') from exc


def oid(value):
    require(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{40}', value),
            'Use an immutable, full lowercase 40-character Git SHA-1')
    return value


def safe_path(name):
    require(isinstance(name, str) and name and len(name) <= 4096,
            'Invalid or empty relative path')
    require(not any(ord(c) < 32 or ord(c) == 127 for c in name), f'Control character in path: {name!r}')
    require('\\' not in name and ':' not in name and unicodedata.normalize('NFC', name) == name,
            f'Non-portable path: {name!r}')
    parts = name.split('/')
    for part in parts:
        require(part not in ('', '.', '..') and not part.endswith((' ', '.')),
                f'Unsafe relative path: {name!r}')
        require(part.casefold() not in {'.git', '.hg', '.svn'}, f'Version-control metadata path: {name}')
        require(not re.fullmatch(r'(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?', part, re.I),
                f'Reserved portable filename: {name}')
    return name


def unique_paths(names):
    seen = set()
    for name in names:
        safe_path(name)
        folded = name.casefold()
        require(folded not in seen, f'Duplicate or case-colliding path: {name}')
        seen.add(folded)
    for name in seen:
        parts = name.split('/')
        require(not any('/'.join(parts[:i]) in seen for i in range(1, len(parts))),
                f'File/directory path collision: {name}')


def exclusion(name):
    if name in REQUIRED_INCLUSIONS:
        return None
    return next((f'historical-prefix:{prefix}' for prefix in PREFIXES if name.startswith(prefix)), None)


def safe_payload(name, data):
    parts = name.split('/')
    forbidden = {'.aws', '.ssh', '.data', 'node_modules', '__pycache__', 'uploads', 'runtime-data'}
    require(not any(part.casefold() in forbidden for part in parts), f'Private/runtime/dependency path: {name}')
    require(not any(part.casefold().startswith('.env') and part != '.env.example' for part in parts),
            f'Private environment file: {name}')
    require(Path(name).suffix.lower() not in {'.key', '.pem', '.p12', '.pfx', '.db', '.sqlite', '.sqlite3', '.log', '.pyc'},
            f'Private/runtime file extension: {name}')
    require(not any(re.search(pattern, data) for pattern in SECRET_PATTERNS),
            f'Possible credential material in {name}; inspect before packaging')


def tree_hash(records):
    """Recompute the Git tree hash from all leaf paths, modes and object IDs."""
    require(isinstance(records, list) and 0 < len(records) <= MAX_FILES, 'Invalid expected Git file list')
    unique_paths([row['path'] for row in records])
    root = {}
    for row in records:
        require(set(row) == {'path', 'mode', 'gitBlob'}, 'Unexpected expected-tree record fields')
        require(row['mode'] in MODES, f'Unsupported Git mode: {row["path"]}')
        oid(row['gitBlob'])
        branch = root
        parts = row['path'].split('/')
        for part in parts[:-1]:
            branch = branch.setdefault(part, {})
        branch[parts[-1]] = (row['mode'], row['gitBlob'])

    def hash_node(node):
        entries = []
        for name, value in node.items():
            is_dir = isinstance(value, dict)
            mode, object_id = ('40000', hash_node(value)) if is_dir else value
            key = name.encode('utf-8') + (b'/' if is_dir else b'')
            data = mode.encode() + b' ' + name.encode('utf-8') + b'\0' + bytes.fromhex(object_id)
            entries.append((key, data))
        return git_hash('tree', b''.join(data for _, data in sorted(entries)))
    return hash_node(root)


def check_expected(expected, commit):
    oid(commit)
    require(isinstance(expected, dict) and set(expected) == {'schema', 'sourceCommit', 'sourceTree', 'files'},
            'Invalid expected-tree manifest fields')
    require(expected['schema'] == TREE_SCHEMA and expected['sourceCommit'] == commit,
            'Expected tree does not match the pinned commit')
    oid(expected['sourceTree'])
    require(tree_hash(expected['files']) == expected['sourceTree'], 'Expected Git-tree metadata hash mismatch')


def check_original(original, expected):
    require(git_hash('commit', original) == expected['sourceCommit'], 'Original commit SHA mismatch')
    require(original.startswith(('tree ' + expected['sourceTree'] + '\n').encode()),
            'Original commit does not reference the expected tree')


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.PIPE)


def read_expected(repo, commit):
    oid(commit)
    original = git(repo, 'cat-file', 'commit', commit)
    tree = git(repo, 'rev-parse', commit + '^{tree}').decode().strip()
    records = []
    for row in git(repo, 'ls-tree', '-rz', commit).split(b'\0'):
        if not row:
            continue
        metadata, raw_path = row.split(b'\t', 1)
        mode, kind, blob = metadata.decode('ascii').split()
        require(kind == 'blob', 'Submodules are not supported')
        records.append({'path': raw_path.decode('utf-8'), 'mode': mode, 'gitBlob': blob})
    expected = {'schema': TREE_SCHEMA, 'sourceCommit': commit, 'sourceTree': tree, 'files': records}
    check_expected(expected, commit)
    check_original(original, expected)
    return expected, original


def regular_read(root, relative):
    safe_path(relative)
    path = root
    for i, part in enumerate(relative.split('/')):
        path = path / part
        info = path.lstat()
        require(not stat.S_ISLNK(info.st_mode), f'Symlinks are forbidden: {relative}')
        if i < len(relative.split('/')) - 1:
            require(stat.S_ISDIR(info.st_mode), f'Non-directory ancestor: {relative}')
    require(stat.S_ISREG(info.st_mode), f'Not a regular file: {relative}')
    require(info.st_size <= MAX_FILE_BYTES, f'File too large: {relative}')
    mode = format(stat.S_IFREG | stat.S_IMODE(info.st_mode), '06o')
    require(mode in MODES, f'Unsupported file permissions: {relative}')
    return path.read_bytes(), mode


def record(path, data, mode, blob=None):
    result = {'path': path, 'mode': mode, 'bytes': len(data), 'sha256': sha256(data)}
    if blob is not None:
        result['gitBlob'] = blob
    return result


def common_metadata(expected):
    omitted = [{**row, 'reason': exclusion(row['path'])}
               for row in expected['files'] if exclusion(row['path'])]
    return {
        'schema': SCHEMA, 'sourceCommit': expected['sourceCommit'], 'sourceTree': expected['sourceTree'],
        'canonicalSource': 'https://github.com/magicy565-web/workspace-agent/tree/' + expected['sourceCommit'],
        'exactGitTree': False, 'gitHistoryIncluded': False,
        'excludedPrefixes': list(PREFIXES), 'requiredInclusions': list(REQUIRED_INCLUSIONS),
        'sourceExclusions': omitted,
        'trackedFiles': len(expected['files']), 'includedSourceFiles': len(expected['files']) - len(omitted),
        'accountConfiguration': CONFIG, 'realWechatAcceptance': False,
        'realShopifyAcceptance': False, 'liveDeployment': False,
        'compiledProvenance': 'Existing compiled output; clean-build equivalence must be verified separately.',
    }


def client_layout(source_data):
    """Bind the import allowlist and copied assets to this selected source tree."""
    result = {}
    prefix = 'miniprogram/src/'
    for name, data in source_data.items():
        if not name.startswith(prefix) or name.endswith('.d.ts'):
            continue
        relative = name[len(prefix):]
        if relative.endswith('.ts'):
            relative = relative[:-3] + '.js'
            data = None  # JS compilation equivalence requires a separate clean build.
        require(relative not in result and relative not in CLIENT_METADATA,
                f'Client build path collision: {relative}')
        result[relative] = data
    require('app.js' in result and 'app.json' in result, 'Mini-program source app is missing')
    for name in ('project.config.json', 'package.json'):
        require(name not in result, f'Generated client path collision: {name}')
        result[name] = None
    unique_paths(result)
    return result


def check_client(client_data, layout):
    require(set(client_data) == set(layout), 'Compiled client has missing or unexpected files; clean-build first')
    for name, data in client_data.items():
        safe_payload(name, data)
        if layout[name] is not None:
            require(data == layout[name], f'Copied client asset differs from selected Git source: {name}')
    config = decode(client_data['project.config.json'])
    require(config.get('appid') == 'touristappid' and config.get('setting', {}).get('urlCheck') is True,
            'Client must use touristappid and urlCheck=true')
    require(config.get('miniprogramRoot') == './' and config.get('compileType') == 'miniprogram',
            'Unsafe client import root or type')
    require(decode(client_data['package.json']) == {'type': 'commonjs', 'private': True},
            'Unexpected generated client package.json')
    app = client_data['app.js'].decode('utf-8')
    assignments = re.findall(r'\bbaseUrl\s*=', app)
    blank = re.findall(r'\bconst\s+baseUrl\s*=\s*([\'\"])\1\s*;', app)
    require(len(assignments) == 1 and len(blank) == 1, 'Client baseUrl must be an unambiguous blank constant')


def write_zip(path, entries):
    unique_paths(entries)
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, (data, mode) in sorted(entries.items()):
            info = zipfile.ZipInfo(name, (2026, 10, 12, 0, 0, 0))
            info.create_system = 3
            info.external_attr = int(mode, 8) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)


def archive_bytes(path):
    require(Path(path).stat().st_size <= MAX_ARCHIVE_BYTES, 'ZIP input exceeds size limit')
    data = Path(path).read_bytes()
    require(len(data) <= MAX_ARCHIVE_BYTES, 'ZIP input exceeds size limit')
    return data


def read_zip(data):
    result = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos = archive.infolist()
        require(0 < len(infos) <= MAX_FILES, 'Archive entry count exceeds limit')
        unique_paths([info.filename for info in infos])
        require(sum(info.file_size for info in infos) <= MAX_ARCHIVE_BYTES, 'Archive expands beyond size limit')
        for info in infos:
            require(info.filename == info.orig_filename, 'ZIP filename contains a NUL byte')
            require(info.create_system == 3 and info.external_attr >> 16 in {int(mode, 8) for mode in MODES},
                    f'Non-regular ZIP entry or unsafe mode: {info.filename}')
            require(not info.flag_bits & 1 and info.file_size <= MAX_FILE_BYTES, 'Encrypted or oversized ZIP entry')
            require(info.compress_type in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}, 'Unsupported ZIP compression')
            data = archive.read(info)
            require(len(data) == info.file_size, f'ZIP length mismatch: {info.filename}')
            result[info.filename] = (data, format(info.external_attr >> 16, '06o'))
    return result


def source_readme(expected):
    return f'''Workspace portable source checkpoint\nSource commit: {expected['sourceCommit']}\nSource tree: {expected['sourceTree']}\nCanonical source: https://github.com/magicy565-web/workspace-agent/tree/{expected['sourceCommit']}\n\nWorkspace-Agent/ includes every tracked path except the fixed historical prefixes\nlisted in SOURCE-MANIFEST.json, with its explicit required-inclusion exception
for docs/validation/managed-commerce-sources.json (a current test fixture).
Every omission records its Git blob, mode and\nreason. exactGitTree=false: this is NOT a complete or reconstructable Git tree.\nHistorical archives, screenshots, evidence and release outputs are not included.\nThe original commit and full expected-tree metadata prove the selected identity;\nthey cannot restore omitted blob contents or Git history. GitHub's fixed SHA\nremains canonical. No local .git, node_modules, untracked files or runtime data\nare collected. Never treat local fixtures as real platform acceptance.\n\nUse the matching WeChat import ZIP. Safe defaults: touristappid, urlCheck=true,\nblank baseUrl. Real WeChat/account/device, Shopify and live deployment acceptance\nare not claimed. Native popup decisions remain client reports, not independent\nplatform authorization. Review miniprogram/IMPORT.md for account prerequisites.\n\nAfter verification: cd Workspace-Agent; npm ci --ignore-scripts; npm run build;\nnpm run build:mini. Client SHA-256 proves artifact integrity; reproduce a clean\nbuild separately before claiming compiled output equivalence.\n'''.encode()


def client_readme(expected):
    return f'''Workspace WeChat portable import checkpoint\nSource commit: {expected['sourceCommit']}\nSource tree: {expected['sourceTree']}\n\nExtract this archive and import the directory containing project.config.json in\nWeChat Developer Tools. appid=touristappid, urlCheck=true and baseUrl is blank.\nAccount-bound functions fail closed until the owner configures their existing\nAppID, trusted ingress/login broker and legal domains. This package does not\ncreate credentials, deploy, or prove real WeChat/Shopify/device acceptance.\nBUILD-MANIFEST.json contains file SHA-256 and mode records for this client.\nThe associated portable source intentionally omits recorded historical paths;\nGitHub's pinned commit remains canonical. Compilation provenance is a separate\nclean-build check, not established by a manifest label alone.\n'''.encode()


def ensure_new_directory(path):
    require(not path.exists() and not path.is_symlink(), f'Destination must not already exist: {path}')
    for parent in path.parents:
        require(not parent.is_symlink(), f'Symlink destination ancestor: {parent}')
    path.parent.mkdir(parents=True, exist_ok=True)


def package(repository, commit, compiled, output):
    repository, compiled, output = Path(repository).absolute(), Path(compiled).absolute(), Path(output).absolute()
    require(not any(path.is_symlink() for root in (repository, compiled) for path in (root, *root.parents)),
            'Input root or ancestor cannot be a symlink')
    expected, original = read_expected(repository, commit)
    common = common_metadata(expected)
    source_records, source_data, source_entries = [], {}, {}
    for row in expected['files']:
        name = row['path']
        if exclusion(name):
            continue
        data, mode = regular_read(repository, name)
        require(git_hash('blob', data) == row['gitBlob'] and mode == row['mode'],
                f'Required source differs from selected Git blob/mode: {name}')
        safe_payload(name, data)
        source_records.append(record(name, data, mode, row['gitBlob']))
        source_data[name] = data
        source_entries['Workspace-Agent/' + name] = (data, mode)
    layout = client_layout(source_data)
    client_data, client_entries, client_records = {}, {}, []
    for directory, dirs, files in os.walk(compiled, followlinks=False):
        for name in dirs:
            require(not (Path(directory) / name).is_symlink(), 'Compiled directory symlink is forbidden')
        for name in files:
            relative = (Path(directory) / name).relative_to(compiled).as_posix()
            data, mode = regular_read(compiled, relative)
            require(mode == '100644', f'Compiled client must be non-executable: {relative}')
            client_data[relative] = data
            client_entries[relative] = (data, mode)
            client_records.append(record(relative, data, mode))
    check_client(client_data, layout)
    source_manifest = {**common, 'kind': 'source', 'files': source_records}
    client_manifest = {**common, 'kind': 'client', 'files': sorted(client_records, key=lambda row: row['path'])}
    source_entries.update({'SOURCE-MANIFEST.json': (encode(source_manifest), '100644'),
                           'ORIGINAL-COMMIT.txt': (original, '100644'),
                           'DELIVERY-README.txt': (source_readme(expected), '100644')})
    client_entries.update({'BUILD-MANIFEST.json': (encode(client_manifest), '100644'),
                           'IMPORT-README.txt': (client_readme(expected), '100644')})
    ensure_new_directory(output)
    staging = Path(tempfile.mkdtemp(prefix='.portable-', dir=output.parent))
    try:
        short = commit[:12]
        source_zip = staging / f'Workspace-Agent-Portable-Source-{short}.zip'
        client_zip = staging / f'Workspace-Agent-Portable-WeChat-Import-{short}.zip'
        write_zip(source_zip, source_entries)
        write_zip(client_zip, client_entries)
        for name, value in [('EXPECTED-GIT-TREE.json', expected), ('SOURCE-MANIFEST.json', source_manifest),
                            ('BUILD-MANIFEST.json', client_manifest)]:
            (staging / name).write_bytes(encode(value))
        summary = {**common, 'source': {'file': source_zip.name, 'sha256': sha256(source_zip.read_bytes()),
                                      'bytes': source_zip.stat().st_size},
                   'client': {'file': client_zip.name, 'sha256': sha256(client_zip.read_bytes()),
                              'bytes': client_zip.stat().st_size, 'files': len(client_records)}}
        (staging / 'PORTABLE-VERSION.json').write_bytes(encode(summary))
        (staging / 'SHA256SUMS.txt').write_text(''.join(
            f'{summary[key]["sha256"]}  {summary[key]["file"]}\n' for key in ('source', 'client')))
        # Run the same offline verifier before publishing any package directory.
        verify_archives(source_zip, client_zip, expected, commit)
        staging.rename(output)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return summary


def check_manifest(manifest, common, kind):
    require(isinstance(manifest, dict) and set(manifest) == set(common) | {'kind', 'files'},
            f'Unexpected {kind} manifest fields')
    require(json.dumps({key: manifest[key] for key in common}, sort_keys=True) ==
            json.dumps(common, sort_keys=True) and manifest['kind'] == kind,
            f'{kind} manifest identity, safety metadata or exclusions differ from expected tree')
    require(isinstance(manifest['files'], list), 'Manifest files must be a list')
    unique_paths([row['path'] for row in manifest['files']])


def check_records(entries, rows, prefix='', blobs=False):
    data_by_path = {}
    for row in rows:
        keys = {'path', 'mode', 'bytes', 'sha256'} | ({'gitBlob'} if blobs else set())
        require(set(row) == keys, f'Unexpected file record fields: {row.get("path")}')
        name = row['path']
        require(prefix + name in entries, f'Missing listed file: {name}')
        data, mode = entries[prefix + name]
        require(type(row['bytes']) is int and len(data) == row['bytes'] and sha256(data) == row['sha256']
                and mode == row['mode'], f'Tampered file bytes, mode or SHA-256: {name}')
        if blobs:
            require(git_hash('blob', data) == row['gitBlob'], f'Original Git blob mismatch: {name}')
        safe_payload(name, data)
        data_by_path[name] = data
    return data_by_path


def verify_archives(source, client, expected, commit, client_sha256=None):
    check_expected(expected, commit)
    common = common_metadata(expected)
    source_bytes, client_bytes = archive_bytes(source), archive_bytes(client)
    if client_sha256 is not None:
        require(sha256(client_bytes) == client_sha256, 'Pinned client ZIP SHA-256 mismatch')
    source_entries, client_entries = read_zip(source_bytes), read_zip(client_bytes)
    require(SOURCE_METADATA <= set(source_entries) and CLIENT_METADATA <= set(client_entries),
            'Required archive metadata is missing')
    source_manifest = decode(source_entries['SOURCE-MANIFEST.json'][0])
    client_manifest = decode(client_entries['BUILD-MANIFEST.json'][0])
    check_manifest(source_manifest, common, 'source')
    check_manifest(client_manifest, common, 'client')
    check_original(source_entries['ORIGINAL-COMMIT.txt'][0], expected)
    require(source_entries['DELIVERY-README.txt'] == (source_readme(expected), '100644'), 'Source README was altered')
    require(client_entries['IMPORT-README.txt'] == (client_readme(expected), '100644'), 'Import README was altered')
    for name in SOURCE_METADATA:
        require(source_entries[name][1] == '100644', 'Unsafe source metadata mode')
    for name in CLIENT_METADATA:
        require(client_entries[name][1] == '100644', 'Unsafe client metadata mode')
    wanted = {row['path']: row for row in expected['files'] if not exclusion(row['path'])}
    actual = {row['path']: {key: row[key] for key in ('path', 'mode', 'gitBlob')}
              for row in source_manifest['files']}
    require(actual == wanted, 'Included source paths, Git blobs or modes differ from expected tree')
    require(set(source_entries) == {'Workspace-Agent/' + path for path in wanted} | SOURCE_METADATA,
            'Unlisted or missing source archive files')
    require(set(client_entries) == {row['path'] for row in client_manifest['files']} | CLIENT_METADATA,
            'Unlisted or missing client archive files')
    source_data = check_records(source_entries, source_manifest['files'], 'Workspace-Agent/', True)
    client_data = check_records(client_entries, client_manifest['files'])
    require(all(row['mode'] == '100644' for row in client_manifest['files']), 'Executable client files are forbidden')
    check_client(client_data, client_layout(source_data))
    result = {'schema': 'workspace.portable-verification.v1', 'sourceCommit': commit,
              'sourceTree': expected['sourceTree'], 'sourceFiles': len(source_data),
              'excludedGitPaths': len(common['sourceExclusions']), 'clientFiles': len(client_data),
              'sourceSha256': sha256(source_bytes), 'clientSha256': sha256(client_bytes),
              'allIncludedGitBlobsModesShaMatched': True, 'allExclusionsMatchExpectedTree': True,
              'expectedTreeMetadataMatchesPinnedCommit': True, 'allClientBytesModesShaMatched': True,
              'exactGitTree': False, 'exactGitTreeReconstructed': False, 'gitHistoryRestored': False,
              'compiledEquivalenceVerified': False, 'accountConfiguration': CONFIG}
    return result, source_entries, client_entries


def verify(source, client, expected_tree, commit, client_sha256, destination=None):
    require(isinstance(client_sha256, str) and re.fullmatch(r'[0-9a-f]{64}', client_sha256),
            'Supply the independently recorded client ZIP SHA-256')
    expected = decode(Path(expected_tree).read_bytes())
    result, source_entries, client_entries = verify_archives(source, client, expected, commit, client_sha256)
    result['safeExtraction'] = False
    if destination is not None:
        destination = Path(destination).absolute()
        ensure_new_directory(destination)
        staging = Path(tempfile.mkdtemp(prefix='.portable-verify-', dir=destination.parent))
        try:
            for folder, entries in [('source', source_entries), ('client', client_entries)]:
                for name, (data, mode) in entries.items():
                    target = staging / folder / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with target.open('xb') as handle:
                        handle.write(data)
                    target.chmod(stat.S_IMODE(int(mode, 8)))
            staging.rename(destination)
        finally:
            if staging.exists():
                shutil.rmtree(staging)
        result.update(safeExtraction=True, sourceDirectory=str(destination / 'source/Workspace-Agent'),
                      clientDirectory=str(destination / 'client'))
    return result
