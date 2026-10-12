"""Run the checked-in Muse CLI against ONLY a synthetic loopback test server.

No production transport or credential lookup is allowed. The production CLI
source is imported unchanged; its documented test hooks replace egress only.
"""
import contextlib
import http.client
import importlib.util
import io
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit

settings = json.load(sys.stdin)
root = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("checked_in_muse", root / "deploy/muse-native-overlay/client/workspace-api.py")
consumer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(consumer)

def forbidden(*_args, **_kwargs):
    raise AssertionError("Real credentials and production transport are forbidden")

def local_transport(method, url, headers, body):
    target = urlsplit(url)
    assert target.scheme == "https" and target.netloc == "workspace.cnsubscribe.xyz"
    assert target.path.startswith("/api/muse-worker/v1/")
    connection = http.client.HTTPConnection("127.0.0.1", int(settings["port"]), timeout=10)
    connection.request(method, target.path, body=body, headers={
        "Host": settings["host"], "Authorization": "Bearer disposable-offline-muse-protocol-fixture",
        **({"Content-Type": "application/json"} if body is not None else {}),
    })
    response = connection.getresponse()
    status, raw = response.status, response.read().decode()
    connection.close()
    return status, raw

consumer._credential_surrogate = forbidden
consumer._real_transport = forbidden
consumer._TEST_HOOKS.update(transport=local_transport, surrogate_fn=lambda: "hsurr:offline-fixture-only")
directory = Path(settings["directory"])
directory.mkdir(parents=True, exist_ok=True)
consumer.CLAIMS_DIR = str(directory / "claims")
consumer.INTENTS_DIR = str(directory / "intents")
consumer.RATELIMIT_FILE = str(directory / "rate.json")
task = settings["taskRef"]
result = directory / "report.json"
result.write_text(json.dumps({"schema": "workspace.worker.delivery.v1", "orderId": task,
    "deliverables": [{"name": "Protocol fixture report", "type": "report", "summary": "Local consumer fixture only"}],
    "evidence": [{"title": "Fixture source", "url": "https://www.loc.gov/about/", "detail": "Protocol only"}]}))
commands = [
    ["identity"], ["inbox"], ["task-get", "--task-ref", task],
    ["claim", "--task-ref", task, "--request-id", "fixture-consumer-original-claim"],
    ["claim", "--task-ref", task, "--request-id", "fixture-consumer-original-claim"],
    ["heartbeat", "--task-ref", task], ["task-status", "--task-ref", task],
    ["upload-file", "--task-ref", task, "--upload-id", "fixture-consumer-upload", "--file", str(result)],
    ["submit-result", "--task-ref", task, "--summary", "Checked-in Muse CLI local fixture result",
     "--sources", '["https://www.loc.gov/about/"]', "--evidence-note", "Offline local protocol fixture; actual remote Muse was not executed."],
]
results = []
for argv in commands:
    output = io.StringIO()
    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
        code = consumer.main(argv)
    if code:
        raise AssertionError(f"{argv[0]} failed ({code}): {output.getvalue()}")
    results.append(argv[0])
print(json.dumps({"evidenceKind": "checked-in-consumer-loopback-fixture", "operations": results, "taskRef": task}))
