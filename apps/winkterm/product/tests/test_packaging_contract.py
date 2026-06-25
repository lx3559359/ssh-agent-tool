from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "product" / "packaging" / "ssh-ai.spec"
BUILD_SCRIPT = ROOT / "product" / "packaging" / "build-ssh-ai.ps1"
ENTRY = ROOT / "product" / "cli" / "ssh_ai_entry.py"


def _execute_spec():
    calls = {}

    def fake_analysis(*args, **kwargs):
        calls["analysis"] = {
            "scripts": args[0] if args else kwargs["scripts"],
            "datas": kwargs["datas"],
            "pathex": kwargs["pathex"],
        }
        return SimpleNamespace(
            pure=[],
            zipped_data=[],
            scripts=calls["analysis"]["scripts"],
            binaries=[],
            zipfiles=[],
            datas=calls["analysis"]["datas"],
        )

    def fake_pyz(*args, **kwargs):
        calls["pyz"] = {"args": args, "kwargs": kwargs}
        return SimpleNamespace()

    def fake_exe(*args, **kwargs):
        calls["exe"] = {"args": args, "kwargs": kwargs}
        return SimpleNamespace()

    def fake_collect(*args, **kwargs):
        calls["collect"] = {"args": args, "kwargs": kwargs}
        return SimpleNamespace()

    namespace = {
        "SPECPATH": str(SPEC.parent),
        "Analysis": fake_analysis,
        "PYZ": fake_pyz,
        "EXE": fake_exe,
        "COLLECT": fake_collect,
    }
    exec(SPEC.read_text(encoding="utf-8"), namespace)

    return calls, namespace


def test_pyinstaller_entry_calls_cli_main():
    text = ENTRY.read_text(encoding="utf-8")

    assert "from product.cli.ssh_ai import main" in text
    assert "raise SystemExit(main())" in text


def test_pyinstaller_spec_includes_product_data_files():
    text = SPEC.read_text(encoding="utf-8")

    assert "ssh_ai_entry.py" in text
    assert "COLLECT(" not in text
    assert "pathex=[str(WINKTERM_ROOT)]" in text
    assert "product/skills" in text
    assert "product/policy" in text
    assert "name='ssh-ai'" in text or 'name="ssh-ai"' in text


def test_pyinstaller_spec_configures_paths_from_executed_spec():
    calls, namespace = _execute_spec()
    analysis = calls["analysis"]

    assert namespace["SPEC_DIR"] == SPEC.parent.resolve()
    assert namespace["PRODUCT_ROOT"] == ROOT / "product"
    assert namespace["WINKTERM_ROOT"] == ROOT

    assert Path(analysis["scripts"][0]) == ENTRY
    assert ENTRY.exists()

    datas = [(Path(source), target) for source, target in analysis["datas"]]
    assert datas == [
        (ROOT / "product" / "skills", "product/skills"),
        (ROOT / "product" / "policy", "product/policy"),
    ]
    assert (datas[0][0] / "linux-basic-health" / "checks.yaml").exists()
    assert (datas[1][0] / "risk_rules.yaml").exists()

    assert analysis["pathex"] == [str(ROOT)]
    assert calls["exe"]["kwargs"]["name"] == "ssh-ai"
    assert calls["exe"]["args"][4] == analysis["datas"]


def test_build_script_uses_project_venv_and_utf8():
    text = BUILD_SCRIPT.read_text(encoding="utf-8")

    assert text.isascii()
    assert "[switch]$Clean" in text
    assert ".venv" in text
    assert "PYTHONPATH" in text
    assert "PYTHONIOENCODING" in text
    assert "utf-8" in text.lower()
    assert "PyInstaller" in text
    assert "ssh-ai.spec" in text
    assert "product\\dist\\ssh-ai.exe" in text
    assert "--onefile" not in text
    assert '--distpath "product\\dist"' in text
    assert '--workpath "product\\build"' in text
