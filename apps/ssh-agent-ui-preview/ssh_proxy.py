from __future__ import annotations

import socket
from dataclasses import dataclass

from ssh_auth import build_auth_kwargs


@dataclass
class ProxyJump:
    host: str
    port: int
    user: str


class ProxyChain:
    def __init__(self, clients: list):
        self.clients = clients

    def close(self):
        for client in reversed(self.clients):
            try:
                client.close()
            except Exception:
                pass


def connect_ssh_client(
    paramiko_module,
    client,
    server: dict,
    secret: str,
    credential_metadata: dict | None,
    timeout: int,
    configure_proxy_host_key_policy=None,
    socket_factory=None,
):
    target = parse_server_target(server)
    host_key_alias = host_key_alias_value(server, credential_metadata)
    auth_kwargs = build_auth_kwargs(secret, credential_metadata or {}, paramiko_module)
    connect_kwargs = {
        "hostname": target["host"],
        "port": target["port"],
        "username": target["user"],
        "timeout": timeout,
        "banner_timeout": timeout,
        "auth_timeout": timeout,
        **auth_kwargs,
    }

    proxy_jumps = parse_proxy_jumps(proxy_jump_value(server, credential_metadata), default_user=target["user"])
    attempts = retry_attempts(server)
    last_error = None
    for attempt in range(attempts):
        proxy_clients = []
        try:
            next_sock = None
            for index, proxy_jump in enumerate(proxy_jumps):
                proxy_client = paramiko_module.SSHClient()
                proxy_clients.append(proxy_client)
                if configure_proxy_host_key_policy:
                    configure_proxy_host_key_policy(proxy_client, proxy_jump)
                else:
                    proxy_client.set_missing_host_key_policy(paramiko_module.AutoAddPolicy())
                proxy_connect_kwargs = {
                    "hostname": proxy_jump.host,
                    "port": proxy_jump.port,
                    "username": proxy_jump.user,
                    "timeout": timeout,
                    "banner_timeout": timeout,
                    "auth_timeout": timeout,
                    **auth_kwargs,
                }
                if next_sock:
                    proxy_connect_kwargs["sock"] = next_sock
                proxy_client.connect(**proxy_connect_kwargs)

                transport = proxy_client.get_transport()
                if not transport:
                    raise RuntimeError("跳板机连接未建立传输通道。")
                next_destination = proxy_jumps[index + 1] if index + 1 < len(proxy_jumps) else ProxyJump(target["host"], target["port"], target["user"])
                next_sock = transport.open_channel(
                    "direct-tcpip",
                    (next_destination.host, next_destination.port),
                    ("127.0.0.1", 0),
                )

            attempt_connect_kwargs = dict(connect_kwargs)
            if next_sock:
                attempt_connect_kwargs["sock"] = next_sock
                if host_key_alias:
                    attempt_connect_kwargs["hostname"] = host_key_alias
            elif host_key_alias:
                create_socket = socket_factory or socket.create_connection
                attempt_connect_kwargs["sock"] = create_socket((target["host"], target["port"]), timeout=timeout)
                attempt_connect_kwargs["hostname"] = host_key_alias

            client.connect(**attempt_connect_kwargs)
            return ProxyChain(proxy_clients) if proxy_clients else None
        except Exception as error:
            ProxyChain(proxy_clients).close()
            last_error = error
            if attempt + 1 >= attempts:
                raise

    if last_error:
        raise last_error
    return None


def parse_server_target(server: dict) -> dict:
    raw = server if isinstance(server, dict) else {}
    try:
        port = int(str(raw.get("port") or "22").strip())
    except (TypeError, ValueError):
        port = 22
    return {
        "host": str(raw.get("ip") or raw.get("host") or "").strip(),
        "port": port,
        "user": str(raw.get("user") or "root").strip() or "root",
    }


def proxy_jump_value(server: dict, credential_metadata: dict | None) -> str:
    raw_server = server if isinstance(server, dict) else {}
    raw_metadata = credential_metadata if isinstance(credential_metadata, dict) else {}
    return str(raw_server.get("proxyJump") or raw_metadata.get("proxyJump") or "").strip()


def host_key_alias_value(server: dict, credential_metadata: dict | None) -> str:
    raw_server = server if isinstance(server, dict) else {}
    raw_metadata = credential_metadata if isinstance(credential_metadata, dict) else {}
    return str(raw_server.get("hostKeyAlias") or raw_metadata.get("hostKeyAlias") or "").strip()


def parse_proxy_jump(value: str, default_user: str = "root") -> ProxyJump | None:
    jumps = parse_proxy_jumps(value, default_user=default_user)
    return jumps[0] if jumps else None


def parse_proxy_jumps(value: str, default_user: str = "root") -> list[ProxyJump]:
    hops = []
    for item in str(value or "").split(","):
        hop = parse_proxy_jump_entry(item, default_user=default_user)
        if hop:
            hops.append(hop)
    return hops


def parse_proxy_jump_entry(value: str, default_user: str = "root") -> ProxyJump | None:
    first_hop = str(value or "").strip()
    if not first_hop or first_hop.lower() == "none":
        return None

    user = str(default_user or "root").strip() or "root"
    host_part = first_hop
    if "@" in first_hop:
        raw_user, host_part = first_hop.rsplit("@", 1)
        user = raw_user.strip() or user

    host, port = split_host_port(host_part.strip())
    if not host:
        return None
    return ProxyJump(host=host, port=port, user=user)


def split_host_port(value: str) -> tuple[str, int]:
    text = str(value or "").strip()
    if text.startswith("[") and "]" in text:
        host, rest = text[1:].split("]", 1)
        return host.strip(), parse_port(rest.removeprefix(":").strip(), 22) if rest.startswith(":") else 22

    if text.count(":") == 1:
        host, raw_port = text.rsplit(":", 1)
        if raw_port.strip().isdigit():
            return host.strip(), parse_port(raw_port, 22)

    return text, 22


def parse_port(value, fallback: int) -> int:
    try:
        port = int(str(value).strip())
    except (TypeError, ValueError):
        return fallback
    return port if 1 <= port <= 65535 else fallback


def retry_attempts(server: dict) -> int:
    raw = server if isinstance(server, dict) else {}
    try:
        retry_count = int(str(raw.get("retryCount") or "0").strip())
    except (TypeError, ValueError):
        retry_count = 0
    return min(max(retry_count, 0), 3) + 1
