from __future__ import annotations

import codecs
import time
import uuid

from ssh_auth import has_auth_material
from ssh_proxy import connect_ssh_client
from ssh_session import HostKeyVerificationError, classify_ssh_error, configure_client_host_key_policy, configure_proxy_jump_host_key_policy, read_client_host_key, verify_trusted_host_key


DEFAULT_READ_OUTPUT_MAX_BYTES = 262144
MIN_TERMINAL_COLS = 40
MAX_TERMINAL_COLS = 500
MIN_TERMINAL_ROWS = 10
MAX_TERMINAL_ROWS = 200


class SshSessionManager:
    def __init__(self, paramiko_module=None, id_factory=None):
        self.paramiko = paramiko_module or _load_paramiko()
        self.id_factory = id_factory or (lambda: uuid.uuid4().hex)
        self.sessions = {}

    def open_session(self, server: dict, password: str, timeout: int = 10, credential_metadata: dict | None = None, terminal_size: dict | None = None) -> dict:
        if not has_auth_material(password, credential_metadata or {}):
            return {"ok": False, "message": "缺少凭据：请先保存密码或密钥口令。", "failureKind": "auth"}

        target = _parse_server(server)
        if not target["host"]:
            return {"ok": False, "message": "服务器地址为空，无法打开 SSH 会话。", "failureKind": "config"}

        client = self.paramiko.SSHClient()
        proxy_client = None
        configure_client_host_key_policy(self.paramiko, client, server)
        try:
            proxy_client = connect_ssh_client(
                self.paramiko,
                client,
                server,
                password,
                credential_metadata or {},
                timeout,
                configure_proxy_host_key_policy=lambda proxy_client, proxy_jump: configure_proxy_jump_host_key_policy(self.paramiko, proxy_client, proxy_jump),
            )
            verify_trusted_host_key(client, server)
            keepalive_seconds = _server_keepalive_seconds(server)
            _enable_transport_keepalive(client, keepalive_seconds)
            _enable_proxy_chain_keepalive(proxy_client, keepalive_seconds)
            pty_size = _normalize_terminal_size(terminal_size)
            channel = client.invoke_shell(term="xterm-256color", width=pty_size["cols"], height=pty_size["rows"])
            agent_request_handler = _enable_agent_forwarding(self.paramiko, channel, server)
            channel.settimeout(0.0)
            session_id = self.id_factory()
            self.sessions[session_id] = {
                "client": client,
                "proxyClient": proxy_client,
                "channel": channel,
                "agentRequestHandler": agent_request_handler,
                "server": target,
                "keepaliveSeconds": keepalive_seconds,
                "decoder": codecs.getincrementaldecoder("utf-8")(errors="replace"),
            }
            read_result = self.read_output(session_id, wait_seconds=0.2)
            if not read_result.get("ok"):
                if session_id in self.sessions:
                    self.close_session(session_id)
                return {"ok": False, "message": read_result.get("message") or "SSH 会话已断开，请重新连接。", "output": read_result.get("output", "")}
            return {
                "ok": True,
                "sessionId": session_id,
                "hostKey": read_client_host_key(client),
                "message": "SSH 会话已连接。",
                "output": read_result.get("output", ""),
            }
        except HostKeyVerificationError as error:
            _close_quietly(client, proxy_client)
            diagnostic = classify_ssh_error(error, fallback_kind="host-key")
            return {"ok": False, "message": str(error), "failureKind": diagnostic["kind"], "sshFailure": diagnostic, **error.to_result_fields()}
        except Exception as error:
            _close_quietly(client, proxy_client)
            diagnostic = classify_ssh_error(error)
            return {"ok": False, "message": f"SSH 会话连接失败：{error}", "failureKind": diagnostic["kind"], "sshFailure": diagnostic}

    def send_command(self, session_id: str, command: str) -> dict:
        session = self.sessions.get(session_id)
        if not session:
            return {"ok": False, "message": "SSH 会话不存在或已关闭。", "output": ""}
        if _is_channel_disconnected(session["channel"]):
            self.close_session(session_id)
            return {"ok": False, "message": "SSH 会话已断开，请重新连接。", "output": ""}
        if _is_transport_inactive(session):
            self.close_session(session_id)
            return {"ok": False, "message": "SSH 会话已断开，请重新连接。", "output": ""}

        text = str(command or "").rstrip()
        if not text:
            return {"ok": False, "message": "命令为空。", "output": ""}

        try:
            _send_channel_payload(session["channel"], text + "\r")
        except Exception as error:
            self.close_session(session_id)
            return {"ok": False, "message": f"SSH 命令发送失败：{error}", "output": ""}
        read_result = self.read_output(session_id, wait_seconds=0.35)
        if not read_result.get("ok"):
            self.close_session(session_id)
            return {
                "ok": False,
                "message": read_result.get("message") or "SSH 命令输出读取失败。",
                "output": read_result.get("output", ""),
            }
        output = read_result.get("output", "")
        return {"ok": True, "message": "命令已发送。", "output": output}

    def send_input(self, session_id: str, text: str, submit: bool = False) -> dict:
        session = self.sessions.get(session_id)
        if not session:
            return {"ok": False, "message": "SSH 会话不存在或已关闭。", "output": ""}
        if _is_channel_disconnected(session["channel"]):
            self.close_session(session_id)
            return {"ok": False, "message": "SSH 会话已断开，请重新连接。", "output": ""}
        if _is_transport_inactive(session):
            self.close_session(session_id)
            return {"ok": False, "message": "SSH 会话已断开，请重新连接。", "output": ""}

        value = str(text or "")
        payload = value + ("\r" if submit else "")
        if not payload:
            return {"ok": False, "message": "交互输入为空。", "output": ""}

        try:
            _send_channel_payload(session["channel"], payload)
        except Exception as error:
            self.close_session(session_id)
            return {"ok": False, "message": f"SSH 交互输入发送失败：{error}", "output": ""}

        read_result = self.read_output(session_id, wait_seconds=0.35 if submit else 0.03)
        if not read_result.get("ok"):
            self.close_session(session_id)
            return {
                "ok": False,
                "message": read_result.get("message") or "SSH 交互输入后的输出读取失败。",
                "output": read_result.get("output", ""),
            }
        return {"ok": True, "message": "SSH 交互输入已发送。", "output": read_result.get("output", "")}

    def interrupt_command(self, session_id: str) -> dict:
        session = self.sessions.get(session_id)
        if not session:
            return {"ok": False, "message": "SSH 会话不存在或已关闭。", "output": ""}
        if _is_channel_disconnected(session["channel"]):
            self.close_session(session_id)
            return {"ok": False, "message": "SSH 会话已断开，请重新连接。", "output": ""}
        if _is_transport_inactive(session):
            self.close_session(session_id)
            return {"ok": False, "message": "SSH 会话已断开，请重新连接。", "output": ""}

        try:
            _send_channel_payload(session["channel"], "\x03")
        except Exception as error:
            self.close_session(session_id)
            return {"ok": False, "message": f"发送 Ctrl+C 中断失败：{error}", "output": ""}

        read_result = self.read_output(session_id, wait_seconds=0.2)
        if not read_result.get("ok"):
            self.close_session(session_id)
            return {
                "ok": False,
                "message": read_result.get("message") or "SSH 中断后输出读取失败。",
                "output": read_result.get("output", ""),
            }
        output = read_result.get("output", "")
        return {"ok": True, "message": "已发送 Ctrl+C 中断当前命令。", "output": output}

    def resize_session(self, session_id: str, width: int, height: int) -> dict:
        session = self.sessions.get(session_id)
        if not session:
            return {"ok": False, "message": "SSH 会话不存在或已关闭。"}
        if _is_channel_disconnected(session["channel"]):
            self.close_session(session_id)
            return {"ok": False, "message": "SSH 会话已断开，请重新连接。"}
        if _is_transport_inactive(session):
            self.close_session(session_id)
            return {"ok": False, "message": "SSH 会话已断开，请重新连接。"}

        cols = min(max(_safe_int(width, 120), MIN_TERMINAL_COLS), MAX_TERMINAL_COLS)
        rows = min(max(_safe_int(height, 32), MIN_TERMINAL_ROWS), MAX_TERMINAL_ROWS)
        try:
            session["channel"].resize_pty(width=cols, height=rows)
        except Exception as error:
            self.close_session(session_id)
            return {"ok": False, "message": f"SSH 终端尺寸同步失败：{error}"}
        return {"ok": True, "sessionId": session_id, "width": cols, "height": rows, "message": "SSH 终端尺寸已同步。"}

    def read_output(self, session_id: str, wait_seconds: float = 0.1) -> dict:
        session = self.sessions.get(session_id)
        if not session:
            return {"ok": False, "message": "SSH 会话不存在或已关闭。", "output": ""}

        channel = session["channel"]
        chunks = []
        bytes_read = 0
        has_more = False
        deadline = time.monotonic() + max(wait_seconds, 0)
        while True:
            try:
                if channel.recv_ready():
                    remaining = DEFAULT_READ_OUTPUT_MAX_BYTES - bytes_read
                    if remaining <= 0:
                        has_more = True
                        break
                    data = channel.recv(min(4096, remaining))
                    if not data:
                        self.close_session(session_id)
                        return {"ok": False, "message": "SSH 会话已断开，请重新连接。", "output": _decode_session(session, chunks, final=True)}
                    chunks.append(data)
                    bytes_read += len(data)
                    continue
                channel_closed = bool(getattr(channel, "closed", False))
                shell_exited = bool(getattr(channel, "exit_status_ready", lambda: False)())
                transport_inactive = _is_transport_inactive(session)
                if channel_closed or shell_exited or transport_inactive:
                    self.close_session(session_id)
                    return {"ok": False, "message": "SSH 会话已断开，请重新连接。", "output": _decode_session(session, chunks, final=True)}
            except Exception as error:
                self.close_session(session_id)
                return {"ok": False, "message": f"读取 SSH 输出失败：{error}", "output": _decode_session(session, chunks)}

            if time.monotonic() >= deadline:
                break
            time.sleep(0.03)

        if has_more:
            return {"ok": True, "message": "SSH 输出已读取本轮上限，仍有输出待继续读取。", "output": _decode_session(session, chunks), "hasMore": True}

        return {"ok": True, "message": "SSH 输出读取完成。", "output": _decode_session(session, chunks)}

    def check_session_health(self, session_id: str) -> dict:
        session = self.sessions.get(session_id)
        if not session:
            return {"ok": False, "active": False, "sessionId": session_id, "message": "SSH 会话不存在或已关闭。"}

        try:
            channel_closed = bool(getattr(session["channel"], "closed", False))
            shell_exited = bool(getattr(session["channel"], "exit_status_ready", lambda: False)())
            transport = session["client"].get_transport()
            active = bool(transport and transport.is_active() and not channel_closed and not shell_exited)
        except Exception as error:
            self.close_session(session_id)
            return {"ok": False, "active": False, "sessionId": session_id, "message": f"SSH 会话心跳检查失败：{error}"}

        if not active:
            self.close_session(session_id)
            return {"ok": False, "active": False, "sessionId": session_id, "message": "SSH 会话已断开，请重新连接。"}
        return {
            "ok": True,
            "active": True,
            "sessionId": session_id,
            "keepaliveSeconds": session.get("keepaliveSeconds", 30),
            "message": "SSH 会话正常。",
        }

    def close_session(self, session_id: str) -> dict:
        session = self.sessions.pop(session_id, None)
        if not session:
            return {"ok": False, "message": "SSH 会话不存在或已关闭。"}

        _close_quietly(session.get("agentRequestHandler"), session["channel"], session["client"], session.get("proxyClient"))
        return {"ok": True, "message": "SSH 会话已关闭。"}


def _close_quietly(*items):
    for item in items:
        if not item:
            continue
        try:
            item.close()
        except Exception:
            pass


def _send_channel_payload(channel, payload: str) -> None:
    data = str(payload or "").encode("utf-8")
    if not data:
        return

    send_all = getattr(channel, "sendall", None)
    if callable(send_all):
        send_all(data)
        return

    sent = 0
    while sent < len(data):
        written = channel.send(data[sent:])
        if not written:
            raise RuntimeError("SSH channel accepted 0 bytes while sending input")
        sent += int(written)


def _is_channel_disconnected(channel) -> bool:
    try:
        if bool(getattr(channel, "closed", False)):
            return True
        exit_status_ready = getattr(channel, "exit_status_ready", None)
        return bool(callable(exit_status_ready) and exit_status_ready())
    except Exception:
        return True


def _is_transport_inactive(session: dict) -> bool:
    try:
        client = session.get("client") if isinstance(session, dict) else None
        transport = client.get_transport() if client and hasattr(client, "get_transport") else None
        return bool(transport is None or not transport.is_active())
    except Exception:
        return True


def _enable_transport_keepalive(client, interval_seconds: int) -> None:
    try:
        interval = _safe_int(interval_seconds, 30)
        if interval <= 0:
            return
        transport = client.get_transport()
        if transport and hasattr(transport, "set_keepalive"):
            transport.set_keepalive(min(max(interval, 10), 300))
    except Exception:
        pass


def _enable_proxy_chain_keepalive(proxy_chain, interval_seconds: int) -> None:
    for client in getattr(proxy_chain, "clients", []) or []:
        _enable_transport_keepalive(client, interval_seconds)


def _enable_agent_forwarding(paramiko_module, channel, server: dict):
    if not bool((server or {}).get("forwardAgent")):
        return None
    try:
        agent_module = getattr(paramiko_module, "agent", None)
        handler_factory = getattr(agent_module, "AgentRequestHandler", None)
        if callable(handler_factory):
            return handler_factory(channel)
    except Exception:
        return None
    return None


def _server_keepalive_seconds(server: dict) -> int:
    value = _safe_int((server or {}).get("keepaliveSeconds"), 30)
    if value <= 0:
        return 0
    return min(max(value, 10), 300)


def _normalize_terminal_size(terminal_size: dict | None) -> dict:
    terminal_size = terminal_size if isinstance(terminal_size, dict) else {}
    cols = _safe_int(terminal_size.get("cols") or terminal_size.get("width"), 120)
    rows = _safe_int(terminal_size.get("rows") or terminal_size.get("height"), 32)
    return {
        "cols": min(max(cols, MIN_TERMINAL_COLS), MAX_TERMINAL_COLS),
        "rows": min(max(rows, MIN_TERMINAL_ROWS), MAX_TERMINAL_ROWS),
    }


def _decode(chunks) -> str:
    return b"".join(chunks).decode("utf-8", errors="replace").replace("\r\n", "\n")


def _decode_session(session: dict, chunks, final: bool = False) -> str:
    data = b"".join(chunks)
    decoder = session.get("decoder") if isinstance(session, dict) else None
    if not decoder:
        return _decode(chunks)
    return decoder.decode(data, final=final).replace("\r\n", "\n")


def _safe_int(value, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _parse_server(server: dict) -> dict:
    try:
        port = int(str(server.get("port") or "22").strip())
    except ValueError:
        port = 22
    return {
        "host": str(server.get("ip") or server.get("host") or "").strip(),
        "port": port,
        "user": str(server.get("user") or "root").strip() or "root",
    }


def _load_paramiko():
    try:
        import paramiko
    except ImportError as error:
        raise RuntimeError("当前运行环境缺少 Paramiko，无法建立真实 SSH 会话。") from error
    return paramiko
