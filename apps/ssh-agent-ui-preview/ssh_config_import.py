from __future__ import annotations

import shlex


PATTERN_CHARS = set("*?[]!")


def parse_ssh_config(content: str) -> dict:
    sections = []
    active = None
    skipped = 0

    for raw_line in str(content or "").splitlines():
        tokens = parse_config_line(raw_line)
        if not tokens:
            continue

        key = tokens[0].lower()
        values = tokens[1:]
        if key == "host":
            if active:
                sections.append(active)
            aliases = [value for value in values if value]
            concrete_aliases = [alias for alias in aliases if not is_host_pattern(alias)]
            skipped += len(aliases) - len(concrete_aliases)
            active = {"aliases": concrete_aliases, "options": {}}
            continue

        if not active or not active.get("aliases"):
            continue

        if key == "localforward" and len(values) >= 2:
            forward = parse_local_forward(values[0], values[1])
            if forward:
                active["options"].setdefault("localforwards", []).append(forward)
            continue

        if key == "remoteforward" and len(values) >= 2:
            forward = parse_remote_forward(values[0], values[1])
            if forward:
                active["options"].setdefault("remoteforwards", []).append(forward)
            continue

        if key == "dynamicforward" and values:
            forward = parse_dynamic_forward(values[0])
            if forward:
                active["options"].setdefault("dynamicforwards", []).append(forward)
            continue

        if key in {"hostname", "user", "port", "identityfile", "connecttimeout", "connectionattempts", "serveraliveinterval", "serveralivecountmax", "forwardagent", "proxyjump", "hostkeyalias"} and values:
            active["options"].setdefault(key, values[0])

    if active:
        sections.append(active)

    hosts = []
    for section in sections:
        options = section.get("options", {})
        for alias in section.get("aliases", []):
            host = {
                "name": alias,
                "host": options.get("hostname") or alias,
                "user": options.get("user") or "root",
                "port": options.get("port") or "22",
                "identityFile": options.get("identityfile") or "",
                "connectTimeout": options.get("connecttimeout") or "",
                "connectionAttempts": options.get("connectionattempts") or "",
                "serverAliveInterval": options.get("serveraliveinterval") or "",
                "serverAliveCountMax": options.get("serveralivecountmax") or "",
                "forwardAgent": options.get("forwardagent") or "",
                "proxyJump": options.get("proxyjump") or "",
                "hostKeyAlias": options.get("hostkeyalias") or "",
                "localForwards": list(options.get("localforwards") or []),
                "remoteForwards": list(options.get("remoteforwards") or []),
                "dynamicForwards": list(options.get("dynamicforwards") or []),
            }
            hosts.append(host)

    return {
        "ok": True,
        "hosts": hosts,
        "skipped": skipped,
        "message": f"已解析 {len(hosts)} 台 SSH 主机，跳过 {skipped} 个通配符 Host。",
    }


def parse_config_line(line: str) -> list[str]:
    stripped = str(line or "").strip()
    if not stripped or stripped.startswith("#"):
        return []
    try:
        return shlex.split(stripped, comments=True, posix=True)
    except ValueError:
        return stripped.split()


def is_host_pattern(alias: str) -> bool:
    return any(char in PATTERN_CHARS for char in str(alias or ""))


def parse_local_forward(local_spec: str, remote_spec: str) -> dict | None:
    local_host, local_port = split_forward_endpoint(local_spec, default_host="127.0.0.1")
    remote_host, remote_port = split_forward_endpoint(remote_spec, default_host="")
    if not local_port or not remote_host or not remote_port:
        return None
    return {
        "localHost": local_host or "127.0.0.1",
        "localPort": local_port,
        "remoteHost": remote_host,
        "remotePort": remote_port,
    }


def parse_remote_forward(remote_spec: str, local_spec: str) -> dict | None:
    remote_host, remote_port = split_forward_endpoint(remote_spec, default_host="127.0.0.1")
    local_host, local_port = split_forward_endpoint(local_spec, default_host="")
    if not remote_port or not local_host or not local_port:
        return None
    return {
        "remoteHost": remote_host or "127.0.0.1",
        "remotePort": remote_port,
        "localHost": local_host,
        "localPort": local_port,
    }


def parse_dynamic_forward(bind_spec: str) -> dict | None:
    bind_host, bind_port = split_forward_endpoint(bind_spec, default_host="127.0.0.1")
    if not bind_port:
        return None
    return {
        "bindHost": bind_host or "127.0.0.1",
        "bindPort": bind_port,
    }


def split_forward_endpoint(value: str, default_host: str = "") -> tuple[str, str]:
    text = str(value or "").strip()
    if not text:
        return default_host, ""
    if text.startswith("[") and "]:" in text:
        host, port = text[1:].split("]:", 1)
        return host.strip(), port.strip()
    if ":" not in text:
        return default_host, text
    host, port = text.rsplit(":", 1)
    return host.strip() or default_host, port.strip()
