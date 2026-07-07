# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path


project_root = Path.cwd()
dist_dir = project_root / "dist"

a = Analysis(
    ["desktop_app.py"],
    pathex=[str(project_root)],
    binaries=[],
    datas=[(str(dist_dir), "dist")],
    hiddenimports=[
        "webview",
        "webview.platforms.winforms",
        "webview.platforms.edgechromium",
        "clr_loader",
        "pythonnet",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="SSH-Agent-Tool",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    version=str(project_root / "build" / "windows-version-info.txt"),
)
