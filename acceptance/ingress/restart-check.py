#!/usr/bin/env python3
"""Explicitly restart only selected project's application and entry containers."""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument('project', choices=['docling', 'medusa'])
p.add_argument('--confirm-restart', action='store_true', required=True)
a = p.parse_args()
check = [sys.executable, str(Path(__file__).with_name('check.py')), a.project]
subprocess.run(check, check=True)
compose = ['docker', 'compose', '-f', f'acceptance/{a.project}/compose.yaml']
services = ['docling'] if a.project == 'docling' else ['api']
subprocess.run(compose + ['restart', *services], check=True)
subprocess.run(compose + ['restart', 'ingress' if a.project == 'docling' else 'ui'], check=True)
end = time.monotonic() + 120
while True:
    result = subprocess.run(check, capture_output=True, text=True)
    if result.returncode == 0:
        report = json.loads(result.stdout)
        report['restartRecovery'] = 'PASSED_PROCESS_RESTART_ONLY'
        report['containerRecreation'] = 'NOT_TESTED'
        print(json.dumps(report))
        break
    if time.monotonic() >= end:
        print(json.dumps({'ok': False, 'restartRecovery': 'FAILED', 'hostParserTransfer': 'NOT_TESTED'}))
        sys.exit(1)
    time.sleep(2)
