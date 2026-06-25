import json
from pathlib import Path

from product.diagnose.executors import ExecutionResponse, FakeExecutor
from product.diagnose.models import CheckDefinition, DiagnosisPlan
from product.diagnose.session import run_diagnosis
from product.cli.ssh_ai import main


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


def test_cli_diagnose_fake_json_writes_plan_to_stderr_and_json_to_stdout(
    tmp_path, capsys
):
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
    assert Path(payload["report_path"]).exists()
    assert payload["counts"]["completed"] == 7
    assert "诊断计划" in captured.err
    assert captured.out.strip().startswith("{")


def test_cli_diagnose_rejects_when_user_declines(tmp_path, monkeypatch, capsys):
    prompts = []
    monkeypatch.setattr(
        "builtins.input",
        lambda prompt="": prompts.append(prompt) or "n",
    )

    exit_code = main(
        [
            "diagnose",
            "prod-1",
            "--profile",
            "linux-basic",
            "--fake",
            "--json",
            "--reports-dir",
            str(tmp_path),
        ]
    )

    captured = capsys.readouterr()
    payload = json.loads(captured.out)

    assert exit_code == 1
    assert payload["status"] == "error"
    assert payload["exit_code"] == 1
    assert payload["error"]["message"] == "用户取消执行诊断计划"
    assert prompts == [""]
    assert "是否执行以上只读诊断计划？[y/N]" in captured.err


def test_cli_diagnose_requires_token_and_connection_id_without_fake(tmp_path, capsys):
    exit_code = main(
        [
            "diagnose",
            "prod-1",
            "--profile",
            "linux-basic",
            "--yes",
            "--json",
            "--reports-dir",
            str(tmp_path),
        ]
    )

    captured = capsys.readouterr()
    payload = json.loads(captured.out)

    assert exit_code == 2
    assert "非 fake 模式必须提供 --token 和 --connection-id" in captured.err
    assert payload["error"]["message"] == "非 fake 模式必须提供 --token 和 --connection-id"


def test_cli_diagnose_rejects_unsupported_profile(tmp_path, capsys):
    exit_code = main(
        [
            "diagnose",
            "prod-1",
            "--profile",
            "ubuntu-full",
            "--yes",
            "--fake",
            "--json",
            "--reports-dir",
            str(tmp_path),
        ]
    )

    captured = capsys.readouterr()
    payload = json.loads(captured.out)

    assert exit_code == 2
    assert "不支持的诊断配置" in captured.err
    assert payload["error"]["message"] == "不支持的诊断配置：ubuntu-full"


def test_cli_diagnose_agent_runtime_error_returns_execution_failed(
    tmp_path, monkeypatch, capsys
):
    class BrokenExecutor:
        def __init__(self, base_url, connection_id, *, token=None):
            pass

        def run(self, command, timeout_seconds):
            raise RuntimeError("SSH 命令接口调用失败：网络不可达")

    monkeypatch.setattr("product.cli.ssh_ai.AgentApiExecutor", BrokenExecutor)

    exit_code = main(
        [
            "diagnose",
            "prod-1",
            "--profile",
            "linux-basic",
            "--yes",
            "--json",
            "--token",
            "secret",
            "--connection-id",
            "conn-1",
            "--reports-dir",
            str(tmp_path),
        ]
    )

    captured = capsys.readouterr()
    payload = json.loads(captured.out)

    assert exit_code == 4
    assert payload["status"] == "error"
    assert payload["exit_code"] == 4
    assert payload["error"]["code"] == "ssh_execution_failed"
    assert payload["error"]["message"] == "SSH 命令接口调用失败：网络不可达"


def test_cli_default_reports_dir_uses_user_data_location(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("SSH_AI_REPORTS_DIR", str(tmp_path / "user-reports"))

    exit_code = main(
        [
            "diagnose",
            "prod-1",
            "--profile",
            "linux-basic",
            "--yes",
            "--fake",
            "--json",
        ]
    )

    captured = capsys.readouterr()
    payload = json.loads(captured.out)

    assert exit_code == 0
    assert Path(payload["report_path"]).parent == tmp_path / "user-reports"
    assert Path(payload["report_path"]).exists()


def test_cli_no_args_runs_double_click_preview(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("SSH_AI_REPORTS_DIR", str(tmp_path))
    answers = iter(["", ""])
    monkeypatch.setattr("builtins.input", lambda prompt="": next(answers))

    exit_code = main([])

    captured = capsys.readouterr()
    reports = list(tmp_path.glob("*.md"))

    assert exit_code == 0
    assert "双击预览模式" in captured.out
    assert "未连接真实服务器" in captured.out
    assert "诊断完成" in captured.out
    assert "按回车退出" in captured.out
    assert len(reports) == 1
