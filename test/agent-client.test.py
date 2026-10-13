#!/usr/bin/env python3
"""Transport/security acceptance for the public Python client (no external services)."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import json
import os
import socket
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.parse import parse_qs, urlsplit


ROOT = Path(__file__).resolve().parents[1]
CLIENT_PATH = ROOT / "client" / "ws_client.py"
SPEC = importlib.util.spec_from_file_location("ws_client", CLIENT_PATH)
ws = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ws)
TOKEN = "fixture-only-token-9b07-opaque"
PREFIX = "/api/agent/v1"
ARTIFACT = "# 采购询价包\n产品：保温杯\n演示模板，需用户确认后执行。\n".encode("utf-8")


def event(seq, kind, payload):
    return {"seq": seq, "kind": kind, "payload": payload, "ts": "2026-10-12T10:00:00.000Z"}


def make_events():
    artifact = {"name": "inquiry-pack.md", "bytes": len(ARTIFACT), "url": PREFIX + "/tasks/task-001/artifacts/inquiry-pack.md"}
    return [
        event(1, "accepted", {"taskId": "task-001", "type": "procurement", "preset": "产品批发采购", "title": "保温杯", "mode": "demo", "plan": ["需求确认"]}),
        event(2, "stage", {"stage": "requirements", "title": "需求确认"}),
        event(3, "thinking", {"stage": "requirements", "text": "正在读取提交的规格。"}),
        event(4, "thinking", {"stage": "requirements", "text": "结构模板已写入，尚无真实报价。"}),
        event(5, "progress", {"stage": "requirements", "done": True}),
        event(6, "artifact", artifact),
        event(7, "done", {"summary": "演示模式", "artifacts": [artifact]}),
    ]


class FixtureHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    @property
    def state(self):
        return self.server.fixture

    def json_response(self, value, status=200):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def record(self):
        self.state["requests"].append({"method": self.command, "path": self.path, "headers": dict(self.headers)})

    def auth(self):
        if self.headers.get("Authorization") != "Bearer " + TOKEN:
            self.json_response({"error": "未经鉴权"}, 401)
            return False
        return True

    def do_POST(self):
        self.record()
        if not self.auth():
            return
        size = int(self.headers.get("Content-Length", "0"))
        value = json.loads(self.rfile.read(size))
        if self.path == PREFIX + "/tasks/task-001/resume":
            self.state["resume_body"] = value
            self.json_response({"taskId": "task-001", "status": "running", "result": {"version": 1, "resumeFrom": 3}})
            return
        self.state["submitted"] = value
        self.state["request_key"] = self.headers.get("Idempotency-Key")
        if self.state["mode"] in {"lost-submit", "unknown-submit"}:
            # The server accepted the original request but its HTTP response was lost.
            self.close_connection = True
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        self.json_response({"taskId": "task-001", "status": "queued", "events_url": PREFIX + "/tasks/task-001/events"}, 201)

    def do_GET(self):
        self.record()
        parsed = urlsplit(self.path)
        path, query = parsed.path, parse_qs(parsed.query)
        if path == PREFIX + "/health":
            self.json_response({"status": "ok", "version": "test", "mode": "demo", "model": None, "presets": ["procurement"]})
            return
        if not self.auth():
            return
        if path == PREFIX + "/presets":
            self.json_response([{"id": "procurement", "name": "产品批发采购"}])
            return
        if path.startswith(PREFIX + "/tasks/by-request/"):
            if self.state["mode"] == "unknown-submit" or path.rsplit("/", 1)[-1] != self.state.get("request_key"):
                self.json_response({"error": "Task not found"}, 404)
            else:
                self.json_response({"taskId": "task-001", "status": "done", "request_key": self.state["request_key"], "artifacts": self.state["artifacts"]})
            return
        if path == PREFIX + "/tasks/echo-error":
            self.json_response({"error": "Rejected token " + TOKEN, "detail": "Bearer aaa\\\"bbb " + TOKEN}, 401)
            return
        if path == PREFIX + "/tasks/redirect":
            self.send_response(302)
            self.send_header("Location", self.state["redirect_to"] + "/capture")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path == PREFIX + "/tasks/task-001":
            running = self.state["mode"] == "poll-limit" or (self.state["mode"] in {"reconnect", "partial-frame"} and self.state["sse_calls"] < 2)
            self.json_response({"taskId": "task-001", "status": "running" if running else "done", "artifacts": self.state["artifacts"]})
            return
        if path == PREFIX + "/tasks/task-001/events":
            cursor = int(query.get("from", ["0"])[0])
            if query.get("format") == ["json"]:
                events = self.state["events"]
                if self.state["mode"] == "poll-limit" or (self.state["mode"] in {"reconnect", "partial-frame"} and self.state["sse_calls"] < 2):
                    events = events[:3 if self.state["mode"] != "partial-frame" else 2]
                self.json_response([entry for entry in events if entry["seq"] > cursor])
                return
            self.state["sse_calls"] += 1
            if self.state["mode"] in {"poll", "poll-limit"}:
                self.json_response({"error": "SSE unavailable"}, 406)
                return
            if self.state["mode"] == "content-type-fallback":
                self.json_response(self.state["events"])
                return
            events = self.state["events"]
            partial = self.state["mode"] == "partial-frame"
            if self.state["mode"] in {"reconnect", "partial-frame"}:
                if self.state["sse_calls"] == 1:
                    events = events[:2 if partial else 3]
                else:
                    # Deliberately include the last event to test resume de-duplication.
                    events = [item for item in events if item["seq"] >= cursor]
            else:
                events = [item for item in events if item["seq"] > cursor]
            body = ": heartbeat\r\n\r\n" + "".join(f"id: {item['seq']}\r\ndata: {json.dumps(item, ensure_ascii=False)}\r\n\r\n" for item in events)
            if partial and self.state["sse_calls"] == 1:
                body += 'id: 3\ndata: {"seq":3,"kind":"thinking",'
            raw = body.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if path == PREFIX + "/tasks/task-001/artifacts":
            self.json_response(self.state["artifacts"])
            return
        if path == PREFIX + "/tasks/task-001/artifacts/inquiry-pack.md":
            if self.state.get("download_redirect"):
                self.send_response(302)
                self.send_header("Location", self.state["download_redirect"])
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            raw = self.state.get("artifact_content", ARTIFACT)
            self.send_response(200)
            self.send_header("Content-Type", "text/markdown; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        self.json_response({"error": "Task not found"}, 404)


@contextmanager
def fixture(mode="normal"):
    events = make_events()
    state = {"requests": [], "sse_calls": 0, "events": events, "mode": mode, "artifacts": [dict(events[5]["payload"])]}
    server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    server.daemon_threads = True
    server.fixture = state
    thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.01), daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        yield origin, state
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


class AgentClientTests(unittest.TestCase):
    def run_cli(self, origin, *args, token=TOKEN, input=None, cwd=None):
        environment = {key: value for key, value in os.environ.items() if key not in {"WS_AGENT_URL", "WS_AGENT_TOKEN"}}
        environment["WS_AGENT_URL"] = origin
        if token is not None:
            environment["WS_AGENT_TOKEN"] = token
        result = subprocess.run([sys.executable, str(CLIENT_PATH), *args], input=input, text=True, capture_output=True,
                                timeout=10, env=environment, cwd=cwd)
        self.assertNotIn(TOKEN, result.stdout)
        self.assertNotIn(TOKEN, result.stderr)
        return result

    def test_health_public_presets_bearer_and_base_url(self):
        with fixture() as (origin, state):
            client = ws.Client(origin + PREFIX + "/", TOKEN)
            self.assertEqual(client.health()["mode"], "demo")
            self.assertEqual(client.presets()[0]["id"], "procurement")
            self.assertNotIn("Authorization", state["requests"][0]["headers"])
            self.assertEqual(state["requests"][1]["headers"]["Authorization"], "Bearer " + TOKEN)

    def test_submit_exact_body_and_complete_event_stream(self):
        with fixture() as (origin, state):
            client = ws.Client(origin, TOKEN)
            fields = {"product": "保温杯", "spec": "500ml", "quantity": 1000}
            receipt = client.submit("procurement", "保温杯", fields)
            self.assertEqual(set(state["submitted"]), {"type", "title", "input"})
            self.assertEqual(state["submitted"]["input"], fields)
            self.assertEqual(receipt["taskId"], "task-001")
            received = list(client.event_stream(receipt["taskId"], retry_delay=0))
            self.assertEqual(received, state["events"])
            self.assertEqual(received, client.replay("task-001"))

    def test_disconnect_resumes_query_and_deduplicates(self):
        with fixture("reconnect") as (origin, state):
            client = ws.Client(origin, TOKEN)
            received = list(client.event_stream("task-001", retry_delay=0))
            self.assertEqual(received, state["events"])
            streams = [request for request in state["requests"] if request["headers"].get("Accept") == "text/event-stream"]
            self.assertEqual(len(streams), 2)
            self.assertIn("from=3", streams[1]["path"])
            self.assertEqual(streams[1]["headers"]["Last-Event-Id"], "3")

    def test_lost_submission_response_looks_up_original_key_without_second_post(self):
        with fixture("lost-submit") as (origin, state):
            client = ws.Client(origin, TOKEN)
            receipt = client.submit("procurement", "保温杯", {"product": "保温杯"}, request_key="client-original-001")
            self.assertEqual(receipt["taskId"], "task-001")
            self.assertEqual(state["request_key"], "client-original-001")
            self.assertEqual([row["method"] for row in state["requests"]], ["POST", "GET"])
            self.assertTrue(state["requests"][1]["path"].endswith("/tasks/by-request/client-original-001"))
            self.assertEqual(client.lookup("client-original-001")["taskId"], "task-001")

    def test_unknown_submission_receipt_preserves_key_and_never_reposts(self):
        with fixture("unknown-submit") as (origin, state):
            with self.assertRaisesRegex(ws.TransportError, "client-unknown-001"):
                ws.Client(origin, TOKEN).submit("procurement", "保温杯", {}, request_key="client-unknown-001")
            self.assertEqual([row["method"] for row in state["requests"]], ["POST", "GET"])

    def test_replay_includes_historical_error_before_successful_resume(self):
        with fixture() as (origin, state):
            original = state["events"]
            state["events"] = original[:2] + [event(3, "error", {"message": "配置未完成，原任务保留"})] + [
                {**item, "seq": item["seq"] + 1} for item in original[2:]
            ]
            received = list(ws.Client(origin, TOKEN).event_stream("task-001", retry_delay=0))
            self.assertEqual(received, state["events"])
            result = self.run_cli(origin, "replay", "task-001")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual([json.loads(line) for line in result.stdout.splitlines()], state["events"])

    def test_resume_posts_empty_body_and_follows_original_cursor(self):
        with fixture() as (origin, state):
            result = self.run_cli(origin, "resume", "task-001")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(state["resume_body"], {})
            self.assertEqual([json.loads(line) for line in result.stdout.splitlines()], state["events"][3:])
            streams = [row for row in state["requests"] if row["headers"].get("Accept") == "text/event-stream"]
            self.assertIn("from=3", streams[0]["path"])

    def test_partial_frame_not_emitted_before_resume(self):
        with fixture("partial-frame") as (origin, state):
            received = list(ws.Client(origin, TOKEN).event_stream("task-001", retry_delay=0))
            self.assertEqual(received, state["events"])
            streams = [request for request in state["requests"] if request["headers"].get("Accept") == "text/event-stream"]
            self.assertIn("from=2", streams[1]["path"])

    def test_sse_unavailable_polls_persisted_events(self):
        for mode in ("poll", "content-type-fallback"):
            with self.subTest(mode=mode), fixture(mode) as (origin, state):
                notices = []
                received = list(ws.Client(origin, TOKEN).event_stream("task-001", retry_delay=0, poll_interval=0, notice=notices.append))
                self.assertEqual(received, state["events"])
                self.assertTrue(notices)
                self.assertTrue(any("format=json" in request["path"] for request in state["requests"]))

    def test_polling_has_an_upper_bound_and_preserves_cursor(self):
        with fixture("poll-limit") as (origin, state):
            received = []
            with self.assertRaisesRegex(ws.TransportError, r"from-seq 3"):
                for item in ws.Client(origin, TOKEN).event_stream("task-001", retries=0, poll_interval=0, max_polls=2):
                    received.append(item)
            self.assertEqual(received, state["events"][:3])
            polls = [request for request in state["requests"] if "format=json" in request["path"]]
            self.assertEqual(len(polls), 2)

    def test_completed_task_from_terminal_seq_returns_no_events(self):
        with fixture() as (origin, _):
            self.assertEqual(list(ws.Client(origin, TOKEN).event_stream("task-001", from_seq=7, retry_delay=0)), [])

    def test_two_simultaneous_subscribers_receive_same_sequence(self):
        with fixture() as (origin, state), ThreadPoolExecutor(max_workers=2) as pool:
            future_a = pool.submit(lambda: list(ws.Client(origin, TOKEN).event_stream("task-001")))
            future_b = pool.submit(lambda: list(ws.Client(origin, TOKEN).event_stream("task-001")))
            self.assertEqual(future_a.result(timeout=5), state["events"])
            self.assertEqual(future_b.result(timeout=5), state["events"])

    def test_auth_failure_does_not_retry_and_does_not_echo_secret(self):
        with fixture() as (origin, state):
            client = ws.Client(origin, TOKEN)
            with self.assertRaises(ws.ClientHTTPError) as captured:
                client.status("echo-error")
            self.assertNotIn(TOKEN, str(captured.exception))
            self.assertNotIn(TOKEN, json.dumps(captured.exception.details))
            result = self.run_cli(origin, "status", "echo-error")
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stderr)["http_status"], 401)
            with self.assertRaises(ws.ClientHTTPError) as captured:
                list(ws.Client(origin, "wrong-fixture-token").event_stream("task-001", retry_delay=0))
            self.assertEqual(captured.exception.status, 401)
            self.assertEqual(state["sse_calls"], 0)

    def test_no_token_cli_argument_no_plaintext_even_if_pasted(self):
        result = self.run_cli("http://127.0.0.1:1", "health", "--token", TOKEN)
        self.assertEqual(result.returncode, 2)

    def test_credentials_are_not_read_from_dotenv(self):
        with fixture() as (origin, _), tempfile.TemporaryDirectory() as directory:
            Path(directory, ".env").write_text("WS_AGENT_TOKEN=" + TOKEN, encoding="utf-8")
            result = self.run_cli(origin, "presets", token=None, cwd=directory)
            self.assertEqual(result.returncode, 1)
            self.assertIn("未注入", json.loads(result.stderr)["error"])
            health = self.run_cli(origin, "health", token=None, cwd=directory)
            self.assertEqual(health.returncode, 0)

    def test_remote_http_credentials_in_url_and_header_injection_refused(self):
        for value in ("http://workspace.cnsubscribe.xyz", "https://user:pass@example.com", "https://example.com?token=x", "https://example.com/other", "https://example.com/#x", "https://example.com\n", "http://127.0.0.1:0"):
            with self.subTest(value=value), self.assertRaises(ws.ClientError):
                ws.Client(value, TOKEN)
        for token in ("Bearer invalid", "abc\r\nx-test: value", ""):
            with self.subTest(token_format=True), self.assertRaises(ws.ClientError):
                ws.Client("https://example.com", token)

    def test_redirect_cannot_forward_authorization_to_other_origin(self):
        with fixture() as (origin, state), fixture() as (other_origin, other_state):
            state["redirect_to"] = other_origin
            with self.assertRaisesRegex(ws.ClientError, "跨来源"):
                ws.Client(origin, TOKEN).status("redirect")
            self.assertEqual(other_state["requests"], [])

    def test_download_registered_artifact_and_refuse_overwrite(self):
        with fixture() as (origin, _), tempfile.TemporaryDirectory() as directory:
            client = ws.Client(origin, TOKEN)
            target = Path(directory, "new", "outputs")
            downloaded = client.download("task-001", target)
            self.assertEqual(len(downloaded), 1)
            output = Path(downloaded[0]["path"])
            self.assertTrue(output.is_absolute())
            self.assertEqual(output.read_bytes(), ARTIFACT)
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            with self.assertRaisesRegex(ws.ClientError, "不会覆盖"):
                client.download("task-001", target)
            self.assertEqual(output.read_bytes(), ARTIFACT)

    def test_download_does_not_follow_directory_or_target_symlink(self):
        with fixture() as (origin, _), tempfile.TemporaryDirectory() as directory:
            client = ws.Client(origin, TOKEN)
            real = Path(directory, "real")
            real.mkdir()
            symlink = Path(directory, "link")
            symlink.symlink_to(real, target_is_directory=True)
            with self.assertRaises(ws.ClientError):
                client.download("task-001", symlink)
            self.assertEqual(list(real.iterdir()), [])
            protected = Path(directory, "protected.txt")
            protected.write_text("keep", encoding="utf-8")
            Path(real, "inquiry-pack.md").symlink_to(protected)
            with self.assertRaises(ws.ClientError):
                client.download("task-001", real)
            self.assertEqual(protected.read_text(), "keep")

    def test_download_rejects_traversal_and_unregistered_names(self):
        with fixture() as (origin, state), tempfile.TemporaryDirectory() as directory:
            client = ws.Client(origin, TOKEN)
            for name in ("../escape.md", "a/b.md", "a\\b.md", ".", "..", "CON", "NUL.txt", "unsafe."):
                with self.subTest(name=name):
                    state["artifacts"] = [{"name": name, "bytes": 0, "url": PREFIX + "/tasks/task-001/artifacts/" + name}]
                    with self.assertRaises(ws.ClientError):
                        client.download("task-001", Path(directory, "outputs"))
            state["artifacts"] = [make_events()[5]["payload"]]
            with self.assertRaisesRegex(ws.ClientError, "登记产物"):
                client.download("task-001", Path(directory, "outputs"), ["unregistered.md"])
            self.assertFalse(Path(directory, "outputs").exists())

    def test_download_list_url_cross_origin_refused_before_any_write(self):
        with fixture() as (origin, state), fixture() as (other_origin, other_state), tempfile.TemporaryDirectory() as directory:
            state["artifacts"][0]["url"] = other_origin + PREFIX + "/tasks/task-001/artifacts/inquiry-pack.md"
            target = Path(directory, "outputs")
            with self.assertRaises(ws.ClientError):
                ws.Client(origin, TOKEN).download("task-001", target)
            self.assertEqual(other_state["requests"], [])
            self.assertFalse(target.exists())

    def test_download_redirect_and_incomplete_transfer_clean_partial_file(self):
        with fixture() as (origin, state), fixture() as (other_origin, other_state), tempfile.TemporaryDirectory() as directory:
            state["download_redirect"] = other_origin + "/capture"
            target = Path(directory, "outputs")
            with self.assertRaises(ws.ClientError):
                ws.Client(origin, TOKEN).download("task-001", target)
            self.assertEqual(other_state["requests"], [])
            self.assertFalse(Path(target, "inquiry-pack.md").exists())
            del state["download_redirect"]
            state["artifact_content"] = b"partial"
            with self.assertRaisesRegex(ws.ProtocolError, "不完整"):
                ws.Client(origin, TOKEN).download("task-001", target)
            self.assertFalse(Path(target, "inquiry-pack.md").exists())

    def test_protocol_rejects_unknown_kind_sequence_gap_and_wrong_sse_id(self):
        with fixture() as (origin, state):
            client = ws.Client(origin, TOKEN)
            state["events"][1]["kind"] = "thought"
            with self.assertRaises(ws.ProtocolError):
                list(client.event_stream("task-001"))
            state["events"] = make_events()[1:]
            with self.assertRaises(ws.ProtocolError):
                client.replay("task-001")
        raw = f"id: 2\ndata: {json.dumps(make_events()[0])}\n\n".encode()
        with self.assertRaises(ws.ProtocolError):
            list(ws.Client._sse_frames(io.BytesIO(raw)))

    def test_cli_full_flow_and_stdin_input_without_credential_files(self):
        with fixture() as (origin, state), tempfile.TemporaryDirectory() as directory:
            self.assertEqual(self.run_cli(origin, "health").returncode, 0)
            self.assertEqual(self.run_cli(origin, "presets").returncode, 0)
            fields = {"product": "保温杯", "spec": "500ml", "quantity": 1000}
            result = self.run_cli(origin, "submit", "--type", "procurement", "--title", "保温杯", input=json.dumps(fields), cwd=directory)
            self.assertEqual(result.returncode, 0, result.stderr)
            received = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual(received, state["events"])
            diagnostics = [json.loads(line) for line in result.stderr.splitlines()]
            self.assertTrue(diagnostics[0]["request_key"])
            self.assertEqual(diagnostics[-1]["submitted"]["taskId"], "task-001")
            replay = self.run_cli(origin, "replay", "task-001", "--format", "json")
            self.assertEqual(json.loads(replay.stdout), received)
            self.assertEqual(json.loads(self.run_cli(origin, "status", "task-001").stdout)["status"], "done")
            output = Path(directory, "outputs")
            downloaded = self.run_cli(origin, "download", "task-001", "--output-dir", str(output), cwd=directory)
            self.assertEqual(downloaded.returncode, 0, downloaded.stderr)
            self.assertEqual(json.loads(downloaded.stdout)[0]["path"], str(output / "inquiry-pack.md"))
            self.assertEqual([p.name for p in Path(directory).rglob("*") if p.is_file()], ["inquiry-pack.md"])
            self.assertNotIn(TOKEN.encode(), (output / "inquiry-pack.md").read_bytes())

    def test_cli_submit_not_follow_returns_only_acknowledgement(self):
        with fixture() as (origin, state):
            result = self.run_cli(origin, "submit", "--type", "procurement", "--title", "保温杯", "--input-json", '{"product":"保温杯"}', "--no-follow")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["status"], "queued")
            self.assertEqual(state["sse_calls"], 0)

    def test_error_event_causes_nonzero_cli_result(self):
        with fixture() as (origin, state):
            state["events"] = state["events"][:2] + [event(3, "error", {"message": "服务重启，任务中断，请重新发起"})]
            result = self.run_cli(origin, "replay", "task-001")
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout.splitlines()[-1])["kind"], "error")

    def test_install_manifest_contract_and_host_injection_rejection(self):
        code = """
import assert from 'node:assert/strict';
import { renderInstall, pluginManifest } from './server/agent/install.mjs';
const origin = 'https://workspace.cnsubscribe.xyz';
const text = renderInstall(origin);
for (const step of ['①', '②', '③', '④', '⑤']) assert.ok(text.includes(step));
for (const value of ['custom.cnsubscribe-workspace-agent', 'Secure Vault', 'WS_AGENT_TOKEN', '~/workspace/tools/ws-agent/ws_client.py', origin + '/plugin/client.py', 'health', 'presets', '产品批发采购', '供应商寻找', '产品机会发现']) assert.ok(text.includes(value));
const manifest = pluginManifest(origin, [{id:'procurement'}], '1.0.0');
assert.equal(manifest.api_base, '/api/agent/v1');
assert.equal(manifest.service_url, origin);
assert.equal(manifest.client_url, origin + '/plugin/client.py');
assert.equal(manifest.authentication.persist_token_on_client, false);
assert.ok(renderInstall('http://127.0.0.1:8787').includes('http://127.0.0.1:8787/plugin/client.py'));
assert.ok(renderInstall('http://install-fixture.example.test:9443').includes('http://install-fixture.example.test:9443/plugin/client.py'));
for (const id of ['procurement', 'supplier-sourcing', 'opportunity-discovery']) assert.ok(text.includes(id));
for (const bad of ["https://evil'host.example", 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?x=y']) assert.throws(() => renderInstall(bad));
console.log('install-manifest-ok');
"""
        result = subprocess.run(["node", "--input-type=module", "-e", code], text=True, capture_output=True, cwd=ROOT, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "install-manifest-ok")


if __name__ == "__main__":
    unittest.main(verbosity=2)
