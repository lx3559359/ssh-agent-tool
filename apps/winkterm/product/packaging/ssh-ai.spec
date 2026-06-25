# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path


SPEC_DIR = Path(SPECPATH).resolve()
PRODUCT_ROOT = SPEC_DIR.parent
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
