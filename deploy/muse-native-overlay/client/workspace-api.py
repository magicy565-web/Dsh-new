#!/usr/bin/env python3
"""workspace.muse.pull.v1 client — full 11-operation CLI (v4).

Fixed routing table (11 ops, explicit HTTP methods, no extras):
  GET  /identity
  GET  /inbox
  GET  /tasks/{taskRef}
  GET  /tasks/{taskRef}/status
  POST /tasks/{taskRef}/claim            {requestId}
  POST /tasks/{taskRef}/heartbeat        {attemptId,fence,requestId}
  POST /tasks/{taskRef}/upload-file      {attemptId,fence,uploadId,filename,base64,sha256}
  POST /tasks/{taskRef}/submit-result    {attemptId,fence,requestId,summary,sources,toolEvidence|evidenceNote}
  POST /tasks/{taskRef}/report-blocked   {attemptId,fence,requestId,message}
  POST /tasks/{taskRef}/confirm-stop     {attemptId,fence,requestId}
  POST /tasks/{taskRef}/events/{eventId}/ack   {}

v4 disciplines (see references/contract-workspace.muse.pull.v1.md):
- Every mutating op gets its OWN requestId, persisted as an intent BEFORE the
  first HTTP byte. The intent stores a canonical SHA256 of the exact request
  body plus the attempt/fence/params it was built from. Retrying the same
  logical op reuses the intent's requestId AND re-verifies the rebuilt body:
  changed params are refused — the same id never carries different data.
  There is no force-new flag; the next heartbeat is naturally a new intent.
- Claim intent is saved before the first claim HTTP; on response loss only the
  original claim (same requestId) is retried.
- An existing receipt that is expired/cancelled/deactivated TERMINATES the
  flow: no implicit re-claim. Close out with confirm-stop first.
- Lease deadline is ALWAYS the server's leaseUntil (never local now+900).
  `leaseUntil: null` on heartbeat/status is a NORMAL terminal state: the
  client records canExecute=false + terminated, keeps attempt/fence for
  confirm-stop, and never drops the cancel markers on a parse error.
- Claim responses are validated (taskRef/claimed/canExecute/
  cancellationRequested/attemptId/int fence/future leaseUntil) before storing.
- heartbeat/status 2xx refreshes the server deadline; attemptId/fence pinned.
- confirm-stop bypasses liveness checks and always emits with the original
  attempt/fence, even on expired/cancelled/terminated leases.
- Non-2xx => non-zero exit (2 validation / 3 HTTP / 4 transport) + full
  sanitized JSON logged, never truncated. 401/403 are failures (403 may be
  scope revocation, not just a key problem). The server never uses 409 for
  success (replays are 200/201 + duplicate:true): ALL 409s exit non-zero,
  split by real MW_* codes; unknown codes need manual review; nothing is
  auto re-claimed.
- Claim receipts: claims/claim-<sha256(taskRef)>.json; receipt.taskRef verified
  on read. Intents: intents/intent-<sha256(taskRef + op_key)>.json (no case
  folding, no char substitution). All writes atomic (temp+fsync+rename);
  persistence failures raise.

Offline modes (never fetch credentials, never touch network):
  workspace-api.py test                 # simulated suite; credential fetch and
                                        # subprocess are monkeypatched to raise,
                                        # except explicit argv/input boundary
                                        # tests that mock subprocess.run itself
  workspace-api.py <op> ... --dry-run   # print method/URL/exact body only

Real sends: Bearer via stored custom.cnsubscribe-workspace credential,
surrogate (hsurr:*) exchanged by authd at egress; raw key never appears here.
Transport is curl -q --proto =https --max-redirs 0 -X <METHOD> with
--data-binary @- whenever a body exists (body bytes travel on stdin).
"""
import argparse
import base64
import hashlib
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit

# ---------------------------------------------------------------- constants ---
BASE = "https://workspace.cnsubscribe.xyz/api/muse-worker/v1"
API_PREFIX = "/api/muse-worker/v1"
ALLOWED_HOSTS = ["workspace.cnsubscribe.xyz"]
CREDENTIAL = "custom.cnsubscribe-workspace"

# Fixed 11-route table: (http_method, path_template, rate_category)
ROUTE_TABLE = {
    "identity":      ("GET",  "/identity", "GET"),
    "inbox":         ("GET",  "/inbox", "GET"),
    "task-get":      ("GET",  "/tasks/{taskRef}", "GET"),
    "task-status":   ("GET",  "/tasks/{taskRef}/status", "GET"),
    "claim":         ("POST", "/tasks/{taskRef}/claim", "POST"),
    "heartbeat":     ("POST", "/tasks/{taskRef}/heartbeat", "POST"),
    "upload-file":   ("POST", "/tasks/{taskRef}/upload-file", "UPLOAD"),
    "submit-result": ("POST", "/tasks/{taskRef}/submit-result", "POST"),
    "report-blocked":("POST", "/tasks/{taskRef}/report-blocked", "POST"),
    "confirm-stop":  ("POST", "/tasks/{taskRef}/confirm-stop", "POST"),
    "event-ack":     ("POST", "/tasks/{taskRef}/events/{eventId}/ack", "POST"),
}

TASKREF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
ID_MAX_LEN = 128
SUMMARY_MAX = 8000
SOURCES_MIN, SOURCES_MAX = 1, 20
EVIDENCE_MAX = 20
EVIDENCE_NOTE_MAX = 2000
MESSAGE_MAX = 2000
FILE_MAX_BYTES = 1024 * 1024  # 1 MiB
FILE_EXTS = {"json", "md", "txt", "csv"}
FILENAME_MAX = 160

RATE_LIMITS = {"GET": 120, "POST": 30, "UPLOAD": 10}
RATE_WINDOW = 60.0

# Real server 409 codes (lowercased for comparison). The server NEVER uses
# 409 for success; duplicate replays are 200/201 + duplicate:true.
LEASE_409 = {"mw_stale_lease", "mw_lease_expired", "mw_deadline_expired"}
BUSY_409 = {"mw_slot_busy", "mw_task_unavailable", "mw_upload_conflict"}
IDEMPOTENT_409_CODE = "mw_idempotency_conflict"

_PLACEHOLDER_HOSTS = {"example.com", "example.org", "example.net", "example.edu"}
_PLACEHOLDER_SUFFIXES = (".example", ".invalid", ".localhost", ".test")
_PRIVATE_NAME_RES = [
    re.compile(r"^localhost(\.|$)", re.I),
    re.compile(r"\.(local|localhost|internal|lan|home|corp)$", re.I),
]
_PLACEHOLDER_NOTES = {"todo", "tbd", "placeholder", "test", "testing", "xxx",
                      "lorem", "loremipsum", "n/a", "none", "null", "tbd.",
                      "待补充", "待填写", "占位", "测试"}
_SECRET_KEYS = {"token", "secret", "password", "apikey", "api_key", "bearer",
                "authorization", "access_token", "refresh_token",
                "private_key", "privatekey", "client_secret"}

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(HERE)
CLAIMS_DIR = os.environ.get("CNWS_CLAIMS_DIR", os.path.join(SKILL_DIR, "claims"))
INTENTS_DIR = os.environ.get("CNWS_INTENTS_DIR", os.path.join(SKILL_DIR, "intents"))
RATELIMIT_FILE = os.environ.get("CNWS_RATELIMIT_FILE", os.path.join(SKILL_DIR, "ratelimit.json"))

# Test hooks (set by run_tests only). Production path leaves these None.
_TEST_HOOKS = {"transport": None, "surrogate_fn": None}


class ApiError(Exception):
    """Validation / protocol error. Never carries secrets."""


class HttpError(ApiError):
    """Non-2xx HTTP response. Exit 3."""


class TransportError(ApiError):
    """Network/transport failure (response possibly lost). Exit 4."""


# ------------------------------------------------------------- validation ---
def v_taskref(s, name="taskRef"):
    if not isinstance(s, str) or not TASKREF_RE.match(s) or ".." in s:
        raise ApiError(f"{name} invalid: must match ^[A-Za-z0-9][A-Za-z0-9_.:-]{{0,127}}$ with no '..'")
    return s


def v_eventid(s):
    return v_taskref(s, "eventId")


def v_id(s, name):
    if not isinstance(s, str) or not s or len(s) > ID_MAX_LEN:
        raise ApiError(f"{name} invalid: non-empty string, max {ID_MAX_LEN} chars")
    return s


def v_fence(v):
    """Server fence: positive int ONLY. Strings are NOT accepted."""
    if isinstance(v, bool) or not isinstance(v, int) or v <= 0:
        raise ApiError("fence invalid: must be a positive integer (string not accepted)")
    return v


def v_summary(s):
    if not isinstance(s, str) or not s.strip() or len(s) > SUMMARY_MAX:
        raise ApiError(f"summary invalid: non-empty, max {SUMMARY_MAX} chars")
    return s


def _is_public_https_url(u):
    try:
        p = urlsplit(u)
    except ValueError:
        return False
    if p.scheme != "https":
        return False
    if p.username or p.password:  # reject userinfo (credentials in URL)
        return False
    host = (p.hostname or "").rstrip(".").lower()
    if not host or "." not in host:
        return False
    try:
        ipaddress.ip_address(host)  # reject ALL IP literals (v4/v6)
        return False
    except ValueError:
        pass
    if host in _PLACEHOLDER_HOSTS:
        return False
    if host.endswith(_PLACEHOLDER_SUFFIXES):
        return False
    if any(rx.search(host) for rx in _PRIVATE_NAME_RES):
        return False
    return True


def v_sources(lst):
    if not isinstance(lst, list) or not (SOURCES_MIN <= len(lst) <= SOURCES_MAX):
        raise ApiError(f"sources invalid: list of {SOURCES_MIN}-{SOURCES_MAX} URLs")
    for u in lst:
        if not _is_public_https_url(u):
            raise ApiError(f"sources invalid: not a public https URL: {u[:80]}")
    return lst


def v_tool_evidence(lst):
    if not isinstance(lst, list) or len(lst) > EVIDENCE_MAX:
        raise ApiError(f"toolEvidence invalid: list, max {EVIDENCE_MAX} entries")
    for e in lst:
        if not isinstance(e, dict) or set(e.keys()) != {"tool", "receiptId"}:
            raise ApiError("toolEvidence invalid: each entry must be exactly {tool, receiptId}")
        v_id(e["tool"], "tool")
        v_id(e["receiptId"], "receiptId")
    return lst


def v_evidence_note(s):
    if not isinstance(s, str) or not s.strip() or len(s) > EVIDENCE_NOTE_MAX:
        raise ApiError(f"evidenceNote invalid: honest non-empty text, max {EVIDENCE_NOTE_MAX} chars")
    norm = re.sub(r"[\s._\-*]+", "", s.strip().lower())
    if norm in _PLACEHOLDER_NOTES or (len(norm) >= 3 and len(set(norm)) == 1):
        raise ApiError("evidenceNote invalid: placeholder content refused")
    return s


def v_message(s):
    if not isinstance(s, str) or not s or len(s) > MESSAGE_MAX:
        raise ApiError(f"message invalid: non-empty, max {MESSAGE_MAX} chars")
    return s


def v_upload_file(path):
    """Validate file; return (filename, base64, sha256hex) computed from raw bytes."""
    if not os.path.isfile(path):
        raise ApiError(f"file not found: {path}")
    filename = os.path.basename(path)
    if len(filename) > FILENAME_MAX:
        raise ApiError(f"filename too long: {len(filename)} chars (max {FILENAME_MAX})")
    ext = os.path.splitext(filename)[1].lower().lstrip(".")
    if ext not in FILE_EXTS:
        raise ApiError(f"file type not allowed: .{ext} (allowed: json/md/txt/csv)")
    with open(path, "rb") as f:
        raw = f.read()
    if len(raw) > FILE_MAX_BYTES:
        raise ApiError(f"file too large: {len(raw)} bytes (max {FILE_MAX_BYTES})")
    return filename, base64.b64encode(raw).decode("ascii"), hashlib.sha256(raw).hexdigest()


# --------------------------------------------------------------- sanitize ---
def sanitize(obj):
    if isinstance(obj, dict):
        return {k: ("<redacted>" if str(k).lower() in _SECRET_KEYS else sanitize(v))
                for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    return obj


def _body_sha(body):
    """Canonical SHA256 of the exact request body."""
    canon = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


# -------------------------------------------------------- body builders ---
# Each builder returns EXACTLY the contract's fields — no extras.


def body_claim(request_id):
    v_id(request_id, "requestId")
    return {"requestId": request_id}


def body_heartbeat(attempt_id, fence, request_id):
    v_id(attempt_id, "attemptId"); v_fence(fence); v_id(request_id, "requestId")
    return {"attemptId": attempt_id, "fence": fence, "requestId": request_id}


def body_upload_file(attempt_id, fence, upload_id, filename, b64, sha256):
    v_id(attempt_id, "attemptId"); v_fence(fence); v_id(upload_id, "uploadId")
    if not filename or not b64 or not sha256:
        raise ApiError("upload-file invalid: filename/base64/sha256 required")
    return {"attemptId": attempt_id, "fence": fence, "uploadId": upload_id,
            "filename": filename, "base64": b64, "sha256": sha256}


def body_submit_result(attempt_id, fence, request_id, summary, sources,
                       tool_evidence=None, evidence_note=None):
    v_id(attempt_id, "attemptId"); v_fence(fence); v_id(request_id, "requestId")
    v_summary(summary); v_sources(sources)
    d = {"attemptId": attempt_id, "fence": fence, "requestId": request_id,
         "summary": summary, "sources": sources}
    has_ev = tool_evidence is not None and len(tool_evidence) > 0
    has_note = evidence_note is not None and str(evidence_note).strip() != ""
    if has_ev == has_note:  # exactly one required
        raise ApiError("submit-result invalid: provide toolEvidence XOR evidenceNote (exactly one)")
    if has_ev:
        d["toolEvidence"] = v_tool_evidence(tool_evidence)
    else:
        d["evidenceNote"] = v_evidence_note(evidence_note)
    return d


def body_report_blocked(attempt_id, fence, request_id, message):
    v_id(attempt_id, "attemptId"); v_fence(fence); v_id(request_id, "requestId")
    v_message(message)
    return {"attemptId": attempt_id, "fence": fence, "requestId": request_id, "message": message}


def body_confirm_stop(attempt_id, fence, request_id):
    v_id(attempt_id, "attemptId"); v_fence(fence); v_id(request_id, "requestId")
    return {"attemptId": attempt_id, "fence": fence, "requestId": request_id}


def body_event_ack():
    return {}


# ----------------------------------------------- atomic persistence ---
def _read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def atomic_write_json(path, obj):
    """Write JSON atomically (temp + fsync + rename). Failures raise, never swallowed."""
    d = os.path.dirname(path)
    try:
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(obj, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.rename(tmp, path)
            dfd = os.open(d, os.O_DIRECTORY)
            try:
                os.fsync(dfd)
            finally:
                os.close(dfd)
        except BaseException:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise
    except ApiError:
        raise
    except Exception as e:
        raise ApiError(f"persist failed for {path}: {type(e).__name__}: {e}")


def _claim_path(task_ref):
    # sha256(taskRef): "task:a" and "task_a" can never collide.
    h = hashlib.sha256(task_ref.encode("utf-8")).hexdigest()
    return os.path.join(CLAIMS_DIR, f"claim-{h}.json")


def _intent_path(task_ref, op_key):
    # sha256 of the FULL taskRef + op_key: no case folding, no char substitution,
    # so "upload-file:U1" vs "upload-file:u1" and differing eventIds never collide.
    h = hashlib.sha256(f"{task_ref}\x00{op_key}".encode("utf-8")).hexdigest()
    return os.path.join(INTENTS_DIR, f"intent-{h}.json")


# ------------------------------------------------- server deadline ---
def _parse_deadline(v):
    """Return (raw, epoch_float) for a server leaseUntil/deadline value."""
    if isinstance(v, bool):
        raise ApiError("leaseUntil invalid: not a timestamp")
    if isinstance(v, (int, float)):
        epoch = float(v)
    elif isinstance(v, str):
        s = v.strip()
        if re.fullmatch(r"[0-9]+(\.[0-9]+)?", s):
            epoch = float(s)
        else:
            try:
                dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            except ValueError:
                raise ApiError(f"leaseUntil invalid: unparseable {s[:60]!r}")
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            epoch = dt.timestamp()
    else:
        raise ApiError("leaseUntil invalid: not a timestamp")
    if epoch >= 1e18:
        epoch /= 1e9
    elif epoch >= 1e15:
        epoch /= 1e6
    elif epoch >= 1e12:
        epoch /= 1e3
    return v, epoch


def _extract_deadline(data, require=True):
    """Returns (raw, epoch). Explicit null is returned as (None, None) —
    callers treat it as the server terminal state, never a parse error."""
    for key in ("leaseUntil", "deadline"):
        if key in data:
            v = data[key]
            if v is None:
                return None, None
            return _parse_deadline(v)
    if require:
        raise ApiError("response missing leaseUntil/deadline")
    return None, None


# ------------------------------------------------- claim receipt store ---
def save_claim_receipt(task_ref, request_id, attempt_id, fence, lease_until_raw,
                       lease_until_epoch, claimed=True, can_execute=True,
                       cancellation_requested=False, terminated=False):
    """Persist a validated lease. No secrets stored. Failures raise."""
    v_taskref(task_ref); v_id(request_id, "requestId"); v_id(attempt_id, "attemptId")
    v_fence(fence)
    now = time.time()
    receipt = {"taskRef": task_ref, "requestId": request_id,
               "attemptId": attempt_id, "fence": fence,
               "claimed": bool(claimed), "canExecute": bool(can_execute),
               "cancellationRequested": bool(cancellation_requested),
               "terminated": bool(terminated),
               "leaseUntil": lease_until_raw, "leaseUntilEpoch": lease_until_epoch,
               "claimedAt": now, "updatedAt": now}
    atomic_write_json(_claim_path(task_ref), receipt)
    return receipt


def load_claim_receipt(task_ref, require_live=True, now=None):
    """Load receipt and verify receipt.taskRef. require_live enforces
    terminated/cancel/deactivate/lease-expiry (stop immediately). confirm-stop
    uses require_live=False so it can always emit with the original
    attempt/fence."""
    now = time.time() if now is None else now
    path = _claim_path(task_ref)
    if not os.path.isfile(path):
        raise ApiError(f"no claim receipt for {task_ref}: claim first")
    r = _read_json(path)
    if r.get("taskRef") != task_ref:
        raise ApiError(f"receipt taskRef mismatch for {task_ref}: refusing")
    if require_live:
        if r.get("terminated"):
            raise ApiError(f"task {task_ref} terminated by server: stop immediately")
        if r.get("cancellationRequested"):
            raise ApiError(f"task {task_ref} cancelled: stop immediately")
        if not r.get("canExecute", True):
            raise ApiError(f"task {task_ref} deactivated (canExecute=false): stop immediately")
        if now >= r.get("leaseUntilEpoch", 0):
            raise ApiError(f"lease expired for {task_ref}: stop immediately")
    return r


def drop_claim_receipt(task_ref):
    path = _claim_path(task_ref)
    if os.path.isfile(path):
        os.remove(path)


def _validate_claim_response(task_ref, data, now):
    """Validate a claim 2xx body BEFORE storing any lease."""
    if not isinstance(data, dict):
        raise ApiError("claim response invalid: not a JSON object")
    if data.get("taskRef") != task_ref:
        raise ApiError("claim response taskRef mismatch: refusing")
    if data.get("claimed") is not True:
        raise ApiError("claim not accepted by server (claimed != true)")
    if data.get("canExecute") is not True:
        raise ApiError("claim refused: canExecute != true")
    if data.get("cancellationRequested"):
        raise ApiError("claim refused: cancellationRequested")
    attempt_id = data.get("attemptId")
    v_id(attempt_id, "attemptId")
    fence = data.get("fence")
    v_fence(fence)  # int only; strings refused
    raw, epoch = _extract_deadline(data, require=True)
    if epoch <= now:
        raise ApiError("claim leaseUntil is not in the future: refusing")
    return {"task_ref": task_ref, "request_id": data.get("requestId"),
            "attempt_id": attempt_id, "fence": fence,
            "lease_until_raw": raw, "lease_until_epoch": epoch,
            "can_execute": True, "cancellation_requested": False}


def _apply_lease_update(task_ref, data, require_deadline=True):
    """Refresh server deadline + flags from a heartbeat/status 2xx body.
    attemptId/fence are pinned: any server-side change is refused.
    leaseUntil:null is a NORMAL terminal state: canExecute=false + terminated
    are recorded, attempt/fence kept for confirm-stop, cancel markers kept."""
    path = _claim_path(task_ref)
    if not os.path.isfile(path):
        print("note: no local lease receipt; skipping deadline sync")
        return None
    r = _read_json(path)
    if r.get("taskRef") != task_ref:
        raise ApiError("receipt taskRef mismatch: refusing")
    if "attemptId" in data and data["attemptId"] != r["attemptId"]:
        raise ApiError("server changed attemptId: refusing lease update")
    if "fence" in data and data["fence"] != r["fence"]:
        raise ApiError("server changed fence: refusing lease update")
    for k in ("canExecute", "cancellationRequested"):
        if k in data:
            r[k] = bool(data[k])
    lu_present = "leaseUntil" in data or "deadline" in data
    lu_value = data.get("leaseUntil", data.get("deadline"))
    if lu_present and lu_value is None:
        # Server terminal state: invalidate the lease, keep identity + markers.
        r["leaseUntil"] = None
        r["leaseUntilEpoch"] = 0.0
        r["canExecute"] = False
        r["terminated"] = True
    else:
        raw, epoch = _extract_deadline(data, require=require_deadline)
        if raw is not None:
            r["leaseUntil"] = raw
            r["leaseUntilEpoch"] = epoch
    r["updatedAt"] = time.time()
    atomic_write_json(path, r)
    return r


def _mark_lease_invalid(task_ref, code):
    """Best-effort local bookkeeping on server-declared lease death.
    Never masks the primary HttpError."""
    if not task_ref:
        return
    path = _claim_path(task_ref)
    if not os.path.isfile(path):
        return
    try:
        r = _read_json(path)
        if r.get("taskRef") != task_ref:
            return
        r["terminated"] = True
        r["canExecute"] = False
        r["leaseUntil"] = None
        r["leaseUntilEpoch"] = 0.0
        r["terminatedBy"] = code
        r["updatedAt"] = time.time()
        atomic_write_json(path, r)
    except Exception as e:
        print(f"warning: could not mark lease invalid: {e}", file=sys.stderr)


# ------------------------------------------------------- intent store ---
def _read_intent(task_ref, op_key):
    path = _intent_path(task_ref, op_key)
    if not os.path.isfile(path):
        return None
    it = _read_json(path)
    if it.get("taskRef") != task_ref or it.get("op") != op_key:
        raise ApiError("intent identity mismatch: refusing")
    return it


def prepare_intent(task_ref, op_key, build_body, request_id=None,
                   attempt_id=None, fence=None):
    """Persist the intent BEFORE the first HTTP byte and return (intent, body).
    build_body(request_id) must rebuild the EXACT body from current params.
    An existing inflight intent means retry: the stored requestId is reused,
    and the rebuilt body (+attempt/fence) is verified byte-identical —
    changed params are refused, the same id never carries different data.
    There is intentionally no force-new flag: the next logical operation is a
    new intent because the previous one is marked done on success."""
    it = _read_intent(task_ref, op_key)
    if it and it.get("state") == "inflight":
        if it.get("attemptId") != attempt_id or it.get("fence") != fence:
            raise ApiError("inflight intent attempt/fence mismatch: refusing")
        body = build_body(it["requestId"])
        if _body_sha(body) != it.get("bodySha256"):
            raise ApiError("inflight intent params changed: refusing to send "
                           "different data with the same requestId")
        return it, body
    rid = request_id or uuid.uuid4().hex
    v_id(rid, "requestId")
    body = build_body(rid)
    intent = {"taskRef": task_ref, "op": op_key, "requestId": rid,
              "attemptId": attempt_id, "fence": fence,
              "bodySha256": _body_sha(body), "state": "inflight",
              "createdAt": time.time()}
    atomic_write_json(_intent_path(task_ref, op_key), intent)
    return intent, body


def complete_intent(task_ref, op_key):
    path = _intent_path(task_ref, op_key)
    if os.path.isfile(path):
        it = _read_json(path)
        it["state"] = "done"
        it["updatedAt"] = time.time()
        atomic_write_json(path, it)


# ------------------------------------------------------------- rate limit ---
class RateLimiter:
    """Rolling-window limiter. now_fn injectable for offline tests."""

    def __init__(self, state=None, now_fn=None):
        self.state = state if state is not None else {"GET": [], "POST": [], "UPLOAD": []}
        self.now_fn = now_fn or time.time

    def _prune(self, cat, now):
        self.state[cat] = [t for t in self.state.get(cat, []) if now - t < RATE_WINDOW]

    def allow(self, cat):
        now = self.now_fn()
        self._prune(cat, now)
        return len(self.state[cat]) < RATE_LIMITS[cat]

    def record(self, cat):
        self.state[cat].append(self.now_fn())

    def check(self, cat):
        if not self.allow(cat):
            raise ApiError(f"rate limit: {cat} {RATE_LIMITS[cat]}/{int(RATE_WINDOW)}s exceeded; wait")


def load_limiter():
    try:
        with open(RATELIMIT_FILE, encoding="utf-8") as f:
            state = json.load(f)
    except (OSError, ValueError):
        state = None
    return RateLimiter(state)


def store_limiter(lim):
    try:
        with open(RATELIMIT_FILE, "w", encoding="utf-8") as f:
            json.dump(lim.state, f)
    except OSError as e:
        # Not silent: warn, but a cache-file failure must not block operations.
        print(f"warning: rate-limit state not persisted: {e}", file=sys.stderr)


# -------------------------------------------------------------- transport ---
def _credential_surrogate():
    # Imported lazily: offline modes never touch authd.
    sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
    from dynamic_credentials import dynamic_credential_entry, ensure_allowed_url  # noqa
    ensure_allowed_url(BASE + "/", ALLOWED_HOSTS)
    entry = dynamic_credential_entry(CREDENTIAL, "access_token")
    s = str(entry["surrogate"]).strip()
    if not s.startswith("hsurr:"):
        raise ApiError("credential surrogate unavailable")
    return s


def _real_transport(method, url, headers, body_bytes, timeout=30):
    """Real transport. Body bytes travel on stdin via --data-binary @-.
    GET (no body) sends no --data-binary at all."""
    cmd = ["curl", "-q", "-sS", "-m", str(timeout),
           "--proto", "=https", "--max-redirs", "0",
           "-X", method,
           "-o", "/dev/stdout", "-w", "\n%{http_code}"]
    for k, v in headers.items():
        cmd += ["-H", f"{k}: {v}"]
    if body_bytes is not None:
        cmd += ["--data-binary", "@-"]
    cmd.append(url)
    env = {**os.environ,
           "https_proxy": os.environ.get("https_proxy", ""),
           "http_proxy": os.environ.get("http_proxy", "")}
    try:
        proc = subprocess.run(cmd, input=body_bytes, capture_output=True,
                              timeout=timeout + 10, env=env)
    except Exception as e:
        raise TransportError(f"curl failed: {type(e).__name__}: {e}")
    if proc.returncode != 0:
        raise TransportError(
            f"curl exit {proc.returncode}: "
            f"{proc.stderr.decode('utf-8', 'replace').strip()[:300]}")
    out = proc.stdout.decode("utf-8", "replace")
    *body_lines, code = out.rsplit("\n", 1)
    try:
        status = int(code.strip())
    except ValueError:
        raise TransportError("could not parse HTTP status from curl output")
    return status, "\n".join(body_lines)


def _error_code(data):
    if not isinstance(data, dict):
        return ""
    for k in ("code", "errorCode", "error_code"):
        v = data.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip().lower()
    e = data.get("error")
    if isinstance(e, dict):
        v = e.get("code")
        if isinstance(v, str) and v.strip():
            return v.strip().lower()
    elif isinstance(e, str) and e.strip():
        return e.strip().lower()
    return ""


def _emit_record(status, data):
    """Log the COMPLETE sanitized JSON record. Never truncated."""
    print(f"HTTP {status}")
    print(json.dumps(sanitize(data), ensure_ascii=False, indent=2))
    if isinstance(data, dict) and data.get("duplicate") is True:
        print("note: server reports duplicate:true (idempotent replay)")


def _classify(route, status, raw_text, lim, category, task_ref=None):
    text = raw_text if isinstance(raw_text, str) else raw_text.decode("utf-8", "replace")
    try:
        data = json.loads(text) if text.strip() else {}
    except ValueError:
        data = {"_nonJson": text[:2000]}
    if not isinstance(data, dict):
        data = {"_value": data}
    _emit_record(status, data)  # full sanitized JSON, always
    if 200 <= status < 300:
        lim.record(category)
        store_limiter(lim)
        return {"status": status, "data": data, "disposition": "ok"}
    if status == 401:
        raise HttpError("HTTP 401: authentication failed — credential rejected or "
                        "missing; this is NOT success")
    if status == 403:
        raise HttpError("HTTP 403: forbidden — possibly scope revocation, not only "
                        "a key problem; check connector scopes")
    if status == 429:
        raise HttpError("HTTP 429: rate limited — wait conservatively (>=60s) before retry")
    if status == 409:
        # The server NEVER uses 409 for success (replays are 200/201 +
        # duplicate:true). Every 409 exits non-zero; nothing is auto re-claimed.
        code = _error_code(data)
        if code in LEASE_409:
            _mark_lease_invalid(task_ref, code)
            raise HttpError(f"HTTP 409 {code}: lease invalid: stop immediately")
        if code == IDEMPOTENT_409_CODE:
            raise HttpError(f"HTTP 409 {code}: duplicate request — the original "
                            "request stands; verify via status/inbox; not auto re-claimed")
        if code in BUSY_409:
            raise HttpError(f"HTTP 409 {code}: server busy/unavailable for this call; "
                            "do not retry blindly")
        raise HttpError(f"HTTP 409 with unrecognized code {code!r}: manual review "
                        "required; no automatic classification applied")
    raise HttpError(f"HTTP {status}: request failed")


def send(route, *, task_ref=None, event_id=None, body=None, dry_run=False):
    """Send exactly one of the 11 fixed routes. dry_run: no credential, no network."""
    if route not in ROUTE_TABLE:
        raise ApiError(f"unknown route: {route}")
    method, template, category = ROUTE_TABLE[route]
    path = template
    if "{taskRef}" in path:
        if task_ref is None:
            raise ApiError("taskRef required")
        path = path.replace("{taskRef}", task_ref)
    if "{eventId}" in path:
        if event_id is None:
            raise ApiError("eventId required")
        path = path.replace("{eventId}", event_id)
    # Defense in depth: params are regex-validated, but never trust a path.
    if ".." in path or "?" in path or "#" in path or "%" in path:
        raise ApiError(f"unsafe path rejected: {path}")
    url = BASE + path
    if not (url == BASE or url.startswith(BASE + "/")):
        raise ApiError("URL outside allowed prefix")
    if dry_run:
        return {"method": method, "url": url, "body": body}
    lim = load_limiter()
    lim.check(category)
    surrogate_fn = _TEST_HOOKS.get("surrogate_fn") or _credential_surrogate
    token = surrogate_fn()
    if not token.startswith("hsurr:"):
        raise ApiError("credential surrogate unavailable")
    headers = {"Authorization": f"Bearer {token}"}
    payload = None
    if body is not None:
        payload = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    transport = _TEST_HOOKS.get("transport") or _real_transport
    try:
        status, raw = transport(method, url, headers, payload)
    except (TransportError, HttpError, ApiError):
        raise
    except Exception as e:
        raise TransportError(f"transport failed: {type(e).__name__}: {str(e)[:200]}")
    return _classify(route, status, raw, lim, category, task_ref)


def _print_dry(res):
    print(f"{res['method']} {res['url']}")
    print("body: " + (json.dumps(res["body"], ensure_ascii=False)
                       if res["body"] is not None else "(none)"))


# ------------------------------------------------------------------- ops ---
def op_claim(args):
    task_ref = v_taskref(args.task_ref)
    it = _read_intent(task_ref, "claim")
    if it and it.get("state") == "inflight":
        # Response-loss retry: ONLY the original claim, params re-verified.
        build = lambda rid: body_claim(rid)
        if it.get("attemptId") is not None or it.get("fence") is not None:
            raise ApiError("inflight claim intent corrupted: refusing")
        body = build(it["requestId"])
        if _body_sha(body) != it.get("bodySha256"):
            raise ApiError("inflight claim intent body changed: refusing")
        request_id = it["requestId"]
        intent = it
        print("note: retrying inflight claim intent with original requestId")
    else:
        path = _claim_path(task_ref)
        if os.path.isfile(path):
            # A receipt exists: it must be live, or we STOP. No implicit re-claim.
            r = load_claim_receipt(task_ref, require_live=False)
            if r.get("terminated") or r.get("cancellationRequested"):
                raise ApiError(f"task {task_ref} ended/cancelled: stop; "
                               "will not implicitly re-claim")
            if not r.get("canExecute", True):
                raise ApiError(f"task {task_ref} deactivated: stop; "
                               "will not implicitly re-claim")
            if time.time() >= r.get("leaseUntilEpoch", 0):
                raise ApiError(f"lease expired for {task_ref}: stop; run confirm-stop "
                               "to close out before any new claim (no implicit re-claim)")
            request_id = r["requestId"]
            print("note: live lease exists; idempotent re-claim with original requestId")
            intent = None
            body = body_claim(request_id)
        else:
            rid = v_id(args.request_id, "requestId") if args.request_id else uuid.uuid4().hex
            build = lambda r2: body_claim(r2)
            if args.dry_run:
                _print_dry(send("claim", task_ref=task_ref, body=build(rid), dry_run=True))
                return 0
            intent, body = prepare_intent(task_ref, "claim", build, request_id=rid)
            request_id = intent["requestId"]
    if args.dry_run:
        _print_dry(send("claim", task_ref=task_ref, body=body, dry_run=True))
        return 0
    try:
        res = send("claim", task_ref=task_ref, body=body)
    except TransportError:
        print("transport failed; claim intent kept inflight — re-run the same "
              "command to retry ONLY the original claim", file=sys.stderr)
        raise
    rec = _validate_claim_response(task_ref, res["data"], time.time())
    save_claim_receipt(task_ref, request_id, rec["attempt_id"], rec["fence"],
                       rec["lease_until_raw"], rec["lease_until_epoch"],
                       can_execute=rec["can_execute"],
                       cancellation_requested=rec["cancellation_requested"])
    if intent:
        complete_intent(task_ref, "claim")
    print(f"claim receipt persisted; server leaseUntil={rec['lease_until_raw']!r}")
    return 0


def _lease_for(task_ref, require_live):
    r = load_claim_receipt(task_ref, require_live=require_live)
    return r["attemptId"], r["fence"]


def op_heartbeat(args):
    task_ref = v_taskref(args.task_ref)
    attempt_id, fence = _lease_for(task_ref, require_live=True)
    build = lambda rid: body_heartbeat(attempt_id, fence, rid)
    if args.dry_run:
        _print_dry(send("heartbeat", task_ref=task_ref,
                        body=build("dryrun-" + uuid.uuid4().hex[:12]), dry_run=True))
        return 0
    intent, body = prepare_intent(task_ref, "heartbeat", build,
                                  attempt_id=attempt_id, fence=fence)
    try:
        res = send("heartbeat", task_ref=task_ref, body=body)
    except TransportError:
        print("transport failed; heartbeat intent kept inflight — re-run to retry "
              "with the same requestId", file=sys.stderr)
        raise
    # True renewal: server deadline refreshes (or null => terminal), attempt/fence pinned.
    _apply_lease_update(task_ref, res["data"], require_deadline=True)
    complete_intent(task_ref, "heartbeat")
    return 0


def op_upload_file(args):
    task_ref = v_taskref(args.task_ref)
    attempt_id, fence = _lease_for(task_ref, require_live=True)
    upload_id = v_id(args.upload_id, "uploadId")
    op_key = f"upload-file:{upload_id}"
    filename, b64, sha256 = v_upload_file(args.file)
    build = lambda rid: body_upload_file(attempt_id, fence, upload_id, filename, b64, sha256)
    if args.dry_run:
        _print_dry(send("upload-file", task_ref=task_ref,
                        body=build("dryrun-" + uuid.uuid4().hex[:12]), dry_run=True))
        return 0
    intent, body = prepare_intent(task_ref, op_key, build,
                                  attempt_id=attempt_id, fence=fence)
    try:
        send("upload-file", task_ref=task_ref, body=body)
    except TransportError:
        print("transport failed; upload intent kept inflight — re-run to retry "
              "with the same requestId", file=sys.stderr)
        raise
    complete_intent(task_ref, op_key)
    return 0


def op_submit_result(args):
    task_ref = v_taskref(args.task_ref)
    attempt_id, fence = _lease_for(task_ref, require_live=True)
    sources = json.loads(args.sources)
    tool_evidence = json.loads(args.tool_evidence) if args.tool_evidence else None
    build = lambda rid: body_submit_result(attempt_id, fence, rid, args.summary,
                                           sources, tool_evidence, args.evidence_note)
    if args.dry_run:
        _print_dry(send("submit-result", task_ref=task_ref,
                        body=build("dryrun-" + uuid.uuid4().hex[:12]), dry_run=True))
        return 0
    intent, body = prepare_intent(task_ref, "submit-result", build,
                                  attempt_id=attempt_id, fence=fence)
    try:
        send("submit-result", task_ref=task_ref, body=body)
    except TransportError:
        print("transport failed; submit intent kept inflight — re-run to retry "
              "with the same requestId", file=sys.stderr)
        raise
    complete_intent(task_ref, "submit-result")
    return 0


def op_report_blocked(args):
    task_ref = v_taskref(args.task_ref)
    attempt_id, fence = _lease_for(task_ref, require_live=True)
    build = lambda rid: body_report_blocked(attempt_id, fence, rid, args.message)
    if args.dry_run:
        _print_dry(send("report-blocked", task_ref=task_ref,
                        body=build("dryrun-" + uuid.uuid4().hex[:12]), dry_run=True))
        return 0
    intent, body = prepare_intent(task_ref, "report-blocked", build,
                                  attempt_id=attempt_id, fence=fence)
    try:
        send("report-blocked", task_ref=task_ref, body=body)
    except TransportError:
        print("transport failed; intent kept inflight — re-run to retry "
              "with the same requestId", file=sys.stderr)
        raise
    complete_intent(task_ref, "report-blocked")
    return 0


def op_confirm_stop(args):
    task_ref = v_taskref(args.task_ref)
    # require_live=False: expired/cancelled/terminated leases must NOT block
    # confirm-stop; the original attempt/fence are reused.
    attempt_id, fence = _lease_for(task_ref, require_live=False)
    build = lambda rid: body_confirm_stop(attempt_id, fence, rid)
    if args.dry_run:
        _print_dry(send("confirm-stop", task_ref=task_ref,
                        body=build("dryrun-" + uuid.uuid4().hex[:12]), dry_run=True))
        return 0
    intent, body = prepare_intent(task_ref, "confirm-stop", build,
                                  attempt_id=attempt_id, fence=fence)
    try:
        send("confirm-stop", task_ref=task_ref, body=body)
    except TransportError:
        print("transport failed; intent kept inflight — re-run to retry "
              "with the same requestId", file=sys.stderr)
        raise
    complete_intent(task_ref, "confirm-stop")
    drop_claim_receipt(task_ref)  # lease terminated; stale receipt must not gate later ops
    print("confirm-stop accepted; local lease receipt dropped")
    return 0


def op_event_ack(args):
    task_ref = v_taskref(args.task_ref)
    event_id = v_eventid(args.event_id)
    op_key = f"event-ack:{event_id}"
    build = lambda rid: body_event_ack()
    if args.dry_run:
        _print_dry(send("event-ack", task_ref=task_ref, event_id=event_id,
                        body=build("dryrun-x"), dry_run=True))
        return 0
    intent, body = prepare_intent(task_ref, op_key, build)
    try:
        send("event-ack", task_ref=task_ref, event_id=event_id, body=body)
    except TransportError:
        print("transport failed; ack intent kept inflight — re-run to retry", file=sys.stderr)
        raise
    complete_intent(task_ref, op_key)
    return 0


def op_get(args, route):
    task_ref = v_taskref(args.task_ref) if route not in ("identity", "inbox") else None
    if args.dry_run:
        _print_dry(send(route, task_ref=task_ref, dry_run=True))
        return 0
    res = send(route, task_ref=task_ref)
    if route == "task-status":
        _apply_lease_update(task_ref, res["data"], require_deadline=False)
    return 0


# ------------------------------------------------------------ offline tests ---
# SIMULATED. Credential fetch (authd) and subprocess (network) are monkeypatched
# to RAISE, except the explicit transport-boundary tests which mock
# subprocess.run itself and assert on argv/input bytes. No test touches the
# network or any real credential. These tests are NOT production execution.

class _ScriptedTransport:
    def __init__(self, steps):
        self.steps = list(steps)
        self.calls = []

    def __call__(self, method, url, headers, body_bytes):
        self.calls.append({"method": method, "url": url,
                           "auth": headers.get("Authorization", ""),
                           "body": json.loads(body_bytes.decode()) if body_bytes else None})
        auth = headers.get("Authorization", "")
        assert auth.startswith("Bearer hsurr:"), "surrogate bearer required, never a real secret"
        assert url.startswith("https://workspace.cnsubscribe.xyz/api/muse-worker/v1/"), \
            "URL outside allowed prefix"
        if not self.steps:
            raise AssertionError("no canned response left")
        step = self.steps.pop(0)
        if step[0] == "raise":
            raise step[1]
        return step[1], step[2]


def _ns(**kw):
    d = {"dry_run": False, "request_id": None,
         "task_ref": None, "message": None, "upload_id": None, "file": None,
         "summary": None, "sources": None, "tool_evidence": None,
         "evidence_note": None, "event_id": None}
    d.update(kw)
    return argparse.Namespace(**d)


def run_tests():
    import io
    from contextlib import redirect_stdout
    results = []

    def t(name, fn):
        try:
            fn()
            results.append((name, True, ""))
        except ApiError as e:
            results.append((name, False, f"ApiError: {e}"))
        except AssertionError as e:
            results.append((name, False, f"assertion: {e}"))
        except Exception as e:
            results.append((name, False, f"{type(e).__name__}: {e}"))

    def expect_error(fn, frag=""):
        try:
            fn()
        except ApiError as e:
            if frag and frag not in str(e):
                raise AssertionError(f"error {e!r} missing {frag!r}")
            return str(e)
        raise AssertionError("expected ApiError, got none")

    # ---- prohibit credential fetch + subprocess (network) ----
    tmp = tempfile.mkdtemp(prefix="cnws-test-")
    saved = {}
    for gname, sub in (("CLAIMS_DIR", "claims"), ("INTENTS_DIR", "intents"),
                       ("RATELIMIT_FILE", "ratelimit.json")):
        saved[gname] = globals()[gname]
        globals()[gname] = os.path.join(tmp, sub)
    saved_run = subprocess.run
    def _forbidden_run(*a, **k):
        raise AssertionError("subprocess.run FORBIDDEN in offline tests")
    subprocess.run = _forbidden_run
    saved_surr = globals()["_credential_surrogate"]
    globals()["_credential_surrogate"] = lambda: (_ for _ in ()).throw(
        AssertionError("credential fetch FORBIDDEN in offline tests"))
    _TEST_HOOKS["surrogate_fn"] = lambda: "hsurr:unit-test-fake"

    def fake(steps):
        _TEST_HOOKS["transport"] = _ScriptedTransport(steps)
        return _TEST_HOOKS["transport"]

    now = time.time()
    FUTURE = now + 3600
    PAST = now - 10

    try:
        print("== offline test suite v4 (SIMULATED: credential+network FORBIDDEN) ==")

        print("-- transport boundary: real _real_transport + mocked subprocess --")
        def transport_boundary():
            captured = {}
            def mock_run(cmd, input=None, capture_output=False, timeout=None, env=None):
                captured["argv"] = list(cmd)
                captured["input"] = input
                assert isinstance(env, dict) and "https_proxy" in env
                R = type("R", (), {})()
                R.returncode = 0
                R.stdout = b'{"ok":true}\n200'
                R.stderr = b""
                return R
            subprocess.run = mock_run
            try:
                # claim: --data-binary @- present, exact compact bytes on stdin
                st, raw = _real_transport(
                    "POST", BASE + "/tasks/T1/claim",
                    {"Authorization": "Bearer hsurr:x", "Content-Type": "application/json"},
                    b'{"requestId":"rq1"}')
                assert (st, raw) == (200, '{"ok":true}')
                argv = captured["argv"]
                for flag in ("-q", "--data-binary", "@-", "--max-redirs", "-X"):
                    assert flag in argv, f"missing {flag}"
                assert argv[argv.index("--proto") + 1] == "=https"
                assert argv[argv.index("--max-redirs") + 1] == "0"
                assert argv[argv.index("-X") + 1] == "POST"
                assert captured["input"] == b'{"requestId":"rq1"}'
                # {} ack: exact b"{}" bytes
                _real_transport("POST", BASE + "/tasks/T1/events/e1/ack",
                                {"Authorization": "Bearer hsurr:x",
                                 "Content-Type": "application/json"}, b"{}")
                assert captured["input"] == b"{}", "ack body must be exactly {}"
                assert captured["argv"][captured["argv"].index("-X") + 1] == "POST"
                # upload: base64+sha256 travel in the body bytes
                up = body_upload_file("a", 5, "u1", "f.md", "QUJD", "deadbeef")
                up_bytes = json.dumps(up, ensure_ascii=False, separators=(",", ":")).encode()
                _real_transport("POST", BASE + "/tasks/T1/upload-file",
                                {"Authorization": "Bearer hsurr:x"}, up_bytes)
                assert b'"base64":"QUJD"' in captured["input"]
                assert b'"sha256":"deadbeef"' in captured["input"]
                assert b'"filename":"f.md"' in captured["input"]
                # submit: exact fields, no extras
                sub = body_submit_result("a", 5, "r1", "sum",
                                         ["https://www.chewy.com/x"], None, "honest note here")
                sub_bytes = json.dumps(sub, ensure_ascii=False, separators=(",", ":")).encode()
                _real_transport("POST", BASE + "/tasks/T1/submit-result",
                                {"Authorization": "Bearer hsurr:x"}, sub_bytes)
                assert captured["input"] == sub_bytes
                assert set(json.loads(captured["input"])) == {
                    "attemptId", "fence", "requestId", "summary", "sources", "evidenceNote"}
                # GET: no --data-binary, input None
                _real_transport("GET", BASE + "/inbox",
                                {"Authorization": "Bearer hsurr:x"}, None)
                assert "--data-binary" not in captured["argv"], "GET must not send a body"
                assert captured["input"] is None
                # curl failure -> TransportError
                def mock_fail(*a, **k):
                    R = type("R", (), {})()
                    R.returncode = 7
                    R.stdout = b""
                    R.stderr = b"could not connect"
                    return R
                subprocess.run = mock_fail
                try:
                    _real_transport("GET", BASE + "/inbox",
                                    {"Authorization": "Bearer hsurr:x"}, None)
                    raise AssertionError("expected TransportError")
                except TransportError:
                    pass
            finally:
                subprocess.run = _forbidden_run
        t("curl argv/input exact bytes (claim/upload/submit/ack/GET)", transport_boundary)

        print("-- regex/ids/fence --")
        t("reject .. in taskRef", lambda: expect_error(lambda: v_taskref("a..b")))
        t("accept normal taskRef", lambda: v_taskref("task:1.2-3_x"))

        def fence_int_ok():
            assert v_fence(9) == 9
        t("fence accepts int", fence_int_ok)
        t("fence rejects string", lambda: expect_error(lambda: v_fence("9")))
        t("fence rejects zero", lambda: expect_error(lambda: v_fence(0)))
        t("fence rejects bool", lambda: expect_error(lambda: v_fence(True)))

        print("-- sources: urllib.parse + ipaddress --")
        t("reject userinfo", lambda: expect_error(lambda: v_sources(["https://user:pass@e.com/x"])))
        t("reject ipv4 literal", lambda: expect_error(lambda: v_sources(["https://93.184.216.34/x"])))
        t("reject ipv6 literal", lambda: expect_error(lambda: v_sources(["https://[2001:db8::1]/x"])))
        t("reject example.com", lambda: expect_error(lambda: v_sources(["https://example.com/x"])))
        t("reject .invalid", lambda: expect_error(lambda: v_sources(["https://x.invalid/y"])))
        t("accept public https", lambda: v_sources(["https://www.chewy.com/b/example"]))

        print("-- evidence/filename --")
        t("reject long tool id", lambda: expect_error(
            lambda: v_tool_evidence([{"tool": "t" * 129, "receiptId": "r"}])))
        t("reject placeholder note", lambda: expect_error(lambda: v_evidence_note("todo")))
        t("reject repeated-char note", lambda: expect_error(lambda: v_evidence_note("xxxxxx")))
        t("accept honest note", lambda: v_evidence_note("manual check 2026-10-11: page live"))

        print("-- intent paths: full sha, no folding --")
        def intent_nocollide():
            p1 = _intent_path("Task:A", "upload-file:U1")
            p2 = _intent_path("task:a", "upload-file:U1")
            p3 = _intent_path("task:a", "upload-file:u1")
            p4 = _intent_path("task:a", "event-ack:Evt:1")
            p5 = _intent_path("task:a", "event-ack:evt:1")
            assert len({p1, p2, p3, p4, p5}) == 5, "intent path collision!"
        t("intent sha paths never collide", intent_nocollide)

        print("-- claim filenames cannot collide --")
        def no_collision():
            p1, p2 = _claim_path("task:a"), _claim_path("task_a")
            assert p1 != p2, "collision!"
            save_claim_receipt("task:a", "rq1", "at1", 7, FUTURE, FUTURE)
            r = load_claim_receipt("task:a", require_live=False)
            assert r["taskRef"] == "task:a"
            try:
                load_claim_receipt("task_a", require_live=False)
                raise AssertionError("task_a should have no receipt")
            except ApiError:
                pass
            atomic_write_json(p1, {"taskRef": "EVIL"})
            try:
                load_claim_receipt("task:a", require_live=False)
                raise AssertionError("mismatch not detected")
            except ApiError as e:
                assert "mismatch" in str(e)
        t("sha filenames + read-back verify", no_collision)

        print("-- atomic write failures are not swallowed --")
        def persist_fail():
            blocker = os.path.join(tmp, "blocker")
            open(blocker, "w").write("x")
            try:
                atomic_write_json(os.path.join(blocker, "f.json"), {})
                raise AssertionError("should have raised")
            except ApiError as e:
                assert "persist failed" in str(e)
        t("persist failure raises", persist_fail)

        print("-- claim validation gates --")
        def claim_ok_body(rid="rq1", fence=7, lu=FUTURE):
            return json.dumps({"taskRef": "T1", "claimed": True, "canExecute": True,
                               "cancellationRequested": False, "requestId": rid,
                               "attemptId": "att1", "fence": fence, "leaseUntil": lu})

        def claim_deadline_is_server_value():
            rec = _validate_claim_response("T1", json.loads(claim_ok_body()), now)
            assert rec["lease_until_epoch"] == FUTURE, "deadline must be the server value"
            assert rec["fence"] == 7 and isinstance(rec["fence"], int)
        t("valid claim stored, server deadline kept", claim_deadline_is_server_value)
        t("reject claimed=false", lambda: expect_error(
            lambda: _validate_claim_response("T1", {**json.loads(claim_ok_body()), "claimed": False}, now)))
        t("reject canExecute=false", lambda: expect_error(
            lambda: _validate_claim_response("T1", {**json.loads(claim_ok_body()), "canExecute": False}, now)))
        t("reject cancellationRequested", lambda: expect_error(
            lambda: _validate_claim_response("T1", {**json.loads(claim_ok_body()), "cancellationRequested": True}, now)))
        t("reject taskRef mismatch", lambda: expect_error(
            lambda: _validate_claim_response("T1", {**json.loads(claim_ok_body()), "taskRef": "T2"}, now)))
        t("reject string fence", lambda: expect_error(
            lambda: _validate_claim_response("T1", json.loads(claim_ok_body(fence="7")), now)))
        t("reject missing leaseUntil", lambda: expect_error(
            lambda: _validate_claim_response(
                "T1", {k: v for k, v in json.loads(claim_ok_body()).items() if k != "leaseUntil"}, now)))
        t("reject past leaseUntil", lambda: expect_error(
            lambda: _validate_claim_response("T1", json.loads(claim_ok_body(lu=PAST)), now)))

        print("-- response-loss retry keeps ONE claim intent --")
        def claim_retry():
            tr = fake([("raise", TransportError("simulated loss")),
                       ("resp", 200, claim_ok_body(rid="rq-claim-1"))])
            a1 = _ns(op="claim", task_ref="T1", request_id="rq-claim-1")
            try:
                op_claim(a1)
                raise AssertionError("expected TransportError")
            except TransportError:
                pass
            it = _read_intent("T1", "claim")
            assert it and it["state"] == "inflight" and it["requestId"] == "rq-claim-1"
            a2 = _ns(op="claim", task_ref="T1", request_id="rq-OTHER")
            assert op_claim(a2) == 0
            assert len(tr.calls) == 2
            assert tr.calls[0]["body"]["requestId"] == "rq-claim-1"
            assert tr.calls[1]["body"]["requestId"] == "rq-claim-1", \
                "retry must reuse original requestId"
            r = load_claim_receipt("T1")
            assert r["attemptId"] == "att1" and r["fence"] == 7
            assert r["leaseUntilEpoch"] == FUTURE
        t("claim response-loss: same requestId retried", claim_retry)

        print("-- expired/cancelled/dead receipts: NO implicit re-claim --")
        def no_implicit_reclaim():
            save_claim_receipt("TX", "rq-x", "att-x", 2, PAST, PAST)
            tr = fake([])
            try:
                op_claim(_ns(op="claim", task_ref="TX", request_id="rq-new"))
                raise AssertionError("expired receipt must stop")
            except ApiError as e:
                assert "confirm-stop" in str(e) and "re-claim" in str(e)
            assert tr.calls == [], "no HTTP on stopped claim"
            save_claim_receipt("TX2", "rq-x2", "att-x2", 2, FUTURE, FUTURE,
                               cancellation_requested=True)
            try:
                op_claim(_ns(op="claim", task_ref="TX2", request_id="rq-new"))
                raise AssertionError("cancelled receipt must stop")
            except ApiError as e:
                assert "re-claim" in str(e)
            assert tr.calls == [], "no HTTP on cancelled claim"
        t("expired/cancelled: stop, suggest confirm-stop", no_implicit_reclaim)

        print("-- second heartbeat truly renews --")
        def hb_renew():
            save_claim_receipt("TH", "rq-h", "att-h", 11, FUTURE, FUTURE)
            lu2 = FUTURE + 900
            tr = fake([("resp", 200, json.dumps({"attemptId": "att-h", "fence": 11,
                                                 "leaseUntil": FUTURE})),
                       ("resp", 200, json.dumps({"attemptId": "att-h", "fence": 11,
                                                 "leaseUntil": lu2}))])
            assert op_heartbeat(_ns(op="heartbeat", task_ref="TH")) == 0
            assert op_heartbeat(_ns(op="heartbeat", task_ref="TH")) == 0
            id1 = tr.calls[0]["body"]["requestId"]
            id2 = tr.calls[1]["body"]["requestId"]
            assert id1 != id2, "second heartbeat must use a NEW requestId"
            r = load_claim_receipt("TH")
            assert r["leaseUntilEpoch"] == lu2, "deadline must refresh from server"
            assert r["attemptId"] == "att-h" and r["fence"] == 11, "attempt/fence pinned"
        t("heartbeat renews with new ids", hb_renew)

        print("-- heartbeat response-loss keeps intent --")
        def hb_loss():
            save_claim_receipt("THL", "rq-hl", "att-hl", 3, FUTURE, FUTURE)
            tr = fake([("raise", TransportError("simulated loss")),
                       ("resp", 200, json.dumps({"attemptId": "att-hl", "fence": 3,
                                                 "leaseUntil": FUTURE}))])
            try:
                op_heartbeat(_ns(op="heartbeat", task_ref="THL"))
                raise AssertionError("expected TransportError")
            except TransportError:
                pass
            it = _read_intent("THL", "heartbeat")
            assert it and it["state"] == "inflight"
            rid = it["requestId"]
            assert op_heartbeat(_ns(op="heartbeat", task_ref="THL")) == 0
            assert tr.calls[1]["body"]["requestId"] == rid, "retry reuses intent requestId"
        t("heartbeat loss: intent kept, id reused", hb_loss)

        print("-- inflight param change refused --")
        def intent_conflict():
            save_claim_receipt("TP", "rq-p", "att-p", 8, FUTURE, FUTURE)
            intent, _ = prepare_intent(
                "TP", "report-blocked",
                lambda rid: body_report_blocked("att-p", 8, rid, "m1"),
                attempt_id="att-p", fence=8)
            tr = fake([])
            try:
                op_report_blocked(_ns(op="report-blocked", task_ref="TP", message="m2"))
                raise AssertionError("changed params must be refused")
            except ApiError as e:
                assert "different data" in str(e)
            assert tr.calls == [], "no HTTP on param conflict"
            tr2 = fake([("resp", 200, "{}")])
            assert op_report_blocked(_ns(op="report-blocked", task_ref="TP", message="m1")) == 0
            assert tr2.calls[0]["body"]["requestId"] == intent["requestId"]
            assert tr2.calls[0]["body"]["message"] == "m1"
        t("same id never carries different data", intent_conflict)

        print("-- null leaseUntil: terminal state, markers kept --")
        def null_lease():
            save_claim_receipt("TN", "rq-n", "att-n", 6, FUTURE, FUTURE)
            tr = fake([("resp", 200, json.dumps({"attemptId": "att-n", "fence": 6,
                                                 "leaseUntil": None,
                                                 "canExecute": False}))])
            assert op_heartbeat(_ns(op="heartbeat", task_ref="TN")) == 0
            r = load_claim_receipt("TN", require_live=False)
            assert r["terminated"] is True, "terminal marker kept"
            assert r["canExecute"] is False
            assert r["leaseUntilEpoch"] == 0.0, "lease invalidated"
            assert r["attemptId"] == "att-n" and r["fence"] == 6, "identity kept"
            try:
                op_heartbeat(_ns(op="heartbeat", task_ref="TN"))
                raise AssertionError("terminated heartbeat must stop")
            except ApiError as e:
                assert "terminated" in str(e)
            assert len(tr.calls) == 1, "no HTTP after termination"
            tr2 = fake([("resp", 200, "{}")])
            assert op_confirm_stop(_ns(op="confirm-stop", task_ref="TN")) == 0
            b = tr2.calls[0]["body"]
            assert b["attemptId"] == "att-n" and b["fence"] == 6, \
                "confirm-stop reuses original attempt/fence"
        t("null leaseUntil -> terminated, confirm-stop works", null_lease)

        print("-- fence/attempt change refused --")
        def fence_change():
            save_claim_receipt("TF", "rq-f", "att-f", 5, FUTURE, FUTURE)
            fake([("resp", 200, json.dumps({"attemptId": "att-f", "fence": 999,
                                           "leaseUntil": FUTURE + 1}))])
            try:
                op_heartbeat(_ns(op="heartbeat", task_ref="TF"))
                raise AssertionError("changed fence should be refused")
            except ApiError as e:
                assert "fence" in str(e)
            r = load_claim_receipt("TF")
            assert r["fence"] == 5 and r["leaseUntilEpoch"] == FUTURE, "receipt untouched"
        t("server fence change refused", fence_change)

        print("-- expired lease: confirm-stop works, others stop --")
        def expired_stop():
            save_claim_receipt("TE", "rq-e", "att-e", 2, PAST, PAST)
            tr = fake([("resp", 200, json.dumps({"stopped": True}))])
            assert op_confirm_stop(_ns(op="confirm-stop", task_ref="TE")) == 0
            b = tr.calls[0]["body"]
            assert b["attemptId"] == "att-e" and b["fence"] == 2, \
                "original attempt/fence reused"
            assert not os.path.isfile(_claim_path("TE")), "receipt dropped after stop"
            save_claim_receipt("TE2", "rq-e2", "att-e2", 2, PAST, PAST)
            try:
                op_heartbeat(_ns(op="heartbeat", task_ref="TE2"))
                raise AssertionError("expired heartbeat should stop")
            except ApiError as e:
                assert "lease expired" in str(e)
        t("confirm-stop after expiry; heartbeat blocked", expired_stop)

        print("-- cancellation blocks upload --")
        def cancelled_upload():
            save_claim_receipt("TC", "rq-c", "att-c", 4, FUTURE, FUTURE,
                               cancellation_requested=True)
            with tempfile.TemporaryDirectory() as td:
                p = os.path.join(td, "a.md")
                open(p, "wb").write(b"data")
                tr = fake([])
                try:
                    op_upload_file(_ns(op="upload-file", task_ref="TC",
                                      upload_id="u1", file=p))
                    raise AssertionError("cancelled upload should stop")
                except ApiError as e:
                    assert "cancelled" in str(e)
                assert tr.calls == [], "no HTTP after cancellation"
        t("cancelled: upload blocked pre-send", cancelled_upload)

        print("-- HTTP classification: real MW_* codes --")
        def http_codes():
            buf = io.StringIO()
            tr = fake([("resp", 500, '{"code":"boom","token":"REAL-SECRET-1"}'),
                       ("resp", 401, '{"error":"unauthorized"}'),
                       ("resp", 403, '{"error":{"code":"forbidden"}}}'),
                       ("resp", 409, '{"code":"MW_IDEMPOTENCY_CONFLICT"}'),
                       ("resp", 409, '{"code":"MW_LEASE_EXPIRED"}'),
                       ("resp", 409, '{"code":"MW_SLOT_BUSY"}'),
                       ("resp", 409, '{"code":"mystery_xyz"}'),
                       ("resp", 429, '{}'),
                       ("resp", 200, '{"duplicate":true}')])
            with redirect_stdout(buf):
                try:
                    send("inbox")
                    raise AssertionError("500 should raise")
                except HttpError:
                    pass
            out = buf.getvalue()
            assert "REAL-SECRET-1" not in out, "secret leaked!"
            assert "<redacted>" in out, "sanitizer must redact"
            assert '"code": "boom"' in out, "full JSON must be logged, not truncated"
            try:
                send("inbox")
                raise AssertionError("401 should raise")
            except HttpError as e:
                assert "authentication failed" in str(e)
            try:
                send("inbox")
                raise AssertionError("403 should raise")
            except HttpError as e:
                assert "scope" in str(e), "403 must mention scope revocation"
            # MW_IDEMPOTENCY_CONFLICT: non-zero, no success classification, no auto re-claim
            save_claim_receipt("TQ", "rq-q", "att-q", 1, FUTURE, FUTURE)
            try:
                op_claim(_ns(op="claim", task_ref="TQ", request_id="rq-q2"))
                raise AssertionError("409 idempotent must exit non-zero")
            except HttpError as e:
                assert "duplicate" in str(e).lower()
            r = load_claim_receipt("TQ", require_live=False)
            assert r["attemptId"] == "att-q", "no auto re-claim on 409"
            # MW_LEASE_EXPIRED: lease invalid, local receipt marked
            save_claim_receipt("TL", "rq-l", "att-l", 1, FUTURE, FUTURE)
            try:
                op_heartbeat(_ns(op="heartbeat", task_ref="TL"))
                raise AssertionError("409 lease code must raise")
            except HttpError as e:
                assert "lease invalid" in str(e)
            r = load_claim_receipt("TL", require_live=False)
            assert r["terminated"] is True, "server-declared lease death recorded"
            # MW_SLOT_BUSY: busy, receipt untouched
            try:
                send("inbox")
                raise AssertionError("409 busy should raise")
            except HttpError as e:
                assert "busy" in str(e).lower() or "unavailable" in str(e).lower()
            # unknown code: manual review, never mislabeled
            try:
                send("inbox")
                raise AssertionError("409 unknown should raise")
            except HttpError as e:
                msg = str(e).lower()
                assert "lease" not in msg, "unknown 409 must NOT mention lease"
                assert "manual review" in msg
            try:
                send("inbox")
                raise AssertionError("429 should raise")
            except HttpError as e:
                assert "429" in str(e)
            # 200 + duplicate:true is the idempotent SUCCESS shape
            rr = send("inbox")
            assert rr["disposition"] == "ok"
        t("MW_* 409s all non-zero; 200+duplicate ok", http_codes)

        print("-- main() exit codes --")
        def exits():
            fake([("resp", 500, '{"code":"x"}')])
            rc = main(["inbox"])
            assert rc == 3, f"expected exit 3, got {rc}"
            fake([("resp", 200, '{"ok":true}')])
            rc = main(["inbox"])
            assert rc == 0, f"expected exit 0, got {rc}"
            rc = main(["task-get", "--task-ref", "../evil"])
            assert rc == 2, f"expected exit 2, got {rc}"
            fake([("resp", 409, '{"code":"MW_TASK_UNAVAILABLE"}')])
            rc = main(["inbox"])
            assert rc == 3, f"expected exit 3 for 409, got {rc}"
        t("non-2xx -> non-zero exit", exits)

        print("-- dry-run builds without credential/network --")
        def dry():
            r = send("event-ack", task_ref="t1", event_id="e1",
                     body=body_event_ack(), dry_run=True)
            assert r["method"] == "POST" and r["body"] == {}
            assert "workspace.cnsubscribe.xyz" in r["url"]
            try:
                send("nope", dry_run=True)
                raise AssertionError("unknown route accepted")
            except ApiError:
                pass
        t("dry-run + fixed routes", dry)

    finally:
        _TEST_HOOKS["transport"] = None
        _TEST_HOOKS["surrogate_fn"] = None
        subprocess.run = saved_run
        globals()["_credential_surrogate"] = saved_surr
        for gname, val in saved.items():
            globals()[gname] = val
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    ok = all(p for _, p, _ in results)
    for name, passed, msg in results:
        print(f"  {'PASS' if passed else 'FAIL'} {name}" + (f": {msg}" if msg and not passed else ""))
    print(f"== {sum(1 for _, p, _ in results if p)}/{len(results)} "
          f"{'ALL PASS' if ok else 'SOME FAILED'} ==")
    return 0 if ok else 1


# ------------------------------------------------------------------- main ---
def main(argv=None):
    ap = argparse.ArgumentParser(description="workspace.muse.pull.v1 client (11 ops)")
    sub = ap.add_subparsers(dest="op", required=True)

    def add_common(p):
        p.add_argument("--dry-run", action="store_true",
                       help="print method/URL/body only; no credential, no network")

    for name in ("identity", "inbox"):
        p = sub.add_parser(name); add_common(p)

    for name in ("task-get", "task-status"):
        p = sub.add_parser(name)
        p.add_argument("--task-ref", required=True); add_common(p)

    p = sub.add_parser("claim")
    p.add_argument("--task-ref", required=True)
    p.add_argument("--request-id", default=None,
                   help="idempotency key; generated if omitted")
    add_common(p)

    for name in ("heartbeat", "confirm-stop"):
        p = sub.add_parser(name)
        p.add_argument("--task-ref", required=True); add_common(p)

    p = sub.add_parser("report-blocked")
    p.add_argument("--task-ref", required=True); p.add_argument("--message", required=True)
    add_common(p)

    p = sub.add_parser("upload-file")
    p.add_argument("--task-ref", required=True); p.add_argument("--upload-id", required=True)
    p.add_argument("--file", required=True); add_common(p)

    p = sub.add_parser("submit-result")
    p.add_argument("--task-ref", required=True); p.add_argument("--summary", required=True)
    p.add_argument("--sources", required=True, help="JSON array of https URLs")
    p.add_argument("--tool-evidence", default=None, help='JSON array of {tool,receiptId}')
    p.add_argument("--evidence-note", default=None)
    add_common(p)

    p = sub.add_parser("event-ack")
    p.add_argument("--task-ref", required=True); p.add_argument("--event-id", required=True)
    add_common(p)

    sub.add_parser("test", help="offline simulated test suite")

    args = ap.parse_args(argv)
    try:
        if args.op == "test":
            return run_tests()
        if args.op in ("identity", "inbox", "task-get", "task-status"):
            return op_get(args, args.op) or 0
        if args.op == "claim":
            return op_claim(args) or 0
        if args.op == "heartbeat":
            return op_heartbeat(args) or 0
        if args.op == "report-blocked":
            return op_report_blocked(args) or 0
        if args.op == "confirm-stop":
            return op_confirm_stop(args) or 0
        if args.op == "upload-file":
            return op_upload_file(args) or 0
        if args.op == "submit-result":
            return op_submit_result(args) or 0
        if args.op == "event-ack":
            return op_event_ack(args) or 0
    except HttpError as e:
        print(f"error: {e}", file=sys.stderr)
        return 3
    except TransportError as e:
        print(f"error: {e}", file=sys.stderr)
        return 4
    except ApiError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except BrokenPipeError:
        return 0


if __name__ == "__main__":
    sys.exit(main())
