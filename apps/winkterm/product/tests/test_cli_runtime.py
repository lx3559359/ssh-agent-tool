import sys
from pathlib import Path

from product.cli.runtime import (
    configure_console_encoding,
    default_reports_dir,
    product_root,
)


def test_product_root_uses_source_tree_when_not_bundled():
    root = product_root()

    assert root.name == "product"
    assert (root / "skills" / "linux-basic-health" / "checks.yaml").exists()
    assert (root / "policy" / "risk_rules.yaml").exists()


def test_product_root_uses_pyinstaller_meipass(monkeypatch, tmp_path):
    bundled_root = tmp_path / "bundle"
    (bundled_root / "product").mkdir(parents=True)
    monkeypatch.setattr(sys, "_MEIPASS", str(bundled_root), raising=False)

    assert product_root() == bundled_root / "product"


def test_default_reports_dir_uses_env_override(monkeypatch, tmp_path):
    reports = tmp_path / "reports"
    monkeypatch.setenv("SSH_AI_REPORTS_DIR", str(reports))

    assert default_reports_dir() == reports


def test_default_reports_dir_uses_localappdata_on_windows(monkeypatch, tmp_path):
    monkeypatch.delenv("SSH_AI_REPORTS_DIR", raising=False)
    monkeypatch.setattr("product.cli.runtime.os.name", "nt")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))

    assert default_reports_dir() == tmp_path / "SSHAgentTool" / "reports"


def test_default_reports_dir_uses_xdg_fallback_on_non_windows(monkeypatch, tmp_path):
    monkeypatch.delenv("SSH_AI_REPORTS_DIR", raising=False)
    monkeypatch.setattr("product.cli.runtime.os.name", "posix")
    monkeypatch.setattr("product.cli.runtime.Path.home", lambda: tmp_path)

    assert (
        default_reports_dir()
        == tmp_path / ".local" / "share" / "ssh-agent-tool" / "reports"
    )


def test_configure_console_encoding_reconfigures_streams():
    class Stream:
        def __init__(self):
            self.calls = []

        def reconfigure(self, **kwargs):
            self.calls.append(kwargs)

    stdout = Stream()
    stderr = Stream()

    configure_console_encoding(stdout=stdout, stderr=stderr)

    assert stdout.calls == [{"encoding": "utf-8", "errors": "replace"}]
    assert stderr.calls == [{"encoding": "utf-8", "errors": "replace"}]
