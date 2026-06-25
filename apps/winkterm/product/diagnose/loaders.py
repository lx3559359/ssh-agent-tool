from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from product.diagnose.models import CheckDefinition, PolicyRules, SkillDefinition


def _read_yaml(path: Path) -> dict[str, Any]:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ValueError(f"{path}: YAML parse failed: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a YAML mapping")
    return data


def _field_error(path: Path, field_path: str, message: str) -> ValueError:
    return ValueError(f"{path}:{field_path} {message}")


def _required(data: dict[str, Any], key: str, path: Path, field_path: str) -> Any:
    if key not in data:
        raise _field_error(path, field_path, "is required")
    return data[key]


def _require_mapping(value: Any, path: Path, field_path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _field_error(path, field_path, "must be a mapping")
    return value


def _require_str(data: dict[str, Any], key: str, path: Path, field_path: str) -> str:
    value = _required(data, key, path, field_path)
    if not isinstance(value, str):
        raise _field_error(path, field_path, "must be a string")
    return value


def _require_int(data: dict[str, Any], key: str, path: Path, field_path: str) -> int:
    value = _required(data, key, path, field_path)
    if not isinstance(value, int) or isinstance(value, bool):
        raise _field_error(path, field_path, "must be an integer")
    return value


def _require_positive_int(
    data: dict[str, Any], key: str, path: Path, field_path: str
) -> int:
    value = _require_int(data, key, path, field_path)
    if value <= 0:
        raise _field_error(path, field_path, "must be a positive integer")
    return value


def _optional_str_list(
    data: dict[str, Any], key: str, path: Path, field_path: str
) -> list[str]:
    value = data.get(key, [])
    if not isinstance(value, list):
        raise _field_error(path, field_path, "must be a list")
    for index, item in enumerate(value):
        if not isinstance(item, str):
            raise _field_error(path, f"{field_path}[{index}]", "must be a string")
    return value


def load_skill(path: Path) -> SkillDefinition:
    data = _read_yaml(path)
    mode = _require_str(data, "mode", path, "mode")
    if mode != "readonly":
        raise ValueError("diagnosis skills must use readonly mode")

    raw_checks = _required(data, "checks", path, "checks")
    if not isinstance(raw_checks, list):
        raise _field_error(path, "checks", "must be a list")

    checks: list[CheckDefinition] = []
    for index, raw in enumerate(raw_checks):
        field_path = f"checks[{index}]"
        raw = _require_mapping(raw, path, field_path)
        checks.append(
            CheckDefinition(
                id=_require_str(raw, "id", path, f"{field_path}.id"),
                command=_require_str(raw, "command", path, f"{field_path}.command"),
                reason=_require_str(raw, "reason", path, f"{field_path}.reason"),
                risk=_require_str(raw, "risk", path, f"{field_path}.risk"),
                timeout_seconds=_require_positive_int(
                    raw, "timeout_seconds", path, f"{field_path}.timeout_seconds"
                ),
            )
        )

    if not checks:
        raise ValueError("diagnosis skill must define at least one check")

    return SkillDefinition(
        version=_require_int(data, "version", path, "version"),
        name=_require_str(data, "name", path, "name"),
        mode=mode,
        checks=checks,
    )


def load_policy(path: Path) -> PolicyRules:
    data = _read_yaml(path)
    default_mode = _require_str(data, "default_mode", path, "default_mode")
    if default_mode != "readonly":
        raise ValueError("policy default_mode must be readonly")

    return PolicyRules(
        version=_require_int(data, "version", path, "version"),
        default_mode=default_mode,
        command_timeout_seconds=_require_positive_int(
            data,
            "command_timeout_seconds",
            path,
            "command_timeout_seconds",
        ),
        safe_exact=_optional_str_list(data, "safe_exact", path, "safe_exact"),
        blocked_prefixes=_optional_str_list(
            data, "blocked_prefixes", path, "blocked_prefixes"
        ),
    )
