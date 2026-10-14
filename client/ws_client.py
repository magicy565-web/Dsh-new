#!/usr/bin/env python3
"""Cnsubscribe Workspace Agent transport client; Python 3.10+, standard library only.

Credentials are injected into this process through WS_AGENT_TOKEN or Client(token=).
This module never reads a credential file and never writes credentials to disk.
The server owns every preset, model call, business rule, and generated artifact.
"""

from __future__ import annotations

import argparse
from http.client import HTTPException
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import ssl
import sys
import time
from uuid import uuid4
from typing import Any, Callable, Iterator
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


API_BASE = "/api/agent/v1"
KINDS = frozenset({"accepted", "stage", "thinking", "progress", "artifact", "done", "error"})
TERMINAL = frozenset({"done", "failed", "interrupted", "cancelled"})
MAX_JSON_BYTES = 16 * 1024 * 1024
MAX_EVENT_BYTES = 1024 * 1024
MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
_TASK_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_FILENAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class ClientError(Exception):
    """A safe, user-readable client error. Never contains an authorization header."""


class ProtocolError(ClientError):
    pass


class TransportError(ClientError):
    pass


class ClientHTTPError(ClientError):
    def __init__(self, status: int, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.status = status
        self.details = details or {}


class _PollingRequired(Exception):
    pass


class _ArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse otherwise echoes unknown arguments, including an accidentally
        # pasted credential. Keep parsing failures free of argument values.
        self.print_usage(sys.stderr)
        self.exit(2, "参数无效；请查看 --help。凭据只能由 WS_AGENT_TOKEN 安全注入，不能放入命令行参数。\n")


def _url_parts(value: str):
    if not isinstance(value, str) or not value or len(value) > 4096:
        raise ClientError("服务地址为空或过长，请设置 WS_AGENT_URL。")
    if re.search(r"[\x00-\x20\x7f]", value) or "\\" in value:
        raise ClientError("服务地址含非法字符。")
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError:
        raise ClientError("服务地址或端口无效。") from None
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise ClientError("服务地址必须是 HTTP(S) URL。")
    if parts.username is not None or parts.password is not None or parts.fragment:
        raise ClientError("服务地址不得包含凭据或片段。")
    hostname = parts.hostname.lower()
    try:
        local = ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        local = hostname == "localhost"
    if parts.scheme != "https" and not local:
        raise ClientError("远程服务必须使用 HTTPS；仅本机回环地址允许 HTTP。")
    if port == 0:
        raise ClientError("服务地址端口无效。")
    return parts


def _origin_key(value: str) -> tuple[str, str, int]:
    parts = _url_parts(value)
    return parts.scheme, parts.hostname.lower(), parts.port or (443 if parts.scheme == "https" else 80)


def _service_origin(value: str) -> str:
    parts = _url_parts(value.rstrip("/"))
    if parts.query or parts.path not in {"", API_BASE}:
        raise ClientError("WS_AGENT_URL 必须是服务根地址或以 /api/agent/v1 结尾的地址，不得含查询参数。")
    return urlunsplit((parts.scheme, parts.netloc, "", "", ""))


def _request_key(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", value):
        raise ClientError("请求键须为 1–128 个安全字符；不使用凭据作为请求键。")
    return value


def _task_id(value: str) -> str:
    if not isinstance(value, str) or not _TASK_ID.fullmatch(value):
        raise ClientError("任务号格式无效。")
    return value


def _cursor(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ClientError("from 必须为非负整数。")
    return value


def _safe_filename(value: str) -> str:
    if not isinstance(value, str) or not _FILENAME.fullmatch(value) or value.endswith("."):
        raise ClientError("产物文件名不安全。")
    stem = value.split(".", 1)[0].upper()
    if stem in {"CON", "PRN", "AUX", "NUL", "CLOCK$"} or re.fullmatch(r"(?:COM|LPT)[0-9]", stem):
        raise ClientError("产物文件名为系统保留名称。")
    return value


class _SameOriginRedirects(HTTPRedirectHandler):
    def __init__(self, origin: str):
        super().__init__()
        self.origin_key = _origin_key(origin)

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urljoin(req.full_url, newurl)
        if _origin_key(target) != self.origin_key:
            raise ClientError("拒绝跨来源重定向：凭据仅可发送到配置的服务。")
        if req.get_method() not in {"GET", "HEAD"}:
            raise ClientError("拒绝重定向任务提交；请使用服务的最终 HTTPS 地址。")
        return super().redirect_request(req, fp, code, msg, headers, target)


class _DownloadDirectory:
    """Open each directory with O_NOFOLLOW and create files with O_EXCL.

    Directory descriptors prevent a symlink swap between validation and writing.
    Download fails closed on platforms without these filesystem primitives.
    """

    def __init__(self, directory: str | os.PathLike[str]):
        self.path = Path(os.path.abspath(os.path.expanduser(os.fspath(directory))))
        self.fd: int | None = None

    def __enter__(self):
        if not all((hasattr(os, "O_NOFOLLOW"), hasattr(os, "O_DIRECTORY"), os.open in os.supports_dir_fd,
                    os.mkdir in os.supports_dir_fd, os.unlink in os.supports_dir_fd)):
            raise ClientError("此系统缺少安全下载所需的目录文件描述符；请在 Linux/macOS 的 Muse 工作目录下载。")
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        fd = None
        try:
            fd = os.open(self.path.anchor, flags)
            for part in self.path.parts[1:]:
                try:
                    os.mkdir(part, mode=0o700, dir_fd=fd)
                except FileExistsError:
                    pass
                next_fd = os.open(part, flags, dir_fd=fd)
                os.close(fd)
                fd = next_fd
            self.fd = fd
            return self
        except OSError:
            if fd is not None:
                os.close(fd)
            raise ClientError("下载目录无法安全打开；目录及其父目录均不得为符号链接。") from None

    def __exit__(self, *_):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def create(self, name: str) -> int:
        _safe_filename(name)
        try:
            return os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.fd)
        except FileExistsError:
            raise ClientError(f"文件 {name} 已存在；客户端不会覆盖，请选择新的下载目录。") from None
        except OSError:
            raise ClientError(f"无法安全创建产物文件 {name}。") from None

    def remove_own_file(self, name: str, identity: tuple[int, int]):
        try:
            info = os.stat(name, dir_fd=self.fd, follow_symlinks=False)
            if (info.st_dev, info.st_ino) == identity:
                os.unlink(name, dir_fd=self.fd)
        except FileNotFoundError:
            pass


class Client:
    def __init__(self, base_url: str, token: str | None = None, timeout: float = 30):
        self.origin = _service_origin(base_url)
        self.api_url = self.origin + API_BASE
        if token is not None and (not isinstance(token, str) or not re.fullmatch(r"[\x21-\x7e]{1,8192}", token)):
            raise ClientError("注入的凭据格式无效；不得带 Bearer 前缀、空白或换行。")
        if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not 0 < timeout <= 600:
            raise ClientError("HTTP 超时必须为 0 到 600 秒之间的数值。")
        self._token = token
        self.timeout = timeout
        self._opener = build_opener(_SameOriginRedirects(self.origin))

    def redact(self, value: Any) -> str:
        text = str(value)
        if self._token:
            text = text.replace(self._token, "[REDACTED]")
        return re.sub(r"(?i)Bearer\s+[^\s\"'<>]+", "Bearer [REDACTED]", text)

    def safe_value(self, value: Any) -> Any:
        if isinstance(value, str):
            return self.redact(value)
        if isinstance(value, dict):
            return {self.redact(key): self.safe_value(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self.safe_value(item) for item in value]
        return value

    def _url(self, value: str) -> str:
        target = urljoin(self.api_url + "/", value)
        if _origin_key(target) != _origin_key(self.origin):
            raise ClientError("拒绝跨来源 URL：凭据仅可发送到配置的服务。")
        return target

    def _registered_url(self, value: str, path: str) -> str:
        if not isinstance(value, str):
            raise ProtocolError("服务返回的下载或事件地址无效。")
        target = self._url(value)
        parts = _url_parts(target)
        if parts.path != API_BASE + path or parts.query:
            raise ProtocolError("服务返回的地址与该任务登记的接口不一致。")
        return target

    def _open(self, method: str, target: str, *, body: Any = None, public: bool = False,
              accept: str = "application/json", last_seq: int | None = None, request_key: str | None = None):
        url = self._url(target)
        headers = {"Accept": accept, "User-Agent": "Cnsubscribe-Workspace-Agent/1.1 Python"}
        if request_key is not None:
            headers["Idempotency-Key"] = _request_key(request_key)
        if not public:
            if not self._token:
                raise ClientError("未注入 WS_AGENT_TOKEN；请通过安全凭据页或可信运行时注入，勿在聊天中发送 token。")
            headers["Authorization"] = "Bearer " + self._token
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if last_seq is not None:
            headers["Last-Event-ID"] = str(last_seq)
            headers["Cache-Control"] = "no-cache"
        request = Request(url, data=data, headers=headers, method=method)
        try:
            return self._opener.open(request, timeout=self.timeout)
        except HTTPError as error:
            try:
                with error:
                    raw = error.read(8193)
                details = json.loads(raw[:8192].decode("utf-8"))
                if not isinstance(details, dict):
                    details = {}
            except (ValueError, OSError):
                details = {}
            message = details.get("error")
            if not isinstance(message, str):
                message = f"服务返回 HTTP {error.code}。"
            safe_details = self.safe_value(details)
            raise ClientHTTPError(error.code, self.redact(message), safe_details) from None
        except (URLError, TimeoutError, OSError, ssl.SSLError) as error:
            # Do not echo a proxy URL, headers, request body, or credentials in errors.
            raise TransportError(f"连接服务失败（{type(error).__name__}）；请检查网络、HTTPS 证书和服务地址。") from None

    def _json(self, method: str, target: str, *, body: Any = None, public: bool = False,
              status: int = 200, request_key: str | None = None) -> Any:
        try:
            with self._open(method, target, body=body, public=public, request_key=request_key) as response:
                if response.status != status:
                    raise ProtocolError(f"接口状态码应为 {status}，实际为 {response.status}。")
                raw = response.read(MAX_JSON_BYTES + 1)
            if len(raw) > MAX_JSON_BYTES:
                raise ProtocolError("服务 JSON 响应过大。")
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ProtocolError("服务未返回有效 UTF-8 JSON。") from None
        except (TimeoutError, socket.timeout, OSError, HTTPException):
            raise TransportError("读取服务响应中断；可重新读取任务状态或事件。") from None

    def health(self) -> Any:
        return self._json("GET", "health", public=True)

    def presets(self) -> Any:
        return self._json("GET", "presets")

    def submit(self, task_type: str, title: str, input_fields: dict[str, Any], request_key: str | None = None) -> dict[str, Any]:
        if not isinstance(task_type, str) or not task_type or not isinstance(title, str) or not title:
            raise ClientError("任务 type、title 均须为非空字符串。")
        if not isinstance(input_fields, dict):
            raise ClientError("input 必须为 JSON 对象。")
        key = _request_key(request_key or str(uuid4()))
        try:
            result = self._json("POST", "tasks", body={"type": task_type, "title": title, "input": input_fields}, status=201, request_key=key)
        except TransportError:
            # A lost response is not permission to create a different task.
            try:
                result = self.lookup(key)
                result = {**result, "events_url": API_BASE + "/tasks/" + quote(_task_id(result["taskId"]), safe="") + "/events"}
            except (ClientError, KeyError):
                raise TransportError(f"提交回执未确认；原请求键为 {key}。请用 lookup 查询，或用相同 --request-key 和相同内容重提。") from None
        if not isinstance(result, dict) or not isinstance(result.get("taskId"), str):
            raise ProtocolError("提交接口缺少 taskId。")
        task = _task_id(result["taskId"])
        self._registered_url(result.get("events_url"), f"/tasks/{quote(task, safe='')}/events")
        return result

    def status(self, task_id: str) -> Any:
        return self._json("GET", "tasks/" + quote(_task_id(task_id), safe=""))

    def lookup(self, request_key: str) -> Any:
        return self._json("GET", "tasks/by-request/" + quote(_request_key(request_key), safe=""))

    def resume(self, task_id: str) -> Any:
        return self._json("POST", "tasks/" + quote(_task_id(task_id), safe="") + "/resume", body={})

    def artifacts(self, task_id: str) -> list[dict[str, Any]]:
        result = self._json("GET", "tasks/" + quote(_task_id(task_id), safe="") + "/artifacts")
        if not isinstance(result, list):
            raise ProtocolError("产物列表须为 JSON 数组。")
        return result

    @staticmethod
    def _event(value: Any) -> dict[str, Any]:
        if not isinstance(value, dict) or set(value) != {"seq", "kind", "payload", "ts"}:
            raise ProtocolError("事件字段须为 seq、kind、payload、ts。")
        seq = value["seq"]
        if isinstance(seq, bool) or not isinstance(seq, int) or seq < 1:
            raise ProtocolError("事件 seq 必须为正整数。")
        if not isinstance(value["kind"], str) or value["kind"] not in KINDS or not isinstance(value["payload"], dict) or not isinstance(value["ts"], str):
            raise ProtocolError("事件 kind、payload 或 ts 不符合协议。")
        return value

    def replay(self, task_id: str, from_seq: int = 0) -> list[dict[str, Any]]:
        task = quote(_task_id(task_id), safe="")
        result = self._json("GET", f"tasks/{task}/events?" + urlencode({"from": _cursor(from_seq), "format": "json"}))
        if isinstance(result, dict) and set(result) == {"events"}:
            result = result["events"]
        if not isinstance(result, list):
            raise ProtocolError("JSON 事件重放须返回事件数组。")
        previous = from_seq
        events = []
        for item in result:
            event = self._event(item)
            if event["seq"] <= previous:
                continue
            if event["seq"] != previous + 1:
                raise ProtocolError("事件序号存在缺口；请保留任务号并重新从 seq=0 读取。")
            previous = event["seq"]
            events.append(event)
        return events

    @staticmethod
    def _sse_frames(response) -> Iterator[dict[str, Any]]:
        data: list[str] = []
        frame_id: str | None = None
        size = 0
        while True:
            raw = response.readline(MAX_EVENT_BYTES + 1)
            if not raw:
                # An incomplete frame is not committed; reconnect from the last emitted seq.
                return
            if len(raw) > MAX_EVENT_BYTES:
                raise ProtocolError("SSE 行超过安全长度。")
            try:
                line = raw.decode("utf-8").rstrip("\r\n")
            except UnicodeDecodeError:
                raise ProtocolError("SSE 不是有效 UTF-8。") from None
            if line == "":
                if data:
                    try:
                        event = Client._event(json.loads("\n".join(data)))
                    except json.JSONDecodeError:
                        raise ProtocolError("SSE data 不是有效 JSON。") from None
                    if frame_id is None or frame_id != str(event["seq"]):
                        raise ProtocolError("SSE id 与事件 seq 不一致。")
                    yield event
                data, frame_id, size = [], None, 0
                continue
            if line.startswith(":"):
                continue
            size += len(raw)
            if size > MAX_EVENT_BYTES:
                raise ProtocolError("SSE 事件超过安全长度。")
            field, separator, value = line.partition(":")
            if separator and value.startswith(" "):
                value = value[1:]
            if field == "data":
                data.append(value)
            elif field == "id":
                frame_id = value

    def event_stream(self, task_id: str, from_seq: int = 0, *, retries: int = 3, retry_delay: float = 0.5,
                     poll_interval: float = 1.0, max_polls: int = 900,
                     notice: Callable[[str], None] | None = None) -> Iterator[dict[str, Any]]:
        """Yield persisted events once, reconnecting from the last seq, then polling.

        Submission is never automatically retried: the server contract does not
        implicitly authorize a new POST. Only read requests are retried.
        """
        task = quote(_task_id(task_id), safe="")
        cursor = _cursor(from_seq)
        if not isinstance(retries, int) or not 0 <= retries <= 20 or not isinstance(max_polls, int) or not 1 <= max_polls <= 86400:
            raise ClientError("重试次数或轮询上限无效。")
        if not 0 <= retry_delay <= 30 or not 0 <= poll_interval <= 60:
            raise ClientError("重试或轮询间隔无效。")
        tell = notice or (lambda _: None)
        transient_codes = {408, 425, 429, 500, 502, 503, 504}
        for attempt in range(retries + 1):
            try:
                target = f"tasks/{task}/events?" + urlencode({"from": cursor})
                with self._open("GET", target, accept="text/event-stream", last_seq=cursor) as response:
                    if response.headers.get_content_type() != "text/event-stream":
                        raise _PollingRequired()
                    for event in self._sse_frames(response):
                        if event["seq"] <= cursor:
                            continue
                        if event["seq"] != cursor + 1:
                            raise ProtocolError("实时事件序号存在缺口；请从已收到的 seq 重放。")
                        cursor = event["seq"]
                        yield event
                # Ended subscriptions may have no newer events. The persisted
                # replay is checked before the status so the terminal event wins.
                for event in self.replay(task_id, cursor):
                    cursor = event["seq"]
                    yield event
                state = self.status(task_id)
                if isinstance(state, dict) and state.get("status") in TERMINAL:
                    return
            except _PollingRequired:
                tell("服务当前未提供 SSE，改用同一事件库的 JSON 轮询。")
                break
            except ClientHTTPError as error:
                if error.status in {406, 415, 501}:
                    tell("服务当前未提供 SSE，改用同一事件库的 JSON 轮询。")
                    break
                if error.status not in transient_codes:
                    raise
            except (TransportError, TimeoutError, socket.timeout, OSError, HTTPException):
                pass
            if attempt < retries:
                tell(f"事件连接已断开，将从 seq={cursor} 续传（{attempt + 1}/{retries}）。")
                time.sleep(min(retry_delay * (2 ** attempt), 8))
        else:
            tell(f"SSE 重试已用完，改从 seq={cursor} 进行有上限的 JSON 轮询。")

        for _ in range(max_polls):
            try:
                for event in self.replay(task_id, cursor):
                    cursor = event["seq"]
                    yield event
                state = self.status(task_id)
                if isinstance(state, dict) and state.get("status") in TERMINAL:
                    return
            except ClientHTTPError as error:
                if error.status not in transient_codes:
                    raise
            except TransportError:
                pass
            time.sleep(poll_interval)
        raise TransportError(f"事件续传达到轮询上限；任务未被取消。请用 replay {task_id} --from-seq {cursor} 继续读取。")

    def download(self, task_id: str, output_dir: str | os.PathLike[str], names: list[str] | None = None) -> list[dict[str, Any]]:
        task = quote(_task_id(task_id), safe="")
        registered: dict[str, dict[str, Any]] = {}
        for artifact in self.artifacts(task_id):
            if not isinstance(artifact, dict):
                raise ProtocolError("产物登记格式无效。")
            name = _safe_filename(artifact.get("name"))
            count = artifact.get("bytes")
            if isinstance(count, bool) or not isinstance(count, int) or not 0 <= count <= MAX_ARTIFACT_BYTES:
                raise ProtocolError("产物大小无效或超过客户端 64 MiB 上限。")
            if name in registered:
                raise ProtocolError("产物列表包含重复文件名。")
            url = self._registered_url(artifact.get("url"), f"/tasks/{task}/artifacts/{quote(name, safe='')}")
            registered[name] = {"name": name, "bytes": count, "url": url}
        selected = list(registered) if names is None else names
        if len(set(selected)) != len(selected):
            raise ClientError("下载文件名重复。")
        for name in selected:
            _safe_filename(name)
            if name not in registered:
                raise ClientError("请求的文件不在该任务的登记产物中。")
        if not selected:
            return []
        downloaded = []
        with _DownloadDirectory(output_dir) as directory:
            for name in selected:
                artifact = registered[name]
                fd = directory.create(name)
                info = os.fstat(fd)
                identity = info.st_dev, info.st_ino
                total = 0
                try:
                    with os.fdopen(fd, "wb") as output:
                        with self._open("GET", artifact["url"], accept="application/octet-stream") as response:
                            if response.status != 200:
                                raise ProtocolError("产物下载必须返回 HTTP 200。")
                            while True:
                                block = response.read(64 * 1024)
                                if not block:
                                    break
                                total += len(block)
                                if total > artifact["bytes"] or total > MAX_ARTIFACT_BYTES:
                                    raise ProtocolError("产物实际大小超过登记值；已中止下载。")
                                output.write(block)
                        if total != artifact["bytes"]:
                            raise ProtocolError("产物下载不完整或大小与登记不一致。")
                        output.flush()
                        os.fsync(output.fileno())
                    downloaded.append({"name": name, "bytes": total, "path": str(directory.path / name)})
                except BaseException:
                    directory.remove_own_file(name, identity)
                    raise
        return downloaded


def _read_input(raw: str | None) -> dict[str, Any]:
    if raw is None:
        if sys.stdin.isatty():
            raise ClientError("请用 --input-json 传入业务字段，或通过标准输入提供 JSON 对象。")
        raw = sys.stdin.read(MAX_EVENT_BYTES + 1)
    if len(raw.encode("utf-8")) > MAX_EVENT_BYTES:
        raise ClientError("输入 JSON 超过 1 MiB。")
    try:
        result = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, json.JSONDecodeError):
        raise ClientError("input 不是有效 JSON。") from None
    if not isinstance(result, dict):
        raise ClientError("input 必须为 JSON 对象。")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = _ArgumentParser(description="Workspace Agent 薄客户端；凭据仅从安全运行时环境注入。")
    parser.add_argument("--timeout", type=float, default=30, help="单次 HTTP 读写超时秒数，默认 30")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("health", help="查看公开健康状态")
    commands.add_parser("presets", help="读取服务端预设清单")
    submit = commands.add_parser("submit", help="提交任务并逐行输出事件 JSON")
    submit.add_argument("--type", required=True, dest="task_type")
    submit.add_argument("--title", required=True)
    submit.add_argument("--input-json", help="仅业务字段 JSON 对象；省略时读标准输入")
    submit.add_argument("--no-follow", action="store_true", help="仅返回提交响应，不订阅事件")
    submit.add_argument("--request-key", help="稳定非秘密请求键；相同内容重提沿用原键")
    replay = commands.add_parser("replay", help="按任务号重放或续传事件")
    replay.add_argument("task_id")
    replay.add_argument("--from-seq", type=int, default=0)
    replay.add_argument("--format", choices=("sse", "json"), default="sse")
    status = commands.add_parser("status", help="查询持久化任务状态")
    status.add_argument("task_id")
    lookup = commands.add_parser("lookup", help="提交响应丢失后按原请求键查询")
    lookup.add_argument("request_key")
    resume = commands.add_parser("resume", help="条件满足后恢复原任务及其 Pi 检查点")
    resume.add_argument("task_id")
    resume.add_argument("--no-follow", action="store_true")
    download = commands.add_parser("download", help="下载已登记产物，不覆盖现有文件")
    download.add_argument("task_id")
    download.add_argument("--output-dir", required=True)
    download.add_argument("--name", action="append", help="仅下载指定登记文件；可重复，否则下载全部")
    args = parser.parse_args(argv)
    client = None
    try:
        client = Client(os.environ.get("WS_AGENT_URL", ""), os.environ.get("WS_AGENT_TOKEN"), timeout=args.timeout)

        def emit(value: Any, *, stream=sys.stdout):
            print(json.dumps(client.safe_value(value), ensure_ascii=False, allow_nan=False), file=stream, flush=True)

        def notice(value: str):
            emit({"notice": value}, stream=sys.stderr)

        if args.command == "health":
            emit(client.health())
        elif args.command == "presets":
            emit(client.presets())
        elif args.command == "status":
            emit(client.status(args.task_id))
        elif args.command == "lookup":
            emit(client.lookup(args.request_key))
        elif args.command == "resume":
            receipt = client.resume(args.task_id)
            emit({"resumed": receipt}, stream=sys.stderr)
            if not args.no_follow:
                last_kind = None
                for event in client.event_stream(args.task_id, receipt.get("result", {}).get("resumeFrom", 0), notice=notice):
                    emit(event)
                    last_kind = event["kind"]
                return 0 if last_kind != "error" and client.status(args.task_id).get("status") == "done" else 1
        elif args.command == "submit":
            key = _request_key(args.request_key or str(uuid4()))
            emit({"request_key": key}, stream=sys.stderr)
            receipt = client.submit(args.task_type, args.title, _read_input(args.input_json), request_key=key)
            if args.no_follow:
                emit(receipt)
                return 0
            emit({"submitted": receipt}, stream=sys.stderr)
            last_kind = None
            for event in client.event_stream(receipt["taskId"], notice=notice):
                emit(event)
                last_kind = event["kind"]
            return 0 if last_kind != "error" and client.status(receipt["taskId"]).get("status") == "done" else 1
        elif args.command == "replay":
            if args.format == "json":
                emit(client.replay(args.task_id, args.from_seq))
            else:
                last_kind = None
                for event in client.event_stream(args.task_id, args.from_seq, notice=notice):
                    emit(event)
                    last_kind = event["kind"]
                return 0 if last_kind != "error" and client.status(args.task_id).get("status") == "done" else 1
        elif args.command == "download":
            emit(client.download(args.task_id, args.output_dir, args.name))
        return 0
    except KeyboardInterrupt:
        print('{"error":"客户端已停止读取；服务端任务仍继续，可按任务号重放。"}', file=sys.stderr)
        return 130
    except (ClientError, OSError, ValueError, HTTPException) as error:
        message = client.redact(error) if client else str(error)
        value: dict[str, Any] = {"error": message}
        if isinstance(error, ClientHTTPError):
            value["http_status"] = error.status
            if error.details:
                value["details"] = error.details
        rendered = json.dumps(client.safe_value(value) if client else value, ensure_ascii=False)
        print(rendered, file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
