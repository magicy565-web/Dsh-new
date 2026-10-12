"""Actual Pi CLI/PTY keystroke test + unchanged Muse consumer, all synthetic.

Uses Python's standard-library PTY on Unix; no terminal emulator fixture and no
external account. The Node host is temporary and accepts loopback connections.
"""
from datetime import datetime, timedelta, timezone
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import struct
import subprocess
import tempfile
import termios
import time

root = Path(__file__).resolve().parents[1]
ansi = re.compile(r"\x1b\][^\x07]*?(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]")
host = subprocess.Popen(["node", str(root / "test/fixtures/terminal-host.mjs")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
child = None
master = None
checks = []
try:
    ready = host.stdout.readline()
    if not ready:
        raise AssertionError(host.stderr.read())
    settings = json.loads(ready)
    with tempfile.TemporaryDirectory(prefix="pi-terminal-client-") as client_dir:
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 60, 180, 0, 0))
        environment = {**os.environ, "WORKSPACE_PI_LOCAL_URL": f'http://127.0.0.1:{settings["port"]}', "WORKSPACE_PI_DATA_DIR": client_dir, "TERM": "xterm-256color"}
        environment.pop("WORKSPACE_PI_OWNER_TRANSPORT", None)
        environment.pop("WORKSPACE_PI_OWNER_RPC_FD", None)
        child = subprocess.Popen(["node", str(root / "launch.mjs")], stdin=slave, stdout=slave, stderr=slave, env=environment, cwd=root)
        os.close(slave)
        received = ""

        def expect(text, timeout=12):
            global received
            end = time.monotonic() + timeout
            while time.monotonic() < end:
                clean = ansi.sub("", received)
                if text in clean:
                    received = ""
                    return
                readable, _, _ = select.select([master], [], [], 0.1)
                if readable:
                    try:
                        received += os.read(master, 65536).decode("utf8", errors="replace")
                    except OSError:
                        break
            raise AssertionError(f"Terminal did not display {text!r}; last output: {ansi.sub('', received)[-4000:]}")

        def send(text):
            global received
            received = ""
            os.write(master, (text + "\r").encode())

        def state():
            host.stdin.write("state\n")
            host.stdin.flush()
            value = host.stdout.readline()
            if not value:
                raise AssertionError(host.stderr.read())
            return json.loads(value)

        def wait_state(predicate):
            end = time.monotonic() + 5
            while time.monotonic() < end:
                snapshot = state()
                if predicate(snapshot):
                    return snapshot
                time.sleep(0.03)
            raise AssertionError(f"Expected fixture state was not reached: {snapshot}")

        def exit_cli():
            os.write(master, b"\x04")
            end = time.monotonic() + 8
            # Pi flushes its transcript when leaving fullscreen. Keep consuming
            # the real PTY so a full output buffer cannot deadlock normal exit.
            while child.poll() is None and time.monotonic() < end:
                readable, _, _ = select.select([master], [], [], 0.05)
                if readable:
                    try:
                        os.read(master, 65536)
                    except OSError:
                        break
            child.wait(timeout=max(0.1, end - time.monotonic()))
            assert child.returncode == 0

        expect("/workspace-muse")
        send("/workspace-muse connect")
        expect('"onlineVerified":false')
        checks.append("real Pi 1.1.0 TUI loads command and checks existing local owner")
        send("/workspace-muse new")
        answers = [
            ("Existing service ID", "channel-validation"), ("Public product description", "Terminal public fixture"),
            ("Target market", "US"), ("Task objective", "Actual Pi terminal protocol fixture only"),
            ("Exact maximum credits", "5"),
            ("Deadline with timezone", (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()),
        ]
        for prompt, answer in answers:
            expect(prompt)
            send(answer)
        expect("Save this public task for review?")
        send("")  # Human fixture explicitly selects Yes in the actual Pi dialog.
        snapshot = wait_state(lambda value: len(value["orders"]) == 1)
        task = snapshot["orders"][0]["id"]
        assert snapshot["orders"][0]["status"] == "draft" and not snapshot["tasks"]
        checks.append("actual terminal inputs create one inert original draft")
        expect('"review_required"')
        send(f"/workspace-muse approve {task}")
        expect("APPROVE this exact original task?")
        send("\x1b[B")  # Select No in the actual Pi confirmation dialog.
        expect("Action cancelled.")
        assert state()["orders"][0]["status"] == "draft"
        checks.append("actual confirmation cancellation preserves draft")
        send(f"/workspace-muse approve {task}")
        expect("APPROVE this exact original task?")
        send("")
        wait_state(lambda value: value["orders"][0]["status"] == "approved")
        expect('"phase":"approved"')
        send(f"/workspace-muse dispatch {task}")
        expect("DISPATCH this exact original task?")
        send("")
        wait_state(lambda value: len(value["tasks"]) == 1)
        expect('"phase":"queued"')
        checks.append("separate actual terminal approval and dispatch enqueue the same task")
        send(f"/workspace-muse handoff {task}")
        expect('"externalSend":false')
        handoffs = list((Path(client_dir) / "handoffs").glob("*.md"))
        assert len(handoffs) == 1 and task in handoffs[0].read_text()
        assert state()["tasks"][0]["status"] == "pending"
        checks.append("actual TUI saves exact-order public Muse handoff without sending or claiming")
        consumer = subprocess.run(["python3", str(root / "test/fixtures/muse-consumer.py")], input=json.dumps({**settings, "directory": str(Path(client_dir) / "consumer"), "host": "fixture.test", "taskRef": task}), capture_output=True, text=True, timeout=15)
        assert consumer.returncode == 0, consumer.stderr + consumer.stdout
        checks.append("checked-in Muse CLI claims, heartbeats, uploads and submits that task")
        send(f"/workspace-muse refresh {task}")
        expect('"phase":"result_returned"')
        snapshot = state()
        assert len(snapshot["orders"]) == len(snapshot["tasks"]) == 1
        assert snapshot["modelRuns"] == 0
        assert snapshot["messages"][0]["content"] == "Checked-in Muse CLI local fixture result"
        checks.append("actual TUI refresh displays result and original Session receives same summary; zero model runs")
        exit_cli()
        os.close(master)
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 60, 180, 0, 0))
        received = ""
        child = subprocess.Popen(["node", str(root / "launch.mjs")], stdin=slave, stdout=slave, stderr=slave, env=environment, cwd=root)
        os.close(slave)
        expect("/workspace-muse")
        send(f"/workspace-muse status {task}")
        expect('"phase":"result_returned"')
        assert len(state()["orders"]) == 1
        checks.append("cold Pi TUI restart reads the same task and returned result")
        exit_cli()
        print(json.dumps({"evidenceKind": "actual-pi-pty-and-checked-in-muse-consumer-local-fixture", "passed": len(checks), "checks": checks, "realMuseVerified": False}, indent=2))
finally:
    if child and child.poll() is None:
        child.terminate()
        child.wait(timeout=5)
    if master is not None:
        os.close(master)
    if host.poll() is None:
        host.stdin.write("close\n")
        host.stdin.flush()
        try:
            host.wait(timeout=8)
        except subprocess.TimeoutExpired:
            host.terminate()
            host.wait(timeout=5)
