# Windows EXE Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the Chinese `ssh-ai diagnose` CLI into a Windows `ssh-ai.exe` preview build that works outside the source tree.

**Architecture:** Keep the diagnosis implementation product-owned under `apps/winkterm/product/`. Add a small CLI runtime layer for bundled-resource discovery, default Windows report directories, and UTF-8 console output. Use PyInstaller with an explicit spec file that bundles `product/skills` and `product/policy` data files.

**Tech Stack:** Python 3.12, pytest, PyInstaller, PowerShell, Windows console UTF-8, Markdown reports.

---

## File Structure

Create packaging/runtime files:

- `apps/winkterm/product/cli/runtime.py`: runtime helpers for UTF-8 streams, product resource root, and default report directory.
- `apps/winkterm/product/cli/ssh_ai_entry.py`: tiny PyInstaller console entry script.
- `apps/winkterm/product/packaging/ssh-ai.spec`: PyInstaller spec that includes product data files.
- `apps/winkterm/product/packaging/build-ssh-ai.ps1`: repeatable Windows build script.
- `apps/winkterm/product/packaging/README.md`: Chinese packaging and preview instructions.
- `docs/evaluations/milestone-3-windows-exe.md`: implementation and verification record.

Modify existing files:

- `apps/winkterm/product/cli/ssh_ai.py`: use runtime helpers, set default reports dir to user data location, and locate data files in source or bundled mode.
- `apps/winkterm/product/tests/test_session_cli.py`: update CLI default reports dir expectations.

Create tests:

- `apps/winkterm/product/tests/test_cli_runtime.py`: runtime helper tests.
- `apps/winkterm/product/tests/test_packaging_contract.py`: packaging spec/build-script contract tests.

Do not modify upstream WinkTerm files outside `apps/winkterm/product/` and `docs/evaluations/` unless a packaging test proves a narrow integration hook is required.

Generated outputs must not be committed:

- `apps/winkterm/product/build/`
- `apps/winkterm/product/dist/`
- `apps/winkterm/product/package-smoke-reports/`
- `apps/winkterm/product/preview-reports/`

---

## Task 1: Runtime Paths, Default Reports Directory, and UTF-8 Streams

**Files:**
- Create: `apps/winkterm/product/cli/runtime.py`
- Modify: `apps/winkterm/product/cli/ssh_ai.py`
- Create: `apps/winkterm/product/tests/test_cli_runtime.py`
- Modify: `apps/winkterm/product/tests/test_session_cli.py`

- [ ] **Step 1: Write runtime helper tests**

Create `apps/winkterm/product/tests/test_cli_runtime.py`:

```python
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
```

- [ ] **Step 2: Add CLI default reports test**

Append to `apps/winkterm/product/tests/test_session_cli.py`:

```python
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
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
$env:PYTHONIOENCODING = "utf-8"
.\.venv\Scripts\python.exe -m pytest product/tests/test_cli_runtime.py product/tests/test_session_cli.py -q
```

Expected: FAIL because `product.cli.runtime` does not exist and CLI still defaults to `reports`.

- [ ] **Step 4: Add runtime helpers**

Create `apps/winkterm/product/cli/runtime.py`:

```python
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
```

- [ ] **Step 5: Wire runtime helpers into CLI**

Modify `apps/winkterm/product/cli/ssh_ai.py`:

```python
from product.cli.runtime import (
    configure_console_encoding,
    default_reports_dir,
    product_root,
)
```

Change `main`:

```python
def main(argv: Sequence[str] | None = None) -> int:
    configure_console_encoding()
    args = _parser().parse_args(argv)
    if args.command == "diagnose":
        return _run_diagnose(args, stdout=sys.stdout, stderr=sys.stderr)
    return 2
```

Change the `--reports-dir` argument:

```python
diagnose.add_argument("--reports-dir", default=None)
```

Change `run_diagnosis` call:

```python
reports_dir = Path(args.reports_dir) if args.reports_dir else default_reports_dir()
session = run_diagnosis(plan, executor, reports_dir)
```

Change `_load_plan`:

```python
def _load_plan(host: str, profile_name: str) -> DiagnosisPlan:
    root = product_root()
    skill = load_skill(root / "skills" / profile_name / "checks.yaml")
    policy = load_policy(root / "policy" / "risk_rules.yaml")
    return build_plan(host, skill, policy)
```

- [ ] **Step 6: Run tests and commit**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
$env:PYTHONIOENCODING = "utf-8"
.\.venv\Scripts\python.exe -m pytest product/tests -q
```

Expected: PASS.

Commit:

```powershell
git add apps/winkterm/product/cli/runtime.py apps/winkterm/product/cli/ssh_ai.py apps/winkterm/product/tests/test_cli_runtime.py apps/winkterm/product/tests/test_session_cli.py
git commit -m "feat: prepare ssh-ai cli runtime for packaging"
```

---

## Task 2: PyInstaller Entry Point and Packaging Contract

**Files:**
- Create: `apps/winkterm/product/cli/ssh_ai_entry.py`
- Create: `apps/winkterm/product/packaging/ssh-ai.spec`
- Create: `apps/winkterm/product/packaging/build-ssh-ai.ps1`
- Create: `apps/winkterm/product/tests/test_packaging_contract.py`

- [ ] **Step 1: Write packaging contract tests**

Create `apps/winkterm/product/tests/test_packaging_contract.py`:

```python
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "product" / "packaging" / "ssh-ai.spec"
BUILD_SCRIPT = ROOT / "product" / "packaging" / "build-ssh-ai.ps1"
ENTRY = ROOT / "product" / "cli" / "ssh_ai_entry.py"


def test_pyinstaller_entry_calls_cli_main():
    text = ENTRY.read_text(encoding="utf-8")

    assert "from product.cli.ssh_ai import main" in text
    assert "raise SystemExit(main())" in text


def test_pyinstaller_spec_includes_product_data_files():
    text = SPEC.read_text(encoding="utf-8")

    assert "ssh_ai_entry.py" in text
    assert "product/skills" in text
    assert "product/policy" in text
    assert "name='ssh-ai'" in text or 'name="ssh-ai"' in text


def test_build_script_uses_project_venv_and_utf8():
    text = BUILD_SCRIPT.read_text(encoding="utf-8")

    assert ".venv" in text
    assert "PYTHONIOENCODING" in text
    assert "utf-8" in text.lower()
    assert "PyInstaller" in text
    assert "ssh-ai.spec" in text
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
.\.venv\Scripts\python.exe -m pytest product/tests/test_packaging_contract.py -q
```

Expected: FAIL because packaging files do not exist.

- [ ] **Step 3: Add PyInstaller entry script**

Create `apps/winkterm/product/cli/ssh_ai_entry.py`:

```python
from __future__ import annotations

from product.cli.ssh_ai import main


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Add PyInstaller spec**

Create `apps/winkterm/product/packaging/ssh-ai.spec`:

```python
# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path


PRODUCT_ROOT = Path(SPECPATH).parents[1]
WINKTERM_ROOT = PRODUCT_ROOT.parent

block_cipher = None

a = Analysis(
    [str(PRODUCT_ROOT / "cli" / "ssh_ai_entry.py")],
    pathex=[str(WINKTERM_ROOT)],
    binaries=[],
    datas=[
        (str(PRODUCT_ROOT / "skills"), "product/skills"),
        (str(PRODUCT_ROOT / "policy"), "product/policy"),
    ],
    hiddenimports=["yaml"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ssh-ai",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="ssh-ai",
)
```

- [ ] **Step 5: Add build script**

Create `apps/winkterm/product/packaging/build-ssh-ai.ps1`:

```powershell
param(
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$ProductRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$WinkTermRoot = Resolve-Path (Join-Path $ProductRoot "..")
$Python = Join-Path $WinkTermRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "未找到 Python 虚拟环境：$Python。请先在 apps/winkterm 下创建 .venv 并安装依赖。"
}

$env:PYTHONPATH = $WinkTermRoot.Path
$env:PYTHONIOENCODING = "utf-8"

Set-Location $WinkTermRoot

if ($Clean) {
    Remove-Item -Recurse -Force -LiteralPath "product\build" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force -LiteralPath "product\dist" -ErrorAction SilentlyContinue
}

& $Python -m PyInstaller --noconfirm --clean "product\packaging\ssh-ai.spec" --distpath "product\dist" --workpath "product\build"
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller 打包失败，退出码：$LASTEXITCODE"
}

Write-Host "ssh-ai.exe 已生成：$(Join-Path $WinkTermRoot 'product\dist\ssh-ai\ssh-ai.exe')"
```

- [ ] **Step 6: Run packaging contract tests and commit**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
.\.venv\Scripts\python.exe -m pytest product/tests/test_packaging_contract.py product/tests/test_cli_runtime.py -q
```

Expected: PASS.

Commit:

```powershell
git add apps/winkterm/product/cli/ssh_ai_entry.py apps/winkterm/product/packaging/ssh-ai.spec apps/winkterm/product/packaging/build-ssh-ai.ps1 apps/winkterm/product/tests/test_packaging_contract.py
git commit -m "feat: add ssh-ai pyinstaller packaging"
```

---

## Task 3: Build EXE and Run Windows Smoke Test

**Files:**
- No committed source files expected unless a test exposes a packaging bug.
- Generated, not committed: `apps/winkterm/product/build/`, `apps/winkterm/product/dist/`, `apps/winkterm/product/package-smoke-reports/`

- [ ] **Step 1: Install PyInstaller into local venv**

Run:

```powershell
Set-Location apps/winkterm
.\.venv\Scripts\python.exe -m pip install PyInstaller
```

Expected: command exits `0` and `.\.venv\Scripts\python.exe -m PyInstaller --version` prints a version.

- [ ] **Step 2: Build the preview exe**

Run:

```powershell
Set-Location apps/winkterm
.\product\packaging\build-ssh-ai.ps1 -Clean
```

Expected: `product\dist\ssh-ai\ssh-ai.exe` exists.

- [ ] **Step 3: Run exe fake smoke**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONIOENCODING = "utf-8"
if (Test-Path -LiteralPath "product\package-smoke-reports") {
    Remove-Item -Recurse -Force -LiteralPath "product\package-smoke-reports"
}
$json = .\product\dist\ssh-ai\ssh-ai.exe diagnose prod-1 --profile linux-basic --fake --yes --json --reports-dir product\package-smoke-reports 2>$null
$json | .\.venv\Scripts\python.exe -c "import json, pathlib, sys; data=json.load(sys.stdin); print('status=' + data['status']); print('completed=' + str(data['counts']['completed'])); print('report_exists=' + str(pathlib.Path(data['report_path']).exists()))"
```

Expected:

```text
status=completed
completed=7
report_exists=True
```

- [ ] **Step 4: Run exe outside source directory**

Run:

```powershell
Set-Location $env:TEMP
$exe = "F:\SSH工具开发\apps\winkterm\product\dist\ssh-ai\ssh-ai.exe"
$reports = Join-Path $env:TEMP "ssh-ai-package-smoke-reports"
Remove-Item -Recurse -Force -LiteralPath $reports -ErrorAction SilentlyContinue
$json = & $exe diagnose prod-1 --profile linux-basic --fake --yes --json --reports-dir $reports 2>$null
$json | "F:\SSH工具开发\apps\winkterm\.venv\Scripts\python.exe" -c "import json, pathlib, sys; data=json.load(sys.stdin); print('status=' + data['status']); print('completed=' + str(data['counts']['completed'])); print('report_exists=' + str(pathlib.Path(data['report_path']).exists()))"
Remove-Item -Recurse -Force -LiteralPath $reports -ErrorAction SilentlyContinue
```

Expected:

```text
status=completed
completed=7
report_exists=True
```

- [ ] **Step 5: Clean smoke reports and inspect git status**

Run:

```powershell
Set-Location F:\SSH工具开发
Remove-Item -Recurse -Force -LiteralPath "apps\winkterm\product\package-smoke-reports" -ErrorAction SilentlyContinue
git status --short
git ls-files | Select-String -SimpleMatch 'product/package-smoke-reports','product/dist','product/build','node_modules','.venv','external/'
```

Expected:

- `product/package-smoke-reports` is removed.
- `product/dist` and `product/build` may exist locally but are not tracked.
- `git ls-files` prints no matches.

No commit is required in this task unless code or packaging files needed fixes.

---

## Task 4: Packaging Documentation and Evaluation Record

**Files:**
- Create: `apps/winkterm/product/packaging/README.md`
- Create: `docs/evaluations/milestone-3-windows-exe.md`

- [ ] **Step 1: Add packaging README**

Create `apps/winkterm/product/packaging/README.md`:

```markdown
# ssh-ai Windows 打包说明

## 目标

将 `product.cli.ssh_ai` 打包为 Windows 控制台程序 `ssh-ai.exe`，用于预览中文 SSH Agent 诊断 CLI。

## 前置条件

```powershell
Set-Location apps/winkterm
.\.venv\Scripts\python.exe -m pip install PyInstaller
```

## 构建

```powershell
Set-Location apps/winkterm
.\product\packaging\build-ssh-ai.ps1 -Clean
```

输出位置：

```text
apps/winkterm/product/dist/ssh-ai/ssh-ai.exe
```

## Fake 模式预览

```powershell
Set-Location apps/winkterm
$env:PYTHONIOENCODING = "utf-8"
.\product\dist\ssh-ai\ssh-ai.exe diagnose prod-1 --profile linux-basic --fake --yes --json --reports-dir product\preview-reports
```

说明：

- `--fake` 不连接真实服务器，只用于验证 CLI、JSON 和 Markdown 报告。
- 真机诊断需要 WinkTerm Agent API 的 `--token` 和 `--connection-id`。
- 默认报告目录是 `%LOCALAPPDATA%\SSHAgentTool\reports`，也可以用 `--reports-dir` 指定。
- `product/dist` 和 `product/build` 是本地构建产物，不提交到 git。
```

- [ ] **Step 2: Add milestone 3 evaluation doc**

Create `docs/evaluations/milestone-3-windows-exe.md`:

```markdown
# Milestone 3 Windows EXE 打包

日期：2026-06-25

## 已实现

- CLI 运行时支持源码模式和 PyInstaller bundled 模式的数据文件定位。
- 默认报告目录切换为用户数据目录。
- CLI 启动时尝试将 stdout/stderr 配置为 UTF-8。
- 新增 PyInstaller entry script、spec 和 PowerShell build script。
- `skills/` 和 `policy/` 数据文件随 `ssh-ai.exe` 打包。

## 验证

执行者必须在这里粘贴实际命令和结果：

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
$env:PYTHONIOENCODING = "utf-8"
.\.venv\Scripts\python.exe -m pytest product/tests -q
```

执行者必须在这里粘贴 exe smoke 结果：

```powershell
.\product\dist\ssh-ai\ssh-ai.exe diagnose prod-1 --profile linux-basic --fake --yes --json --reports-dir product\package-smoke-reports
```

## 预览

本地预览可执行文件：

```text
apps/winkterm/product/dist/ssh-ai/ssh-ai.exe
```

## 剩余工作

- 用真实 Linux 测试主机跑 Agent API smoke。
- host/title 到 WinkTerm connection-id 自动解析。
- 把 `ssh-ai.exe` 集成到最终桌面应用菜单或安装包。
- 评估是否需要代码签名。
```

- [ ] **Step 3: Run full tests**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
$env:PYTHONIOENCODING = "utf-8"
.\.venv\Scripts\python.exe -m pytest product/tests -q
```

Expected: PASS.

- [ ] **Step 4: Fill verification results and commit**

Update `docs/evaluations/milestone-3-windows-exe.md` with actual test and exe smoke output.

Run:

```powershell
git add apps/winkterm/product/packaging/README.md docs/evaluations/milestone-3-windows-exe.md
git commit -m "docs: record windows exe packaging status"
```

---

## Task 5: Final Verification and Cleanup

**Files:**
- No source changes expected.

- [ ] **Step 1: Run final test sweep**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONPATH = (Get-Location).Path
$env:PYTHONIOENCODING = "utf-8"
.\.venv\Scripts\python.exe -m pytest product/tests -q
```

Expected: PASS.

- [ ] **Step 2: Run final exe preview**

Run:

```powershell
Set-Location apps/winkterm
$env:PYTHONIOENCODING = "utf-8"
$json = .\product\dist\ssh-ai\ssh-ai.exe diagnose prod-1 --profile linux-basic --fake --yes --json --reports-dir product\preview-reports 2>$null
$json | .\.venv\Scripts\python.exe -c "import json, pathlib, sys; data=json.load(sys.stdin); print('status=' + data['status']); print('completed=' + str(data['counts']['completed'])); print('report_exists=' + str(pathlib.Path(data['report_path']).exists()))"
```

Expected:

```text
status=completed
completed=7
report_exists=True
```

- [ ] **Step 3: Clean transient reports**

Run:

```powershell
Remove-Item -Recurse -Force -LiteralPath "product\package-smoke-reports" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force -LiteralPath "product\preview-reports" -ErrorAction SilentlyContinue
```

Expected: transient report directories are removed.

- [ ] **Step 4: Check tracked files and status**

Run:

```powershell
Set-Location F:\SSH工具开发
git diff --check
git status --short
git ls-files | Select-String -SimpleMatch 'product/package-smoke-reports','product/preview-reports','product/dist','product/build','node_modules','.venv','external/'
```

Expected:

- `git diff --check` prints nothing.
- `git status --short` is clean or only shows intentionally untracked local build outputs ignored by git.
- `git ls-files` prints no matches.

No commit is required in this task unless final verification required source or documentation fixes.

---

## Verification Checklist

After all tasks:

- [ ] `python -m pytest product/tests -q` passes from `apps/winkterm`.
- [ ] `product/dist/ssh-ai/ssh-ai.exe` exists.
- [ ] `ssh-ai.exe diagnose prod-1 --profile linux-basic --fake --yes --json` exits `0`.
- [ ] EXE JSON contains `status=completed` and `counts.completed=7`.
- [ ] EXE generates a Markdown report.
- [ ] EXE works when launched outside the source directory.
- [ ] `skills/` and `policy/` are loaded from bundled resources, not the source checkout.
- [ ] Chinese CLI/report text is readable when `PYTHONIOENCODING=utf-8` is set.
- [ ] Generated report directories are not committed.
- [ ] `product/dist` and `product/build` are not committed.
- [ ] No upstream WinkTerm source outside `apps/winkterm/product/` is modified.
- [ ] `git status --short` is clean before final merge.
