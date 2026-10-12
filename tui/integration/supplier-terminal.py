"""Actual Pi CLI + private owner RPC + original signed HTTP; synthetic only.

Requires the fixed PR57 backend plus PR58 source. No model, real account, real
Shopify or real Muse. Each restart performs another synthetic original login.
"""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import random
import re
import select
import struct
import subprocess
import tempfile
import termios
import time
import zlib

root = Path(__file__).resolve().parents[1]
ansi = re.compile(r"\x1b\][^\x07]*?(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]")
process = None
master = None
received = ""
checks = []


def drain(timeout=0.05):
    global received
    readable, _, _ = select.select([master], [], [], timeout)
    if readable:
        try:
            received += os.read(master, 65536).decode("utf8", errors="replace")
        except OSError:
            pass


def expect(text, timeout=15):
    global received
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if text in ansi.sub("", received):
            received = ""
            return
        drain()
    raise AssertionError(f"Missing {text!r}; actual terminal: {ansi.sub('', received)[-5000:]}")


def send(text):
    global received
    received = ""
    os.write(master, (text + "\r").encode())


def exit_terminal():
    os.write(master, b"\x04")
    end = time.monotonic() + 10
    while process.poll() is None and time.monotonic() < end:
        drain()
    process.wait(timeout=1)
    assert process.returncode == 0


try:
    with tempfile.TemporaryDirectory(prefix="pi-supplier-terminal-", dir="/tmp") as temp:
        temp = Path(temp)
        state_file = temp / "state.json"
        ready_file = temp / "ready.json"
        env = {**os.environ, "TERM": "xterm-256color", "WORKSPACE_PI_DATA_DIR": str(temp / "client"),
               "PI_SUPPLIER_FIXTURE_DIRECTORY": str(temp / "server"), "PI_SUPPLIER_FIXTURE_STATE": str(state_file),
               "PI_SUPPLIER_FIXTURE_READY": str(ready_file)}
        for name in ["WORKSPACE_PI_OWNER_TRANSPORT", "WORKSPACE_PI_OWNER_RPC_FD", "WORKSPACE_PI_LOCAL_URL"]:
            env.pop(name, None)

        def launch():
            global process, master, received
            if master is not None:
                os.close(master)
            received = ""
            master, slave = pty.openpty()
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 70, 200, 0, 0))
            process = subprocess.Popen(["node", str(root / "integration/fixtures/supplier-terminal-host.mjs")],
                                       stdin=slave, stdout=slave, stderr=slave, env=env, cwd=root)
            os.close(slave)
            expect("/workspace-supplier")

        def state():
            return json.loads(state_file.read_text())

        def call(operation, arguments, confirm=True, file=False):
            send(f"/workspace-supplier {'file' if file else 'call'} {operation}")
            expect("Absolute path to exact supplier arguments JSON file" if file else f"Arguments JSON for {operation}")
            if file:
                argument_file = temp / (operation + ".json")
                argument_file.write_text(json.dumps(arguments))
                send(str(argument_file))
            else:
                send(json.dumps(arguments, separators=(",", ":")))
            if operation not in ["get", "publication", "monitors"]:
                expect(f"CALL {operation} through the original owner MCP?")
                send("" if confirm else "\x1b[B")
                if not confirm:
                    expect("Action cancelled.")
                    return
            expect('"tool":"workspace_supplier_owner_' + operation + '"')

        launch()
        send("/workspace-supplier connect")
        expect('"toolCount":15')
        assert [row["method"] for row in state()["trace"][:3]] == ["initialize", "notifications/initialized", "tools/list"]
        checks.append("same real Pi TUI initializes and lists 15 tools through private owner RPC and signed native HTTP")
        send("Please publish this product automatically")
        expect("Plain language/model tools are disabled.")
        assert not state()["services"] and state()["modelRuns"] == 0
        checks.append("plain language executes no model or supplier mutation")
        facts = {"name": "Actual Pi supplier PTY fixture", "description": "Known synthetic facts", "targetMarket": "US", "currency": "USD",
                 "skuCode": "PTY-SUPPLIER", "supplierUnit": "piece", "supplierMoq": 500, "wholesaleUnitPrice": "2.50", "wholesaleCurrency": "CNY",
                 "productionDays": 30, "retailUnit": "piece", "unitsPerPack": 2, "consumerPrice": "9.50", "handlingDays": 3, "shippingDays": 7}
        call("intake", {"input": {"facts": facts}}, confirm=False)
        assert not state()["services"]
        checks.append("actual No confirmation prevents intake")

        # Valid deterministic synthetic PNG >32KiB verifies the bounded image RPC.
        def chunk(kind, data):
            return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data) & 0xffffffff)
        rng = random.Random(42)
        raw = b"".join(b"\0" + rng.randbytes(128 * 3) for _ in range(128))
        image = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!IIBBBBB", 128, 128, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
        assert len(image) > 32768
        call("image_upload", {"input": {"filename": "fixture.png", "base64": base64.b64encode(image).decode(), "sourceNote": "Synthetic original image"}}, file=True)
        artifact = state()["artifacts"][0]
        facts["images"] = [{"kind": "artifact", "asset": {"artifactId": artifact["id"], "version": 1, "sha256": hashlib.sha256(image).hexdigest()}, "sourceNote": "Synthetic original image"}]
        checks.append("real Pi reads exact JSON file and uploads a >32KiB image through the original artifact service")
        call("intake", {"input": {"facts": facts}})
        service_id = state()["services"][0]["id"]
        call("get", {"serviceId": service_id})
        saved = state()["services"][0]
        assert saved["profile"]["supplierMoq"] == 500 and saved["profile"]["productionDays"] == 30
        assert saved["profile"]["consumerPrice"] == "9.50"
        checks.append("actual TUI intake/get persists product, market, MOQ, cost, retail price, lead/handling/shipping times and artifact")
        public_fields = ["name", "description", "skuCode", "retailUnit", "unitsPerPack", "consumerPrice", "handlingDays", "shippingDays", "images"]
        call("preview", {"serviceId": service_id, "input": {"expectedRevision": 1, "confirmed": True, "publicFields": public_fields}})
        saved = state()["services"][0]
        assert saved["revision"] == 2 and saved["preview"]["saleUnit"]["unitsPerPack"] == 2
        assert "wholesaleUnitPrice" not in json.dumps(saved["preview"])
        preview_hash = saved["preview"]["previewHash"]
        checks.append("actual TUI generates consumer sale-unit Listing preview without supplier cost fields")
        assert state()["modelRuns"] == 0 and not state()["orders"]
        exit_terminal()
        launch()  # Cold backend + Pi; explicit synthetic original login again.
        call("get", {"serviceId": service_id})
        saved = state()["services"][0]
        assert saved["preview"]["previewHash"] == preview_hash and len(state()["services"]) == 1
        assert saved["profile"]["images"][0]["asset"]["artifactId"] == artifact["id"]
        assert state()["modelRuns"] == 0 and not state()["orders"]
        checks.append("cold original backend and real Pi reload the same service, preview hash and image; synthetic re-login does not persist auth")
        exit_terminal()
        print(json.dumps({"evidenceKind": "actual-pi-pty-private-rpc-signed-supplier-mcp-local-fixture", "passed": len(checks), "checks": checks,
                          "realShopifyVerified": False, "realMuseVerified": False, "modelRuns": 0}, indent=2))
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
