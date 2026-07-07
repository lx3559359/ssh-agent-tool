from __future__ import annotations

import select
import socket
import threading
import uuid

from ssh_auth import has_auth_material
from ssh_proxy import connect_ssh_client
from ssh_session import HostKeyVerificationError, configure_client_host_key_policy, configure_proxy_jump_host_key_policy, verify_trusted_host_key


class PortForwardManager:
    def __init__(self, forward_factory=None, id_factory=None):
        self.forward_factory = forward_factory or LocalPortForward
        self.id_factory = id_factory or (lambda: f"pf-{uuid.uuid4().hex[:12]}")
        self.forwards = {}

    def start_forward(self, server: dict, secret: str, credential_metadata: dict, config: dict) -> dict:
        if not has_auth_material(secret, credential_metadata if isinstance(credential_metadata, dict) else {}):
            return {"ok": False, "message": "缺少凭据：请先为该服务器绑定密码或私钥。"}

        validation = validate_forward_config(config)
        if not validation["ok"]:
            return validation

        normalized = validation["config"]
        endpoint = (normalized["localHost"], normalized["localPort"])
        if any(item["localHost"] == endpoint[0] and item["localPort"] == endpoint[1] for item in self.forwards.values()):
            return {"ok": False, "message": f"本地端口已在转发：{endpoint[0]}:{endpoint[1]}"}

        forward_id = self.id_factory()
        forward = self.forward_factory(
            forward_id=forward_id,
            server=server if isinstance(server, dict) else {},
            secret=secret,
            credential_metadata=credential_metadata if isinstance(credential_metadata, dict) else {},
            config=normalized,
        )
        try:
            started = forward.start()
        except HostKeyVerificationError as error:
            stop_failed_forward(forward)
            return {"ok": False, "message": str(error), **error.to_result_fields()}
        except Exception as error:
            stop_failed_forward(forward)
            return {"ok": False, "message": f"端口转发启动失败：{error}"}
        normalized["localPort"] = int(started.get("localPort") or normalized["localPort"])
        record = {"id": forward_id, **normalized, "server": str((server or {}).get("ip") or (server or {}).get("host") or ""), "status": "运行中"}
        self.forwards[forward_id] = {**record, "_forward": forward}
        return {"ok": True, "forward": record, "message": f"端口转发已启动：{record['localHost']}:{record['localPort']} -> {record['remoteHost']}:{record['remotePort']}"}

    def stop_forward(self, forward_id: str) -> dict:
        safe_forward_id = str(forward_id or "")
        record = self.forwards.get(safe_forward_id)
        if not record:
            return {"ok": False, "message": "端口转发不存在或已停止。"}
        try:
            record["_forward"].stop()
        except Exception as error:
            return {"ok": False, "message": f"端口转发停止失败：{error}"}
        self.forwards.pop(safe_forward_id, None)
        return {"ok": True, "message": "端口转发已停止。"}

    def list_forwards(self) -> dict:
        return {"ok": True, "forwards": [strip_forward(record) for record in self.forwards.values()]}


class LocalPortForward:
    def __init__(self, forward_id: str, server: dict, secret: str, credential_metadata: dict, config: dict, paramiko_module=None):
        self.forward_id = forward_id
        self.server = server
        self.secret = secret
        self.credential_metadata = credential_metadata
        self.config = config
        self.paramiko = paramiko_module
        self.client = None
        self.proxy_client = None
        self.listener = None
        self.stop_event = threading.Event()
        self.thread = None

    def start(self):
        paramiko = self.paramiko or load_paramiko()
        self.client = paramiko.SSHClient()
        configure_client_host_key_policy(paramiko, self.client, self.server)
        try:
            self.proxy_client = connect_ssh_client(
                paramiko,
                self.client,
                self.server,
                self.secret,
                self.credential_metadata,
                parse_timeout(self.server.get("timeoutSeconds"), 10),
                configure_proxy_host_key_policy=lambda proxy_client, proxy_jump: configure_proxy_jump_host_key_policy(paramiko, proxy_client, proxy_jump),
            )
            verify_trusted_host_key(self.client, self.server)

            self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.listener.bind((self.config["localHost"], self.config["localPort"]))
            self.listener.listen(50)
            self.thread = threading.Thread(target=self.accept_loop, name=f"ssh-port-forward-{self.forward_id}", daemon=True)
            self.thread.start()
            return {"localPort": self.listener.getsockname()[1]}
        except Exception:
            self.stop()
            raise

    def stop(self):
        self.stop_event.set()
        for item in (self.listener, self.client, self.proxy_client):
            try:
                if item:
                    item.close()
            except Exception:
                pass

    def accept_loop(self):
        while not self.stop_event.is_set():
            try:
                client_socket, client_address = self.listener.accept()
            except OSError:
                break
            thread = threading.Thread(target=self.handle_client, args=(client_socket, client_address), daemon=True)
            thread.start()

    def handle_client(self, client_socket, client_address):
        channel = None
        try:
            transport = self.client.get_transport()
            channel = transport.open_channel(
                "direct-tcpip",
                (self.config["remoteHost"], self.config["remotePort"]),
                client_address,
            )
            pipe_sockets(client_socket, channel, self.stop_event)
        except Exception:
            pass
        finally:
            for item in (channel, client_socket):
                try:
                    if item:
                        item.close()
                except Exception:
                    pass


def validate_forward_config(config: dict) -> dict:
    raw = config if isinstance(config, dict) else {}
    local_host = str(raw.get("localHost") or "127.0.0.1").strip() or "127.0.0.1"
    remote_host = str(raw.get("remoteHost") or "").strip()
    local_port = parse_port(raw.get("localPort"), 0)
    remote_port = parse_port(raw.get("remotePort"), 0)

    errors = []
    if not remote_host:
        errors.append("远程地址不能为空")
    if not is_valid_port(local_port):
        errors.append("本地端口必须在 1-65535 之间")
    if not is_valid_port(remote_port):
        errors.append("远程端口必须在 1-65535 之间")
    if local_host not in {"127.0.0.1", "localhost"}:
        errors.append("当前版本仅允许监听 127.0.0.1，避免端口暴露到局域网")

    if errors:
        return {"ok": False, "message": "；".join(errors)}
    return {"ok": True, "config": {"localHost": "127.0.0.1", "localPort": local_port, "remoteHost": remote_host, "remotePort": remote_port}}


def pipe_sockets(left, right, stop_event):
    sockets = [left, right]
    while not stop_event.is_set():
        readable, _, _ = select.select(sockets, [], [], 0.5)
        if not readable:
            continue
        for source in readable:
            target = right if source is left else left
            data = source.recv(32768)
            if not data:
                return
            target.sendall(data)


def strip_forward(record: dict) -> dict:
    return {key: value for key, value in record.items() if key != "_forward"}


def stop_failed_forward(forward) -> None:
    try:
        forward.stop()
    except Exception:
        pass


def parse_port(value, fallback: int) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return fallback


def parse_timeout(value, fallback: int = 10) -> int:
    try:
        timeout = int(str(value).strip())
    except (TypeError, ValueError):
        timeout = fallback
    return min(max(timeout, 3), 60)


def is_valid_port(port: int) -> bool:
    return 1 <= int(port or 0) <= 65535


def load_paramiko():
    try:
        import paramiko
    except ImportError as error:
        raise RuntimeError("当前运行环境缺少 Paramiko，无法启动 SSH 端口转发。") from error
    return paramiko
