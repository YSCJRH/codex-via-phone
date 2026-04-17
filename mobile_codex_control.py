from __future__ import annotations

import argparse
import json
import os
import re
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

try:
    import tkinter as tk
    from tkinter import messagebox
except ImportError:  # pragma: no cover
    tk = None
    messagebox = None
    

APP_TITLE = "移动 Codex 控制台"
APP_PORT = 3001
PROXY_PORT = 8080
REMOTE_FALLBACK_PORT = 8081
REMOTE_PORT = APP_PORT
PHONE_ACTIVITY_WINDOW_MINUTES = 10
LOCAL_PANEL_URL = f"http://127.0.0.1:{APP_PORT}"
APP_HEALTH_URL = f"{LOCAL_PANEL_URL}/health"
PROXY_HEALTH_URL = f"http://127.0.0.1:{PROXY_PORT}/health"
REMOTE_TARGET = f"http://127.0.0.1:{REMOTE_PORT}"


def resolve_workspace() -> Path:
    candidates = []
    if getattr(sys, "frozen", False):
        executable_dir = Path(sys.executable).resolve().parent
        candidates.extend([executable_dir, executable_dir.parent, executable_dir.parent.parent])
    else:
        source_dir = Path(__file__).resolve().parent
        candidates.extend([source_dir, source_dir.parent])

    for candidate in candidates:
        if (candidate / "scripts" / "start-mobile-codex-stack.ps1").exists():
            return candidate

    return Path(__file__).resolve().parent


WORKSPACE = resolve_workspace()
SCRIPTS_DIR = WORKSPACE / "scripts"
APP_STDERR_LOG = WORKSPACE / "tmp" / "logs" / "mobile-codex-app.stderr.log"
APP_BINDING_PATH = WORKSPACE / ".runtime" / "app-binding.json"
BRIDGE_WINDOW_PATH = WORKSPACE / ".runtime" / "desktop-approval-bridge-window.json"
DIAGNOSTICS_DIR = WORKSPACE / ".runtime" / "diagnostics"
CONNECTIVITY_EVENTS_PATH = DIAGNOSTICS_DIR / "connectivity-events.json"
SYNC_EVENTS_PATH = DIAGNOSTICS_DIR / "sync-events.json"
SYNC_SNAPSHOTS_PATH = DIAGNOSTICS_DIR / "sync-snapshots.json"
AUTO_START_CONFIG_PATH = WORKSPACE / ".runtime" / "auto-start.json"
AUTO_START_STATE_PATH = WORKSPACE / ".runtime" / "auto-start-state.json"
MODE_CONFIG_PATH = WORKSPACE / ".runtime" / "mode-config.json"
MOBILE_USER_AGENT = re.compile(r"android|iphone|ipad|mobile|ios|harmony", re.IGNORECASE)
MOBILE_OS = {"android", "ios"}
NGINX_MONTHS = {
    "Jan": 1,
    "Feb": 2,
    "Mar": 3,
    "Apr": 4,
    "May": 5,
    "Jun": 6,
    "Jul": 7,
    "Aug": 8,
    "Sep": 9,
    "Oct": 10,
    "Nov": 11,
    "Dec": 12,
}


def normalize_mode_name(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"", "localhost", "local-only"}:
        return "localhost"
    if normalized in {"tailnet-private", "tailnet-only"}:
        return "tailnet-private"
    if normalized == "public-funnel":
        return "public-funnel"
    if normalized in {"tailscale-direct", "tailnet-ip", "direct", "legacy-direct"}:
        return "legacy-direct"
    return normalized or "localhost"


def load_mode_config() -> dict[str, Any]:
    defaults = {
        "requestedMode": "localhost",
        "effectiveMode": "localhost",
        "persistentRemotePublish": False,
        "confirmedAt": None,
        "confirmedByInstallerVersion": None,
        "legacyStateDetected": False,
    }
    if not MODE_CONFIG_PATH.exists():
        return defaults

    try:
        data = json.loads(MODE_CONFIG_PATH.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return defaults

    return {
        "requestedMode": normalize_mode_name(data.get("requestedMode")),
        "effectiveMode": normalize_mode_name(data.get("effectiveMode")),
        "persistentRemotePublish": bool(data.get("persistentRemotePublish", False)),
        "confirmedAt": data.get("confirmedAt"),
        "confirmedByInstallerVersion": data.get("confirmedByInstallerVersion"),
        "legacyStateDetected": bool(data.get("legacyStateDetected", False)),
    }


def load_app_binding() -> dict[str, Any]:
    if not APP_BINDING_PATH.exists():
        return {"host": "127.0.0.1", "port": APP_PORT, "mode": "localhost"}

    try:
        data = json.loads(APP_BINDING_PATH.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return {"host": "127.0.0.1", "port": APP_PORT, "mode": "localhost"}

    host = str(data.get("host") or "127.0.0.1")
    port = int(data.get("port") or APP_PORT)
    mode = normalize_mode_name(data.get("mode") or "localhost")
    mode_visibility = normalize_mode_name(data.get("remoteVisibility") or data.get("mode"))
    return {
        "host": host,
        "port": port,
        "mode": mode,
        "url": data.get("url"),
        "preferred_url": data.get("preferredUrl"),
        "direct_url": data.get("directUrl"),
        "serve_url": data.get("serveUrl"),
        "funnel_url": data.get("funnelUrl"),
        "remote_visibility": mode_visibility,
        "requires_tailscale_client": data.get("requiresTailscaleClient"),
    }


MODE_CONFIG = load_mode_config()
APP_BINDING = load_app_binding()
APP_PUBLIC_HOST = str(APP_BINDING.get("host") or "127.0.0.1")
APP_BIND_MODE = normalize_mode_name(APP_BINDING.get("mode") or MODE_CONFIG.get("effectiveMode"))
APP_PORT = int(APP_BINDING.get("port") or APP_PORT)
LOCAL_PANEL_URL = f"http://127.0.0.1:{APP_PORT}"
APP_PUBLIC_URL = str(APP_BINDING.get("url") or f"http://{APP_PUBLIC_HOST}:{APP_PORT}")
APP_HEALTH_URL = f"{LOCAL_PANEL_URL}/health"


def resolve_tailscale_path() -> Path:
    configured = os.environ.get("MOBILE_CODEX_TAILSCALE")
    if configured:
        return Path(configured)
    return Path(r"C:\Program Files\Tailscale\tailscale.exe")


def resolve_ascii_alias_path() -> Path:
    configured = os.environ.get("MOBILE_CODEX_ASCII_ALIAS")
    if configured:
        return Path(configured)

    return WORKSPACE.parent / "mobileCodexHelper_ascii"


ASCII_ALIAS_PATH = resolve_ascii_alias_path()
TAILSCALE = resolve_tailscale_path()
NGINX_ACCESS_LOG = ASCII_ALIAS_PATH / ".runtime" / "nginx" / "logs" / "mobile-codex.access.log"
NGINX_ERROR_LOG = ASCII_ALIAS_PATH / ".runtime" / "nginx" / "logs" / "mobile-codex.error.log"


def inspect_auth_db(path: Path) -> tuple[int, set[str]]:
    if not path.exists():
        return -1, set()

    try:
        connection = sqlite3.connect(path)
        try:
            tables = {
                row[0]
                for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
            score = 0
            if "users" in tables:
                score += 1
            if "trusted_devices" in tables:
                score += 3
            if "device_approval_requests" in tables:
                score += 3
            if "users" in tables:
                user_count = connection.execute("SELECT COUNT(*) FROM users").fetchone()[0]
                if user_count:
                    score += 2
            return score, tables
        finally:
            connection.close()
    except sqlite3.Error:
        return -1, set()


def resolve_auth_db_path() -> Path:
    candidates = []
    env_database_path = os.environ.get("DATABASE_PATH")
    if env_database_path:
        candidates.append(Path(env_database_path))

    candidates.extend(
        [
            WORKSPACE / ".runtime" / "auth.db",
            WORKSPACE / "vendor" / "claudecodeui-1.25.2" / "server" / "database" / "auth.db",
            Path.home() / ".cloudcli" / "auth.db",
            Path.home() / ".codex" / "auth.db",
        ]
    )

    best_path = candidates[0]
    best_score = -1
    seen: set[str] = set()
    for candidate in candidates:
        normalized = str(candidate.resolve()) if candidate.exists() else str(candidate)
        if normalized in seen:
            continue
        seen.add(normalized)
        score, _tables = inspect_auth_db(candidate)
        if score > best_score:
            best_path = candidate
            best_score = score

    return best_path


AUTH_DB_PATH = resolve_auth_db_path()


@dataclass
class StatusBlock:
    label: str
    ok: bool
    headline: str
    detail: str
    level: str = "error"

    def to_dict(self) -> dict[str, Any]:
        return {
            "label": self.label,
            "ok": self.ok,
            "headline": self.headline,
            "detail": self.detail,
            "level": self.level,
        }


@dataclass
class ListenerInfo:
    port: int
    pid: int
    name: str
    path: str

    def summary(self) -> str:
        parts = [f"端口 {self.port}", f"PID {self.pid}"]
        if self.name:
            parts.append(self.name)
        return " | ".join(parts)


def ensure_stdio_utf8() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream and hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except ValueError:
                pass


ensure_stdio_utf8()


def now_local() -> datetime:
    return datetime.now().astimezone()


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.year <= 1:
            return None
        return parsed
    except ValueError:
        return None


def format_datetime(value: str | None) -> str:
    dt = parse_datetime(value)
    if not dt:
        return "暂无"
    return dt.astimezone().strftime("%Y-%m-%d %H:%M:%S")


def minutes_since(value: str | None) -> float | None:
    dt = parse_datetime(value)
    if not dt:
        return None
    return (now_local() - dt.astimezone()).total_seconds() / 60


def format_age_text(value: str | None) -> str:
    delta = minutes_since(value)
    if delta is None:
        return "时间未知"
    if delta < 1:
        return "刚刚"
    return f"{int(delta)} 分钟前"


def redacted_label(prefix: str, index: int) -> str:
    return f"{prefix}-{index}"


def redact_ip(value: str | None, index: int | None = None) -> str:
    if not value:
        return "redacted-ip"
    return redacted_label("ip", index or 1)


def redact_host(value: str | None, index: int | None = None) -> str:
    if not value:
        return "redacted-host"
    return redacted_label("host", index or 1)


def redact_device_id(value: str | None, index: int | None = None) -> str:
    if not value:
        return "redacted-device"
    return redacted_label("device", index or 1)


def redact_username(value: str | None, index: int | None = None) -> str:
    if not value:
        return "redacted-user"
    return redacted_label("user", index or 1)


def redact_user_agent(value: str | None) -> str:
    if not value:
        return "redacted-user-agent"
    return "redacted-user-agent"


def redact_path(value: str | None, index: int | None = None) -> str:
    if not value:
        return "redacted-path"
    return redacted_label("path", index or 1)


def redact_url(value: str | None, index: int | None = None) -> str | None:
    if not value:
        return value

    try:
        parsed = urllib.parse.urlparse(str(value))
    except ValueError:
        return f"https://{redacted_label('host', index or 1)}"

    scheme = parsed.scheme or "https"
    host = redacted_label("host", index or 1)
    port = f":{parsed.port}" if parsed.port else ""
    path = parsed.path or ""
    return f"{scheme}://{host}{port}{path}"


def load_desktop_approval_bridge_status() -> dict[str, Any]:
    status = {
        "active": False,
        "enabled_at": None,
        "enabled_until": None,
        "detail": "Remote desktop approvals are available, but currently disabled on this computer.",
        "headline": "Ready, computer opt-in required",
        "level": "warning",
    }

    if not BRIDGE_WINDOW_PATH.exists():
        return status

    try:
        payload = json.loads(BRIDGE_WINDOW_PATH.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        status["detail"] = f"Bridge window file is unreadable: {BRIDGE_WINDOW_PATH}"
        status["headline"] = "Bridge window error"
        status["level"] = "error"
        return status

    enabled_at = str(payload.get("enabledAt") or "") or None
    enabled_until = str(payload.get("enabledUntil") or "") or None
    expires_at = parse_datetime(enabled_until) if enabled_until else None
    active = bool(expires_at and expires_at > now_local())

    status["active"] = active
    status["enabled_at"] = enabled_at
    status["enabled_until"] = enabled_until

    if active:
        status["headline"] = "Enabled"
        status["detail"] = (
            f"Remote desktop approvals stay enabled until {format_datetime(enabled_until)}."
            if enabled_until
            else "Remote desktop approvals are enabled."
        )
        status["level"] = "success"
    else:
        status["headline"] = "Expired"
        status["detail"] = (
            f"Remote desktop approval window expired at {format_datetime(enabled_until)}."
            if enabled_until
            else status["detail"]
        )
        status["level"] = "warning"

    return status


def is_recent(value: str | None, minutes: int = PHONE_ACTIVITY_WINDOW_MINUTES) -> bool:
    delta = minutes_since(value)
    return delta is not None and delta <= minutes


def summarize_connection_error(message: str) -> str:
    if "10061" in message:
        return "端口未监听，服务未启动"
    return message


def subprocess_window_options() -> dict[str, Any]:
    if sys.platform != "win32":
        return {}
    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = 0
    return {
        "creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0),
        "startupinfo": startupinfo,
    }


def run_command(args: list[str], timeout: int = 20) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
        cwd=str(WORKSPACE),
        **subprocess_window_options(),
    )


def wait_for(predicate: Callable[[], bool], timeout: float, interval: float = 1.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()


def powershell_file(
    script_name: str,
    timeout: int = 60,
    arguments: list[str] | None = None,
) -> subprocess.CompletedProcess[str]:
    script_path = SCRIPTS_DIR / script_name
    command = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script_path),
    ]
    if arguments:
        command.extend(arguments)
    return run_command(command, timeout=timeout)


def run_powershell_json(command: str, timeout: int = 12) -> Any | None:
    try:
        result = run_command(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                command,
            ],
            timeout=timeout,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0:
        return None
    text = result.stdout.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def http_health(url: str, timeout: float = 2.5) -> tuple[bool, str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body = response.read(200).decode("utf-8", errors="replace")
            return True, f"{response.status} {response.reason} | {body[:80]}"
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code} {exc.reason}"
    except Exception as exc:  # noqa: BLE001
        return False, summarize_connection_error(str(exc))


def is_port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.8) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        return sock.connect_ex((host, port)) == 0


def normalize_dns_name(value: str | None) -> str | None:
    if not value:
        return None
    return value[:-1] if value.endswith(".") else value


def is_loopback_host(host: str | None) -> bool:
    if not host:
        return True
    return host.strip().lower() in {"127.0.0.1", "localhost", "::1", "0.0.0.0"}


def parse_nginx_timestamp(value: str) -> str | None:
    match = re.match(
        r"^(?P<day>\d{2})/(?P<month>[A-Za-z]{3})/(?P<year>\d{4}):"
        r"(?P<hour>\d{2}):(?P<minute>\d{2}):(?P<second>\d{2}) (?P<offset>[+-]\d{4})$",
        value,
    )
    if not match:
        return None
    month = NGINX_MONTHS.get(match.group("month"))
    if month is None:
        return None
    offset = match.group("offset")
    iso = (
        f"{match.group('year')}-{month:02d}-{match.group('day')}T"
        f"{match.group('hour')}:{match.group('minute')}:{match.group('second')}"
        f"{offset[:3]}:{offset[3:]}"
    )
    try:
        return datetime.fromisoformat(iso).isoformat()
    except ValueError:
        return None


def get_listener_map(ports: list[int] | None = None) -> dict[int, ListenerInfo]:
    target_ports = ports or [APP_PORT, PROXY_PORT]
    ports_literal = ",".join(str(port) for port in target_ports)
    command = f"""
$ports = @({ports_literal})
$listeners = foreach ($item in Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue) {{
    $proc = Get-Process -Id $item.OwningProcess -ErrorAction SilentlyContinue
    [PSCustomObject]@{{
        port = [int]$item.LocalPort
        pid = [int]$item.OwningProcess
        name = if ($proc) {{ $proc.ProcessName }} else {{ '' }}
        path = if ($proc -and $proc.Path) {{ $proc.Path }} else {{ '' }}
    }}
}}
if ($listeners) {{
    $listeners | ConvertTo-Json -Compress
}}
"""
    data = run_powershell_json(command)
    items = [data] if isinstance(data, dict) else data if isinstance(data, list) else []
    if not items:
        result = run_command(["netstat", "-ano", "-p", "tcp"], timeout=6)
        if result.returncode == 0:
            target_port_set = {int(port) for port in target_ports}
            for line in result.stdout.splitlines():
                match = re.match(
                    r"^\s*TCP\s+\S+:(?P<port>\d+)\s+\S+\s+LISTENING\s+(?P<pid>\d+)\s*$",
                    line,
                    re.IGNORECASE,
                )
                if not match:
                    continue
                port = int(match.group("port"))
                if port not in target_port_set:
                    continue
                items.append(
                    {
                        "port": port,
                        "pid": int(match.group("pid")),
                        "name": "",
                        "path": "",
                    }
                )

    listener_map: dict[int, ListenerInfo] = {}
    for item in items:
        try:
            port = int(item.get("port"))
            listener_map[port] = ListenerInfo(
                port=port,
                pid=int(item.get("pid")),
                name=str(item.get("name") or ""),
                path=str(item.get("path") or ""),
            )
        except (TypeError, ValueError):
            continue
    return listener_map


def describe_listener(listener: ListenerInfo | None) -> str:
    if not listener:
        return "端口未监听"
    return listener.summary()


def describe_service(health_ok: bool, health_detail: str, listener: ListenerInfo | None) -> str:
    listener_text = describe_listener(listener)
    if health_ok:
        return f"{listener_text} | {health_detail}" if listener else health_detail
    if listener:
        return f"{listener_text} | 健康检查未通过：{health_detail}"
    return health_detail


def normalize_remote_health_detail(detail: str) -> str:
    lowered = detail.lower()
    if "handshake operation timed out" in lowered or "timed out" in lowered:
        return "本机自检超时，手机端可能仍可访问"
    if "10061" in detail:
        return "远程入口未监听"
    return f"本机自检失败：{detail}"


def parse_remote_target_port(target: str | None) -> int | None:
    if not target:
        return None
    try:
        target_text = str(target).strip()
        parsed = urllib.parse.urlparse(target_text if "://" in target_text else f"http://{target_text}")
        return parsed.port
    except ValueError:
        return None


def format_remote_url(host: str, port: int) -> str:
    scheme = "https" if port == 443 else "http"
    if (scheme == "https" and port == 443) or (scheme == "http" and port == 80):
        return f"{scheme}://{host}"
    return f"{scheme}://{host}:{port}"


def parse_https_publication_status(status_text: str | None) -> dict[str, Any]:
    if not status_text:
        return {
            "url": None,
            "visibility": "localhost",
            "requires_tailscale_client": None,
        }

    for raw_line in status_text.splitlines():
        line = raw_line.strip()
        if not line.startswith("https://"):
            continue

        match = re.match(r"^(https://[^\s]+)(?:\s+\(([^)]+)\))?$", line)
        if not match:
            continue

        label = (match.group(2) or "").strip().lower()
        tailnet_only = "tailnet only" in label
        return {
            "url": match.group(1).rstrip("/"),
            "visibility": "tailnet-private" if tailnet_only else "public-funnel",
            "requires_tailscale_client": tailnet_only,
        }

    return {
        "url": None,
        "visibility": "localhost",
        "requires_tailscale_client": None,
    }


def remote_endpoint_priority(endpoint: dict[str, Any]) -> tuple[int, int]:
    port = int(endpoint["port"])
    if port == 443:
        return (0, port)
    if port == REMOTE_FALLBACK_PORT:
        return (1, port)
    if port == 80:
        return (3, port)
    return (2, port)


def build_remote_endpoints(serve_data: dict[str, Any], fallback_dns: str | None) -> list[dict[str, Any]]:
    endpoints: list[dict[str, Any]] = []
    for host_and_port, config in ((serve_data or {}).get("Web") or {}).items():
        raw = str(host_and_port)
        host, separator, port_text = raw.rpartition(":")
        if not separator or not port_text.isdigit():
            continue
        display_host = host or fallback_dns
        if not display_host:
            continue
        port = int(port_text)
        target = (((config or {}).get("Handlers") or {}).get("/") or {}).get("Proxy")
        endpoints.append(
            {
                "host": display_host,
                "port": port,
                "target": target,
                "url": format_remote_url(display_host, port),
            }
        )

    endpoints.sort(key=remote_endpoint_priority)
    return endpoints


def summarize_remote_urls(remote: dict[str, Any], *, show_sensitive: bool = False) -> str:
    parts: list[str] = []
    primary = remote.get("primary_url")
    fallback = remote.get("fallback_url")
    if primary:
        parts.append(f"Primary: {primary if show_sensitive else redact_url(primary, 1)}")
    if fallback and fallback != primary:
        parts.append(f"Fallback: {fallback if show_sensitive else redact_url(fallback, 2)}")
    visibility = str(remote.get("visibility") or "").strip().lower()
    if visibility == "public-funnel":
        parts.append("Mode: PUBLIC INTERNET ENTRYPOINT via Tailscale Funnel")
    elif visibility == "tailnet-private":
        parts.append("Mode: tailnet-private via Tailscale Serve HTTPS")
    elif visibility == "legacy-direct":
        parts.append("Mode: legacy-direct (deprecated)")
    else:
        parts.append("Mode: localhost")
    return " | ".join(parts)


def is_public_remote_publish(remote: dict[str, Any]) -> bool:
    visibility = str(remote.get("visibility") or "").strip().lower()
    return bool(remote.get("published")) and visibility == "public-funnel" and not bool(
        remote.get("requires_tailscale_client")
    )


"""
def build_remote_block_v2(remote: dict[str, Any], app_ok: bool, target_ok: bool) -> tuple[StatusBlock, dict[str, Any]]:
    if not remote["published"]:
        block = StatusBlock("杩滅▼鍙戝竷", False, "鏈紑鍚?, "杩滅▼鍙戝竷鏈紑鍚?, "error")
        return block, {"value": "鏈紑鍚?, "detail": block.detail, "level": "error"}

    route_text = summarize_remote_urls(remote)
    if not app_ok or not target_ok:
        detail = f"{route_text} | 宸插彂甯冿紝浣嗘湰鍦版湇鍔℃湭鍚姩" if route_text else "宸插彂甯冿紝浣嗘湰鍦版湇鍔℃湭鍚姩"
        block = StatusBlock("杩滅▼鍙戝竷", False, "宸插彂甯冿紝寰呮湇鍔″惎鍔?, detail, "warning")
        return block, {"value": "宸插彂甯?, "detail": detail, "level": "warning"}

    if remote["health_ok"]:
        detail = f"{route_text} | 杩滅▼鍋ュ悍姝ｅ父" if route_text else remote["detail"]
        block = StatusBlock("杩滅▼鍙戝竷", True, "鍙闂?, detail, "success")
        return block, {"value": "鍙闂?, "detail": detail, "level": "success"}

    health_summary = normalize_remote_health_detail(remote["health_detail"])
    detail = f"{route_text} | {health_summary}" if route_text else health_summary
    block = StatusBlock("杩滅▼鍙戝竷", True, "宸插彂甯冿紝寰呴獙璇?, detail, "warning")
    return block, {"value": "宸插彂甯?, "detail": detail, "level": "warning"}


def build_remote_status_v2(tailscale_status: dict[str, Any], serve_status: dict[str, Any]) -> dict[str, Any]:
    serve_data = serve_status.get("data") if serve_status.get("ok") else {}
    tailscale_data = tailscale_status.get("data") if tailscale_status.get("ok") else {}
    funnel_status = load_funnel_status_text()
    publication = parse_https_publication_status(funnel_status.get("data") if funnel_status.get("ok") else None)
    fallback_dns = normalize_dns_name((((tailscale_data or {}).get("Self") or {}).get("DNSName")))
    endpoints = build_remote_endpoints(serve_data or {}, fallback_dns)
    if not endpoints:
        return {
            "published": False,
            "url": None,
            "primary_url": None,
            "fallback_url": None,
            "target": None,
            "detail": "杩滅▼鍙戝竷鏈紑鍚?,
            "health_ok": False,
            "health_detail": "鏈墽琛岃繙绋嬪仴搴锋鏌?,
        }

    primary_endpoint = endpoints[0]
    fallback_endpoint = next((endpoint for endpoint in endpoints if endpoint["port"] == REMOTE_FALLBACK_PORT), None)
    target = primary_endpoint.get("target")
    verified_url: str | None = None
    health_ok = False
    health_detail = "鏈墽琛岃繙绋嬪仴搴锋鏌?
    probe_candidates = []
    if fallback_endpoint:
        probe_candidates.append(fallback_endpoint)
    probe_candidates.extend(
        endpoint
        for endpoint in endpoints
        if endpoint.get("port") not in {80, REMOTE_FALLBACK_PORT}
    )
    for endpoint in probe_candidates:
        probe_url = endpoint["url"]
        health_ok, health_detail = http_health(f"{probe_url}/health", timeout=2.5)
        if health_ok:
            verified_url = probe_url
            break

    recommended_url = verified_url or (fallback_endpoint["url"] if fallback_endpoint else primary_endpoint["url"])
    return {
        "published": True,
        "url": recommended_url,
        "primary_url": primary_endpoint["url"],
        "fallback_url": fallback_endpoint["url"] if fallback_endpoint else None,
        "target": target,
        "detail": f"宸插彂甯冨埌 {target}" if target else "杩滅▼鍙戝竷宸插紑鍚?,
        "health_ok": health_ok,
        "health_detail": health_detail,
    }


"""


def build_remote_block_v2(
    remote: dict[str, Any],
    current_mode: str,
    app_ok: bool,
    target_ok: bool,
    *,
    show_sensitive: bool = False,
) -> tuple[StatusBlock, dict[str, Any]]:
    visibility = normalize_mode_name(remote.get("visibility") or current_mode)
    if not remote["published"]:
        if visibility == "localhost":
            block = StatusBlock("Mode", True, "localhost", "Default localhost-only mode is active.", "success")
            return block, {"value": "localhost", "detail": block.detail, "level": "success"}

        block = StatusBlock("Mode", False, visibility, "No published entrypoint is active for the selected mode.", "warning")
        return block, {"value": visibility, "detail": block.detail, "level": "warning"}

    route_text = summarize_remote_urls(remote, show_sensitive=show_sensitive)
    if not app_ok or not target_ok:
        detail = f"{route_text} | Published, but the local target is not healthy." if route_text else "Published, but the local target is not healthy."
        block = StatusBlock("Mode", False, visibility, detail, "warning")
        return block, {"value": visibility, "detail": detail, "level": "warning"}

    if visibility == "legacy-direct":
        detail = f"{route_text} | Legacy direct binding is deprecated and outside the default boundary."
        block = StatusBlock("Mode", True, "legacy-direct", detail, "warning")
        return block, {"value": "legacy-direct", "detail": detail, "level": "warning"}

    if visibility == "tailnet-private":
        tailnet_detail = "tailnet-private is active. The phone must stay on the same tailnet, and Funnel must remain disabled."
        if remote["health_ok"]:
            detail = f"{route_text} | {tailnet_detail}" if route_text else tailnet_detail
            block = StatusBlock("Mode", True, "tailnet-private", detail, "success")
            return block, {"value": "tailnet-private", "detail": detail, "level": "success"}

        health_summary = normalize_remote_health_detail(remote["health_detail"])
        detail_parts = [part for part in (route_text, tailnet_detail, health_summary) if part]
        detail = " | ".join(detail_parts)
        block = StatusBlock("Mode", True, "tailnet-private", detail, "warning")
        return block, {"value": "tailnet-private", "detail": detail, "level": "warning"}

    if remote["health_ok"]:
        detail = f"{route_text} | PUBLIC INTERNET ENTRYPOINT active." if route_text else "PUBLIC INTERNET ENTRYPOINT active."
        block = StatusBlock("Mode", True, "public-funnel", detail, "warning")
        return block, {"value": "public-funnel", "detail": detail, "level": "warning"}

    health_summary = normalize_remote_health_detail(remote["health_detail"])
    detail = f"{route_text} | {health_summary}" if route_text else health_summary
    block = StatusBlock("Mode", True, "public-funnel", detail, "warning")
    return block, {"value": "public-funnel", "detail": detail, "level": "warning"}


def build_remote_status_v2(tailscale_status: dict[str, Any], serve_status: dict[str, Any]) -> dict[str, Any]:
    serve_data = serve_status.get("data") if serve_status.get("ok") else {}
    tailscale_data = tailscale_status.get("data") if tailscale_status.get("ok") else {}
    funnel_status = load_funnel_status_text()
    publication = parse_https_publication_status(funnel_status.get("data") if funnel_status.get("ok") else None)
    fallback_dns = normalize_dns_name((((tailscale_data or {}).get("Self") or {}).get("DNSName")))
    endpoints = build_remote_endpoints(serve_data or {}, fallback_dns)
    if not endpoints:
        return {
            "published": False,
            "url": None,
            "primary_url": None,
            "fallback_url": None,
            "target": None,
            "detail": "Tailscale Serve is not enabled.",
            "health_ok": False,
            "health_detail": "Remote self-check not run.",
            "visibility": publication["visibility"],
            "requires_tailscale_client": publication["requires_tailscale_client"],
        }

    primary_endpoint = endpoints[0]
    fallback_endpoint = next((endpoint for endpoint in endpoints if endpoint["port"] == REMOTE_FALLBACK_PORT), None)
    target = primary_endpoint.get("target")
    verified_url: str | None = None
    health_ok = False
    health_detail = "Remote self-check not run."
    probe_candidates = []
    if fallback_endpoint:
        probe_candidates.append(fallback_endpoint)
    probe_candidates.extend(
        endpoint
        for endpoint in endpoints
        if endpoint.get("port") not in {80, REMOTE_FALLBACK_PORT}
    )
    for endpoint in probe_candidates:
        probe_url = endpoint["url"]
        health_ok, health_detail = http_health(f"{probe_url}/health", timeout=2.5)
        if health_ok:
            verified_url = probe_url
            break

    recommended_url = (
        publication["url"]
        or verified_url
        or (fallback_endpoint["url"] if fallback_endpoint else primary_endpoint["url"])
    )
    return {
        "published": True,
        "url": recommended_url,
        "primary_url": publication["url"] or primary_endpoint["url"],
        "fallback_url": fallback_endpoint["url"] if fallback_endpoint else None,
        "target": target,
        "detail": f"Published to {target}" if target else "Remote publish is enabled.",
        "health_ok": health_ok,
        "health_detail": health_detail,
        "visibility": publication["visibility"],
        "requires_tailscale_client": publication["requires_tailscale_client"],
    }


def build_remote_block(remote: dict[str, Any], app_ok: bool, proxy_ok: bool) -> tuple[StatusBlock, dict[str, Any]]:
    if not remote["published"]:
        block = StatusBlock("远程发布", False, "未开启", "远程发布未开启", "error")
        return block, {"value": "未开启", "detail": block.detail, "level": "error"}

    target_port = parse_remote_target_port(remote.get("target"))
    target_label = (
        "PC 应用服务"
        if target_port in (None, APP_PORT)
        else "nginx 代理"
        if target_port == PROXY_PORT
        else f"本地端口 {target_port}"
    )

    if not app_ok or not proxy_ok:
        detail = f"{remote['url']} | 已发布，但本地服务未启动" if remote["url"] else "已发布，但本地服务未启动"
        block = StatusBlock("远程发布", False, "已发布，待服务启动", detail, "warning")
        return block, {"value": "已发布", "detail": detail, "level": "warning"}

    if remote["health_ok"]:
        detail = f"{remote['url']} | 远程健康正常" if remote["url"] else remote["detail"]
        block = StatusBlock("远程发布", True, "可访问", detail, "success")
        return block, {"value": "可访问", "detail": detail, "level": "success"}

    health_summary = normalize_remote_health_detail(remote["health_detail"])
    detail = f"{remote['url']} | {health_summary}" if remote["url"] else health_summary
    block = StatusBlock("远程发布", True, "已发布，待验证", detail, "warning")
    return block, {"value": "已发布", "detail": detail, "level": "warning"}


def load_tailscale_status() -> dict[str, Any]:
    if not TAILSCALE.exists():
        return {"ok": False, "error": f"Tailscale CLI 未找到：{TAILSCALE}"}
    result = run_command([str(TAILSCALE), "status", "--json"])
    if result.returncode != 0:
        return {"ok": False, "error": result.stderr.strip() or result.stdout.strip() or "读取 Tailscale 状态失败"}
    try:
        return {"ok": True, "data": json.loads(result.stdout)}
    except json.JSONDecodeError as exc:
        return {"ok": False, "error": f"Tailscale 返回的 JSON 无法解析: {exc}"}


def load_serve_status() -> dict[str, Any]:
    if not TAILSCALE.exists():
        return {"ok": False, "error": f"Tailscale CLI 未找到：{TAILSCALE}"}
    result = run_command([str(TAILSCALE), "serve", "status", "--json"])
    if result.returncode != 0:
        return {"ok": False, "error": result.stderr.strip() or result.stdout.strip() or "读取远程发布状态失败"}
    try:
        return {"ok": True, "data": json.loads(result.stdout)}
    except json.JSONDecodeError as exc:
        return {"ok": False, "error": f"远程发布状态 JSON 无法解析: {exc}"}


def load_funnel_status_text() -> dict[str, Any]:
    if not TAILSCALE.exists():
        return {"ok": False, "error": f"Tailscale CLI 未找到：{TAILSCALE}"}
    result = run_command([str(TAILSCALE), "funnel", "status"])
    if result.returncode != 0:
        return {"ok": False, "error": result.stderr.strip() or result.stdout.strip() or "读取 Funnel 状态失败"}
    return {"ok": True, "data": result.stdout}


def build_remote_status(tailscale_status: dict[str, Any], serve_status: dict[str, Any]) -> dict[str, Any]:
    serve_data = serve_status.get("data") if serve_status.get("ok") else {}
    web_entries = list((serve_data or {}).get("Web", {}).items())
    if not web_entries:
        return {
            "published": False,
            "url": None,
            "target": None,
            "detail": "远程发布未开启",
            "health_ok": False,
            "health_detail": "未执行远程健康检查",
        }

    host_and_port, config = web_entries[0]
    host = str(host_and_port).replace(":443", "")
    target = (((config or {}).get("Handlers") or {}).get("/") or {}).get("Proxy")
    tailscale_data = tailscale_status.get("data") if tailscale_status.get("ok") else {}
    fallback_dns = normalize_dns_name((((tailscale_data or {}).get("Self") or {}).get("DNSName")))
    url = f"https://{host or fallback_dns}" if (host or fallback_dns) else None
    health_ok = False
    health_detail = "未执行远程健康检查"
    if url:
        health_ok, health_detail = http_health(f"{url}/health", timeout=2.5)
    return {
        "published": True,
        "url": url,
        "target": target,
        "detail": f"已发布到 {target}" if target else "远程发布已开启",
        "health_ok": health_ok,
        "health_detail": health_detail,
    }


def pick_mobile_display_name(peer: dict[str, Any]) -> str:
    host_name = str(peer.get("HostName") or "").strip()
    dns_name = normalize_dns_name(peer.get("DNSName")) or ""
    tail_ip = (peer.get("TailscaleIPs") or [""])[0]
    if host_name and host_name.lower() != "localhost":
        return host_name
    if dns_name:
        return dns_name
    if tail_ip:
        return tail_ip
    return "未命名手机"


def extract_mobile_peers(tailscale_status: dict[str, Any]) -> list[dict[str, Any]]:
    if not tailscale_status.get("ok"):
        return []
    peers = []
    for peer_id, peer in (tailscale_status["data"].get("Peer") or {}).items():
        os_name = str(peer.get("OS") or "").lower()
        if os_name not in MOBILE_OS:
            continue
        peers.append(
            {
                "id": peer_id,
                "display_name": pick_mobile_display_name(peer),
                "host_name": peer.get("HostName") or "",
                "dns_name": normalize_dns_name(peer.get("DNSName")) or "",
                "os": os_name,
                "online": bool(peer.get("Online")),
                "active": bool(peer.get("Active")),
                "last_handshake": peer.get("LastHandshake") or "",
                "last_seen": peer.get("LastSeen") or "",
                "tail_ip": (peer.get("TailscaleIPs") or [""])[0],
                "relay": peer.get("Relay") or "",
            }
        )
    peers.sort(key=lambda item: (not item["online"], not item["active"], item["display_name"]))
    return peers


def tail_lines(file_path: Path, max_lines: int = 200) -> list[str]:
    if not file_path.exists():
        return []
    lines: deque[str] = deque(maxlen=max_lines)
    with file_path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            stripped = line.rstrip()
            if stripped:
                lines.append(stripped)
    return list(lines)


def recent_mobile_requests(limit: int = 6) -> list[dict[str, Any]]:
    pattern = re.compile(
        r'^(?P<ip>\S+) - \S+ \[(?P<time>[^\]]+)\] "(?P<method>\S+) (?P<path>\S+) [^"]+" '
        r'(?P<status>\d{3}) (?P<bytes>\d+) "(?P<referrer>[^"]*)" "(?P<ua>.*)"$'
    )
    parsed: list[dict[str, Any]] = []
    for line in tail_lines(NGINX_ACCESS_LOG):
        match = pattern.match(line)
        if not match:
            continue
        user_agent = match.group("ua")
        if not MOBILE_USER_AGENT.search(user_agent):
            continue
        parsed.append(
            {
                "ip": match.group("ip"),
                "time": parse_nginx_timestamp(match.group("time")) or match.group("time"),
                "method": match.group("method"),
                "path": match.group("path"),
                "status": int(match.group("status")),
                "user_agent": user_agent,
            }
        )
    parsed.sort(key=lambda item: str(item["time"]), reverse=True)

    unique: list[dict[str, Any]] = []
    seen = set()
    for item in parsed:
        key = (item["time"], item["method"], item["path"], item["status"], item["user_agent"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
        if len(unique) >= limit:
            break
    return unique


def tail_error_lines(limit: int = 8) -> list[str]:
    combined = []
    for label, path in (("后端", APP_STDERR_LOG), ("nginx", NGINX_ERROR_LOG)):
        lines = tail_lines(path, max_lines=40)
        interesting = [line for line in lines if re.search(r"error|warn|fail|502|trace|deprecat", line, re.I)]
        if interesting:
            combined.extend([f"[{label}] {line}" for line in interesting[-4:]])
    return combined[-limit:]


def read_json_list(file_path: Path) -> list[dict[str, Any]]:
    if not file_path.exists():
        return []

    try:
        raw = json.loads(file_path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return []

    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]

    return []


def read_json_object(file_path: Path) -> dict[str, Any]:
    if not file_path.exists():
        return {}

    try:
        raw = json.loads(file_path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return {}

    return raw if isinstance(raw, dict) else {}


def coerce_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    return bool(value)


def coerce_positive_int(value: Any, default: int) -> int:
    try:
        converted = int(value)
    except (TypeError, ValueError):
        return default
    return converted if converted > 0 else default


def auto_start_defaults(mode_config: dict[str, Any] | None = None) -> dict[str, Any]:
    config_source = mode_config or load_mode_config()
    persistent_public = (
        normalize_mode_name(config_source.get("requestedMode")) == "public-funnel"
        and bool(config_source.get("persistentRemotePublish"))
    )
    return {
        "enabled": True,
        "startupDelaySeconds": 45,
        "watchdogIntervalMinutes": 5,
        "ensureRemotePublish": persistent_public,
        "restartCooldownSeconds": 120,
        "preserveKnownPublicBinding": False,
    }


def load_auto_start_metadata() -> dict[str, Any]:
    mode_config = load_mode_config()
    defaults = auto_start_defaults(mode_config)
    raw_config = read_json_object(AUTO_START_CONFIG_PATH)
    raw_state = read_json_object(AUTO_START_STATE_PATH)

    config = {
        "enabled": coerce_bool(raw_config.get("enabled"), defaults["enabled"]),
        "startupDelaySeconds": coerce_positive_int(raw_config.get("startupDelaySeconds"), defaults["startupDelaySeconds"]),
        "watchdogIntervalMinutes": coerce_positive_int(
            raw_config.get("watchdogIntervalMinutes"), defaults["watchdogIntervalMinutes"]
        ),
        "ensureRemotePublish": coerce_bool(raw_config.get("ensureRemotePublish"), defaults["ensureRemotePublish"]),
        "restartCooldownSeconds": coerce_positive_int(
            raw_config.get("restartCooldownSeconds"), defaults["restartCooldownSeconds"]
        ),
        "preserveKnownPublicBinding": coerce_bool(
            raw_config.get("preserveKnownPublicBinding"), defaults["preserveKnownPublicBinding"]
        ),
    }

    state = {
        "lastRunAt": raw_state.get("lastRunAt"),
        "lastResult": str(raw_state.get("lastResult") or "not-run"),
        "lastAction": str(raw_state.get("lastAction") or "not-run"),
        "lastError": str(raw_state.get("lastError") or "").strip() or None,
        "appHealthy": raw_state.get("appHealthy"),
        "remoteIntent": coerce_bool(raw_state.get("remoteIntent"), config["ensureRemotePublish"]),
        "trigger": raw_state.get("trigger"),
    }

    return {
        "installed": AUTO_START_CONFIG_PATH.exists(),
        "config": config,
        "state": state,
    }


def load_runtime_diagnostics() -> dict[str, Any]:
    connectivity_events = read_json_list(CONNECTIVITY_EVENTS_PATH)
    sync_events = read_json_list(SYNC_EVENTS_PATH)
    sync_snapshots = read_json_list(SYNC_SNAPSHOTS_PATH)

    ws_recent_disconnects = 0
    cutoff = time.time() - (PHONE_ACTIVITY_WINDOW_MINUTES * 60)
    for event in connectivity_events:
        timestamp_value = event.get("timestamp")
        try:
            event_ts = datetime.fromisoformat(str(timestamp_value).replace("Z", "+00:00")).timestamp()
        except ValueError:
            continue
        if event_ts >= cutoff and event.get("event") == "ws_close":
            ws_recent_disconnects += 1

    last_successful_mobile_sync = next(
        (
            snapshot for snapshot in reversed(sync_snapshots)
            if snapshot.get("surface") == "mobile" and snapshot.get("inSync") is True
        ),
        None,
    )
    last_sync_divergence = next(
        (
            snapshot for snapshot in reversed(sync_snapshots)
            if snapshot.get("inSync") is False
        ),
        None,
    )
    if not last_sync_divergence:
        last_sync_divergence = next(
            (
                event for event in reversed(sync_events)
                if event.get("event") == "sync_divergence_detected"
            ),
            None,
        )

    return {
        "connectivity_events": connectivity_events,
        "sync_events": sync_events,
        "sync_snapshots": sync_snapshots,
        "ws_recent_disconnects": ws_recent_disconnects,
        "last_successful_mobile_sync": last_successful_mobile_sync,
        "last_sync_divergence": last_sync_divergence,
    }


def open_auth_db() -> sqlite3.Connection:
    connection = sqlite3.connect(AUTH_DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def list_pending_device_approvals(limit: int = 20) -> list[dict[str, Any]]:
    if not AUTH_DB_PATH.exists():
        return []

    try:
        with open_auth_db() as connection:
            rows = connection.execute(
                """
                SELECT
                    dar.request_token,
                    dar.device_id,
                    dar.device_name,
                    dar.platform,
                    dar.app_type,
                    dar.approval_kind,
                    dar.device_key_thumbprint,
                    dar.requested_ip,
                    dar.requested_user_agent,
                    dar.created_at,
                    u.username
                FROM device_approval_requests dar
                LEFT JOIN users u ON u.id = dar.user_id
                WHERE dar.status = 'pending'
                ORDER BY dar.created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
    except sqlite3.OperationalError:
        return []

    approvals = []
    for row in rows:
        item = dict(row)
        item["display_name"] = item.get("device_name") or item.get("device_id") or "未命名设备"
        approvals.append(item)
    return approvals


def list_approved_devices(limit: int = 50) -> list[dict[str, Any]]:
    if not AUTH_DB_PATH.exists():
        return []

    try:
        with open_auth_db() as connection:
            rows = connection.execute(
                """
                SELECT
                    td.device_id,
                    td.device_name,
                    td.platform,
                    td.app_type,
                    td.device_key_thumbprint,
                    td.key_registered_at,
                    td.first_approved_at,
                    td.last_seen,
                    td.last_login,
                    td.last_ip,
                    u.username
                FROM trusted_devices td
                LEFT JOIN users u ON u.id = td.user_id
                WHERE td.is_active = 1
                ORDER BY COALESCE(td.last_login, td.last_seen, td.first_approved_at) DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
    except sqlite3.OperationalError:
        return []

    devices = []
    for row in rows:
        item = dict(row)
        item["display_name"] = item.get("device_name") or item.get("device_id") or "未命名设备"
        devices.append(item)
    return devices


def resolve_device_request(request_token: str, approved: bool) -> bool:
    if not AUTH_DB_PATH.exists():
        return False

    try:
        with open_auth_db() as connection:
            row = connection.execute(
                """
                SELECT *
                FROM device_approval_requests
                WHERE request_token = ? AND status = 'pending'
                LIMIT 1
                """,
                (request_token,),
            ).fetchone()
            if row is None:
                return False

            if approved:
                connection.execute(
                    """
                    INSERT INTO trusted_devices (
                        user_id,
                        device_id,
                        device_name,
                        platform,
                        app_type,
                        device_public_key_spki,
                        device_key_thumbprint,
                        key_registered_at,
                        first_approved_at,
                        last_seen,
                        last_login,
                        last_ip,
                        last_user_agent,
                        is_active
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, 1)
                    ON CONFLICT(user_id, device_id)
                    DO UPDATE SET
                        device_name = excluded.device_name,
                        platform = excluded.platform,
                        app_type = excluded.app_type,
                        device_public_key_spki = COALESCE(excluded.device_public_key_spki, trusted_devices.device_public_key_spki),
                        device_key_thumbprint = COALESCE(excluded.device_key_thumbprint, trusted_devices.device_key_thumbprint),
                        key_registered_at = CASE
                            WHEN excluded.device_key_thumbprint IS NOT NULL THEN COALESCE(trusted_devices.key_registered_at, CURRENT_TIMESTAMP)
                            ELSE trusted_devices.key_registered_at
                        END,
                        last_seen = CURRENT_TIMESTAMP,
                        last_login = CURRENT_TIMESTAMP,
                        last_ip = excluded.last_ip,
                        last_user_agent = excluded.last_user_agent,
                        is_active = 1
                    """,
                    (
                        row["user_id"],
                        row["device_id"],
                        row["device_name"],
                        row["platform"],
                        row["app_type"],
                        row["device_public_key_spki"],
                        row["device_key_thumbprint"],
                        row["device_key_thumbprint"],
                        row["requested_ip"],
                        row["requested_user_agent"],
                    ),
                )

            connection.execute(
                f"""
                UPDATE device_approval_requests
                SET
                    status = ?,
                    updated_at = CURRENT_TIMESTAMP,
                    {"approved_at" if approved else "rejected_at"} = CURRENT_TIMESTAMP,
                    resolved_note = ?
                WHERE request_token = ? AND status = 'pending'
                """,
                ("approved" if approved else "rejected", "Desktop tool action", request_token),
            )
            connection.commit()
        return True
    except sqlite3.OperationalError:
        return False


def prepare_mobile_peers(
    peers: list[dict[str, Any]],
    *,
    show_sensitive: bool,
) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for index, peer in enumerate(peers, start=1):
        item = dict(peer)
        if not show_sensitive:
            item["display_name"] = redact_host(item.get("display_name"), index)
            item["tail_ip"] = redact_ip(item.get("tail_ip"), index)
        prepared.append(item)
    return prepared


def prepare_approved_devices(
    devices: list[dict[str, Any]],
    *,
    show_sensitive: bool,
) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for index, item in enumerate(devices, start=1):
        device = dict(item)
        device["has_device_key"] = bool(device.get("device_key_thumbprint"))
        if not show_sensitive:
            device["username"] = redact_username(device.get("username"), index)
            device["device_id"] = redact_device_id(device.get("device_id"), index)
            device["display_name"] = redact_device_id(device.get("display_name"), index)
            device["last_ip"] = redact_ip(device.get("last_ip"), index)
            device.pop("device_key_thumbprint", None)
        prepared.append(device)
    return prepared


def prepare_pending_device_approvals(
    approvals: list[dict[str, Any]],
    *,
    show_sensitive: bool,
    include_internal: bool,
) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for index, item in enumerate(approvals, start=1):
        approval = dict(item)
        approval["has_device_key"] = bool(approval.get("device_key_thumbprint"))
        if not include_internal:
            approval.pop("request_token", None)
        if not show_sensitive:
            approval["username"] = redact_username(approval.get("username"), index)
            approval["device_id"] = redact_device_id(approval.get("device_id"), index)
            approval["display_name"] = redact_device_id(approval.get("display_name"), index)
            approval["requested_ip"] = redact_ip(approval.get("requested_ip"), index)
            approval["requested_user_agent"] = redact_user_agent(approval.get("requested_user_agent"))
            approval.pop("device_key_thumbprint", None)
        prepared.append(approval)
    return prepared


def prepare_recent_mobile_requests(
    requests: list[dict[str, Any]],
    *,
    show_sensitive: bool,
) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for index, item in enumerate(requests, start=1):
        request = dict(item)
        if not show_sensitive:
            request["ip"] = redact_ip(request.get("ip"), index)
            request["user_agent"] = redact_user_agent(request.get("user_agent"))
        prepared.append(request)
    return prepared


def prepare_diagnostics(
    diagnostics: list[str],
    *,
    show_sensitive: bool,
) -> list[str]:
    if show_sensitive:
        return diagnostics

    prepared: list[str] = []
    for index, line in enumerate(diagnostics, start=1):
        text = str(line)
        text = re.sub(r"[A-Za-z]:\\Users\\[^\\\s]+(?:\\[^\\\s]+)*", redact_path(text, index), text)
        text = re.sub(r"(?:\d{1,3}\.){3}\d{1,3}", redact_ip(text, index), text)
        prepared.append(text)
    return prepared


def collect_status(*, show_sensitive: bool = False, include_internal: bool = False) -> dict[str, Any]:
    mode_config = load_mode_config()
    app_binding = load_app_binding()
    app_bind_mode = normalize_mode_name(app_binding.get("mode") or mode_config.get("effectiveMode"))
    app_public_host = str(app_binding.get("host") or "127.0.0.1")
    app_public_url = str(app_binding.get("url") or f"http://{app_public_host}:{APP_PORT}")

    listener_map = get_listener_map()
    app_listener = listener_map.get(APP_PORT)
    proxy_listener = listener_map.get(PROXY_PORT)
    proxy_required = app_bind_mode != "legacy-direct"

    app_ok, app_health_detail = http_health(APP_HEALTH_URL)
    proxy_ok, proxy_health_detail = http_health(PROXY_HEALTH_URL)
    app_detail = describe_service(app_ok, app_health_detail, app_listener)
    proxy_detail = describe_service(proxy_ok, proxy_health_detail, proxy_listener)
    if not proxy_required:
        proxy_detail = "Legacy direct binding is active; nginx is bypassed and this mode is deprecated."
    tailscale_status = load_tailscale_status()
    serve_status = load_serve_status()
    remote = build_remote_status_v2(tailscale_status, serve_status)
    binding_visibility = normalize_mode_name(app_binding.get("remote_visibility") or app_bind_mode)
    binding_url = str(app_binding.get("funnel_url") or app_binding.get("serve_url") or app_binding.get("url") or "").strip()
    binding_requires_tailscale = app_binding.get("requires_tailscale_client")
    if binding_visibility and binding_url:
        health_ok, health_detail = http_health(f"{binding_url.rstrip('/')}/health", timeout=2.5)
        remote = {
            "published": True,
            "url": binding_url,
            "primary_url": binding_url,
            "fallback_url": None,
            "target": binding_url,
            "detail": f"Runtime binding reports {binding_visibility}.",
            "health_ok": health_ok,
            "health_detail": health_detail,
            "visibility": binding_visibility,
            "requires_tailscale_client": bool(binding_requires_tailscale),
        }
    if not remote["published"] and app_bind_mode == "legacy-direct" and not is_loopback_host(app_public_host):
        remote = {
            "published": True,
            "url": app_public_url,
            "primary_url": app_public_url,
            "fallback_url": None,
            "target": app_public_url,
            "detail": "Legacy direct binding is active.",
            "health_ok": app_ok,
            "health_detail": app_health_detail,
            "visibility": "legacy-direct",
            "requires_tailscale_client": True,
        }
    remote_target_port = parse_remote_target_port(remote.get("target"))
    remote_target_ok = {
        APP_PORT: app_ok,
        PROXY_PORT: proxy_ok,
    }.get(remote_target_port, app_ok and proxy_ok)
    peers = prepare_mobile_peers(extract_mobile_peers(tailscale_status), show_sensitive=show_sensitive)
    approved_devices = prepare_approved_devices(list_approved_devices(), show_sensitive=show_sensitive)
    pending_approvals = prepare_pending_device_approvals(
        list_pending_device_approvals(),
        show_sensitive=show_sensitive,
        include_internal=include_internal,
    )
    desktop_bridge = load_desktop_approval_bridge_status()
    runtime_diagnostics = load_runtime_diagnostics()
    auto_start = load_auto_start_metadata()
    mobile_online = sum(1 for peer in peers if peer["online"])
    recent_requests = recent_mobile_requests()
    latest_request_time = recent_requests[0]["time"] if recent_requests else None
    recent_phone_activity = is_recent(latest_request_time)
    active_phone_websockets = sum(
        1 for request in recent_requests if request["path"] == "/ws" and request["status"] == 101 and is_recent(request["time"])
    )

    tailscale_data = tailscale_status.get("data") if tailscale_status.get("ok") else {}
    backend_state = (tailscale_data.get("BackendState") if tailscale_data else None) or "不可用"
    dns_name = normalize_dns_name((((tailscale_data or {}).get("Self") or {}).get("DNSName")))
    tailscale_error = str(tailscale_status.get("error") or "")
    tailscale_permission_blind = "Access is denied" in tailscale_error
    current_device = peers[0]["display_name"] if peers else "暂未发现手机设备"
    latest_activity_summary = (
        f"{recent_requests[0]['path']} · {format_datetime(latest_request_time)}"
        if recent_requests
        else "暂无手机访问记录"
    )
    mode_block, mode_summary = build_remote_block_v2(
        remote,
        app_bind_mode,
        True,
        remote_target_ok,
        show_sensitive=show_sensitive,
    )
    mode_available = remote["published"] and remote_target_ok

    tailscale_running = bool(tailscale_status.get("ok") and backend_state == "Running")
    tailscale_headline = "运行中" if tailscale_running else backend_state
    tailscale_detail = dns_name or tailscale_status.get("error", "未获取到域名")
    tailscale_level = "success" if tailscale_running else "error"
    if tailscale_permission_blind:
        tailscale_headline = "权限盲区"
        tailscale_detail = (
            "当前进程无权访问 tailscaled LocalAPI；请在提升权限的终端中复查。"
            if not tailscale_error
            else f"当前进程无权访问 tailscaled LocalAPI；原始错误：{tailscale_error}"
        )
        tailscale_level = "warning"

    auto_start_installed = bool(auto_start["installed"])
    auto_start_enabled = bool(auto_start["config"]["enabled"]) if auto_start_installed else False
    auto_start_last_result = str(auto_start["state"]["lastResult"])
    auto_start_last_error = auto_start["state"]["lastError"]
    auto_start_value = "未安装"
    auto_start_level = "warning"
    auto_start_detail_parts: list[str] = []
    if not auto_start_installed:
        auto_start_detail_parts.append("运行 install-mobile-codex-autostart.ps1 以启用登录后自启动。")
    else:
        auto_start_value = "已启用" if auto_start_enabled else "已停用"
        auto_start_detail_parts.extend(
            [
                f"登录后 {auto_start['config']['startupDelaySeconds']}s",
                f"看门狗 {auto_start['config']['watchdogIntervalMinutes']}m",
            ]
        )
        if auto_start["state"]["lastRunAt"]:
            auto_start_detail_parts.append(f"上次 {format_datetime(auto_start['state']['lastRunAt'])}")
        if auto_start_last_result and auto_start_last_result != "not-run":
            auto_start_detail_parts.append(f"结果 {auto_start_last_result}")
        if auto_start_last_error:
            auto_start_detail_parts.append(f"错误 {auto_start_last_error}")
        auto_start_level = "success" if auto_start_enabled else "warning"
        if auto_start_last_result in {
            "start-failed",
            "ensure-failed",
            "remote-publish-failed",
            "remote-publish-missing",
            "cooldown-skip",
        }:
            auto_start_level = "warning"
    auto_start_detail = " | ".join(auto_start_detail_parts)

    blocks = [
        StatusBlock("PC 应用服务", app_ok, "运行中" if app_ok else "未启动", app_detail, "success" if app_ok else "error"),
        StatusBlock(
            "nginx 代理",
            proxy_ok if proxy_required else True,
            "运行中" if proxy_ok else "未启动" if proxy_required else "不需要",
            proxy_detail,
            "success" if (proxy_ok or not proxy_required) else "error",
        ),
        StatusBlock(
            "Tailscale",
            tailscale_running and not tailscale_permission_blind,
            tailscale_headline,
            tailscale_detail,
            tailscale_level,
        ),
        mode_block,
        StatusBlock(
            "Desktop approval bridge",
            bool(desktop_bridge["active"]),
            str(desktop_bridge["headline"]),
            str(desktop_bridge["detail"]),
            str(desktop_bridge["level"]),
        ),
        StatusBlock(
            "手机连接状态",
            mobile_online > 0,
            f"{mobile_online}/{len(peers)} 在线",
            current_device,
            "success" if mobile_online > 0 else "error",
        ),
        StatusBlock(
            "手机最近访问",
            recent_phone_activity,
            "最近 10 分钟内有访问" if recent_phone_activity else "最近 10 分钟内无访问",
            latest_activity_summary,
            "success" if recent_phone_activity else "error",
        ),
    ]

    return {
        "checked_at": now_local().strftime("%Y-%m-%d %H:%M:%S"),
        "local_url": LOCAL_PANEL_URL,
        "mode_url": remote["url"] if show_sensitive else redact_url(remote["url"], 1),
        "blocks": [block.to_dict() for block in blocks],
        "mobile_peers": peers,
        "approved_devices": approved_devices,
        "pending_device_approvals": pending_approvals,
        "recent_mobile_requests": prepare_recent_mobile_requests(recent_requests, show_sensitive=show_sensitive),
        "diagnostics": prepare_diagnostics(
            ["[local] auth database available"] + tail_error_lines(),
            show_sensitive=show_sensitive,
        ),
        "summary": {
            "app_running": app_ok,
            "nginx_running": proxy_ok,
            "tailscale_running": tailscale_running,
            "tailscale_permission_blind": tailscale_permission_blind,
            "mode_requested": normalize_mode_name(mode_config.get("requestedMode") or app_bind_mode),
            "mode_effective": normalize_mode_name(mode_config.get("effectiveMode") or app_bind_mode),
            "mode_persistent_remote_publish": bool(mode_config.get("persistentRemotePublish")),
            "mode_legacy_state_detected": bool(mode_config.get("legacyStateDetected")),
            "mode_enabled": remote["published"],
            "mode_reachable": mode_available,
            "mode_available": mode_available,
            "mode_level": mode_summary["level"],
            "mode_value": mode_summary["value"],
            "mode_detail": mode_summary["detail"],
            "mode_name": normalize_mode_name(remote.get("visibility") or app_bind_mode),
            "mode_requires_tailscale_client": bool(remote.get("requires_tailscale_client")),
            "approved_devices": len(approved_devices),
            "pending_approvals": len(pending_approvals),
            "desktop_bridge_active": bool(desktop_bridge["active"]),
            "desktop_bridge_detail": str(desktop_bridge["detail"]),
            "autostart_installed": auto_start_installed,
            "autostart_enabled": auto_start_enabled,
            "autostart_mode": "startup-folder+scheduled-task",
            "autostart_startup_delay_seconds": auto_start["config"]["startupDelaySeconds"],
            "watchdog_interval_minutes": auto_start["config"]["watchdogIntervalMinutes"],
            "autostart_last_run": auto_start["state"]["lastRunAt"],
            "autostart_last_result": auto_start_last_result,
            "autostart_last_error": auto_start_last_error,
            "autostart_value": auto_start_value,
            "autostart_detail": auto_start_detail,
            "autostart_level": auto_start_level,
            "mobile_online": mobile_online,
            "mobile_total": len(peers),
            "recent_phone_requests": len(recent_requests),
            "recent_phone_websockets": active_phone_websockets,
            "recent_phone_activity": recent_phone_activity,
            "ws_recent_disconnects": runtime_diagnostics["ws_recent_disconnects"],
            "last_successful_mobile_sync": runtime_diagnostics["last_successful_mobile_sync"],
            "last_sync_divergence": runtime_diagnostics["last_sync_divergence"],
            "healthy_local_services": int(app_ok) + (int(proxy_ok) if proxy_required else 0),
            "total_local_services": 2 if proxy_required else 1,
            "listener_summary": {
                str(APP_PORT): app_listener.summary() if app_listener else ("健康检查通过，但未读到监听进程" if app_ok else "端口未监听"),
                str(PROXY_PORT): (
                    proxy_listener.summary()
                    if proxy_listener
                    else "not required (legacy-direct)"
                    if not proxy_required
                    else "端口未监听"
                ),
            },
        },
    }


def stack_is_running() -> bool:
    app_ok, _ = http_health(APP_HEALTH_URL, timeout=1.5)
    return app_ok


def remote_publish_is_enabled() -> bool:
    tailscale_status = load_tailscale_status()
    serve_status = load_serve_status()
    remote = build_remote_status_v2(tailscale_status, serve_status)
    return bool(remote["published"])


def remote_publish_is_public() -> bool:
    tailscale_status = load_tailscale_status()
    serve_status = load_serve_status()
    remote = build_remote_status_v2(tailscale_status, serve_status)
    return is_public_remote_publish(remote)


def stack_is_stopped() -> bool:
    if is_port_open(APP_PORT, timeout=0.4) or is_port_open(PROXY_PORT, timeout=0.4):
        return False
    app_ok, _ = http_health(APP_HEALTH_URL, timeout=0.8)
    proxy_ok, _ = http_health(PROXY_HEALTH_URL, timeout=0.8)
    return not app_ok and not proxy_ok


def wait_for_remote_reachable(timeout: float = 8.0) -> bool:
    def _remote_ok() -> bool:
        status = collect_status()
        return bool(status["summary"]["mode_reachable"])

    return wait_for(_remote_ok, timeout=timeout, interval=1.0)


def perform_action(action: str, *, assume_yes: bool = False) -> str:
    if action == "start":
        result = powershell_file("start-mobile-codex-stack.ps1", timeout=30)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Failed to start the Mobile Codex stack.")
        if not wait_for(stack_is_running, timeout=20, interval=1.5):
            listeners = get_listener_map()
            detail = " | ".join(describe_listener(listeners.get(port)) for port in (APP_PORT, PROXY_PORT))
            raise RuntimeError(f"Start command finished, but the local health check still failed: {detail}")
        return "Mobile Codex stack started."

    if action == "stop":
        result = powershell_file("stop-mobile-codex-stack.ps1", timeout=20)
        if TAILSCALE.exists():
            run_command([str(TAILSCALE), "funnel", "reset"], timeout=10)
            run_command([str(TAILSCALE), "serve", "reset"], timeout=10)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Failed to stop the Mobile Codex stack.")
        if not wait_for(stack_is_stopped, timeout=15, interval=1.0):
            powershell_file("stop-mobile-codex-stack.ps1", timeout=20)
            if not wait_for(stack_is_stopped, timeout=10, interval=1.0):
                listeners = get_listener_map()
                remaining = [listeners.get(port) for port in (APP_PORT, PROXY_PORT) if listeners.get(port)]
                detail = " | ".join(item.summary() for item in remaining) if remaining else "listeners still appear active"
                raise RuntimeError(f"Stop command finished, but local listeners are still present: {detail}")
        return "Mobile Codex stack stopped."

    if action == "enable_tailnet_private":
        result = powershell_file("enable-mobile-codex-tailnet-private.ps1", timeout=30)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Failed to enable tailnet-private mode.")
        return "tailnet-private mode is enabled."

    if action == "disable_tailnet_private":
        result = powershell_file("disable-mobile-codex-tailnet-private.ps1", timeout=20)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Failed to disable tailnet-private mode.")
        return "tailnet-private mode has been disabled."

    if action == "publish_public_funnel":
        result = powershell_file(
            "publish-mobile-codex-public-funnel.ps1",
            timeout=30,
            arguments=["-Yes"] if assume_yes else None,
        )
        if result.returncode != 0:
            if result.returncode == 3 and not assume_yes:
                raise RuntimeError(
                    "public-funnel requires explicit confirmation. Confirm it in the desktop tool, or run the script again with -Yes."
                )
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Failed to publish public-funnel mode.")
        if wait_for_remote_reachable(timeout=8):
            return "public-funnel is enabled and the public entrypoint is reachable."
        return "public-funnel is enabled. If the phone still cannot open it immediately, wait a few seconds for DNS and TLS propagation, then refresh."

    if action == "unpublish_public_funnel":
        result = powershell_file("unpublish-mobile-codex-public-funnel.ps1", timeout=20)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Failed to disable public-funnel mode.")
        funnel_result = run_command([str(TAILSCALE), "funnel", "reset"], timeout=10)
        serve_result = run_command([str(TAILSCALE), "serve", "reset"], timeout=10)
        if not wait_for(lambda: not remote_publish_is_enabled(), timeout=8, interval=0.8):
            detail = "\n".join(
                text
                for text in (
                    funnel_result.stderr.strip() or funnel_result.stdout.strip(),
                    serve_result.stderr.strip() or serve_result.stdout.strip(),
                )
                if text
            )
            raise RuntimeError(detail or "public-funnel reset commands ran, but the published endpoints still exist.")
        return "public-funnel has been disabled."

    if action == "enable_desktop_approvals":
        result = powershell_file("enable-remote-desktop-approvals.ps1", timeout=20)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Failed to enable remote desktop approvals")
        return result.stdout.strip() or "Remote desktop approvals enabled."

    if action == "disable_desktop_approvals":
        result = powershell_file("disable-remote-desktop-approvals.ps1", timeout=20)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Failed to disable remote desktop approvals")
        return result.stdout.strip() or "Remote desktop approvals disabled."

    if action == "open_local":
        webbrowser.open(LOCAL_PANEL_URL)
        return "Opened the local Mobile Codex panel."

    raise ValueError(f"Unsupported action: {action}")

class ControlApp:
    REFRESH_MS = 15000

    def __init__(self) -> None:
        if tk is None:
            raise RuntimeError("当前 Python 环境缺少 tkinter，无法显示桌面界面")

        self.root = tk.Tk()
        self.root.title(APP_TITLE)
        self.root.geometry("1260x900")
        self.root.minsize(1120, 800)
        self.root.configure(bg="#eef3f8")

        self.status_text = tk.StringVar(value="就绪")
        self.last_refresh_text = tk.StringVar(value="尚未刷新")
        self.local_url_text = tk.StringVar(value=f"本地面板：{LOCAL_PANEL_URL}")
        self.remote_url_text = tk.StringVar(value="模式入口：localhost")
        self.show_sensitive = tk.BooleanVar(value=False)
        self.sensitive_warning_text = tk.StringVar(value="")
        self.block_labels: list[dict[str, tk.Label]] = []
        self.metric_widgets: dict[str, dict[str, Any]] = {}
        self.pending_approval_items: list[dict[str, Any]] = []
        self.selected_approval_token: str | None = None
        self._busy = False

        self._build_ui()
        self.refresh_status()

    def _build_ui(self) -> None:
        container = tk.Frame(self.root, bg="#eef3f8")
        container.pack(fill="both", expand=True, padx=14, pady=14)

        title = tk.Label(
            container,
            text=APP_TITLE,
            font=("Microsoft YaHei UI", 22, "bold"),
            bg="#eef3f8",
            fg="#112033",
        )
        title.pack(anchor="w")

        subtitle = tk.Label(
            container,
            text="用于在电脑端一键控制 Codex 服务，并集中查看本机服务、远程发布与手机连接状态。",
            font=("Microsoft YaHei UI", 10),
            bg="#eef3f8",
            fg="#4f6072",
        )
        subtitle.pack(anchor="w", pady=(4, 10))

        endpoint_bar = tk.Frame(container, bg="#dbe8f6", bd=1, relief="solid")
        endpoint_bar.pack(fill="x", pady=(0, 12))
        tk.Label(
            endpoint_bar,
            textvariable=self.local_url_text,
            font=("Microsoft YaHei UI", 10, "bold"),
            bg="#dbe8f6",
            fg="#17324d",
        ).pack(anchor="w", padx=12, pady=(10, 2))
        tk.Label(
            endpoint_bar,
            textvariable=self.remote_url_text,
            font=("Microsoft YaHei UI", 10),
            bg="#dbe8f6",
            fg="#17324d",
        ).pack(anchor="w", padx=12, pady=(0, 10))

        summary_strip = tk.Frame(container, bg="#eef3f8")
        summary_strip.pack(fill="x", pady=(0, 12))
        for index, (key, title_text, hint) in enumerate(
            [
                ("services", "本机服务", "健康服务数量"),
                ("autostart", "自动启动", "登录后自动启动与低频保活"),
                ("mode", "访问模式", "localhost / tailnet-private / public-funnel"),
                ("mobile", "手机在线", "手机设备在线情况"),
                ("whitelist", "设备白名单", "已批准设备数量"),
                ("approvals", "待审批", "首次登录待电脑授权"),
                ("activity", "最近访问", "近 10 分钟活跃度"),
            ]
        ):
            card = tk.Frame(summary_strip, bg="white", bd=1, relief="solid")
            card.grid(row=0, column=index, padx=6, sticky="nsew")
            summary_strip.grid_columnconfigure(index, weight=1)
            tk.Label(
                card,
                text=title_text,
                font=("Microsoft YaHei UI", 10, "bold"),
                bg="white",
                fg="#17324d",
            ).pack(anchor="w", padx=12, pady=(12, 2))
            value_label = tk.Label(card, text="--", font=("Microsoft YaHei UI", 18, "bold"), bg="white", fg="#0f9d58")
            value_label.pack(anchor="w", padx=12)
            detail_label = tk.Label(
                card,
                text=hint,
                font=("Microsoft YaHei UI", 9),
                bg="white",
                fg="#5a6c7f",
                wraplength=180,
                justify="left",
            )
            detail_label.pack(anchor="w", padx=12, pady=(2, 12))
            self.metric_widgets[key] = {"frame": card, "value": value_label, "detail": detail_label}

        actions = tk.Frame(container, bg="#eef3f8")
        actions.pack(fill="x", pady=(0, 12))

        buttons = [
            ("刷新状态", "#1f6feb", lambda: self.run_background("正在刷新状态...", self._refresh_action)),
            ("启动服务", "#0f9d58", lambda: self.run_background("正在启动整套服务...", lambda: self._action_and_refresh("start"))),
            ("停止服务", "#d93025", lambda: self.run_background("正在停止整套服务...", lambda: self._action_and_refresh("stop"))),
            ("启用 tailnet-private", "#0b7285", self._confirm_tailnet_private_enable),
            ("关闭 tailnet-private", "#4c6f7a", lambda: self.run_background("正在关闭 tailnet-private...", lambda: self._action_and_refresh("disable_tailnet_private"))),
            ("发布 public-funnel", "#c2410c", self._confirm_public_funnel_publish),
            ("关闭 public-funnel", "#9a3412", lambda: self.run_background("正在关闭 public-funnel...", lambda: self._action_and_refresh("unpublish_public_funnel"))),
            ("Enable remote approvals (60m)", "#2b8a3e", lambda: self.run_background("Enabling remote desktop approvals...", lambda: self._action_and_refresh("enable_desktop_approvals"))),
            ("Disable remote approvals", "#8d6e63", lambda: self.run_background("Disabling remote desktop approvals...", lambda: self._action_and_refresh("disable_desktop_approvals"))),
            ("打开本地面板", "#5f3dc4", lambda: self.run_background("正在打开本地面板...", lambda: perform_action("open_local"))),
        ]
        for text, color, callback in buttons:
            tk.Button(
                actions,
                text=text,
                command=callback,
                font=("Microsoft YaHei UI", 10, "bold"),
                bg=color,
                fg="white",
                activebackground=color,
                activeforeground="white",
                relief="flat",
                padx=12,
                pady=8,
                cursor="hand2",
            ).pack(side="left", padx=(0, 8))

        info_row = tk.Frame(container, bg="#eef3f8")
        info_row.pack(fill="x", pady=(0, 12))
        tk.Label(
            info_row,
            textvariable=self.status_text,
            font=("Microsoft YaHei UI", 10, "bold"),
            bg="#eef3f8",
            fg="#112033",
        ).pack(side="left")
        tk.Label(
            info_row,
            textvariable=self.last_refresh_text,
            font=("Microsoft YaHei UI", 10),
            bg="#eef3f8",
            fg="#4f6072",
        ).pack(side="right")

        warning_row = tk.Frame(container, bg="#eef3f8")
        warning_row.pack(fill="x", pady=(0, 12))
        tk.Checkbutton(
            warning_row,
            text="显示敏感信息（危险）",
            variable=self.show_sensitive,
            bg="#eef3f8",
            fg="#8a1c1c",
            activebackground="#eef3f8",
            activeforeground="#8a1c1c",
            command=lambda: self.run_background("正在刷新状态...", self._refresh_action, skip_if_busy=True, show_pending=False),
        ).pack(side="left")
        tk.Label(
            warning_row,
            textvariable=self.sensitive_warning_text,
            font=("Microsoft YaHei UI", 9, "bold"),
            bg="#eef3f8",
            fg="#b42318",
        ).pack(side="left", padx=(12, 0))

        grid = tk.Frame(container, bg="#eef3f8")
        grid.pack(fill="x", pady=(0, 12))
        for index in range(7):
            frame = tk.Frame(grid, bg="white", bd=1, relief="solid", highlightthickness=0)
            row, col = divmod(index, 3)
            frame.grid(row=row, column=col, padx=6, pady=6, sticky="nsew")
            grid.grid_columnconfigure(col, weight=1)

            title_label = tk.Label(frame, text="--", font=("Microsoft YaHei UI", 11, "bold"), bg="white", fg="#10243d", anchor="w")
            title_label.pack(fill="x", padx=12, pady=(12, 4))
            state_label = tk.Label(frame, text="--", font=("Microsoft YaHei UI", 16, "bold"), bg="white", fg="#4f6072", anchor="w")
            state_label.pack(fill="x", padx=12)
            detail_label = tk.Label(
                frame,
                text="--",
                font=("Microsoft YaHei UI", 9),
                bg="white",
                fg="#4f6072",
                justify="left",
                anchor="w",
                wraplength=330,
            )
            detail_label.pack(fill="x", padx=12, pady=(4, 12))
            self.block_labels.append({"frame": frame, "title": title_label, "state": state_label, "detail": detail_label})

        approval_frame = tk.Frame(container, bg="white", bd=1, relief="solid")
        approval_frame.pack(fill="x", pady=(0, 12))
        tk.Label(
            approval_frame,
            text="首次登录电脑授权",
            font=("Microsoft YaHei UI", 12, "bold"),
            bg="white",
            fg="#10243d",
        ).pack(anchor="w", padx=12, pady=(12, 4))
        tk.Label(
            approval_frame,
            text="新设备首次登录会进入待审批列表。请在电脑上核对设备信息后，再决定是否加入白名单。",
            font=("Microsoft YaHei UI", 9),
            bg="white",
            fg="#5a6c7f",
        ).pack(anchor="w", padx=12, pady=(0, 8))

        approval_actions = tk.Frame(approval_frame, bg="white")
        approval_actions.pack(fill="x", padx=12, pady=(0, 10))
        for text, color, callback in [
            ("刷新审批", "#1f6feb", lambda: self.run_background("正在刷新审批列表...", self._refresh_action)),
            ("批准所选", "#0f9d58", lambda: self._resolve_selected_request(True)),
            ("拒绝所选", "#d93025", lambda: self._resolve_selected_request(False)),
        ]:
            tk.Button(
                approval_actions,
                text=text,
                command=callback,
                font=("Microsoft YaHei UI", 10, "bold"),
                bg=color,
                fg="white",
                activebackground=color,
                activeforeground="white",
                relief="flat",
                padx=12,
                pady=7,
                cursor="hand2",
            ).pack(side="left", padx=(0, 8))

        approval_body = tk.Frame(approval_frame, bg="white")
        approval_body.pack(fill="x", padx=12, pady=(0, 12))

        approval_list_frame = tk.Frame(approval_body, bg="white")
        approval_list_frame.pack(side="left", fill="both", expand=False)
        tk.Label(
            approval_list_frame,
            text="待审批设备",
            font=("Microsoft YaHei UI", 10, "bold"),
            bg="white",
            fg="#17324d",
        ).pack(anchor="w", pady=(0, 6))
        approval_list_inner = tk.Frame(approval_list_frame, bg="white")
        approval_list_inner.pack(fill="both", expand=True)
        approval_scroll = tk.Scrollbar(approval_list_inner)
        approval_scroll.pack(side="right", fill="y")
        self.approval_listbox = tk.Listbox(
            approval_list_inner,
            width=42,
            height=8,
            exportselection=False,
            font=("Microsoft YaHei UI", 10),
            bg="#f7f9fc",
            fg="#16263a",
            relief="flat",
            activestyle="none",
            yscrollcommand=approval_scroll.set,
        )
        self.approval_listbox.pack(side="left", fill="both", expand=True)
        self.approval_listbox.bind("<<ListboxSelect>>", self._on_approval_selected)
        approval_scroll.config(command=self.approval_listbox.yview)

        approval_detail_frame = tk.Frame(approval_body, bg="white")
        approval_detail_frame.pack(side="left", fill="both", expand=True, padx=(12, 0))
        tk.Label(
            approval_detail_frame,
            text="设备详情",
            font=("Microsoft YaHei UI", 10, "bold"),
            bg="white",
            fg="#17324d",
        ).pack(anchor="w", pady=(0, 6))
        self.approval_detail_text = self._build_text_panel_body(approval_detail_frame, height=8)

        bottom = tk.PanedWindow(container, orient="horizontal", bg="#eef3f8", sashrelief="flat")
        bottom.pack(fill="both", expand=True)

        self.devices_text = self._build_text_panel(bottom, "手机在线设备")
        self.whitelist_text = self._build_text_panel(bottom, "设备白名单")
        self.requests_text = self._build_text_panel(bottom, "最近手机访问")
        self.diagnostics_text = self._build_text_panel(bottom, "诊断信息")

    def _build_text_panel(self, parent: tk.PanedWindow, title: str) -> tk.Text:
        frame = tk.Frame(parent, bg="white", bd=1, relief="solid")
        parent.add(frame, stretch="always")

        tk.Label(frame, text=title, font=("Microsoft YaHei UI", 11, "bold"), bg="white", fg="#10243d").pack(anchor="w", padx=10, pady=(10, 6))
        return self._build_text_panel_body(frame)

    def _build_text_panel_body(self, parent: tk.Frame, height: int = 18) -> tk.Text:
        text_frame = tk.Frame(parent, bg="white")
        text_frame.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        scrollbar = tk.Scrollbar(text_frame)
        scrollbar.pack(side="right", fill="y")
        text = tk.Text(
            text_frame,
            wrap="word",
            font=("Microsoft YaHei UI", 9),
            height=height,
            bg="#f7f9fc",
            fg="#16263a",
            relief="flat",
            yscrollcommand=scrollbar.set,
        )
        text.pack(fill="both", expand=True)
        scrollbar.config(command=text.yview)
        return text

    def _render_text(self, widget: tk.Text, content: str) -> None:
        widget.configure(state="normal")
        widget.delete("1.0", "end")
        widget.insert("1.0", content)
        widget.configure(state="disabled")

    def _on_approval_selected(self, _event: Any = None) -> None:
        selection = self.approval_listbox.curselection()
        if not selection:
            self.selected_approval_token = None
            self._render_text(self.approval_detail_text, "请选择一条待审批设备，查看详情并执行批准或拒绝。")
            return

        index = selection[0]
        if index >= len(self.pending_approval_items):
            self.selected_approval_token = None
            self._render_text(self.approval_detail_text, "当前选择的设备信息已失效，请先刷新。")
            return

        item = self.pending_approval_items[index]
        self.selected_approval_token = str(item["request_token"])
        self._render_pending_approval_detail()

    def _render_pending_approval_list(self, items: list[dict[str, Any]]) -> None:
        previous_token = self.selected_approval_token
        self.pending_approval_items = items

        self.approval_listbox.delete(0, "end")
        for item in items:
            line = (
                f"{item.get('username') or '未知账号'} | "
                f"{item.get('display_name') or '未命名设备'} | "
                f"{format_age_text(item.get('created_at'))}"
            )
            self.approval_listbox.insert("end", line)

        if not items:
            self.selected_approval_token = None
            self._render_text(self.approval_detail_text, "当前没有待审批设备。")
            return

        selected_index = next(
            (index for index, item in enumerate(items) if str(item["request_token"]) == previous_token),
            0,
        )
        self.approval_listbox.selection_clear(0, "end")
        self.approval_listbox.selection_set(selected_index)
        self.approval_listbox.activate(selected_index)
        self.selected_approval_token = str(items[selected_index]["request_token"])
        self._render_pending_approval_detail()

    def _render_pending_approval_detail(self) -> None:
        if not self.selected_approval_token:
            self._render_text(self.approval_detail_text, "请选择一条待审批设备，查看详情并执行批准或拒绝。")
            return

        item = next(
            (entry for entry in self.pending_approval_items if str(entry["request_token"]) == self.selected_approval_token),
            None,
        )
        if item is None:
            self._render_text(self.approval_detail_text, "当前选择的设备信息已失效，请先刷新。")
            return

        content = "\n".join(
            [
                f"账号：{item.get('username') or '未知'}",
                f"设备名称：{item.get('display_name') or '未命名设备'}",
                f"设备 ID：{item.get('device_id') or '暂无'}",
                f"平台：{item.get('platform') or '暂无'}",
                f"客户端类型：{item.get('app_type') or '暂无'}",
                f"请求 IP：{item.get('requested_ip') or '暂无'}",
                f"申请时间：{format_datetime(item.get('created_at'))}",
                "",
                "请求 UA：",
                item.get("requested_user_agent") or "暂无",
                "",
                "确认无误后，可在上方点击“批准所选”加入白名单。",
            ]
        )
        self._render_text(self.approval_detail_text, content)

    def _resolve_selected_request(self, approved: bool) -> None:
        if not self.selected_approval_token:
            self.status_text.set("请先选择一条待审批设备。")
            return

        action_text = "批准" if approved else "拒绝"
        token = self.selected_approval_token

        def task() -> str:
            current = next(
                (entry for entry in self.pending_approval_items if str(entry["request_token"]) == token),
                None,
            )
            if not current:
                raise RuntimeError("待审批设备已不存在，请先刷新。")
            if not resolve_device_request(token, approved):
                raise RuntimeError("审批未生效，请刷新后重试。")

            status = collect_status(show_sensitive=bool(self.show_sensitive.get()), include_internal=True)
            self.root.after(0, lambda: self.apply_status(status))
            device_name = current.get("display_name") or current.get("device_id") or "该设备"
            return f"已{action_text}设备：{device_name}"

        self.run_background(f"正在{action_text}所选设备...", task)

    @staticmethod
    def _level_theme(level: str) -> tuple[str, str, str]:
        if level == "success":
            return "#ecfff3", "#0f9d58", "#0f9d58"
        if level == "warning":
            return "#fff7e8", "#b26a00", "#b26a00"
        return "#fff2f0", "#d93025", "#d93025"

    def _refresh_action(self) -> str:
        status = collect_status(show_sensitive=bool(self.show_sensitive.get()), include_internal=True)
        self.root.after(0, lambda: self.apply_status(status))
        return "状态已刷新"

    def _action_and_refresh(self, action: str, *, assume_yes: bool = False) -> str:
        message = perform_action(action, assume_yes=assume_yes)
        status = collect_status(show_sensitive=bool(self.show_sensitive.get()), include_internal=True)
        self.root.after(0, lambda: self.apply_status(status))
        return message

    def _confirm_tailnet_private_enable(self) -> None:
        if not messagebox:
            self.run_background(
                "正在启用 tailnet-private...",
                lambda: self._action_and_refresh("enable_tailnet_private"),
            )
            return

        confirmed = messagebox.askyesno(
            "Enable tailnet-private",
            "tailnet-private 会通过 Tailscale Serve HTTPS 暴露一个仅 tailnet 可访问的入口。\n\n"
            "应用本身仍保持 localhost-only，Funnel 不会启用。\n\n"
            "是否继续？",
            icon="warning",
        )
        if confirmed:
            self.run_background(
                "正在启用 tailnet-private...",
                lambda: self._action_and_refresh("enable_tailnet_private"),
            )

    def _confirm_public_funnel_publish(self) -> None:
        if not messagebox:
            self.run_background(
                "正在发布 public-funnel...",
                lambda: self._action_and_refresh("publish_public_funnel", assume_yes=True),
            )
            return

        confirmed = messagebox.askyesno(
            "Publish public-funnel",
            "DANGER: public-funnel 会创建公网入口。\n\n"
            "请求将通过 Tailscale Funnel HTTPS -> 本机 nginx -> localhost app。\n"
            "这不应该作为默认模式，也不会自动持久化。\n\n"
            "只有在你明确需要公网访问时才继续。是否确认发布？",
            icon="warning",
        )
        if confirmed:
            self.run_background(
                "正在发布 public-funnel...",
                lambda: self._action_and_refresh("publish_public_funnel", assume_yes=True),
            )

    def run_background(
        self,
        pending_message: str,
        task: Callable[[], str],
        skip_if_busy: bool = False,
        show_pending: bool = True,
    ) -> None:
        if self._busy:
            if not skip_if_busy:
                self.status_text.set("已有任务进行中，请稍候...")
            return

        self._busy = True
        if show_pending:
            self.status_text.set(pending_message)

        def worker() -> None:
            try:
                message = task()
                self.root.after(0, lambda: self.status_text.set(message))
            except Exception as exc:  # noqa: BLE001
                self.root.after(0, lambda: self.status_text.set(f"操作失败：{exc}"))
            finally:
                self.root.after(0, self._mark_idle)

        threading.Thread(target=worker, daemon=True).start()

    def _mark_idle(self) -> None:
        self._busy = False

    def refresh_status(self) -> None:
        self.run_background("正在刷新状态...", self._refresh_action, skip_if_busy=True, show_pending=False)
        self.root.after(self.REFRESH_MS, self.refresh_status)

    def apply_status(self, status: dict[str, Any]) -> None:
        summary = status["summary"]
        self.last_refresh_text.set(f"最近刷新：{status['checked_at']}")
        self.local_url_text.set(f"本地面板：{status['local_url']}")
        self.remote_url_text.set(f"模式入口：{status['mode_url'] or 'localhost'}")
        self.sensitive_warning_text.set("敏感信息显示已开启，请勿截图或导出。" if self.show_sensitive.get() else "")

        metric_values = {
            "services": (
                f"{summary['healthy_local_services']}/{summary['total_local_services']} 正常",
                f"3001：{summary['listener_summary'][str(APP_PORT)]} | 8080：{summary['listener_summary'][str(PROXY_PORT)]}",
                "success" if summary["healthy_local_services"] == summary["total_local_services"] else "error",
            ),
            "autostart": (
                summary["autostart_value"],
                summary["autostart_detail"],
                summary["autostart_level"],
            ),
            "mode": (
                summary["mode_value"],
                summary["mode_detail"],
                summary["mode_level"],
            ),
            "mobile": (
                f"{summary['mobile_online']}/{summary['mobile_total']}",
                "至少有一台手机在线" if summary["mobile_online"] else "当前没有手机在线",
                "success" if summary["mobile_online"] > 0 else "error",
            ),
            "whitelist": (
                f"{summary['approved_devices']} 台",
                "已加入白名单的登录设备",
                "success" if summary["approved_devices"] > 0 else "warning",
            ),
            "approvals": (
                f"{summary['pending_approvals']} 条",
                "新设备首次登录需在电脑端批准",
                "warning" if summary["pending_approvals"] > 0 else "success",
            ),
            "activity": (
                f"{summary['recent_phone_requests']} 条",
                f"WebSocket {summary['recent_phone_websockets']} 条 | {'最近有活跃访问' if summary['recent_phone_activity'] else '最近无活跃访问'}",
                "success" if summary["recent_phone_activity"] else "error",
            ),
        }
        for key, (value, detail, level) in metric_values.items():
            widgets = self.metric_widgets[key]
            background, color, _ = self._level_theme(level)
            widgets["frame"].configure(bg=background)
            widgets["value"].configure(text=value, fg=color, bg=background)
            for child in widgets["frame"].winfo_children():
                child.configure(bg=background)
            widgets["detail"].configure(text=detail, bg=background)

        for labels, block in zip(self.block_labels, status["blocks"], strict=False):
            frame_color, text_color, _ = self._level_theme(block.get("level", "error"))
            labels["frame"].configure(bg=frame_color)
            labels["title"].configure(text=block["label"], bg=frame_color)
            labels["state"].configure(text=block["headline"], fg=text_color, bg=frame_color)
            labels["detail"].configure(text=block["detail"], bg=frame_color)

        devices_lines = []
        for peer in status["mobile_peers"]:
            devices_lines.append(
                f"{peer['display_name']}\n"
                f"  系统：{peer['os']}\n"
                f"  在线：{'是' if peer['online'] else '否'}\n"
                f"  活跃：{'是' if peer['active'] else '否'}\n"
                f"  Tail IP：{peer['tail_ip'] or '暂无'}\n"
                f"  最近握手：{format_datetime(peer['last_handshake'])}\n"
                f"  最近出现：{format_datetime(peer['last_seen'])}\n"
                f"  中继区域：{peer['relay'] or '暂无'}\n"
            )
        self._render_text(self.devices_text, "\n".join(devices_lines) if devices_lines else "暂未检测到手机设备。")

        whitelist_lines = []
        for item in status["approved_devices"]:
            whitelist_lines.append(
                f"{item['display_name']}\n"
                f"  账号：{item.get('username') or '未知'}\n"
                f"  设备 ID：{item.get('device_id') or '暂无'}\n"
                f"  平台：{item.get('platform') or '暂无'}\n"
                f"  类型：{item.get('app_type') or '暂无'}\n"
                f"  首次批准：{format_datetime(item.get('first_approved_at'))}\n"
                f"  最近登录：{format_datetime(item.get('last_login'))}\n"
                f"  最近来源 IP：{item.get('last_ip') or '暂无'}\n"
            )
        self._render_text(self.whitelist_text, "\n".join(whitelist_lines) if whitelist_lines else "当前设备白名单为空。")

        request_lines = []
        for item in status["recent_mobile_requests"]:
            request_lines.append(
                f"{format_datetime(item['time'])}（{format_age_text(item['time'])}）\n"
                f"  请求：{item['method']} {item['path']}\n"
                f"  状态码：{item['status']}  来源 IP：{item['ip']}\n"
                f"  UA：{item['user_agent']}\n"
            )
        self._render_text(self.requests_text, "\n".join(request_lines) if request_lines else "最近没有检测到手机访问。")
        self._render_text(self.diagnostics_text, "\n".join(status["diagnostics"]) if status["diagnostics"] else "最近没有诊断告警。")
        self._render_pending_approval_list(status["pending_device_approvals"])

    def run(self) -> None:
        self.root.mainloop()


def main() -> int:
    parser = argparse.ArgumentParser(description="移动 Codex 本地控制工具")
    parser.add_argument("--json", action="store_true", help="输出当前状态 JSON 后退出")
    parser.add_argument(
        "--action",
        choices=[
            "start",
            "stop",
            "enable_tailnet_private",
            "disable_tailnet_private",
            "publish_public_funnel",
            "unpublish_public_funnel",
            "enable_desktop_approvals",
            "disable_desktop_approvals",
            "open_local",
        ],
        help="执行一次控制操作后退出",
    )
    parser.add_argument("--show-sensitive", action="store_true", help="在 JSON 输出中显示敏感字段，并附带危险提示。")
    args = parser.parse_args()

    if args.action:
        message = perform_action(args.action)
        print(message)
        if args.json:
            print(json.dumps(collect_status(show_sensitive=args.show_sensitive, include_internal=args.show_sensitive), ensure_ascii=False, indent=2))
        return 0

    if args.json:
        print(json.dumps(collect_status(show_sensitive=args.show_sensitive, include_internal=args.show_sensitive), ensure_ascii=False, indent=2))
        return 0

    if tk is None:
        print("当前 Python 安装缺少 tkinter，无法启动图形界面。", file=sys.stderr)
        return 1

    app = ControlApp()
    app.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
