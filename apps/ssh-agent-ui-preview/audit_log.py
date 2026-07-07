from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from session_log import redact_sensitive_text


SCHEMA = "ssh-agent-tool.audit.v1"
Clock = Callable[[], str]


class AuditLogger:
    def __init__(self, root: Path, clock: Clock | None = None, max_output_preview: int = 500):
        self.root = Path(root)
        self.clock = clock or utc_now
        self.max_output_preview = max_output_preview

    def write_event(self, event: dict) -> dict:
        created_at = self.clock()
        payload = {
            "schema": SCHEMA,
            "createdAt": created_at,
            "type": str(event.get("type") or "event"),
            "server": str(event.get("server") or ""),
            "sessionId": str(event.get("sessionId") or ""),
            "actor": str(event.get("actor") or "system"),
        }

        for key in ("command", "message", "status"):
            if key in event and event[key] is not None:
                text = str(event[key])
                payload[key] = redact_sensitive_text(text) if key in ("command", "message") else text

        if event.get("output") is not None:
            output = str(event.get("output") or "")
            payload["outputLength"] = len(output)
            payload["outputPreview"] = redact_sensitive_text(summarize_output(output, self.max_output_preview))

        target = self._path_for(created_at)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
        return {"ok": True, "path": str(target), "event": payload}

    def _path_for(self, created_at: str) -> Path:
        day = created_at[:10] if len(created_at) >= 10 else utc_now()[:10]
        return self.root / f"{day}.jsonl"


def summarize_output(output: str, max_length: int) -> str:
    if len(output) <= max_length:
        return output
    return output[:max_length].rstrip() + "..."


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
