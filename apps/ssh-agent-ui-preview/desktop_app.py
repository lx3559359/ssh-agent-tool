from __future__ import annotations

import json
import hashlib
import os
import posixpath
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from audit_log import AuditLogger
from credential_store import CredentialStore
from diagnostic_package import write_diagnostic_package
from local_cli_runner import run_local_cli_command
from mcp_http_client import call_mcp_http
from model_client import chat_with_model as call_model_chat
from model_client import list_model_options as call_model_list
from model_client import test_model_connection as call_model_test
from model_credentials import resolve_model_config, sanitize_model_config, save_model_api_key
from port_forward import PortForwardManager
from server_backup import build_backup_payload, read_backup_file, restore_backup_agent_capabilities, restore_backup_credentials, write_backup_file
from session_log import SessionLogger, build_session_log_markdown, delete_old_session_logs, list_session_log_entries, redact_sensitive_text
from sftp_client import create_sftp_directory, create_sftp_file, decode_text_preview, delete_sftp_path, download_sftp_file, list_sftp_directory, read_sftp_text_file, rename_sftp_path, upload_sftp_file, write_sftp_text_file
from ssh_config_import import parse_ssh_config
from ssh_probe import probe_ssh_endpoint
from ssh_interactive import SshSessionManager
from ssh_session import build_basic_info_commands, run_readonly_command
from tool_log import ToolLogger, build_tool_log_markdown, delete_old_tool_logs, list_tool_log_entries
from web_search import search_web as call_web_search


APP_TITLE = "SSH Agent 工具"


def resource_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent


APP_DATA_DIR_NAME = "SSHAgentTool"
LEGACY_APP_DATA_DIR_NAME = "SSHAgentToolPreview"
SINGLE_INSTANCE_MUTEX_NAME = "Local\\SSHAgentToolDesktop"
WINDOWS_ERROR_ALREADY_EXISTS = 183


def ui_index_path() -> Path:
    return resource_root() / "dist" / "index.html"


def inspect_frontend_assets(index_path: str | Path | None = None) -> dict:
    path = Path(index_path) if index_path is not None else ui_index_path()
    result = {
        "ok": False,
        "indexHtml": str(path),
        "indexSha256": "",
        "indexSizeBytes": 0,
        "script": "",
        "scriptSha256": "",
        "scriptSizeBytes": 0,
        "stylesheet": "",
        "stylesheetSha256": "",
        "stylesheetSizeBytes": 0,
        "message": "",
    }
    try:
        html = path.read_text(encoding="utf-8")
        index_bytes = path.read_bytes()
        script_match = re.search(r'''src=["']\./assets/([^"']+\.js)["']''', html)
        stylesheet_match = re.search(r'''href=["']\./assets/([^"']+\.css)["']''', html)
        if not script_match:
            return {**result, "message": "frontend script asset not found in index.html"}
        if not stylesheet_match:
            return {**result, "message": "frontend stylesheet asset not found in index.html"}

        script_name = script_match.group(1)
        stylesheet_name = stylesheet_match.group(1)
        script_path = path.parent / "assets" / script_name
        stylesheet_path = path.parent / "assets" / stylesheet_name
        if not script_path.is_file():
            return {**result, "script": f"assets/{script_name}", "message": f"frontend script asset missing: {script_path}"}
        if not stylesheet_path.is_file():
            return {**result, "stylesheet": f"assets/{stylesheet_name}", "message": f"frontend stylesheet asset missing: {stylesheet_path}"}

        script_bytes = script_path.read_bytes()
        stylesheet_bytes = stylesheet_path.read_bytes()
        return {
            **result,
            "ok": True,
            "indexSha256": hashlib.sha256(index_bytes).hexdigest().upper(),
            "indexSizeBytes": len(index_bytes),
            "script": f"assets/{script_name}",
            "scriptSha256": hashlib.sha256(script_bytes).hexdigest().upper(),
            "scriptSizeBytes": len(script_bytes),
            "stylesheet": f"assets/{stylesheet_name}",
            "stylesheetSha256": hashlib.sha256(stylesheet_bytes).hexdigest().upper(),
            "stylesheetSizeBytes": len(stylesheet_bytes),
            "message": "frontend assets verified",
        }
    except Exception as error:
        return {**result, "message": f"frontend asset inspection failed: {error}"}


def release_manifest_path() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "manifest.json"
    return Path(__file__).resolve().parent / "manifest.json"


def local_release_latest_manifest_path() -> Path:
    manifest_dir = release_manifest_path().parent
    adjacent_latest = manifest_dir / "latest.json"
    if adjacent_latest.exists():
        return adjacent_latest
    return manifest_dir.parent / "latest.json"


def resolve_release_install_target_root() -> dict:
    manifest_path = release_manifest_path()
    manifest_dir = manifest_path.parent
    if manifest_path.exists():
        return {"root": manifest_dir, "mode": "packaged"}
    if (manifest_dir / "latest.json").exists():
        return {"root": manifest_dir, "mode": "standalone"}
    return {"root": manifest_dir, "mode": "portable"}


def describe_executable_client_mode(executable_path: str | Path | None = None) -> dict:
    path = Path(executable_path or sys.executable)
    base = {
        "path": str(path),
        "subsystem": None,
        "subsystemName": "unknown",
        "consoleWindow": None,
        "label": "运行模式未识别",
        "message": "未能读取 EXE 子系统信息。",
    }
    try:
        with path.open("rb") as handle:
            if handle.read(2) != b"MZ":
                return {**base, "message": "当前可执行文件不是 Windows PE / EXE 格式。"}
            handle.seek(0x3C)
            pe_offset_bytes = handle.read(4)
            if len(pe_offset_bytes) != 4:
                return {**base, "message": "EXE 文件头不完整，无法读取 PE 偏移。"}
            pe_offset = int.from_bytes(pe_offset_bytes, "little")
            handle.seek(pe_offset)
            if handle.read(4) != b"PE\0\0":
                return {**base, "message": "EXE PE 签名无效，无法识别客户端模式。"}
            handle.seek(pe_offset + 0x5C)
            subsystem_bytes = handle.read(2)
            if len(subsystem_bytes) != 2:
                return {**base, "message": "EXE 可选头不完整，无法读取子系统。"}
            subsystem = int.from_bytes(subsystem_bytes, "little")
    except OSError as error:
        return {**base, "message": f"读取 EXE 子系统失败：{error}"}

    if subsystem == 2:
        return {
            **base,
            "subsystem": subsystem,
            "subsystemName": "Windows GUI",
            "consoleWindow": False,
            "label": "Windows 图形客户端 EXE",
            "message": "这是正常 Windows 图形客户端，双击启动不应打开命令行窗口。",
        }
    if subsystem == 3:
        return {
            **base,
            "subsystem": subsystem,
            "subsystemName": "Windows Console",
            "consoleWindow": True,
            "label": "Windows 控制台程序",
            "message": "此 EXE 会使用控制台子系统，启动时可能打开命令行窗口。",
        }
    return {
        **base,
        "subsystem": subsystem,
        "subsystemName": f"Subsystem {subsystem}",
        "message": f"检测到未知 Windows 子系统：{subsystem}。",
    }


def inspect_command_line_launchers(root: str | Path | None = None) -> dict:
    scan_root = Path(root) if root else release_manifest_path().parent
    blocked_extensions = {".bat", ".cmd", ".ps1", ".psm1"}
    launchers: list[str] = []
    try:
        if scan_root.exists():
            for item in scan_root.rglob("*"):
                if item.is_file() and item.suffix.lower() in blocked_extensions:
                    try:
                        launchers.append(str(item.relative_to(scan_root)))
                    except ValueError:
                        launchers.append(str(item))
    except OSError as error:
        return {
            "ok": False,
            "root": str(scan_root),
            "count": 0,
            "files": [],
            "extensions": [],
            "message": f"扫描命令行脚本失败：{error}",
        }

    extensions = sorted({Path(name).suffix.lower() for name in launchers if Path(name).suffix})
    count = len(launchers)
    return {
        "ok": count == 0,
        "root": str(scan_root),
        "count": count,
        "files": sorted(launchers)[:20],
        "extensions": extensions,
        "message": "未发现 BAT/CMD/PowerShell 启动脚本。" if count == 0 else f"发现 {count} 个命令行脚本，请使用 SSH-Agent-Tool.exe 作为正式客户端入口。",
    }


def _is_path_inside(child: str | Path, parent: str | Path) -> bool:
    try:
        child_text = os.path.normcase(os.path.abspath(str(child)))
        parent_text = os.path.normcase(os.path.abspath(str(parent)))
        return os.path.commonpath([child_text, parent_text]) == parent_text
    except (OSError, ValueError):
        return False


def build_client_entry_diagnostics(
    executable: str | Path | None = None,
    cwd: str | Path | None = None,
    resource_root_path: str | Path | None = None,
    manifest_path: str | Path | None = None,
    ui_index_path: str | Path | None = None,
    temp_root: str | Path | None = None,
) -> dict:
    exe_path = Path(executable or sys.executable).expanduser()
    exe_dir = exe_path.parent
    cwd_path = Path(cwd or Path.cwd()).expanduser()
    resource_path = Path(resource_root_path) if resource_root_path is not None else resource_root()
    manifest = Path(manifest_path) if manifest_path is not None else release_manifest_path()
    ui_path = Path(ui_index_path) if ui_index_path is not None else globals()["ui_index_path"]()
    temp_path = Path(temp_root or tempfile.gettempdir()).expanduser()
    manifest_exists = manifest.exists()
    ui_exists = ui_path.exists()
    in_temp_executable = _is_path_inside(exe_dir, temp_path)
    in_temp_resource = _is_path_inside(resource_path, temp_path) or bool(re.search(r"(^|[\\/])_MEI\d+($|[\\/])", str(resource_path)))
    exe_dir_text = str(exe_dir).lower()
    likely_zip_preview = "zip-preview" in exe_dir_text or ".zip" in exe_dir_text or "compressedfolderpreview" in exe_dir_text
    recommended_entry = "完整解压最新版 Windows 客户端 ZIP 后，双击解压目录根部的 SSH-Agent-Tool.exe"

    if not ui_exists or likely_zip_preview:
        risk_level = "error"
    elif in_temp_executable or not manifest_exists:
        risk_level = "warning"
    else:
        risk_level = "ok"

    if in_temp_executable:
        message = "检测到 EXE 正在临时目录运行，请完整解压最新版 ZIP 后双击 SSH-Agent-Tool.exe。"
    elif not manifest_exists:
        message = "客户端目录缺少 manifest.json，请确认复制的是完整解压后的 Windows 客户端目录。"
    elif not ui_exists:
        message = "客户端目录缺少前端入口文件，请重新解压最新版 ZIP，确保 dist 目录完整。"
    else:
        message = "客户端入口正常；如看到 _MEI 临时资源目录，这是 Windows 打包程序运行时的正常现象。"

    return {
        "ok": risk_level != "error",
        "riskLevel": risk_level,
        "executable": str(exe_path),
        "executableDirectory": str(exe_dir),
        "cwd": str(cwd_path),
        "resourceRoot": str(resource_path),
        "manifestPath": str(manifest),
        "manifestExists": bool(manifest_exists),
        "uiIndexPath": str(ui_path),
        "uiIndexExists": bool(ui_exists),
        "tempRoot": str(temp_path),
        "inTempExecutableDirectory": bool(in_temp_executable),
        "inTempResourceRoot": bool(in_temp_resource),
        "likelyZipPreviewDirectory": bool(likely_zip_preview),
        "recommendedEntry": recommended_entry,
        "message": message,
    }


def default_release_manifest(message: str = "manifest 文件不存在，当前为本地开发版本。") -> dict:
    return {
        "ok": False,
        "appName": "SSH Agent 工具",
        "version": "dev",
        "generatedAt": "",
        "updateChannel": "local",
        "executable": "SSH-Agent-Tool.exe",
        "sha256": "",
        "sizeBytes": 0,
        "updateCheckUrl": "",
        "releaseNotesUrl": "",
        "supportUrl": "",
        "updatePolicy": "支持远程版本清单和应用内检查更新。",
        "currentPackageUrl": "",
        "features": [],
        "verification": [],
        "frontendAssets": {},
        "message": message,
    }


def read_embedded_release_manifest() -> dict:
    try:
        import build_info
    except Exception:
        return default_release_manifest("未找到 EXE 内置版本信息，按单 EXE 便携模式继续启动。")

    version = str(getattr(build_info, "BUILD_VERSION", "dev") or "dev").strip() or "dev"
    embedded = {
        "appName": "SSH Agent 工具",
        "version": version,
        "packageName": str(getattr(build_info, "BUILD_PACKAGE_NAME", "") or "").strip(),
        "generatedAt": str(getattr(build_info, "BUILD_GENERATED_AT", "") or "").strip(),
        "updateChannel": str(getattr(build_info, "BUILD_UPDATE_CHANNEL", "local") or "local").strip() or "local",
        "executable": str(getattr(build_info, "BUILD_EXECUTABLE", "SSH-Agent-Tool.exe") or "SSH-Agent-Tool.exe").strip()
        or "SSH-Agent-Tool.exe",
        "message": "已使用 EXE 内置版本信息。" if version != "dev" else "未找到 manifest.json，按单 EXE 便携模式继续启动。",
    }
    return sanitize_release_manifest(embedded) if version != "dev" else default_release_manifest(embedded["message"])


def sanitize_release_verification(items) -> list[dict]:
    if not isinstance(items, list):
        return []
    verification = []
    for item in items[:12]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        command = str(item.get("command") or "").strip()
        result = str(item.get("result") or "").strip()
        status = str(item.get("status") or "").strip()
        if not name and not command and not result:
            continue
        verification.append(
            {
                "name": name or "验证项",
                "command": command,
                "result": result,
                "status": status or "unknown",
                "finishedAt": str(item.get("finishedAt") or "").strip(),
                "durationSeconds": item.get("durationSeconds") if isinstance(item.get("durationSeconds"), (int, float)) else None,
            }
        )
    return verification


def sanitize_frontend_assets(assets) -> dict:
    safe = assets if isinstance(assets, dict) else {}
    return {
        "ok": bool(safe.get("ok", True)) if safe else False,
        "indexHtml": str(safe.get("indexHtml") or "").strip(),
        "indexSha256": str(safe.get("indexSha256") or "").strip(),
        "indexSizeBytes": int(safe.get("indexSizeBytes") or 0) if str(safe.get("indexSizeBytes") or "0").isdigit() else 0,
        "script": str(safe.get("script") or "").strip(),
        "scriptSha256": str(safe.get("scriptSha256") or "").strip(),
        "scriptSizeBytes": int(safe.get("scriptSizeBytes") or 0) if str(safe.get("scriptSizeBytes") or "0").isdigit() else 0,
        "stylesheet": str(safe.get("stylesheet") or "").strip(),
        "stylesheetSha256": str(safe.get("stylesheetSha256") or "").strip(),
        "stylesheetSizeBytes": int(safe.get("stylesheetSizeBytes") or 0) if str(safe.get("stylesheetSizeBytes") or "0").isdigit() else 0,
        "message": str(safe.get("message") or "").strip(),
    }


def sanitize_release_manifest(manifest: dict) -> dict:
    safe = manifest if isinstance(manifest, dict) else {}
    features = safe.get("features")
    if not isinstance(features, list):
        features = []
    return {
        "ok": True,
        "appName": str(safe.get("appName") or "SSH Agent 工具").strip() or "SSH Agent 工具",
        "version": str(safe.get("version") or "dev").strip() or "dev",
        "packageName": str(safe.get("packageName") or "").strip(),
        "generatedAt": str(safe.get("generatedAt") or "").strip(),
        "updateChannel": str(safe.get("updateChannel") or "stable").strip() or "stable",
        "executable": str(safe.get("executable") or "SSH-Agent-Tool.exe").strip() or "SSH-Agent-Tool.exe",
        "sha256": str(safe.get("sha256") or "").strip(),
        "sizeBytes": int(safe.get("sizeBytes") or 0) if str(safe.get("sizeBytes") or "0").isdigit() else 0,
        "packageFile": str(safe.get("packageFile") or "").strip(),
        "packageSha256": str(safe.get("packageSha256") or "").strip(),
        "packageSizeBytes": int(safe.get("packageSizeBytes") or 0) if str(safe.get("packageSizeBytes") or "0").isdigit() else 0,
        "standaloneExe": str(safe.get("standaloneExe") or "").strip(),
        "standaloneExeSha256": str(safe.get("standaloneExeSha256") or "").strip(),
        "updateCheckUrl": str(safe.get("updateCheckUrl") or "").strip(),
        "releaseNotesUrl": str(safe.get("releaseNotesUrl") or "").strip(),
        "supportUrl": str(safe.get("supportUrl") or "").strip(),
        "updatePolicy": str(safe.get("updatePolicy") or "支持远程版本清单和应用内检查更新。").strip(),
        "currentPackageUrl": str(safe.get("currentPackageUrl") or "").strip(),
        "features": [str(item).strip() for item in features if str(item).strip()],
        "verification": sanitize_release_verification(safe.get("verification")),
        "frontendAssets": sanitize_frontend_assets(safe.get("frontendAssets")),
        "message": "版本清单读取成功。",
    }


def build_startup_identity(manifest: dict, frontend_assets: dict, executable_mode: dict | None = None) -> dict:
    safe_manifest = manifest if isinstance(manifest, dict) else {}
    safe_assets = frontend_assets if isinstance(frontend_assets, dict) else {}
    safe_mode = executable_mode if isinstance(executable_mode, dict) else {}
    manifest_assets = safe_manifest.get("frontendAssets") if isinstance(safe_manifest.get("frontendAssets"), dict) else {}
    runtime_script = str(safe_assets.get("script") or "").strip()
    runtime_script_sha = str(safe_assets.get("scriptSha256") or "").strip()
    runtime_stylesheet = str(safe_assets.get("stylesheet") or "").strip()
    runtime_stylesheet_sha = str(safe_assets.get("stylesheetSha256") or "").strip()
    manifest_script = str(manifest_assets.get("script") or "").strip()
    manifest_script_sha = str(manifest_assets.get("scriptSha256") or "").strip()
    manifest_stylesheet = str(manifest_assets.get("stylesheet") or "").strip()
    manifest_stylesheet_sha = str(manifest_assets.get("stylesheetSha256") or "").strip()
    frontend_matches_manifest = True
    if manifest_script:
        frontend_matches_manifest = frontend_matches_manifest and manifest_script == runtime_script
    if manifest_script_sha:
        frontend_matches_manifest = frontend_matches_manifest and manifest_script_sha.upper() == runtime_script_sha.upper()
    if manifest_stylesheet:
        frontend_matches_manifest = frontend_matches_manifest and manifest_stylesheet == runtime_stylesheet
    if manifest_stylesheet_sha:
        frontend_matches_manifest = frontend_matches_manifest and manifest_stylesheet_sha.upper() == runtime_stylesheet_sha.upper()
    console_window = bool(safe_mode.get("consoleWindow"))
    ok = bool(safe_assets.get("ok")) and frontend_matches_manifest and not console_window
    return {
        "ok": ok,
        "version": str(safe_manifest.get("version") or "dev").strip() or "dev",
        "executable": str(safe_manifest.get("executable") or "SSH-Agent-Tool.exe").strip() or "SSH-Agent-Tool.exe",
        "runtimeScript": runtime_script,
        "runtimeScriptSha256": runtime_script_sha,
        "manifestScript": manifest_script,
        "manifestScriptSha256": manifest_script_sha,
        "runtimeStylesheet": runtime_stylesheet,
        "runtimeStylesheetSha256": runtime_stylesheet_sha,
        "manifestStylesheet": manifest_stylesheet,
        "manifestStylesheetSha256": manifest_stylesheet_sha,
        "frontendMatchesManifest": bool(frontend_matches_manifest),
        "consoleWindow": console_window,
        "executableSubsystem": str(safe_mode.get("subsystemName") or "").strip(),
        "message": "启动身份一致" if ok else "启动身份需要检查：版本清单、前端资源或 EXE 模式不一致。",
    }


def merge_release_manifest_with_local_latest(manifest: dict) -> dict:
    if not isinstance(manifest, dict):
        return manifest
    try:
        latest = read_local_release_manifest()
    except Exception:
        return manifest
    if not isinstance(latest, dict):
        return manifest

    safe = sanitize_release_manifest(manifest)
    latest_safe = sanitize_release_manifest(latest)
    current_version = str(safe.get("version") or "").strip()
    latest_version = str(latest_safe.get("version") or "").strip()
    if current_version and latest_version and current_version != latest_version:
        return manifest

    merged = dict(safe)
    merged["ok"] = bool(manifest.get("ok"))
    merged["message"] = str(manifest.get("message") or safe.get("message") or "").strip()
    for key in (
        "packageName",
        "packageFile",
        "packageSha256",
        "packageSizeBytes",
        "standaloneExe",
        "standaloneExeSha256",
        "currentPackageUrl",
        "releaseNotesUrl",
        "supportUrl",
        "features",
        "verification",
        "frontendAssets",
    ):
        value = latest_safe.get(key)
        if value not in ("", [], None, 0):
            merged[key] = value
    return merged


def sanitize_release_update_settings(settings: dict | None) -> dict:
    safe = settings if isinstance(settings, dict) else {}
    return {
        "updateCheckUrl": str(safe.get("updateCheckUrl") or "").strip(),
        "autoCheckOnStartup": bool(safe.get("autoCheckOnStartup")),
    }


def is_valid_remote_update_url(url: str) -> bool:
    return str(url or "").strip().lower().startswith(("http://", "https://"))


def fetch_remote_release_manifest(url: str, timeout: int = 8) -> dict:
    safe_url = str(url or "").strip()
    with urllib.request.urlopen(safe_url, timeout=timeout) as response:
        raw = response.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError("远程版本清单超过 1MB，已拒绝读取。")
    data = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError("远程版本清单格式无效。")
    return data


def read_local_release_manifest(path: Path | None = None) -> dict | None:
    source = path or local_release_latest_manifest_path()
    if not source.exists():
        return None
    raw = source.read_bytes()
    if len(raw) > 1024 * 1024:
        raise ValueError("本地版本清单超过 1MB，已拒绝读取。")
    data = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError("本地版本清单格式无效。")
    return data


def release_update_download_path() -> Path:
    return app_data_root() / "updates"


def release_update_status_path() -> Path:
    return release_update_download_path() / "update-status.json"


def write_release_update_status(status: str, message: str, **extra) -> Path:
    path = release_update_status_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "status": str(status or "unknown").strip() or "unknown",
        "message": str(message or "").strip(),
        "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    payload.update({key: value for key, value in extra.items() if value not in (None, "")})
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def safe_release_package_filename(package_url: str, package_file: str = "") -> str:
    raw_name = str(package_file or "").strip()
    if not raw_name:
        parsed = urllib.parse.urlparse(str(package_url or "").strip())
        raw_name = Path(urllib.parse.unquote(parsed.path or "")).name
    if not raw_name:
        raw_name = "SSH-Agent-Tool-update.zip"
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(raw_name).name).strip(".-")
    if not name:
        name = "SSH-Agent-Tool-update.zip"
    if not name.lower().endswith(".zip"):
        name = f"{name}.zip"
    return name[:160]


def infer_release_package_url_from_update_manifest(update_url: str, package_file: str) -> str:
    if not str(package_file or "").strip():
        return ""
    safe_file_name = safe_release_package_filename("", package_file)
    safe_update_url = str(update_url or "").strip()
    if not safe_file_name or not safe_update_url.lower().startswith(("http://", "https://")):
        return ""
    try:
        parsed = urllib.parse.urlparse(safe_update_url)
        directory = (parsed.path or "/").rsplit("/", 1)[0]
        if directory:
            directory = f"{directory}/"
        else:
            directory = "/"
        return urllib.parse.urlunparse(
            (
                parsed.scheme,
                parsed.netloc,
                directory + urllib.parse.quote(safe_file_name),
                "",
                "",
                "",
            )
        )
    except Exception:
        return ""


def add_inferred_release_package_url(update_status: dict, update_url: str) -> dict:
    result = update_status if isinstance(update_status, dict) else {}
    if result.get("packageUrl") or not result.get("packageFile"):
        return result
    inferred = infer_release_package_url_from_update_manifest(update_url, str(result.get("packageFile") or ""))
    if inferred:
        result["packageUrl"] = inferred
    return result


def download_remote_release_package(url: str, timeout: int = 60, max_bytes: int = 300 * 1024 * 1024) -> bytes:
    safe_url = str(url or "").strip()
    if not safe_url.lower().startswith(("http://", "https://")):
        raise ValueError("更新包下载地址格式无效，请使用 http 或 https 地址。")
    with urllib.request.urlopen(safe_url, timeout=timeout) as response:
        chunks = []
        total = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise ValueError("更新包超过 300MB，已拒绝下载。")
            chunks.append(chunk)
    return b"".join(chunks)


def resolve_release_package_sha256(latest_source: dict, latest: dict) -> str:
    for key in ("packageSha256", "zipSha256", "sha256"):
        value = latest_source.get(key) if isinstance(latest_source, dict) else ""
        safe_value = str(value or "").strip()
        if safe_value:
            return safe_value.upper()
    value = latest.get("packageSha256") if isinstance(latest, dict) else ""
    return str(value or "").strip().upper()


def is_valid_release_package_sha256(value: str) -> bool:
    return bool(re.fullmatch(r"[0-9A-Fa-f]{64}", str(value or "").strip()))


def verify_release_install_target_writable(target_root: Path) -> dict:
    root = Path(target_root)
    if not root.exists():
        return {
            "ok": False,
            "state": "install_target_not_writable",
            "targetRoot": str(root),
            "message": f"更新安装目录不存在：{root}",
        }
    if not root.is_dir():
        return {
            "ok": False,
            "state": "install_target_not_writable",
            "targetRoot": str(root),
            "message": f"更新安装目标不是目录：{root}",
        }

    probe_path = root / f".ssh-agent-update-write-test-{os.getpid()}-{int(time.time() * 1000)}.tmp"
    try:
        probe_path.write_text("ok", encoding="utf-8")
        probe_path.unlink(missing_ok=True)
    except OSError as error:
        return {
            "ok": False,
            "state": "install_target_not_writable",
            "targetRoot": str(root),
            "message": f"更新安装目录不可写：{root}。请把工具解压到当前用户可写目录，或用有权限的目录重新安装。错误：{error}",
        }

    return {
        "ok": True,
        "state": "writable",
        "targetRoot": str(root),
        "message": "更新安装目录可写。",
    }


def powershell_single_quote(value) -> str:
    return "'" + str(value or "").replace("'", "''") + "'"


def guid_from_string(value: str):
    import ctypes
    import uuid

    class GUID(ctypes.Structure):
        _fields_ = [
            ("Data1", ctypes.c_ulong),
            ("Data2", ctypes.c_ushort),
            ("Data3", ctypes.c_ushort),
            ("Data4", ctypes.c_ubyte * 8),
        ]

    return GUID.from_buffer_copy(uuid.UUID(value).bytes_le)


def get_windows_desktop_directory() -> Path:
    if sys.platform != "win32":
        return Path.home() / "Desktop"

    import ctypes

    folder_id_desktop = guid_from_string("B4BFCC3A-DB2C-424C-B029-7FE99A87C641")
    path_pointer = ctypes.c_wchar_p()
    try:
        result = ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(folder_id_desktop), 0, None, ctypes.byref(path_pointer))
        if result == 0 and path_pointer.value:
            return Path(path_pointer.value)
    finally:
        if path_pointer:
            ctypes.windll.ole32.CoTaskMemFree(path_pointer)
    return Path(os.environ.get("USERPROFILE") or str(Path.home())) / "Desktop"


def get_windows_start_menu_programs_directory() -> Path:
    if sys.platform != "win32":
        return Path.home() / "Start Menu" / "Programs"
    return Path(os.environ.get("APPDATA") or str(Path.home())) / "Microsoft" / "Windows" / "Start Menu" / "Programs"


def assert_hresult_ok(result: int, action: str) -> None:
    if int(result) < 0:
        import ctypes

        raise OSError(f"{action} failed: {ctypes.WinError(result)}")


def safe_windows_shortcut_name(shortcut_name: str = "SSH-Agent-Tool.lnk") -> str:
    safe_shortcut_name = Path(str(shortcut_name or "SSH-Agent-Tool.lnk")).name or "SSH-Agent-Tool.lnk"
    if not safe_shortcut_name.lower().endswith(".lnk"):
        safe_shortcut_name = f"{safe_shortcut_name}.lnk"
    return safe_shortcut_name


def create_windows_shortcut_file(exe_path: Path, shortcut_path: Path) -> Path:
    if sys.platform != "win32":
        raise RuntimeError("当前运行环境不是 Windows，无法创建快捷方式。")

    import ctypes

    target = Path(exe_path)
    if not target.exists() or not target.is_file():
        raise FileNotFoundError(f"未找到主程序：{target}")

    shortcut_path = Path(shortcut_path)
    shortcut_path.parent.mkdir(parents=True, exist_ok=True)
    package_root = target.parent

    callback = getattr(ctypes, "WINFUNCTYPE", ctypes.CFUNCTYPE)
    hresult = ctypes.c_long

    class ShellLinkVtbl(ctypes.Structure):
        _fields_ = [
            ("QueryInterface", callback(hresult, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p))),
            ("AddRef", callback(ctypes.c_ulong, ctypes.c_void_p)),
            ("Release", callback(ctypes.c_ulong, ctypes.c_void_p)),
            ("GetPath", ctypes.c_void_p),
            ("GetIDList", ctypes.c_void_p),
            ("SetIDList", ctypes.c_void_p),
            ("GetDescription", ctypes.c_void_p),
            ("SetDescription", callback(hresult, ctypes.c_void_p, ctypes.c_wchar_p)),
            ("GetWorkingDirectory", ctypes.c_void_p),
            ("SetWorkingDirectory", callback(hresult, ctypes.c_void_p, ctypes.c_wchar_p)),
            ("GetArguments", ctypes.c_void_p),
            ("SetArguments", ctypes.c_void_p),
            ("GetHotkey", ctypes.c_void_p),
            ("SetHotkey", ctypes.c_void_p),
            ("GetShowCmd", ctypes.c_void_p),
            ("SetShowCmd", ctypes.c_void_p),
            ("GetIconLocation", ctypes.c_void_p),
            ("SetIconLocation", callback(hresult, ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_int)),
            ("SetRelativePath", ctypes.c_void_p),
            ("Resolve", ctypes.c_void_p),
            ("SetPath", callback(hresult, ctypes.c_void_p, ctypes.c_wchar_p)),
        ]

    class ShellLink(ctypes.Structure):
        _fields_ = [("lpVtbl", ctypes.POINTER(ShellLinkVtbl))]

    class PersistFileVtbl(ctypes.Structure):
        _fields_ = [
            ("QueryInterface", ctypes.c_void_p),
            ("AddRef", callback(ctypes.c_ulong, ctypes.c_void_p)),
            ("Release", callback(ctypes.c_ulong, ctypes.c_void_p)),
            ("GetClassID", ctypes.c_void_p),
            ("IsDirty", ctypes.c_void_p),
            ("Load", ctypes.c_void_p),
            ("Save", callback(hresult, ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_bool)),
            ("SaveCompleted", ctypes.c_void_p),
            ("GetCurFile", ctypes.c_void_p),
        ]

    class PersistFile(ctypes.Structure):
        _fields_ = [("lpVtbl", ctypes.POINTER(PersistFileVtbl))]

    clsid_shell_link = guid_from_string("00021401-0000-0000-C000-000000000046")
    iid_shell_link = guid_from_string("000214F9-0000-0000-C000-000000000046")
    iid_persist_file = guid_from_string("0000010b-0000-0000-C000-000000000046")
    clsctx_inproc_server = 1

    shell_link_pointer = ctypes.c_void_p()
    persist_file_pointer = ctypes.c_void_p()
    initialized = False
    try:
        init_result = ctypes.windll.ole32.CoInitialize(None)
        initialized = init_result in (0, 1)
        result = ctypes.windll.ole32.CoCreateInstance(
            ctypes.byref(clsid_shell_link),
            None,
            clsctx_inproc_server,
            ctypes.byref(iid_shell_link),
            ctypes.byref(shell_link_pointer),
        )
        assert_hresult_ok(result, "CoCreateInstance(IShellLink)")

        shell_link = ctypes.cast(shell_link_pointer, ctypes.POINTER(ShellLink))
        shell_vtbl = shell_link.contents.lpVtbl.contents
        assert_hresult_ok(shell_vtbl.SetPath(shell_link_pointer, str(target)), "IShellLink.SetPath")
        assert_hresult_ok(shell_vtbl.SetWorkingDirectory(shell_link_pointer, str(package_root)), "IShellLink.SetWorkingDirectory")
        assert_hresult_ok(shell_vtbl.SetIconLocation(shell_link_pointer, f"{target},0", 0), "IShellLink.SetIconLocation")
        assert_hresult_ok(shell_vtbl.SetDescription(shell_link_pointer, "SSH Agent 工具"), "IShellLink.SetDescription")
        assert_hresult_ok(
            shell_vtbl.QueryInterface(shell_link_pointer, ctypes.byref(iid_persist_file), ctypes.byref(persist_file_pointer)),
            "IShellLink.QueryInterface(IPersistFile)",
        )

        persist_file = ctypes.cast(persist_file_pointer, ctypes.POINTER(PersistFile))
        persist_vtbl = persist_file.contents.lpVtbl.contents
        assert_hresult_ok(persist_vtbl.Save(persist_file_pointer, str(shortcut_path), True), "IPersistFile.Save")
        return shortcut_path
    finally:
        if persist_file_pointer:
            persist_file = ctypes.cast(persist_file_pointer, ctypes.POINTER(PersistFile))
            persist_file.contents.lpVtbl.contents.Release(persist_file_pointer)
        if shell_link_pointer:
            shell_link = ctypes.cast(shell_link_pointer, ctypes.POINTER(ShellLink))
            shell_link.contents.lpVtbl.contents.Release(shell_link_pointer)
        if initialized:
            ctypes.windll.ole32.CoUninitialize()


def create_windows_desktop_shortcut(exe_path: Path, shortcut_name: str = "SSH-Agent-Tool.lnk") -> Path:
    desktop = get_windows_desktop_directory()
    return create_windows_shortcut_file(exe_path, desktop / safe_windows_shortcut_name(shortcut_name))


def create_windows_start_menu_shortcut(exe_path: Path, shortcut_name: str = "SSH-Agent-Tool.lnk") -> Path:
    programs = get_windows_start_menu_programs_directory()
    return create_windows_shortcut_file(exe_path, programs / safe_windows_shortcut_name(shortcut_name))


def schedule_process_exit(delay_seconds: float = 1.5, exit_code: int = 0) -> None:
    safe_delay = max(0.2, float(delay_seconds or 0))
    safe_exit_code = int(exit_code or 0)

    def exit_later() -> None:
        time.sleep(safe_delay)
        os._exit(safe_exit_code)

    threading.Thread(target=exit_later, name="ssh-agent-tool-exit-after-update", daemon=True).start()


def build_release_updater_script(
    package_zip: Path,
    target_root: Path,
    executable: str = "SSH-Agent-Tool.exe",
    current_pid: int = 0,
    log_path: Path | None = None,
) -> str:
    safe_executable = Path(str(executable or "SSH-Agent-Tool.exe")).name or "SSH-Agent-Tool.exe"
    safe_log_path = log_path or release_update_download_path() / "release-updater.log"
    safe_pid = max(0, int(current_pid or 0))
    lines = [
        "$ErrorActionPreference = 'Stop'",
        f"$PackageZip = {powershell_single_quote(package_zip)}",
        f"$TargetRoot = {powershell_single_quote(target_root)}",
        f"$ExeName = {powershell_single_quote(safe_executable)}",
        f"$ProcessIdToWait = {safe_pid}",
        f"$LogPath = {powershell_single_quote(safe_log_path)}",
        "$StatusPath = Join-Path (Split-Path -Parent $LogPath) 'update-status.json'",
        "",
        "function Write-UpdaterLog {",
        "    param([string]$Message)",
        "    $Parent = Split-Path -Parent $LogPath",
        "    if ($Parent) { New-Item -ItemType Directory -Force -Path $Parent | Out-Null }",
        "    $Stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'",
        "    Add-Content -LiteralPath $LogPath -Value (\"$Stamp $Message\") -Encoding UTF8",
        "}",
        "",
        "function Write-UpdaterStatus {",
        "    param([string]$Status, [string]$Message)",
        "    $Parent = Split-Path -Parent $StatusPath",
        "    if ($Parent) { New-Item -ItemType Directory -Force -Path $Parent | Out-Null }",
        "    $Payload = [ordered]@{",
        "        status = $Status",
        "        message = $Message",
        "        updatedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')",
        "        packageZip = $PackageZip",
        "        targetRoot = $TargetRoot",
        "        logPath = $LogPath",
        "    }",
        "    $Payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $StatusPath -Encoding UTF8",
        "}",
        "",
        "function Restore-UpdateBackup {",
        "    if ([string]::IsNullOrWhiteSpace($BackupRoot)) { return }",
        "    if (-not (Test-Path -LiteralPath $BackupRoot -PathType Container)) { return }",
        "    Write-UpdaterLog 'update failed; restoring backup files.'",
        "    Get-ChildItem -LiteralPath $BackupRoot -Force | ForEach-Object {",
        "        Copy-Item -LiteralPath $_.FullName -Destination $TargetRoot -Recurse -Force -ErrorAction SilentlyContinue",
        "    }",
        "}",
        "",
        "Write-UpdaterLog '开始安装更新。'",
        "if (-not (Test-Path -LiteralPath $PackageZip -PathType Leaf)) { throw \"更新包不存在：$PackageZip\" }",
        "if (-not (Test-Path -LiteralPath $TargetRoot -PathType Container)) { throw \"目标目录不存在：$TargetRoot\" }",
        "Write-UpdaterStatus -Status 'running' -Message 'updater started'",
        f"if ({safe_pid} -gt 0) {{ Wait-Process -Id {safe_pid} -Timeout 180 -ErrorAction SilentlyContinue }}",
        "Start-Sleep -Milliseconds 800",
        "$StageRoot = Join-Path $env:TEMP ('SSHAgentToolUpdate-' + [Guid]::NewGuid().ToString('N'))",
        "$BackupRoot = ''",
        "New-Item -ItemType Directory -Force -Path $StageRoot | Out-Null",
        "try {",
        "    Expand-Archive -LiteralPath $PackageZip -DestinationPath $StageRoot -Force",
        "    if (Test-Path -LiteralPath (Join-Path $StageRoot $ExeName) -PathType Leaf) {",
        "        $SourceRoot = $StageRoot",
        "    }",
        "    else {",
        "        $Candidates = @(Get-ChildItem -LiteralPath $StageRoot -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName $ExeName) -PathType Leaf })",
        "        if ($Candidates.Count -lt 1) { throw \"更新包内没有找到 $ExeName\" }",
        "        $SourceRoot = $Candidates[0].FullName",
        "    }",
        "    $BackupRoot = Join-Path $TargetRoot ('.update-backup-' + (Get-Date -Format 'yyyyMMddHHmmss'))",
        "    New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null",
        "    foreach ($Name in @($ExeName, 'manifest.json', '使用说明.txt')) {",
        "        $Existing = Join-Path $TargetRoot $Name",
        "        if (Test-Path -LiteralPath $Existing) { Copy-Item -LiteralPath $Existing -Destination $BackupRoot -Force }",
        "    }",
        "    Get-ChildItem -LiteralPath $SourceRoot -Force | ForEach-Object {",
        "        Copy-Item -LiteralPath $_.FullName -Destination $TargetRoot -Recurse -Force",
        "    }",
        "    $TargetExe = Join-Path $TargetRoot $ExeName",
        "    if (-not (Test-Path -LiteralPath $TargetExe -PathType Leaf)) { throw \"更新后没有找到主程序：$TargetExe\" }",
        "    Write-UpdaterLog '更新安装完成，正在启动新版本。'",
        "    Write-UpdaterStatus -Status 'completed' -Message 'update installed'",
        "    Start-Process -FilePath $TargetExe -WorkingDirectory $TargetRoot",
        "}",
        "catch {",
        "    $ErrorMessage = $_.Exception.Message",
        "    Write-UpdaterLog (\"update failed: \" + $ErrorMessage)",
        "    Restore-UpdateBackup",
        "    Write-UpdaterStatus -Status 'failed' -Message $ErrorMessage",
        "    throw",
        "}",
        "finally {",
        "    if (Test-Path -LiteralPath $StageRoot) { Remove-Item -LiteralPath $StageRoot -Recurse -Force -ErrorAction SilentlyContinue }",
        "}",
    ]
    return "\r\n".join(lines) + "\r\n"


def compare_release_versions(left, right) -> int:
    left_text = str(left or "").strip()
    right_text = str(right or "").strip()
    if left_text == right_text:
        return 0
    left_parts = [int(part) for part in re.findall(r"\d+", left_text)]
    right_parts = [int(part) for part in re.findall(r"\d+", right_text)]
    if left_parts or right_parts:
        length = max(len(left_parts), len(right_parts))
        for index in range(length):
            left_value = left_parts[index] if index < len(left_parts) else 0
            right_value = right_parts[index] if index < len(right_parts) else 0
            if left_value > right_value:
                return 1
            if left_value < right_value:
                return -1
        return 0
    if left_text > right_text:
        return 1
    if left_text < right_text:
        return -1
    return 0


def release_manifest_fingerprints_changed(current: dict, latest: dict, package_sha256: str = "") -> bool:
    current_safe = current if isinstance(current, dict) else {}
    latest_safe = latest if isinstance(latest, dict) else {}
    current_assets = current_safe.get("frontendAssets") if isinstance(current_safe.get("frontendAssets"), dict) else {}
    latest_assets = latest_safe.get("frontendAssets") if isinstance(latest_safe.get("frontendAssets"), dict) else {}
    digest_pairs = [
        (current_safe.get("packageSha256"), package_sha256 or latest_safe.get("packageSha256")),
        (current_safe.get("standaloneExeSha256") or current_safe.get("sha256"), latest_safe.get("standaloneExeSha256") or latest_safe.get("sha256")),
        (current_assets.get("scriptSha256"), latest_assets.get("scriptSha256")),
        (current_assets.get("stylesheetSha256"), latest_assets.get("stylesheetSha256")),
    ]
    for left, right in digest_pairs:
        left_text = str(left or "").strip().upper()
        right_text = str(right or "").strip().upper()
        if left_text and right_text and left_text != right_text:
            return True

    text_pairs = [
        (current_assets.get("script"), latest_assets.get("script")),
        (current_assets.get("stylesheet"), latest_assets.get("stylesheet")),
    ]
    for left, right in text_pairs:
        left_text = str(left or "").strip()
        right_text = str(right or "").strip()
        if left_text and right_text and left_text != right_text:
            return True
    return False


def build_release_update_status(current_manifest: dict, latest_manifest: dict) -> dict:
    current = sanitize_release_manifest(current_manifest if isinstance(current_manifest, dict) else {})
    latest_source = latest_manifest if isinstance(latest_manifest, dict) else {}
    latest = sanitize_release_manifest(latest_source)
    current_version = str(current.get("version") or "dev").strip() or "dev"
    latest_version = str(latest.get("version") or "").strip()
    if not latest_version:
        return {
            "ok": False,
            "state": "invalid_manifest",
            "currentVersion": current_version,
            "latestVersion": "",
            "message": "远程版本清单缺少版本号，暂时无法判断是否需要更新。",
        }

    package_url = str(latest.get("currentPackageUrl") or latest_source.get("packageUrl") or "").strip()
    package_file = str(latest_source.get("packageFile") or (safe_release_package_filename(package_url) if package_url else "")).strip()
    package_sha256 = resolve_release_package_sha256(latest_source, latest)
    release_notes_url = str(latest.get("releaseNotesUrl") or current.get("releaseNotesUrl") or "").strip()
    version_comparison = compare_release_versions(latest_version, current_version)
    same_version_changed_build = version_comparison == 0 and release_manifest_fingerprints_changed(current, latest, package_sha256)
    result = {
        "ok": True,
        "currentVersion": current_version,
        "latestVersion": latest_version,
        "packageUrl": package_url,
        "packageFile": package_file,
        "packageSha256": package_sha256,
        "releaseNotesUrl": release_notes_url,
        "generatedAt": str(latest.get("generatedAt") or "").strip(),
        "sha256": str(latest.get("sha256") or "").strip(),
        "latestManifest": latest,
        "sameVersionChangedBuild": same_version_changed_build,
    }
    if same_version_changed_build:
        return {
            **result,
            "state": "available",
            "message": f"\u53d1\u73b0\u540c\u7248\u672c\u65b0\u6784\u5efa {latest_version}\uff0c\u5f53\u524d\u5ba2\u6237\u7aef\u6784\u5efa\u6307\u7eb9\u8f83\u65e7\u3002\u8bf7\u5728\u7248\u672c\u4fe1\u606f\u4e2d\u70b9\u51fb\u201c\u4e0b\u8f7d\u5e76\u6821\u9a8c\u66f4\u65b0\u5305\u201d\uff0c\u6821\u9a8c\u901a\u8fc7\u540e\u70b9\u51fb\u201c\u5b89\u88c5\u5e76\u91cd\u542f\u201d\u3002",
        }
    if version_comparison > 0:
        return {
            **result,
            "state": "available",
            "message": f"发现新版本 {latest_version}，当前版本 {current_version}。请在版本信息中点击“下载并校验更新包”，校验通过后点击“安装并重启”。",
        }
    return {
        **result,
        "state": "current",
        "message": f"当前已是最新版本 {current_version}。",
    }


def validate_release_update_status_ready(update_status: dict) -> dict:
    status = update_status if isinstance(update_status, dict) else {}
    if status.get("state") != "available":
        return status

    package_url = str(status.get("packageUrl") or "").strip()
    if not package_url:
        return {
            **status,
            "ok": False,
            "state": "missing_package_url",
            "message": "发现新版本，但版本清单缺少更新包下载地址。请在 latest.json 中提供 currentPackageUrl、packageUrl 或 packageFile。",
        }

    package_sha256 = str(status.get("packageSha256") or "").strip().upper()
    if not package_sha256:
        return {
            **status,
            "ok": False,
            "state": "missing_package_sha256",
            "message": "发现新版本，但版本清单缺少更新包 SHA256。请在 latest.json 中提供 64 位十六进制 packageSha256。",
        }
    if not is_valid_release_package_sha256(package_sha256):
        return {
            **status,
            "ok": False,
            "state": "invalid_package_sha256",
            "packageSha256": package_sha256,
            "message": "发现新版本，但版本清单中的更新包 SHA256 格式无效。请在 latest.json 中提供 64 位十六进制 packageSha256。",
        }

    return {**status, "packageSha256": package_sha256}


def sanitize_model_profile(profile: dict) -> dict | None:
    safe = profile if isinstance(profile, dict) else {}
    raw_config = safe.get("config") if isinstance(safe.get("config"), dict) else safe
    config = sanitize_model_config(raw_config)
    profile_id = str(safe.get("id") or "").strip()
    if not profile_id:
        profile_id = f"{config.get('provider')}|{config.get('baseUrl')}|{config.get('model')}".strip("|") or "default"
    name = str(safe.get("name") or config.get("provider") or config.get("model") or config.get("baseUrl") or "默认模型 API").strip()
    result = {
        "id": profile_id,
        "name": name,
        "config": config,
    }
    last_test = sanitize_model_profile_test_result(safe.get("lastTest"))
    if last_test:
        result["lastTest"] = last_test
    return result


def sanitize_model_profile_test_result(last_test) -> dict | None:
    safe = last_test if isinstance(last_test, dict) else {}
    if not safe:
        return None
    return {
        "ok": bool(safe.get("ok")),
        "message": str(safe.get("message") or "").strip(),
        "latencyMs": safe_non_negative_int(safe.get("latencyMs"), 0),
        "testedAt": str(safe.get("testedAt") or "").strip(),
    }


def safe_non_negative_int(value, default: int = 0) -> int:
    try:
        return max(0, int(float(value or default)))
    except (TypeError, ValueError):
        return max(0, int(default))


def normalize_terminal_pty_size(value=None, *, cols=None, rows=None) -> dict:
    source = value if isinstance(value, dict) else {}
    raw_cols = cols if cols is not None else source.get("cols", source.get("width", 120))
    raw_rows = rows if rows is not None else source.get("rows", source.get("height", 32))

    def safe_int(raw_value, default):
        try:
            return int(float(raw_value))
        except (TypeError, ValueError):
            return default

    return {
        "cols": min(max(safe_int(raw_cols, 120), 40), 500),
        "rows": min(max(safe_int(raw_rows, 32), 10), 200),
    }


def sanitize_model_profiles(profiles) -> list[dict]:
    sanitized = []
    seen = set()
    for item in profiles if isinstance(profiles, list) else []:
        profile = sanitize_model_profile(item)
        if not profile or profile["id"] in seen:
            continue
        seen.add(profile["id"])
        sanitized.append(profile)
    return sanitized


def app_data_root() -> Path:
    base_dir = os.environ.get("APPDATA") or os.environ.get("LOCALAPPDATA")
    root = Path(base_dir) if base_dir else Path.home() / "AppData" / "Roaming"
    return root / APP_DATA_DIR_NAME


def legacy_app_data_root() -> Path:
    base_dir = os.environ.get("APPDATA") or os.environ.get("LOCALAPPDATA")
    root = Path(base_dir) if base_dir else Path.home() / "AppData" / "Roaming"
    return root / LEGACY_APP_DATA_DIR_NAME


def app_config_path() -> Path:
    return app_data_root() / "config.json"


def legacy_app_config_path() -> Path:
    return legacy_app_data_root() / "config.json"


def migrate_legacy_app_config() -> dict:
    target = app_config_path()
    source = legacy_app_config_path()
    if target.exists() or not source.exists():
        return {"ok": False, "migrated": False, "source": str(source), "target": str(target)}
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    except OSError as error:
        return {"ok": False, "migrated": False, "source": str(source), "target": str(target), "message": str(error)}
    return {"ok": True, "migrated": True, "source": str(source), "target": str(target)}


def credential_store_path() -> Path:
    return app_config_path().parent / "credentials"


def audit_log_path() -> Path:
    return app_config_path().parent / "audit"


def session_log_path() -> Path:
    return app_config_path().parent / "session-logs"


def tool_log_path() -> Path:
    return app_config_path().parent / "tool-logs"


def diagnostic_package_path(created_at: str | None = None) -> Path:
    fallback = time.strftime("%Y%m%d%H%M%S")
    timestamp = re.sub(r"[^0-9]", "", str(created_at or fallback))[:14] or fallback
    return app_config_path().parent / "diagnostic-packages" / f"ssh-agent-diagnostic-{timestamp}.zip"


def server_timeout(server: dict, fallback: int = 10) -> int:
    try:
        timeout = int(str((server if isinstance(server, dict) else {}).get("timeoutSeconds", fallback)).strip())
    except (TypeError, ValueError):
        timeout = fallback
    return min(max(timeout, 3), 60)


def server_retry_count(server: dict, fallback: int = 0) -> int:
    try:
        retry_count = int(str((server if isinstance(server, dict) else {}).get("retryCount", fallback)).strip())
    except (TypeError, ValueError):
        retry_count = fallback
    return min(max(retry_count, 0), 3)


def server_keepalive_seconds(server: dict, fallback: int = 30) -> int:
    try:
        keepalive = int(str((server if isinstance(server, dict) else {}).get("keepaliveSeconds", fallback)).strip())
    except (TypeError, ValueError):
        keepalive = fallback
    if keepalive <= 0:
        return 0
    return min(max(keepalive, 10), 300)


def server_credential_metadata(server: dict, metadata: dict | None = None) -> dict:
    safe_server = server if isinstance(server, dict) else {}
    next_metadata = dict(metadata) if isinstance(metadata, dict) else {}
    auth_type = str(safe_server.get("authType") or "").strip()
    if auth_type:
        next_metadata.setdefault("authType", auth_type)
    identity_file = str(safe_server.get("identityFile") or "").strip()
    if identity_file:
        next_metadata.setdefault("authType", "私钥")
        next_metadata.setdefault("identityFile", identity_file)
    host_key_alias = str(safe_server.get("hostKeyAlias") or "").strip()
    if host_key_alias:
        next_metadata.setdefault("hostKeyAlias", host_key_alias)
    return next_metadata


def ssh_connection_log_context(server: dict, metadata: dict | None = None) -> dict:
    safe_server = server if isinstance(server, dict) else {}
    safe_metadata = metadata if isinstance(metadata, dict) else {}
    trusted_host_key = safe_server.get("trustedHostKey") if isinstance(safe_server.get("trustedHostKey"), dict) else {}
    host_key_trust = safe_server.get("hostKeyTrust") if isinstance(safe_server.get("hostKeyTrust"), dict) else {}
    try:
        port = int(str(safe_server.get("port") or "22").strip())
    except (TypeError, ValueError):
        port = 22
    return {
        "host": str(safe_server.get("ip") or safe_server.get("host") or "").strip(),
        "port": port,
        "user": str(safe_server.get("user") or "root").strip() or "root",
        "authType": str(safe_server.get("authType") or safe_metadata.get("authType") or "").strip(),
        "timeoutSeconds": server_timeout(safe_server),
        "keepaliveSeconds": server_keepalive_seconds(safe_server),
        "retryCount": server_retry_count(safe_server),
        "proxyJump": str(safe_server.get("proxyJump") or "").strip(),
        "hostKeyAlias": str(safe_server.get("hostKeyAlias") or safe_metadata.get("hostKeyAlias") or "").strip(),
        "hostKeyPolicy": "trusted-fingerprint" if str(trusted_host_key.get("sha256") or "").strip() else "prompt-before-trust",
        "trustedHostKeyType": str(trusted_host_key.get("type") or "").strip(),
        "trustedHostKeySha256": str(trusted_host_key.get("sha256") or "").strip(),
        "hostKeyTrustStatus": str(host_key_trust.get("status") or "").strip(),
    }


def classify_ssh_failure(result) -> str:
    if not isinstance(result, dict):
        return "unknown"
    text = " ".join(str(result.get(key) or "") for key in ("message", "error", "stderr", "output")).lower()
    if any(pattern in text for pattern in ("too many authentication failures", "maxauthtries", "agent refused", "sign_and_send_pubkey", "ssh agent")):
        return "agent-auth"
    if any(pattern in text for pattern in ("unprotected private key file", "permissions are too open", "bad permissions", "invalid private key", "error loading key", "private key will be ignored", "key_load_public", "load key")):
        return "key-file"
    if any(pattern in text for pattern in ("no matching", "unable to negotiate", "algorithm", "kexalgorithms", "host key type", "pubkeyacceptedalgorithms", "cipher", "mac algorithm")):
        return "algorithm"
    if any(pattern in text for pattern in ("could not resolve hostname", "getaddrinfo", "name or service", "temporary failure in name resolution", "nodename nor servname", "dns", "11001")):
        return "dns"
    if any(pattern in text for pattern in ("connection refused", "actively refused", "refused", "10061")):
        return "refused"
    if any(pattern in text for pattern in ("timeout", "timed out", "超时", "no route to host", "network is unreachable", "host is unreachable", "destination host unreachable", "ehostunreach", "enetunreach")):
        return "timeout"
    if any(pattern in text for pattern in ("auth", "password", "permission denied", "authentication", "认证", "密码")):
        return "auth"
    if any(pattern in text for pattern in ("host key", "known_hosts", "fingerprint", "主机密钥")):
        return "host-key"
    return "unknown"


def result_failure_kind(result) -> str:
    if not isinstance(result, dict):
        return ""
    failure_kind = result.get("failureKind")
    ssh_failure = result.get("sshFailure")
    if not failure_kind and isinstance(ssh_failure, dict):
        failure_kind = ssh_failure.get("kind")
    if not failure_kind and result.get("ok") is False:
        failure_kind = classify_ssh_failure(result)
    return str(failure_kind or "").strip()


def ssh_tool_log_context(server: dict, metadata: dict | None = None, result=None, extra: dict | None = None) -> dict:
    context = {
        "serverName": session_server_name(server),
        **ssh_connection_log_context(server, metadata),
        "failureKind": result_failure_kind(result) or classify_ssh_failure(result),
    }
    if isinstance(extra, dict):
        context.update(extra)
    return context


def run_with_retries(server: dict, operation):
    attempts = server_retry_count(server) + 1
    result = None
    for _ in range(attempts):
        result = operation()
        if not isinstance(result, dict) or result.get("ok"):
            return result
    return result


def server_without_nested_retries(server: dict) -> dict:
    safe_server = dict(server) if isinstance(server, dict) else {}
    safe_server["retryCount"] = 0
    return safe_server


def log_tool_event(event: dict) -> None:
    try:
        ToolLogger(tool_log_path()).write_event(event if isinstance(event, dict) else {})
    except Exception:
        pass


def log_session_event(event: dict) -> None:
    try:
        SessionLogger(session_log_path()).write_event(event if isinstance(event, dict) else {})
    except Exception:
        pass


def log_tool_result(component: str, action: str, result, context: dict | None = None):
    if isinstance(result, dict) and result.get("ok") is False:
        safe_context = dict(context) if isinstance(context, dict) else {}
        if "failureKind" not in safe_context:
            failure_kind = result.get("failureKind")
            ssh_failure = result.get("sshFailure")
            if not failure_kind and isinstance(ssh_failure, dict):
                failure_kind = ssh_failure.get("kind")
            if failure_kind:
                safe_context["failureKind"] = str(failure_kind)
        log_tool_event(
            {
                "level": "warn",
                "component": component,
                "action": action,
                "message": result.get("message") or result.get("error") or "API 返回失败",
                "context": safe_context,
            }
        )
    return result


_runtime_exception_logging_installed = False
DEFAULT_LOG_RETENTION_DAYS = 30


def detect_webview2_runtime(registry_reader=None, platform: str | None = None) -> dict:
    current_platform = platform or sys.platform
    if current_platform != "win32":
        return {"available": False, "source": "non-windows", "message": "非 Windows 环境，未检测 WebView2 Runtime。"}

    webview2_client_id = r"{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    registry_paths = [
        ("HKEY_CURRENT_USER", rf"Software\Microsoft\EdgeUpdate\Clients\{webview2_client_id}"),
        ("HKEY_LOCAL_MACHINE", rf"Software\Microsoft\EdgeUpdate\Clients\{webview2_client_id}"),
        ("HKEY_LOCAL_MACHINE", rf"Software\WOW6432Node\Microsoft\EdgeUpdate\Clients\{webview2_client_id}"),
    ]

    reader = registry_reader or read_windows_registry_value
    errors = []
    for root, subkey in registry_paths:
        try:
            version = str(reader(root, subkey, "pv") or "").strip()
        except Exception as error:
            errors.append(f"{root}\\{subkey}: {type(error).__name__}")
            continue
        if version:
            return {"available": True, "source": "registry", "version": version, "key": f"{root}\\{subkey}"}

    return {
        "available": False,
        "source": "registry",
        "message": "未检测到 Microsoft Edge WebView2 Runtime。若 EXE 打开后没有界面，请安装 WebView2 Runtime。",
        "checkedKeys": [f"{root}\\{subkey}" for root, subkey in registry_paths],
        "errors": errors[:5],
    }


def read_windows_registry_value(root_name: str, subkey: str, value_name: str):
    import winreg

    roots = {
        "HKEY_CURRENT_USER": winreg.HKEY_CURRENT_USER,
        "HKEY_LOCAL_MACHINE": winreg.HKEY_LOCAL_MACHINE,
    }
    root = roots[root_name]
    with winreg.OpenKey(root, subkey) as key:
        value, _value_type = winreg.QueryValueEx(key, value_name)
        return value


def assert_webview2_runtime_available() -> dict:
    runtime = detect_webview2_runtime()
    if sys.platform == "win32" and not runtime.get("available"):
        message = runtime.get("message") or "未检测到 Microsoft Edge WebView2 Runtime。"
        raise RuntimeError(
            f"{message}\n"
            "请安装 Microsoft Edge WebView2 Runtime 后重新打开 SSH-Agent-Tool.exe：\n"
            "https://go.microsoft.com/fwlink/?LinkId=2124703"
        )
    return runtime


def log_tool_exception(component: str, action: str, error: BaseException, context: dict | None = None) -> dict:
    error_type = type(error).__name__
    trace = "".join(traceback.format_exception(type(error), error, error.__traceback__))
    log_tool_event(
        {
            "level": "error",
            "component": component,
            "action": action,
            "message": f"{error_type}: {error}",
            "error": trace,
            "context": context if isinstance(context, dict) else {},
        }
    )
    return {"ok": False, "message": f"{error_type}: {error}"}


def write_latest_startup_failure_log(error: BaseException, context: dict | None = None) -> Path | None:
    try:
        log_dir = tool_log_path()
        log_dir.mkdir(parents=True, exist_ok=True)
        target = log_dir / "startup-failure-latest.log"
        safe_context = context if isinstance(context, dict) else {}
        repair_advice = build_startup_repair_advice(error, safe_context)
        trace = "".join(traceback.format_exception(type(error), error, error.__traceback__))
        diagnostic_context = redact_sensitive_text(json.dumps(safe_context, ensure_ascii=False, indent=2, default=str))
        lines = [
            "SSH-Agent-Tool 启动失败",
            f"时间: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}",
            f"错误类型: {type(error).__name__}",
            f"错误信息: {redact_sensitive_text(str(error))}",
            "",
            "运行环境:",
            f"- executable: {redact_sensitive_text(str(safe_context.get('executable') or sys.executable))}",
            f"- frozen: {bool(safe_context.get('frozen', getattr(sys, 'frozen', False)))}",
            f"- resourceRoot: {redact_sensitive_text(str(safe_context.get('resourceRoot') or resource_root()))}",
            f"- cwd: {redact_sensitive_text(str(Path.cwd()))}",
            f"- toolLogDir: {redact_sensitive_text(str(log_dir))}",
            "",
            "建议处理:",
            *[f"{index + 1}. {item}" for index, item in enumerate(repair_advice)],
            "",
            "startup diagnostics:",
            diagnostic_context,
            "",
            "异常堆栈:",
            redact_sensitive_text(trace),
            "",
            "说明: 这是 Windows 图形客户端启动失败日志。正常使用时请直接双击 SSH-Agent-Tool.exe。",
        ]
        target.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
        return target
    except Exception:
        return None


def latest_startup_failure_log_info() -> dict:
    path = tool_log_path() / "startup-failure-latest.log"
    result = {"path": str(path), "exists": False, "size": 0, "updatedAt": ""}
    try:
        if not path.exists():
            return result
        stat = path.stat()
        result.update(
            {
                "exists": True,
                "size": stat.st_size,
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stat.st_mtime)),
            }
        )
        known_issue = classify_known_startup_failure(path.read_text(encoding="utf-8", errors="replace"))
        if known_issue:
            result.update(known_issue)
    except OSError:
        return result
    return result


def classify_known_startup_failure(text: str) -> dict:
    safe_text = str(text or "")
    stale_signatures = [
        "Power is not defined",
        "ReferenceError: Power",
        "index-BCGy_mkD.js",
        "index-C55DkVKK.js",
        "exportConnectionCheckReport is not defined",
    ]
    for signature in stale_signatures:
        if signature in safe_text:
            return {
                "knownIssue": "stale_frontend_bundle",
                "knownSignature": signature,
                "knownAdvice": "检测到旧版前端资源或旧安装包，请重新下载并完整解压最新版 ZIP 后运行 SSH-Agent-Tool.exe。",
            }
    return {}


def build_startup_repair_advice(error: BaseException | None = None, context: dict | None = None) -> list[str]:
    safe_context = context if isinstance(context, dict) else {}
    error_text = str(error or safe_context.get("error") or "").lower()
    raw_error = str(error or "")
    advice: list[str] = []

    known_issue = classify_known_startup_failure("\n".join([raw_error, str(safe_context)]))
    if known_issue.get("knownIssue") == "stale_frontend_bundle":
        advice.append(known_issue["knownAdvice"])

    webview2 = safe_context.get("webView2Runtime") if isinstance(safe_context.get("webView2Runtime"), dict) else {}
    if sys.platform == "win32" and webview2.get("available") is False:
        advice.append("安装 Microsoft Edge WebView2 Runtime 后重新打开 SSH-Agent-Tool.exe：https://go.microsoft.com/fwlink/?LinkId=2124703")
    elif "webview2" in error_text or "edge runtime" in error_text or "webview runtime" in error_text:
        advice.append("检查 Microsoft Edge WebView2 Runtime 是否完整安装；安装或修复后重新打开客户端。")

    if safe_context.get("uiIndexExists") is False:
        advice.append("UI 入口文件缺失，请重新解压最新版 ZIP，确认 dist/index.html 与 assets 目录都在同一客户端目录内。")

    frontend_assets = safe_context.get("frontendAssets") if isinstance(safe_context.get("frontendAssets"), dict) else {}
    if frontend_assets and frontend_assets.get("ok") is False:
        advice.append("前端资源不完整或损坏，请重新下载并完整解压 ZIP，不要在压缩包预览窗口里直接运行 EXE。")

    client_entry = safe_context.get("clientEntry") if isinstance(safe_context.get("clientEntry"), dict) else {}
    if client_entry and client_entry.get("ok") is False:
        entry_message = str(client_entry.get("message") or "").strip()
        if entry_message:
            advice.append(entry_message)

    executable_mode = safe_context.get("executableMode") if isinstance(safe_context.get("executableMode"), dict) else {}
    if executable_mode and executable_mode.get("consoleWindow") is True:
        advice.append("当前 EXE 不是正常 Windows 图形客户端，请使用 release/用户交付/SSH-Agent-Tool.exe 或最新版交付 ZIP。")

    if "permission" in error_text or "access is denied" in error_text or "拒绝访问" in raw_error:
        advice.append("检查客户端目录和用户数据目录是否可写，建议解压到桌面、下载目录或普通工作目录后再运行。")

    if not advice:
        advice.append("先完整解压最新版 Windows 客户端 ZIP，再双击 SSH-Agent-Tool.exe；不要从压缩包预览窗口直接运行。")
    advice.append("如果仍无法打开，请把 startup-failure-latest.log 和工具内导出的诊断包一起反馈。")
    return advice


SFTP_ACTION_LABELS = {
    "list_directory": "目录读取",
    "download_file": "文件下载",
    "read_text_file": "文件预览",
    "write_text_file": "文件保存",
    "upload_file": "文件上传",
    "create_directory": "目录创建",
    "create_file": "文件创建",
    "rename_path": "重命名",
    "delete_path": "删除",
}


def sftp_exception_result(action: str, context: dict | None = None) -> dict:
    safe_context = context if isinstance(context, dict) else {}
    fields = {
        key: value
        for key, value in safe_context.items()
        if key in {"remotePath", "localPath", "parentPath", "directoryName", "fileName", "newName", "itemType", "encoding", "contentLength"}
    }
    label = SFTP_ACTION_LABELS.get(action, "操作")
    return {
        "ok": False,
        **fields,
        "message": f"SFTP {label}失败，请查看工具日志。",
    }


def sftp_tool_log_context(server: dict, context: dict | None = None) -> dict:
    safe_context = context if isinstance(context, dict) else {}
    return {
        "serverName": session_server_name(server),
        **ssh_connection_log_context(server),
        **safe_context,
    }


def split_sftp_full_path(remote_path: str) -> tuple[str, str]:
    normalized = str(remote_path or "").strip().replace("\\", "/")
    name = posixpath.basename(normalized.rstrip("/"))
    parent = posixpath.dirname(normalized.rstrip("/")) or "/"
    return parent, name


def sftp_name_from_path_or_name(value: str) -> str:
    text = str(value or "").strip().replace("\\", "/")
    if "/" not in text:
        return text
    return posixpath.basename(text.rstrip("/"))


def run_sftp_desktop_operation(server: dict, credential_ref: str, action: str, context: dict, operation):
    safe_server = server if isinstance(server, dict) else {}
    safe_context = context if isinstance(context, dict) else {}
    log_context = sftp_tool_log_context(safe_server, safe_context)
    try:
        store = CredentialStore(credential_store_path())
        password = store.read_secret(credential_ref) if credential_ref else ""
        metadata = store.read_metadata(credential_ref) if credential_ref else {}
        metadata = server_credential_metadata(safe_server, metadata)
        result = run_with_retries(safe_server, lambda: operation(safe_server, password, metadata))
    except Exception as error:
        log_tool_exception("sftp", action, error, log_context)
        result = sftp_exception_result(action, safe_context)
    return log_tool_result("sftp", action, result, log_context)


class DesktopSftpTransferJob:
    def __init__(self, direction: str, context: dict | None = None):
        self.id = uuid.uuid4().hex
        self.direction = direction
        self.context = context if isinstance(context, dict) else {}
        self.status = "running"
        self.progress = 0.0
        self.bytes_transferred = 0
        self.total_bytes = None
        self.result = None
        self.error = ""
        self.created_at = time.strftime("%Y-%m-%dT%H:%M:%S")
        self.updated_at = self.created_at
        self.cancel_event = threading.Event()

    def touch(self):
        self.updated_at = time.strftime("%Y-%m-%dT%H:%M:%S")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "direction": self.direction,
            "status": self.status,
            "done": self.status in {"success", "failed", "canceled"},
            "progress": self.progress,
            "bytesTransferred": self.bytes_transferred,
            "totalBytes": self.total_bytes,
            "result": self.result,
            "error": self.error,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            **self.context,
        }


class DesktopSftpTransferJobManager:
    def __init__(self):
        self._jobs = {}
        self._lock = threading.Lock()

    def start(self, direction: str, context: dict, worker):
        job = DesktopSftpTransferJob(direction, context)
        with self._lock:
            self._jobs[job.id] = job
            self._evict_locked()
        thread = threading.Thread(target=self._run, args=(job, worker), daemon=True)
        thread.start()
        return job.to_dict()

    def _run(self, job: DesktopSftpTransferJob, worker):
        try:
            result = worker(job.cancel_event, lambda transferred, total: self.update_progress(job.id, transferred, total))
            with self._lock:
                current = self._jobs.get(job.id)
                if not current or current.status == "canceled":
                    return
                current.result = result if isinstance(result, dict) else {"ok": False, "message": str(result)}
                if current.cancel_event.is_set() or current.result.get("cancelled"):
                    current.status = "canceled"
                    current.error = current.result.get("message") or "传输任务已取消"
                elif current.result.get("ok"):
                    current.status = "success"
                    current.progress = 100.0
                else:
                    current.status = "failed"
                    current.error = current.result.get("message") or "传输失败"
                current.touch()
        except Exception as error:
            with self._lock:
                current = self._jobs.get(job.id)
                if not current or current.status == "canceled":
                    return
                current.status = "failed"
                current.error = str(error)
                current.result = {"ok": False, "message": str(error)}
                current.touch()

    def update_progress(self, job_id: str, transferred: int, total: int):
        with self._lock:
            job = self._jobs.get(job_id)
            if not job or job.status == "canceled":
                return
            job.bytes_transferred = max(0, int(transferred or 0))
            job.total_bytes = max(0, int(total or 0))
            job.progress = round((job.bytes_transferred / job.total_bytes) * 100, 1) if job.total_bytes else 0.0
            job.touch()

    def get(self, job_id: str):
        with self._lock:
            job = self._jobs.get(job_id)
            return job.to_dict() if job else None

    def cancel(self, job_id: str):
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            if job.status not in {"success", "failed", "canceled"}:
                job.cancel_event.set()
                job.status = "canceled"
                job.error = "传输任务已取消"
                if not isinstance(job.result, dict):
                    job.result = {"ok": False, "cancelled": True, "message": "传输任务已取消"}
                job.touch()
            return job.to_dict()

    def cancel_active(self):
        cancelled = []
        with self._lock:
            for job in list(self._jobs.values()):
                if job.status in {"success", "failed", "canceled"}:
                    continue
                job.cancel_event.set()
                job.status = "canceled"
                job.error = "传输任务已取消"
                if not isinstance(job.result, dict):
                    job.result = {"ok": False, "cancelled": True, "message": "传输任务已取消"}
                job.touch()
                cancelled.append(job.to_dict())
        return cancelled

    def _evict_locked(self):
        if len(self._jobs) <= 100:
            return
        finished = [job for job in self._jobs.values() if job.status in {"success", "failed", "canceled"}]
        finished.sort(key=lambda item: item.updated_at)
        for job in finished[: len(self._jobs) - 100]:
            self._jobs.pop(job.id, None)


SFTP_TRANSFER_JOBS = DesktopSftpTransferJobManager()


def build_startup_failure_context(context: dict | None = None) -> dict:
    manifest_path = release_manifest_path()
    ui_path = ui_index_path()
    release_manifest = safe_startup_release_manifest(manifest_path)
    result = {
        "pid": os.getpid(),
        "python": sys.version.split()[0],
        "frozen": bool(getattr(sys, "frozen", False)),
        "executable": sys.executable,
        "resourceRoot": str(resource_root()),
        "cwd": str(Path.cwd()),
        "appDataRoot": str(app_data_root()),
        "toolLogDir": str(tool_log_path()),
        "sessionLogDir": str(session_log_path()),
        "releaseVersion": str(release_manifest.get("version") or "dev"),
        "releaseExecutable": str(release_manifest.get("executable") or ""),
        "releaseManifestPath": str(manifest_path),
        "releaseManifestExists": bool(manifest_path.exists()),
        "uiIndexPath": str(ui_path),
        "uiIndexExists": bool(ui_path.exists()),
        "frontendAssets": inspect_frontend_assets(ui_path),
        "executableMode": describe_executable_client_mode(),
        "clientEntry": build_client_entry_diagnostics(
            manifest_path=manifest_path,
            ui_index_path=ui_path,
        ),
        "argv": [str(item) for item in sys.argv[:8]],
        "webView2Runtime": detect_webview2_runtime(),
        **(context if isinstance(context, dict) else {}),
    }
    result["startupRepairAdvice"] = build_startup_repair_advice(context=result)
    return result


def log_app_startup(context: dict | None = None) -> None:
    manifest_path = release_manifest_path()
    ui_path = ui_index_path()
    release_manifest = safe_startup_release_manifest(manifest_path)
    frontend_assets = inspect_frontend_assets(ui_path)
    log_retention = prune_startup_logs()
    runtime_context = {
        "pid": os.getpid(),
        "python": sys.version.split()[0],
        "frozen": bool(getattr(sys, "frozen", False)),
        "executable": sys.executable,
        "cwd": str(Path.cwd()),
        "appDataRoot": str(app_data_root()),
        "toolLogDir": str(tool_log_path()),
        "sessionLogDir": str(session_log_path()),
        "releaseVersion": str(release_manifest.get("version") or "dev"),
        "releaseExecutable": str(release_manifest.get("executable") or ""),
        "releaseManifestPath": str(manifest_path),
        "releaseManifestExists": bool(manifest_path.exists()),
        "uiIndexPath": str(ui_path),
        "uiIndexExists": bool(ui_path.exists()),
        "frontendAssets": frontend_assets,
        "executableMode": describe_executable_client_mode(),
        "clientEntry": build_client_entry_diagnostics(
            manifest_path=manifest_path,
            ui_index_path=ui_path,
        ),
        "argv": [str(item) for item in sys.argv[:8]],
        "webView2Runtime": detect_webview2_runtime(),
        "logRetention": log_retention,
        **(context if isinstance(context, dict) else {}),
    }
    log_tool_event({"level": "info", "component": "app", "action": "app_start", "message": "应用启动", "context": runtime_context})


def prune_startup_logs(keep_days: int = DEFAULT_LOG_RETENTION_DAYS) -> dict:
    summary = {"keepDays": keep_days}
    try:
        summary["toolLogs"] = delete_old_tool_logs(tool_log_path(), keep_days)
    except Exception as error:
        summary["toolLogs"] = {"ok": False, "message": str(error), "keepDays": keep_days}
    try:
        summary["sessionLogs"] = delete_old_session_logs(session_log_path(), keep_days)
    except Exception as error:
        summary["sessionLogs"] = {"ok": False, "message": str(error), "keepDays": keep_days}
    return summary


def safe_startup_release_manifest(path: Path) -> dict:
    try:
        if not path.exists() or not path.is_file():
            return {}
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    return {
        "version": str(data.get("version") or "").strip(),
        "executable": str(data.get("executable") or "").strip(),
    }


def install_runtime_exception_logging() -> None:
    global _runtime_exception_logging_installed
    if _runtime_exception_logging_installed:
        return

    original_excepthook = sys.excepthook

    def handle_exception(exc_type, exc_value, exc_traceback):
        if exc_type not in (KeyboardInterrupt, SystemExit):
            log_tool_exception("runtime", "uncaught_exception", exc_value, {"exceptionType": getattr(exc_type, "__name__", str(exc_type))})
        original_excepthook(exc_type, exc_value, exc_traceback)

    sys.excepthook = handle_exception

    if hasattr(threading, "excepthook"):
        original_threading_excepthook = threading.excepthook

        def handle_thread_exception(args):
            if args.exc_type not in (KeyboardInterrupt, SystemExit):
                log_tool_exception(
                    "runtime",
                    "thread_exception",
                    args.exc_value,
                    {
                        "exceptionType": getattr(args.exc_type, "__name__", str(args.exc_type)),
                        "threadName": getattr(args.thread, "name", ""),
                    },
                )
            original_threading_excepthook(args)

        threading.excepthook = handle_thread_exception

    if hasattr(sys, "unraisablehook"):
        original_unraisablehook = sys.unraisablehook

        def handle_unraisable_exception(args):
            exc_type = getattr(args, "exc_type", None)
            exc_value = getattr(args, "exc_value", None)
            if exc_type not in (KeyboardInterrupt, SystemExit) and isinstance(exc_value, BaseException):
                log_tool_exception(
                    "runtime",
                    "unraisable_exception",
                    exc_value,
                    {
                        "exceptionType": getattr(exc_type, "__name__", str(exc_type)),
                        "errMsg": str(getattr(args, "err_msg", "") or ""),
                        "object": str(getattr(args, "object", "") or ""),
                    },
                )
            original_unraisablehook(args)

        sys.unraisablehook = handle_unraisable_exception

    _runtime_exception_logging_installed = True


def session_server_name(server: dict) -> str:
    safe_server = server if isinstance(server, dict) else {}
    return str(
        safe_server.get("name")
        or safe_server.get("label")
        or safe_server.get("host")
        or safe_server.get("ip")
        or ""
    ).strip()


def session_result_output(result) -> str:
    if not isinstance(result, dict):
        return ""
    output = result.get("output")
    if output is None:
        output = "\n".join(str(value or "") for value in (result.get("stdout"), result.get("stderr")) if value is not None)
    text = str(output or "")
    if len(text) > 12000:
        return text[:12000] + "\n[输出过长，已截断]"
    return text


SSH_SESSION_ACTION_LABELS = {
    "open_session": "连接会话",
    "send_command": "发送命令",
    "interrupt_command": "发送 Ctrl+C",
    "send_input": "发送交互输入",
    "resize_session": "调整终端窗口",
    "read_output": "读取终端输出",
    "check_session_health": "检查会话状态",
    "close_session": "关闭会话",
}


def ssh_session_exception_result(action: str, session_id: str = "", extra: dict | None = None) -> dict:
    fields = extra if isinstance(extra, dict) else {}
    label = SSH_SESSION_ACTION_LABELS.get(action, "执行操作")
    return {
        "ok": False,
        "sessionId": session_id,
        **fields,
        "message": f"SSH {label}失败，请查看会话日志或工具日志。",
    }


SSH_OPERATION_ACTION_LABELS = {
    "test_connection": "连接探测",
    "test_login": "登录测试",
    "readonly_command": "命令执行",
}


def ssh_operation_exception_result(action: str, extra: dict | None = None) -> dict:
    fields = extra if isinstance(extra, dict) else {}
    label = SSH_OPERATION_ACTION_LABELS.get(action, "操作")
    return {
        "ok": False,
        **fields,
        "message": f"SSH {label}失败，请查看工具日志。",
    }


PORT_FORWARD_ACTION_LABELS = {
    "start_forward": "启动",
    "stop_forward": "停止",
    "list_forwards": "读取列表",
}


def port_forward_exception_result(action: str, extra: dict | None = None) -> dict:
    fields = extra if isinstance(extra, dict) else {}
    label = PORT_FORWARD_ACTION_LABELS.get(action, "操作")
    return {
        "ok": False,
        **fields,
        "message": f"端口转发{label}失败，请查看工具日志。",
    }


MODEL_API_ACTION_LABELS = {
    "save_api_key": "保存 API Key",
    "chat": "聊天调用",
    "test_connection": "连接测试",
    "list_models": "获取模型列表",
}


def model_api_exception_result(action: str, extra: dict | None = None) -> dict:
    fields = extra if isinstance(extra, dict) else {}
    label = MODEL_API_ACTION_LABELS.get(action, "调用")
    return {
        "ok": False,
        **fields,
        "message": f"模型 API {label}失败，请查看工具日志。",
    }


def model_api_log_context(model_config: dict | None) -> dict:
    config = sanitize_model_config(model_config)
    headers = config.get("extraHeaders") if isinstance(config.get("extraHeaders"), list) else []
    return {
        "model": {
            "provider": config.get("provider", ""),
            "baseUrl": config.get("baseUrl", ""),
            "model": config.get("model", ""),
            "hasApiKey": bool(config.get("hasApiKey")),
            "extraHeaderNames": [
                str(header.get("name") or "").strip()
                for header in headers
                if isinstance(header, dict) and str(header.get("name") or "").strip()
            ],
        }
    }


def model_api_result_diagnostics(result) -> dict:
    safe_result = result if isinstance(result, dict) else {}
    diagnostics: dict = {}
    if isinstance(safe_result.get("models"), list):
        diagnostics["modelCount"] = len(safe_result.get("models") or [])
    used_endpoint = str(safe_result.get("usedEndpoint") or "").strip()
    if used_endpoint:
        diagnostics["usedEndpoint"] = used_endpoint
    attempted = safe_result.get("attemptedEndpoints")
    if isinstance(attempted, list):
        diagnostics["attemptedEndpoints"] = [
            str(endpoint or "").strip()
            for endpoint in attempted
            if str(endpoint or "").strip()
        ]
    last_error = str(safe_result.get("lastError") or "").strip()
    if last_error:
        diagnostics["lastError"] = redact_sensitive_text(last_error)
    return diagnostics


def log_model_api_result(action: str, result, model_config: dict | None):
    safe_result = result if isinstance(result, dict) else {}
    context = model_api_log_context(model_config)
    diagnostics = model_api_result_diagnostics(safe_result)
    if diagnostics:
        context["result"] = diagnostics
    log_tool_event(
        {
            "level": "info" if safe_result.get("ok") else "warn",
            "component": "model-api",
            "action": action,
            "message": safe_result.get("message") or MODEL_API_ACTION_LABELS.get(action, "model api call"),
            "context": context,
        }
    )
    return result


def sanitize_mcp_settings(settings: dict | None) -> dict:
    source = settings if isinstance(settings, dict) else {}
    prometheus = source.get("prometheus") if isinstance(source.get("prometheus"), dict) else {}
    cmdb = source.get("cmdb") if isinstance(source.get("cmdb"), dict) else {}
    return {
        "prometheus": {
            "baseUrl": str(prometheus.get("baseUrl") or source.get("prometheusUrl") or "").strip(),
            "token": str(prometheus.get("token") or source.get("prometheusToken") or "").strip(),
        },
        "cmdb": {
            "baseUrl": str(cmdb.get("baseUrl") or source.get("cmdbUrl") or "").strip(),
            "token": str(cmdb.get("token") or source.get("cmdbToken") or "").strip(),
        },
    }


def call_builtin_mcp_connector(endpoint: str, requests: list, timeout: int = 15, headers=None, config=None) -> dict:
    safe_endpoint = str(endpoint or "").strip()
    if safe_endpoint == "mcp://prometheus":
        return call_builtin_prometheus_mcp(requests, timeout=timeout, headers=headers, config=config)
    return {
        "ok": False,
        "endpoint": safe_endpoint,
        "connector": "",
        "results": [],
        "message": f"暂未配置内置 MCP 连接器：{safe_endpoint}",
    }


def mcp_call_log_context(endpoint: str, requests=None, timeout: int = 15, headers=None) -> dict:
    safe_headers = headers if isinstance(headers, list) else []
    header_names = []
    for item in safe_headers:
        if not isinstance(item, dict) or item.get("enabled") is False:
            continue
        name = str(item.get("name") or "").strip()
        if name:
            header_names.append(name)
    return {
        "endpoint": str(endpoint or "").strip(),
        "requestCount": len(requests if isinstance(requests, list) else []),
        "timeout": timeout,
        "headerNames": header_names,
    }


def log_mcp_call_result(action: str, result, context: dict | None = None):
    safe_result = result if isinstance(result, dict) else {}
    log_tool_event(
        {
            "level": "info" if safe_result.get("ok") else "warn",
            "component": "mcp",
            "action": action,
            "message": safe_result.get("message") or ("MCP 调用完成" if safe_result.get("ok") else "MCP 调用失败"),
            "context": context if isinstance(context, dict) else {},
        }
    )
    return result


def call_builtin_prometheus_mcp(requests: list, timeout: int = 15, headers=None, config=None) -> dict:
    settings = sanitize_mcp_settings((config if isinstance(config, dict) else {}).get("mcpSettings"))
    prometheus = settings.get("prometheus", {})
    base_url = str(prometheus.get("baseUrl") or os.environ.get("SSH_AGENT_PROMETHEUS_URL") or "").strip()
    token = str(prometheus.get("token") or extract_bearer_token(headers) or os.environ.get("SSH_AGENT_PROMETHEUS_TOKEN") or "").strip()
    safe_requests = requests if isinstance(requests, list) else []
    if not base_url:
        return {
            "ok": False,
            "endpoint": "mcp://prometheus",
            "connector": "prometheus",
            "results": [],
            "message": "Prometheus MCP 尚未配置。请在配置中设置 mcpSettings.prometheus.baseUrl，或设置 SSH_AGENT_PROMETHEUS_URL。",
        }

    results = []
    for index, item in enumerate(safe_requests):
        request_item = item if isinstance(item, dict) else {}
        params = request_item.get("params") if isinstance(request_item.get("params"), dict) else {}
        query = str(params.get("query") or "").strip()
        range_text = str(params.get("range") or "").strip()
        label = str(request_item.get("label") or request_item.get("tool") or f"prometheus-{index + 1}")
        if not query:
            results.append(
                {
                    "ok": False,
                    "label": label,
                    "method": str(request_item.get("tool") or "query"),
                    "status": 0,
                    "query": "",
                    "range": range_text,
                    "response": None,
                    "message": "Prometheus 查询语句为空。",
                }
            )
            continue
        result = query_builtin_prometheus(base_url, query, timeout=timeout, token=token, range_text=range_text)
        results.append(
            {
                "ok": bool(result.get("ok")),
                "label": label,
                "method": str(request_item.get("tool") or "query"),
                "status": int(result.get("status") or 0),
                "query": query,
                "range": range_text,
                "response": result.get("response"),
                "message": "桌面快捷方式已创建。",
            }
        )

    ok_count = sum(1 for item in results if item.get("ok"))
    total = len(results)
    return {
        "ok": total > 0 and ok_count == total,
        "endpoint": "mcp://prometheus",
        "connector": "prometheus",
        "results": results,
        "message": f"Prometheus MCP 调用完成：{ok_count}/{total} 个请求成功。",
    }


def query_builtin_prometheus(base_url: str, query: str, timeout: int = 15, token: str = "", range_text: str = "") -> dict:
    safe_base_url = str(base_url or "").strip().rstrip("/")
    endpoint = safe_base_url if safe_base_url.endswith("/api/v1/query") else f"{safe_base_url}/api/v1/query"
    url = f"{endpoint}?{urllib.parse.urlencode({'query': str(query or '').strip()})}"
    request_headers = {"Accept": "application/json"}
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    try:
        request = urllib.request.Request(url, headers=request_headers, method="GET")
        with urllib.request.urlopen(request, timeout=max(3, min(int(timeout or 15), 60))) as response:
            status = int(getattr(response, "status", getattr(response, "code", 200)) or 200)
            text = response.read().decode("utf-8", errors="replace")
            payload = json.loads(text) if text.strip() else {}
        return {
            "ok": 200 <= status < 300 and not payload.get("error"),
            "status": status,
            "query": query,
            "range": range_text,
            "response": payload,
            "message": "ok" if 200 <= status < 300 else f"HTTP {status}",
        }
    except Exception as error:
        return {
            "ok": False,
            "status": 0,
            "query": query,
            "range": range_text,
            "response": None,
            "message": f"Prometheus 查询失败：{error}",
        }


def extract_bearer_token(headers=None) -> str:
    for item in headers if isinstance(headers, list) else []:
        if not isinstance(item, dict) or item.get("enabled") is False:
            continue
        name = str(item.get("name") or "").strip().lower()
        value = str(item.get("value") or "").strip()
        if name == "authorization" and value.lower().startswith("bearer "):
            return value[7:].strip()
    return ""


class DesktopApi:
    _active_cli_runs = {}
    _active_mcp_runs = {}

    def __init__(self):
        self._ssh_sessions = None
        self._port_forwards = None
        self._session_servers = {}

    def ssh_sessions(self):
        if self._ssh_sessions is None:
            self._ssh_sessions = SshSessionManager()
        return self._ssh_sessions

    def port_forwards(self):
        if self._port_forwards is None:
            self._port_forwards = PortForwardManager()
        return self._port_forwards

    def shutdown_runtime(self, reason: str = "window_closed"):
        safe_reason = str(reason or "window_closed").strip() or "window_closed"
        session_ids = self._known_ssh_session_ids()
        closed_sessions = 0
        failed_sessions = []

        for session_id in session_ids:
            result = self.close_ssh_session(session_id)
            if isinstance(result, dict) and result.get("ok"):
                closed_sessions += 1
            else:
                failed_sessions.append(session_id)

        port_forward_ids = self._known_port_forward_ids()
        closed_port_forwards = 0
        failed_port_forwards = []
        for forward_id in port_forward_ids:
            result = self.stop_port_forward(forward_id)
            if isinstance(result, dict) and result.get("ok"):
                closed_port_forwards += 1
            else:
                failed_port_forwards.append(forward_id)

        cancelled_cli_run_ids = self._cancel_active_runner_events(type(self)._active_cli_runs)
        cancelled_mcp_run_ids = self._cancel_active_runner_events(type(self)._active_mcp_runs)
        cancelled_sftp_transfers = self._cancel_active_sftp_transfers()
        cancelled_sftp_transfer_ids = [
            str(item.get("id") or "").strip()
            for item in cancelled_sftp_transfers
            if isinstance(item, dict) and str(item.get("id") or "").strip()
        ]

        log_tool_event(
            {
                "level": "info" if not failed_sessions and not failed_port_forwards else "warn",
                "component": "app",
                "action": "app_shutdown",
                "message": "应用关闭，已清理运行时资源。",
                "context": {
                    "reason": safe_reason,
                    "closedSessions": closed_sessions,
                    "failedSessions": len(failed_sessions),
                    "failedSessionIds": failed_sessions[:20],
                    "closedPortForwards": closed_port_forwards,
                    "failedPortForwards": len(failed_port_forwards),
                    "failedPortForwardIds": failed_port_forwards[:20],
                    "cancelledCliRuns": len(cancelled_cli_run_ids),
                    "cancelledCliRunIds": cancelled_cli_run_ids[:20],
                    "cancelledMcpRuns": len(cancelled_mcp_run_ids),
                    "cancelledMcpRunIds": cancelled_mcp_run_ids[:20],
                    "cancelledSftpTransfers": len(cancelled_sftp_transfer_ids),
                    "cancelledSftpTransferIds": cancelled_sftp_transfer_ids[:20],
                },
            }
        )
        return {
            "ok": not failed_sessions and not failed_port_forwards,
            "reason": safe_reason,
            "closedSessions": closed_sessions,
            "failedSessions": len(failed_sessions),
            "failedSessionIds": failed_sessions[:20],
            "closedPortForwards": closed_port_forwards,
            "failedPortForwards": len(failed_port_forwards),
            "failedPortForwardIds": failed_port_forwards[:20],
            "cancelledCliRuns": len(cancelled_cli_run_ids),
            "cancelledCliRunIds": cancelled_cli_run_ids[:20],
            "cancelledMcpRuns": len(cancelled_mcp_run_ids),
            "cancelledMcpRunIds": cancelled_mcp_run_ids[:20],
            "cancelledSftpTransfers": len(cancelled_sftp_transfer_ids),
            "cancelledSftpTransferIds": cancelled_sftp_transfer_ids[:20],
        }

    def _known_ssh_session_ids(self) -> list[str]:
        ids = [str(session_id) for session_id in self._session_servers.keys() if str(session_id)]
        manager = self._ssh_sessions
        sessions = getattr(manager, "sessions", None) if manager is not None else None
        if isinstance(sessions, dict):
            ids.extend(str(session_id) for session_id in sessions.keys() if str(session_id))
        return list(dict.fromkeys(ids))

    def _known_port_forward_ids(self) -> list[str]:
        manager = self._port_forwards
        forwards = getattr(manager, "forwards", None) if manager is not None else None
        if not isinstance(forwards, dict):
            return []
        return [str(forward_id) for forward_id in forwards.keys() if str(forward_id)]

    def _cancel_active_runner_events(self, active_runs: dict) -> list[str]:
        if not isinstance(active_runs, dict):
            return []
        cancelled_ids = []
        for run_id, cancel_event in list(active_runs.items()):
            safe_run_id = str(run_id or "").strip()
            if not safe_run_id:
                active_runs.pop(run_id, None)
                continue
            try:
                cancel_event.set()
            except Exception:
                pass
            active_runs.pop(run_id, None)
            cancelled_ids.append(safe_run_id)
        return cancelled_ids

    def _cancel_active_sftp_transfers(self) -> list[dict]:
        try:
            cancel_active = getattr(SFTP_TRANSFER_JOBS, "cancel_active", None)
            if not callable(cancel_active):
                return []
            result = cancel_active()
            return result if isinstance(result, list) else []
        except Exception:
            return []

    def ping(self) -> str:
        return "ok"

    def read_release_manifest(self):
        manifest_path = release_manifest_path()
        if not manifest_path.exists():
            return merge_release_manifest_with_local_latest(read_embedded_release_manifest())
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError) as error:
            embedded = read_embedded_release_manifest()
            if str(embedded.get("version") or "dev").strip() != "dev":
                embedded = dict(embedded)
                embedded["message"] = f"manifest.json 读取失败，已使用 EXE 内置版本信息：{error}"
                return merge_release_manifest_with_local_latest(embedded)
            return default_release_manifest(f"读取版本清单失败：{error}")
        return sanitize_release_manifest(data)

    def read_runtime_diagnostics(self):
        ui_path = ui_index_path()
        manifest = self.read_release_manifest()
        frontend_assets = inspect_frontend_assets(ui_path)
        executable_mode = describe_executable_client_mode()
        result = {
            "ok": True,
            "pid": os.getpid(),
            "python": sys.version.split()[0],
            "platform": sys.platform,
            "frozen": bool(getattr(sys, "frozen", False)),
            "executable": sys.executable,
            "executableDirectory": str(Path(sys.executable).expanduser().resolve().parent),
            "cwd": str(Path.cwd()),
            "appDataRoot": str(app_data_root()),
            "toolLogDir": str(tool_log_path()),
            "sessionLogDir": str(session_log_path()),
            "resourceRoot": str(resource_root()),
            "uiIndexPath": str(ui_path),
            "uiIndexExists": bool(ui_path.exists()),
            "frontendAssets": frontend_assets,
            "executableMode": executable_mode,
            "startupIdentity": build_startup_identity(manifest, frontend_assets, executable_mode),
            "clientEntry": build_client_entry_diagnostics(
                manifest_path=release_manifest_path(),
                ui_index_path=ui_path,
            ),
            "commandLineLaunchers": inspect_command_line_launchers(),
            "webView2Runtime": detect_webview2_runtime(),
            "startupFailureLog": latest_startup_failure_log_info(),
        }
        result["startupRepairAdvice"] = build_startup_repair_advice(context=result)
        return result

    def read_release_update_status(self):
        status_path = release_update_status_path()
        default_log_path = status_path.parent / "release-updater.log"
        if not status_path.exists():
            return {
                "ok": False,
                "state": "no_status",
                "statusPath": str(status_path),
                "logPath": str(default_log_path),
                "message": "还没有本机更新执行记录。",
            }
        try:
            data = json.loads(status_path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError) as error:
            return {
                "ok": False,
                "state": "invalid_status",
                "statusPath": str(status_path),
                "logPath": str(default_log_path),
                "message": f"读取更新状态失败：{error}",
            }
        safe_data = data if isinstance(data, dict) else {}
        state = str(safe_data.get("status") or safe_data.get("state") or "unknown").strip() or "unknown"
        message = str(safe_data.get("message") or "更新状态文件没有记录说明。").strip()
        log_path = str(safe_data.get("logPath") or default_log_path).strip()
        return {
            "ok": state in {"downloaded", "ready", "running", "completed", "failed"},
            "state": state,
            "message": message,
            "updatedAt": str(safe_data.get("updatedAt") or "").strip(),
            "localPath": str(safe_data.get("localPath") or safe_data.get("packageZip") or safe_data.get("packagePath") or "").strip(),
            "packageZip": str(safe_data.get("packageZip") or safe_data.get("packagePath") or safe_data.get("localPath") or "").strip(),
            "packageUrl": str(safe_data.get("packageUrl") or "").strip(),
            "scriptPath": str(safe_data.get("scriptPath") or "").strip(),
            "targetRoot": str(safe_data.get("targetRoot") or "").strip(),
            "sha256": str(safe_data.get("sha256") or "").strip(),
            "expectedSha256": str(safe_data.get("expectedSha256") or "").strip(),
            "statusPath": str(status_path),
            "logPath": log_path,
        }

    def create_desktop_shortcut(self, request=None):
        manifest = self.read_release_manifest()
        package_root = release_manifest_path().parent
        executable = str(manifest.get("executable") or "SSH-Agent-Tool.exe").strip() or "SSH-Agent-Tool.exe"
        exe_path = package_root / Path(executable).name
        shortcut_name = "SSH-Agent-Tool.lnk"
        safe_request = request if isinstance(request, dict) else {}
        if str(safe_request.get("shortcutName") or "").strip():
            shortcut_name = str(safe_request.get("shortcutName")).strip()

        try:
            shortcut_path = create_windows_desktop_shortcut(exe_path=exe_path.resolve(), shortcut_name=shortcut_name)
            result = {
                "ok": True,
                "state": "created",
                "shortcutPath": str(shortcut_path),
                "targetPath": str(exe_path),
                "message": "桌面快捷方式已创建。",
            }
            return log_tool_result("app", "create_desktop_shortcut", result, {"shortcutPath": str(shortcut_path), "targetPath": str(exe_path)})
        except Exception as error:
            result = {
                "ok": False,
                "state": "failed",
                "targetPath": str(exe_path),
                "message": f"创建桌面快捷方式失败：{error}",
            }
            return log_tool_result("app", "create_desktop_shortcut", result, {"targetPath": str(exe_path)})

    def create_start_menu_shortcut(self, request=None):
        manifest = self.read_release_manifest()
        package_root = release_manifest_path().parent
        executable = str(manifest.get("executable") or "SSH-Agent-Tool.exe").strip() or "SSH-Agent-Tool.exe"
        exe_path = package_root / Path(executable).name
        shortcut_name = "SSH-Agent-Tool.lnk"
        safe_request = request if isinstance(request, dict) else {}
        if str(safe_request.get("shortcutName") or "").strip():
            shortcut_name = str(safe_request.get("shortcutName")).strip()

        try:
            shortcut_path = create_windows_start_menu_shortcut(exe_path=exe_path.resolve(), shortcut_name=shortcut_name)
            result = {
                "ok": True,
                "state": "created",
                "shortcutPath": str(shortcut_path),
                "targetPath": str(exe_path),
                "message": "开始菜单快捷方式已创建。",
            }
            return log_tool_result("app", "create_start_menu_shortcut", result, {"shortcutPath": str(shortcut_path), "targetPath": str(exe_path)})
        except Exception as error:
            result = {
                "ok": False,
                "state": "failed",
                "targetPath": str(exe_path),
                "message": f"创建开始菜单快捷方式失败：{error}",
            }
            return log_tool_result("app", "create_start_menu_shortcut", result, {"targetPath": str(exe_path)})

    def open_install_directory(self):
        install_path = release_manifest_path().parent
        if not install_path.exists() or not install_path.is_dir():
            result = {
                "ok": False,
                "state": "missing_directory",
                "path": str(install_path),
                "message": f"安装目录不存在：{install_path}",
            }
            return log_tool_result("app", "open_install_directory", result, {"path": str(install_path)})

        args = ["explorer.exe", str(install_path)]
        popen_kwargs = {}
        if sys.platform == "win32":
            popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            subprocess.Popen(args, **popen_kwargs)
            result = {
                "ok": True,
                "state": "opened",
                "path": str(install_path),
                "message": "安装目录已打开。",
            }
            return log_tool_result("app", "open_install_directory", result, {"path": str(install_path)})
        except Exception as error:
            result = {
                "ok": False,
                "state": "failed",
                "path": str(install_path),
                "message": f"打开安装目录失败：{error}",
            }
            return log_tool_result("app", "open_install_directory", result, {"path": str(install_path)})

    def open_current_executable_directory(self):
        executable_path = Path(sys.executable).expanduser().resolve()
        executable_dir = executable_path.parent
        if not executable_dir.exists() or not executable_dir.is_dir():
            result = {
                "ok": False,
                "state": "missing_directory",
                "path": str(executable_dir),
                "executable": str(executable_path),
                "message": f"当前程序目录不存在：{executable_dir}",
            }
            return log_tool_result("app", "open_current_executable_directory", result, {"path": str(executable_dir), "executable": str(executable_path)})

        args = ["explorer.exe", str(executable_dir)]
        popen_kwargs = {}
        if sys.platform == "win32":
            popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            subprocess.Popen(args, **popen_kwargs)
            result = {
                "ok": True,
                "state": "opened",
                "path": str(executable_dir),
                "executable": str(executable_path),
                "message": "当前程序目录已打开。",
            }
            return log_tool_result("app", "open_current_executable_directory", result, {"path": str(executable_dir), "executable": str(executable_path)})
        except Exception as error:
            result = {
                "ok": False,
                "state": "failed",
                "path": str(executable_dir),
                "executable": str(executable_path),
                "message": f"打开当前程序目录失败：{error}",
            }
            return log_tool_result("app", "open_current_executable_directory", result, {"path": str(executable_dir), "executable": str(executable_path)})

    def open_app_data_directory(self):
        data_path = app_data_root()
        try:
            data_path.mkdir(parents=True, exist_ok=True)
        except Exception as error:
            result = {
                "ok": False,
                "state": "failed",
                "path": str(data_path),
                "message": f"创建数据目录失败：{error}",
            }
            return log_tool_result("app", "open_app_data_directory", result, {"path": str(data_path)})

        args = ["explorer.exe", str(data_path)]
        popen_kwargs = {}
        if sys.platform == "win32":
            popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            subprocess.Popen(args, **popen_kwargs)
            result = {
                "ok": True,
                "state": "opened",
                "path": str(data_path),
                "message": "数据目录已打开。",
            }
            return log_tool_result("app", "open_app_data_directory", result, {"path": str(data_path)})
        except Exception as error:
            result = {
                "ok": False,
                "state": "failed",
                "path": str(data_path),
                "message": f"打开数据目录失败：{error}",
            }
            return log_tool_result("app", "open_app_data_directory", result, {"path": str(data_path)})

    def open_diagnostic_package_directory(self):
        diagnostic_path = diagnostic_package_path().parent
        try:
            diagnostic_path.mkdir(parents=True, exist_ok=True)
        except Exception as error:
            result = {
                "ok": False,
                "state": "failed",
                "path": str(diagnostic_path),
                "message": f"创建诊断包目录失败：{error}",
            }
            return log_tool_result("app", "open_diagnostic_package_directory", result, {"path": str(diagnostic_path)})

        args = ["explorer.exe", str(diagnostic_path)]
        popen_kwargs = {}
        if sys.platform == "win32":
            popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            subprocess.Popen(args, **popen_kwargs)
            result = {
                "ok": True,
                "state": "opened",
                "path": str(diagnostic_path),
                "message": f"诊断包目录已打开：{diagnostic_path}",
            }
            return log_tool_result("app", "open_diagnostic_package_directory", result, {"path": str(diagnostic_path)})
        except Exception as error:
            result = {
                "ok": False,
                "state": "failed",
                "path": str(diagnostic_path),
                "message": f"打开诊断包目录失败：{error}",
            }
            return log_tool_result("app", "open_diagnostic_package_directory", result, {"path": str(diagnostic_path)})

    def read_release_update_settings(self):
        config = self.read_app_config()
        settings = sanitize_release_update_settings(config.get("releaseUpdateSettings"))
        return {
            "ok": True,
            "state": "loaded",
            "updateCheckUrl": settings["updateCheckUrl"],
            "autoCheckOnStartup": settings["autoCheckOnStartup"],
            "configPath": str(app_config_path()),
        }

    def save_release_update_settings(self, settings=None):
        safe_settings = sanitize_release_update_settings(settings if isinstance(settings, dict) else {})
        update_url = safe_settings["updateCheckUrl"]
        if update_url and not is_valid_remote_update_url(update_url):
            result = {
                "ok": False,
                "state": "invalid_url",
                "updateCheckUrl": update_url,
                "message": "更新源地址格式无效，请填写 http 或 https 的 latest.json 地址。",
            }
            return log_tool_result("release-update", "save_settings", result, {"updateCheckUrl": update_url})

        config = self.read_app_config()
        config["releaseUpdateSettings"] = safe_settings
        self.write_app_config(config)
        result = {
            "ok": True,
            "state": "saved",
            "updateCheckUrl": update_url,
            "autoCheckOnStartup": safe_settings["autoCheckOnStartup"],
            "configPath": str(app_config_path()),
            "message": "在线更新源配置已保存。",
        }
        return log_tool_result("release-update", "save_settings", result, {"updateCheckUrl": update_url})

    def resolve_release_update_url(self, manifest: dict):
        config = self.read_app_config()
        settings = sanitize_release_update_settings(config.get("releaseUpdateSettings"))
        configured_url = settings["updateCheckUrl"]
        if configured_url:
            return configured_url, "custom"
        packaged_url = str((manifest if isinstance(manifest, dict) else {}).get("updateCheckUrl") or "").strip()
        if packaged_url:
            return packaged_url, "manifest"
        return "", "local"

    def check_release_update(self):
        current_manifest = self.read_release_manifest()
        update_url, configured_source = self.resolve_release_update_url(current_manifest)
        current_version = str(current_manifest.get("version") or "dev").strip() or "dev"
        if not update_url:
            local_manifest_path = local_release_latest_manifest_path()
            try:
                local_manifest = read_local_release_manifest(local_manifest_path)
            except Exception as error:
                result = {
                    "ok": False,
                    "state": "failed",
                    "currentVersion": current_version,
                    "latestVersion": "",
                    "latestManifestPath": str(local_manifest_path),
                    "message": f"读取本地更新清单失败：{error}",
                }
                return log_tool_result("release-update", "check_update", result, {"updateCheckUrl": "", "latestManifestPath": str(local_manifest_path), "version": current_version})
            if local_manifest:
                result = build_release_update_status(current_manifest, local_manifest)
                result["updateSource"] = "local"
                result["latestManifestPath"] = str(local_manifest_path)
                if not result.get("packageUrl") and result.get("packageFile"):
                    result["packageUrl"] = str(local_manifest_path.parent / str(result["packageFile"]))
                result = validate_release_update_status_ready(result)
                log_tool_event(
                    {
                        "level": "info",
                        "component": "release-update",
                        "action": "check_update",
                        "message": result.get("message") or "本地更新检查完成。",
                        "context": {
                            "updateSource": "local",
                            "latestManifestPath": str(local_manifest_path),
                            "currentVersion": result.get("currentVersion"),
                            "latestVersion": result.get("latestVersion"),
                            "state": result.get("state"),
                        },
                    }
                )
                return result
            result = {
                "ok": False,
                "state": "not_configured",
                "currentVersion": current_version,
                "latestVersion": "",
                "message": "当前版本未配置远程更新源，请在版本信息中填写 latest.json 更新清单地址，或将正式发布包里的 latest.json 与 ZIP 放到同一下载地址后再检查更新。",
            }
            return log_tool_result("release-update", "check_update", result, {"updateCheckUrl": "", "version": current_version})
        if not update_url.lower().startswith(("http://", "https://")):
            result = {
                "ok": False,
                "state": "invalid_url",
                "currentVersion": current_version,
                "latestVersion": "",
                "message": "更新源地址格式无效，请在发布清单中配置 http 或 https 地址。",
            }
            return log_tool_result("release-update", "check_update", result, {"updateCheckUrl": update_url, "version": current_version})
        try:
            latest_manifest = fetch_remote_release_manifest(update_url)
            result = build_release_update_status(current_manifest, latest_manifest)
            add_inferred_release_package_url(result, update_url)
            result = validate_release_update_status_ready(result)
            result["updateSource"] = "remote"
            result["configuredUpdateSource"] = configured_source
            log_tool_event(
                {
                    "level": "info",
                    "component": "release-update",
                    "action": "check_update",
                    "message": result.get("message") or "更新检查完成",
                    "context": {
                        "updateCheckUrl": update_url,
                        "currentVersion": result.get("currentVersion"),
                        "latestVersion": result.get("latestVersion"),
                        "state": result.get("state"),
                    },
                }
            )
            return result
        except Exception as error:
            message = f"更新检查失败：{error}"
            write_release_update_status(
                "failed",
                message,
                currentVersion=current_version,
                updateCheckUrl=update_url,
                updateSource="remote",
            )
            result = {
                "ok": False,
                "state": "failed",
                "currentVersion": current_version,
                "latestVersion": "",
                "updateSource": "remote",
                "configuredUpdateSource": configured_source,
                "message": message,
            }
            return log_tool_result("release-update", "check_update", result, {"updateCheckUrl": update_url, "version": current_version})

    def download_release_update(self):
        current_manifest = self.read_release_manifest()
        update_url, configured_source = self.resolve_release_update_url(current_manifest)
        current_version = str(current_manifest.get("version") or "dev").strip() or "dev"
        local_manifest_path = None
        local_package_root = None
        latest_manifest = None
        update_source = "remote"

        if not update_url:
            local_manifest_path = local_release_latest_manifest_path()
            try:
                latest_manifest = read_local_release_manifest(local_manifest_path)
            except Exception as error:
                result = {
                    "ok": False,
                    "state": "failed",
                    "currentVersion": current_version,
                    "latestVersion": "",
                    "message": f"读取本地更新清单失败：{error}",
                }
                return log_tool_result("release-update", "download_update", result, {"updateCheckUrl": "", "latestManifestPath": str(local_manifest_path), "version": current_version})
            if not latest_manifest:
                result = {
                    "ok": False,
                    "state": "not_configured",
                    "currentVersion": current_version,
                    "latestVersion": "",
                    "message": "当前版本未配置远程更新源，无法下载更新包。",
                }
                return log_tool_result("release-update", "download_update", result, {"updateCheckUrl": "", "version": current_version})
            update_source = "local"
            local_package_root = local_manifest_path.parent
        elif not update_url.lower().startswith(("http://", "https://")):
            result = {
                "ok": False,
                "state": "invalid_url",
                "currentVersion": current_version,
                "latestVersion": "",
                "message": "更新源地址格式无效，请在发布清单中配置 http 或 https 地址。",
            }
            return log_tool_result("release-update", "download_update", result, {"updateCheckUrl": update_url, "version": current_version})

        try:
            if latest_manifest is None:
                latest_manifest = fetch_remote_release_manifest(update_url)
            update_status = build_release_update_status(current_manifest, latest_manifest)
            if update_source == "remote":
                add_inferred_release_package_url(update_status, update_url)
            if update_source == "remote":
                update_status["updateSource"] = "remote"
                update_status["configuredUpdateSource"] = configured_source
            if update_source == "local":
                update_status["updateSource"] = "local"
                update_status["latestManifestPath"] = str(local_manifest_path)
                if not update_status.get("packageUrl") and update_status.get("packageFile"):
                    update_status["packageUrl"] = str(local_package_root / str(update_status["packageFile"]))
            if not update_status.get("ok"):
                return log_tool_result("release-update", "download_update", update_status, {"updateCheckUrl": update_url, "updateSource": update_source, "version": current_version})
            if update_status.get("state") != "available":
                result = {
                    **update_status,
                    "ok": False,
                    "state": update_status.get("state") or "not_available",
                    "message": update_status.get("message") or "当前没有可下载的新版本。",
                }
                return log_tool_result("release-update", "download_update", result, {"updateCheckUrl": update_url, "updateSource": update_source, "version": current_version})

            package_url = str(update_status.get("packageUrl") or "").strip()
            if not package_url:
                result = {
                    **update_status,
                    "ok": False,
                    "state": "missing_package_url",
                    "message": "远程版本清单缺少更新包下载地址。",
                }
                return log_tool_result("release-update", "download_update", result, {"updateCheckUrl": update_url, "updateSource": update_source, "version": current_version})

            expected_sha256 = str(update_status.get("packageSha256") or "").strip().upper()
            if not expected_sha256:
                result = {
                    **update_status,
                    "ok": False,
                    "state": "missing_package_sha256",
                    "message": "版本清单缺少更新包 SHA256，已拒绝下载。请在 latest.json 中提供 packageSha256 后再检查更新。",
                }
                return log_tool_result("release-update", "download_update", result, {"updateCheckUrl": update_url, "updateSource": update_source, "packageUrl": package_url})
            if not is_valid_release_package_sha256(expected_sha256):
                result = {
                    **update_status,
                    "ok": False,
                    "state": "invalid_package_sha256",
                    "expectedSha256": expected_sha256,
                    "message": "版本清单中的更新包 SHA256 格式无效，已拒绝下载。请在 latest.json 中提供 64 位十六进制 packageSha256。",
                }
                return log_tool_result("release-update", "download_update", result, {"updateCheckUrl": update_url, "updateSource": update_source, "packageUrl": package_url})

            if update_source == "local":
                source_package_path = Path(package_url)
                if not source_package_path.is_absolute():
                    source_package_path = local_package_root / source_package_path
                source_package_path = source_package_path.resolve()
                if local_package_root and not source_package_path.is_relative_to(local_package_root.resolve()):
                    raise ValueError("本地更新包必须位于 latest.json 同级发布目录内。")
                if not source_package_path.exists() or not source_package_path.is_file():
                    raise FileNotFoundError(f"本地更新包不存在：{source_package_path}")
                package_bytes = source_package_path.read_bytes()
                package_url = str(source_package_path)
                update_status["packageUrl"] = package_url
            else:
                package_bytes = download_remote_release_package(package_url)
            actual_sha256 = hashlib.sha256(package_bytes).hexdigest().upper()
            if actual_sha256 != expected_sha256:
                result = {
                    **update_status,
                    "ok": False,
                    "state": "checksum_failed",
                    "sha256": actual_sha256,
                    "expectedSha256": expected_sha256,
                    "sizeBytes": len(package_bytes),
                    "message": "更新包 SHA256 校验失败，已拒绝保存。请重新检查发布源或重新下载。",
                }
                return log_tool_result("release-update", "download_update", result, {"updateCheckUrl": update_url, "updateSource": update_source, "packageUrl": package_url})

            updates_dir = release_update_download_path()
            updates_dir.mkdir(parents=True, exist_ok=True)
            package_name = safe_release_package_filename(package_url, str(update_status.get("packageFile") or ""))
            local_path = updates_dir / package_name
            local_path.write_bytes(package_bytes)
            result = {
                **update_status,
                "ok": True,
                "state": "downloaded",
                "localPath": str(local_path),
                "sha256": actual_sha256,
                "expectedSha256": expected_sha256,
                "sizeBytes": len(package_bytes),
                "nextAction": "install_and_restart",
                "nextActionLabel": "安装并重启",
                "message": f"更新包已下载并校验通过：{local_path}。下一步可点击“安装并重启”。",
            }
            write_release_update_status(
                "downloaded",
                result["message"],
                localPath=str(local_path),
                packageZip=str(local_path),
                packageUrl=package_url,
                latestVersion=result.get("latestVersion"),
                currentVersion=result.get("currentVersion"),
                sha256=actual_sha256,
                expectedSha256=expected_sha256,
                sizeBytes=len(package_bytes),
                updateSource=update_source,
                nextAction=result.get("nextAction"),
                nextActionLabel=result.get("nextActionLabel"),
            )
            log_tool_event(
                {
                    "level": "info",
                    "component": "release-update",
                    "action": "download_update",
                    "message": "更新包已下载并校验通过，等待安装并重启。",
                    "context": {
                        "currentVersion": result.get("currentVersion"),
                        "latestVersion": result.get("latestVersion"),
                        "updateSource": update_source,
                        "packageUrl": package_url,
                        "localPath": str(local_path),
                        "nextAction": result.get("nextAction"),
                        "sizeBytes": len(package_bytes),
                    },
                }
            )
            return result
        except Exception as error:
            write_release_update_status(
                "failed",
                f"更新包下载失败：{error}",
                currentVersion=current_version,
                updateCheckUrl=update_url,
                updateSource=update_source,
            )
            result = {
                "ok": False,
                "state": "failed",
                "currentVersion": current_version,
                "latestVersion": "",
                "message": f"更新包下载失败：{error}",
            }
            return log_tool_result("release-update", "download_update", result, {"updateCheckUrl": update_url, "version": current_version})

    def prepare_release_update_install(self, request=None):
        safe_request = request if isinstance(request, dict) else {}
        package_path = Path(str(safe_request.get("localPath") or safe_request.get("packagePath") or "").strip())
        if not str(package_path).strip():
            result = {
                "ok": False,
                "state": "missing_package",
                "message": "缺少已下载的更新包路径。",
            }
            return log_tool_result("release-update", "prepare_install", result, {})
        if not package_path.exists() or not package_path.is_file():
            result = {
                "ok": False,
                "state": "package_not_found",
                "packagePath": str(package_path),
                "message": f"更新包不存在：{package_path}",
            }
            return log_tool_result("release-update", "prepare_install", result, {"packagePath": str(package_path)})
        updates_dir = release_update_download_path()
        try:
            resolved_package_path = package_path.resolve()
            resolved_updates_dir = updates_dir.resolve()
            if not resolved_package_path.is_relative_to(resolved_updates_dir):
                result = {
                    "ok": False,
                    "state": "invalid_package_location",
                    "packagePath": str(package_path),
                    "updatesDir": str(updates_dir),
                    "message": f"更新包必须位于工具下载目录内：{updates_dir}",
                }
                return log_tool_result("release-update", "prepare_install", result, {"packagePath": str(package_path), "updatesDir": str(updates_dir)})
        except OSError as error:
            result = {
                "ok": False,
                "state": "invalid_package_location",
                "packagePath": str(package_path),
                "updatesDir": str(updates_dir),
                "message": f"更新包路径校验失败：{error}",
            }
            return log_tool_result("release-update", "prepare_install", result, {"packagePath": str(package_path), "updatesDir": str(updates_dir)})
        expected_sha256 = str(
            safe_request.get("expectedSha256")
            or safe_request.get("packageSha256")
            or safe_request.get("sha256")
            or ""
        ).strip().upper()
        actual_sha256 = ""
        if not expected_sha256:
            result = {
                "ok": False,
                "state": "missing_package_sha256",
                "packagePath": str(package_path),
                "message": "缺少更新包 SHA256，已拒绝准备安装。请先通过“下载并校验更新包”获取校验通过的更新包。",
            }
            return log_tool_result("release-update", "prepare_install", result, {"packagePath": str(package_path)})
        if not is_valid_release_package_sha256(expected_sha256):
            result = {
                "ok": False,
                "state": "invalid_package_sha256",
                "packagePath": str(package_path),
                "expectedSha256": expected_sha256,
                "message": "更新包 SHA256 格式无效，已拒绝准备安装。请使用 64 位十六进制 SHA256。",
            }
            return log_tool_result("release-update", "prepare_install", result, {"packagePath": str(package_path)})
        if expected_sha256:
            actual_sha256 = hashlib.sha256(package_path.read_bytes()).hexdigest().upper()
            if actual_sha256 != expected_sha256:
                result = {
                    "ok": False,
                    "state": "checksum_failed",
                    "packagePath": str(package_path),
                    "sha256": actual_sha256,
                    "expectedSha256": expected_sha256,
                    "message": "更新包 SHA256 校验失败，已拒绝准备安装。请重新下载更新包。",
                }
                return log_tool_result("release-update", "prepare_install", result, {"packagePath": str(package_path)})

        manifest = self.read_release_manifest()
        target = resolve_release_install_target_root()
        target_root = target["root"]
        target_root_mode = target["mode"]
        executable = str(manifest.get("executable") or "SSH-Agent-Tool.exe").strip() or "SSH-Agent-Tool.exe"
        target_writable = verify_release_install_target_writable(target_root)
        if not target_writable.get("ok"):
            result = {
                **target_writable,
                "ok": False,
                "targetRootMode": target_root_mode,
                "packagePath": str(package_path),
                "sha256": actual_sha256,
                "expectedSha256": expected_sha256,
            }
            write_release_update_status(
                "failed",
                result["message"],
                packageZip=str(package_path),
                targetRoot=str(target_root),
                targetRootMode=target_root_mode,
                sha256=actual_sha256,
                expectedSha256=expected_sha256,
            )
            return log_tool_result(
                "release-update",
                "prepare_install",
                result,
                {"packagePath": str(package_path), "targetRoot": str(target_root), "targetRootMode": target_root_mode},
            )
        updates_dir.mkdir(parents=True, exist_ok=True)
        script_path = updates_dir / "install-downloaded-update.ps1"
        log_path = updates_dir / "release-updater.log"
        script_text = build_release_updater_script(
            package_zip=package_path.resolve(),
            target_root=target_root.resolve(),
            executable=executable,
            current_pid=os.getpid(),
            log_path=log_path,
        )
        script_path.write_text(script_text, encoding="utf-8-sig")
        result = {
            "ok": True,
            "state": "ready",
            "packagePath": str(package_path),
            "scriptPath": str(script_path),
            "targetRoot": str(target_root),
            "targetRootMode": target_root_mode,
            "logPath": str(log_path),
            "sha256": actual_sha256,
            "expectedSha256": expected_sha256,
            "message": "后台更新器已准备好。关闭当前工具后会替换并启动新版本。",
        }
        write_release_update_status(
            "ready",
            result["message"],
            packageZip=str(package_path),
            scriptPath=str(script_path),
            targetRoot=str(target_root),
            targetRootMode=target_root_mode,
            logPath=str(log_path),
            sha256=actual_sha256,
            expectedSha256=expected_sha256,
        )
        log_tool_event(
            {
                "level": "info",
                "component": "release-update",
                "action": "prepare_install",
                "message": "后台更新器已准备好。",
                "context": {
                    "packagePath": str(package_path),
                    "scriptPath": str(script_path),
                    "targetRoot": str(target_root),
                    "targetRootMode": target_root_mode,
                },
            }
        )
        return result

    def start_release_update_install(self, request=None):
        safe_request = request if isinstance(request, dict) else {}
        prepared = self.prepare_release_update_install(request)
        if not prepared.get("ok"):
            return prepared
        script_path = str(prepared.get("scriptPath") or "").strip()
        if not script_path:
            result = {
                **prepared,
                "ok": False,
                "state": "missing_script",
                "message": "后台更新器路径为空，无法启动更新。",
            }
            return log_tool_result("release-update", "start_install", result, prepared)

        args = [
            "powershell",
            "-NoProfile",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script_path,
        ]
        popen_kwargs = {}
        if sys.platform == "win32":
            popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            subprocess.Popen(args, **popen_kwargs)
        except OSError as error:
            result = {
                **prepared,
                "ok": False,
                "state": "start_failed",
                "shutdownScheduled": False,
                "message": f"更新器启动失败：{error}",
            }
            return log_tool_result("release-update", "start_install", result, {"scriptPath": script_path, "packagePath": prepared.get("packagePath")})
        shutdown_scheduled = bool(safe_request.get("shutdownAfterStart"))
        if shutdown_scheduled:
            schedule_process_exit(delay_seconds=1.5, exit_code=0)
        result = {
            **prepared,
            "ok": True,
            "state": "started",
            "shutdownScheduled": shutdown_scheduled,
            "message": "后台更新器已启动。请关闭当前工具，后台更新器会在退出后替换文件并启动新版本。",
        }
        log_tool_event(
            {
                "level": "info",
                "component": "release-update",
                "action": "start_install",
                "message": "更新器已启动。",
                "context": {
                    "scriptPath": script_path,
                    "packagePath": prepared.get("packagePath"),
                    "targetRoot": prepared.get("targetRoot"),
                },
            }
        )
        return result

    def read_app_config(self):
        migration = migrate_legacy_app_config()
        if migration.get("migrated"):
            log_tool_event(
                {
                    "level": "info",
                    "component": "app-config",
                    "action": "migrate_legacy_config",
                    "message": "已从旧版本目录迁移本机配置。",
                    "context": migration,
                }
            )
        config_path = app_config_path()
        if not config_path.exists():
            return {
                "customServers": {},
                "modelConfig": {},
                "configPath": str(config_path),
            }

        try:
            data = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}

        if not isinstance(data, dict):
            data = {}
        data.setdefault("customServers", {})
        data["modelConfig"] = sanitize_model_config(data.get("modelConfig"))
        data["modelProfiles"] = sanitize_model_profiles(data.get("modelProfiles"))
        data["activeModelProfileId"] = str(data.get("activeModelProfileId") or "").strip()
        data["releaseUpdateSettings"] = sanitize_release_update_settings(data.get("releaseUpdateSettings"))
        data["mcpSettings"] = sanitize_mcp_settings(data.get("mcpSettings"))
        data["configPath"] = str(config_path)
        return data

    def write_app_config(self, config):
        safe_config = config if isinstance(config, dict) else {}
        if "releaseUpdateSettings" in safe_config:
            release_update_settings = sanitize_release_update_settings(safe_config.get("releaseUpdateSettings"))
        else:
            try:
                current_config_path = app_config_path()
                current_data = json.loads(current_config_path.read_text(encoding="utf-8")) if current_config_path.exists() else {}
            except (OSError, json.JSONDecodeError):
                current_data = {}
            release_update_settings = sanitize_release_update_settings(
                current_data.get("releaseUpdateSettings") if isinstance(current_data, dict) else {}
            )
        safe_config = {
            **safe_config,
            "modelConfig": sanitize_model_config(safe_config.get("modelConfig")),
            "modelProfiles": sanitize_model_profiles(safe_config.get("modelProfiles")),
            "activeModelProfileId": str(safe_config.get("activeModelProfileId") or "").strip(),
            "releaseUpdateSettings": release_update_settings,
            "mcpSettings": sanitize_mcp_settings(safe_config.get("mcpSettings")),
        }
        config_path = app_config_path()
        config_path.parent.mkdir(parents=True, exist_ok=True)
        config_path.write_text(json.dumps(safe_config, ensure_ascii=False, indent=2), encoding="utf-8")
        log_tool_event(
            {
                "level": "info",
                "component": "app-config",
                "action": "write_config",
                "message": "配置已保存",
                "context": {
                    "configPath": str(config_path),
                    "serverCount": len(safe_config.get("customServers") or {}),
                    "modelProfileCount": len(safe_config.get("modelProfiles") or []),
                    "activeModelProfileId": safe_config.get("activeModelProfileId") or "",
                },
            }
        )
        return str(config_path)

    def test_ssh_connection(self, host: str, port: str = "22"):
        try:
            result = probe_ssh_endpoint(host, port)
        except Exception as error:
            result = ssh_operation_exception_result("test_connection", {"host": host, "port": port})
            log_tool_exception("ssh", "test_connection", error, {"host": host, "port": port})
        return log_tool_result("ssh", "test_connection", result, {"host": host, "port": port})

    def test_ssh_login(self, server: dict, credential_ref: str = "", secret: str = "", metadata=None):
        safe_server = server if isinstance(server, dict) else {}
        credential_metadata = metadata if isinstance(metadata, dict) else {}
        password = str(secret or "")

        try:
            if not password and credential_ref:
                store = CredentialStore(credential_store_path())
                password = store.read_secret(credential_ref)
                credential_metadata = {**store.read_metadata(credential_ref), **credential_metadata}

            credential_metadata = server_credential_metadata(safe_server, credential_metadata)
            result = run_with_retries(
                safe_server,
                lambda: run_readonly_command(
                    safe_server,
                    password,
                    "whoami",
                    timeout=server_timeout(safe_server),
                    credential_metadata=credential_metadata,
                ),
            )
        except Exception as error:
            result = ssh_operation_exception_result("test_login")
            log_tool_exception("ssh", "test_login", error, ssh_tool_log_context(safe_server, credential_metadata, result))
        if isinstance(result, dict) and result.get("ok"):
            user = str(result.get("stdout") or "").strip().splitlines()[0] if str(result.get("stdout") or "").strip() else str(safe_server.get("user") or "")
            return {
                **result,
                "state": "在线",
                "tone": "green",
                "latency": "已认证",
                "message": f"SSH 登录测试通过：{user or '认证成功'}。",
            }
        return log_tool_result("ssh", "test_login", result, ssh_tool_log_context(safe_server, credential_metadata, result))

    def save_credential(self, connection_name: str, secret: str, metadata=None):
        store = CredentialStore(credential_store_path())
        return store.save_secret(connection_name, secret, metadata if isinstance(metadata, dict) else {})

    def read_credential_metadata(self, credential_ref: str):
        store = CredentialStore(credential_store_path())
        return store.read_metadata(credential_ref)

    def delete_credential(self, credential_ref: str):
        store = CredentialStore(credential_store_path())
        result = store.delete_secret(credential_ref)
        log_tool_event(
            {
                "level": "info" if result.get("ok") else "warn",
                "component": "credential",
                "action": "delete_credential",
                "message": "SSH 凭据已删除" if result.get("deleted") else "SSH 凭据引用已解绑",
                "context": {"credentialRef": credential_ref, "deleted": bool(result.get("deleted"))},
            }
        )
        return result

    def save_model_api_key(self, model_config: dict, api_key: str):
        store = CredentialStore(credential_store_path())
        safe_config = model_config if isinstance(model_config, dict) else {}
        try:
            result = save_model_api_key(safe_config, api_key, store)
        except Exception as error:
            result = model_api_exception_result("save_api_key", {"config": sanitize_model_config(safe_config)})
            log_tool_exception("model-api", "save_api_key", error, {"model": sanitize_model_config(safe_config)})
        log_tool_event(
            {
                "level": "info" if isinstance(result, dict) and result.get("ok") else "warn",
                "component": "model-api",
                "action": "save_api_key",
                "message": result.get("message") if isinstance(result, dict) else "模型 API Key 保存完成",
                "context": {
                    "model": sanitize_model_config((result if isinstance(result, dict) else {}).get("config") or model_config),
                    "hasApiKeyRef": bool(isinstance(result, dict) and result.get("config", {}).get("apiKeyRef")),
                },
            }
        )
        return result

    def chat_with_model(self, model_config: dict, messages: list):
        resolved_config = sanitize_model_config(model_config if isinstance(model_config, dict) else {})
        try:
            store = CredentialStore(credential_store_path())
            resolved_config = resolve_model_config(model_config if isinstance(model_config, dict) else {}, store)
            result = call_model_chat(resolved_config, messages if isinstance(messages, list) else [])
        except Exception as error:
            result = model_api_exception_result("chat", {"content": ""})
            log_tool_exception("model-api", "chat", error, model_api_log_context(resolved_config))
        return log_model_api_result("chat", result, resolved_config)

    def test_model_connection(self, model_config: dict):
        resolved_config = sanitize_model_config(model_config if isinstance(model_config, dict) else {})
        try:
            store = CredentialStore(credential_store_path())
            resolved_config = resolve_model_config(model_config if isinstance(model_config, dict) else {}, store)
            result = call_model_test(resolved_config)
        except Exception as error:
            result = model_api_exception_result(
                "test_connection",
                {
                    "provider": str(resolved_config.get("provider") or "").strip(),
                    "baseUrl": str(resolved_config.get("baseUrl") or "").strip(),
                    "model": str(resolved_config.get("model") or "").strip(),
                },
            )
            log_tool_exception("model-api", "test_connection", error, model_api_log_context(resolved_config))
        return log_model_api_result("test_connection", result, resolved_config)

    def list_model_options(self, model_config: dict):
        resolved_config = sanitize_model_config(model_config if isinstance(model_config, dict) else {})
        try:
            store = CredentialStore(credential_store_path())
            resolved_config = resolve_model_config(model_config if isinstance(model_config, dict) else {}, store)
            result = call_model_list(resolved_config)
        except Exception as error:
            result = model_api_exception_result(
                "list_models",
                {
                    "provider": str(resolved_config.get("provider") or "").strip(),
                    "models": [],
                },
            )
            log_tool_exception("model-api", "list_models", error, model_api_log_context(resolved_config))
        return log_model_api_result("list_models", result, resolved_config)

    def search_web(self, query: str):
        return call_web_search(query)

    def call_mcp_http(self, endpoint: str, requests: list, timeout: int = 15, headers=None, run_id: str = ""):
        safe_endpoint = str(endpoint or "").strip()
        safe_requests = requests if isinstance(requests, list) else []
        safe_headers = headers if isinstance(headers, list) else []
        safe_context = mcp_call_log_context(safe_endpoint, safe_requests, timeout, safe_headers)
        safe_run_id = str(run_id or "").strip()
        if safe_endpoint.lower().startswith("mcp://"):
            result = call_builtin_mcp_connector(
                safe_endpoint,
                safe_requests,
                timeout=timeout,
                headers=safe_headers,
                config=self.read_app_config(),
            )
            return log_tool_result("mcp", "call_builtin", result, {"endpoint": safe_endpoint})
        cancel_event = None
        if safe_run_id:
            cancel_event = threading.Event()
            self._active_mcp_runs[safe_run_id] = cancel_event
        try:
            result = call_mcp_http(safe_endpoint, safe_requests, timeout=timeout, headers=safe_headers, cancel_event=cancel_event)
            return log_mcp_call_result("call_http", result, {**safe_context, "runId": safe_run_id})
        finally:
            if safe_run_id:
                self._active_mcp_runs.pop(safe_run_id, None)

    def cancel_mcp_http_call(self, run_id: str):
        safe_run_id = str(run_id or "").strip()
        if not safe_run_id:
            return {"ok": False, "message": "缺少 MCP HTTP 任务 ID。"}
        event = self._active_mcp_runs.get(safe_run_id)
        if not event:
            return {"ok": False, "message": "未找到正在执行的 MCP HTTP 任务。"}
        event.set()
        return {"ok": True, "message": "已请求取消 MCP HTTP 任务。"}

    def run_local_cli_command(self, command: str, timeout: int = 20, run_id: str = ""):
        safe_run_id = str(run_id or "").strip()
        cancel_event = None
        if safe_run_id:
            cancel_event = threading.Event()
            self._active_cli_runs[safe_run_id] = cancel_event
        try:
            result = run_local_cli_command(command, timeout=timeout, cancel_event=cancel_event)
            return log_tool_result("local-cli", "run_command", result, {"command": command, "timeout": timeout, "runId": safe_run_id})
        finally:
            if safe_run_id:
                self._active_cli_runs.pop(safe_run_id, None)

    def cancel_local_cli_command(self, run_id: str):
        safe_run_id = str(run_id or "").strip()
        if not safe_run_id:
            return {"ok": False, "message": "缺少本地 CLI 任务 ID。"}
        event = self._active_cli_runs.get(safe_run_id)
        if not event:
            return {"ok": False, "message": "未找到正在执行的本地 CLI 任务。"}
        event.set()
        return {"ok": True, "message": "已请求取消本地 CLI 任务。"}

    def run_ssh_readonly_command(self, server: dict, credential_ref: str, command: str):
        safe_server = server if isinstance(server, dict) else {}
        metadata = {}
        try:
            store = CredentialStore(credential_store_path())
            password = store.read_secret(credential_ref) if credential_ref else ""
            metadata = store.read_metadata(credential_ref) if credential_ref else {}
            metadata = server_credential_metadata(safe_server, metadata)
            operation_server = server_without_nested_retries(safe_server)
            result = run_with_retries(
                safe_server,
                lambda: run_readonly_command(operation_server, password, command, timeout=server_timeout(safe_server), credential_metadata=metadata),
            )
        except Exception as error:
            result = ssh_operation_exception_result("readonly_command", {"command": command})
            log_tool_exception("ssh", "readonly_command", error, ssh_tool_log_context(safe_server, metadata, result, {"command": command}))
        return log_tool_result("ssh", "readonly_command", result, ssh_tool_log_context(safe_server, metadata, result, {"command": command}))

    def read_ssh_basic_info(self, server: dict, credential_ref: str):
        results = []
        for command in build_basic_info_commands():
            result = self.run_ssh_readonly_command(server, credential_ref, command)
            results.append(result)
            if not result.get("ok"):
                break
        return {
            "ok": bool(results) and all(result.get("ok") for result in results),
            "results": results,
        }

    def open_ssh_session(self, server: dict, credential_ref: str, terminal_size=None):
        safe_server = server if isinstance(server, dict) else {}
        metadata = {}
        try:
            store = CredentialStore(credential_store_path())
            password = store.read_secret(credential_ref) if credential_ref else ""
            metadata = store.read_metadata(credential_ref) if credential_ref else {}
            metadata = server_credential_metadata(safe_server, metadata)
            operation_server = server_without_nested_retries(safe_server)

            def open_session_operation():
                options = {
                    "timeout": server_timeout(safe_server),
                    "credential_metadata": metadata,
                }
                if terminal_size is not None:
                    options["terminal_size"] = normalize_terminal_pty_size(terminal_size)
                return self.ssh_sessions().open_session(operation_server, password, **options)

            result = run_with_retries(safe_server, open_session_operation)
        except Exception as error:
            result = ssh_session_exception_result("open_session")
            log_tool_exception("ssh", "open_session", error, ssh_tool_log_context(safe_server, metadata, result))
        session_id = str(result.get("sessionId") or "") if isinstance(result, dict) else ""
        server_name = session_server_name(safe_server)
        if session_id:
            self._session_servers[session_id] = server_name
        open_ok = isinstance(result, dict) and result.get("ok")
        failure_kind = result_failure_kind(result)
        log_session_event(
            {
                "type": "session_open",
                "server": server_name,
                "sessionId": session_id,
                "actor": "system",
                "status": "ok" if open_ok else "failed",
                "message": result.get("message") if isinstance(result, dict) else "",
                "context": ssh_connection_log_context(safe_server, metadata),
                **({"failureKind": failure_kind} if failure_kind and not open_ok else {}),
            }
        )
        return log_tool_result(
            "ssh",
            "open_session",
            result,
            ssh_tool_log_context(safe_server, metadata, result),
        )

    def send_ssh_session_command(self, session_id: str, command: str):
        try:
            result = self.ssh_sessions().send_command(session_id, command)
        except Exception as error:
            result = {"ok": False, "sessionId": session_id, "command": command, "message": "SSH 会话命令发送失败，请查看会话日志或工具日志。"}
            log_tool_exception("ssh", "send_command", error, {"sessionId": session_id, "command": command})
        command_ok = isinstance(result, dict) and result.get("ok")
        failure_kind = result_failure_kind(result)
        log_session_event(
            {
                "type": "command" if command_ok else "command_failed",
                "server": self._session_servers.get(str(session_id or ""), ""),
                "sessionId": session_id,
                "actor": "user",
                "command": command,
                "status": "ok" if command_ok else "failed",
                "message": result.get("message") if isinstance(result, dict) else "",
                "output": session_result_output(result),
                **({"failureKind": failure_kind} if failure_kind and not command_ok else {}),
            }
        )
        return log_tool_result("ssh", "send_command", result, {"sessionId": session_id, "command": command})

    def interrupt_ssh_session_command(self, session_id: str):
        try:
            result = self.ssh_sessions().interrupt_command(session_id)
        except Exception as error:
            result = ssh_session_exception_result("interrupt_command", session_id)
            log_tool_exception("ssh", "interrupt_command", error, {"sessionId": session_id})
        interrupt_ok = isinstance(result, dict) and result.get("ok")
        failure_kind = result_failure_kind(result)
        log_session_event(
            {
                "type": "command_interrupt",
                "server": self._session_servers.get(str(session_id or ""), ""),
                "sessionId": session_id,
                "actor": "user",
                "status": "ok" if interrupt_ok else "failed",
                "message": result.get("message") if isinstance(result, dict) else "",
                "output": session_result_output(result),
                **({"failureKind": failure_kind} if failure_kind and not interrupt_ok else {}),
            }
        )
        return log_tool_result("ssh", "interrupt_command", result, {"sessionId": session_id})

    def send_ssh_session_input(self, session_id: str, text: str, submit: bool = False):
        safe_input_meta = {"inputLength": len(str(text or "")), "submit": bool(submit)}
        try:
            result = self.ssh_sessions().send_input(session_id, text, submit)
        except Exception as error:
            result = {"ok": False, "sessionId": session_id, "message": "SSH 交互输入发送失败，请查看会话日志或工具日志。"}
            log_tool_exception("ssh", "send_input", error, {"sessionId": session_id, **safe_input_meta})
        input_ok = isinstance(result, dict) and result.get("ok")
        failure_kind = result_failure_kind(result)
        log_session_event(
            {
                "type": "interactive_input" if input_ok else "interactive_input_failed",
                "server": self._session_servers.get(str(session_id or ""), ""),
                "sessionId": session_id,
                "actor": "user",
                "status": "ok" if input_ok else "failed",
                "message": result.get("message") if isinstance(result, dict) else "",
                "inputLength": safe_input_meta["inputLength"],
                "submit": safe_input_meta["submit"],
                "output": session_result_output(result),
                **({"failureKind": failure_kind} if failure_kind and not input_ok else {}),
            }
        )
        return log_tool_result("ssh", "send_input", result, {"sessionId": session_id, **safe_input_meta})

    def resize_ssh_session(self, session_id: str, width: int, height: int):
        size = normalize_terminal_pty_size(cols=width, rows=height)
        try:
            result = self.ssh_sessions().resize_session(session_id, size["cols"], size["rows"])
        except Exception as error:
            result = ssh_session_exception_result("resize_session", session_id, {"width": size["cols"], "height": size["rows"]})
            log_tool_exception("ssh", "resize_session", error, {"sessionId": session_id, "width": size["cols"], "height": size["rows"]})
        return log_tool_result("ssh", "resize_session", result, {"sessionId": session_id, "width": size["cols"], "height": size["rows"]})

    def read_ssh_session_output(self, session_id: str):
        try:
            result = self.ssh_sessions().read_output(session_id)
        except Exception as error:
            result = ssh_session_exception_result("read_output", session_id)
            log_tool_exception("ssh", "read_output", error, {"sessionId": session_id})
        output = session_result_output(result)
        should_log = bool(output) or (isinstance(result, dict) and result.get("ok") is False)
        if should_log:
            failure_kind = result_failure_kind(result)
            log_session_event(
                {
                    "type": "output" if isinstance(result, dict) and result.get("ok") else "output_failed",
                    "server": self._session_servers.get(str(session_id or ""), ""),
                    "sessionId": session_id,
                    "actor": "server" if isinstance(result, dict) and result.get("ok") else "system",
                    "status": "ok" if isinstance(result, dict) and result.get("ok") else "failed",
                    "message": result.get("message") if isinstance(result, dict) else "",
                    "output": output,
                    **({"failureKind": failure_kind} if failure_kind and not (isinstance(result, dict) and result.get("ok")) else {}),
                }
            )
        return log_tool_result("ssh", "read_output", result, {"sessionId": session_id})

    def check_ssh_session_health(self, session_id: str):
        try:
            result = self.ssh_sessions().check_session_health(session_id)
        except Exception as error:
            result = ssh_session_exception_result("check_session_health", session_id)
            log_tool_exception("ssh", "check_session_health", error, {"sessionId": session_id})
        if isinstance(result, dict) and result.get("ok") is False:
            failure_kind = result_failure_kind(result)
            log_session_event(
                {
                    "type": "session_health_failed",
                    "server": self._session_servers.get(str(session_id or ""), ""),
                    "sessionId": session_id,
                    "actor": "system",
                    "status": "failed",
                    "message": result.get("message") or "",
                    **({"failureKind": failure_kind} if failure_kind else {}),
                }
            )
        return log_tool_result("ssh", "check_session_health", result, {"sessionId": session_id})

    def close_ssh_session(self, session_id: str):
        try:
            result = self.ssh_sessions().close_session(session_id)
        except Exception as error:
            result = ssh_session_exception_result("close_session", session_id)
            log_tool_exception("ssh", "close_session", error, {"sessionId": session_id})
        safe_session_id = str(session_id or "")
        close_ok = isinstance(result, dict) and result.get("ok")
        failure_kind = result_failure_kind(result)
        log_session_event(
            {
                "type": "session_close",
                "server": self._session_servers.get(safe_session_id, ""),
                "sessionId": session_id,
                "actor": "system",
                "status": "ok" if close_ok else "failed",
                "message": result.get("message") if isinstance(result, dict) else "",
                **({"failureKind": failure_kind} if failure_kind and not close_ok else {}),
            }
        )
        if close_ok:
            self._session_servers.pop(safe_session_id, None)
        return log_tool_result("ssh", "close_session", result, {"sessionId": session_id})

    def start_port_forward(self, server: dict, credential_ref: str, config: dict):
        safe_server = server if isinstance(server, dict) else {}
        safe_config = config if isinstance(config, dict) else {}
        try:
            store = CredentialStore(credential_store_path())
            secret = store.read_secret(credential_ref) if credential_ref else ""
            metadata = store.read_metadata(credential_ref) if credential_ref else {}
            metadata = server_credential_metadata(safe_server, metadata)
            result = run_with_retries(
                safe_server,
                lambda: self.port_forwards().start_forward(safe_server, secret, metadata, safe_config),
            )
        except Exception as error:
            result = port_forward_exception_result("start_forward")
            log_tool_exception("port-forward", "start_forward", error, {"server": safe_server, "config": safe_config})
        return log_tool_result("port-forward", "start_forward", result, {"server": safe_server, "config": safe_config})

    def stop_port_forward(self, forward_id: str):
        try:
            result = self.port_forwards().stop_forward(forward_id)
        except Exception as error:
            result = port_forward_exception_result("stop_forward", {"forwardId": forward_id})
            log_tool_exception("port-forward", "stop_forward", error, {"forwardId": forward_id})
        return log_tool_result("port-forward", "stop_forward", result, {"forwardId": forward_id})

    def list_port_forwards(self):
        try:
            result = self.port_forwards().list_forwards()
        except Exception as error:
            result = port_forward_exception_result("list_forwards")
            log_tool_exception("port-forward", "list_forwards", error, {})
        return log_tool_result("port-forward", "list_forwards", result, {})

    def list_sftp_directory(self, server: dict, credential_ref: str, remote_path: str):
        return run_sftp_desktop_operation(
            server,
            credential_ref,
            "list_directory",
            {"remotePath": remote_path},
            lambda safe_server, password, metadata: list_sftp_directory(safe_server, password, remote_path, timeout=server_timeout(safe_server), credential_metadata=metadata),
        )

    def download_sftp_file(self, server: dict, credential_ref: str, remote_path: str, local_path: str = "", overwrite: bool = False):
        resolved_local_path = str(local_path or "").strip()
        if not resolved_local_path:
            suggested_name = posixpath.basename(str(remote_path or "").strip().replace("\\", "/").rstrip("/")) or "download"
            resolved_local_path = str(self.pick_download_target(suggested_name) or "").strip()
            if not resolved_local_path:
                result = {
                    "ok": False,
                    "state": "cancelled",
                    "remotePath": str(remote_path or ""),
                    "localPath": "",
                    "message": "已取消下载。",
                }
                return log_tool_result(
                    "sftp",
                    "download_file",
                    result,
                    sftp_tool_log_context(server if isinstance(server, dict) else {}, {"remotePath": remote_path, "state": "cancelled"}),
                )
        return run_sftp_desktop_operation(
            server,
            credential_ref,
            "download_file",
            {"remotePath": remote_path, "localPath": resolved_local_path, "overwrite": bool(overwrite)},
            lambda safe_server, password, metadata: download_sftp_file(safe_server, password, remote_path, resolved_local_path, timeout=server_timeout(safe_server), credential_metadata=metadata, overwrite=bool(overwrite)),
        )

    def start_sftp_download_job(self, server: dict, credential_ref: str, remote_path: str, local_path: str = "", overwrite: bool = False):
        resolved_local_path = str(local_path or "").strip()
        if not resolved_local_path:
            suggested_name = posixpath.basename(str(remote_path or "").strip().replace("\\", "/").rstrip("/")) or "download"
            resolved_local_path = str(self.pick_download_target(suggested_name) or "").strip()
            if not resolved_local_path:
                return {
                    "id": "",
                    "direction": "download",
                    "status": "canceled",
                    "done": True,
                    "remotePath": str(remote_path or ""),
                    "localPath": "",
                    "result": {"ok": False, "cancelled": True, "message": "已取消下载"},
                    "message": "已取消下载",
                }

        safe_server = server if isinstance(server, dict) else {}
        context = {"remotePath": str(remote_path or ""), "localPath": resolved_local_path}

        def worker(cancel_event, progress_callback):
            return run_sftp_desktop_operation(
                safe_server,
                credential_ref,
                "download_file",
                {**context, "overwrite": bool(overwrite), "job": True},
                lambda checked_server, password, metadata: download_sftp_file(
                    checked_server,
                    password,
                    remote_path,
                    resolved_local_path,
                    timeout=server_timeout(checked_server),
                    credential_metadata=metadata,
                    overwrite=bool(overwrite),
                    cancel_event=cancel_event,
                    progress_callback=progress_callback,
                ),
            )

        return SFTP_TRANSFER_JOBS.start("download", context, worker)

    def start_sftp_upload_job(self, server: dict, credential_ref: str, local_path: str, remote_path: str, overwrite: bool = False):
        safe_server = server if isinstance(server, dict) else {}
        context = {"remotePath": str(remote_path or ""), "localPath": str(local_path or "")}

        def worker(cancel_event, progress_callback):
            return run_sftp_desktop_operation(
                safe_server,
                credential_ref,
                "upload_file",
                {**context, "overwrite": bool(overwrite), "job": True},
                lambda checked_server, password, metadata: upload_sftp_file(
                    checked_server,
                    password,
                    local_path,
                    remote_path,
                    timeout=server_timeout(checked_server),
                    credential_metadata=metadata,
                    overwrite=bool(overwrite),
                    cancel_event=cancel_event,
                    progress_callback=progress_callback,
                ),
            )

        return SFTP_TRANSFER_JOBS.start("upload", context, worker)

    def get_sftp_transfer_job(self, job_id: str):
        job = SFTP_TRANSFER_JOBS.get(str(job_id or ""))
        if job:
            return job
        return {"id": str(job_id or ""), "status": "missing", "done": True, "message": "传输任务不存在"}

    def cancel_sftp_transfer_job(self, job_id: str):
        safe_job_id = str(job_id or "").strip()
        job = SFTP_TRANSFER_JOBS.cancel(safe_job_id)
        result = job if job else {"id": safe_job_id, "status": "missing", "done": True, "message": "传输任务不存在"}
        log_tool_event(
            {
                "level": "info" if result.get("status") == "canceled" else "warn",
                "component": "sftp",
                "action": "cancel_transfer_job",
                "message": result.get("message") or result.get("error") or "SFTP 传输取消",
                "context": {
                    "jobId": result.get("id") or safe_job_id,
                    "direction": result.get("direction") or "",
                    "status": result.get("status") or "",
                    "remotePath": result.get("remotePath") or "",
                    "localPath": result.get("localPath") or "",
                },
            }
        )
        return result

    def read_sftp_text_file(self, server: dict, credential_ref: str, remote_path: str):
        return run_sftp_desktop_operation(
            server,
            credential_ref,
            "read_text_file",
            {"remotePath": remote_path},
            lambda safe_server, password, metadata: read_sftp_text_file(safe_server, password, remote_path, timeout=server_timeout(safe_server), credential_metadata=metadata),
        )

    def preview_sftp_file(self, server: dict, credential_ref: str, remote_path: str):
        return self.read_sftp_text_file(server, credential_ref, remote_path)

    def write_sftp_text_file(self, server: dict, credential_ref: str, remote_path: str, content: str, encoding: str = "utf-8"):
        return run_sftp_desktop_operation(
            server,
            credential_ref,
            "write_text_file",
            {"remotePath": remote_path, "encoding": encoding, "contentLength": len(str(content or ""))},
            lambda safe_server, password, metadata: write_sftp_text_file(
                safe_server,
                password,
                remote_path,
                content,
                timeout=server_timeout(safe_server),
                credential_metadata=metadata,
                encoding=encoding,
            ),
        )

    def upload_sftp_file(self, server: dict, credential_ref: str, local_path: str, remote_path: str, overwrite: bool = False):
        return run_sftp_desktop_operation(
            server,
            credential_ref,
            "upload_file",
            {"localPath": local_path, "remotePath": remote_path, "overwrite": bool(overwrite)},
            lambda safe_server, password, metadata: upload_sftp_file(safe_server, password, local_path, remote_path, timeout=server_timeout(safe_server), credential_metadata=metadata, overwrite=bool(overwrite)),
        )

    def create_sftp_directory(self, server: dict, credential_ref: str, parent_path: str, directory_name: str = ""):
        resolved_parent_path = parent_path
        resolved_directory_name = directory_name
        if not str(resolved_directory_name or "").strip():
            resolved_parent_path, resolved_directory_name = split_sftp_full_path(parent_path)
        return run_sftp_desktop_operation(
            server,
            credential_ref,
            "create_directory",
            {"parentPath": resolved_parent_path, "directoryName": resolved_directory_name},
            lambda safe_server, password, metadata: create_sftp_directory(safe_server, password, resolved_parent_path, resolved_directory_name, timeout=server_timeout(safe_server), credential_metadata=metadata),
        )

    def create_sftp_file(self, server: dict, credential_ref: str, parent_path: str, file_name: str = ""):
        resolved_parent_path = parent_path
        resolved_file_name = file_name
        if not str(resolved_file_name or "").strip():
            resolved_parent_path, resolved_file_name = split_sftp_full_path(parent_path)
        return run_sftp_desktop_operation(
            server,
            credential_ref,
            "create_file",
            {"parentPath": resolved_parent_path, "fileName": resolved_file_name},
            lambda safe_server, password, metadata: create_sftp_file(safe_server, password, resolved_parent_path, resolved_file_name, timeout=server_timeout(safe_server), credential_metadata=metadata),
        )

    def rename_sftp_path(self, server: dict, credential_ref: str, remote_path: str, new_name: str):
        return run_sftp_desktop_operation(
            server,
            credential_ref,
            "rename_path",
            {"remotePath": remote_path, "newName": new_name},
            lambda safe_server, password, metadata: rename_sftp_path(safe_server, password, remote_path, new_name, timeout=server_timeout(safe_server), credential_metadata=metadata),
        )

    def rename_sftp_item(self, server: dict, credential_ref: str, remote_path: str, target_path_or_name: str):
        return self.rename_sftp_path(server, credential_ref, remote_path, sftp_name_from_path_or_name(target_path_or_name))

    def delete_sftp_path(self, server: dict, credential_ref: str, remote_path: str, item_type: str = "file"):
        return run_sftp_desktop_operation(
            server,
            credential_ref,
            "delete_path",
            {"remotePath": remote_path, "itemType": item_type},
            lambda safe_server, password, metadata: delete_sftp_path(safe_server, password, remote_path, item_type, timeout=server_timeout(safe_server), credential_metadata=metadata),
        )

    def delete_sftp_item(self, server: dict, credential_ref: str, remote_path: str, is_folder: bool = False):
        return self.delete_sftp_path(server, credential_ref, remote_path, "folder" if is_folder else "file")

    def write_audit_event(self, event: dict):
        logger = AuditLogger(audit_log_path())
        return logger.write_event(event if isinstance(event, dict) else {})

    def get_audit_log_dir(self):
        path = audit_log_path()
        path.mkdir(parents=True, exist_ok=True)
        return str(path)

    def write_session_log_event(self, event: dict):
        logger = SessionLogger(session_log_path())
        return logger.write_event(event if isinstance(event, dict) else {})

    def get_session_log_dir(self):
        path = session_log_path()
        path.mkdir(parents=True, exist_ok=True)
        return str(path)

    def open_path(self, target_path: str):
        path_text = str(target_path or "").strip()
        if not path_text:
            return {"ok": False, "message": "路径不能为空。"}

        path = Path(path_text).expanduser().resolve()
        if not path.exists():
            return {"ok": False, "path": str(path), "message": "路径不存在。"}

        try:
            if hasattr(os, "startfile"):
                os.startfile(str(path))  # type: ignore[attr-defined]
            else:
                import webbrowser

                webbrowser.open(path.as_uri())
        except Exception as error:
            return {"ok": False, "path": str(path), "message": f"打开路径失败：{error}"}

        kind = "目录" if path.is_dir() else "文件"
        return {"ok": True, "path": str(path), "message": f"已打开{kind}：{path}"}

    def list_session_log_entries(self, filters=None):
        return list_session_log_entries(session_log_path(), filters if isinstance(filters, dict) else {})

    def build_session_log_export(self, entries: list, options=None):
        return build_session_log_markdown(entries if isinstance(entries, list) else [], options if isinstance(options, dict) else {})

    def delete_old_session_logs(self, keep_days: int = 30, now: str | None = None):
        return delete_old_session_logs(session_log_path(), keep_days, now)

    def write_tool_log_event(self, event: dict):
        logger = ToolLogger(tool_log_path())
        return logger.write_event(event if isinstance(event, dict) else {})

    def get_tool_log_dir(self):
        path = tool_log_path()
        path.mkdir(parents=True, exist_ok=True)
        return str(path)

    def list_tool_log_entries(self, filters=None):
        return list_tool_log_entries(tool_log_path(), filters if isinstance(filters, dict) else {})

    def build_tool_log_export(self, entries: list, options=None):
        return build_tool_log_markdown(entries if isinstance(entries, list) else [], options if isinstance(options, dict) else {})

    def delete_old_tool_logs(self, keep_days: int = 30, now: str | None = None):
        return delete_old_tool_logs(tool_log_path(), keep_days, now)

    def export_diagnostic_package(self, target_path: str = "", options=None):
        safe_options = dict(options) if isinstance(options, dict) else {}
        if "runtimeDiagnostics" not in safe_options:
            try:
                safe_options["runtimeDiagnostics"] = self.read_runtime_diagnostics()
            except Exception as error:
                safe_options["runtimeDiagnostics"] = {
                    "ok": False,
                    "message": f"读取运行诊断失败：{error}",
                }
        target = Path(str(target_path or "").strip()) if str(target_path or "").strip() else diagnostic_package_path(safe_options.get("createdAt"))
        try:
            result = write_diagnostic_package(
                target,
                {
                    "config": app_config_path(),
                    "toolLogs": tool_log_path(),
                    "sessionLogs": session_log_path(),
                    "releaseManifest": release_manifest_path(),
                    "releaseUpdateStatus": release_update_status_path(),
                    "releaseUpdateLog": release_update_status_path().parent / "release-updater.log",
                    "startupFailureLog": tool_log_path() / "startup-failure-latest.log",
                },
                safe_options,
            )
        except Exception as error:
            result = {
                "ok": False,
                "state": "failed",
                "path": str(target),
                "message": f"诊断包导出失败：{error}",
            }
            return log_tool_result("app", "export_diagnostic_package", result, {"path": str(target)})
        if result.get("ok") and result.get("path"):
            result["message"] = f"诊断包已导出：{result['path']}"
            log_tool_event(
                {
                    "level": "info",
                    "component": "app",
                    "action": "export_diagnostic_package",
                    "message": result["message"],
                    "context": {
                        "path": result.get("path", ""),
                        "sizeBytes": result.get("sizeBytes", 0),
                        "fileCount": len(result.get("files") if isinstance(result.get("files"), list) else []),
                    },
                }
            )
            return result
        return log_tool_result("app", "export_diagnostic_package", result, {"path": str(target)})

    def build_backup_payload(
        self,
        servers: dict,
        scope: dict,
        master_password: str = "",
        agent_capabilities=None,
        port_forward_presets=None,
        command_snippets=None,
        model_config=None,
        model_profiles=None,
    ):
        store = CredentialStore(credential_store_path())
        return build_backup_payload(
            servers if isinstance(servers, dict) else {},
            scope if isinstance(scope, dict) else {},
            master_password,
            store,
            agent_capabilities if isinstance(agent_capabilities, list) else [],
            port_forward_presets if isinstance(port_forward_presets, list) else [],
            command_snippets if isinstance(command_snippets, list) else [],
            model_config if isinstance(model_config, dict) else {},
            model_profiles if isinstance(model_profiles, list) else [],
        )

    def export_backup_file(
        self,
        servers: dict,
        scope: dict,
        master_password: str,
        target_path: str,
        agent_capabilities=None,
        port_forward_presets=None,
        command_snippets=None,
        model_config=None,
        model_profiles=None,
    ):
        try:
            payload = self.build_backup_payload(
                servers,
                scope,
                master_password,
                agent_capabilities if isinstance(agent_capabilities, list) else [],
                port_forward_presets if isinstance(port_forward_presets, list) else [],
                command_snippets if isinstance(command_snippets, list) else [],
                model_config if isinstance(model_config, dict) else {},
                model_profiles if isinstance(model_profiles, list) else [],
            )
            result = write_backup_file(payload, target_path)
        except Exception as error:
            log_tool_exception("backup", "export_file", error, {"path": str(target_path or "")})
            return {"ok": False, "state": "failed", "path": str(target_path or ""), "message": f"备份文件导出失败：{error}"}
        if result.get("ok"):
            summary = result.get("summary") if isinstance(result.get("summary"), dict) else {}
            log_tool_event(
                {
                    "level": "info",
                    "component": "backup",
                    "action": "export_file",
                    "message": result.get("message") or f"备份文件已导出：{result.get('path')}",
                    "context": {
                        "path": result.get("path"),
                        "fileName": result.get("fileName"),
                        "sizeBytes": result.get("sizeBytes"),
                        "sha256": result.get("sha256"),
                        "hostCount": summary.get("hostCount"),
                        "encryptedCredentialCount": summary.get("encryptedCredentialCount"),
                        "skippedCredentialCount": summary.get("skippedCredentialCount"),
                        "includesSecrets": summary.get("includesSecrets"),
                    },
                }
            )
        return log_tool_result("backup", "export_file", result, {"path": str(target_path or "")})

    def open_backup_file(self, source_path: str):
        result = read_backup_file(source_path)
        summary = result.get("summary") if isinstance(result, dict) and isinstance(result.get("summary"), dict) else {}
        context = {
            "path": str(source_path or ""),
            "fileName": result.get("fileName") if isinstance(result, dict) else "",
            "errorCode": result.get("errorCode") if isinstance(result, dict) else "",
            "hostCount": summary.get("hostCount"),
            "agentCapabilityCount": summary.get("agentCapabilityCount"),
            "encryptedCredentialCount": summary.get("encryptedCredentialCount"),
            "skippedCredentialCount": summary.get("skippedCredentialCount"),
            "modelProfileCount": summary.get("modelProfileCount"),
            "includesSecrets": summary.get("includesSecrets"),
        }
        if isinstance(result, dict) and result.get("ok"):
            log_tool_event(
                {
                    "level": "info",
                    "component": "backup",
                    "action": "open_file",
                    "message": result.get("message") or f"备份文件已读取：{result.get('path')}",
                    "context": context,
                }
            )
            return result
        return log_tool_result("backup", "open_file", result, context)

    def restore_backup_credentials(self, imported_hosts: list, master_password: str):
        store = CredentialStore(credential_store_path())
        try:
            result = restore_backup_credentials(imported_hosts if isinstance(imported_hosts, list) else [], master_password, store)
            return log_tool_result("backup", "restore_credentials", result, {"hostCount": len(imported_hosts) if isinstance(imported_hosts, list) else 0})
        except Exception as error:
            log_tool_exception("backup", "restore_credentials", error, {"hostCount": len(imported_hosts) if isinstance(imported_hosts, list) else 0})
            return {"ok": False, "message": f"备份凭据恢复失败：{error}"}

    def restore_backup_agent_capabilities(self, backup: dict, master_password: str):
        try:
            result = restore_backup_agent_capabilities(backup if isinstance(backup, dict) else {}, master_password)
            return log_tool_result("backup", "restore_agent_capabilities", result, {"schema": backup.get("schema") if isinstance(backup, dict) else ""})
        except Exception as error:
            log_tool_exception("backup", "restore_agent_capabilities", error, {"schema": backup.get("schema") if isinstance(backup, dict) else ""})
            return {"ok": False, "message": f"备份 Agent 能力恢复失败：{error}"}

    def pick_upload_file(self):
        files = self.pick_upload_files()
        return files[0] if files else None

    def pick_upload_files(self):
        import webview

        windows = webview.windows
        if not windows:
            return []
        result = windows[0].create_file_dialog(webview.OPEN_DIALOG, allow_multiple=True)
        if not result:
            return []
        return [str(path) for path in result if str(path or "").strip()]

    def pick_upload_directory(self):
        import webview

        windows = webview.windows
        if not windows:
            return ""
        result = windows[0].create_file_dialog(webview.FOLDER_DIALOG)
        if not result:
            return ""
        if isinstance(result, (list, tuple)):
            return str(result[0] if result else "").strip()
        return str(result).strip()

    def pick_download_target(self, suggested_name: str = "download"):
        import webview

        windows = webview.windows
        if not windows:
            return None
        result = windows[0].create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=suggested_name,
        )
        if not result:
            return None
        return result

    def save_text_file(self, suggested_name: str, content: str):
        import webview

        windows = webview.windows
        if not windows:
            return None
        result = windows[0].create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=suggested_name,
        )
        if not result:
            return None
        target = Path(result)
        target.write_text(content, encoding="utf-8")
        return str(target)

    def open_text_file(self, suggested_name: str = "ssh-agent-tool-backup.json"):
        import webview

        windows = webview.windows
        if not windows:
            return None
        result = windows[0].create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False)
        if not result:
            return None
        source = Path(result[0])
        return {
            "path": str(source),
            "name": source.name or suggested_name,
            "content": source.read_text(encoding="utf-8"),
        }

    def open_ai_attachment_file(self):
        import webview

        windows = webview.windows
        if not windows:
            return None
        result = windows[0].create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False)
        if not result:
            return None
        source = Path(result[0])
        raw = source.read_bytes()
        decoded = decode_text_preview(raw)
        content, encoding = decoded if decoded else (raw.decode("utf-8", errors="replace"), "utf-8-replace")
        content = content.replace("\r\n", "\n").replace("\r", "\n")
        return {
            "path": str(source),
            "name": source.name or "AI 附件",
            "type": "本地文件",
            "content": content[:12000],
            "encoding": encoding,
            "sizeBytes": source.stat().st_size,
            "truncated": len(content) > 12000,
        }

    def pick_backup_file(self, suggested_name: str = "ssh-agent-tool-backup.json"):
        import webview

        windows = webview.windows
        if not windows:
            return None
        result = windows[0].create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False)
        if not result:
            return None
        return result[0]

    def open_private_key_file(self):
        import webview

        windows = webview.windows
        if not windows:
            return None
        result = windows[0].create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False)
        if not result:
            return None
        source = Path(result[0])
        return {
            "path": str(source),
            "name": source.name or "id_private_key",
            "content": source.read_text(encoding="utf-8"),
        }

    def open_ssh_config_file(self):
        import webview

        windows = webview.windows
        if not windows:
            return None
        result = windows[0].create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False)
        if not result:
            return None
        source = Path(result[0])
        parsed = parse_ssh_config(source.read_text(encoding="utf-8"))
        return {
            **parsed,
            "path": str(source),
            "name": source.name or "config",
        }


def main() -> int:
    import webview

    log_app_startup({"mode": "desktop"})

    index_path = ui_index_path()
    if not index_path.exists():
        raise FileNotFoundError(f"UI 文件不存在，请先构建前端: {index_path}")

    assert_webview2_runtime_available()

    api = DesktopApi()
    window = webview.create_window(
        title=APP_TITLE,
        url=index_path.as_uri(),
        width=1440,
        height=930,
        min_size=(1120, 760),
        resizable=True,
        js_api=api,
        background_color="#f4f5f7",
        text_select=True,
    )
    try:
        webview.start(debug=False)
    finally:
        api.shutdown_runtime("window_closed")
    return 0 if window else 1


def parse_startup_smoke_request(argv=None) -> dict | None:
    args = [str(item) for item in (argv if argv is not None else sys.argv)]
    if "--startup-smoke" not in args:
        return None
    output_path = ""
    for flag in ("--smoke-output", "--startup-smoke-output"):
        if flag in args:
            index = args.index(flag)
            if index + 1 < len(args):
                output_path = args[index + 1].strip()
            break
    return {"outputPath": output_path}


def build_startup_smoke_report(output_path: Path | str | None = None) -> dict:
    checks = []

    def add_check(name: str, ok: bool, message: str, path: Path | str | None = None, extra: dict | None = None) -> None:
        item = {
            "name": name,
            "ok": bool(ok),
            "message": str(message or "").strip(),
        }
        if path is not None:
            item["path"] = str(path)
        if isinstance(extra, dict):
            item.update(extra)
        checks.append(item)

    ui_path = ui_index_path()
    add_check("ui", ui_path.exists() and ui_path.is_file(), "UI 文件可用。" if ui_path.exists() else "UI 文件不存在。", ui_path)

    manifest_path = release_manifest_path()
    manifest = {}
    if manifest_path.exists() and manifest_path.is_file():
        manifest = DesktopApi().read_release_manifest()
        add_check("manifest", bool(manifest.get("ok")), manifest.get("message") or "版本清单可用。", manifest_path)
    else:
        manifest = read_embedded_release_manifest()
        add_check("manifest", True, manifest.get("message") or "单 EXE 便携模式。", manifest_path, {"optional": True})

    data_root = app_data_root()
    try:
        data_root.mkdir(parents=True, exist_ok=True)
        add_check("appData", data_root.exists() and data_root.is_dir(), "数据目录可用。", data_root)
    except Exception as error:
        add_check("appData", False, f"数据目录不可用：{error}", data_root)

    log_root = tool_log_path()
    try:
        log_root.mkdir(parents=True, exist_ok=True)
        log_tool_event(
            {
                "level": "info",
                "component": "app",
                "action": "startup_smoke",
                "message": "启动冒烟检查已执行。",
                "context": {"pid": os.getpid(), "outputPath": str(output_path or "")},
            }
        )
        add_check("toolLog", log_root.exists() and log_root.is_dir(), "工具日志目录可写。", log_root)
    except Exception as error:
        add_check("toolLog", False, f"工具日志不可写：{error}", log_root)

    frontend_assets = inspect_frontend_assets(ui_path)
    add_check(
        "frontendAssets",
        bool(frontend_assets.get("ok")),
        frontend_assets.get("message") or "frontend asset check failed",
        ui_path,
        {
            "script": frontend_assets.get("script", ""),
            "scriptSha256": frontend_assets.get("scriptSha256", ""),
            "stylesheet": frontend_assets.get("stylesheet", ""),
            "stylesheetSha256": frontend_assets.get("stylesheetSha256", ""),
        },
    )

    webview2 = detect_webview2_runtime()
    executable_mode = describe_executable_client_mode()
    startup_identity = build_startup_identity(manifest, frontend_assets, executable_mode)
    client_entry = build_client_entry_diagnostics(
        manifest_path=manifest_path,
        ui_index_path=ui_path,
    )
    add_check(
        "clientEntry",
        bool(client_entry.get("ok")),
        client_entry.get("message") or "客户端入口需要检查。",
        client_entry.get("executable"),
        {
            "recommendedEntry": client_entry.get("recommendedEntry", ""),
            "executableDirectory": client_entry.get("executableDirectory", ""),
            "inTempExecutableDirectory": bool(client_entry.get("inTempExecutableDirectory")),
            "inTempResourceRoot": bool(client_entry.get("inTempResourceRoot")),
        },
    )
    add_check(
        "webView2",
        bool(webview2.get("available")),
        webview2.get("message") or ("WebView2 Runtime 可用。" if webview2.get("available") else "WebView2 Runtime 不可用。"),
        extra={"source": webview2.get("source", ""), "version": webview2.get("version", "")},
    )

    report = {
        "ok": all(item.get("ok") for item in checks),
        "state": "passed" if all(item.get("ok") for item in checks) else "failed",
        "appName": APP_TITLE,
        "version": str(manifest.get("version") or "dev").strip() or "dev",
        "packageName": str(manifest.get("packageName") or "").strip(),
        "pid": os.getpid(),
        "executable": sys.executable,
        "frozen": bool(getattr(sys, "frozen", False)),
        "executableMode": executable_mode,
        "checkedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "checks": checks,
        "manifest": manifest,
        "frontendAssets": frontend_assets,
        "startupIdentity": startup_identity,
        "clientEntry": client_entry,
        "webView2Runtime": webview2,
    }
    report["startupRepairAdvice"] = build_startup_repair_advice(context=report)

    if output_path:
        target = Path(output_path)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(report, ensure_ascii=True, indent=2), encoding="utf-8")
        except Exception as error:
            report["ok"] = False
            report["state"] = "failed"
            report["checks"].append(
                {
                    "name": "output",
                    "ok": False,
                    "message": f"冒烟报告写入失败：{error}",
                    "path": str(target),
                }
            )
    return report


def hide_packaged_console() -> None:
    if sys.platform != "win32" or not getattr(sys, "frozen", False):
        return
    try:
        import ctypes

        console_window = ctypes.windll.kernel32.GetConsoleWindow()
        if console_window:
            ctypes.windll.user32.ShowWindow(console_window, 0)
    except Exception:
        pass


def build_startup_failure_message(error: BaseException) -> str:
    log_dir = tool_log_path()
    startup_failure_log = log_dir / "startup-failure-latest.log"
    return (
        "SSH Agent 工具启动失败。\n\n"
        f"错误信息：{error}\n\n"
        "建议先按下面顺序处理：\n"
        "1. 完整解压最新版 Windows 客户端 ZIP 后，再双击 SSH-Agent-Tool.exe。\n"
        "2. 不要从压缩包预览窗口直接运行 EXE。\n"
        "3. 删除旧解压目录和旧桌面快捷方式，避免继续打开旧版本。\n"
        "4. 如果提示 WebView2 或窗口运行时异常，请安装 Microsoft Edge WebView2 Runtime：\n"
        "   https://go.microsoft.com/fwlink/?LinkId=2124703\n\n"
        f"工具日志目录：{log_dir}\n\n"
        f"启动失败日志：{startup_failure_log}\n\n"
        "这是 Windows 图形客户端，正常启动只需要双击 SSH-Agent-Tool.exe，不需要任何命令行脚本。"
        "若界面无法打开，请查看上方日志目录；界面可打开时，请在工具内通过“工具日志”或“导出诊断包”反馈问题。"
    )

def show_startup_failure_dialog(error: BaseException) -> None:
    message = build_startup_failure_message(error)
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, APP_TITLE, 0x00000010)
    except Exception:
        pass


def build_already_running_message() -> str:
    return (
        "SSH Agent 工具已经在运行。\n\n"
        "如果窗口没有出现在前台，请从 Windows 任务栏切换到 SSH Agent 工具；"
        "也可以先关闭已有窗口后再重新双击 SSH-Agent-Tool.exe。"
    )


def show_already_running_dialog() -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, build_already_running_message(), APP_TITLE, 0x00000040)
    except Exception:
        pass


def focus_existing_window(user32=None, platform: str | None = None) -> bool:
    current_platform = platform or sys.platform
    if current_platform != "win32":
        return False
    try:
        if user32 is None:
            import ctypes

            user32 = ctypes.windll.user32
        hwnd = user32.FindWindowW(None, APP_TITLE)
        if not hwnd:
            return False
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, 9)
        else:
            user32.ShowWindow(hwnd, 5)
        return bool(user32.SetForegroundWindow(hwnd))
    except Exception as error:
        log_tool_exception("runtime", "focus_existing_window_failed", error, {"title": APP_TITLE})
        return False


class SingleInstanceLock:
    def __init__(self, handle=None):
        self.handle = handle

    def release(self) -> None:
        if not self.handle or sys.platform != "win32":
            return
        try:
            import ctypes

            ctypes.windll.kernel32.CloseHandle(self.handle)
        except Exception:
            pass
        finally:
            self.handle = None


def acquire_single_instance_lock():
    if sys.platform != "win32":
        return SingleInstanceLock()
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.CreateMutexW(None, False, SINGLE_INSTANCE_MUTEX_NAME)
        if not handle:
            return SingleInstanceLock()
        if kernel32.GetLastError() == WINDOWS_ERROR_ALREADY_EXISTS:
            kernel32.CloseHandle(handle)
            return None
        return SingleInstanceLock(handle)
    except Exception as error:
        log_tool_exception("runtime", "single_instance_lock_failed", error, {"mutex": SINGLE_INSTANCE_MUTEX_NAME})
        return SingleInstanceLock()


def run_desktop_entry(entry=main, argv=None) -> int:
    hide_packaged_console()
    install_runtime_exception_logging()
    smoke_request = parse_startup_smoke_request(argv)
    if smoke_request is not None:
        report = build_startup_smoke_report(output_path=smoke_request.get("outputPath"))
        try:
            sys.stdout.write(json.dumps(report, ensure_ascii=False) + "\n")
        except Exception:
            pass
        return 0 if report.get("ok") else 1

    instance_lock = None
    try:
        instance_lock = acquire_single_instance_lock()
        if instance_lock is None:
            log_tool_event(
                {
                    "level": "warn",
                    "component": "app",
                    "action": "app_already_running",
                    "message": "已有一个 SSH Agent 工具实例正在运行。",
                    "context": {"pid": os.getpid()},
                }
            )
            if not focus_existing_window():
                show_already_running_dialog()
            return 0
        return int(entry())
    except BaseException as error:
        failure_context = build_startup_failure_context()
        log_tool_exception(
            "runtime",
            "startup_failed",
            error,
            failure_context,
        )
        write_latest_startup_failure_log(error, failure_context)
        show_startup_failure_dialog(error)
        return 1
    finally:
        if instance_lock is not None:
            instance_lock.release()


if __name__ == "__main__":
    raise SystemExit(run_desktop_entry())
