#!/usr/bin/env python3
"""Read-only deployment checks. Never prints response bodies or credentials."""
import argparse
import json
import subprocess
import sys
import urllib.request
import urllib.error

def run(project):
    command = ['docker', 'compose', '-f', f'acceptance/{project}/compose.yaml']
    ids = subprocess.check_output(command + ['ps', '-q'], text=True).split()
    if not ids:
        raise RuntimeError('no running project containers')
    containers = json.loads(subprocess.check_output(['docker', 'inspect', *ids], text=True))
    expected = {'ingress': {'8080/tcp': '5001'}} if project == 'docling' else {'ui': {'9000/tcp': '9000', '8080/tcp': '4173'}}
    seen = set()
    for c in containers:
        service = c['Config']['Labels']['com.docker.compose.service']
        seen.add(service)
        ports = c['NetworkSettings'].get('Ports') or {}
        bindings = {p: v for p, v in ports.items() if v}
        wanted = expected.get(service, {})
        if set(bindings) != set(wanted):
            raise RuntimeError(f'{service}: missing or unexpected published port')
        for port, hostport in wanted.items():
            if bindings[port] != [{'HostIp': '127.0.0.1', 'HostPort': hostport}]:
                raise RuntimeError(f'{service}: nonloopback or unexpected binding')
        networks = c['NetworkSettings']['Networks']
        for name in networks:
            n = json.loads(subprocess.check_output(['docker', 'network', 'inspect', name], text=True))[0]
            if service not in ('ingress', 'ui') and not n['Internal']:
                raise RuntimeError(f'{service}: nonprivate network')
        if service in ('ingress', 'ui') and any(name.endswith('_private') for name in networks):
            raise RuntimeError('entry must not join database network')
    required = {'ingress', 'docling'} if project == 'docling' else {'api', 'ui', 'postgres', 'redis'}
    if seen != required:
        raise RuntimeError('missing or unexpected service')
    probes = [('http://127.0.0.1:5001/health', 'GET', {200}),
              ('http://127.0.0.1:5001/v1/convert/file', 'POST', {401, 403})] if project == 'docling' else [
              ('http://127.0.0.1:9000/health', 'GET', {200}),
              ('http://127.0.0.1:4173/', 'GET', {200}),
              ('http://127.0.0.1:9000/admin/products?limit=1', 'GET', {401, 403}),
              ('http://127.0.0.1:4173/admin/products?limit=1', 'GET', {401, 403})]
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    results = []
    for url, method, allowed in probes:
        request = urllib.request.Request(url, method=method, data=b'' if method == 'POST' else None)
        try:
            with opener.open(request, timeout=35) as response:
                status = response.status
        except urllib.error.HTTPError as error:
            status = error.code
            error.close()
        results.append({'url': url, 'method': method, 'status': status})
        if status not in allowed:
            raise RuntimeError(f'unexpected HTTP status {status} for {url}')
    return {'ok': True, 'project': project, 'checks': results,
            'hostParserTransfer': 'NOT_TESTED', 'restartRecovery': 'NOT_TESTED'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('project', choices=['docling', 'medusa'])
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.project)))
    except Exception as error:
        print(json.dumps({'ok': False, 'errorType': type(error).__name__,
                          'hostParserTransfer': 'NOT_TESTED', 'restartRecovery': 'NOT_TESTED'}))
        sys.exit(1)
