from __future__ import annotations

from dataclasses import dataclass

from product.diagnose.models import PolicyRules


@dataclass(frozen=True)
class PolicyDecision:
    command: str
    allowed: bool
    reason: str


def evaluate_command(command: str, policy: PolicyRules) -> PolicyDecision:
    normalized = command.strip()

    for prefix in policy.blocked_prefixes:
        normalized_prefix = prefix.strip()
        if normalized == normalized_prefix or normalized.startswith(
            normalized_prefix + " "
        ):
            return PolicyDecision(
                command=normalized,
                allowed=False,
                reason=f"blocked_prefix:{normalized_prefix}",
            )

    if normalized in policy.safe_exact:
        return PolicyDecision(
            command=normalized,
            allowed=True,
            reason="safe_exact",
        )

    return PolicyDecision(
        command=normalized,
        allowed=False,
        reason="not_in_safe_exact",
    )
