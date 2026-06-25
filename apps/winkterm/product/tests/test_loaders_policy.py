from pathlib import Path

import pytest

from product.diagnose.loaders import load_policy, load_skill
from product.diagnose.models import PolicyRules
from product.diagnose.policy import evaluate_command


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


def test_load_skill_rejects_checks_that_are_not_list(tmp_path):
    path = tmp_path / "checks.yaml"
    path.write_text(
        """
version: 1
name: invalid
mode: readonly
checks:
  id: x
  command: uptime
""".strip(),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="checks"):
        load_skill(path)


def test_load_skill_rejects_check_missing_command(tmp_path):
    path = tmp_path / "checks.yaml"
    path.write_text(
        """
version: 1
name: invalid
mode: readonly
checks:
  - id: x
    reason: load
    risk: safe
    timeout_seconds: 10
""".strip(),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match=r"checks\[0\]\.command"):
        load_skill(path)


def test_load_policy_rejects_missing_command_timeout_seconds(tmp_path):
    path = tmp_path / "risk_rules.yaml"
    path.write_text(
        """
version: 1
default_mode: readonly
safe_exact: []
blocked_prefixes: []
""".strip(),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="command_timeout_seconds"):
        load_policy(path)


def test_load_policy_wraps_malformed_yaml(tmp_path):
    path = tmp_path / "risk_rules.yaml"
    path.write_text("version: [1\n", encoding="utf-8")

    with pytest.raises(ValueError, match="YAML"):
        load_policy(path)


def test_policy_evaluator_allows_exact_safe_command():
    policy = load_policy(POLICY_PATH)

    decision = evaluate_command("uptime", policy)

    assert decision.allowed is True
    assert decision.reason == "safe_exact"


def test_policy_evaluator_blocked_prefix_takes_priority_over_unknown():
    policy = load_policy(POLICY_PATH)

    decision = evaluate_command("rm -rf /tmp/example", policy)

    assert decision.allowed is False
    assert decision.reason == "blocked_prefix:rm"


def test_policy_evaluator_does_not_block_similar_prefix_commands():
    policy = load_policy(POLICY_PATH)

    rmdir_decision = evaluate_command("rmdir /tmp/x", policy)
    restartx_decision = evaluate_command("systemctl restartx nginx", policy)

    assert rmdir_decision.allowed is False
    assert rmdir_decision.reason == "not_in_safe_exact"
    assert restartx_decision.allowed is False
    assert restartx_decision.reason == "not_in_safe_exact"


def test_policy_evaluator_blocked_prefix_takes_priority_over_safe_exact():
    policy = PolicyRules(
        version=1,
        default_mode="readonly",
        command_timeout_seconds=10,
        safe_exact=["rm -rf /tmp/example"],
        blocked_prefixes=["rm"],
    )

    decision = evaluate_command("rm -rf /tmp/example", policy)

    assert decision.allowed is False
    assert decision.reason == "blocked_prefix:rm"


def test_policy_evaluator_rejects_unknown_command():
    policy = load_policy(POLICY_PATH)

    decision = evaluate_command("whoami", policy)

    assert decision.allowed is False
    assert decision.reason == "not_in_safe_exact"
