from __future__ import annotations

import base64
import ctypes
import hashlib
import json
import sys
from ctypes import wintypes
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable


SCHEMA = "ssh-agent-tool.credential.v1"
BytesTransform = Callable[[bytes], bytes]
Clock = Callable[[], str]


class CredentialStore:
    def __init__(
        self,
        root: Path,
        protect: BytesTransform | None = None,
        unprotect: BytesTransform | None = None,
        clock: Clock | None = None,
    ):
        self.root = Path(root)
        self.protect = protect or dpapi_protect
        self.unprotect = unprotect or dpapi_unprotect
        self.clock = clock or utc_now

    def save_secret(self, connection_name: str, secret: str, metadata: dict | None = None) -> dict:
        if not secret:
            return {"credentialRef": "", "hasSecret": False}

        credential_ref = make_credential_ref(connection_name)
        encrypted = self.protect(secret.encode("utf-8"))
        payload = {
            "schema": SCHEMA,
            "credentialRef": credential_ref,
            "connectionName": connection_name,
            "createdAt": self.clock(),
            "updatedAt": self.clock(),
            "hasSecret": True,
            "metadata": metadata or {},
            "encryptedSecret": base64.b64encode(encrypted).decode("ascii"),
        }

        target = self._path_for_ref(credential_ref)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

        return {
            "credentialRef": credential_ref,
            "hasSecret": True,
            "path": str(target),
            "updatedAt": payload["updatedAt"],
        }

    def read_secret(self, credential_ref: str) -> str:
        payload = self._read_payload(credential_ref)
        encrypted = base64.b64decode(payload["encryptedSecret"])
        return self.unprotect(encrypted).decode("utf-8")

    def read_metadata(self, credential_ref: str) -> dict:
        payload = self._read_payload(credential_ref)
        metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        return {
            "credentialRef": payload.get("credentialRef", credential_ref),
            "connectionName": payload.get("connectionName", ""),
            "hasSecret": bool(payload.get("hasSecret")),
            "updatedAt": payload.get("updatedAt", ""),
            **metadata,
        }

    def delete_secret(self, credential_ref: str) -> dict:
        target = self._path_for_ref(credential_ref)
        deleted = target.exists()
        if deleted:
            target.unlink()
        return {
            "ok": True,
            "deleted": deleted,
            "credentialRef": credential_ref,
            "path": str(target),
        }

    def _read_payload(self, credential_ref: str) -> dict:
        payload = json.loads(self._path_for_ref(credential_ref).read_text(encoding="utf-8"))
        if payload.get("schema") != SCHEMA:
            raise ValueError("Unsupported credential schema.")
        return payload

    def _path_for_ref(self, credential_ref: str) -> Path:
        safe_ref = "".join(char for char in credential_ref if char.isalnum() or char in "-_")
        if not safe_ref:
            raise ValueError("Credential reference is empty.")
        return self.root / f"{safe_ref}.json"


def make_credential_ref(connection_name: str) -> str:
    digest = hashlib.sha256(str(connection_name).encode("utf-8")).hexdigest()[:16]
    return f"sshcred-{digest}"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def dpapi_protect(value: bytes) -> bytes:
    if sys.platform != "win32":
        raise RuntimeError("DPAPI credential protection is only available on Windows.")
    return _crypt_protect_data(value)


def dpapi_unprotect(value: bytes) -> bytes:
    if sys.platform != "win32":
        raise RuntimeError("DPAPI credential protection is only available on Windows.")
    return _crypt_unprotect_data(value)


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_char)),
    ]


def _bytes_to_blob(value: bytes):
    buffer = ctypes.create_string_buffer(value)
    return _DATA_BLOB(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char))), buffer


def _crypt_protect_data(value: bytes) -> bytes:
    in_blob, keepalive = _bytes_to_blob(value)
    out_blob = _DATA_BLOB()
    if not ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(in_blob),
        None,
        None,
        None,
        None,
        0,
        ctypes.byref(out_blob),
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(out_blob.pbData)
        _ = keepalive


def _crypt_unprotect_data(value: bytes) -> bytes:
    in_blob, keepalive = _bytes_to_blob(value)
    out_blob = _DATA_BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(in_blob),
        None,
        None,
        None,
        None,
        0,
        ctypes.byref(out_blob),
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(out_blob.pbData)
        _ = keepalive
