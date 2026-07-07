from __future__ import annotations

import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


SECRET_SCHEMA = "ssh-agent-tool.secret.v1"
ITERATIONS = 200_000


def encrypt_secret(secret: str, master_password: str) -> dict:
    password = validate_master_password(master_password)
    salt = os.urandom(16)
    nonce = os.urandom(12)
    key = derive_key(password, salt, ITERATIONS)
    ciphertext = AESGCM(key).encrypt(nonce, secret.encode("utf-8"), None)
    return {
        "schema": SECRET_SCHEMA,
        "algorithm": "AES-256-GCM",
        "kdf": "PBKDF2-HMAC-SHA256",
        "iterations": ITERATIONS,
        "salt": encode_bytes(salt),
        "nonce": encode_bytes(nonce),
        "ciphertext": encode_bytes(ciphertext),
    }


def decrypt_secret(payload: dict, master_password: str) -> str:
    if not isinstance(payload, dict) or payload.get("schema") != SECRET_SCHEMA:
        raise ValueError("Unsupported backup secret schema.")

    try:
        iterations = int(payload.get("iterations") or ITERATIONS)
        salt = decode_bytes(str(payload["salt"]))
        nonce = decode_bytes(str(payload["nonce"]))
        ciphertext = decode_bytes(str(payload["ciphertext"]))
        key = derive_key(validate_master_password(master_password), salt, iterations)
        return AESGCM(key).decrypt(nonce, ciphertext, None).decode("utf-8")
    except (KeyError, InvalidTag, ValueError) as exc:
        raise ValueError("备份主密码错误，或备份中的敏感字段已损坏。") from exc


def validate_master_password(master_password: str) -> bytes:
    password = str(master_password or "")
    if len(password) < 8:
        raise ValueError("备份主密码至少需要 8 位。")
    return password.encode("utf-8")


def derive_key(password: bytes, salt: bytes, iterations: int) -> bytes:
    return PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=iterations,
    ).derive(password)


def encode_bytes(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def decode_bytes(value: str) -> bytes:
    return base64.b64decode(value.encode("ascii"))
