from __future__ import annotations

import socket
import time
from typing import Callable


SocketFactory = Callable[[tuple[str, int], float], socket.socket]
Clock = Callable[[], float]


def probe_ssh_endpoint(
    host: str,
    port: str | int = 22,
    timeout: float = 3.0,
    socket_factory: SocketFactory | None = None,
    clock: Clock | None = None,
) -> dict:
    address = str(host or "").strip()
    port_number = _parse_port(port)
    now = clock or time.perf_counter
    connect = socket_factory or socket.create_connection
    start = now()

    if not address:
        return _offline("--", "连接失败：服务器地址为空。")
    if port_number is None:
        return _offline("--", "连接失败：端口无效。")

    sock = None
    try:
        sock = connect((address, port_number), timeout)
        sock.settimeout(timeout)
        banner = _read_banner(sock)
        latency = f"{max(round((now() - start) * 1000), 0)}ms"
    except (OSError, TimeoutError, socket.timeout) as error:
        return _offline("--", f"连接失败：{error}")
    finally:
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass

    if banner.startswith("SSH-"):
        return {
            "ok": True,
            "state": "在线",
            "tone": "green",
            "latency": latency,
            "banner": banner,
            "message": f"SSH 服务可达：{banner}",
        }

    display_banner = banner or "未返回 banner"
    return {
        "ok": False,
        "state": "异常",
        "tone": "amber",
        "latency": latency,
        "banner": banner,
        "message": f"端口可达，但不是 SSH 服务：{display_banner}",
    }


def _parse_port(port: str | int) -> int | None:
    try:
        port_number = int(str(port).strip())
    except (TypeError, ValueError):
        return None
    if port_number < 1 or port_number > 65535:
        return None
    return port_number


def _read_banner(sock: socket.socket) -> str:
    data = sock.recv(255)
    return data.decode("utf-8", errors="replace").strip()


def _offline(latency: str, message: str) -> dict:
    return {
        "ok": False,
        "state": "离线",
        "tone": "gray",
        "latency": latency,
        "banner": "",
        "message": message,
    }
