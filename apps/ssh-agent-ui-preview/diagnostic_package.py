from __future__ import annotations

import json
import platform
import posixpath
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from session_log import SCHEMA as SESSION_LOG_SCHEMA
from session_log import normalize_entry as normalize_session_entry
from session_log import redact_sensitive_text
from tool_log import SCHEMA as TOOL_LOG_SCHEMA
from tool_log import normalize_entry, sanitize_context


SCHEMA = "ssh-agent-tool.diagnostic-package.v1"


def write_diagnostic_package(target_path: str | Path, paths: dict, options: dict | None = None) -> dict:
    target = Path(target_path)
    if not str(target).strip():
        return {"ok": False, "message": "未选择诊断包保存位置。"}

    raw_options = options if isinstance(options, dict) else {}
    created_at = str(raw_options.get("createdAt") or utc_now())
    runtime_diagnostics = sanitize_runtime_diagnostics(raw_options.get("runtimeDiagnostics"))
    safe_paths = paths if isinstance(paths, dict) else {}
    target.parent.mkdir(parents=True, exist_ok=True)

    files: list[str] = []
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        runtime_summary = build_runtime_summary(safe_paths, created_at, runtime_diagnostics)
        config_summary = build_config_summary(Path(safe_paths.get("config", "")))
        add_json(archive, files, "manifest.json", build_manifest(safe_paths, created_at))
        add_json(archive, files, "runtime-summary.json", runtime_summary)
        if runtime_diagnostics:
            add_json(archive, files, "runtime-diagnostics.json", runtime_diagnostics)
        add_json(archive, files, "config-summary.json", config_summary)
        add_json(archive, files, "release-manifest.json", read_json_file(Path(safe_paths.get("releaseManifest", ""))))
        add_json(archive, files, "release-update-status.json", read_release_update_status_file(Path(safe_paths.get("releaseUpdateStatus", ""))))
        add_text(archive, files, "configuration-summary.md", build_configuration_summary_markdown(config_summary))
        add_text(archive, files, "ssh-failures-summary.md", build_ssh_failures_summary_markdown(runtime_summary.get("sshFailures")))
        add_text(archive, files, "ssh-connection-health-summary.md", build_ssh_connection_health_summary_markdown(runtime_summary.get("sshConnectionHealth")))
        add_text(archive, files, "model-api-failures-summary.md", build_model_api_failures_summary_markdown(runtime_summary.get("modelApiFailures")))
        add_text(archive, files, "sftp-failures-summary.md", build_sftp_failures_summary_markdown(runtime_summary.get("sftpFailures")))
        add_text(archive, files, "release-update-failures-summary.md", build_release_update_failures_summary_markdown(runtime_summary.get("releaseUpdateFailures")))
        add_text(archive, files, "server-management-summary.md", build_server_management_summary_markdown(runtime_summary.get("serverManagementEvents")))
        add_text(archive, files, "terminal-control-summary.md", build_terminal_control_summary_markdown(runtime_summary.get("terminalControlEvents")))
        add_text(archive, files, "session-events-summary.md", build_session_events_summary_markdown(runtime_summary.get("sessionEvents")))
        add_text(archive, files, "frontend-incidents-summary.md", build_frontend_incidents_summary_markdown(runtime_summary.get("frontendIncidents")))
        add_text(archive, files, "runtime-environment-summary.md", build_runtime_environment_summary_markdown(runtime_summary))
        add_text(archive, files, "支持排查说明.md", build_support_readme_markdown(runtime_summary, config_summary, created_at))
        add_text(archive, files, "问题反馈模板.txt", build_problem_feedback_template(runtime_summary, created_at))
        add_text(archive, files, "README.txt", build_readme(created_at))
        add_startup_failure_log(archive, files, Path(safe_paths.get("startupFailureLog", "")), runtime_diagnostics)
        add_release_update_log(archive, files, Path(safe_paths.get("releaseUpdateLog", "")))
        add_log_tree(archive, files, "tool-logs", Path(safe_paths.get("toolLogs", "")))
        add_log_tree(archive, files, "session-logs", Path(safe_paths.get("sessionLogs", "")))

    return {
        "ok": True,
        "path": str(target),
        "files": files,
        "createdAt": created_at,
        "sizeBytes": target.stat().st_size if target.exists() else 0,
    }


def build_manifest(paths: dict, created_at: str) -> dict:
    release = read_json_file(Path(paths.get("releaseManifest", "")))
    return {
        "schema": SCHEMA,
        "createdAt": created_at,
        "appName": "SSH Agent 工具",
        "release": release,
        "releaseSummary": build_release_summary(release),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "frozen": bool(getattr(sys, "frozen", False)),
        "paths": {
            "config": str(paths.get("config") or ""),
            "toolLogs": str(paths.get("toolLogs") or ""),
            "sessionLogs": str(paths.get("sessionLogs") or ""),
            "releaseUpdateStatus": str(paths.get("releaseUpdateStatus") or ""),
            "releaseUpdateLog": str(paths.get("releaseUpdateLog") or ""),
            "startupFailureLog": str(paths.get("startupFailureLog") or ""),
        },
        "privacy": "诊断包会对日志内容再次脱敏；日志和配置摘要已脱敏，不包含明文密码、API Key、Token 或私钥。",
    }


def build_config_summary(config_path: Path) -> dict:
    summary = {
        "exists": config_path.exists(),
        "path": str(config_path),
        "sizeBytes": config_path.stat().st_size if config_path.exists() else 0,
        "topLevelKeys": [],
        "customServerNames": [],
        "modelProfileCount": 0,
        "modelProfileNames": [],
        "agentCapabilityCount": 0,
        "agentCapabilityNames": [],
    }
    if not config_path.exists():
        return summary
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        summary["readable"] = False
        return summary

    if isinstance(data, dict):
        summary["readable"] = True
        summary["topLevelKeys"] = sorted(str(key) for key in data.keys())
        servers = data.get("customServers") if isinstance(data.get("customServers"), dict) else {}
        summary["customServerNames"] = sorted(str(name) for name in servers.keys())
        profiles = data.get("modelProfiles") if isinstance(data.get("modelProfiles"), list) else []
        summary["modelProfileCount"] = len(profiles)
        summary["modelProfileNames"] = [
            str(item.get("name") or item.get("config", {}).get("provider") or "").strip()
            for item in profiles
            if isinstance(item, dict)
        ][:50]
        capabilities = data.get("customAgentCapabilities") if isinstance(data.get("customAgentCapabilities"), list) else []
        summary["agentCapabilityCount"] = len(capabilities)
        summary["agentCapabilityNames"] = [
            str(item.get("name") or "").strip()
            for item in capabilities
            if isinstance(item, dict)
        ][:50]
        summary["safeConfigPreview"] = sanitize_context(data)
    return summary


def build_runtime_summary(paths: dict, created_at: str, runtime_diagnostics: dict | None = None) -> dict:
    safe_paths = paths if isinstance(paths, dict) else {}
    release = read_json_file(Path(safe_paths.get("releaseManifest", "")))
    return {
        "schema": "ssh-agent-tool.runtime-summary.v1",
        "createdAt": created_at,
        "runtime": {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "frozen": bool(getattr(sys, "frozen", False)),
            "executable": sys.executable,
            "executableDirectory": str(Path(sys.executable).expanduser().resolve().parent),
        },
        "inputs": {
            "config": summarize_input_file(Path(safe_paths.get("config", ""))),
            "releaseManifest": summarize_input_file(Path(safe_paths.get("releaseManifest", ""))),
            "releaseUpdateStatus": summarize_input_file(Path(safe_paths.get("releaseUpdateStatus", ""))),
            "releaseUpdateLog": summarize_input_file(Path(safe_paths.get("releaseUpdateLog", ""))),
            "startupFailureLog": summarize_input_file(Path(safe_paths.get("startupFailureLog", ""))),
        },
        "release": build_release_summary(release),
        "logs": {
            "toolLogs": summarize_log_tree(Path(safe_paths.get("toolLogs", ""))),
            "sessionLogs": summarize_log_tree(Path(safe_paths.get("sessionLogs", ""))),
        },
        "recentToolEvents": summarize_recent_tool_events(Path(safe_paths.get("toolLogs", ""))),
        "webView2Runtime": summarize_webview2_runtime(Path(safe_paths.get("toolLogs", ""))),
        "frontendIncidents": summarize_frontend_incidents(Path(safe_paths.get("toolLogs", ""))),
        "modelApiFailures": summarize_model_api_failures(Path(safe_paths.get("toolLogs", ""))),
        "sshFailures": summarize_ssh_failures(Path(safe_paths.get("toolLogs", ""))),
        "sshConnectionHealth": summarize_ssh_connection_health(Path(safe_paths.get("toolLogs", "")), Path(safe_paths.get("sessionLogs", ""))),
        "sftpFailures": summarize_sftp_failures(Path(safe_paths.get("toolLogs", ""))),
        "releaseUpdateFailures": summarize_release_update_failures(Path(safe_paths.get("toolLogs", ""))),
        "serverManagementEvents": summarize_server_management_events(Path(safe_paths.get("toolLogs", ""))),
        "terminalControlEvents": summarize_terminal_control_events(Path(safe_paths.get("toolLogs", "")), Path(safe_paths.get("sessionLogs", ""))),
        "sessionEvents": summarize_session_events(Path(safe_paths.get("sessionLogs", ""))),
        "runtimeDiagnostics": sanitize_runtime_diagnostics(runtime_diagnostics),
        "runtimeReadiness": build_runtime_readiness(runtime_diagnostics),
    }


def sanitize_runtime_diagnostics(runtime_diagnostics) -> dict:
    if not isinstance(runtime_diagnostics, dict):
        return {}
    return sanitize_context(runtime_diagnostics)


def build_runtime_readiness(runtime_diagnostics) -> dict:
    safe = sanitize_runtime_diagnostics(runtime_diagnostics)
    if not safe:
        return {
            "ok": None,
            "state": "not-recorded",
            "summary": "当前诊断包没有运行时自检快照。",
            "failedChecks": [],
            "checks": [],
        }

    checks = [
        build_client_entry_readiness_check(safe),
        build_frontend_assets_readiness_check(safe),
        build_webview2_readiness_check(safe),
        build_startup_identity_readiness_check(safe),
        build_command_line_launchers_readiness_check(safe),
    ]
    failed = [item for item in checks if item.get("ok") is False]
    unknown = [item for item in checks if item.get("ok") is None]
    if failed:
        state = "failed"
        ok = False
        summary = "；".join(item.get("message", "") for item in failed if item.get("message")) or "运行时自检存在失败项。"
    elif unknown:
        state = "unknown"
        ok = None
        summary = "部分运行时自检结果缺失，请结合 runtime-diagnostics.json 查看。"
    else:
        state = "passed"
        ok = True
        summary = "运行时自检关键项通过。"

    return {
        "ok": ok,
        "state": state,
        "summary": summary,
        "failedChecks": [item["id"] for item in failed],
        "checks": checks,
    }


def build_client_entry_readiness_check(runtime_diagnostics: dict) -> dict:
    client_entry = runtime_diagnostics.get("clientEntry") if isinstance(runtime_diagnostics.get("clientEntry"), dict) else {}
    if client_entry:
        return {
            "id": "client-entry",
            "label": "客户端入口",
            "ok": bool(client_entry.get("ok")) if "ok" in client_entry else None,
            "message": str(client_entry.get("message") or "").strip() or "已记录客户端入口检查。",
        }
    if "uiIndexExists" in runtime_diagnostics:
        exists = bool(runtime_diagnostics.get("uiIndexExists"))
        return {
            "id": "client-entry",
            "label": "客户端入口",
            "ok": exists,
            "message": "前端入口文件存在。" if exists else "前端入口文件不存在。",
        }
    return {"id": "client-entry", "label": "客户端入口", "ok": None, "message": "未记录客户端入口检查。"}


def build_frontend_assets_readiness_check(runtime_diagnostics: dict) -> dict:
    assets = runtime_diagnostics.get("frontendAssets") if isinstance(runtime_diagnostics.get("frontendAssets"), dict) else {}
    if not assets:
        return {"id": "frontend-assets", "label": "前端资源", "ok": None, "message": "未记录前端资源检查。"}
    if "ok" in assets:
        ok = bool(assets.get("ok"))
    else:
        ok = bool(str(assets.get("script") or "").strip())
    script = str(assets.get("script") or "").strip()
    message = str(assets.get("message") or "").strip()
    if not message:
        message = f"前端脚本：{script}" if script else "未记录前端脚本。"
    return {"id": "frontend-assets", "label": "前端资源", "ok": ok, "message": message}


def build_webview2_readiness_check(runtime_diagnostics: dict) -> dict:
    runtime = runtime_diagnostics.get("webView2Runtime") if isinstance(runtime_diagnostics.get("webView2Runtime"), dict) else {}
    if not runtime:
        return {"id": "webview2-runtime", "label": "WebView2 Runtime", "ok": None, "message": "未记录 WebView2 Runtime 检查。"}
    available = runtime.get("available")
    ok = bool(available) if isinstance(available, bool) else None
    message = str(runtime.get("message") or runtime.get("version") or runtime.get("source") or "").strip()
    if not message:
        message = "WebView2 Runtime 可用。" if ok is True else "WebView2 Runtime 状态未知。"
    return {"id": "webview2-runtime", "label": "WebView2 Runtime", "ok": ok, "message": message}


def build_startup_identity_readiness_check(runtime_diagnostics: dict) -> dict:
    identity = runtime_diagnostics.get("startupIdentity") if isinstance(runtime_diagnostics.get("startupIdentity"), dict) else {}
    if not identity:
        return {"id": "startup-identity", "label": "启动身份", "ok": None, "message": "未记录启动身份检查。"}
    ok = bool(identity.get("ok")) if "ok" in identity else None
    message = str(identity.get("message") or identity.get("version") or "").strip() or "已记录启动身份检查。"
    return {"id": "startup-identity", "label": "启动身份", "ok": ok, "message": message}


def build_command_line_launchers_readiness_check(runtime_diagnostics: dict) -> dict:
    launchers = runtime_diagnostics.get("commandLineLaunchers") if isinstance(runtime_diagnostics.get("commandLineLaunchers"), dict) else {}
    if not launchers:
        return {"id": "command-line-launchers", "label": "命令行启动器残留", "ok": None, "message": "未记录命令行启动器检查。"}
    if "ok" in launchers:
        ok = bool(launchers.get("ok"))
    else:
        ok = int(launchers.get("count") or 0) == 0
    message = str(launchers.get("message") or "").strip()
    if not message:
        count = int(launchers.get("count") or 0)
        message = "未发现命令行启动器残留。" if count == 0 else f"发现 {count} 个命令行启动器残留。"
    return {"id": "command-line-launchers", "label": "命令行启动器残留", "ok": ok, "message": message}


def build_release_summary(release: dict) -> dict:
    safe = release if isinstance(release, dict) else {}
    frontend_assets = safe.get("frontendAssets") if isinstance(safe.get("frontendAssets"), dict) else {}
    verification_items = safe.get("verification") if isinstance(safe.get("verification"), list) else []
    counts = {"total": 0, "passed": 0, "failed": 0, "skipped": 0, "unknown": 0}
    for item in verification_items:
        if not isinstance(item, dict):
            continue
        counts["total"] += 1
        status = str(item.get("status") or "").strip().lower()
        if status in counts and status != "total":
            counts[status] += 1
        else:
            counts["unknown"] += 1

    return {
        "ok": bool(safe.get("ok", True)) if "ok" in safe else not bool(safe.get("message") and not safe.get("version")),
        "version": str(safe.get("version") or "dev").strip() or "dev",
        "generatedAt": str(safe.get("generatedAt") or "").strip(),
        "updateChannel": str(safe.get("updateChannel") or "").strip(),
        "packageFile": str(safe.get("packageFile") or "").strip(),
        "packageSha256": str(safe.get("packageSha256") or "").strip(),
        "executable": str(safe.get("executable") or "").strip(),
        "sha256": str(safe.get("sha256") or "").strip(),
        "standaloneExeSha256": str(safe.get("standaloneExeSha256") or safe.get("sha256") or "").strip(),
        "sizeBytes": safe.get("sizeBytes") if isinstance(safe.get("sizeBytes"), int) else 0,
        "frontendAssets": {
            "script": str(frontend_assets.get("script") or "").strip(),
            "scriptSha256": str(frontend_assets.get("scriptSha256") or "").strip(),
            "stylesheet": str(frontend_assets.get("stylesheet") or "").strip(),
            "stylesheetSha256": str(frontend_assets.get("stylesheetSha256") or "").strip(),
        },
        "verification": counts,
        "verificationItems": [
            {"name": str(item.get("name") or "").strip(), "status": str(item.get("status") or "").strip()}
            for item in verification_items
            if isinstance(item, dict)
        ][:50],
    }


def summarize_input_file(path: Path) -> dict:
    exists = path.exists()
    return {
        "path": str(path),
        "exists": exists,
        "sizeBytes": path.stat().st_size if exists and path.is_file() else 0,
    }


def summarize_log_tree(root: Path) -> dict:
    files = []
    if root.exists():
        for path in sorted(root.rglob("*.jsonl")):
            if not path.is_file():
                continue
            try:
                name = path.relative_to(root).as_posix()
            except ValueError:
                name = path.name
            stat = path.stat()
            files.append(
                {
                    "name": name,
                    "sizeBytes": stat.st_size,
                    "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                }
            )
    return {"path": str(root), "exists": root.exists(), "count": len(files), "files": files}


def summarize_recent_tool_events(root: Path, limit: int = 20) -> dict:
    counts = {"debug": 0, "info": 0, "warn": 0, "error": 0}
    events = []
    total = 0
    if root.exists():
        for path in sorted(root.glob("*.jsonl")):
            if not path.is_file():
                continue
            try:
                lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                continue
            for line in lines:
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(payload, dict) or payload.get("schema") != TOOL_LOG_SCHEMA:
                    continue
                entry = normalize_entry(payload, path)
                level = entry.get("level", "info")
                counts[level] = counts.get(level, 0) + 1
                total += 1
                if level in {"warn", "error"}:
                    events.append(
                        {
                            "createdAt": entry.get("createdAt", ""),
                            "level": level,
                            "component": entry.get("component", ""),
                            "action": entry.get("action", ""),
                            "message": entry.get("message", ""),
                            "error": entry.get("error", ""),
                        }
                    )
    events.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"total": total, "counts": counts, "events": events[:limit]}


def summarize_webview2_runtime(root: Path) -> dict:
    startup_events = []
    for entry in iter_tool_log_entries(root):
        if entry.get("component") != "app" or entry.get("action") != "app_start":
            continue
        context = entry.get("context") if isinstance(entry.get("context"), dict) else {}
        runtime = context.get("webView2Runtime") if isinstance(context.get("webView2Runtime"), dict) else {}
        if not runtime:
            continue
        startup_events.append(
            {
                "createdAt": entry.get("createdAt", ""),
                **sanitize_context(runtime),
            }
        )
    startup_events.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    if startup_events:
        return startup_events[0]
    return {"available": None, "source": "not-recorded", "message": "启动日志中没有 WebView2 Runtime 检测结果。"}


def summarize_frontend_incidents(root: Path, limit: int = 20) -> dict:
    counts: dict[str, int] = {}
    recent = []
    total = 0
    for entry in iter_tool_log_entries(root):
        if entry.get("component") != "frontend" or entry.get("level") not in {"warn", "error"}:
            continue
        action = str(entry.get("action") or "unknown").strip() or "unknown"
        counts[action] = counts.get(action, 0) + 1
        total += 1
        recent.append(
            {
                "createdAt": entry.get("createdAt", ""),
                "level": entry.get("level", ""),
                "action": action,
                "message": entry.get("message", ""),
                "error": entry.get("error", ""),
            }
        )
    recent.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"total": total, "counts": counts, "recent": recent[:limit]}


def summarize_model_api_failures(root: Path, limit: int = 20) -> dict:
    counts: dict[str, int] = {}
    recent = []
    total = 0
    for entry in iter_tool_log_entries(root):
        if entry.get("component") != "model-api" or entry.get("level") not in {"warn", "error"}:
            continue
        context = entry.get("context") if isinstance(entry.get("context"), dict) else {}
        model = context.get("model") if isinstance(context.get("model"), dict) else {}
        action = str(entry.get("action") or "unknown").strip() or "unknown"
        counts[action] = counts.get(action, 0) + 1
        total += 1
        recent.append(
            {
                "createdAt": entry.get("createdAt", ""),
                "level": entry.get("level", ""),
                "action": action,
                "provider": str(model.get("provider") or "").strip(),
                "baseUrl": str(model.get("baseUrl") or "").strip(),
                "model": str(model.get("model") or "").strip(),
                "message": entry.get("message", ""),
            }
        )
    recent.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"total": total, "counts": counts, "recent": recent[:limit]}


def summarize_ssh_failures(root: Path, limit: int = 20) -> dict:
    known_kinds = [
        "auth",
        "timeout",
        "dns",
        "refused",
        "handshake",
        "algorithm",
        "host-key",
        "key-file",
        "agent-auth",
        "transport",
        "config",
        "environment",
        "input",
        "network",
        "unknown",
    ]
    counts = {kind: 0 for kind in known_kinds}
    recent = []
    total = 0
    for entry in iter_tool_log_entries(root):
        if entry.get("component") != "ssh" or entry.get("level") not in {"warn", "error"}:
            continue
        context = entry.get("context") if isinstance(entry.get("context"), dict) else {}
        failure_kind = str(context.get("failureKind") or "").strip() or "unknown"
        if failure_kind not in counts:
            failure_kind = "unknown"
        counts[failure_kind] += 1
        total += 1
        recent.append(
            {
                "createdAt": entry.get("createdAt", ""),
                "action": entry.get("action", ""),
                "serverName": str(context.get("serverName") or "").strip(),
                "host": str(context.get("host") or "").strip(),
                "port": context.get("port") if isinstance(context.get("port"), int) else 0,
                "user": str(context.get("user") or "").strip(),
                "failureKind": failure_kind,
            }
        )
    recent.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"total": total, "counts": counts, "recent": recent[:limit]}


def summarize_ssh_connection_health(tool_root: Path, session_root: Path, limit: int = 30) -> dict:
    counts_by_action: dict[str, int] = {}
    counts_by_status: dict[str, int] = {}
    recent = []
    total = 0
    tool_actions = {
        "open_session",
        "open_session_failed",
        "open_session_error",
        "test_login",
        "auto_test_saved_connection",
        "check_session_health",
        "read_output",
    }
    session_types = {
        "ssh_connect_failed",
        "ssh_connect_success",
        "ssh_connect_ok",
        "session_health_failed",
    }

    for entry in iter_tool_log_entries(tool_root):
        if entry.get("component") != "ssh" or entry.get("action") not in tool_actions:
            continue
        context = entry.get("context") if isinstance(entry.get("context"), dict) else {}
        action = str(entry.get("action") or "unknown").strip() or "unknown"
        status = tool_level_to_health_status(entry.get("level"))
        counts_by_action[action] = counts_by_action.get(action, 0) + 1
        counts_by_status[status] = counts_by_status.get(status, 0) + 1
        total += 1
        recent.append(
            {
                "createdAt": entry.get("createdAt", ""),
                "source": "tool",
                "action": action,
                "status": status,
                "serverName": str(context.get("serverName") or "").strip(),
                "host": str(context.get("host") or "").strip(),
                "port": context.get("port") if isinstance(context.get("port"), int) else str(context.get("port") or "").strip(),
                "user": str(context.get("user") or "").strip(),
                "sessionId": str(context.get("sessionId") or "").strip(),
                "failureKind": str(context.get("failureKind") or "").strip(),
                "message": entry.get("message", ""),
            }
        )

    for entry in iter_session_log_entries(session_root):
        event_type = str(entry.get("type") or "").strip()
        if event_type not in session_types:
            continue
        context = entry.get("context") if isinstance(entry.get("context"), dict) else {}
        status = session_status_to_health_status(entry.get("status"))
        counts_by_action[event_type] = counts_by_action.get(event_type, 0) + 1
        counts_by_status[status] = counts_by_status.get(status, 0) + 1
        total += 1
        recent.append(
            {
                "createdAt": entry.get("createdAt", ""),
                "source": "session",
                "action": event_type,
                "status": status,
                "serverName": str(entry.get("server") or context.get("serverName") or "").strip(),
                "host": str(context.get("host") or "").strip(),
                "port": context.get("port") if isinstance(context.get("port"), int) else str(context.get("port") or "").strip(),
                "user": str(context.get("user") or "").strip(),
                "sessionId": str(entry.get("sessionId") or "").strip(),
                "failureKind": str(entry.get("failureKind") or context.get("failureKind") or "").strip(),
                "message": entry.get("message", ""),
            }
        )

    recent.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"total": total, "countsByAction": counts_by_action, "countsByStatus": counts_by_status, "recent": recent[:limit]}


def tool_level_to_health_status(level) -> str:
    return "failed" if str(level or "").strip().lower() in {"warn", "error"} else "ok"


def session_status_to_health_status(status) -> str:
    text = str(status or "").strip().lower()
    return "ok" if text in {"ok", "success", "passed"} else "failed"


def build_ssh_failures_summary_markdown(ssh_failures) -> str:
    safe = ssh_failures if isinstance(ssh_failures, dict) else {}
    counts = safe.get("counts") if isinstance(safe.get("counts"), dict) else {}
    recent = safe.get("recent") if isinstance(safe.get("recent"), list) else []
    lines = [
        "# SSH 连接失败摘要",
        "",
        f"总数：{int(safe.get('total') or 0)}",
        "",
        "## 类型统计",
        "",
        "| 类型 | 次数 |",
        "| --- | ---: |",
    ]
    for kind, count in counts.items():
        if int(count or 0) <= 0:
            continue
        lines.append(f"| {kind} | {int(count or 0)} |")
    if len(lines) == 8:
        lines.append("| 无 | 0 |")

    lines.extend(
        [
            "",
            "## 最近失败",
            "",
            "| 时间 | 服务器 | 主机 | 端口 | 用户 | 类型 | 动作 |",
            "| --- | --- | --- | ---: | --- | --- | --- |",
        ]
    )
    if not recent:
        lines.append("| - | 暂无 | - | 0 | - | - | - |")
    for item in recent:
        if not isinstance(item, dict):
            continue
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(item.get("createdAt")),
                    markdown_cell(item.get("serverName")),
                    markdown_cell(item.get("host")),
                    markdown_cell(item.get("port") or 0),
                    markdown_cell(item.get("user")),
                    markdown_cell(item.get("failureKind")),
                    markdown_cell(item.get("action")),
                ]
            )
            + " |"
        )
    return "\n".join(lines) + "\n"


def build_ssh_connection_health_summary_markdown(ssh_connection_health) -> str:
    safe = ssh_connection_health if isinstance(ssh_connection_health, dict) else {}
    counts_by_action = safe.get("countsByAction") if isinstance(safe.get("countsByAction"), dict) else {}
    counts_by_status = safe.get("countsByStatus") if isinstance(safe.get("countsByStatus"), dict) else {}
    recent = safe.get("recent") if isinstance(safe.get("recent"), list) else []
    lines = [
        "# SSH 连接健康摘要",
        "",
        f"总数：{int(safe.get('total') or 0)}",
        "",
        "## 动作统计",
        "",
        "| 动作 | 次数 |",
        "| --- | ---: |",
    ]
    for action, count in counts_by_action.items():
        if int(count or 0) <= 0:
            continue
        lines.append(f"| {markdown_cell(action)} | {int(count or 0)} |")
    if len(lines) == 8:
        lines.append("| 无 | 0 |")

    lines.extend(["", "## 状态统计", "", "| 状态 | 次数 |", "| --- | ---: |"])
    status_header_len = len(lines)
    for status, count in counts_by_status.items():
        if int(count or 0) <= 0:
            continue
        lines.append(f"| {markdown_cell(status)} | {int(count or 0)} |")
    if len(lines) == status_header_len:
        lines.append("| 无 | 0 |")

    lines.extend(
        [
            "",
            "## 最近连接/健康事件",
            "",
            "| 时间 | 来源 | 动作 | 状态 | 服务器 | 主机 | 端口 | 用户 | 会话 | 类型 | 说明 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    if not recent:
        lines.append("| - | - | 暂无 | - | - | - | - | - | - | - | - |")
    for item in recent:
        if not isinstance(item, dict):
            continue
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(item.get("createdAt")),
                    markdown_cell(item.get("source")),
                    markdown_cell(item.get("action")),
                    markdown_cell(item.get("status")),
                    markdown_cell(item.get("serverName")),
                    markdown_cell(item.get("host")),
                    markdown_cell(item.get("port")),
                    markdown_cell(item.get("user")),
                    markdown_cell(item.get("sessionId")),
                    markdown_cell(item.get("failureKind")),
                    markdown_cell(item.get("message")),
                ]
            )
            + " |"
        )
    return "\n".join(lines) + "\n"


def build_model_api_failures_summary_markdown(model_api_failures) -> str:
    safe = model_api_failures if isinstance(model_api_failures, dict) else {}
    counts = safe.get("counts") if isinstance(safe.get("counts"), dict) else {}
    recent = safe.get("recent") if isinstance(safe.get("recent"), list) else []
    lines = [
        "# 模型 API 失败摘要",
        "",
        f"总数：{int(safe.get('total') or 0)}",
        "",
        "## 动作统计",
        "",
        "| 动作 | 次数 |",
        "| --- | ---: |",
    ]
    for action, count in counts.items():
        if int(count or 0) <= 0:
            continue
        lines.append(f"| {markdown_cell(action)} | {int(count or 0)} |")
    if len(lines) == 8:
        lines.append("| 无 | 0 |")

    lines.extend(
        [
            "",
            "## 最近失败",
            "",
            "| 时间 | 级别 | 动作 | 供应商 | Base URL | 模型 | 说明 |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    if not recent:
        lines.append("| - | - | 暂无 | - | - | - | - |")
    for item in recent:
        if not isinstance(item, dict):
            continue
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(item.get("createdAt")),
                    markdown_cell(item.get("level")),
                    markdown_cell(item.get("action")),
                    markdown_cell(item.get("provider")),
                    markdown_cell(item.get("baseUrl")),
                    markdown_cell(item.get("model")),
                    markdown_cell(item.get("message")),
                ]
            )
            + " |"
        )
    return "\n".join(lines) + "\n"


def build_sftp_failures_summary_markdown(sftp_failures) -> str:
    safe = sftp_failures if isinstance(sftp_failures, dict) else {}
    counts = safe.get("counts") if isinstance(safe.get("counts"), dict) else {}
    recent = safe.get("recent") if isinstance(safe.get("recent"), list) else []
    lines = [
        "# SFTP 文件失败摘要",
        "",
        f"总数：{int(safe.get('total') or 0)}",
        "",
        "## 动作统计",
        "",
        "| 动作 | 次数 |",
        "| --- | ---: |",
    ]
    for action, count in counts.items():
        if int(count or 0) <= 0:
            continue
        lines.append(f"| {markdown_cell(action)} | {int(count or 0)} |")
    if len(lines) == 8:
        lines.append("| 无 | 0 |")

    lines.extend(
        [
            "",
            "## 最近失败",
            "",
            "| 时间 | 级别 | 动作 | 服务器 | 主机 | 用户 | 远端路径 | 本地文件 | 说明 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    if not recent:
        lines.append("| - | - | 暂无 | - | - | - | - | - | - |")
    for item in recent:
        if not isinstance(item, dict):
            continue
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(item.get("createdAt")),
                    markdown_cell(item.get("level")),
                    markdown_cell(item.get("action")),
                    markdown_cell(item.get("serverName")),
                    markdown_cell(item.get("host")),
                    markdown_cell(item.get("user")),
                    markdown_cell(item.get("remotePath")),
                    markdown_cell(item.get("localName")),
                    markdown_cell(item.get("message")),
                ]
            )
            + " |"
        )
    return "\n".join(lines) + "\n"


def build_release_update_failures_summary_markdown(release_update_failures) -> str:
    safe = release_update_failures if isinstance(release_update_failures, dict) else {}
    counts = safe.get("counts") if isinstance(safe.get("counts"), dict) else {}
    recent = safe.get("recent") if isinstance(safe.get("recent"), list) else []
    lines = [
        "# 在线更新失败摘要",
        "",
        f"总数：{int(safe.get('total') or 0)}",
        "",
        "## 动作统计",
        "",
        "| 动作 | 次数 |",
        "| --- | ---: |",
    ]
    for action, count in counts.items():
        if int(count or 0) <= 0:
            continue
        lines.append(f"| {markdown_cell(action)} | {int(count or 0)} |")
    if len(lines) == 8:
        lines.append("| 无 | 0 |")

    lines.extend(
        [
            "",
            "## 最近失败",
            "",
            "| 时间 | 级别 | 动作 | 更新源 | 当前版本 | 最新版本 | 更新包 | 说明 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    if not recent:
        lines.append("| - | - | 暂无 | - | - | - | - | - |")
    for item in recent:
        if not isinstance(item, dict):
            continue
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(item.get("createdAt")),
                    markdown_cell(item.get("level")),
                    markdown_cell(item.get("action")),
                    markdown_cell(item.get("updateCheckUrl") or item.get("updateSource")),
                    markdown_cell(item.get("version")),
                    markdown_cell(item.get("latestVersion")),
                    markdown_cell(item.get("packageName") or item.get("packageUrl")),
                    markdown_cell(item.get("message")),
                ]
            )
            + " |"
        )
    return "\n".join(lines) + "\n"


def build_server_management_summary_markdown(server_management_events) -> str:
    safe = server_management_events if isinstance(server_management_events, dict) else {}
    counts = safe.get("counts") if isinstance(safe.get("counts"), dict) else {}
    recent = safe.get("recent") if isinstance(safe.get("recent"), list) else []
    lines = [
        "# 服务器管理事件摘要",
        "",
        f"总数：{int(safe.get('total') or 0)}",
        "",
        "## 动作统计",
        "",
        "| 动作 | 次数 |",
        "| --- | ---: |",
    ]
    for action, count in counts.items():
        if int(count or 0) <= 0:
            continue
        lines.append(f"| {markdown_cell(action)} | {int(count or 0)} |")
    if len(lines) == 8:
        lines.append("| 无 | 0 |")

    lines.extend(
        [
            "",
            "## 最近事件",
            "",
            "| 时间 | 动作 | 服务器 | 主机 | 端口 | 用户 | 认证 | 分组 | 原名称 | 重命名 | 重置会话 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    if not recent:
        lines.append("| - | 暂无 | - | - | - | - | - | - | - | - | - |")
    for item in recent:
        if not isinstance(item, dict):
            continue
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(item.get("createdAt")),
                    markdown_cell(item.get("action")),
                    markdown_cell(item.get("serverName")),
                    markdown_cell(item.get("host")),
                    markdown_cell(item.get("port")),
                    markdown_cell(item.get("user")),
                    markdown_cell(item.get("authType")),
                    markdown_cell(item.get("group")),
                    markdown_cell(item.get("oldName")),
                    markdown_cell(item.get("renamed")),
                    markdown_cell(item.get("resetSession")),
                ]
            )
            + " |"
        )
    return "\n".join(lines) + "\n"


def build_terminal_control_summary_markdown(terminal_control_events) -> str:
    safe = terminal_control_events if isinstance(terminal_control_events, dict) else {}
    counts = safe.get("counts") if isinstance(safe.get("counts"), dict) else {}
    recent = safe.get("recent") if isinstance(safe.get("recent"), list) else []
    lines = [
        "# 终端控制事件摘要",
        "",
        f"总数：{int(safe.get('total') or 0)}",
        "",
        "## 动作统计",
        "",
        "| 动作 | 次数 |",
        "| --- | ---: |",
    ]
    for action, count in counts.items():
        if int(count or 0) <= 0:
            continue
        lines.append(f"| {markdown_cell(action)} | {int(count or 0)} |")
    if len(lines) == 8:
        lines.append("| 无 | 0 |")

    lines.extend(
        [
            "",
            "## 最近事件",
            "",
            "| 时间 | 来源 | 动作 | 服务器 | 会话 | 控制 | 状态 | 说明 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    if not recent:
        lines.append("| - | - | 暂无 | - | - | - | - | - |")
    for item in recent:
        if not isinstance(item, dict):
            continue
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(item.get("createdAt")),
                    markdown_cell(item.get("type")),
                    markdown_cell(item.get("action")),
                    markdown_cell(item.get("serverName")),
                    markdown_cell(item.get("sessionId")),
                    markdown_cell(item.get("control")),
                    markdown_cell(item.get("status")),
                    markdown_cell(item.get("message")),
                ]
            )
            + " |"
        )
    return "\n".join(lines) + "\n"


def build_session_events_summary_markdown(session_events) -> str:
    safe = session_events if isinstance(session_events, dict) else {}
    counts_by_type = safe.get("countsByType") if isinstance(safe.get("countsByType"), dict) else {}
    counts_by_status = safe.get("countsByStatus") if isinstance(safe.get("countsByStatus"), dict) else {}
    recent = safe.get("recent") if isinstance(safe.get("recent"), list) else []
    lines = [
        "# 会话事件摘要",
        "",
        f"总数：{int(safe.get('total') or 0)}",
        "",
        "## 类型统计",
        "",
        "| 类型 | 次数 |",
        "| --- | ---: |",
    ]
    for event_type, count in counts_by_type.items():
        if int(count or 0) <= 0:
            continue
        lines.append(f"| {markdown_cell(event_type)} | {int(count or 0)} |")
    if len(lines) == 8:
        lines.append("| 无 | 0 |")

    lines.extend(["", "## 状态统计", "", "| 状态 | 次数 |", "| --- | ---: |"])
    status_header_len = len(lines)
    for status, count in counts_by_status.items():
        if int(count or 0) <= 0:
            continue
        lines.append(f"| {markdown_cell(status)} | {int(count or 0)} |")
    if len(lines) == status_header_len:
        lines.append("| 无 | 0 |")

    lines.extend(
        [
            "",
            "## 最近事件",
            "",
            "| 时间 | 类型 | 状态 | 服务器 | 会话 | 来源 | 命令/说明 | 上下文 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    if not recent:
        lines.append("| - | 暂无 | - | - | - | - | - | - |")
    for item in recent:
        if not isinstance(item, dict):
            continue
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(item.get("createdAt")),
                    markdown_cell(item.get("type")),
                    markdown_cell(item.get("status")),
                    markdown_cell(item.get("server")),
                    markdown_cell(item.get("sessionId")),
                    markdown_cell(item.get("actor")),
                    markdown_cell(item.get("summary")),
                    markdown_cell(item.get("contextText")),
                ]
            )
            + " |"
        )
    return "\n".join(lines) + "\n"


def build_frontend_incidents_summary_markdown(frontend_incidents) -> str:
    safe = frontend_incidents if isinstance(frontend_incidents, dict) else {}
    counts = safe.get("counts") if isinstance(safe.get("counts"), dict) else {}
    recent = safe.get("recent") if isinstance(safe.get("recent"), list) else []
    lines = [
        "# 前端异常摘要",
        "",
        f"总数：{int(safe.get('total') or 0)}",
        "",
        "## 动作统计",
        "",
        "| 动作 | 次数 |",
        "| --- | ---: |",
    ]
    for action, count in counts.items():
        if int(count or 0) <= 0:
            continue
        lines.append(f"| {markdown_cell(action)} | {int(count or 0)} |")
    if len(lines) == 8:
        lines.append("| 无 | 0 |")

    lines.extend(
        [
            "",
            "## 最近异常",
            "",
            "| 时间 | 级别 | 动作 | 说明 | 错误 |",
            "| --- | --- | --- | --- | --- |",
        ]
    )
    if not recent:
        lines.append("| - | - | 暂无 | - | - |")
    for item in recent:
        if not isinstance(item, dict):
            continue
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(item.get("createdAt")),
                    markdown_cell(item.get("level")),
                    markdown_cell(item.get("action")),
                    markdown_cell(item.get("message")),
                    markdown_cell(item.get("error")),
                ]
            )
            + " |"
        )
    return "\n".join(lines) + "\n"


def build_runtime_environment_summary_markdown(runtime_summary) -> str:
    safe = runtime_summary if isinstance(runtime_summary, dict) else {}
    runtime = safe.get("runtime") if isinstance(safe.get("runtime"), dict) else {}
    release = safe.get("release") if isinstance(safe.get("release"), dict) else {}
    logs = safe.get("logs") if isinstance(safe.get("logs"), dict) else {}
    tool_logs = logs.get("toolLogs") if isinstance(logs.get("toolLogs"), dict) else {}
    session_logs = logs.get("sessionLogs") if isinstance(logs.get("sessionLogs"), dict) else {}
    webview = safe.get("webView2Runtime") if isinstance(safe.get("webView2Runtime"), dict) else {}
    runtime_diagnostics = safe.get("runtimeDiagnostics") if isinstance(safe.get("runtimeDiagnostics"), dict) else {}
    startup_identity = runtime_diagnostics.get("startupIdentity") if isinstance(runtime_diagnostics.get("startupIdentity"), dict) else {}
    command_line_launchers = runtime_diagnostics.get("commandLineLaunchers") if isinstance(runtime_diagnostics.get("commandLineLaunchers"), dict) else {}
    frontend_assets = release.get("frontendAssets") if isinstance(release.get("frontendAssets"), dict) else {}
    verification = release.get("verification") if isinstance(release.get("verification"), dict) else {}
    verification_items = release.get("verificationItems") if isinstance(release.get("verificationItems"), list) else []
    runtime_readiness = safe.get("runtimeReadiness") if isinstance(safe.get("runtimeReadiness"), dict) else {}
    lines = [
        "# 运行环境摘要",
        "",
        f"生成时间：{markdown_cell(safe.get('createdAt'))}",
        "",
        "## 客户端",
        "",
        f"- 版本：{markdown_cell(release.get('version'))}",
        f"- 更新通道：{markdown_cell(release.get('updateChannel'))}",
        f"- 主程序：{markdown_cell(release.get('executable'))}",
        f"- SHA256：{markdown_cell(release.get('sha256'))}",
        f"- 文件大小：{markdown_cell(release.get('sizeBytes'))}",
        "",
        "## 运行时",
        "",
        f"- Python：{markdown_cell(runtime.get('python'))}",
        f"- 平台：{markdown_cell(runtime.get('platform'))}",
        f"- Frozen：{markdown_cell(runtime.get('frozen'))}",
        f"- 可执行路径：{markdown_cell(runtime.get('executable'))}",
        f"- 程序目录：{markdown_cell(runtime_diagnostics.get('executableDirectory') or runtime.get('executableDirectory'))}",
        "",
        "## 启动身份",
        "",
        f"- 状态：{markdown_cell(startup_identity.get('ok'))}",
        f"- 版本：{markdown_cell(startup_identity.get('version'))}",
        f"- 运行脚本：{markdown_cell(startup_identity.get('runtimeScript'))}",
        f"- 清单脚本：{markdown_cell(startup_identity.get('manifestScript'))}",
        f"- frontendMatchesManifest：{markdown_cell(startup_identity.get('frontendMatchesManifest'))}",
        f"- consoleWindow：{markdown_cell(startup_identity.get('consoleWindow'))}",
        f"- EXE 子系统：{markdown_cell(startup_identity.get('executableSubsystem'))}",
        f"- 说明：{markdown_cell(startup_identity.get('message'))}",
        "",
        "## 命令行启动器",
        "",
        f"- 检测到 BAT/CMD：{markdown_cell(command_line_launchers.get('hasBatchFiles'))}",
        f"- 启动器文件：{markdown_cell('、'.join(str(item) for item in command_line_launchers.get('batchFiles', []) if str(item).strip()) if isinstance(command_line_launchers.get('batchFiles'), list) else '')}",
        f"- 说明：{markdown_cell(command_line_launchers.get('message'))}",
        "",
        "## WebView2 Runtime",
        "",
        f"- 可用：{markdown_cell(webview.get('available'))}",
        f"- 来源：{markdown_cell(webview.get('source'))}",
        f"- 说明：{markdown_cell(webview.get('message'))}",
        "",
        "## 日志输入",
        "",
        f"- 工具日志文件数：{markdown_cell(tool_logs.get('count'))}",
        f"- 会话日志文件数：{markdown_cell(session_logs.get('count'))}",
        "",
        "## 发布验证",
        "",
        "| 状态 | 数量 |",
        "| --- | ---: |",
    ]
    for key in ("total", "passed", "failed", "skipped", "unknown"):
        lines.append(f"| {markdown_cell(key)} | {markdown_cell(verification.get(key, 0))} |")
    lines.extend(["", "## 验证项目", "", "| 项目 | 状态 |", "| --- | --- |"])
    if not verification_items:
        lines.append("| 暂无 | - |")
    for item in verification_items:
        if not isinstance(item, dict):
            continue
        lines.append(f"| {markdown_cell(item.get('name'))} | {markdown_cell(item.get('status'))} |")
    lines.extend(
        [
            "",
            "## 发布指纹",
            "",
            f"- ZIP 文件：{markdown_cell(release.get('packageFile'))}",
            f"- ZIP SHA256：{markdown_cell(release.get('packageSha256'))}",
            f"- EXE SHA256：{markdown_cell(release.get('standaloneExeSha256') or release.get('sha256'))}",
            f"- 前端资源：{markdown_cell(frontend_assets.get('script'))}",
            f"- 前端资源 SHA256：{markdown_cell(frontend_assets.get('scriptSha256'))}",
        ]
    )
    lines.extend(
        [
            "",
            "## runtimeReadiness",
            "",
            f"- state: {markdown_cell(runtime_readiness.get('state'))}",
            f"- summary: {markdown_cell(runtime_readiness.get('summary'))}",
            "",
            "| id | ok | message |",
            "| --- | --- | --- |",
        ]
    )
    checks = runtime_readiness.get("checks") if isinstance(runtime_readiness.get("checks"), list) else []
    if not checks:
        lines.append("| not-recorded | - | 当前没有运行时自检快照。 |")
    for item in checks:
        if not isinstance(item, dict):
            continue
        lines.append(f"| {markdown_cell(item.get('id'))} | {markdown_cell(item.get('ok'))} | {markdown_cell(item.get('message'))} |")
    return "\n".join(lines) + "\n"


def build_support_readme_markdown(runtime_summary, config_summary, created_at: str) -> str:
    safe = runtime_summary if isinstance(runtime_summary, dict) else {}
    release = safe.get("release") if isinstance(safe.get("release"), dict) else {}
    frontend_assets = release.get("frontendAssets") if isinstance(release.get("frontendAssets"), dict) else {}
    runtime = safe.get("runtime") if isinstance(safe.get("runtime"), dict) else {}
    runtime_diagnostics = safe.get("runtimeDiagnostics") if isinstance(safe.get("runtimeDiagnostics"), dict) else {}
    logs = safe.get("logs") if isinstance(safe.get("logs"), dict) else {}
    tool_logs = logs.get("toolLogs") if isinstance(logs.get("toolLogs"), dict) else {}
    session_logs = logs.get("sessionLogs") if isinstance(logs.get("sessionLogs"), dict) else {}
    inputs = safe.get("inputs") if isinstance(safe.get("inputs"), dict) else {}
    release_update_log = inputs.get("releaseUpdateLog") if isinstance(inputs.get("releaseUpdateLog"), dict) else {}
    release_update_log_text = "已包含：release-update/release-updater.log" if release_update_log.get("exists") else "未检测到更新器日志"
    config = config_summary if isinstance(config_summary, dict) else {}
    lines = [
        "# SSH Agent 工具诊断包",
        "",
        f"生成时间：{markdown_cell(created_at)}",
        "",
        "## 版本指纹",
        "",
        f"- 版本：{markdown_cell(release.get('version'))}",
        f"- ZIP 文件：{markdown_cell(release.get('packageFile'))}",
        f"- ZIP SHA256：{markdown_cell(release.get('packageSha256'))}",
        f"- EXE SHA256：{markdown_cell(release.get('standaloneExeSha256') or release.get('sha256'))}",
        f"- 运行路径：{markdown_cell(runtime_diagnostics.get('executable') or runtime.get('executable'))}",
        f"- 程序目录：{markdown_cell(runtime_diagnostics.get('executableDirectory') or runtime.get('executableDirectory'))}",
        f"- 前端资源：{markdown_cell(frontend_assets.get('script'))}",
        f"- 前端资源 SHA256：{markdown_cell(frontend_assets.get('scriptSha256'))}",
        "",
        "## 包含内容",
        "",
        f"- 工具日志：{markdown_cell(tool_logs.get('count'))} 个文件",
        f"- 会话日志：{markdown_cell(session_logs.get('count'))} 个文件",
        f"- 更新器日志：{release_update_log_text}",
        f"- 配置摘要：{'已包含' if config.get('exists') else '未检测到配置文件'}",
        f"- 服务器配置数量：{markdown_cell(len(config.get('customServerNames') or []))}",
        f"- 模型 API 档案数量：{markdown_cell(config.get('modelProfileCount'))}",
        f"- Agent 能力数量：{markdown_cell(config.get('agentCapabilityCount'))}",
        "",
        "## 反馈建议",
        "",
        "- 如果是 SSH 连接、输入命令、Ctrl+C、白屏或 SFTP 问题，请直接发送整个诊断包。",
        "- 如果是跨电脑打不开或白屏，请同时截图错误页，并对比这里的前端资源文件名。",
        "- 如果是在线更新失败，请查看 release-update-status.json 和 release-update/release-updater.log。",
        "- 如果是模型 API 问题，请说明当前选择的供应商、Base URL 和模型名，不要发送 API Key。",
        "",
        "## 隐私说明",
        "",
        "- 诊断包会对日志和配置摘要再次脱敏。",
        "- 不包含明文密码、API Key、Token 或私钥。",
        "- 发送前仍建议打开压缩包快速检查一次内容。",
    ]
    return "\n".join(lines) + "\n"


def build_problem_feedback_template(runtime_summary, created_at: str) -> str:
    safe = runtime_summary if isinstance(runtime_summary, dict) else {}
    release = safe.get("release") if isinstance(safe.get("release"), dict) else {}
    frontend_assets = release.get("frontendAssets") if isinstance(release.get("frontendAssets"), dict) else {}
    runtime = safe.get("runtime") if isinstance(safe.get("runtime"), dict) else {}
    webview = safe.get("webView2Runtime") if isinstance(safe.get("webView2Runtime"), dict) else {}
    runtime_diagnostics = safe.get("runtimeDiagnostics") if isinstance(safe.get("runtimeDiagnostics"), dict) else {}
    startup_failure = runtime_diagnostics.get("startupFailureLog") if isinstance(runtime_diagnostics.get("startupFailureLog"), dict) else {}
    client_entry = runtime_diagnostics.get("clientEntry") if isinstance(runtime_diagnostics.get("clientEntry"), dict) else {}
    known_signature = (
        startup_failure.get("knownSignature")
        or startup_failure.get("knownIssue")
        or startup_failure.get("message")
        or ""
    )
    lines = [
        "SSH Agent 工具问题反馈模板",
        "",
        "请把本文件和整个诊断包一起发送给开发者。",
        "不要发送密码、私钥、Token、Cookie 或 API Key；诊断包已尽量脱敏，发送前仍建议快速检查。",
        "",
        "一、问题现象",
        "- 模块：启动 / SSH 终端 / SFTP / Agent / 模型 API / 在线更新 / 其他",
        "- 现象：",
        "- 错误截图：",
        f"- 已知错误签名：{markdown_cell(known_signature)}",
        "",
        "二、复现步骤",
        "1. ",
        "2. ",
        "3. ",
        "",
        "三、运行环境",
        f"- 反馈时间：{markdown_cell(created_at)}",
        f"- 运行路径：{markdown_cell(runtime_diagnostics.get('executable') or runtime.get('executable'))}",
        f"- 程序目录：{markdown_cell(runtime_diagnostics.get('executableDirectory') or runtime.get('executableDirectory'))}",
        f"- 客户端入口：{markdown_cell(client_entry.get('message'))}",
        f"- WebView2：{markdown_cell(webview.get('message'))}",
        "",
        "四、版本指纹",
        f"- 版本：{markdown_cell(release.get('version'))}",
        f"- ZIP 文件：{markdown_cell(release.get('packageFile'))}",
        f"- ZIP SHA256：{markdown_cell(release.get('packageSha256'))}",
        f"- EXE SHA256：{markdown_cell(release.get('standaloneExeSha256') or release.get('sha256'))}",
        f"- 前端资源：{markdown_cell(frontend_assets.get('script'))}",
        f"- 前端资源 SHA256：{markdown_cell(frontend_assets.get('scriptSha256'))}",
        "",
        "五、补充说明",
        "- 是否换电脑运行：是 / 否",
        "- 是否从 ZIP 预览窗口直接运行：是 / 否",
        "- 是否删除旧解压目录和旧快捷方式后重新解压：是 / 否",
        "- 其他说明：",
        "",
    ]
    return "\n".join(lines)


def build_configuration_summary_markdown(config_summary) -> str:
    safe = config_summary if isinstance(config_summary, dict) else {}
    server_names = safe.get("customServerNames") if isinstance(safe.get("customServerNames"), list) else []
    model_names = safe.get("modelProfileNames") if isinstance(safe.get("modelProfileNames"), list) else []
    capability_names = safe.get("agentCapabilityNames") if isinstance(safe.get("agentCapabilityNames"), list) else []
    top_level_keys = safe.get("topLevelKeys") if isinstance(safe.get("topLevelKeys"), list) else []
    lines = [
        "# 配置摘要",
        "",
        f"- 配置文件存在：{markdown_cell(safe.get('exists'))}",
        f"- 配置文件大小：{markdown_cell(safe.get('sizeBytes'))}",
        f"- 顶层配置项：{markdown_cell('、'.join(str(item) for item in top_level_keys))}",
        f"- 自定义服务器数量：{len(server_names)}",
        f"- 模型 API 档案数量：{int(safe.get('modelProfileCount') or 0)}",
        f"- Agent 能力数量：{int(safe.get('agentCapabilityCount') or 0)}",
        "",
        "## 自定义服务器",
        "",
    ]
    lines.extend(markdown_name_list(server_names))
    lines.extend(["", "## 模型 API 档案", ""])
    lines.extend(markdown_name_list(model_names))
    lines.extend(["", "## Agent 能力", ""])
    lines.extend(markdown_name_list(capability_names))
    return "\n".join(lines) + "\n"


def markdown_name_list(values) -> list[str]:
    items = [markdown_cell(item) for item in values if str(item or "").strip()]
    if not items:
        return ["- 暂无"]
    return [f"- {item}" for item in items[:50]]


def markdown_cell(value) -> str:
    return str(value or "").replace("|", "\\|").replace("\n", " ").strip() or "-"


def summarize_sftp_failures(root: Path, limit: int = 20) -> dict:
    counts: dict[str, int] = {}
    recent = []
    total = 0
    for entry in iter_tool_log_entries(root):
        if entry.get("component") != "sftp" or entry.get("level") not in {"warn", "error"}:
            continue
        context = entry.get("context") if isinstance(entry.get("context"), dict) else {}
        server = context.get("server") if isinstance(context.get("server"), dict) else {}
        action = str(entry.get("action") or "unknown").strip() or "unknown"
        counts[action] = counts.get(action, 0) + 1
        total += 1
        recent.append(
            {
                "createdAt": entry.get("createdAt", ""),
                "level": entry.get("level", ""),
                "action": action,
                "serverName": str(server.get("name") or "").strip(),
                "host": str(server.get("ip") or server.get("host") or "").strip(),
                "user": str(server.get("user") or "").strip(),
                "remotePath": str(context.get("remotePath") or "").strip(),
                "localName": safe_local_name(str(context.get("localPath") or "")),
                "message": entry.get("message", ""),
            }
        )
    recent.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"total": total, "counts": counts, "recent": recent[:limit]}


def summarize_release_update_failures(root: Path, limit: int = 20) -> dict:
    counts: dict[str, int] = {}
    recent = []
    total = 0
    for entry in iter_tool_log_entries(root):
        if entry.get("component") != "release-update" or entry.get("level") not in {"warn", "error"}:
            continue
        context = entry.get("context") if isinstance(entry.get("context"), dict) else {}
        action = str(entry.get("action") or "unknown").strip() or "unknown"
        counts[action] = counts.get(action, 0) + 1
        total += 1
        recent.append(
            {
                "createdAt": entry.get("createdAt", ""),
                "level": entry.get("level", ""),
                "action": action,
                "updateSource": str(context.get("updateSource") or "").strip(),
                "updateCheckUrl": str(context.get("updateCheckUrl") or "").strip(),
                "version": str(context.get("version") or "").strip(),
                "latestVersion": str(context.get("latestVersion") or "").strip(),
                "packageUrl": str(context.get("packageUrl") or "").strip(),
                "packageName": safe_local_name(str(context.get("localPath") or "")),
                "message": entry.get("message", ""),
            }
        )
    recent.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"total": total, "counts": counts, "recent": recent[:limit]}


def summarize_server_management_events(root: Path, limit: int = 30) -> dict:
    counts: dict[str, int] = {}
    recent = []
    total = 0
    for entry in iter_tool_log_entries(root):
        if entry.get("component") != "server-management":
            continue
        context = entry.get("context") if isinstance(entry.get("context"), dict) else {}
        action = str(entry.get("action") or "unknown").strip() or "unknown"
        counts[action] = counts.get(action, 0) + 1
        total += 1
        recent.append(
            {
                "createdAt": entry.get("createdAt", ""),
                "level": entry.get("level", ""),
                "action": action,
                "serverName": str(context.get("serverName") or "").strip(),
                "host": str(context.get("host") or "").strip(),
                "port": str(context.get("port") or "").strip(),
                "user": str(context.get("user") or "").strip(),
                "authType": str(context.get("authType") or "").strip(),
                "group": str(context.get("group") or "").strip(),
                "oldName": str(context.get("oldName") or "").strip(),
                "renamed": bool(context.get("renamed")) if "renamed" in context else False,
                "resetSession": bool(context.get("resetSession")) if "resetSession" in context else False,
                "message": entry.get("message", ""),
            }
        )
    recent.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"total": total, "counts": counts, "recent": recent[:limit]}


def summarize_terminal_control_events(tool_root: Path, session_root: Path, limit: int = 30) -> dict:
    counts: dict[str, int] = {}
    recent = []
    total = 0
    tool_actions = {"interrupt_command", "resize_session"}
    session_types = {
        "session_interrupt_sent",
        "session_interrupt_failed",
        "session_control_signal_sent",
        "session_control_signal_failed",
    }

    for entry in iter_tool_log_entries(tool_root):
        if entry.get("component") != "ssh" or entry.get("action") not in tool_actions:
            continue
        context = entry.get("context") if isinstance(entry.get("context"), dict) else {}
        action = str(entry.get("action") or "unknown").strip() or "unknown"
        counts[action] = counts.get(action, 0) + 1
        total += 1
        recent.append(
            {
                "createdAt": entry.get("createdAt", ""),
                "type": "tool",
                "action": action,
                "serverName": str(context.get("serverName") or context.get("server") or "").strip(),
                "sessionId": str(context.get("sessionId") or "").strip(),
                "control": control_name_from_action(action, context),
                "status": entry.get("level", ""),
                "message": entry.get("message", ""),
            }
        )

    for entry in iter_session_log_entries(session_root):
        event_type = str(entry.get("type") or "").strip()
        if event_type not in session_types:
            continue
        context = entry.get("context") if isinstance(entry.get("context"), dict) else {}
        counts[event_type] = counts.get(event_type, 0) + 1
        total += 1
        recent.append(
            {
                "createdAt": entry.get("createdAt", ""),
                "type": "session",
                "action": event_type,
                "serverName": str(entry.get("server") or context.get("serverName") or "").strip(),
                "sessionId": str(entry.get("sessionId") or "").strip(),
                "control": str(context.get("signal") or control_name_from_action(event_type, context)).strip(),
                "status": str(entry.get("status") or "").strip(),
                "message": entry.get("message", ""),
            }
        )

    recent.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"total": total, "counts": counts, "recent": recent[:limit]}


def control_name_from_action(action: str, context: dict | None = None) -> str:
    safe_context = context if isinstance(context, dict) else {}
    if safe_context.get("signal"):
        return str(safe_context.get("signal") or "").strip()
    if "interrupt" in str(action or ""):
        return "interrupt"
    if "resize" in str(action or ""):
        return "resize"
    return ""


def summarize_session_events(root: Path, limit: int = 30) -> dict:
    counts_by_type: dict[str, int] = {}
    counts_by_status: dict[str, int] = {}
    recent = []
    total = 0
    for entry in iter_session_log_entries(root):
        event_type = str(entry.get("type") or "event").strip() or "event"
        status = str(entry.get("status") or "unknown").strip() or "unknown"
        counts_by_type[event_type] = counts_by_type.get(event_type, 0) + 1
        counts_by_status[status] = counts_by_status.get(status, 0) + 1
        total += 1
        context = entry.get("context") if isinstance(entry.get("context"), dict) else {}
        summary = entry.get("message") or entry.get("command") or entry.get("output") or ""
        recent.append(
            {
                "createdAt": entry.get("createdAt", ""),
                "type": event_type,
                "status": status,
                "server": entry.get("server", ""),
                "sessionId": entry.get("sessionId", ""),
                "actor": entry.get("actor", ""),
                "summary": str(summary)[:240],
                "contextText": json.dumps(context, ensure_ascii=False, separators=(",", ":"))[:240] if context else "",
            }
        )
    recent.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {"total": total, "countsByType": counts_by_type, "countsByStatus": counts_by_status, "recent": recent[:limit]}


def safe_local_name(local_path: str) -> str:
    text = str(local_path or "").replace("\\", "/").strip()
    if not text:
        return ""
    return posixpath.basename(text.rstrip("/"))


def iter_tool_log_entries(root: Path):
    if not root.exists():
        return
    for path in sorted(root.glob("*.jsonl")):
        if not path.is_file():
            continue
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line in lines:
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict) or payload.get("schema") != TOOL_LOG_SCHEMA:
                continue
            yield normalize_entry(payload, path)


def iter_session_log_entries(root: Path):
    if not root.exists():
        return
    for path in sorted(root.rglob("*.jsonl")):
        if not path.is_file():
            continue
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line in lines:
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict) or payload.get("schema") != SESSION_LOG_SCHEMA:
                continue
            yield normalize_session_entry(payload, path)


def read_json_file(path: Path) -> dict:
    if not path.exists():
        return {"ok": False, "message": "文件不存在", "path": str(path)}
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as error:
        return {"ok": False, "message": str(error), "path": str(path)}
    return sanitize_context(data) if isinstance(data, dict) else {"value": sanitize_context(data)}


def read_release_update_status_file(path: Path) -> dict:
    data = read_json_file(path)
    if not isinstance(data, dict):
        return {"value": sanitize_context(data)}
    safe = dict(data)
    for key in ("packageZip", "packagePath", "localPath", "scriptPath", "logPath"):
        if key in safe:
            safe[key] = safe_local_name(str(safe.get(key) or ""))
    for key in ("targetRoot", "backupRoot", "installRoot"):
        if key in safe:
            safe[key] = "[本机路径已隐藏]"
    return sanitize_context(safe)


def add_log_tree(archive: zipfile.ZipFile, files: list[str], prefix: str, root: Path) -> None:
    if not root.exists():
        add_text(archive, files, f"{prefix}/EMPTY.txt", "当前没有可导出的日志文件。\n")
        return
    added = 0
    for path in sorted(root.rglob("*.jsonl")):
        if not path.is_file():
            continue
        try:
            relative = path.relative_to(root).as_posix()
            content = redact_sensitive_text(path.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            continue
        add_text(archive, files, f"{prefix}/{relative}", content)
        added += 1
    if added == 0:
        add_text(archive, files, f"{prefix}/EMPTY.txt", "当前没有可导出的日志文件。\n")


def add_startup_failure_log(archive: zipfile.ZipFile, files: list[str], path: Path, runtime_diagnostics: dict | None = None) -> None:
    if not path.exists() or not path.is_file():
        return
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return
    add_text(archive, files, "startup-failure/startup-failure-latest.log", content)
    add_text(archive, files, "startup-failure-summary.md", build_startup_failure_summary_markdown(content, runtime_diagnostics))


def add_release_update_log(archive: zipfile.ZipFile, files: list[str], path: Path) -> None:
    if not path.exists() or not path.is_file():
        return
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return
    add_text(archive, files, "release-update/release-updater.log", redact_sensitive_text(content))


def build_startup_failure_summary_markdown(content: str, runtime_diagnostics: dict | None = None) -> str:
    safe_content = redact_sensitive_text(str(content or ""))
    known_issue = classify_startup_failure_issue(safe_content)
    lines = [
        "# 启动失败摘要",
        "",
        f"- 识别结果：{known_issue['label']}",
        f"- 建议处理：{known_issue['advice']}",
        "",
        "## 关键证据",
        "",
    ]
    evidence = extract_startup_failure_evidence(safe_content)
    lines.extend(f"- {item}" for item in evidence)
    frontend_evidence = extract_startup_frontend_mismatch_evidence(runtime_diagnostics)
    if frontend_evidence:
        lines.extend(["", "## 前端资源核对", ""])
        lines.extend(f"- {item}" for item in frontend_evidence)
    return "\n".join(lines).rstrip() + "\n"


def extract_startup_frontend_mismatch_evidence(runtime_diagnostics: dict | None = None) -> list[str]:
    safe = runtime_diagnostics if isinstance(runtime_diagnostics, dict) else {}
    startup_identity = safe.get("startupIdentity") if isinstance(safe.get("startupIdentity"), dict) else {}
    runtime_script = str(startup_identity.get("runtimeScript") or "").strip()
    manifest_script = str(startup_identity.get("manifestScript") or "").strip()
    frontend_matches = startup_identity.get("frontendMatchesManifest")
    if frontend_matches is not False and not (runtime_script and manifest_script and runtime_script != manifest_script):
        return []
    return [
        f"运行脚本：{markdown_cell(runtime_script or '--')}",
        f"清单脚本：{markdown_cell(manifest_script or '--')}",
        f"frontendMatchesManifest：{markdown_cell(frontend_matches)}",
        "判断：当前运行的前端资源与版本清单不一致，优先删除旧解压目录和旧快捷方式后重新解压最新版 ZIP。",
    ]


def classify_startup_failure_issue(content: str) -> dict:
    text = str(content or "")
    stale_signatures = [
        "Power is not defined",
        "ReferenceError: Power",
        "index-BCGy_mkD.js",
        "index-C55DkVKK.js",
        "exportConnectionCheckReport is not defined",
    ]
    if any(signature in text for signature in stale_signatures):
        return {
            "label": "旧版前端资源或旧安装包",
            "advice": "删除旧解压目录和旧桌面快捷方式，只重新解压最新版 ZIP，然后双击里面的 SSH-Agent-Tool.exe。",
        }
    if "WebView2" in text:
        return {
            "label": "WebView2 运行环境异常",
            "advice": "安装或修复 Microsoft Edge WebView2 Runtime 后重新启动。",
        }
    return {
        "label": "未识别的启动异常",
        "advice": "结合 startup-failure-latest.log、runtime-summary.json 和工具日志继续排查。",
    }


def extract_startup_failure_evidence(content: str, limit: int = 8) -> list[str]:
    evidence = []
    for line in str(content or "").splitlines():
        text = line.strip()
        if not text:
            continue
        if any(keyword in text for keyword in ("ReferenceError", "Error", "错误", "index-", "Power", "WebView2")):
            evidence.append(markdown_cell(text)[:260])
        if len(evidence) >= limit:
            break
    return evidence or ["未提取到明显错误行，请查看原始启动失败日志。"]


def add_json(archive: zipfile.ZipFile, files: list[str], name: str, payload) -> None:
    add_text(archive, files, name, json.dumps(sanitize_context(payload), ensure_ascii=False, indent=2) + "\n")


def add_text(archive: zipfile.ZipFile, files: list[str], name: str, content: str) -> None:
    archive.writestr(name, redact_sensitive_text(str(content or "")))
    files.append(name)


def build_readme(created_at: str) -> str:
    return "\n".join(
        [
            "SSH Agent 工具诊断包",
            "",
            f"生成时间：{created_at}",
            "用途：排查工具自身 BUG、启动异常、SSH/SFTP/API 调用失败。",
            "安全说明：日志和配置摘要已脱敏；提交前仍建议检查压缩包内容。",
            "",
        ]
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
