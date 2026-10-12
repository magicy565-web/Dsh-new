#!/usr/bin/env python3
"""Verify raw source hashes; optionally install/build and boot clean Pi package."""
import argparse
import hashlib
import json
import os
import pathlib
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('archive')
parser.add_argument('--build-boot', action='store_true')
args = parser.parse_args()
source = pathlib.Path(args.archive).resolve()
with tempfile.TemporaryDirectory(prefix='workspace-pi-package-') as location:
    directory = pathlib.Path(location)
    with zipfile.ZipFile(source) as archive:
        names = archive.namelist()
        if len(set(names)) != len(names): raise RuntimeError('Duplicate archive path')
        for name in names:
            if pathlib.PurePosixPath(name).is_absolute() or '..' in pathlib.PurePosixPath(name).parts: raise RuntimeError('Unsafe archive path')
        manifest = json.loads(archive.read('Workspace-Agent/PI-SOURCE-MANIFEST.json'))
        assert manifest['byteSource'].startswith('git cat-file blob') and manifest['runtime']['dshRequired'] is False
        for item in manifest['files']:
            raw = archive.read('Workspace-Agent/' + item['path'])
            assert len(raw) == item['bytes'] and hashlib.sha256(raw).hexdigest() == item['sha256'], item['path']
            git_bytes = f"blob {len(raw)}\0".encode() + raw
            assert hashlib.sha1(git_bytes).hexdigest() == item['gitBlob'], item['path']
        archive.extractall(directory)
    root = directory / 'Workspace-Agent'
    for prohibited in ['.env', '.data', 'node_modules', 'backend/deepseek-harness-source.tar.gz']:
        assert not (root / prohibited).exists(), prohibited
    checks = ['all SHA256 and original Git blob IDs match raw archive bytes', 'no credentials, live runtime directories or dependency tree']
    if args.build_boot:
        environment = {'PATH': os.environ['PATH'], 'LANG': 'C.UTF-8', 'npm_config_cache': '/tmp/workspace-npm-cache', 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD': '1'}
        for command in [['npm', 'ci'], ['npm', 'run', 'build'], ['npm', 'run', 'build:mini']]:
            result = subprocess.run(command, cwd=root, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=120)
            if result.returncode: raise RuntimeError('Clean package command failed: ' + ' '.join(command) + '\n' + result.stdout)
        checks += ['clean npm ci (locked registry dependencies)', 'clean TypeScript/Vite build', 'clean official-types mini program build']
        with socket.socket() as sock: sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        data_directory = directory / 'private-runtime'; data_directory.mkdir(mode=0o700)
        environment.update({'PORT': str(port), 'WORKSPACE_DATA_DIR': str(data_directory), 'WORKSPACE_RUNTIME': 'pi', 'FASTAITOKEN_API_KEY': ''})
        url = f'http://127.0.0.1:{port}'
        def request(route, body=None):
            payload = None if body is None else json.dumps(body).encode()
            req = urllib.request.Request(url + route, data=payload, headers={} if body is None else {'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=3) as response: return json.loads(response.read())
        def boot():
            child = subprocess.Popen(['node', 'server/index.mjs'], cwd=root, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    if child.poll() is not None: raise RuntimeError('Clean package startup failed: ' + child.stderr.read())
                    try: return child, request('/api/health')
                    except (OSError, ValueError): time.sleep(.05)
                raise RuntimeError('Clean package startup timed out')
            except BaseException: child.kill(); child.wait(); raise
        def stop(child):
            child.send_signal(signal.SIGTERM)
            stdout, stderr = child.communicate(timeout=10)
            assert child.returncode == 0, stdout + stderr
        child, health = boot()
        try:
            assert health['provider']['kind'] == 'pi-durable' and health['provider']['configured'] is False
            conversation = request('/api/conversations', {'title': 'Clean extraction acceptance'})['conversation']
            sent = request('/api/conversations/' + conversation['id'] + '/messages', {'content': 'Keyless startup fixture; no model request.', 'requestId': 'package-stable-request'})
            assert sent['run']['status'] == 'blocked'
        finally: stop(child)
        child, health = boot()
        try:
            repeated = request('/api/conversations/' + conversation['id'] + '/messages', {'content': 'Keyless startup fixture; no model request.', 'requestId': 'package-stable-request'})
            assert repeated['duplicate'] is True and repeated['run']['id'] == sent['run']['id']
        finally: stop(child)
        checks += ['DSH-free keyless HTTP boot and graceful stop', 'actual Store restart and original request dedupe without model/production calls']
    print(json.dumps({'result': 'passed', 'evidenceKind': 'clean-pi-source-package', 'sourceCommit': manifest['sourceCommit'], 'sourceTree': manifest['sourceTree'], 'archiveSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'files': len(manifest['files']), 'checks': checks, 'liveMuse': False, 'liveModel': False, 'production': False}, indent=2))
