#!/usr/bin/env python3
"""Extract a release and verify dependency-free, keyless startup and durable restart."""
import hashlib
import json
import os
import pathlib
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

archive = pathlib.Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix='workspace-release-check-') as folder:
    base = pathlib.Path(folder)
    with zipfile.ZipFile(archive) as package:
        for name in package.namelist():
            if pathlib.PurePosixPath(name).is_absolute() or '..' in pathlib.PurePosixPath(name).parts:
                raise RuntimeError('Unsafe archive member')
        package.extractall(base)
    root = base / 'Workspace-Agent'
    manifest = json.loads((root / 'RELEASE-MANIFEST.json').read_text())
    handoff = (root / '00_READ_FIRST_WORK_HANDOFF.md').read_text()
    assert 'IN PROGRESS' not in handoff and 'Final checkpoint verification' in handoff
    assert (root / 'docs/BUSINESS-FLOW-AUDIT.md').is_file()
    for item in manifest['files']:
        if hashlib.sha256((root / item['path']).read_bytes()).hexdigest() != item['sha256']:
            raise RuntimeError('Manifest hash mismatch: ' + item['path'])
    assert not (root / 'node_modules').exists()
    assert not (root / '.env').exists()
    assert not (root / '.data').exists()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    url = f'http://127.0.0.1:{port}'
    environment = {'PATH': os.environ.get('PATH', ''), 'HOME': folder, 'LANG': 'C.UTF-8', 'PORT': str(port), 'DEEPSEEK_API_KEY': '', 'FASTAITOKEN_API_KEY': '', 'FASTAITOKEN_MODEL': 'gpt-6-sol', 'WORKSPACE_RUNTIME': 'fastaitoken'}
    def request(route, method='GET', body=None, raw=False):
        payload = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(url + route, data=payload, method=method, headers={} if body is None else {'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=5) as response:
            content = response.read()
            return content if raw else json.loads(content)
    def launch():
        child = subprocess.Popen(['node', '--env-file-if-exists=.env', 'server/index.mjs'], cwd=root, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if child.poll() is not None: raise RuntimeError('Server exited: ' + child.stderr.read())
            try:
                state = request('/api/bootstrap')
                assert state['runtime']['configured'] is False
                assert state['runtime']['kind'] == 'fastaitoken-api' and state['runtime']['model'] == 'gpt-6-sol'
                return child, state
            except (OSError, urllib.error.URLError): time.sleep(0.05)
        child.kill(); raise RuntimeError('Clean server startup timed out')
    def stop(child):
        child.send_signal(signal.SIGTERM)
        try: child.communicate(timeout=10)
        except subprocess.TimeoutExpired: child.kill(); child.communicate(); raise RuntimeError('Graceful shutdown timed out')
        assert child.returncode == 0
    unsafe = subprocess.run(['node', 'server/index.mjs'], cwd=root, env={**environment, 'NODE_ENV': 'production', 'WORKSPACE_ACCESS_MODE': 'local'}, capture_output=True, text=True, timeout=10)
    assert unsafe.returncode != 0 and 'enterprise' in unsafe.stderr
    first, state = launch()
    try:
        first_instance = state['diagnostics']['instanceId']
        diagnostics = request('/api/diagnostics')
        assert diagnostics['instanceId'] == first_instance and diagnostics['readOnly'] is True and diagnostics['externalCalls'] is False
        assert diagnostics['provider']['localVerification']['status'] == 'passed'
        assert diagnostics['provider']['liveValidation']['status'] == 'not_validated'
        assert diagnostics['provider']['lastObservation']['status'] == 'not_observed'
        assert diagnostics['storage']['liveWriteProbe'] is False
        assert state['capabilities']['scheduler']['automaticTimer'] is True
        assert any(item['adapter'] == 'workspace-library' for item in state['capabilities']['adapterCatalog'])
        assert state['version'] == 2 and not state['conversations'] and not state['capabilities']['connectors']
        assert request('/', raw=True).startswith(b'<!doctype html>')
        conversation = request('/api/conversations', 'POST', {'title': 'Release startup fixture'})['conversation']
        sent = request(f'/api/conversations/{conversation["id"]}/messages', 'POST', {'content': 'No-model fixture', 'requestId': 'release-check'})
        assert sent['run']['status'] == 'blocked'
        memory = request('/api/memories', 'POST', {'content': 'Durable release memory fixture'})['memory']
        artifact = request('/api/artifacts', 'POST', {'filename': 'release-fixture.txt', 'content': 'Durable artifact fixture'})['artifact']
        assert request(f'/api/artifacts/{artifact["id"]}/download', raw=True) == b'Durable artifact fixture'
    finally: stop(first)
    second, state = launch()
    try:
        assert state['diagnostics']['instanceId'] != first_instance
        assert state['diagnostics']['provider']['localVerification']['status'] == 'passed'
        assert state['diagnostics']['provider']['lastObservation']['status'] == 'not_observed'
        assert state['conversations'][0]['id'] == conversation['id']
        assert state['memories'][0]['id'] == memory['id']
        assert state['runs'][0]['status'] == 'blocked'
        assert request(f'/api/artifacts/{artifact["id"]}/download', raw=True) == b'Durable artifact fixture'
        assert not state['capabilities']['scheduleRuns'] and not state['capabilities']['connectorRuns']
    finally: stop(second)
    print(json.dumps({'archive': archive.name, 'manifest_files_verified': len(manifest['files']), 'source_tree': manifest['sourceWorkingTree'], 'node': subprocess.check_output(['node', '--version'], text=True).strip(), 'dependencies_installed': False, 'credentials_used': False, 'external_calls': False, 'checks': ['zip hashes', 'complete Work handoff', 'shipped local connector catalog', 'clean extraction', 'packaged frontend served', 'production refuses local access', 'keyless selected-relay blocked chat', 'memory and artifact creation', 'graceful shutdown', 'durable restart', 'artifact bytes restored', 'no connector or scheduler execution', 'read-only diagnostics and source-bound local fixture evidence', 'instance identity changes on restart', 'no inferred live provider validation'], 'result': 'passed'}, indent=2))
