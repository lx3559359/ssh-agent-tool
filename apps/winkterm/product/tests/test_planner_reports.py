from pathlib import Path

import pytest

from product.diagnose.loaders import load_policy, load_skill
from product.diagnose.models import (
    CheckDefinition,
    CheckResult,
    DiagnosisSession,
    PolicyRules,
    SkillDefinition,
)
from product.diagnose.planner import build_plan, render_plan_text
from product.diagnose.reports import render_markdown_report


ROOT = Path(__file__).resolve().parents[2]
SKILL_PATH = ROOT / "product" / "skills" / "linux-basic-health" / "checks.yaml"
POLICY_PATH = ROOT / "product" / "policy" / "risk_rules.yaml"
CPU_COMMAND = "ps -eo pid,user,pcpu,pmem,stat,comm --sort=-pcpu | head -n 16"


def _policy(*, safe_exact=None, blocked_prefixes=None, timeout=10):
    return PolicyRules(
        version=1,
        default_mode="readonly",
        command_timeout_seconds=timeout,
        safe_exact=list(safe_exact or []),
        blocked_prefixes=list(blocked_prefixes or []),
    )


def _skill(checks):
    return SkillDefinition(
        version=1,
        name="linux-basic-health",
        mode="readonly",
        checks=checks,
    )


def _check(command, *, check_id="uptime", timeout=10):
    return CheckDefinition(
        id=check_id,
        command=command,
        reason="load average and uptime",
        risk="safe",
        timeout_seconds=timeout,
    )


def test_build_plan_returns_diagnosis_plan_and_rendered_text():
    skill = load_skill(SKILL_PATH)
    policy = load_policy(POLICY_PATH)

    plan = build_plan("prod-1", skill, policy)
    text = render_plan_text(plan)

    assert plan.host == "prod-1"
    assert plan.profile == "linux-basic-health"
    assert plan.checks == skill.checks
    assert len(plan.checks) == 7
    assert plan.checks[0].command == "uptime"
    assert "诊断计划" in text
    assert "prod-1" in text
    assert "原因：" in text
    assert "超时 10s" in text
    assert CPU_COMMAND in text


@pytest.mark.parametrize(
    ("skill", "policy", "message"),
    [
        (
            _skill([_check("whoami")]),
            _policy(safe_exact=["uptime"]),
            "not_in_safe_exact",
        ),
        (
            _skill([_check("uptime", timeout=5)]),
            _policy(safe_exact=["uptime"], timeout=10),
            "timeout_seconds",
        ),
    ],
)
def test_build_plan_rejects_disallowed_commands_and_timeout_mismatch(
    skill, policy, message
):
    with pytest.raises(ValueError, match=message):
        build_plan("prod-web-01", skill, policy)


def test_render_markdown_report_uses_chinese_sections_and_preserves_output():
    plan = build_plan("prod-1", _skill([_check("uptime")]), _policy(safe_exact=["uptime"]))
    session = DiagnosisSession(
        session_id="session-1",
        host="prod-1",
        profile="linux-basic-health",
        plan=plan,
        summary="1 项检查完成，0 项失败，0 项超时",
        results=[
            CheckResult(
                id="uptime",
                command="uptime",
                status="completed",
                reason="load average and uptime",
                timeout_seconds=10,
                exit_code=0,
                duration_ms=25,
                stdout=" 12:00:00 up 10 days\n",
                message="执行成功",
            )
        ],
    )

    report = render_markdown_report(session)

    assert report.startswith("# 诊断报告")
    assert "## 执行计划" in report
    assert "## 证据" in report
    assert "## 后续检查" in report
    assert "主机：prod-1" in report
    assert "概要：1 项检查完成，0 项失败，0 项超时" in report
    assert "```console\nuptime\n```" in report
    assert "```text\n 12:00:00 up 10 days\n\n```" in report


def test_render_markdown_report_truncates_long_stdout():
    plan = build_plan("prod-1", _skill([_check("uptime")]), _policy(safe_exact=["uptime"]))
    session = DiagnosisSession(
        session_id="session-1",
        host="prod-1",
        profile="linux-basic-health",
        plan=plan,
        results=[
            CheckResult(
                id="uptime",
                command="uptime",
                status="completed",
                reason="load average and uptime",
                timeout_seconds=10,
                exit_code=0,
                stdout="x" * 13000,
            )
        ],
    )

    report = render_markdown_report(session)

    assert "输出已截断" in report
    assert len(report) < 12500
