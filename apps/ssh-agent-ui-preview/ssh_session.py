from __future__ import annotations

import base64
from dataclasses import dataclass
from hashlib import sha256

from ssh_auth import build_auth_kwargs, has_auth_material
from ssh_proxy import connect_ssh_client


READONLY_COMMANDS = {
    "whoami",
    "pwd",
    "uptime",
    "hostname",
    "date",
    "df -hT",
    "free -h",
    "systemctl --failed",
}


SSH_FAILURE_PROFILES = {
    "auth": {
        "label": "认证失败",
        "tone": "amber",
        "summary": "服务器拒绝了当前凭据或认证方式。",
        "suggestions": ["打开认证中心确认密码、私钥、口令或 SSH Agent 是否可用。", "确认用户名、端口和跳板机配置与服务器一致。"],
    },
    "key-file": {
        "label": "私钥不可用",
        "tone": "amber",
        "summary": "当前私钥文件权限、格式或口令不可用，SSH 客户端无法加载该私钥。",
        "suggestions": ["重新选择正确的私钥文件，并确认内容包含完整 PRIVATE KEY。", "如果私钥有口令，请在认证中心补录正确口令。"],
    },
    "timeout": {
        "label": "网络超时",
        "tone": "red",
        "summary": "连接在超时时间内没有建立成功。",
        "suggestions": ["检查网络连通性、安全组、防火墙和 VPN/堡垒机链路。", "适当增加连接超时或重试次数后再次连接。"],
    },
    "dns": {
        "label": "DNS 解析失败",
        "tone": "red",
        "summary": "主机名无法解析为可连接地址。",
        "suggestions": ["检查服务器地址是否拼写正确，或改用 IP 地址测试。", "确认当前网络 DNS、hosts 或内网域名解析是否可用。"],
    },
    "refused": {
        "label": "端口拒绝",
        "tone": "red",
        "summary": "目标主机拒绝了 SSH 端口连接。",
        "suggestions": ["确认 SSH 服务正在运行且监听了配置的端口。", "检查安全组、防火墙、端口转发和跳板机规则。"],
    },
    "handshake": {
        "label": "握手失败",
        "tone": "amber",
        "summary": "TCP 已连接，但 SSH 握手被远端关闭或重置。",
        "suggestions": ["检查 sshd 日志、MaxStartups、Fail2Ban、堡垒机策略或连接频率限制。", "确认目标端口确实是 SSH 服务。"],
    },
    "algorithm": {
        "label": "算法不兼容",
        "tone": "amber",
        "summary": "客户端和服务器没有协商出共同的 SSH 算法。",
        "suggestions": ["检查服务器是否只支持旧算法，必要时升级 OpenSSH 或调整服务器算法配置。", "记录服务端算法后再决定是否允许兼容旧算法。"],
    },
    "host-key": {
        "label": "主机指纹异常",
        "tone": "red",
        "summary": "服务器主机指纹与信任记录不一致或无法读取。",
        "suggestions": ["确认服务器是否重装或更换过密钥。", "在可信渠道核对指纹后再更新信任记录。"],
    },
    "unknown": {
        "label": "未知错误",
        "tone": "gray",
        "summary": "SSH 连接失败，但暂时无法自动归类。",
        "suggestions": ["打开工具日志和会话日志查看完整错误。", "导出诊断包后继续排查网络、认证和服务器 sshd 日志。"],
    },
}


@dataclass
class SshServer:
    host: str
    port: int
    user: str


class HostKeyVerificationError(ValueError):
    def __init__(self, message: str, host_key: dict | None = None, trusted_host_key: dict | None = None, host_key_context: dict | None = None):
        super().__init__(message)
        self.host_key = host_key or {}
        self.trusted_host_key = trusted_host_key or {}
        self.host_key_context = host_key_context if isinstance(host_key_context, dict) else {}
        self.host_key_trust = {
            "status": "changed",
            "label": "指纹变更",
            "tone": "red",
            "message": "主机指纹与已信任记录不一致，请警惕中间人攻击或服务器重装。",
        }

    def to_result_fields(self) -> dict:
        fields = {
            "hostKey": self.host_key,
            "trustedHostKey": self.trusted_host_key,
            "hostKeyTrust": self.host_key_trust,
        }
        if self.host_key_context:
            fields["hostKeyContext"] = self.host_key_context
        return fields


class TrustedHostKeyPolicy:
    def __init__(self, trusted_host_key: dict):
        self.trusted_host_key = normalize_host_key(trusted_host_key)

    def missing_host_key(self, client, hostname, key):
        current = format_host_key_fingerprint(key)
        _raise_if_host_key_mismatch(current, self.trusted_host_key)


class UnknownHostKeyVerificationError(HostKeyVerificationError):
    def __init__(self, message: str, host_key: dict | None = None, host_key_context: dict | None = None):
        if host_key_context is None and isinstance(host_key, dict):
            host_key_context = host_key.get("_context")
            host_key = {key: value for key, value in host_key.items() if key != "_context"}
        super().__init__(message, host_key or {}, {}, host_key_context)
        self.host_key_trust = {
            "status": "unknown",
            "label": "待信任",
            "tone": "amber",
            "message": "首次连接时需要先核对并信任 SSH 主机密钥。",
        }


class PromptUnknownHostKeyPolicy:
    def __init__(self, role: str = "target", host: str = "", port: int | None = None):
        self.role = str(role or "target").strip() or "target"
        self.host = str(host or "").strip()
        self.port = port

    def missing_host_key(self, client, hostname, key):
        current = format_host_key_fingerprint(key)
        host = str(hostname or "").strip() or "unknown"
        context = self._context(host)
        current = {**current, "_context": context}
        if not current.get("sha256"):
            raise UnknownHostKeyVerificationError("无法读取服务器主机指纹，已阻止未信任连接。", current)
        raise UnknownHostKeyVerificationError(
            f"首次连接 {host} 需要确认 SSH 主机密钥，已在认证前阻止连接。",
            current,
        )

    def _context(self, hostname: str) -> dict:
        context = {
            "role": self.role,
            "host": self.host or str(hostname or "").strip() or "unknown",
        }
        if self.port is not None:
            context["port"] = self.port
        return context


def configure_client_host_key_policy(paramiko_module, client, server: dict):
    load = getattr(client, "load_system_host_keys", None)
    if callable(load):
        load()
    trusted = normalize_host_key((server if isinstance(server, dict) else {}).get("trustedHostKey"))
    if trusted:
        client.set_missing_host_key_policy(TrustedHostKeyPolicy(trusted))
    else:
        client.set_missing_host_key_policy(PromptUnknownHostKeyPolicy())


def configure_proxy_jump_host_key_policy(paramiko_module, client, proxy_jump):
    load = getattr(client, "load_system_host_keys", None)
    if callable(load):
        load()
    client.set_missing_host_key_policy(
        PromptUnknownHostKeyPolicy(role="proxy-jump", host=proxy_jump.host, port=proxy_jump.port)
    )


def run_readonly_command(
    server: dict,
    password: str,
    command: str,
    timeout: int = 10,
    paramiko_module=None,
    credential_metadata: dict | None = None,
) -> dict:
    normalized_command = " ".join(str(command or "").strip().split())
    if not _is_readonly_command(normalized_command):
        return {
            "ok": False,
            "command": normalized_command,
            "stdout": "",
            "stderr": "",
            "message": "命令已拦截：当前入口仅允许执行预置只读命令。",
        }

    if not has_auth_material(password, credential_metadata or {}):
        return {
            "ok": False,
            "command": normalized_command,
            "stdout": "",
            "stderr": "",
            "message": "缺少凭据：请先在连接配置中保存密码或密钥口令。",
        }

    target = _parse_server(server)
    if not target.host:
        return {
            "ok": False,
            "command": normalized_command,
            "stdout": "",
            "stderr": "",
            "message": "服务器地址为空，无法建立 SSH 会话。",
        }

    paramiko = paramiko_module or _load_paramiko()
    try:
        auth_kwargs = build_auth_kwargs(password, credential_metadata or {}, paramiko)
    except ValueError as error:
        return {
            "ok": False,
            "command": normalized_command,
            "stdout": "",
            "stderr": "",
            "message": str(error),
        }

    client = paramiko.SSHClient()
    proxy_client = None
    configure_client_host_key_policy(paramiko, client, server)

    try:
        proxy_client = connect_ssh_client(
            paramiko,
            client,
            server,
            password,
            credential_metadata or {},
            timeout,
            configure_proxy_host_key_policy=lambda proxy_client, proxy_jump: configure_proxy_jump_host_key_policy(paramiko, proxy_client, proxy_jump),
        )
        verify_trusted_host_key(client, server)
        _, stdout, stderr = client.exec_command(normalized_command, timeout=timeout)
        stdout_text = stdout.read().decode("utf-8", errors="replace")
        stderr_text = stderr.read().decode("utf-8", errors="replace")
        return {
            "ok": True,
            "command": normalized_command,
            "stdout": stdout_text,
            "stderr": stderr_text,
            "hostKey": read_client_host_key(client),
            "message": "SSH 命令执行完成。",
        }
    except HostKeyVerificationError as error:
        diagnostic = classify_ssh_error(error, fallback_kind="host-key")
        return {
            "ok": False,
            "command": normalized_command,
            "stdout": "",
            "stderr": str(error),
            "message": str(error),
            "failureKind": diagnostic["kind"],
            "sshFailure": diagnostic,
            **error.to_result_fields(),
        }
    except Exception as error:  # Paramiko raises several SSH/socket specific errors.
        diagnostic = classify_ssh_error(error)
        return {
            "ok": False,
            "command": normalized_command,
            "stdout": "",
            "stderr": str(error),
            "message": f"SSH 命令执行失败：{error}",
            "failureKind": diagnostic["kind"],
            "sshFailure": diagnostic,
        }
    finally:
        client.close()
        if proxy_client:
            proxy_client.close()


def build_basic_info_commands() -> list[str]:
    return ["whoami", "pwd", "hostname", "uptime", "df -hT", "free -h"]


def classify_ssh_error(error, fallback_kind: str = "unknown") -> dict:
    text = str(error or "").lower()
    kind = fallback_kind if fallback_kind in SSH_FAILURE_PROFILES else "unknown"
    if isinstance(error, HostKeyVerificationError):
        profile = SSH_FAILURE_PROFILES["host-key"]
        return {
            "kind": "host-key",
            "label": profile["label"],
            "tone": profile["tone"],
            "summary": profile["summary"],
            "suggestions": list(profile["suggestions"]),
            "raw": str(error or ""),
        }
    if any(pattern in text for pattern in ("no route to host", "network is unreachable", "host is unreachable", "destination host unreachable", "ehostunreach", "enetunreach")):
        kind = "timeout"
    if any(pattern in text for pattern in ("unprotected private key file", "permissions are too open", "bad permissions", "invalid private key", "error loading key", "private key will be ignored", "key_load_public", "load key")):
        kind = "key-file"
    if any(pattern in text for pattern in ("authentication", "permission denied", "auth failed", "password", "bad authentication", "too many authentication", "认证", "密码")):
        kind = "auth"
    elif any(pattern in text for pattern in ("timeout", "timed out", "超时")):
        kind = "timeout"
    elif any(pattern in text for pattern in ("getaddrinfo", "name or service", "temporary failure in name resolution", "nodename nor servname", "dns", "11001")):
        kind = "dns"
    elif any(pattern in text for pattern in ("connection refused", "actively refused", "refused", "10061")):
        kind = "refused"
    elif any(pattern in text for pattern in ("kex_exchange_identification", "connection reset", "banner", "error reading ssh protocol banner", "handshake")):
        kind = "handshake"
    elif any(pattern in text for pattern in ("no matching", "algorithm", "kexalgorithms", "host key type", "pubkeyacceptedalgorithms")):
        kind = "algorithm"
    elif any(pattern in text for pattern in ("host key", "fingerprint", "known_hosts", "主机指纹", "主机密钥")):
        kind = "host-key"

    profile = SSH_FAILURE_PROFILES.get(kind, SSH_FAILURE_PROFILES["unknown"])
    return {
        "kind": kind,
        "label": profile["label"],
        "tone": profile["tone"],
        "summary": profile["summary"],
        "suggestions": list(profile["suggestions"]),
        "raw": str(error or ""),
    }


def read_client_host_key(client) -> dict:
    try:
        transport = client.get_transport()
        remote_key = transport.get_remote_server_key() if transport else None
    except Exception:
        return {}
    return format_host_key_fingerprint(remote_key)


def verify_trusted_host_key(client, server: dict) -> dict:
    trusted = normalize_host_key((server if isinstance(server, dict) else {}).get("trustedHostKey"))
    if not trusted:
        return read_client_host_key(client)

    current = read_client_host_key(client)
    _raise_if_host_key_mismatch(current, trusted)
    return current


def _raise_if_host_key_mismatch(current: dict, trusted: dict) -> None:
    if not current.get("sha256"):
        raise HostKeyVerificationError("无法读取主机指纹，已阻止连接。", current, trusted)
    if current.get("sha256") != trusted.get("sha256") or current.get("type") != trusted.get("type"):
        raise HostKeyVerificationError(
            f"主机指纹变更，已阻止连接。当前：{current.get('type')} {current.get('sha256')}；受信：{trusted.get('type')} {trusted.get('sha256')}",
            current,
            trusted,
        )


def normalize_host_key(host_key) -> dict:
    if not isinstance(host_key, dict):
        return {}
    sha256_value = str(host_key.get("sha256") or "").strip()
    if not sha256_value:
        return {}
    return {
        "type": str(host_key.get("type") or "unknown").strip() or "unknown",
        "sha256": sha256_value,
    }


def format_host_key_fingerprint(remote_key) -> dict:
    if not remote_key:
        return {}

    try:
        key_bytes = remote_key.asbytes()
        key_type = remote_key.get_name()
    except Exception:
        return {}

    digest = base64.b64encode(sha256(key_bytes).digest()).decode("ascii").rstrip("=")
    return {"type": str(key_type or ""), "sha256": f"SHA256:{digest}"}


def _is_readonly_command(command: str) -> bool:
    return command in READONLY_COMMANDS


def _parse_server(server: dict) -> SshServer:
    host = str(server.get("ip") or server.get("host") or "").strip()
    user = str(server.get("user") or "root").strip() or "root"
    try:
        port = int(str(server.get("port") or "22").strip())
    except ValueError:
        port = 22
    return SshServer(host=host, port=port, user=user)


def _load_paramiko():
    try:
        import paramiko
    except ImportError as error:
        raise RuntimeError("当前运行环境缺少 Paramiko，无法建立真实 SSH 会话。") from error
    return paramiko
