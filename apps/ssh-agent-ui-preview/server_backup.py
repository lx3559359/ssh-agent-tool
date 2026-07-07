from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

from backup_crypto import decrypt_secret, encrypt_secret, validate_master_password


BACKUP_SCHEMA = "ssh-agent-tool.backup.v1"
DEFAULT_SCOPE = {
    "hosts": True,
    "sftp": True,
    "skills": True,
    "mcp": True,
    "cli": True,
    "portForwards": True,
    "commandSnippets": True,
    "modelProfiles": True,
    "secrets": False,
}


def write_backup_file(payload: dict, target_path: str | Path) -> dict:
    backup = validate_backup_payload(payload)
    target = normalize_backup_path(target_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(backup, ensure_ascii=False, indent=2), encoding="utf-8")
    sha256 = hashlib.sha256(target.read_bytes()).hexdigest().upper()
    return {
        "ok": True,
        "path": str(target),
        "fileName": target.name,
        "sizeBytes": target.stat().st_size,
        "sha256": sha256,
        "summary": summarize_backup_file(backup),
    }


def read_backup_file(source_path: str | Path) -> dict:
    try:
        source = normalize_backup_path(source_path)
        backup = validate_backup_payload(json.loads(source.read_text(encoding="utf-8")))
    except json.JSONDecodeError:
        return {"ok": False, "errorCode": "invalid_json", "message": "备份文件不是有效的 JSON。"}
    except ValueError as error:
        error_code = str(error) or "invalid_backup"
        message = "不支持的备份文件格式。" if error_code == "unsupported_schema" else "备份文件路径或内容无效。"
        return {"ok": False, "errorCode": error_code, "message": message}
    except OSError as error:
        return {"ok": False, "errorCode": "file_read_failed", "message": f"读取备份文件失败：{error}"}

    return {
        "ok": True,
        "path": str(source),
        "fileName": source.name,
        "backup": backup,
        "summary": summarize_backup_file(backup),
    }


def validate_backup_payload(payload: dict) -> dict:
    if not isinstance(payload, dict) or payload.get("schema") != BACKUP_SCHEMA:
        raise ValueError("unsupported_schema")
    return payload


def normalize_backup_path(path: str | Path) -> Path:
    text = str(path or "").strip()
    if not text:
        raise ValueError("empty_path")
    return Path(text)


def summarize_backup_file(backup: dict) -> dict:
    manifest = backup.get("manifest") if isinstance(backup.get("manifest"), dict) else {}
    host_count = manifest_int(manifest, "hostCount", len(backup.get("hosts") if isinstance(backup.get("hosts"), list) else []))
    agent_capability_count = manifest_int(
        manifest,
        "agentCapabilityCount",
        len(backup.get("skills") if isinstance(backup.get("skills"), list) else [])
        + len(backup.get("mcp") if isinstance(backup.get("mcp"), list) else [])
        + len(backup.get("cli") if isinstance(backup.get("cli"), list) else []),
    )
    encrypted_credential_count = manifest_int(manifest, "encryptedCredentialCount", 0)
    skipped_credential_count = manifest_int(manifest, "skippedCredentialCount", 0)
    sensitive_mcp_header_count = manifest_int(manifest, "sensitiveMcpHeaderCount", 0)
    model_profile_count = manifest_int(
        manifest,
        "modelProfileCount",
        len(backup.get("modelProfiles") if isinstance(backup.get("modelProfiles"), list) else []),
    )
    includes_secrets = bool(manifest.get("includesSecrets") or backup.get("encryption", {}).get("enabled"))
    requires_master_password = includes_secrets and (encrypted_credential_count > 0 or sensitive_mcp_header_count > 0)
    message = (
        f"已读取备份：{host_count} 台服务器，{agent_capability_count} 个 Agent 能力，{model_profile_count} 个模型 API 档案，"
        f"{encrypted_credential_count} 个加密凭据。"
    )
    if skipped_credential_count > 0:
        message = f"{message} 注意：{skipped_credential_count} 个凭据未导出，需要导入后重新绑定。"
    return {
        "schema": BACKUP_SCHEMA,
        "exportedAt": str(manifest.get("exportedAt") or backup.get("exportedAt") or ""),
        "hostCount": host_count,
        "agentCapabilityCount": agent_capability_count,
        "modelProfileCount": model_profile_count,
        "encryptedCredentialCount": encrypted_credential_count,
        "skippedCredentialCount": skipped_credential_count,
        "sensitiveMcpHeaderCount": sensitive_mcp_header_count,
        "includesSecrets": includes_secrets,
        "requiresMasterPassword": requires_master_password,
        "message": message,
    }


def manifest_int(manifest: dict, key: str, fallback: int) -> int:
    try:
        value = int(str(manifest.get(key, fallback)).strip())
    except (TypeError, ValueError):
        value = fallback
    return max(value, 0)


def build_backup_payload(
    servers: dict,
    scope: dict | None,
    master_password: str,
    credential_store,
    agent_capabilities: list | None = None,
    port_forward_presets: list | None = None,
    command_snippets: list | None = None,
    model_config: dict | None = None,
    model_profiles: list | None = None,
    exported_at: str | None = None,
) -> dict:
    next_scope = {**DEFAULT_SCOPE, **(scope if isinstance(scope, dict) else {})}
    include_secrets = bool(next_scope.get("secrets"))
    if include_secrets:
        validate_master_password(master_password)

    server_map = servers if isinstance(servers, dict) else {}
    exported_at_value = exported_at or utc_now()
    hosts = build_backup_hosts(server_map, include_secrets, master_password, credential_store) if next_scope.get("hosts") else []
    sftp_bookmarks = build_sftp_bookmarks(server_map) if next_scope.get("sftp") else []
    skills = build_capabilities_by_type(agent_capabilities, "Skill") if next_scope.get("skills") else []
    mcp = build_capabilities_by_type(agent_capabilities, "MCP", include_secrets, master_password) if next_scope.get("mcp") else []
    cli = build_capabilities_by_type(agent_capabilities, "CLI") if next_scope.get("cli") else []
    port_forwards = build_port_forward_presets(port_forward_presets) if next_scope.get("portForwards") else []
    safe_command_snippets = build_command_snippets(command_snippets) if next_scope.get("commandSnippets") else []
    safe_model_profiles = build_model_profiles(model_profiles, model_config) if next_scope.get("modelProfiles") else []
    safe_model_config = build_model_config(model_config) if next_scope.get("modelProfiles") else None

    return {
        "schema": BACKUP_SCHEMA,
        "exportedAt": exported_at_value,
        "manifest": build_backup_manifest(
            exported_at_value,
            include_secrets,
            hosts,
            sftp_bookmarks,
            skills,
            mcp,
            cli,
            port_forwards,
            safe_command_snippets,
            safe_model_profiles,
        ),
        "encryption": encryption_info(include_secrets),
        "hosts": hosts,
        "sftpBookmarks": sftp_bookmarks,
        "skills": skills,
        "mcp": mcp,
        "cli": cli,
        "portForwards": port_forwards,
        "commandSnippets": safe_command_snippets,
        "modelConfig": safe_model_config,
        "modelProfiles": safe_model_profiles,
    }


def build_backup_manifest(
    exported_at: str,
    include_secrets: bool,
    hosts: list,
    sftp_bookmarks: list,
    skills: list,
    mcp: list,
    cli: list,
    port_forwards: list | None = None,
    command_snippets: list | None = None,
    model_profiles: list | None = None,
) -> dict:
    capability_counts = {
        "skill": len(skills),
        "mcp": len(mcp),
        "cli": len(cli),
    }
    return {
        "schemaVersion": 1,
        "exportedAt": exported_at,
        "hostCount": len(hosts),
        "sftpBookmarkCount": sum(len(item.get("paths") or []) for item in sftp_bookmarks if isinstance(item, dict)),
        "agentCapabilityCount": capability_counts["skill"] + capability_counts["mcp"] + capability_counts["cli"],
        "portForwardPresetCount": len(port_forwards) if isinstance(port_forwards, list) else 0,
        "commandSnippetCount": len(command_snippets) if isinstance(command_snippets, list) else 0,
        "modelProfileCount": len(model_profiles) if isinstance(model_profiles, list) else 0,
        "capabilityCounts": capability_counts,
        "encryptedCredentialCount": sum(1 for host in hosts if isinstance(host, dict) and (host.get("secret") or host.get("hasSecret"))),
        "skippedCredentialCount": sum(1 for host in hosts if isinstance(host, dict) and host.get("secretStatus") in {"unavailable", "missing"}),
        "sensitiveMcpHeaderCount": count_sensitive_mcp_headers(mcp),
        "includesSecrets": bool(include_secrets),
    }


def count_sensitive_mcp_headers(mcp_capabilities: list) -> int:
    total = 0
    for capability in mcp_capabilities if isinstance(mcp_capabilities, list) else []:
        headers = capability.get("headers") if isinstance(capability, dict) else []
        total += sum(1 for header in headers if isinstance(header, dict) and header.get("sensitive"))
    return total


def restore_backup_credentials(imported_hosts: list, master_password: str, credential_store) -> dict:
    validate_master_password(master_password)
    credentials = []
    skipped = 0

    for item in imported_hosts if isinstance(imported_hosts, list) else []:
        if not isinstance(item, dict):
            skipped += 1
            continue

        name = str(item.get("name") or "").strip()
        host = item.get("host") if isinstance(item.get("host"), dict) else {}
        secret_payload = host.get("secret")
        if not name or not secret_payload:
            skipped += 1
            continue

        secret = decrypt_secret(secret_payload, master_password)
        saved = credential_store.save_secret(
            name,
            secret,
            {
                "authType": str(host.get("authType") or "备份导入"),
                "user": str(host.get("user") or ""),
                "host": str(host.get("host") or host.get("ip") or ""),
                "source": "backup-import",
            },
        )
        credentials.append({"name": name, "credentialRef": saved.get("credentialRef", ""), "hasSecret": bool(saved.get("hasSecret"))})

    return {"ok": True, "credentials": credentials, "skipped": skipped}


def restore_backup_agent_capabilities(backup: dict, master_password: str) -> dict:
    validate_master_password(master_password)
    if not isinstance(backup, dict) or backup.get("schema") != BACKUP_SCHEMA:
        raise ValueError("Unsupported backup schema.")

    restored = dict(backup)
    restored_count = 0
    mcp_items = []
    for item in backup.get("mcp") if isinstance(backup.get("mcp"), list) else []:
        if not isinstance(item, dict):
            continue
        next_item = dict(item)
        next_headers = []
        for header in item.get("headers") if isinstance(item.get("headers"), list) else []:
            next_header, changed = restore_mcp_header_secret(header, master_password)
            next_headers.append(next_header)
            if changed:
                restored_count += 1
        next_item["headers"] = next_headers
        mcp_items.append(next_item)
    restored["mcp"] = mcp_items
    return {"ok": True, "backup": restored, "restoredHeaderCount": restored_count}


def restore_mcp_header_secret(header, master_password: str) -> tuple[dict, bool]:
    normalized = normalize_mcp_header(header)
    if not normalized:
        return {}, False

    secret_payload = normalized.get("secret")
    if not normalized.get("sensitive") or not isinstance(secret_payload, dict):
        return normalized, False

    restored = dict(normalized)
    restored["value"] = decrypt_secret(secret_payload, master_password)
    restored.pop("secret", None)
    restored.pop("redacted", None)
    restored["hasSecret"] = True
    return restored, True


def encryption_info(include_secrets: bool) -> dict:
    if include_secrets:
        return {
            "enabled": True,
            "method": "AES-256-GCM",
            "kdf": "PBKDF2-HMAC-SHA256",
            "note": "敏感字段已使用备份主密码加密；导入时需要输入同一个主密码。",
        }
    return {
        "enabled": False,
        "note": "未导出密码、私钥、口令短语等敏感字段。",
    }


def build_backup_hosts(servers: dict, include_secrets: bool, master_password: str, credential_store) -> list:
    hosts = []
    for name, item in servers.items():
        if not isinstance(item, dict):
            continue

        host = {
            "name": str(name),
            "host": str(item.get("ip") or item.get("host") or ""),
            "port": str(item.get("port") or "22"),
            "user": str(item.get("user") or "root"),
            "group": str(item.get("group") or ""),
            "authType": str(item.get("authType") or ("加密凭据" if include_secrets else "redacted")),
            "cwd": str(item.get("cwd") or ""),
            "policy": str(item.get("policy") or ""),
            "note": str(item.get("note") or ""),
            "timeoutSeconds": bounded_int(item.get("timeoutSeconds"), 10, 3, 60),
            "retryCount": bounded_int(item.get("retryCount"), 0, 0, 3),
            "keepaliveSeconds": bounded_int(item.get("keepaliveSeconds"), 30, 0, 300),
            "keepaliveCountMax": bounded_int(item.get("keepaliveCountMax"), 3, 0, 10),
            "tags": normalize_tags(item.get("tags")),
            "identityFile": str(item.get("identityFile") or "").strip(),
            "forwardAgent": bool(item.get("forwardAgent")),
            "proxyJump": str(item.get("proxyJump") or "").strip(),
        }
        host_key = normalize_host_key(item.get("hostKey"))
        trusted_host_key = normalize_host_key(item.get("trustedHostKey"), include_trusted_at=True)
        host_key_trust = normalize_host_key_trust(item.get("hostKeyTrust"))
        if host_key:
            host["hostKey"] = host_key
        if trusted_host_key:
            host["trustedHostKey"] = trusted_host_key
        if host_key_trust:
            host["hostKeyTrust"] = host_key_trust
        local_forwards = normalize_backup_local_forwards(item.get("localForwards"))
        remote_forwards = normalize_backup_remote_forwards(item.get("remoteForwards"))
        dynamic_forwards = normalize_backup_dynamic_forwards(item.get("dynamicForwards"))
        if local_forwards:
            host["localForwards"] = local_forwards
        if remote_forwards:
            host["remoteForwards"] = remote_forwards
        if dynamic_forwards:
            host["dynamicForwards"] = dynamic_forwards

        credential_ref = str(item.get("credentialRef") or "")
        if include_secrets and credential_ref:
            try:
                secret = credential_store.read_secret(credential_ref)
            except Exception:
                host["hasSecret"] = False
                host["secretStatus"] = "unavailable"
            else:
                host["secret"] = encrypt_secret(secret, master_password)
                host["hasSecret"] = True
                host["secretStatus"] = "encrypted"
        elif include_secrets:
            host["hasSecret"] = False
            host["secretStatus"] = "missing"
        else:
            host["authType"] = "redacted"

        hosts.append(host)
    return hosts


def bounded_int(value, fallback: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        parsed = fallback
    return min(max(parsed, minimum), maximum)


def normalize_tags(value) -> list[str]:
    source = value if isinstance(value, list) else str(value or "").replace("，", ",").split(",")
    tags = []
    seen = set()
    for item in source:
        tag = str(item or "").strip()
        key = tag.lower()
        if tag and key not in seen:
            tags.append(tag)
            seen.add(key)
    return tags


def normalize_host_key(value, include_trusted_at: bool = False) -> dict | None:
    if not isinstance(value, dict):
        return None
    sha256 = str(value.get("sha256") or "").strip()
    if not sha256:
        return None
    host_key = {
        "type": str(value.get("type") or "unknown").strip() or "unknown",
        "sha256": sha256,
    }
    trusted_at = str(value.get("trustedAt") or "").strip()
    if include_trusted_at and trusted_at:
        host_key["trustedAt"] = trusted_at
    return host_key


def normalize_host_key_trust(value) -> dict | None:
    if not isinstance(value, dict):
        return None
    status = str(value.get("status") or "").strip()
    label = str(value.get("label") or "").strip()
    if not status and not label:
        return None
    return {
        "status": status or "unknown",
        "label": label or status or "未知",
    }


def normalize_forward_items(value) -> list:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def normalize_backup_local_forwards(value) -> list:
    forwards = []
    for item in normalize_forward_items(value):
        forward = {
            "localHost": str(item.get("localHost") or "127.0.0.1").strip() or "127.0.0.1",
            "localPort": str(item.get("localPort") or "").strip(),
            "remoteHost": str(item.get("remoteHost") or "").strip(),
            "remotePort": str(item.get("remotePort") or "").strip(),
        }
        if forward["localPort"] and forward["remoteHost"] and forward["remotePort"]:
            forwards.append(forward)
    return forwards


def normalize_backup_remote_forwards(value) -> list:
    forwards = []
    for item in normalize_forward_items(value):
        forward = {
            "remoteHost": str(item.get("remoteHost") or "127.0.0.1").strip() or "127.0.0.1",
            "remotePort": str(item.get("remotePort") or "").strip(),
            "localHost": str(item.get("localHost") or "").strip(),
            "localPort": str(item.get("localPort") or "").strip(),
        }
        if forward["remotePort"] and forward["localHost"] and forward["localPort"]:
            forwards.append(forward)
    return forwards


def normalize_backup_dynamic_forwards(value) -> list:
    forwards = []
    for item in normalize_forward_items(value):
        forward = {
            "bindHost": str(item.get("bindHost") or "127.0.0.1").strip() or "127.0.0.1",
            "bindPort": str(item.get("bindPort") or "").strip(),
        }
        if forward["bindPort"]:
            forwards.append(forward)
    return forwards


def build_sftp_bookmarks(servers: dict) -> list:
    bookmarks = []
    for name, item in servers.items():
        files = item.get("files") if isinstance(item, dict) else []
        bookmarks.append(
            {
                "host": str(name),
                "paths": [str(file.get("name")) for file in files if isinstance(file, dict) and file.get("type") == "folder"],
            }
        )
    return bookmarks


def build_port_forward_presets(presets: list | None) -> list:
    backup_presets = []
    seen = set()
    for item in presets if isinstance(presets, list) else []:
        preset = normalize_port_forward_preset(item)
        if not preset:
            continue
        key = preset["id"]
        if key in seen:
            continue
        seen.add(key)
        backup_presets.append(preset)
    return backup_presets


def normalize_port_forward_preset(item) -> dict | None:
    if not isinstance(item, dict):
        return None
    server_name = str(item.get("serverName") or "").strip()
    if not server_name:
        return None
    local_host = str(item.get("localHost") or "127.0.0.1").strip() or "127.0.0.1"
    if local_host not in {"127.0.0.1", "localhost", "::1"}:
        return None
    local_port = bounded_int(item.get("localPort"), 0, 1, 65535)
    remote_port = bounded_int(item.get("remotePort"), 0, 1, 65535)
    remote_host = str(item.get("remoteHost") or "127.0.0.1").strip() or "127.0.0.1"
    preset_id = str(item.get("id") or f"pfpreset-{server_name}-{local_port}-{remote_host}-{remote_port}").strip()
    if not preset_id:
        return None
    name = str(item.get("name") or f"{local_port} -> {remote_host}:{remote_port}").strip()
    return {
        "id": preset_id,
        "serverName": server_name,
        "name": name,
        "localHost": local_host,
        "localPort": local_port,
        "remoteHost": remote_host,
        "remotePort": remote_port,
    }


def build_command_snippets(snippets: list | None) -> list:
    safe_snippets = []
    seen = set()
    for item in snippets if isinstance(snippets, list) else []:
        snippet = normalize_command_snippet(item)
        if not snippet or contains_sensitive_command_material(snippet):
            continue
        key = snippet["command"].lower()
        if key in seen:
            continue
        seen.add(key)
        safe_snippets.append(snippet)
    return safe_snippets


def normalize_command_snippet(item) -> dict | None:
    if not isinstance(item, dict):
        return None
    command = str(item.get("command") or "").strip()
    label = str(item.get("label") or command).strip()
    if not command or not label:
        return None
    return {"label": label, "command": command, "custom": True}


def contains_sensitive_command_material(snippet: dict) -> bool:
    text = f"{snippet.get('label') or ''}\n{snippet.get('command') or ''}"
    return bool(
        re.search(
            r"(^|\b|[-_])(authorization|bearer|api[-_ ]?key|access[-_ ]?key|secret|token|passwd|password|pwd)(\b|=|:|[-_]|$)|密码|密钥|令牌|口令|授权",
            text,
            re.IGNORECASE,
        )
    )


def build_model_config(config: dict | None) -> dict:
    source = config if isinstance(config, dict) else {}
    return {
        "provider": str(source.get("provider") or "").strip(),
        "baseUrl": normalize_model_base_url(source.get("baseUrl")),
        "model": str(source.get("model") or "").strip(),
        "apiKey": "",
        "apiKeyRef": "",
        "hasApiKey": False,
        "extraHeaders": normalize_model_headers(source.get("extraHeaders")),
        "modelOptions": normalize_model_options(source.get("modelOptions")),
    }


def build_model_profiles(profiles: list | None, active_config: dict | None = None) -> list:
    entries = []
    if has_model_config(active_config):
        entries.append(
            {
                "id": "active-model-config",
                "name": "当前模型 API",
                "config": build_model_config(active_config),
            }
        )

    for item in profiles if isinstance(profiles, list) else []:
        if not isinstance(item, dict):
            continue
        config = build_model_config(item.get("config") if isinstance(item.get("config"), dict) else item)
        if not has_model_config(config):
            continue
        name = str(item.get("name") or config.get("provider") or config.get("model") or config.get("baseUrl") or "模型 API 档案").strip()
        profile_id = str(item.get("id") or f"model-{name}-{config.get('model') or config.get('baseUrl') or 'api'}").strip()
        entries.append(
            {
                "id": profile_id,
                "name": name,
                "config": config,
                "lastTest": item.get("lastTest") if isinstance(item.get("lastTest"), dict) else None,
            }
        )

    safe_profiles = []
    seen = set()
    for item in entries:
        key = f"{str(item.get('id') or '').lower()}|{str(item.get('name') or '').lower()}"
        if key in seen:
            continue
        seen.add(key)
        safe_profiles.append(item)
    return safe_profiles


def has_model_config(config: dict | None) -> bool:
    if not isinstance(config, dict):
        return False
    safe = build_model_config(config)
    return bool(safe["provider"] or safe["baseUrl"] or safe["model"] or safe["extraHeaders"] or safe["modelOptions"])


def normalize_model_base_url(value) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.startswith("http://") or text.startswith("https://"):
        return text.rstrip("/")
    return ""


def normalize_model_headers(headers) -> list:
    safe_headers = []
    seen = set()
    for item in headers if isinstance(headers, list) else []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name or not re.match(r"^[A-Za-z0-9-]+$", name):
            continue
        if is_sensitive_model_header_name(name):
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        safe_headers.append(
            {
                "name": name,
                "value": str(item.get("value") or "")[:500],
                "enabled": item.get("enabled") is not False,
            }
        )
    return safe_headers


def normalize_model_options(options) -> list:
    safe_options = []
    seen = set()
    for item in options if isinstance(options, list) else []:
        value = str(item.get("value") if isinstance(item, dict) else item or "").strip()
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        safe_options.append(value[:180])
    return safe_options[:200]


def is_sensitive_model_header_name(name: str) -> bool:
    return bool(re.search(r"authorization|token|api[-_ ]?key|secret|cookie|set-cookie", name or "", re.IGNORECASE))


def build_capabilities_by_type(
    agent_capabilities: list | None,
    capability_type: str,
    include_secrets: bool = False,
    master_password: str = "",
) -> list:
    capabilities = []
    for item in agent_capabilities if isinstance(agent_capabilities, list) else []:
        if not isinstance(item, dict) or item.get("type") != capability_type:
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        capabilities.append(
            {
                "type": capability_type,
                "name": name,
                "description": str(item.get("description") or "").strip(),
                "entry": str(item.get("entry") or "").strip(),
                "endpoint": str(item.get("endpoint") or "").strip(),
                "headers": build_backup_mcp_headers(item.get("headers"), include_secrets, master_password) if capability_type == "MCP" else [],
                "permission": str(item.get("permission") or "").strip(),
                "status": str(item.get("status") or "").strip(),
                "builtin": bool(item.get("builtin")),
            }
        )
    return capabilities


def build_backup_mcp_headers(headers, include_secrets: bool, master_password: str) -> list:
    backup_headers = []
    for item in headers if isinstance(headers, list) else []:
        header = normalize_mcp_header(item)
        if not header:
            continue

        if header.get("sensitive"):
            value = str(header.get("value") or "")
            next_header = {
                "name": header["name"],
                "value": "",
                "enabled": bool(header.get("enabled", True)),
                "sensitive": True,
                "hasSecret": bool(value or header.get("secret") or header.get("hasSecret")),
            }
            if include_secrets and value:
                next_header["secret"] = encrypt_secret(value, master_password)
            else:
                next_header["redacted"] = True
            backup_headers.append(next_header)
            continue

        backup_headers.append(header)
    return backup_headers


def normalize_mcp_header(item) -> dict | None:
    if not isinstance(item, dict):
        return None
    name = str(item.get("name") or "").strip()
    if not name:
        return None
    header = {
        "name": name,
        "value": str(item.get("value") or ""),
        "enabled": item.get("enabled") is not False,
    }
    if item.get("sensitive") is True or is_sensitive_mcp_header_name(name):
        header["sensitive"] = True
    if item.get("redacted"):
        header["redacted"] = True
    if item.get("hasSecret"):
        header["hasSecret"] = True
    if isinstance(item.get("secret"), dict):
        header["secret"] = item["secret"]
    return header


def is_sensitive_mcp_header_name(name: str) -> bool:
    normalized = str(name or "").strip().lower().replace("_", "-")
    return (
        normalized == "authorization"
        or "api-key" in normalized
        or "token" in normalized
        or "secret" in normalized
        or "cookie" in normalized
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
