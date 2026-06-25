from __future__ import annotations

from product.diagnose.models import DiagnosisPlan, PolicyRules, SkillDefinition
from product.diagnose.policy import evaluate_command


def build_plan(
    host: str,
    skill: SkillDefinition,
    policy: PolicyRules,
) -> DiagnosisPlan:
    for check in skill.checks:
        decision = evaluate_command(check.command, policy)
        if not decision.allowed:
            raise ValueError(
                f"check {check.id} command rejected by policy: {decision.reason}"
            )
        if check.timeout_seconds != policy.command_timeout_seconds:
            raise ValueError(
                f"check {check.id} timeout_seconds must match policy "
                f"command_timeout_seconds"
            )

    return DiagnosisPlan(
        host=host,
        profile=skill.name,
        checks=skill.checks,
    )


def render_plan_text(plan: DiagnosisPlan) -> str:
    lines = [
        f"诊断计划：{plan.host}",
        f"配置：{plan.profile}",
        "检查：",
    ]
    for check in plan.checks:
        lines.append(f"- {check.id}")
        lines.append(f"  命令：{check.command}")
        lines.append(f"  原因：{check.reason}")
        lines.append(f"  超时 {check.timeout_seconds}s")
    return "\n".join(lines)
