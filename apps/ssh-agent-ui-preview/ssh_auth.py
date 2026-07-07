from __future__ import annotations

import os
from io import StringIO


PRIVATE_KEY_LOADERS = ("Ed25519Key", "RSAKey", "ECDSAKey", "DSSKey")


def build_auth_kwargs(secret: str, metadata: dict | None, paramiko_module) -> dict:
    value = str(secret or "")
    auth_type = str((metadata or {}).get("authType") or "").strip()
    identity_file = identity_file_path(metadata)
    if auth_type == "SSH Agent":
        return {
            "look_for_keys": True,
            "allow_agent": True,
        }

    if not value.strip() and not identity_file:
        raise ValueError("缺少凭据：请先保存密码、私钥或密钥口令。")

    if auth_type == "私钥":
        if value.strip() and looks_like_private_key(value):
            pkey = load_private_key(value, paramiko_module)
        else:
            pkey = load_private_key_file(identity_file, paramiko_module, password=value.strip() or None) if identity_file else load_private_key(value, paramiko_module)
        return {
            "pkey": pkey,
            "look_for_keys": False,
            "allow_agent": False,
        }

    return {
        "password": value,
        "look_for_keys": False,
        "allow_agent": False,
    }


def has_auth_material(secret: str, metadata: dict | None) -> bool:
    raw = metadata if isinstance(metadata, dict) else {}
    return bool(str(secret or "").strip() or identity_file_path(raw) or str(raw.get("authType") or "").strip() == "SSH Agent")


def identity_file_path(metadata: dict | None) -> str:
    raw = metadata if isinstance(metadata, dict) else {}
    auth_type = str(raw.get("authType") or "").strip()
    if auth_type != "私钥":
        return ""
    return str(raw.get("identityFile") or raw.get("privateKeyPath") or "").strip()


def looks_like_private_key(value: str) -> bool:
    text = str(value or "")
    return "-----BEGIN " in text and "PRIVATE KEY-----" in text


def load_private_key(private_key_content: str, paramiko_module):
    errors = []
    for loader_name in PRIVATE_KEY_LOADERS:
        loader = getattr(paramiko_module, loader_name, None)
        if not loader or not hasattr(loader, "from_private_key"):
            continue

        try:
            return loader.from_private_key(StringIO(private_key_content))
        except Exception as error:
            errors.append(str(error))

    detail = "; ".join(error for error in errors if error) or "未识别的私钥格式"
    raise ValueError(f"私钥内容无效，无法加载：{detail}")


def load_private_key_file(identity_file: str, paramiko_module, password: str | None = None):
    filename = os.path.expandvars(os.path.expanduser(str(identity_file or "").strip()))
    errors = []
    for loader_name in PRIVATE_KEY_LOADERS:
        loader = getattr(paramiko_module, loader_name, None)
        if not loader or not hasattr(loader, "from_private_key_file"):
            continue

        try:
            return loader.from_private_key_file(filename, password=password)
        except Exception as error:
            errors.append(str(error))

    detail = "; ".join(error for error in errors if error) or "未识别的私钥路径或格式"
    raise ValueError(f"私钥文件无效，无法加载：{detail}")
