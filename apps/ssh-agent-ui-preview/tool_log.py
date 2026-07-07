from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from session_log import REDACTED, redact_sensitive_text


SCHEMA = "ssh-agent-tool.tool-log.v1"
Clock = Callable[[], str]
SENSITIVE_KEYS = (
    "password",
    "passwd",
    "pwd",
    "secret",
    "token",
    "apiKey",
    "api_key",
    "authorization",
    "cookie",
    "privateKey",
    "private_key",
    "identityKey",
    "identity_key",
    "credential",
)


class ToolLogger:
    def __init__(self, root: Path, clock: Clock | None = None):
        self.root = Path(root)
        self.clock = clock or utc_now

    def write_event(self, event: dict) -> dict:
        safe_event = event if isinstance(event, dict) else {}
        created_at = self.clock()
        payload = {
            "schema": SCHEMA,
            "createdAt": created_at,
            "level": normalize_level(safe_event.get("level")),
            "component": str(safe_event.get("component") or "app").strip() or "app",
            "action": str(safe_event.get("action") or "event").strip() or "event",
        }

        for key in ("message", "error"):
            if safe_event.get(key) is not None:
                payload[key] = redact_sensitive_text(str(safe_event.get(key) or ""))
        if isinstance(safe_event.get("context"), dict):
            payload["context"] = sanitize_context(safe_event["context"])

        target = self._path_for(created_at)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
        return {"ok": True, "path": str(target), "event": payload}

    def _path_for(self, created_at: str) -> Path:
        day = created_at[:10] if len(created_at) >= 10 else utc_now()[:10]
        return self.root / f"{day}.jsonl"


def list_tool_log_entries(root: Path, filters: dict | None = None) -> dict:
    log_root = Path(root)
    raw_filters = filters if isinstance(filters, dict) else {}
    component = str(raw_filters.get("component") or "").strip().lower()
    level = str(raw_filters.get("level") or "").strip().lower()
    query = str(raw_filters.get("query") or "").strip().lower()
    limit = coerce_positive_int(raw_filters.get("limit"), 200)

    entries = []
    if log_root.exists():
        for path in sorted(log_root.glob("*.jsonl")):
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
                if component and component not in entry["component"].lower():
                    continue
                if level and level != entry["level"].lower():
                    continue
                if query and not entry_matches_query(entry, query):
                    continue
                entries.append(entry)

    entries.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"ok": True, "root": str(log_root), "total": len(entries), "entries": entries[:limit]}


def build_tool_log_markdown(entries: list, options: dict | None = None) -> str:
    raw_options = options if isinstance(options, dict) else {}
    exported_at = str(raw_options.get("exportedAt") or utc_now())
    normalized = [normalize_entry(entry) for entry in (entries if isinstance(entries, list) else [])]
    total = coerce_non_negative_int(raw_options.get("total"), len(normalized))
    filter_lines = build_tool_export_filter_lines(raw_options.get("filters"))
    lines = [
        "# 工具运行日志",
        "",
        f"导出时间：{exported_at}",
        f"匹配总数：{total}",
        f"导出条数：{len(normalized)}",
        f"事件数量：{len(normalized)}",
        "",
    ]
    if filter_lines:
        lines.extend(["筛选条件：", *filter_lines, ""])
    for entry in normalized:
        title = " / ".join([entry.get("createdAt", ""), entry.get("level", ""), entry.get("component", ""), entry.get("action", "")])
        lines.extend([f"## {title}", ""])
        if entry.get("message"):
            lines.extend(["消息：", "", entry["message"], ""])
        if entry.get("error"):
            lines.extend(["错误：", "", "```text", safe_code_block(entry["error"]), "```", ""])
        if entry.get("context"):
            lines.extend(["上下文：", "", "```json", json.dumps(entry["context"], ensure_ascii=False, indent=2), "```", ""])
    return "\n".join(lines).rstrip() + "\n"


def build_tool_export_filter_lines(filters) -> list[str]:
    if not isinstance(filters, dict):
        return []
    labels = [
        ("component", "模块"),
        ("level", "级别"),
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


def delete_old_tool_logs(root: Path, keep_days: int = 30, now: str | None = None) -> dict:
    log_root = Path(root)
    keep = max(coerce_positive_int(keep_days, 30), 1)
    cutoff = parse_utc_datetime(now or utc_now()) - timedelta(days=keep)
    deleted = 0
    skipped = 0
    if log_root.exists():
        for path in log_root.glob("*.jsonl"):
            log_day = parse_log_file_date(path)
            if not log_day:
                skipped += 1
                continue
            if log_day < cutoff.date():
                try:
                    path.unlink()
                    deleted += 1
                except OSError:
                    skipped += 1
    return {"ok": True, "root": str(log_root), "deleted": deleted, "skipped": skipped, "keepDays": keep}


def normalize_entry(entry: dict, path: Path | None = None) -> dict:
    payload = entry if isinstance(entry, dict) else {}
    normalized = {
        "schema": SCHEMA,
        "createdAt": str(payload.get("createdAt") or ""),
        "level": normalize_level(payload.get("level")),
        "component": str(payload.get("component") or "app"),
        "action": str(payload.get("action") or "event"),
    }
    for key in ("message", "error"):
        if payload.get(key) is not None:
            normalized[key] = redact_sensitive_text(str(payload.get(key) or ""))
    if isinstance(payload.get("context"), dict):
        normalized["context"] = sanitize_context(payload["context"])
    if path:
        normalized["path"] = str(path)
    return normalized


def entry_matches_query(entry: dict, query: str) -> bool:
    text = json.dumps(entry, ensure_ascii=False).lower()
    return query in text


def coerce_positive_int(value, default: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return number if number > 0 else default


def parse_log_file_date(path: Path):
    try:
        return datetime.strptime(path.stem, "%Y-%m-%d").date()
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


def safe_code_block(value: str) -> str:
    return redact_sensitive_text(value).replace("```", "`\u200b``")


def sanitize_context(value):
    if isinstance(value, dict):
        return {
            str(key): REDACTED if is_sensitive_key(key) else sanitize_context(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [sanitize_context(item) for item in value[:50]]
    return redact_sensitive_text(str(value)) if isinstance(value, str) else value


def is_sensitive_key(key) -> bool:
    lowered = str(key or "").replace("-", "").replace("_", "").lower()
    return any(pattern.lower().replace("_", "") in lowered for pattern in SENSITIVE_KEYS)


def normalize_level(value) -> str:
    level = str(value or "info").strip().lower()
    if level == "warning":
        return "warn"
    return level if level in {"debug", "info", "warn", "error"} else "info"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
