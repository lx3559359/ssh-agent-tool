from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence, TextIO

from product.cli.runtime import (
    configure_console_encoding,
    default_reports_dir,
    product_root,
)
from product.diagnose.executors import AgentApiExecutor, ExecutionResponse, FakeExecutor
from product.diagnose.loaders import load_policy, load_skill
from product.diagnose.models import DiagnosisPlan
from product.diagnose.planner import build_plan
from product.diagnose.session import run_diagnosis


SUPPORTED_PROFILES = {"linux-basic": "linux-basic-health"}


def main(argv: Sequence[str] | None = None) -> int:
    configure_console_encoding()
    args = _parser().parse_args(argv)
    if args.command == "diagnose":
        return _run_diagnose(args, stdout=sys.stdout, stderr=sys.stderr)
    return 2


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ssh-ai", description="SSH AI 诊断工具")
    subparsers = parser.add_subparsers(dest="command", required=True)

    diagnose = subparsers.add_parser("diagnose", help="执行只读 SSH 诊断")
    diagnose.add_argument("host")
    diagnose.add_argument("--profile", default="linux-basic")
    diagnose.add_argument("--base-url", default="http://127.0.0.1:8000")
    diagnose.add_argument("--token", default="")
    diagnose.add_argument("--connection-id", default="")
    diagnose.add_argument("--reports-dir", default=None)
    diagnose.add_argument("--json", action="store_true")
    diagnose.add_argument("--yes", action="store_true")
    diagnose.add_argument("--fake", action="store_true")
    return parser


def _run_diagnose(args: argparse.Namespace, *, stdout: TextIO, stderr: TextIO) -> int:
    if args.profile not in SUPPORTED_PROFILES:
        return _emit_error(
            "unsupported_profile",
            f"不支持的诊断配置：{args.profile}",
            2,
            as_json=args.json,
            stdout=stdout,
            stderr=stderr,
        )

    try:
        plan = _load_plan(args.host, SUPPORTED_PROFILES[args.profile])
    except (OSError, ValueError) as exc:
        return _emit_error(
            "plan_build_failed",
            f"诊断计划加载失败：{exc}",
            2,
            as_json=args.json,
            stdout=stdout,
            stderr=stderr,
        )

    plan_text = _render_plan_text(plan)
    print(plan_text, file=stderr if args.json else stdout)

    if not args.yes:
        answer = _confirm(
            "是否执行以上只读诊断计划？[y/N] ",
            prompt_stream=stderr if args.json else stdout,
        )
        if answer not in {"y", "yes"}:
            return _emit_error(
                "user_cancelled",
                "用户取消执行诊断计划",
                1,
                as_json=args.json,
                stdout=stdout,
                stderr=stderr,
                stderr_message=False,
            )

    if not args.fake and (not args.token or not args.connection_id):
        return _emit_error(
            "missing_agent_credentials",
            "非 fake 模式必须提供 --token 和 --connection-id",
            2,
            as_json=args.json,
            stdout=stdout,
            stderr=stderr,
        )

    executor = (
        _fake_executor(plan)
        if args.fake
        else AgentApiExecutor(args.base_url, args.connection_id, token=args.token)
    )

    try:
        reports_dir = Path(args.reports_dir) if args.reports_dir else default_reports_dir()
        session = run_diagnosis(plan, executor, reports_dir)
    except RuntimeError as exc:
        return _emit_error(
            "ssh_execution_failed",
            str(exc),
            4,
            as_json=args.json,
            stdout=stdout,
            stderr=stderr,
        )

    runtime_error = None if args.fake else _runtime_error_message(session)
    if runtime_error:
        return _emit_error(
            "ssh_execution_failed",
            runtime_error,
            4,
            as_json=args.json,
            stdout=stdout,
            stderr=stderr,
        )

    if args.json:
        print(
            json.dumps(session.to_json_dict(exit_code=0), ensure_ascii=False),
            file=stdout,
        )
    else:
        print("", file=stdout)
        print("诊断完成", file=stdout)
        print(f"摘要：{session.summary}", file=stdout)
        print(f"报告路径：{session.report_path}", file=stdout)
    return 0


def _confirm(prompt: str, *, prompt_stream: TextIO) -> str:
    print(prompt, end="", file=prompt_stream, flush=True)
    return input("").strip().lower()


def _load_plan(host: str, profile_name: str) -> DiagnosisPlan:
    root = product_root()
    skill = load_skill(root / "skills" / profile_name / "checks.yaml")
    policy = load_policy(root / "policy" / "risk_rules.yaml")
    return build_plan(host, skill, policy)


def _render_plan_text(plan: DiagnosisPlan) -> str:
    lines = [
        f"诊断计划：{plan.host}",
        f"配置：{plan.profile}",
        "检查：",
    ]
    for check in plan.checks:
        lines.append(f"- {check.id}")
        lines.append(f"  命令：{check.command}")
        lines.append(f"  原因：{check.reason}")
        lines.append(f"  超时：{check.timeout_seconds}s")
    return "\n".join(lines)


def _fake_executor(plan: DiagnosisPlan) -> FakeExecutor:
    return FakeExecutor(
        {
            check.command: ExecutionResponse(
                exit_code=0,
                stdout=f"{check.id}: 正常\n",
                message="执行成功",
                duration_ms=0,
            )
            for check in plan.checks
        }
    )


def _runtime_error_message(session) -> str | None:
    for result in session.results:
        if result.status == "failed" and result.exit_code is None and result.message:
            return result.message
    return None


def _emit_error(
    code: str,
    message: str,
    exit_code: int,
    *,
    as_json: bool,
    stdout: TextIO,
    stderr: TextIO,
    stderr_message: bool = True,
) -> int:
    if stderr_message:
        print(f"错误：{message}", file=stderr)
    if as_json:
        print(
            json.dumps(
                {
                    "status": "error",
                    "exit_code": exit_code,
                    "error": {
                        "code": code,
                        "message": message,
                    },
                },
                ensure_ascii=False,
            ),
            file=stdout,
        )
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
