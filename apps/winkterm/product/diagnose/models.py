from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


CheckStatus = Literal["planned", "completed", "failed", "timed_out", "skipped"]


@dataclass(frozen=True)
class CheckDefinition:
    id: str
    command: str
    reason: str
    risk: str
    timeout_seconds: int


@dataclass(frozen=True)
class SkillDefinition:
    version: int
    name: str
    mode: str
    checks: list[CheckDefinition]


@dataclass(frozen=True)
class PolicyRules:
    version: int
    default_mode: str
    command_timeout_seconds: int
    safe_exact: list[str]
    blocked_prefixes: list[str]


@dataclass(frozen=True)
class DiagnosisPlan:
    host: str
    profile: str
    checks: list[CheckDefinition]


@dataclass
class CheckResult:
    id: str
    command: str
    status: CheckStatus
    reason: str
    timeout_seconds: int
    exit_code: int | None = None
    duration_ms: int | None = None
    stdout: str = ""
    message: str = ""


@dataclass
class DiagnosisSession:
    session_id: str
    host: str
    profile: str
    plan: DiagnosisPlan
    results: list[CheckResult] = field(default_factory=list)
    summary: str = ""
    report_path: str | None = None

    def counts(self) -> dict[str, int]:
        values = {"completed": 0, "skipped": 0, "failed": 0, "timed_out": 0}
        for result in self.results:
            if result.status in values:
                values[result.status] += 1
        return values

    def to_json_dict(
        self,
        exit_code: int = 0,
        error: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "status": "error" if error else "completed",
            "exit_code": exit_code,
            "host": self.host,
            "profile": self.profile,
            "session_id": self.session_id,
            "report_path": self.report_path,
            "summary": self.summary,
            "counts": self.counts(),
            "checks": [
                {
                    "id": result.id,
                    "command": result.command,
                    "status": result.status,
                    "exit_code": result.exit_code,
                    "duration_ms": result.duration_ms,
                    "reason": result.reason,
                    "message": result.message,
                }
                for result in self.results
            ],
            "error": error,
        }
