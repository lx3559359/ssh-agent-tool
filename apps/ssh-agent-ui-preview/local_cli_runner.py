from __future__ import annotations

import shlex
import socket
import subprocess
import sys
import time
from typing import Any


DANGEROUS_EXECUTABLES = {
    "cmd",
    "cmd.exe",
    "powershell",
    "powershell.exe",
    "pwsh",
    "pwsh.exe",
    "bash",
    "sh",
    "wsl",
    "rm",
    "del",
    "format",
    "shutdown",
    "reg",
    "sc",
    "taskkill",
}


def normalize_local_cli_command(command: str) -> str:
    text = str(command or "").strip()
    lowered = text.lower()
    if lowered.startswith("local:"):
        return text[len("local:") :].strip()
    if lowered.startswith("cli://local/"):
        return text[len("cli://local/") :].strip()
    return text


def validate_local_cli_command(command: str) -> dict:
    normalized = normalize_local_cli_command(command)
    if not normalized:
        return {"ok": False, "command": normalized, "message": "本地 CLI 命令为空。"}
    if len(normalized) > 500:
        return {"ok": False, "command": normalized, "message": "本地 CLI 命令过长。"}
    if any(char in normalized for char in [";", "&", "|", ">", "<", "`"]):
        return {"ok": False, "command": normalized, "message": "本地 CLI Runner 不允许 shell 拼接、管道或重定向。"}

    try:
        args = shlex.split(normalized, posix=False)
    except ValueError as exc:
        return {"ok": False, "command": normalized, "message": f"本地 CLI 命令解析失败：{exc}"}

    if not args:
        return {"ok": False, "command": normalized, "message": "本地 CLI 命令为空。"}
    executable = args[0].strip().lower()
    if executable in DANGEROUS_EXECUTABLES:
        return {"ok": False, "command": normalized, "message": f"本地 CLI Runner 不允许直接启动高风险解释器或系统命令：{args[0]}"}
    return {"ok": True, "command": normalized, "args": args, "message": "ok"}


def run_local_cli_command(command: str, timeout: int = 20, runner=None, cancel_event=None, popen_factory=None) -> dict:
    validation = validate_local_cli_command(command)
    if not validation.get("ok"):
        return {"ok": False, "command": validation.get("command", ""), "returnCode": 0, "stdout": "", "stderr": "", "message": validation.get("message", "本地 CLI 命令无效。")}

    safe_timeout = coerce_timeout(timeout)
    if is_builtin_ssh_diagnostic(validation["args"]):
        if cancel_event is not None and cancel_event.is_set():
            return {"ok": False, "command": validation["command"], "returnCode": 130, "stdout": "", "stderr": "", "message": "本地 CLI 执行已取消。"}
        return run_builtin_ssh_diagnostic(validation["command"], validation["args"], safe_timeout)

    if cancel_event is not None or popen_factory is not None:
        return run_cancellable_process(validation["command"], validation["args"], safe_timeout, cancel_event=cancel_event, popen_factory=popen_factory)

    execute = runner or subprocess.run
    try:
        completed = execute(
            validation["args"],
            shell=False,
            capture_output=True,
            text=True,
            timeout=safe_timeout,
            **windows_hidden_process_kwargs(),
        )
    except FileNotFoundError:
        return {"ok": False, "command": validation["command"], "returnCode": 127, "stdout": "", "stderr": "", "message": "本地 CLI 程序不存在或未加入 PATH。"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "command": validation["command"], "returnCode": 124, "stdout": "", "stderr": "", "message": "本地 CLI 执行超时。"}
    except OSError as exc:
        return {"ok": False, "command": validation["command"], "returnCode": 1, "stdout": "", "stderr": "", "message": f"本地 CLI 执行失败：{exc}"}

    return_code = int(getattr(completed, "returncode", 0) or 0)
    stdout = str(getattr(completed, "stdout", "") or "")
    stderr = str(getattr(completed, "stderr", "") or "")
    return {
        "ok": return_code == 0,
        "command": validation["command"],
        "returnCode": return_code,
        "stdout": stdout,
        "stderr": stderr,
        "message": "本地 CLI 执行完成。" if return_code == 0 else "本地 CLI 返回非零退出码。",
    }


def run_cancellable_process(command: str, args: list[str], timeout: int, cancel_event=None, popen_factory=None) -> dict:
    popen = popen_factory or subprocess.Popen
    started = time.monotonic()
    try:
        process = popen(
            args,
            shell=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            **windows_hidden_process_kwargs(),
        )
    except FileNotFoundError:
        return {"ok": False, "command": command, "returnCode": 127, "stdout": "", "stderr": "", "message": "本地 CLI 程序不存在或未加入 PATH。"}
    except OSError as exc:
        return {"ok": False, "command": command, "returnCode": 1, "stdout": "", "stderr": "", "message": f"本地 CLI 执行失败：{exc}"}

    while process.poll() is None:
        if cancel_event is not None and cancel_event.is_set():
            process.kill()
            stdout, stderr = process.communicate(timeout=1)
            return {"ok": False, "command": command, "returnCode": 130, "stdout": str(stdout or ""), "stderr": str(stderr or ""), "message": "本地 CLI 执行已取消。"}
        if time.monotonic() - started >= timeout:
            process.kill()
            stdout, stderr = process.communicate(timeout=1)
            return {"ok": False, "command": command, "returnCode": 124, "stdout": str(stdout or ""), "stderr": str(stderr or ""), "message": "本地 CLI 执行超时。"}
        time.sleep(0.05)

    stdout, stderr = process.communicate()
    return_code = int(getattr(process, "returncode", 0) or 0)
    return {
        "ok": return_code == 0,
        "command": command,
        "returnCode": return_code,
        "stdout": str(stdout or ""),
        "stderr": str(stderr or ""),
        "message": "本地 CLI 执行完成。" if return_code == 0 else "本地 CLI 返回非零退出码。",
    }


def coerce_timeout(timeout: Any) -> int:
    try:
        value = int(timeout)
    except (TypeError, ValueError):
        value = 20
    return min(max(value, 3), 120)


def windows_hidden_process_kwargs() -> dict[str, int]:
    if sys.platform != "win32":
        return {}
    return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}


def is_builtin_ssh_diagnostic(args: list[str]) -> bool:
    return len(args) >= 2 and args[0].lower() == "ssh-agent-tool" and args[1].lower() == "diagnose-ssh"


def run_builtin_ssh_diagnostic(command: str, args: list[str], timeout: int) -> dict:
    options = parse_ssh_diagnostic_args(args[2:])
    host = options.get("host", "")
    port_text = options.get("port", "22")
    kind = options.get("kind", "unknown")

    if not host:
        return {"ok": False, "command": command, "returnCode": 2, "stdout": "", "stderr": "", "message": "SSH 诊断缺少目标主机。"}

    try:
        port = int(port_text)
    except (TypeError, ValueError):
        return {"ok": False, "command": command, "returnCode": 2, "stdout": "", "stderr": "", "message": "SSH 诊断端口无效。"}
    if port < 1 or port > 65535:
        return {"ok": False, "command": command, "returnCode": 2, "stdout": "", "stderr": "", "message": "SSH 诊断端口超出范围。"}

    target = f"{host}:{port}"
    try:
        with socket.create_connection((host, port), timeout=timeout):
            pass
    except (TimeoutError, socket.timeout):
        message = f"SSH TCP 探测超时：{target}"
        return {
            "ok": False,
            "command": command,
            "returnCode": 124,
            "stdout": f"{message}\n诊断类型：{kind}\n建议检查安全组、防火墙、VPN/堡垒机路由和目标主机在线状态。",
            "stderr": "",
            "message": message,
        }
    except OSError as exc:
        message = f"SSH TCP 探测失败：{target}"
        return {
            "ok": False,
            "command": command,
            "returnCode": 1,
            "stdout": f"{message}\n诊断类型：{kind}\n错误：{exc}\n如果端口拒绝连接，请检查 sshd 是否监听该端口。",
            "stderr": "",
            "message": message,
        }

    return {
        "ok": True,
        "command": command,
        "returnCode": 0,
        "stdout": f"SSH TCP 探测成功：{target}\n诊断类型：{kind}\n本机到目标 SSH 端口可达，可继续检查用户名、密钥/密码或服务端 SSH 配置。",
        "stderr": "",
        "message": "SSH TCP 探测成功。",
    }


def parse_ssh_diagnostic_args(args: list[str]) -> dict:
    options = {}
    index = 0
    while index < len(args):
        token = str(args[index] or "").strip()
        if token in {"--host", "--port", "--kind"} and index + 1 < len(args):
            options[token[2:]] = str(args[index + 1] or "").strip().strip('"')
            index += 2
            continue
        index += 1
    return options
