"""Real Pi Agent-mode CLI/PTY with deterministic local provider and original HTTP.
No real model, key, external service or account. Natural-language quality is not tested.
"""
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
expected_tools = ["workspace_supplier_owner_intake", "workspace_supplier_owner_get", "workspace_supplier_owner_profile", "workspace_supplier_owner_preview", "workspace_muse_draft"]
process = None
master = None
received = ""
checks = []


def drain(timeout=0.05):
    global received
    if select.select([master], [], [], timeout)[0]:
        try:
            received += os.read(master, 65536).decode("utf8", errors="replace")
        except OSError:
            pass


def expect(text, timeout=20):
    global received
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        clean = ansi.sub("", received)
        # Pi adds layout whitespace at physical PTY wraps, even inside JSON keys.
        if text in clean or re.sub(r"\s+", "", text) in re.sub(r"\s+", "", clean):
            received = ""
            return
        drain()
    raise AssertionError(f"Expected {text!r}, actual Pi output: {ansi.sub('', received)[-6000:]}")


def send(text):
    global received
    received = ""
    os.write(master, (text + "\r").encode())


def approve(title, yes=True):
    expect(title)
    send("" if yes else "\x1b[B")


try:
    with tempfile.TemporaryDirectory(prefix="pi-agent-terminal-", dir="/tmp") as dirname:
        temp = Path(dirname)
        state_file, report_file = temp / "state.json", temp / "provider.json"
        env = {**os.environ, "TERM": "xterm-256color", "WORKSPACE_PI_DATA_DIR": str(temp / "client"), "PI_CODING_AGENT_DIR": str(temp / "profile"),
               "PI_SUPPLIER_FIXTURE_DIRECTORY": str(temp / "server"), "PI_SUPPLIER_FIXTURE_STATE": str(state_file), "PI_SUPPLIER_PROVIDER_REPORT": str(report_file)}
        for key in ["WORKSPACE_PI_OWNER_TRANSPORT", "WORKSPACE_PI_OWNER_RPC_FD", "WORKSPACE_PI_LOCAL_URL", "PI_SUPPLIER_UNATTENDED"]:
            env.pop(key, None)
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 70, 220, 0, 0))
        process = subprocess.Popen(["node", str(root / "integration/fixtures/agent-terminal-host.mjs")], stdin=slave, stdout=slave, stderr=slave, env=env, cwd=root)
        os.close(slave)
        state = lambda: json.loads(state_file.read_text())
        report = lambda: json.loads(report_file.read_text())
        expect("Agent mode selected.")
        send("/workspace-agent status")
        expect('"ready":true')
        send("/workspace-supplier connect")
        expect('"modelToolsRegistered":true')
        send("请录入这款合成衬衫，但等待我确认 [fixture:intake-no]")
        approve("MODEL PROPOSAL: intake supplier data?", yes=False)
        expect("SYNTHETIC_DONE_INTAKE_NO")
        assert not state()["services"]
        assert any("USER_CONFIRMATION_DECLINED" in item for item in report()["returnedErrors"])
        checks.append("actual native Pi tool-call from deterministic provider waits for visible confirmation; No creates no service")
        send("请按给出的合成资料录入衬衫 [fixture:intake-yes]")
        approve("MODEL PROPOSAL: intake supplier data?")
        expect("SYNTHETIC_DONE_INTAKE_YES")
        assert len(state()["services"]) == 1 and state()["services"][0]["profile"]["supplierMoq"] == 500
        checks.append("native model tool persists exact supplier facts through original owner MCP; tool result returns into Pi provider context")
        send("读取这款商品并准备可销售单元的Listing预览 [fixture:listing]")
        approve("MODEL PROPOSAL: get supplier data?")
        approve("MODEL PROPOSAL: preview supplier data?")
        expect("SYNTHETIC_DONE_LISTING")
        service = state()["services"][0]
        assert service["revision"] == 2 and service["preview"]["saleUnit"]["unitsPerPack"] == 2
        assert "wholesaleUnitPrice" not in json.dumps(service["preview"])
        checks.append("Pi executes native get→preview tool-call loop, reusing actual service ID/revision from prior tool results")
        send("修改这款商品的已确认描述 [fixture:profile]")
        approve("MODEL PROPOSAL: profile supplier data?")
        expect("SYNTHETIC_DONE_PROFILE")
        assert state()["services"][0]["revision"] == 3
        checks.append("native profile tool updates only the reviewed original revision")
        send("为现有Muse准备一份公开市场验证委派草稿 [fixture:muse-draft]")
        approve("MODEL PROPOSAL: Save PUBLIC Muse draft?")
        expect("SYNTHETIC_DONE_MUSE_DRAFT")
        assert len(state()["orders"]) == 1 and state()["orders"][0]["status"] == "draft"
        checks.append("native Muse tool prepares original draft only; separate approval/dispatch remains required")
        send("模型自行声称批准并尝试派发、发布和启用计划 [fixture:forbidden]")
        expect("SYNTHETIC_DONE_FORBIDDEN")
        assert len(state()["orders"]) == 1 and state()["orders"][0]["status"] == "draft"
        assert not any(row.get("tool") == "workspace_supplier_owner_publication_execute" for row in state()["trace"])
        checks.append("model-emitted dispatch/publication/schedule calls are unavailable and cannot turn output into approval")
        send("模型在录入参数中伪造confirmed和approved [fixture:extra-field]")
        expect("SYNTHETIC_DONE_EXTRA_FIELD")
        assert len(state()["services"]) == 1
        checks.append("native Pi schema validation rejects model-supplied approval fields before business execution")
        assert all(sorted(names) == sorted(expected_tools) for names in report()["requestsWithOnlyNativeTools"])
        assert state()["modelRuns"] == 0 and report()["externalRequests"] == 0 and not report().get("failure")
        os.write(master, b"\x04")
        end = time.monotonic() + 10
        while process.poll() is None and time.monotonic() < end:
            drain()
        process.wait(timeout=1)
        assert process.returncode == 0

        # The production launcher forbids print/RPC mode; additionally execute
        # the same extension through raw native Pi JSON mode to prove fail-closed.
        unattended_state = temp / "unattended-state.json"
        unattended_report = temp / "unattended-provider.json"
        unattended_env = {**env, "PI_SUPPLIER_UNATTENDED": "1", "PI_SUPPLIER_FIXTURE_DIRECTORY": str(temp / "unattended-server"),
                          "PI_SUPPLIER_FIXTURE_STATE": str(unattended_state), "PI_SUPPLIER_PROVIDER_REPORT": str(unattended_report)}
        run = subprocess.run(["node", str(root / "integration/fixtures/agent-terminal-host.mjs")], env=unattended_env, capture_output=True, text=True, timeout=30, cwd=root)
        assert run.returncode == 0, run.stderr + run.stdout[-5000:]
        assert "INTERACTIVE_TUI_REQUIRED" in run.stdout, run.stdout[-5000:]
        assert "SYNTHETIC_DONE_UNATTENDED" in run.stdout
        assert not json.loads(unattended_state.read_text())["services"]
        checks.append("raw native Pi JSON/print mode tool-call is denied without a human TUI; no service is created")
        print(json.dumps({"evidenceKind": "actual-pi-native-tool-calls-with-deterministic-loopback-provider", "passed": len(checks), "checks": checks,
                          "nativeProviderRequests": report()["requests"], "realModelVerified": False, "realShopifyVerified": False, "realMuseVerified": False,
                          "externalRequests": 0, "backendModelRuns": 0}, indent=2))
finally:
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    if master is not None:
        os.close(master)
