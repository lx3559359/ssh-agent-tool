from __future__ import annotations

from pathlib import Path

from product.diagnose.models import CheckResult, DiagnosisSession


STDOUT_LIMIT = 10000


def render_markdown_report(session: DiagnosisSession) -> str:
    counts = session.counts()
    lines = [
        "# 诊断报告",
        "",
        f"主机：{session.host}",
        f"配置：{session.profile}",
        f"会话：{session.session_id}",
        f"概要：{session.summary or _summary_from_counts(len(session.results), counts)}",
        "",
        "## 执行计划",
        "",
    ]
    for check in session.plan.checks:
        lines.extend(
            [
                f"- {check.id}",
                f"  - 命令：`{check.command}`",
                f"  - 原因：{check.reason}",
                f"  - 超时：{check.timeout_seconds}s",
            ]
        )

    lines.extend(["", "## 证据", ""])
    if not session.results:
        lines.append("尚未记录检查结果。")
    for result in session.results:
        lines.extend(_render_result(result))

    lines.extend(
        [
            "",
            "## 后续检查",
            "",
        ]
    )
    if counts["failed"] or counts["timed_out"]:
        lines.append("建议优先复核失败或超时的检查项，再决定是否需要人工批准修复操作。")
    else:
        lines.append("当前只读检查未发现失败或超时项；如仍有异常，请结合业务日志继续定位。")

    return "\n".join(lines).rstrip() + "\n"


def write_markdown_report(session: DiagnosisSession, reports_dir: str | Path) -> Path:
    path = Path(reports_dir)
    path.mkdir(parents=True, exist_ok=True)
    report_path = path / f"{session.session_id}.md"
    report_path.write_text(render_markdown_report(session), encoding="utf-8")
    return report_path


def _render_result(result: CheckResult) -> list[str]:
    lines = [
        f"### {result.id}",
        "",
        f"- 状态：{_status_label(result.status)}",
        f"- 原因：{result.reason}",
        f"- 退出码：{_display_value(result.exit_code)}",
        f"- 耗时：{_display_duration(result.duration_ms)}",
    ]
    if result.message:
        lines.append(f"- 消息：{result.message}")
    lines.extend(
        [
            "",
            "命令：",
            "```console",
            result.command,
            "```",
            "",
            "输出：",
            "```text",
            _truncate_stdout(result.stdout),
            "```",
            "",
        ]
    )
    return lines


def _truncate_stdout(stdout: str) -> str:
    if len(stdout) <= STDOUT_LIMIT:
        return stdout
    omitted = len(stdout) - STDOUT_LIMIT
    return f"{stdout[:STDOUT_LIMIT]}\n\n[输出已截断，省略 {omitted} 字符]"


def _status_label(status: str) -> str:
    labels = {
        "planned": "已计划",
        "completed": "已完成",
        "failed": "失败",
        "timed_out": "超时",
        "skipped": "已跳过",
    }
    return labels.get(status, status)


def _display_value(value: object) -> str:
    if value is None:
        return "无"
    return str(value)


def _display_duration(duration_ms: int | None) -> str:
    if duration_ms is None:
        return "无"
    return f"{duration_ms}ms"


def _summary_from_counts(total: int, counts: dict[str, int]) -> str:
    return (
        f"{total} 项检查完成，"
        f"{counts.get('failed', 0)} 项失败，"
        f"{counts.get('timed_out', 0)} 项超时"
    )
