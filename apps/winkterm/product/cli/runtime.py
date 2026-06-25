from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import TextIO


def configure_console_encoding(
    *,
    stdout: TextIO | None = None,
    stderr: TextIO | None = None,
) -> None:
    for stream in (stdout or sys.stdout, stderr or sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            continue


def product_root() -> Path:
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        return Path(bundle_root) / "product"
    return Path(__file__).resolve().parents[1]


def default_reports_dir() -> Path:
    override = os.environ.get("SSH_AI_REPORTS_DIR")
    if override:
        return Path(override)
    local_app_data = os.environ.get("LOCALAPPDATA")
    if os.name == "nt" and local_app_data:
        return Path(local_app_data) / "SSHAgentTool" / "reports"
    return Path.home() / ".local" / "share" / "ssh-agent-tool" / "reports"
