from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from product.diagnose.executors import CommandExecutor, ExecutionResponse
from product.diagnose.models import CheckResult, CheckStatus, DiagnosisPlan, DiagnosisSession
from product.diagnose.reports import write_markdown_report


def run_diagnosis(
    plan: DiagnosisPlan,
    executor: CommandExecutor,
    reports_dir: str | Path,
) -> DiagnosisSession:
    session = DiagnosisSession(
        session_id=f"diagnosis-{uuid4().hex}",
        host=plan.host,
        profile=plan.profile,
        plan=plan,
    )

    for check in plan.checks:
        try:
            response = executor.run(check.command, check.timeout_seconds)
        except RuntimeError as exc:
            response = ExecutionResponse(
                exit_code=None,
                message=str(exc),
            )

        status = _status_from_response(response)
        session.results.append(
            CheckResult(
                id=check.id,
                command=check.command,
                status=status,
                reason=check.reason,
                timeout_seconds=check.timeout_seconds,
                exit_code=response.exit_code,
                duration_ms=response.duration_ms,
                stdout=response.stdout,
                message=response.message or _default_message(status),
            )
        )

    counts = session.counts()
    session.summary = (
        f"{len(session.results)} 项检查完成，"
        f"{counts['failed']} 项失败，"
        f"{counts['timed_out']} 项超时"
    )
    session.report_path = str(write_markdown_report(session, reports_dir))
    return session


def _status_from_response(response: ExecutionResponse) -> CheckStatus:
    if response.timed_out:
        return "timed_out"
    if response.exit_code == 0:
        return "completed"
    return "failed"


def _default_message(status: CheckStatus) -> str:
    if status == "completed":
        return "执行成功"
    if status == "timed_out":
        return "命令执行超时"
    if status == "failed":
        return "命令执行失败"
    return ""
