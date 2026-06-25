# Diagnosis Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first working read-only SSH diagnosis loop for `linux-basic-health`.

**Architecture:** Add product-owned Python modules under `apps/winkterm/product/diagnose/` and `apps/winkterm/product/cli/` without editing upstream WinkTerm internals. The loop loads `checks.yaml` and `risk_rules.yaml`, builds a user-approved diagnosis plan, executes exact safe commands through WinkTerm's existing Agent API, records per-check results, renders Markdown reports, and exposes a minimal `ssh-ai diagnose` CLI.

**Tech Stack:** Python 3.12, pytest, PyYAML, stdlib `urllib.request`, WinkTerm Agent HTTP API, Markdown reports.

---

## File Structure

Create product-owned implementation files:

- `apps/winkterm/product/diagnose/__init__.py`: package exports.
- `apps/winkterm/product/diagnose/models.py`: dataclasses and status constants.
- `apps/winkterm/product/diagnose/loaders.py`: load/validate skill and policy YAML.
- `apps/winkterm/product/diagnose/policy.py`: exact safe command and blocked-prefix checks.
- `apps/winkterm/product/diagnose/planner.py`: generate diagnosis plans from checks and policy.
- `apps/winkterm/product/diagnose/executors.py`: executor protocol, fake executor, WinkTerm Agent API executor.
- `apps/winkterm/product/diagnose/session.py`: orchestrate approved diagnosis sessions.
- `apps/winkterm/product/diagnose/reports.py`: Markdown report renderer and JSON conversion helpers.
- `apps/winkterm/product/cli/__init__.py`: CLI package marker.
- `apps/winkterm/product/cli/ssh_ai.py`: `ssh-ai diagnose` CLI implementation.

Create tests:

- `apps/winkterm/product/tests/test_loaders_policy.py`
- `apps/winkterm/product/tests/test_planner_reports.py`
- `apps/winkterm/product/tests/test_session_cli.py`

Do not modify upstream files outside `apps/winkterm/product/` in this milestone unless a test proves a narrow integration hook is required.

---

## Task 1: Models and YAML Loaders

**Files:**
- Create: `apps/winkterm/product/diagnose/__init__.py`
- Create: `apps/winkterm/product/diagnose/models.py`
- Create: `apps/winkterm/product/diagnose/loaders.py`
- Test: `apps/winkterm/product/tests/test_loaders_policy.py`

- [ ] **Step 1: Write loader/model tests**

Create `apps/winkterm/product/tests/test_loaders_policy.py`:

```python
from pathlib import Path

import pytest

from product.diagnose.loaders import load_policy, load_skill


ROOT = Path(__file__).resolve().parents[2]
SKILL_PATH = ROOT / "product" / "skills" / "linux-basic-health" / "checks.yaml"
POLICY_PATH = ROOT / "product" / "policy" / "risk_rules.yaml"


def test_load_skill_reads_all_safe_checks():
    skill = load_skill(SKILL_PATH)

    assert skill.name == "linux-basic-health"
    assert skill.mode == "readonly"
    assert len(skill.checks) == 7
    assert {check.id for check in skill.checks} == {
        "uptime",
        "disk",
        "memory",
        "top_cpu",
        "journal_errors",
        "failed_services",
        "listening_ports",
    }
    assert all(check.risk == "safe" for check in skill.checks)
    assert all(check.timeout_seconds == 10 for check in skill.checks)


def test_load_policy_matches_skill_commands():
    skill = load_skill(SKILL_PATH)
    policy = load_policy(POLICY_PATH)

    assert policy.default_mode == "readonly"
    assert policy.command_timeout_seconds == 10
    assert set(policy.safe_exact) == {check.command for check in skill.checks}
    assert "rm" in policy.blocked_prefixes
    assert "systemctl restart" in policy.blocked_prefixes


def test_load_skill_rejects_non_readonly_mode(tmp_path):
    path = tmp_path / "checks.yaml"
    path.write_text(
        """
version: 1
name: unsafe
mode: repair
checks:
  - id: x
    command: uptime
    reason: load
    risk: safe
    timeout_seconds: 10
""".strip(),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="readonly"):
        load_skill(path)
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
python -m pytest product/tests/test_loaders_policy.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'product.diagnose'`.

- [ ] **Step 3: Add models**

Create `apps/winkterm/product/diagnose/__init__.py`:

```python
"""Product-owned diagnosis loop for WinkTerm."""
```

Create `apps/winkterm/product/diagnose/models.py`:

```python
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

    def to_json_dict(self, exit_code: int = 0, error: dict[str, Any] | None = None) -> dict[str, Any]:
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
```

- [ ] **Step 4: Add YAML loaders**

Create `apps/winkterm/product/diagnose/loaders.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from product.diagnose.models import CheckDefinition, PolicyRules, SkillDefinition


def _read_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a YAML mapping")
    return data


def load_skill(path: Path) -> SkillDefinition:
    data = _read_yaml(path)
    if data.get("mode") != "readonly":
        raise ValueError("diagnosis skills must use readonly mode")
    checks: list[CheckDefinition] = []
    for raw in data.get("checks", []):
        timeout = int(raw.get("timeout_seconds", 0))
        if timeout <= 0:
            raise ValueError(f"check {raw.get('id')} must define timeout_seconds")
        checks.append(
            CheckDefinition(
                id=str(raw["id"]),
                command=str(raw["command"]),
                reason=str(raw["reason"]),
                risk=str(raw["risk"]),
                timeout_seconds=timeout,
            )
        )
    if not checks:
        raise ValueError("diagnosis skill must define at least one check")
    return SkillDefinition(
        version=int(data["version"]),
        name=str(data["name"]),
        mode=str(data["mode"]),
        checks=checks,
    )


def load_policy(path: Path) -> PolicyRules:
    data = _read_yaml(path)
    if data.get("default_mode") != "readonly":
        raise ValueError("policy default_mode must be readonly")
    return PolicyRules(
        version=int(data["version"]),
        default_mode=str(data["default_mode"]),
        command_timeout_seconds=int(data["command_timeout_seconds"]),
        safe_exact=[str(item) for item in data.get("safe_exact", [])],
        blocked_prefixes=[str(item) for item in data.get("blocked_prefixes", [])],
    )
```

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
python -m pytest product/tests/test_loaders_policy.py -q
```

Expected: PASS.

Commit:

```powershell
git add apps/winkterm/product/diagnose apps/winkterm/product/tests/test_loaders_policy.py
git commit -m "feat: add diagnosis config loaders"
```

---

## Task 2: Policy Evaluator and Plan Builder

**Files:**
- Create: `apps/winkterm/product/diagnose/policy.py`
- Create: `apps/winkterm/product/diagnose/planner.py`
- Modify: `apps/winkterm/product/tests/test_loaders_policy.py`
- Test: `apps/winkterm/product/tests/test_planner_reports.py`

- [ ] **Step 1: Extend policy tests**

Append to `apps/winkterm/product/tests/test_loaders_policy.py`:

```python
from product.diagnose.policy import PolicyDecision, evaluate_command


def test_evaluate_command_allows_exact_safe_command():
    policy = load_policy(POLICY_PATH)

    decision = evaluate_command("uptime", policy)

    assert decision == PolicyDecision(allowed=True, reason="safe_exact")


def test_evaluate_command_blocks_prefix_before_unknown():
    policy = load_policy(POLICY_PATH)

    decision = evaluate_command("rm -rf /tmp/example", policy)

    assert decision.allowed is False
    assert decision.reason == "blocked_prefix:rm"


def test_evaluate_command_rejects_unknown_command():
    policy = load_policy(POLICY_PATH)

    decision = evaluate_command("whoami", policy)

    assert decision.allowed is False
    assert decision.reason == "not_in_safe_exact"
```

- [ ] **Step 2: Add planner tests**

Create `apps/winkterm/product/tests/test_planner_reports.py`:

```python
from pathlib import Path

from product.diagnose.loaders import load_policy, load_skill
from product.diagnose.planner import build_plan, render_plan_text


ROOT = Path(__file__).resolve().parents[2]
SKILL_PATH = ROOT / "product" / "skills" / "linux-basic-health" / "checks.yaml"
POLICY_PATH = ROOT / "product" / "policy" / "risk_rules.yaml"


def test_build_plan_includes_all_checks():
    plan = build_plan("prod-1", load_skill(SKILL_PATH), load_policy(POLICY_PATH))

    assert plan.host == "prod-1"
    assert plan.profile == "linux-basic-health"
    assert len(plan.checks) == 7
    assert plan.checks[0].command == "uptime"


def test_render_plan_text_shows_timeout_and_commands():
    plan = build_plan("prod-1", load_skill(SKILL_PATH), load_policy(POLICY_PATH))

    text = render_plan_text(plan)

    assert "Diagnosis plan for prod-1" in text
    assert "uptime" in text
    assert "timeout 10s" in text
    assert "ps -eo pid,user,pcpu,pmem,stat,comm --sort=-pcpu | head -n 16" in text
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
python -m pytest product/tests/test_loaders_policy.py product/tests/test_planner_reports.py -q
```

Expected: FAIL because `product.diagnose.policy` and `product.diagnose.planner` do not exist.

- [ ] **Step 4: Add policy evaluator**

Create `apps/winkterm/product/diagnose/policy.py`:

```python
from __future__ import annotations

from dataclasses import dataclass

from product.diagnose.models import PolicyRules


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    reason: str


def evaluate_command(command: str, policy: PolicyRules) -> PolicyDecision:
    normalized = command.strip()
    for prefix in policy.blocked_prefixes:
        if normalized == prefix or normalized.startswith(prefix + " "):
            return PolicyDecision(False, f"blocked_prefix:{prefix}")
    if normalized in policy.safe_exact:
        return PolicyDecision(True, "safe_exact")
    return PolicyDecision(False, "not_in_safe_exact")
```

- [ ] **Step 5: Add planner**

Create `apps/winkterm/product/diagnose/planner.py`:

```python
from __future__ import annotations

from product.diagnose.models import DiagnosisPlan, PolicyRules, SkillDefinition
from product.diagnose.policy import evaluate_command


def build_plan(host: str, skill: SkillDefinition, policy: PolicyRules) -> DiagnosisPlan:
    for check in skill.checks:
        decision = evaluate_command(check.command, policy)
        if not decision.allowed:
            raise ValueError(f"policy rejected {check.id}: {decision.reason}")
        if check.timeout_seconds != policy.command_timeout_seconds:
            raise ValueError(f"timeout mismatch for {check.id}")
    return DiagnosisPlan(host=host, profile=skill.name, checks=skill.checks)


def render_plan_text(plan: DiagnosisPlan) -> str:
    lines = [f"Diagnosis plan for {plan.host}", ""]
    for index, check in enumerate(plan.checks, start=1):
        lines.append(f"{index}. `{check.command}`")
        lines.append(f"   reason: {check.reason}")
        lines.append(f"   timeout {check.timeout_seconds}s")
    return "\n".join(lines)
```

- [ ] **Step 6: Run tests and commit**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
python -m pytest product/tests/test_loaders_policy.py product/tests/test_planner_reports.py -q
```

Expected: PASS.

Commit:

```powershell
git add apps/winkterm/product/diagnose/policy.py apps/winkterm/product/diagnose/planner.py apps/winkterm/product/tests
git commit -m "feat: add diagnosis planner and policy checks"
```

---

## Task 3: Executor Abstractions and Session Orchestrator

**Files:**
- Create: `apps/winkterm/product/diagnose/executors.py`
- Create: `apps/winkterm/product/diagnose/session.py`
- Test: `apps/winkterm/product/tests/test_session_cli.py`

- [ ] **Step 1: Add session tests**

Create `apps/winkterm/product/tests/test_session_cli.py`:

```python
from pathlib import Path

from product.diagnose.executors import FakeExecutor
from product.diagnose.loaders import load_policy, load_skill
from product.diagnose.planner import build_plan
from product.diagnose.session import run_diagnosis


ROOT = Path(__file__).resolve().parents[2]
SKILL_PATH = ROOT / "product" / "skills" / "linux-basic-health" / "checks.yaml"
POLICY_PATH = ROOT / "product" / "policy" / "risk_rules.yaml"


def _plan():
    return build_plan("prod-1", load_skill(SKILL_PATH), load_policy(POLICY_PATH))


def test_run_diagnosis_records_completed_results(tmp_path):
    executor = FakeExecutor({"uptime": {"exit_code": 0, "stdout": "up 1 day"}})

    session = run_diagnosis(_plan(), executor, reports_dir=tmp_path)

    assert session.host == "prod-1"
    assert session.report_path is not None
    assert session.results[0].status == "completed"
    assert session.counts()["completed"] >= 1
    assert Path(session.report_path).exists()


def test_run_diagnosis_records_nonzero_as_failed(tmp_path):
    executor = FakeExecutor({"uptime": {"exit_code": 1, "stdout": "permission denied"}})

    session = run_diagnosis(_plan(), executor, reports_dir=tmp_path)

    assert session.results[0].status == "failed"
    assert session.results[0].exit_code == 1
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
python -m pytest product/tests/test_session_cli.py -q
```

Expected: FAIL because `executors.py` and `session.py` do not exist.

- [ ] **Step 3: Add executors**

Create `apps/winkterm/product/diagnose/executors.py`:

```python
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ExecutionResponse:
    exit_code: int | None
    stdout: str
    timed_out: bool = False
    message: str = ""
    duration_ms: int = 0


class CommandExecutor(Protocol):
    def run(self, command: str, timeout_seconds: int) -> ExecutionResponse:
        ...


class FakeExecutor:
    def __init__(self, responses: dict[str, dict]):
        self.responses = responses

    def run(self, command: str, timeout_seconds: int) -> ExecutionResponse:
        started = time.monotonic()
        raw = self.responses.get(command, {"exit_code": 0, "stdout": ""})
        return ExecutionResponse(
            exit_code=raw.get("exit_code"),
            stdout=raw.get("stdout", ""),
            timed_out=bool(raw.get("timed_out", False)),
            message=raw.get("message", ""),
            duration_ms=int((time.monotonic() - started) * 1000),
        )


class AgentApiExecutor:
    def __init__(self, base_url: str, token: str, connection_id: str):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.connection_id = connection_id

    def run(self, command: str, timeout_seconds: int) -> ExecutionResponse:
        started = time.monotonic()
        payload = json.dumps({"command": command, "timeout": timeout_seconds}).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/api/agent/ssh/{self.connection_id}/run",
            data=payload,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout_seconds + 5) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError as exc:
            raise RuntimeError(f"agent API SSH execution failed: {exc}") from exc

        duration_ms = int((time.monotonic() - started) * 1000)
        timed_out = data.get("reason") == "timeout"
        return ExecutionResponse(
            exit_code=data.get("exit_code"),
            stdout=data.get("stdout", ""),
            timed_out=timed_out,
            message=data.get("reason") or "",
            duration_ms=duration_ms,
        )
```

- [ ] **Step 4: Add session orchestrator**

Create `apps/winkterm/product/diagnose/session.py`:

```python
from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from product.diagnose.executors import CommandExecutor
from product.diagnose.models import CheckResult, DiagnosisPlan, DiagnosisSession
from product.diagnose.reports import write_markdown_report


def _result_status(exit_code: int | None, timed_out: bool) -> str:
    if timed_out:
        return "timed_out"
    if exit_code == 0:
        return "completed"
    return "failed"


def run_diagnosis(plan: DiagnosisPlan, executor: CommandExecutor, reports_dir: Path) -> DiagnosisSession:
    session = DiagnosisSession(
        session_id=f"diag-{uuid4().hex[:12]}",
        host=plan.host,
        profile=plan.profile,
        plan=plan,
    )
    for check in plan.checks:
        response = executor.run(check.command, check.timeout_seconds)
        session.results.append(
            CheckResult(
                id=check.id,
                command=check.command,
                status=_result_status(response.exit_code, response.timed_out),
                reason=check.reason,
                timeout_seconds=check.timeout_seconds,
                exit_code=response.exit_code,
                duration_ms=response.duration_ms,
                stdout=response.stdout,
                message=response.message,
            )
        )
    completed = session.counts()["completed"]
    failed = session.counts()["failed"]
    timed_out = session.counts()["timed_out"]
    session.summary = f"{completed} checks completed, {failed} failed, {timed_out} timed out"
    session.report_path = str(write_markdown_report(session, reports_dir))
    return session
```

- [ ] **Step 5: Run tests and observe report import failure**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
python -m pytest product/tests/test_session_cli.py -q
```

Expected: FAIL with `ModuleNotFoundError` for `product.diagnose.reports`.

Commit is not allowed yet.

---

## Task 4: Markdown Report Renderer

**Files:**
- Create: `apps/winkterm/product/diagnose/reports.py`
- Modify: `apps/winkterm/product/tests/test_planner_reports.py`
- Test: `apps/winkterm/product/tests/test_session_cli.py`

- [ ] **Step 1: Add report renderer test**

Append to `apps/winkterm/product/tests/test_planner_reports.py`:

```python
from product.diagnose.executors import FakeExecutor
from product.diagnose.reports import render_markdown_report
from product.diagnose.session import run_diagnosis


def test_markdown_report_contains_plan_and_evidence(tmp_path):
    plan = build_plan("prod-1", load_skill(SKILL_PATH), load_policy(POLICY_PATH))
    session = run_diagnosis(plan, FakeExecutor({"uptime": {"exit_code": 0, "stdout": "up"}}), tmp_path)

    text = render_markdown_report(session)

    assert "# Diagnosis Report" in text
    assert "prod-1" in text
    assert "uptime" in text
    assert "up" in text
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
python -m pytest product/tests/test_planner_reports.py product/tests/test_session_cli.py -q
```

Expected: FAIL because `reports.py` does not exist.

- [ ] **Step 3: Add report renderer**

Create `apps/winkterm/product/diagnose/reports.py`:

```python
from __future__ import annotations

from pathlib import Path

from product.diagnose.models import DiagnosisSession


def _clip(text: str, limit: int = 4000) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n...[truncated]"


def render_markdown_report(session: DiagnosisSession) -> str:
    lines = [
        "# Diagnosis Report",
        "",
        f"- Session: `{session.session_id}`",
        f"- Host: `{session.host}`",
        f"- Profile: `{session.profile}`",
        f"- Summary: {session.summary}",
        "",
        "## Approved Plan",
        "",
    ]
    for check in session.plan.checks:
        lines.append(f"- `{check.command}`; timeout {check.timeout_seconds}s; reason: {check.reason}")
    lines.extend(["", "## Evidence", ""])
    for result in session.results:
        lines.append(f"### {result.id}: {result.status}")
        lines.append("")
        lines.append(f"- Command: `{result.command}`")
        lines.append(f"- Exit code: `{result.exit_code}`")
        lines.append(f"- Duration: `{result.duration_ms}` ms")
        if result.message:
            lines.append(f"- Message: {result.message}")
        lines.append("")
        lines.append("```text")
        lines.append(_clip(result.stdout))
        lines.append("```")
        lines.append("")
    lines.extend(
        [
            "## Next Checks",
            "",
            "Review failed or timed-out checks first. Repair commands are not executed by this milestone.",
        ]
    )
    return "\n".join(lines)


def write_markdown_report(session: DiagnosisSession, reports_dir: Path) -> Path:
    reports_dir.mkdir(parents=True, exist_ok=True)
    path = reports_dir / f"{session.session_id}.md"
    path.write_text(render_markdown_report(session), encoding="utf-8")
    return path
```

- [ ] **Step 4: Run tests and commit**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
python -m pytest product/tests/test_planner_reports.py product/tests/test_session_cli.py -q
```

Expected: PASS.

Commit:

```powershell
git add apps/winkterm/product/diagnose/reports.py apps/winkterm/product/tests/test_planner_reports.py apps/winkterm/product/tests/test_session_cli.py
git commit -m "feat: add diagnosis report rendering"
```

---

## Task 5: CLI Implementation With Fake and Agent API Modes

**Files:**
- Create: `apps/winkterm/product/cli/__init__.py`
- Create: `apps/winkterm/product/cli/ssh_ai.py`
- Modify: `apps/winkterm/product/tests/test_session_cli.py`

- [ ] **Step 1: Add CLI tests**

Append to `apps/winkterm/product/tests/test_session_cli.py`:

```python
import json

from product.cli.ssh_ai import main


def test_cli_json_fake_executor_outputs_schema(tmp_path, capsys):
    exit_code = main(
        [
            "diagnose",
            "prod-1",
            "--profile",
            "linux-basic",
            "--yes",
            "--fake",
            "--json",
            "--reports-dir",
            str(tmp_path),
        ]
    )

    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert exit_code == 0
    assert payload["status"] == "completed"
    assert payload["exit_code"] == 0
    assert payload["host"] == "prod-1"
    assert payload["profile"] == "linux-basic-health"
    assert payload["report_path"]
    assert payload["counts"]["completed"] == 7


def test_cli_rejects_without_yes_when_user_says_no(tmp_path, monkeypatch):
    monkeypatch.setattr("builtins.input", lambda _: "n")

    exit_code = main(["diagnose", "prod-1", "--profile", "linux-basic", "--fake", "--reports-dir", str(tmp_path)])

    assert exit_code == 1
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
python -m pytest product/tests/test_session_cli.py -q
```

Expected: FAIL because `product.cli.ssh_ai` does not exist.

- [ ] **Step 3: Add CLI package**

Create `apps/winkterm/product/cli/__init__.py`:

```python
"""Command-line entry points for the product diagnosis workflow."""
```

Create `apps/winkterm/product/cli/ssh_ai.py`:

```python
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from product.diagnose.executors import AgentApiExecutor, FakeExecutor
from product.diagnose.loaders import load_policy, load_skill
from product.diagnose.planner import build_plan, render_plan_text
from product.diagnose.session import run_diagnosis


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SKILL = ROOT / "product" / "skills" / "linux-basic-health" / "checks.yaml"
DEFAULT_POLICY = ROOT / "product" / "policy" / "risk_rules.yaml"


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ssh-ai")
    sub = parser.add_subparsers(dest="command", required=True)
    diagnose = sub.add_parser("diagnose")
    diagnose.add_argument("host")
    diagnose.add_argument("--profile", default="linux-basic")
    diagnose.add_argument("--base-url", default="http://127.0.0.1:8000")
    diagnose.add_argument("--token", default="")
    diagnose.add_argument("--connection-id", default="")
    diagnose.add_argument("--reports-dir", default="reports")
    diagnose.add_argument("--json", action="store_true")
    diagnose.add_argument("--yes", action="store_true")
    diagnose.add_argument("--fake", action="store_true")
    return parser


def _fake_responses(plan):
    return {check.command: {"exit_code": 0, "stdout": f"{check.id}: ok"} for check in plan.checks}


def _print_json(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    if args.command != "diagnose":
        return 2
    if args.profile != "linux-basic":
        print(f"unsupported profile: {args.profile}", file=sys.stderr)
        return 2

    skill = load_skill(DEFAULT_SKILL)
    policy = load_policy(DEFAULT_POLICY)
    plan = build_plan(args.host, skill, policy)
    print(render_plan_text(plan), file=sys.stderr if args.json else sys.stdout)
    if not args.yes:
        answer = input("Approve this read-only diagnosis plan? [y/N] ")
        if answer.strip().lower() not in {"y", "yes"}:
            if args.json:
                _print_json(
                    {
                        "status": "rejected",
                        "exit_code": 1,
                        "host": args.host,
                        "profile": skill.name,
                        "session_id": None,
                        "report_path": None,
                        "summary": None,
                        "counts": {"completed": 0, "skipped": 0, "failed": 0, "timed_out": 0},
                        "checks": [],
                        "error": {"code": "user_rejected", "message": "user rejected diagnosis plan"},
                    }
                )
            return 1

    if args.fake:
        executor = FakeExecutor(_fake_responses(plan))
    else:
        if not args.token or not args.connection_id:
            print("--token and --connection-id are required without --fake", file=sys.stderr)
            return 2
        executor = AgentApiExecutor(args.base_url, args.token, args.connection_id)

    try:
        session = run_diagnosis(plan, executor, Path(args.reports_dir))
    except RuntimeError as exc:
        if args.json:
            _print_json(
                {
                    "status": "error",
                    "exit_code": 4,
                    "host": args.host,
                    "profile": skill.name,
                    "session_id": None,
                    "report_path": None,
                    "summary": None,
                    "counts": {"completed": 0, "skipped": 0, "failed": 0, "timed_out": 0},
                    "checks": [],
                    "error": {"code": "ssh_execution_failed", "message": str(exc)},
                }
            )
        else:
            print(str(exc), file=sys.stderr)
        return 4

    payload = session.to_json_dict(exit_code=0)
    if args.json:
        _print_json(payload)
    else:
        print(session.summary)
        print(f"report: {session.report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests and commit**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
python -m pytest product/tests/test_session_cli.py -q
```

Expected: PASS.

Commit:

```powershell
git add apps/winkterm/product/cli apps/winkterm/product/tests/test_session_cli.py
git commit -m "feat: add ssh-ai diagnose cli"
```

---

## Task 6: Full Product Test Sweep and Documentation Update

**Files:**
- Modify: `docs/evaluations/milestone-1-readiness.md`
- Create: `docs/evaluations/milestone-2-diagnosis-loop.md`

- [ ] **Step 1: Add milestone 2 evaluation document**

Create `docs/evaluations/milestone-2-diagnosis-loop.md`:

```markdown
# Milestone 2 Diagnosis Loop

Date: 2026-06-25

## Implemented

- YAML skill loader.
- Command policy evaluator.
- Diagnosis plan renderer.
- Fake executor for local verification.
- WinkTerm Agent API executor.
- Session orchestrator.
- Markdown report renderer.
- `ssh-ai diagnose` CLI implementation.

## Verification

The executor must paste the final pytest command and result here.

## Manual Smoke

The executor must paste the fake-mode CLI command and result here:

```powershell
python -m product.cli.ssh_ai diagnose prod-1 --profile linux-basic --fake --yes --json
```

## Remaining Work

- Resolve host/title to WinkTerm connection ID automatically.
- Add real SSH integration smoke with a test host.
- Package `ssh-ai.exe`.
- Add UI approval surface.
- Re-run Docker packaging validation after firmware virtualization is enabled.
```

- [ ] **Step 2: Run full tests**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
python -m pytest product/tests -q
```

Expected: PASS.

- [ ] **Step 3: Run fake CLI smoke**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
python -m product.cli.ssh_ai diagnose prod-1 --profile linux-basic --fake --yes --json --reports-dir product/test-reports
```

Expected:

- Exit code `0`.
- stdout is JSON.
- JSON contains `"status": "completed"`.
- Report path exists under `product/test-reports`.

- [ ] **Step 4: Clean generated test reports**

Run:

```powershell
Remove-Item -Recurse -Force product/test-reports
```

Expected: directory removed.

- [ ] **Step 5: Update readiness/evaluation docs**

Append to `docs/evaluations/milestone-1-readiness.md`:

```markdown
## Milestone 2 Follow-up

The first implementation slice now has a tested fake-mode diagnosis loop. Real SSH smoke testing and Windows `ssh-ai.exe` packaging remain follow-up work.
```

Fill `docs/evaluations/milestone-2-diagnosis-loop.md` verification sections with the actual command results.

- [ ] **Step 6: Final checks and commit**

Run:

```powershell
git status --short
git diff --check
git ls-files | Select-String -SimpleMatch 'product/test-reports','node_modules','.venv','external/'
```

Expected:

- Only intended docs are modified before commit.
- No generated reports, dependency directories, or external clones are tracked.

Commit:

```powershell
git add docs/evaluations/milestone-1-readiness.md docs/evaluations/milestone-2-diagnosis-loop.md
git commit -m "docs: record diagnosis loop implementation status"
```

---

## Verification Checklist

After all tasks:

- [ ] `python -m pytest product/tests -q` passes from `apps/winkterm`.
- [ ] `python -m product.cli.ssh_ai diagnose prod-1 --profile linux-basic --fake --yes --json` exits `0`.
- [ ] CLI JSON contains required contract fields.
- [ ] A Markdown report is generated in fake mode.
- [ ] Generated report directories are not committed.
- [ ] No upstream WinkTerm source outside `apps/winkterm/product/` was modified.
- [ ] `git status --short` is clean.

