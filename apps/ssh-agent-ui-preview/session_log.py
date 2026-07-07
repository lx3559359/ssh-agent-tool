from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable


SCHEMA = "ssh-agent-tool.session-log.v1"
Clock = Callable[[], str]

REDACTED = "[已脱敏]"
REDACTED_PRIVATE_KEY = "[已脱敏私钥]"

SECRET_PATTERNS = [
    re.compile(r"(authorization\s*:\s*bearer\s+)([^\s'\"\\]+)", re.IGNORECASE),
    re.compile(r'("?)credential[_-]?ref\1\s*[:=]\s*"?([^"\s,}]+)"?', re.IGNORECASE),
    re.compile(r"((?:password|passwd|pwd|api[_-]?key|token|secret)\s*=\s*)([^\s'\"\\]+)", re.IGNORECASE),
    re.compile(r"\b(sk-[A-Za-z0-9_\-]{8,})\b"),
]
SENSITIVE_CONTEXT_KEYS = ("password", "passwd", "pwd", "secret", "token", "apiKey", "api_key", "authorization", "cookie", "credential")
PRIVATE_KEY_PATTERN = re.compile(
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
    re.DOTALL,
)


class SessionLogger:
    def __init__(self, root: Path, clock: Clock | None = None):
        self.root = Path(root)
        self.clock = clock or utc_now

    def write_event(self, event: dict) -> dict:
        safe_event = event if isinstance(event, dict) else {}
        created_at = self.clock()
        payload = {
            "schema": SCHEMA,
            "createdAt": created_at,
            "type": str(safe_event.get("type") or "event"),
            "server": str(safe_event.get("server") or ""),
            "sessionId": str(safe_event.get("sessionId") or ""),
            "actor": str(safe_event.get("actor") or "system"),
        }

        for key in ("command", "message", "status", "output"):
            if safe_event.get(key) is not None:
                payload[key] = redact_sensitive_text(str(safe_event.get(key) or ""))
        if safe_event.get("inputLength") is not None:
            payload["inputLength"] = coerce_non_negative_int(safe_event.get("inputLength"), 0)
        if safe_event.get("submit") is not None:
            payload["submit"] = bool(safe_event.get("submit"))
        if isinstance(safe_event.get("context"), dict):
            payload["context"] = sanitize_context(safe_event["context"])
        failure_kind = extract_failure_kind(safe_event)
        if failure_kind:
            payload["failureKind"] = failure_kind

        target = self._path_for(created_at, payload["server"], payload["sessionId"])
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
        return {"ok": True, "path": str(target), "event": payload}

    def _path_for(self, created_at: str, server: str, session_id: str) -> Path:
        day = created_at[:10] if len(created_at) >= 10 else utc_now()[:10]
        safe_server = safe_name(server or "unknown")
        safe_session = safe_name(session_id or "default")
        return self.root / day / f"{safe_server}-{safe_session}.jsonl"


def list_session_log_entries(root: Path, filters: dict | None = None) -> dict:
    log_root = Path(root)
    raw_filters = filters if isinstance(filters, dict) else {}
    server = str(raw_filters.get("server") or "").strip().lower()
    session_id = str(raw_filters.get("sessionId") or "").strip().lower()
    event_type = str(raw_filters.get("type") or "").strip().lower()
    status = str(raw_filters.get("status") or "").strip().lower()
    failure_kind = str(raw_filters.get("failureKind") or "").strip().lower()
    query = str(raw_filters.get("query") or "").strip().lower()
    limit = coerce_positive_int(raw_filters.get("limit"), 200)

    entries: list[dict] = []
    if log_root.exists():
        for path in sorted(log_root.rglob("*.jsonl")):
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except OSError:
                continue
            for line in lines:
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(payload, dict) or payload.get("schema") != SCHEMA:
                    continue
                entry = normalize_entry(payload, path)
                if server and server not in entry["server"].lower():
                    continue
                if session_id and session_id not in entry["sessionId"].lower():
                    continue
                if event_type and event_type not in entry["type"].lower():
                    continue
                if status and status not in entry["status"].lower():
                    continue
                if failure_kind and failure_kind != str(entry.get("failureKind") or "").lower():
                    continue
                if query and not entry_matches_query(entry, query):
                    continue
                entries.append(entry)

    entries.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {
        "ok": True,
        "root": str(log_root),
        "total": len(entries),
        "entries": entries[:limit],
    }


def build_session_log_markdown(entries: list, options: dict | None = None) -> str:
    raw_options = options if isinstance(options, dict) else {}
    exported_at = str(raw_options.get("exportedAt") or utc_now())
    normalized_entries = [normalize_entry(entry) for entry in (entries if isinstance(entries, list) else [])]
    total = coerce_non_negative_int(raw_options.get("total"), len(normalized_entries))
    filter_lines = build_session_export_filter_lines(raw_options.get("filters"))

    lines = [
        "# SSH 会话日志",
        "",
        f"导出时间：{exported_at}",
        f"匹配总数：{total}",
        f"导出条数：{len(normalized_entries)}",
        f"事件数量：{len(normalized_entries)}",
        "",
    ]
    if filter_lines:
        lines.extend(["筛选条件：", *filter_lines, ""])

    for entry in normalized_entries:
        title = " / ".join(
            value
            for value in [
                entry.get("createdAt", ""),
                entry.get("server", ""),
                entry.get("type", ""),
                entry.get("status", ""),
            ]
            if value
        )
        lines.extend([f"## {title}", "", f"- 会话：{entry.get('sessionId') or '未记录'}", f"- 来源：{entry.get('actor') or 'system'}"])
        if entry.get("failureKind"):
            lines.append(f"- failureKind: {entry['failureKind']}")
        if entry.get("message"):
            lines.extend(["", entry["message"]])
        if entry.get("command"):
            lines.extend(["", "```bash", safe_code_block(entry["command"]), "```"])
        if entry.get("output"):
            lines.extend(["", "```text", safe_code_block(entry["output"]), "```"])
        if entry.get("context"):
            lines.extend(["", "上下文：", "", "```json", json.dumps(entry["context"], ensure_ascii=False, indent=2), "```"])
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def build_session_export_filter_lines(filters) -> list[str]:
    if not isinstance(filters, dict):
        return []
    labels = [
        ("server", "服务器"),
        ("type", "类型"),
        ("status", "状态"),
        ("query", "关键词"),
    ]
    lines: list[str] = []
    for key, label in labels:
        value = filters.get(key)
        text = redact_sensitive_text(str(value)).strip() if value is not None else ""
        if text:
            lines.append(f"- {label}：{text}")
    return lines


def coerce_non_negative_int(value, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed >= 0 else fallback


def delete_old_session_logs(root: Path, keep_days: int = 30, now: str | None = None) -> dict:
    log_root = Path(root)
    keep = max(coerce_positive_int(keep_days, 30), 1)
    cutoff = parse_utc_datetime(now or utc_now()) - timedelta(days=keep)
    deleted = 0
    skipped = 0
    if log_root.exists():
        for path in sorted(log_root.rglob("*.jsonl")):
            log_day = parse_session_log_date(path, log_root)
            if not log_day:
                skipped += 1
                continue
            if log_day < cutoff.date():
                try:
                    path.unlink()
                    deleted += 1
                    remove_empty_parent_dirs(path.parent, log_root)
                except OSError:
                    skipped += 1
    return {"ok": True, "root": str(log_root), "deleted": deleted, "skipped": skipped, "keepDays": keep}


def redact_sensitive_text(value: str) -> str:
    text = str(value or "")
    text = PRIVATE_KEY_PATTERN.sub(REDACTED_PRIVATE_KEY, text)
    for pattern in SECRET_PATTERNS:
        text = pattern.sub(redact_sensitive_match, text)
    return text


def redact_sensitive_match(match: re.Match) -> str:
    if "credential" in match.group(0).lower():
        quote = '"' if match.group(1) else ""
        return f"{quote}credential_ref{quote}:\"{REDACTED}\""
    return f"{match.group(1)}{REDACTED}" if match.lastindex and match.lastindex > 1 else REDACTED


def safe_name(value: str) -> str:
    safe = "".join(char if char.isalnum() or char in "-_." else "-" for char in str(value or ""))
    safe = re.sub(r"-+", "-", safe).strip("-._")
    return safe or "unknown"


def normalize_entry(entry: dict, path: Path | None = None) -> dict:
    payload = entry if isinstance(entry, dict) else {}
    normalized = {
        "schema": SCHEMA,
        "createdAt": str(payload.get("createdAt") or ""),
        "type": str(payload.get("type") or "event"),
        "server": str(payload.get("server") or ""),
        "sessionId": str(payload.get("sessionId") or ""),
        "actor": str(payload.get("actor") or "system"),
        "status": str(payload.get("status") or ""),
    }
    for key in ("command", "message", "output"):
        if payload.get(key) is not None:
            normalized[key] = redact_sensitive_text(str(payload.get(key) or ""))
    if payload.get("inputLength") is not None:
        normalized["inputLength"] = coerce_non_negative_int(payload.get("inputLength"), 0)
    if payload.get("submit") is not None:
        normalized["submit"] = bool(payload.get("submit"))
    if isinstance(payload.get("context"), dict):
        normalized["context"] = sanitize_context(payload["context"])
    failure_kind = extract_failure_kind(payload)
    if failure_kind:
        normalized["failureKind"] = failure_kind
    if path:
        normalized["path"] = str(path)
    return normalized


def extract_failure_kind(payload: dict) -> str:
    if not isinstance(payload, dict):
        return ""
    value = payload.get("failureKind")
    context = payload.get("context")
    if value is None and isinstance(context, dict):
        value = context.get("failureKind")
    return safe_name(value) if value is not None else ""


def entry_matches_query(entry: dict, query: str) -> bool:
    return query in json.dumps(entry.get("context", {}), ensure_ascii=False).lower() or any(
        query in str(entry.get(key) or "").lower()
        for key in ("createdAt", "type", "server", "sessionId", "actor", "status", "failureKind", "command", "message", "output")
    )


def sanitize_context(value):
    if isinstance(value, dict):
        return {
            str(key): REDACTED if is_sensitive_context_key(key) else sanitize_context(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [sanitize_context(item) for item in value[:50]]
    return redact_sensitive_text(value) if isinstance(value, str) else value


def is_sensitive_context_key(key) -> bool:
    lowered = str(key or "").replace("-", "").replace("_", "").lower()
    return any(pattern.lower().replace("_", "") in lowered for pattern in SENSITIVE_CONTEXT_KEYS)


def coerce_positive_int(value, default: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return number if number > 0 else default


def coerce_non_negative_int(value, default: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(number, 0)


def parse_session_log_date(path: Path, root: Path):
    try:
        relative = path.relative_to(root)
    except ValueError:
        relative = path
    candidate = relative.parts[0] if relative.parts else path.stem
    try:
        return datetime.strptime(candidate, "%Y-%m-%d").date()
    except ValueError:
        return None


def parse_utc_datetime(value: str) -> datetime:
    text = str(value or "").strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        parsed = datetime.now(timezone.utc)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def remove_empty_parent_dirs(path: Path, root: Path) -> None:
    current = Path(path)
    root = Path(root)
    while current != root and root in current.parents:
        try:
            current.rmdir()
        except OSError:
            break
        current = current.parent


def safe_code_block(value: str) -> str:
    return redact_sensitive_text(value).replace("```", "`\u200b``")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
