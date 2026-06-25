from pathlib import Path

from product.diagnose.executors import ExecutionResponse, FakeExecutor
from product.diagnose.models import CheckDefinition, DiagnosisPlan
from product.diagnose.session import run_diagnosis


def _check(check_id, command):
    return CheckDefinition(
        id=check_id,
        command=command,
        reason=f"{check_id} reason",
        risk="safe",
        timeout_seconds=10,
    )


def test_run_diagnosis_executes_checks_and_writes_chinese_report(tmp_path):
    plan = DiagnosisPlan(
        host="prod-1",
        profile="linux-basic-health",
        checks=[
            _check("uptime", "uptime"),
            _check("disk", "df -hT"),
        ],
    )
    executor = FakeExecutor(
        {
            "uptime": ExecutionResponse(
                exit_code=0,
                stdout="up 10 days\n",
                duration_ms=12,
            ),
            "df -hT": ExecutionResponse(
                exit_code=1,
                stdout="disk warning\n",
                message="磁盘命令返回非零状态",
                duration_ms=18,
            ),
        }
    )

    session = run_diagnosis(plan, executor, tmp_path)

    assert [call.command for call in executor.calls] == ["uptime", "df -hT"]
    assert [result.status for result in session.results] == ["completed", "failed"]
    assert session.summary == "2 项检查完成，1 项失败，0 项超时"
    assert session.report_path is not None
    report = Path(session.report_path)
    assert report.exists()
    text = report.read_text(encoding="utf-8")
    assert text.startswith("# 诊断报告")
    assert "## 执行计划" in text
    assert "## 证据" in text
    assert "up 10 days" in text


def test_run_diagnosis_maps_timeout_response(tmp_path):
    plan = DiagnosisPlan(
        host="prod-1",
        profile="linux-basic-health",
        checks=[_check("slow", "sleep 20")],
    )
    executor = FakeExecutor(
        {
            "sleep 20": ExecutionResponse(
                exit_code=None,
                timed_out=True,
                message="命令执行超时",
                duration_ms=10000,
            )
        }
    )

    session = run_diagnosis(plan, executor, tmp_path)

    assert session.results[0].status == "timed_out"
    assert session.results[0].message == "命令执行超时"
    assert session.summary == "1 项检查完成，0 项失败，1 项超时"
