import json
import hashlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import desktop_app
from desktop_app import DesktopApi


class ReleaseManifestTests(unittest.TestCase):
    def test_windows_exe_build_embeds_native_version_resource(self):
        project_root = Path(__file__).resolve().parent
        build_script = (project_root / "build-windows-exe.ps1").read_text(encoding="utf-8")
        spec_text = (project_root / "ssh-agent-ui-preview.spec").read_text(encoding="utf-8")

        self.assertIn("Write-WindowsVersionInfo", build_script)
        self.assertIn("VSVersionInfo", build_script)
        self.assertIn(r"SSH Agent \u5de5\u5177", build_script)
        self.assertIn("SSH-Agent-Tool.exe", build_script)
        self.assertIn("version=str(project_root / \"build\" / \"windows-version-info.txt\")", spec_text)

    def test_release_package_smoke_check_requires_windows_gui_subsystem(self):
        project_root = Path(__file__).resolve().parent
        package_script = (project_root / "build-windows-client-package.ps1").read_text(encoding="utf-8")

        self.assertIn("Get-WindowsPeSubsystem", package_script)
        self.assertIn("$PackageExeSubsystem -ne 2", package_script)
        self.assertIn("Windows GUI", package_script)
        self.assertIn("正式 Windows 客户端包不能是控制台子系统程序", package_script)

    def test_release_package_places_clickable_exe_at_delivery_root(self):
        project_root = Path(__file__).resolve().parent
        package_script = (project_root / "build-windows-client-package.ps1").read_text(encoding="utf-8")

        self.assertIn("$DeliveryExePath = Join-Path $DeliveryDir \"SSH-Agent-Tool.exe\"", package_script)
        self.assertIn("Copy-Item -LiteralPath $PackageExe -Destination $DeliveryExePath -Force", package_script)
        self.assertIn("$DeliveryExePath,", package_script)
        self.assertIn("$DeliveryExeSubsystem = Get-WindowsPeSubsystem -Path $DeliveryExePath", package_script)
        self.assertIn("$ActualDeliveryExeHash = (Get-FileHash -LiteralPath $DeliveryExePath -Algorithm SHA256).Hash", package_script)

    def test_release_package_keeps_user_delivery_directory_flat(self):
        project_root = Path(__file__).resolve().parent
        package_script = (project_root / "build-windows-client-package.ps1").read_text(encoding="utf-8")

        self.assertNotIn("DeliveryCurrentClientDir", package_script)
        self.assertNotIn("Copy-Item -LiteralPath $CurrentClientDir -Destination", package_script)
        self.assertIn("用户交付根目录每次打包都会刷新，只保留普通客户端入口、说明、版本清单和 ZIP", package_script)
        self.assertNotIn("用户交付目录中的 EXE 不能是控制台子系统程序", package_script)

    def test_release_package_falls_back_when_delivery_exe_is_locked(self):
        project_root = Path(__file__).resolve().parent
        package_script = (project_root / "build-windows-client-package.ps1").read_text(encoding="utf-8")

        self.assertIn("catch [System.IO.IOException]", package_script)
        self.assertIn('"用户交付-$PackageName"', package_script)
        self.assertIn("用户交付目录中的旧 EXE 正在运行", package_script)
        self.assertIn("$DeliveryExePath = Join-Path $DeliveryDir \"SSH-Agent-Tool.exe\"", package_script)
        self.assertIn("Copy-Item -LiteralPath $PackageExe -Destination $DeliveryExePath -Force", package_script)

    def test_read_release_manifest_from_adjacent_manifest_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest_path = Path(temp_dir) / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "appName": "SSH Agent 工具",
                        "version": "20260628",
                        "generatedAt": "2026-06-26 10:36:12",
                        "updateChannel": "stable",
                        "executable": "SSH-Agent-Tool.exe",
                        "sha256": "ABCDEF123456",
                        "sizeBytes": 18435904,
                        "updateCheckUrl": "https://updates.example.com/ssh-agent/latest.json",
                        "releaseNotesUrl": "https://updates.example.com/ssh-agent/notes",
                        "supportUrl": "https://support.example.com/ssh-agent",
                        "updatePolicy": "手动检查更新",
                        "currentPackageUrl": "https://updates.example.com/ssh-agent/SSH-Agent-Tool-20260628.zip",
                        "features": ["SSH 服务器管理", "Agent 扩展"],
                        "verification": [
                            {"name": "frontend", "command": "pnpm test", "result": "588 passed", "status": "passed"},
                            {"name": "backend", "command": "python -m unittest discover", "result": "221 passed", "status": "passed"},
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                result = DesktopApi().read_release_manifest()

        self.assertTrue(result["ok"])
        self.assertEqual(result["appName"], "SSH Agent 工具")
        self.assertEqual(result["version"], "20260628")
        self.assertEqual(result["updateChannel"], "stable")
        self.assertEqual(result["executable"], "SSH-Agent-Tool.exe")
        self.assertEqual(result["sha256"], "ABCDEF123456")
        self.assertEqual(result["sizeBytes"], 18435904)
        self.assertEqual(result["updateCheckUrl"], "https://updates.example.com/ssh-agent/latest.json")
        self.assertEqual(result["releaseNotesUrl"], "https://updates.example.com/ssh-agent/notes")
        self.assertEqual(result["supportUrl"], "https://support.example.com/ssh-agent")
        self.assertEqual(result["updatePolicy"], "手动检查更新")
        self.assertEqual(result["currentPackageUrl"], "https://updates.example.com/ssh-agent/SSH-Agent-Tool-20260628.zip")
        self.assertEqual(result["features"], ["SSH 服务器管理", "Agent 扩展"])
        self.assertEqual(result["verification"][0]["name"], "frontend")
        self.assertEqual(result["verification"][0]["result"], "588 passed")
        self.assertEqual(result["verification"][1]["command"], "python -m unittest discover")

    def test_read_release_manifest_returns_safe_default_when_missing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(desktop_app, "release_manifest_path", lambda: Path(temp_dir) / "missing.json"):
                with patch.object(
                    desktop_app,
                    "read_embedded_release_manifest",
                    return_value=desktop_app.default_release_manifest(),
                ):
                    result = DesktopApi().read_release_manifest()

        self.assertFalse(result["ok"])
        self.assertEqual(result["appName"], "SSH Agent 工具")
        self.assertEqual(result["version"], "dev")
        self.assertEqual(result["updateChannel"], "local")
        self.assertEqual(result["executable"], "SSH-Agent-Tool.exe")
        self.assertEqual(result["updateCheckUrl"], "")
        self.assertEqual(result["releaseNotesUrl"], "")
        self.assertEqual(result["supportUrl"], "")
        self.assertEqual(result["features"], [])
        self.assertEqual(result["verification"], [])
        self.assertIn("manifest", result["message"])

    def test_read_release_manifest_uses_embedded_version_when_manifest_missing(self):
        embedded = {
            "ok": True,
            "appName": "SSH Agent 工具",
            "version": "20260630",
            "packageName": "SSH-Agent-Tool-20260630",
            "generatedAt": "2026-06-30 19:00:00",
            "updateChannel": "stable",
            "executable": "SSH-Agent-Tool.exe",
            "message": "已使用 EXE 内置版本信息。",
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(desktop_app, "release_manifest_path", lambda: Path(temp_dir) / "missing.json"):
                with patch.object(desktop_app, "read_embedded_release_manifest", return_value=embedded):
                    result = DesktopApi().read_release_manifest()

        self.assertTrue(result["ok"])
        self.assertEqual(result["version"], "20260630")
        self.assertEqual(result["packageName"], "SSH-Agent-Tool-20260630")
        self.assertEqual(result["updateChannel"], "stable")
        self.assertEqual(result["executable"], "SSH-Agent-Tool.exe")
        self.assertIn("内置版本", result["message"])

    def test_read_release_manifest_merges_local_latest_for_standalone_exe(self):
        embedded = {
            "ok": True,
            "appName": "SSH Agent Tool",
            "version": "20260630",
            "packageName": "SSH-Agent-Tool-20260630",
            "generatedAt": "2026-06-30 19:00:00",
            "updateChannel": "stable",
            "executable": "SSH-Agent-Tool.exe",
            "message": "embedded release metadata",
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            missing_manifest_path = root / "manifest.json"
            latest_path = root / "latest.json"
            latest_path.write_text(
                json.dumps(
                    {
                        "version": "20260630",
                        "packageName": "SSH-Agent-Tool-20260630",
                        "packageFile": "SSH-Agent-Tool-20260630.zip",
                        "packageSha256": "ZIP123",
                        "standaloneExe": "SSH-Agent-Tool.exe",
                        "standaloneExeSha256": "EXE123",
                        "verification": [{"name": "frontend", "status": "passed", "result": "ok"}],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: missing_manifest_path):
                with patch.object(desktop_app, "read_embedded_release_manifest", return_value=embedded):
                    result = DesktopApi().read_release_manifest()

        self.assertTrue(result["ok"])
        self.assertEqual(result["version"], "20260630")
        self.assertEqual(result["packageFile"], "SSH-Agent-Tool-20260630.zip")
        self.assertEqual(result["packageSha256"], "ZIP123")
        self.assertEqual(result["standaloneExe"], "SSH-Agent-Tool.exe")
        self.assertEqual(result["standaloneExeSha256"], "EXE123")
        self.assertEqual(result["verification"][0]["status"], "passed")

    def test_read_release_manifest_rejects_invalid_json_without_crashing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest_path = Path(temp_dir) / "manifest.json"
            manifest_path.write_text("{not-json", encoding="utf-8")

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                result = DesktopApi().read_release_manifest()

        self.assertFalse(result["ok"])
        self.assertEqual(result["version"], "dev")
        self.assertEqual(result["updateChannel"], "local")
        self.assertIn("读取版本清单失败", result["message"])

    def test_read_release_manifest_falls_back_to_embedded_version_when_manifest_is_corrupt(self):
        embedded = {
            "ok": True,
            "appName": "SSH Agent",
            "version": "20260630",
            "packageName": "SSH-Agent-Tool-20260630",
            "generatedAt": "2026-06-30 19:00:00",
            "updateChannel": "stable",
            "executable": "SSH-Agent-Tool.exe",
            "message": "embedded release metadata",
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            manifest_path = Path(temp_dir) / "manifest.json"
            manifest_path.write_text("{not-json", encoding="utf-8")

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "read_embedded_release_manifest", return_value=embedded):
                    result = DesktopApi().read_release_manifest()

        self.assertTrue(result["ok"])
        self.assertEqual(result["version"], "20260630")
        self.assertEqual(result["packageName"], "SSH-Agent-Tool-20260630")
        self.assertEqual(result["updateChannel"], "stable")
        self.assertIn("manifest", result["message"].lower())

    def test_read_runtime_diagnostics_returns_safe_environment_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)

            with patch.object(desktop_app, "app_data_root", lambda: root):
                with patch.object(desktop_app, "tool_log_path", lambda: root / "tool-logs"):
                    with patch.object(desktop_app, "session_log_path", lambda: root / "session-logs"):
                        with patch.object(desktop_app, "detect_webview2_runtime", return_value={"available": True, "source": "registry", "version": "126.0.2592.113"}):
                            result = DesktopApi().read_runtime_diagnostics()

        self.assertTrue(result["ok"])
        self.assertEqual(result["webView2Runtime"]["available"], True)
        self.assertEqual(result["webView2Runtime"]["version"], "126.0.2592.113")
        self.assertIn("executable", result)
        self.assertIn("appDataRoot", result)
        self.assertIn("toolLogDir", result)
        self.assertIn("sessionLogDir", result)
        self.assertNotIn("apiKey", json.dumps(result, ensure_ascii=False))

    def test_read_runtime_diagnostics_includes_startup_repair_advice(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)

            with patch.object(desktop_app, "app_data_root", lambda: root):
                with patch.object(desktop_app, "tool_log_path", lambda: root / "tool-logs"):
                    with patch.object(desktop_app, "session_log_path", lambda: root / "session-logs"):
                        with patch.object(desktop_app, "detect_webview2_runtime", return_value={"available": True, "source": "registry", "version": "126.0.2592.113"}):
                            result = DesktopApi().read_runtime_diagnostics()

        self.assertIn("startupRepairAdvice", result)
        self.assertIsInstance(result["startupRepairAdvice"], list)
        self.assertGreaterEqual(len(result["startupRepairAdvice"]), 1)
        advice_text = "\n".join(result["startupRepairAdvice"])
        self.assertIn("SSH-Agent-Tool.exe", advice_text)
        self.assertIn("startup-failure-latest.log", advice_text)

    def test_client_entry_diagnostics_rejects_zip_preview_temp_executable(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            temp_root = root / "Temp"
            exe_dir = temp_root / "zip-preview"
            exe_dir.mkdir(parents=True)
            exe_path = exe_dir / "SSH-Agent-Tool.exe"
            manifest_path = root / "manifest.json"
            ui_index_path = root / "dist" / "index.html"
            ui_index_path.parent.mkdir(parents=True)
            manifest_path.write_text("{}", encoding="utf-8")
            ui_index_path.write_text("<html></html>", encoding="utf-8")

            result = desktop_app.build_client_entry_diagnostics(
                executable=exe_path,
                cwd=root,
                resource_root_path=root,
                manifest_path=manifest_path,
                ui_index_path=ui_index_path,
                temp_root=temp_root,
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["riskLevel"], "error")
        self.assertTrue(result["inTempExecutableDirectory"])
        self.assertTrue(result["likelyZipPreviewDirectory"])
        self.assertIn("SSH-Agent-Tool.exe", result["recommendedEntry"])

    def test_startup_smoke_report_exposes_package_identity_for_release_self_check(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            dist = root / "dist"
            assets = dist / "assets"
            assets.mkdir(parents=True)
            (assets / "index-test.js").write_text("console.log('identity smoke');", encoding="utf-8")
            (assets / "index-test.css").write_text("body { color: #222; }", encoding="utf-8")
            index_path = dist / "index.html"
            index_path.write_text(
                '<script type="module" crossorigin src="./assets/index-test.js"></script>'
                '<link rel="stylesheet" crossorigin href="./assets/index-test.css">',
                encoding="utf-8",
            )
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "version": "20260630",
                        "packageName": "SSH-Agent-Tool-20260630",
                        "executable": "SSH-Agent-Tool.exe",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "ui_index_path", lambda: index_path):
                    with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                        with patch.object(desktop_app, "tool_log_path", lambda: root / "logs"):
                            with patch.object(
                                desktop_app,
                                "detect_webview2_runtime",
                                return_value={"available": True, "source": "test", "version": "126"},
                            ):
                                report = desktop_app.build_startup_smoke_report()

        self.assertTrue(report["ok"])
        self.assertEqual(report["version"], "20260630")
        self.assertEqual(report["packageName"], "SSH-Agent-Tool-20260630")
        self.assertEqual(report["manifest"]["version"], "20260630")

    def test_startup_smoke_report_exposes_frontend_asset_fingerprint(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            dist = root / "dist"
            assets = dist / "assets"
            assets.mkdir(parents=True)
            script_path = assets / "index-test.js"
            style_path = assets / "index-test.css"
            script_path.write_text("console.log('fresh build');", encoding="utf-8")
            style_path.write_text("body { color: #111; }", encoding="utf-8")
            expected_script_sha256 = hashlib.sha256(script_path.read_bytes()).hexdigest().upper()
            expected_stylesheet_sha256 = hashlib.sha256(style_path.read_bytes()).hexdigest().upper()
            index_path = dist / "index.html"
            index_path.write_text(
                '<script type="module" crossorigin src="./assets/index-test.js"></script>'
                '<link rel="stylesheet" crossorigin href="./assets/index-test.css">',
                encoding="utf-8",
            )
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                json.dumps({"version": "20260630", "packageName": "SSH-Agent-Tool-20260630"}),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "ui_index_path", lambda: index_path):
                with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                    with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                        with patch.object(desktop_app, "tool_log_path", lambda: root / "logs"):
                            with patch.object(
                                desktop_app,
                                "detect_webview2_runtime",
                                return_value={"available": True, "source": "test", "version": "126"},
                            ):
                                report = desktop_app.build_startup_smoke_report()

        self.assertTrue(report["frontendAssets"]["ok"])
        self.assertEqual(report["frontendAssets"]["script"], "assets/index-test.js")
        self.assertEqual(report["frontendAssets"]["stylesheet"], "assets/index-test.css")
        self.assertEqual(report["frontendAssets"]["scriptSha256"], expected_script_sha256)
        self.assertEqual(report["frontendAssets"]["stylesheetSha256"], expected_stylesheet_sha256)

    def test_check_release_update_explains_missing_update_source(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest_path = Path(temp_dir) / "manifest.json"
            manifest_path.write_text(
                json.dumps({"version": "20260629", "updateCheckUrl": ""}, ensure_ascii=False),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                result = DesktopApi().check_release_update()

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "not_configured")
        self.assertIn("未配置远程更新源", result["message"])
        self.assertIn("版本信息", result["message"])
        self.assertIn("latest.json", result["message"])
        self.assertNotIn("后续更新服务", result["message"])

    def test_check_release_update_uses_embedded_version_for_single_exe_without_manifest(self):
        embedded = {
            "ok": True,
            "appName": "SSH Agent 工具",
            "version": "20260630",
            "packageName": "SSH-Agent-Tool-20260630",
            "generatedAt": "2026-06-30 19:00:00",
            "updateChannel": "stable",
            "executable": "SSH-Agent-Tool.exe",
            "message": "已使用 EXE 内置版本信息。",
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            missing_manifest_path = root / "manifest.json"

            with patch.object(desktop_app, "release_manifest_path", lambda: missing_manifest_path):
                with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                    with patch.object(desktop_app, "read_embedded_release_manifest", return_value=embedded):
                        result = DesktopApi().check_release_update()

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "not_configured")
        self.assertEqual(result["currentVersion"], "20260630")
        self.assertEqual(result["latestVersion"], "")

    def test_check_release_update_uses_local_latest_manifest_when_remote_source_missing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_root = root / "SSH-Agent-Tool-20260629"
            package_root.mkdir()
            manifest_path = package_root / "manifest.json"
            latest_path = root / "latest.json"
            manifest_path.write_text(
                json.dumps({"version": "20260629", "updateCheckUrl": ""}, ensure_ascii=False),
                encoding="utf-8",
            )
            latest_path.write_text(
                json.dumps(
                    {
                        "version": "20260630",
                        "packageFile": "SSH-Agent-Tool-20260630.zip",
                        "packageSha256": "A" * 64,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                result = DesktopApi().check_release_update()

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "available")
        self.assertEqual(result["updateSource"], "local")
        self.assertEqual(result["latestVersion"], "20260630")
        self.assertEqual(result["packageFile"], "SSH-Agent-Tool-20260630.zip")

    def test_check_release_update_uses_latest_manifest_beside_standalone_exe(self):
        embedded = {
            "ok": True,
            "appName": "SSH Agent Tool",
            "version": "20260629",
            "packageName": "SSH-Agent-Tool-20260629",
            "generatedAt": "2026-06-29 19:00:00",
            "updateChannel": "stable",
            "executable": "SSH-Agent-Tool.exe",
            "message": "embedded release metadata",
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            release_root = Path(temp_dir)
            missing_manifest_path = release_root / "manifest.json"
            latest_path = release_root / "latest.json"
            latest_path.write_text(
                json.dumps(
                    {
                        "version": "20260630",
                        "packageFile": "SSH-Agent-Tool-20260630.zip",
                        "packageSha256": "A" * 64,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: missing_manifest_path):
                with patch.object(desktop_app, "read_embedded_release_manifest", return_value=embedded):
                    result = DesktopApi().check_release_update()

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "available")
        self.assertEqual(result["updateSource"], "local")
        self.assertEqual(result["latestVersion"], "20260630")
        self.assertEqual(result["packageFile"], "SSH-Agent-Tool-20260630.zip")

    def test_check_release_update_guides_in_app_install_instead_of_manual_replacement(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_root = root / "SSH-Agent-Tool-20260629"
            package_root.mkdir()
            manifest_path = package_root / "manifest.json"
            latest_path = root / "latest.json"
            manifest_path.write_text(
                json.dumps({"version": "20260629", "updateCheckUrl": ""}, ensure_ascii=False),
                encoding="utf-8",
            )
            latest_path.write_text(
                json.dumps(
                    {
                        "version": "20260630",
                        "packageFile": "SSH-Agent-Tool-20260630.zip",
                        "packageSha256": "A" * 64,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                result = DesktopApi().check_release_update()

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "available")
        self.assertIn("下载并校验更新包", result["message"])
        self.assertIn("安装并重启", result["message"])
        self.assertNotRegex(result["message"], r"手动替换|再替换运行|关闭当前工具再替换")

    def test_save_and_read_release_update_settings_persists_custom_update_source(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "data" / "config.json"

            with patch.object(desktop_app, "app_config_path", lambda: config_path):
                saved = DesktopApi().save_release_update_settings(
                    {
                        "updateCheckUrl": " https://updates.example.com/ssh-agent/latest.json ",
                        "autoCheckOnStartup": True,
                    }
                )
                loaded = DesktopApi().read_release_update_settings()
                config_text = config_path.read_text(encoding="utf-8")

        self.assertTrue(saved["ok"])
        self.assertEqual(saved["state"], "saved")
        self.assertEqual(saved["updateCheckUrl"], "https://updates.example.com/ssh-agent/latest.json")
        self.assertTrue(saved["autoCheckOnStartup"])
        self.assertEqual(loaded["updateCheckUrl"], "https://updates.example.com/ssh-agent/latest.json")
        self.assertTrue(loaded["autoCheckOnStartup"])
        saved_config = json.loads(config_text)
        self.assertEqual(
            saved_config["releaseUpdateSettings"]["updateCheckUrl"],
            "https://updates.example.com/ssh-agent/latest.json",
        )
        self.assertTrue(saved_config["releaseUpdateSettings"]["autoCheckOnStartup"])

    def test_check_release_update_uses_saved_update_source_before_packaged_manifest(self):
        latest_manifest = {
            "version": "20260630",
            "currentPackageUrl": "https://updates.example.com/SSH-Agent-Tool-20260630.zip",
            "packageSha256": "A" * 64,
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_root = root / "SSH-Agent-Tool-20260629"
            package_root.mkdir()
            manifest_path = package_root / "manifest.json"
            config_path = root / "data" / "config.json"
            manifest_path.write_text(
                json.dumps({"version": "20260629", "updateCheckUrl": ""}, ensure_ascii=False),
                encoding="utf-8",
            )
            config_path.parent.mkdir(parents=True)
            config_path.write_text(
                json.dumps(
                    {"releaseUpdateSettings": {"updateCheckUrl": "https://updates.example.com/custom/latest.json"}},
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "app_config_path", lambda: config_path):
                    with patch.object(desktop_app, "fetch_remote_release_manifest", return_value=latest_manifest) as fetch:
                        result = DesktopApi().check_release_update()

        fetch.assert_called_once_with("https://updates.example.com/custom/latest.json")
        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "available")
        self.assertEqual(result["updateSource"], "remote")
        self.assertEqual(result["packageUrl"], "https://updates.example.com/SSH-Agent-Tool-20260630.zip")

    def test_write_app_config_preserves_saved_release_update_source_when_omitted(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "data" / "config.json"

            with patch.object(desktop_app, "app_config_path", lambda: config_path):
                DesktopApi().save_release_update_settings({"updateCheckUrl": "https://updates.example.com/latest.json"})
                DesktopApi().write_app_config(
                    {
                        "customServers": {"prod-web-01": {"ip": "10.0.1.23"}},
                        "modelConfig": {"provider": "OpenAI 兼容", "baseUrl": "https://api.example.com/v1", "model": "gpt-test"},
                    }
                )
                settings = DesktopApi().read_release_update_settings()

        self.assertEqual(settings["updateCheckUrl"], "https://updates.example.com/latest.json")

    def test_write_and_read_app_config_preserves_ssh_workflow_presets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "data" / "config.json"
            port_presets = [
                {
                    "id": "pf-prod-web",
                    "name": "Nginx 管理页",
                    "serverName": "prod-web-01",
                    "localHost": "127.0.0.1",
                    "localPort": 18080,
                    "remoteHost": "127.0.0.1",
                    "remotePort": 80,
                    "type": "local",
                }
            ]
            snippets = [{"id": "cmd-df", "label": "磁盘使用", "command": "df -hT"}]

            with patch.object(desktop_app, "app_config_path", lambda: config_path):
                DesktopApi().write_app_config(
                    {
                        "customServers": {"prod-web-01": {"ip": "10.0.1.23"}},
                        "portForwardPresets": port_presets,
                        "customCommandSnippets": snippets,
                    }
                )
                config = DesktopApi().read_app_config()

        self.assertEqual(config["portForwardPresets"], port_presets)
        self.assertEqual(config["customCommandSnippets"], snippets)

    def test_check_release_update_reports_newer_remote_manifest(self):
        latest_manifest = {
            "version": "20260630",
            "generatedAt": "2026-06-30 09:10:00",
            "currentPackageUrl": "https://updates.example.com/SSH-Agent-Tool-20260630.zip",
            "releaseNotesUrl": "https://updates.example.com/notes/20260630",
            "packageSha256": "A" * 64,
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest_path = Path(temp_dir) / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "version": "20260629",
                        "updateCheckUrl": "https://updates.example.com/latest.json",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "fetch_remote_release_manifest", return_value=latest_manifest, create=True):
                    result = DesktopApi().check_release_update()

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "available")
        self.assertEqual(result["currentVersion"], "20260629")
        self.assertEqual(result["latestVersion"], "20260630")
        self.assertEqual(result["packageUrl"], "https://updates.example.com/SSH-Agent-Tool-20260630.zip")
        self.assertEqual(result["releaseNotesUrl"], "https://updates.example.com/notes/20260630")
        self.assertIn("发现新版本 20260630", result["message"])

    def test_check_release_update_reports_same_version_new_build(self):
        latest_manifest = {
            "version": "20260704",
            "generatedAt": "2026-07-04 08:30:00",
            "currentPackageUrl": "https://updates.example.com/SSH-Agent-Tool-20260704.zip",
            "packageSha256": "B" * 64,
            "standaloneExeSha256": "D" * 64,
            "frontendAssets": {
                "script": "assets/index-new.js",
                "scriptSha256": "F" * 64,
            },
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest_path = Path(temp_dir) / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "version": "20260704",
                        "updateCheckUrl": "https://updates.example.com/latest.json",
                        "packageSha256": "A" * 64,
                        "standaloneExeSha256": "C" * 64,
                        "frontendAssets": {
                            "script": "assets/index-old.js",
                            "scriptSha256": "E" * 64,
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "fetch_remote_release_manifest", return_value=latest_manifest, create=True):
                    result = DesktopApi().check_release_update()

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "available")
        self.assertEqual(result["currentVersion"], "20260704")
        self.assertEqual(result["latestVersion"], "20260704")
        self.assertTrue(result["sameVersionChangedBuild"])
        self.assertEqual(result["packageSha256"], "B" * 64)
        self.assertIn("20260704", result["message"])

    def test_check_release_update_blocks_incomplete_newer_remote_manifest_before_download(self):
        cases = [
            (
                {
                    "version": "20260630",
                    "packageFile": "SSH-Agent-Tool-20260630.zip",
                },
                "missing_package_sha256",
                "SHA256",
            ),
            (
                {
                    "version": "20260630",
                    "packageSha256": "A" * 64,
                },
                "missing_package_url",
                "下载地址",
            ),
        ]
        for latest_manifest, expected_state, expected_message in cases:
            with self.subTest(expected_state=expected_state):
                with tempfile.TemporaryDirectory() as temp_dir:
                    manifest_path = Path(temp_dir) / "manifest.json"
                    manifest_path.write_text(
                        json.dumps(
                            {
                                "version": "20260629",
                                "updateCheckUrl": "https://updates.example.com/ssh-agent/latest.json",
                            },
                            ensure_ascii=False,
                        ),
                        encoding="utf-8",
                    )

                    with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                        with patch.object(desktop_app, "fetch_remote_release_manifest", return_value=latest_manifest, create=True):
                            result = DesktopApi().check_release_update()

                self.assertFalse(result["ok"])
                self.assertEqual(result["state"], expected_state)
                self.assertIn(expected_message, result["message"])

    def test_check_release_update_records_remote_failures_without_masking_error(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "version": "20260629",
                        "updateCheckUrl": "https://updates.example.com/latest.json",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                    with patch.object(desktop_app, "write_release_update_status", wraps=desktop_app.write_release_update_status) as write_status:
                        with patch.object(desktop_app, "fetch_remote_release_manifest", side_effect=RuntimeError("network down"), create=True):
                            result = DesktopApi().check_release_update()
                    status_path = desktop_app.release_update_status_path()
                    status = json.loads(status_path.read_text(encoding="utf-8"))

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "failed")
        self.assertEqual(result["updateSource"], "remote")
        self.assertIn("network down", result["message"])
        self.assertEqual(status["status"], "failed")
        self.assertEqual(status["updateSource"], "remote")
        self.assertEqual(status["updateCheckUrl"], "https://updates.example.com/latest.json")
        self.assertIn("network down", status["message"])
        self.assertEqual(status["message"], result["message"])
        self.assertEqual(write_status.call_count, 1)

    def test_check_release_update_infers_package_url_from_remote_latest_manifest_directory(self):
        latest_manifest = {
            "version": "20260630",
            "packageFile": "SSH-Agent-Tool-20260630.zip",
            "packageSha256": "A" * 64,
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest_path = Path(temp_dir) / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "version": "20260629",
                        "updateCheckUrl": "https://updates.example.com/ssh-agent/latest.json",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "fetch_remote_release_manifest", return_value=latest_manifest, create=True):
                    result = DesktopApi().check_release_update()

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "available")
        self.assertEqual(result["packageFile"], "SSH-Agent-Tool-20260630.zip")
        self.assertEqual(result["packageUrl"], "https://updates.example.com/ssh-agent/SSH-Agent-Tool-20260630.zip")


    def test_download_release_update_saves_package_and_verifies_sha256(self):
        package_bytes = b"fake-update-zip"
        package_sha256 = hashlib.sha256(package_bytes).hexdigest().upper()
        latest_manifest = {
            "version": "20260630",
            "generatedAt": "2026-06-30 09:10:00",
            "currentPackageUrl": "https://updates.example.com/SSH-Agent-Tool-20260630.zip",
            "packageFile": "SSH-Agent-Tool-20260630.zip",
            "packageSha256": package_sha256,
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "version": "20260629",
                        "updateCheckUrl": "https://updates.example.com/latest.json",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                    with patch.object(desktop_app, "fetch_remote_release_manifest", return_value=latest_manifest, create=True):
                        with patch.object(desktop_app, "download_remote_release_package", return_value=package_bytes, create=True):
                            result = DesktopApi().download_release_update()
                            downloaded_bytes = Path(result["localPath"]).read_bytes()

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "downloaded")
        self.assertEqual(result["latestVersion"], "20260630")
        self.assertEqual(result["sha256"], package_sha256)
        self.assertEqual(result["sizeBytes"], len(package_bytes))
        self.assertTrue(result["localPath"].endswith("SSH-Agent-Tool-20260630.zip"))
        self.assertEqual(result["nextAction"], "install_and_restart")
        self.assertEqual(result["nextActionLabel"], "安装并重启")
        self.assertIn("安装并重启", result["message"])
        self.assertEqual(downloaded_bytes, package_bytes)

    def test_download_release_update_infers_remote_package_url_from_package_file(self):
        package_bytes = b"fake-update-zip"
        package_sha256 = hashlib.sha256(package_bytes).hexdigest().upper()
        latest_manifest = {
            "version": "20260630",
            "packageFile": "SSH-Agent-Tool-20260630.zip",
            "packageSha256": package_sha256,
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "version": "20260629",
                        "updateCheckUrl": "https://updates.example.com/ssh-agent/latest.json",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                    with patch.object(desktop_app, "fetch_remote_release_manifest", return_value=latest_manifest, create=True):
                        with patch.object(desktop_app, "download_remote_release_package", return_value=package_bytes, create=True) as download:
                            result = DesktopApi().download_release_update()

        download.assert_called_once_with("https://updates.example.com/ssh-agent/SSH-Agent-Tool-20260630.zip")
        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "downloaded")
        self.assertEqual(result["packageUrl"], "https://updates.example.com/ssh-agent/SSH-Agent-Tool-20260630.zip")

    def test_download_release_update_uses_local_latest_package_when_remote_source_missing(self):
        package_bytes = b"local-update-zip"
        package_sha256 = hashlib.sha256(package_bytes).hexdigest().upper()
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_root = root / "SSH-Agent-Tool-20260629"
            package_root.mkdir()
            manifest_path = package_root / "manifest.json"
            latest_path = root / "latest.json"
            package_path = root / "SSH-Agent-Tool-20260630.zip"
            manifest_path.write_text(
                json.dumps({"version": "20260629", "updateCheckUrl": ""}, ensure_ascii=False),
                encoding="utf-8",
            )
            latest_path.write_text(
                json.dumps(
                    {
                        "version": "20260630",
                        "packageFile": "SSH-Agent-Tool-20260630.zip",
                        "packageSha256": package_sha256,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            package_path.write_bytes(package_bytes)

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                    result = DesktopApi().download_release_update()
                    downloaded_bytes = Path(result["localPath"]).read_bytes() if result.get("localPath") else b""

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "downloaded")
        self.assertEqual(result["updateSource"], "local")
        self.assertEqual(result["latestVersion"], "20260630")
        self.assertEqual(result["sha256"], package_sha256)
        self.assertEqual(downloaded_bytes, package_bytes)

    def test_download_release_update_rejects_package_with_wrong_sha256(self):
        latest_manifest = {
            "version": "20260630",
            "currentPackageUrl": "https://updates.example.com/SSH-Agent-Tool-20260630.zip",
            "packageFile": "SSH-Agent-Tool-20260630.zip",
            "packageSha256": "0" * 64,
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "version": "20260629",
                        "updateCheckUrl": "https://updates.example.com/latest.json",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                    with patch.object(desktop_app, "fetch_remote_release_manifest", return_value=latest_manifest, create=True):
                        with patch.object(desktop_app, "download_remote_release_package", return_value=b"tampered", create=True):
                            result = DesktopApi().download_release_update()

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "checksum_failed")
        self.assertFalse((root / "data" / "updates" / "SSH-Agent-Tool-20260630.zip").exists())

    def test_download_release_update_rejects_remote_manifest_without_sha256(self):
        latest_manifest = {
            "version": "20260630",
            "currentPackageUrl": "https://updates.example.com/SSH-Agent-Tool-20260630.zip",
            "packageFile": "SSH-Agent-Tool-20260630.zip",
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "version": "20260629",
                        "updateCheckUrl": "https://updates.example.com/latest.json",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                    with patch.object(desktop_app, "fetch_remote_release_manifest", return_value=latest_manifest, create=True):
                        with patch.object(desktop_app, "download_remote_release_package", return_value=b"unchecked") as download_mock:
                            result = DesktopApi().download_release_update()

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "missing_package_sha256")
        self.assertIn("SHA256", result["message"])
        download_mock.assert_not_called()

    def test_download_release_update_rejects_malformed_package_sha256_before_download(self):
        latest_manifest = {
            "version": "20260630",
            "currentPackageUrl": "https://updates.example.com/SSH-Agent-Tool-20260630.zip",
            "packageFile": "SSH-Agent-Tool-20260630.zip",
            "packageSha256": "not-a-sha256",
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "version": "20260629",
                        "updateCheckUrl": "https://updates.example.com/latest.json",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                    with patch.object(desktop_app, "fetch_remote_release_manifest", return_value=latest_manifest, create=True):
                        with patch.object(desktop_app, "download_remote_release_package", return_value=b"unchecked") as download_mock:
                            result = DesktopApi().download_release_update()

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "invalid_package_sha256")
        self.assertIn("SHA256", result["message"])
        download_mock.assert_not_called()

    def test_download_release_update_records_failed_status_for_diagnostics(self):
        latest_manifest = {
            "version": "20260630",
            "currentPackageUrl": "https://updates.example.com/SSH-Agent-Tool-20260630.zip",
            "packageFile": "SSH-Agent-Tool-20260630.zip",
            "packageSha256": "A" * 64,
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "version": "20260629",
                        "updateCheckUrl": "https://updates.example.com/latest.json",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                    with patch.object(desktop_app, "fetch_remote_release_manifest", return_value=latest_manifest, create=True):
                        with patch.object(desktop_app, "download_remote_release_package", side_effect=RuntimeError("network failed"), create=True):
                            result = DesktopApi().download_release_update()
                            status = DesktopApi().read_release_update_status()

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "failed")
        self.assertEqual(status["state"], "failed")
        self.assertIn("network failed", status["message"])
        self.assertTrue(status["statusPath"].endswith("update-status.json"))

    def test_build_release_updater_script_waits_extracts_replaces_and_restarts(self):
        script = desktop_app.build_release_updater_script(
            package_zip=Path(r"C:\Updates\SSH-Agent-Tool-20260630.zip"),
            target_root=Path(r"C:\Tools\SSH-Agent-Tool"),
            executable="SSH-Agent-Tool.exe",
            current_pid=1234,
            log_path=Path(r"C:\Logs\release-updater.log"),
        )

        self.assertIn("Wait-Process -Id 1234", script)
        self.assertIn("Expand-Archive -LiteralPath $PackageZip", script)
        self.assertIn("Copy-Item -LiteralPath", script)
        self.assertIn("Start-Process -FilePath $TargetExe", script)
        self.assertIn("SSH-Agent-Tool-20260630.zip", script)
        self.assertIn("SSH-Agent-Tool.exe", script)
        self.assertNotIn("Set-HiddenFileSystemItem", script)
        self.assertNotIn("高级诊断", script)
        self.assertNotIn("楂樼骇璇婃柇", script)

    def test_build_release_updater_script_writes_status_and_restores_backup_on_failure(self):
        script = desktop_app.build_release_updater_script(
            package_zip=Path(r"C:\Updates\SSH-Agent-Tool-20260630.zip"),
            target_root=Path(r"C:\Tools\SSH-Agent-Tool"),
            executable="SSH-Agent-Tool.exe",
            current_pid=1234,
            log_path=Path(r"C:\Logs\release-updater.log"),
        )

        self.assertIn("update-status.json", script)
        self.assertIn("function Write-UpdaterStatus", script)
        self.assertIn("function Restore-UpdateBackup", script)
        self.assertIn("catch {", script)
        self.assertIn("Restore-UpdateBackup", script)
        self.assertIn("Write-UpdaterStatus -Status 'completed'", script)
        self.assertIn("Write-UpdaterStatus -Status 'failed'", script)

    def test_read_release_update_status_reports_last_updater_result(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            status_path = root / "data" / "updates" / "update-status.json"
            status_path.parent.mkdir(parents=True)
            status_path.write_text(
                json.dumps(
                    {
                        "status": "failed",
                        "message": "replace denied",
                        "updatedAt": "2026-06-30 12:30:00",
                        "packageZip": r"C:\Updates\SSH-Agent-Tool-20260630.zip",
                        "targetRoot": r"C:\Tools\SSH-Agent-Tool",
                    }
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                result = DesktopApi().read_release_update_status()

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "failed")
        self.assertEqual(result["message"], "replace denied")
        self.assertEqual(result["updatedAt"], "2026-06-30 12:30:00")
        self.assertTrue(result["statusPath"].endswith("update-status.json"))
        self.assertTrue(result["logPath"].endswith("release-updater.log"))

    def test_read_release_update_status_explains_missing_status_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                result = DesktopApi().read_release_update_status()

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "no_status")
        self.assertIn("update-status.json", result["statusPath"])

    def test_create_desktop_shortcut_uses_native_windows_shortcut_api(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_root = root / "package"
            package_root.mkdir()
            exe_path = package_root / "SSH-Agent-Tool.exe"
            manifest_path = package_root / "manifest.json"
            exe_path.write_bytes(b"fake exe")
            manifest_path.write_text(json.dumps({"executable": "SSH-Agent-Tool.exe"}), encoding="utf-8")
            shortcut_path = root / "Desktop" / "SSH-Agent-Tool.lnk"

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "create_windows_desktop_shortcut", return_value=shortcut_path) as shortcut_mock:
                    with patch.object(desktop_app.subprocess, "run") as run_mock:
                        result = DesktopApi().create_desktop_shortcut()

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "created")
        self.assertEqual(result["shortcutPath"], str(shortcut_path))
        self.assertEqual(result["targetPath"], str(exe_path))
        self.assertNotIn("scriptPath", result)
        shortcut_mock.assert_called_once_with(exe_path=exe_path.resolve(), shortcut_name="SSH-Agent-Tool.lnk")
        run_mock.assert_not_called()

    def test_desktop_shortcut_api_has_no_legacy_powershell_launcher_path(self):
        source = Path(desktop_app.__file__).read_text(encoding="utf-8")

        self.assertNotIn("build_desktop_shortcut_script", source)
        self.assertNotIn("create-desktop-shortcut.ps1", source)
        self.assertNotIn("DesktopApi.create_desktop_shortcut =", source)

    @unittest.skipUnless(sys.platform == "win32", "Windows shortcut COM API is only available on Windows")
    def test_create_windows_desktop_shortcut_writes_lnk_without_powershell(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            exe_path = root / "SSH-Agent-Tool.exe"
            desktop_path = root / "Desktop"
            exe_path.write_bytes(b"fake exe")

            with patch.object(desktop_app, "get_windows_desktop_directory", return_value=desktop_path):
                shortcut_path = desktop_app.create_windows_desktop_shortcut(exe_path=exe_path, shortcut_name="SSH-Agent-Tool.lnk")

            self.assertEqual(shortcut_path, desktop_path / "SSH-Agent-Tool.lnk")
            self.assertTrue(shortcut_path.exists())
            self.assertGreater(shortcut_path.stat().st_size, 0)

    def test_open_install_directory_launches_explorer_for_package_root(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_root = root / "package"
            package_root.mkdir()
            manifest_path = package_root / "manifest.json"
            manifest_path.write_text(json.dumps({"executable": "SSH-Agent-Tool.exe"}), encoding="utf-8")

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app.subprocess, "Popen") as popen_mock:
                    result = DesktopApi().open_install_directory()

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "opened")
        self.assertEqual(result["path"], str(package_root))
        args = popen_mock.call_args.args[0]
        self.assertEqual(args[0], "explorer.exe")
        self.assertEqual(args[1], str(package_root))
        self.assertIn("creationflags", popen_mock.call_args.kwargs)

    def test_open_app_data_directory_launches_explorer_for_data_root(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            data_root = root / "data"

            with patch.object(desktop_app, "app_data_root", lambda: data_root):
                with patch.object(desktop_app.subprocess, "Popen") as popen_mock:
                    result = DesktopApi().open_app_data_directory()

            self.assertTrue(result["ok"])
            self.assertEqual(result["state"], "opened")
            self.assertEqual(result["path"], str(data_root))
            self.assertTrue(data_root.exists())
            args = popen_mock.call_args.args[0]
            self.assertEqual(args[0], "explorer.exe")
            self.assertEqual(args[1], str(data_root))
            self.assertIn("creationflags", popen_mock.call_args.kwargs)

    def test_prepare_release_update_install_writes_external_updater_script(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_root = root / "package"
            package_root.mkdir()
            package_zip = root / "data" / "updates" / "SSH-Agent-Tool-20260630.zip"
            package_zip.parent.mkdir(parents=True)
            package_zip.write_bytes(b"fake zip")
            package_sha256 = hashlib.sha256(package_zip.read_bytes()).hexdigest().upper()

            with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                with patch.object(desktop_app, "release_manifest_path", lambda: package_root / "manifest.json"):
                    result = DesktopApi().prepare_release_update_install({"localPath": str(package_zip), "expectedSha256": package_sha256})
                    script_text = Path(result["scriptPath"]).read_text(encoding="utf-8-sig")

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "ready")
        self.assertIn("后台更新器", result["message"])
        self.assertNotIn("安装脚本", result["message"])
        self.assertTrue(result["scriptPath"].endswith("install-downloaded-update.ps1"))
        self.assertIn("Wait-Process", script_text)
        self.assertIn("SSH-Agent-Tool-20260630.zip", script_text)
        self.assertIn("Start-Process -FilePath $TargetExe", script_text)

    def test_prepare_release_update_install_records_ready_status_for_diagnostics(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_root = root / "package"
            package_root.mkdir()
            package_zip = root / "data" / "updates" / "SSH-Agent-Tool-20260630.zip"
            package_zip.parent.mkdir(parents=True)
            package_zip.write_bytes(b"fake zip")
            package_sha256 = hashlib.sha256(package_zip.read_bytes()).hexdigest().upper()

            with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                with patch.object(desktop_app, "release_manifest_path", lambda: package_root / "manifest.json"):
                    prepared = DesktopApi().prepare_release_update_install(
                        {"localPath": str(package_zip), "expectedSha256": package_sha256}
                    )
                    status = DesktopApi().read_release_update_status()

        self.assertTrue(prepared["ok"])
        self.assertTrue(status["ok"])
        self.assertEqual(status["state"], "ready")
        self.assertEqual(status["packageZip"], str(package_zip))
        self.assertEqual(status["scriptPath"], prepared["scriptPath"])
        self.assertEqual(status["logPath"], prepared["logPath"])
        self.assertEqual(status["sha256"], package_sha256)
        self.assertEqual(status["expectedSha256"], package_sha256)

    def test_resolve_release_install_target_root_handles_standalone_exe_mode(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            release_root = Path(temp_dir)
            (release_root / "latest.json").write_text(
                json.dumps({"version": "20260630", "standaloneExe": "SSH-Agent-Tool.exe"}),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: release_root / "manifest.json"):
                target = desktop_app.resolve_release_install_target_root()

        self.assertEqual(target["root"], release_root)
        self.assertEqual(target["mode"], "standalone")

    def test_resolve_release_install_target_root_handles_packaged_manifest_mode(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            package_root = Path(temp_dir) / "SSH-Agent-Tool-20260630"
            package_root.mkdir()
            manifest_path = package_root / "manifest.json"
            manifest_path.write_text(json.dumps({"version": "20260630"}), encoding="utf-8")

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                target = desktop_app.resolve_release_install_target_root()

        self.assertEqual(target["root"], package_root)
        self.assertEqual(target["mode"], "packaged")

    def test_prepare_release_update_install_rejects_package_outside_download_dir(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_zip = root / "downloads" / "SSH-Agent-Tool-20260630.zip"
            package_zip.parent.mkdir(parents=True)
            package_zip.write_bytes(b"external zip")

            with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                with patch.object(desktop_app, "release_manifest_path", lambda: root / "package" / "manifest.json"):
                    result = DesktopApi().prepare_release_update_install({"localPath": str(package_zip)})

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "invalid_package_location")
        self.assertIn("updates", result["message"])

    def test_prepare_release_update_install_rejects_package_with_wrong_sha256(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_zip = root / "data" / "updates" / "SSH-Agent-Tool-20260630.zip"
            package_zip.parent.mkdir(parents=True)
            package_zip.write_bytes(b"tampered update zip")

            with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                with patch.object(desktop_app, "release_manifest_path", lambda: root / "package" / "manifest.json"):
                    result = DesktopApi().prepare_release_update_install(
                        {"localPath": str(package_zip), "expectedSha256": "0" * 64}
                    )

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "checksum_failed")
        self.assertEqual(result["expectedSha256"], "0" * 64)
        self.assertNotEqual(result["sha256"], result["expectedSha256"])

    def test_prepare_release_update_install_rejects_missing_sha256(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_root = root / "package"
            package_root.mkdir()
            package_zip = root / "data" / "updates" / "SSH-Agent-Tool-20260630.zip"
            package_zip.parent.mkdir(parents=True)
            package_zip.write_bytes(b"fake zip")

            with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                with patch.object(desktop_app, "release_manifest_path", lambda: root / "package" / "manifest.json"):
                    result = DesktopApi().prepare_release_update_install({"localPath": str(package_zip)})

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "missing_package_sha256")
        self.assertIn("SHA256", result["message"])
        self.assertNotIn("scriptPath", result)

    def test_prepare_release_update_install_rejects_malformed_sha256(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_zip = root / "data" / "updates" / "SSH-Agent-Tool-20260630.zip"
            package_zip.parent.mkdir(parents=True)
            package_zip.write_bytes(b"fake zip")

            with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                with patch.object(desktop_app, "release_manifest_path", lambda: root / "package" / "manifest.json"):
                    result = DesktopApi().prepare_release_update_install(
                        {"localPath": str(package_zip), "expectedSha256": "not-a-sha256"}
                    )

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "invalid_package_sha256")
        self.assertIn("SHA256", result["message"])
        self.assertNotIn("scriptPath", result)

    def test_prepare_release_update_install_rejects_unwritable_target_root(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_zip = root / "data" / "updates" / "SSH-Agent-Tool-20260630.zip"
            package_zip.parent.mkdir(parents=True)
            package_zip.write_bytes(b"fake zip")
            package_sha256 = hashlib.sha256(package_zip.read_bytes()).hexdigest().upper()
            blocked_target = root / "blocked-target"
            blocked_target.write_text("not a directory", encoding="utf-8")

            with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                with patch.object(desktop_app, "release_manifest_path", lambda: root / "package" / "manifest.json"):
                    with patch.object(
                        desktop_app,
                        "resolve_release_install_target_root",
                        return_value={"root": blocked_target, "mode": "packaged"},
                    ):
                        result = DesktopApi().prepare_release_update_install(
                            {"localPath": str(package_zip), "expectedSha256": package_sha256}
                        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "install_target_not_writable")
        self.assertEqual(result["targetRoot"], str(blocked_target))
        self.assertIn("targetRoot", result)
        self.assertNotIn("scriptPath", result)

    def test_start_release_update_install_launches_external_updater(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_root = root / "package"
            package_root.mkdir()
            package_zip = root / "data" / "updates" / "SSH-Agent-Tool-20260630.zip"
            package_zip.parent.mkdir(parents=True)
            package_zip.write_bytes(b"fake zip")
            package_sha256 = hashlib.sha256(package_zip.read_bytes()).hexdigest().upper()

            launched = {}

            def fake_popen(args, **kwargs):
                launched["args"] = args
                launched["kwargs"] = kwargs
                return subprocess.CompletedProcess(args=args, returncode=0)

            with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                with patch.object(desktop_app, "release_manifest_path", lambda: package_root / "manifest.json"):
                    with patch.object(desktop_app.subprocess, "Popen", fake_popen):
                        result = DesktopApi().start_release_update_install({"localPath": str(package_zip), "expectedSha256": package_sha256})

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "started")
        self.assertIn("powershell", launched["args"][0].lower())
        self.assertIn("-WindowStyle", launched["args"])
        self.assertIn("Hidden", launched["args"])
        self.assertIn("-File", launched["args"])
        self.assertIn(result["scriptPath"], launched["args"])
        self.assertIn("creationflags", launched["kwargs"])
        self.assertIn("后台更新器", result["message"])
        self.assertNotIn("updater", result["message"].lower())
        if hasattr(subprocess, "CREATE_NO_WINDOW"):
            self.assertEqual(launched["kwargs"]["creationflags"] & subprocess.CREATE_NO_WINDOW, subprocess.CREATE_NO_WINDOW)

    def test_start_release_update_install_can_schedule_current_app_shutdown(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_root = root / "package"
            package_root.mkdir()
            package_zip = root / "data" / "updates" / "SSH-Agent-Tool-20260630.zip"
            package_zip.parent.mkdir(parents=True)
            package_zip.write_bytes(b"fake zip")
            package_sha256 = hashlib.sha256(package_zip.read_bytes()).hexdigest().upper()

            scheduled = {}

            def fake_popen(args, **kwargs):
                return subprocess.CompletedProcess(args=args, returncode=0)

            def fake_schedule(delay_seconds=0, exit_code=0):
                scheduled["delaySeconds"] = delay_seconds
                scheduled["exitCode"] = exit_code

            with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                with patch.object(desktop_app, "release_manifest_path", lambda: package_root / "manifest.json"):
                    with patch.object(desktop_app.subprocess, "Popen", fake_popen):
                        with patch.object(desktop_app, "schedule_process_exit", fake_schedule, create=True):
                            result = DesktopApi().start_release_update_install({"localPath": str(package_zip), "expectedSha256": package_sha256, "shutdownAfterStart": True})

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "started")
        self.assertTrue(result["shutdownScheduled"])
        self.assertGreaterEqual(scheduled["delaySeconds"], 1)
        self.assertEqual(scheduled["exitCode"], 0)

    def test_start_release_update_install_reports_launcher_failure_without_shutdown(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_root = root / "package"
            package_root.mkdir()
            package_zip = root / "data" / "updates" / "SSH-Agent-Tool-20260630.zip"
            package_zip.parent.mkdir(parents=True)
            package_zip.write_bytes(b"fake zip")
            package_sha256 = hashlib.sha256(package_zip.read_bytes()).hexdigest().upper()

            scheduled = {}

            def fake_popen(args, **kwargs):
                raise OSError("blocked by policy")

            def fake_schedule(delay_seconds=0, exit_code=0):
                scheduled["delaySeconds"] = delay_seconds
                scheduled["exitCode"] = exit_code

            with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                with patch.object(desktop_app, "release_manifest_path", lambda: package_root / "manifest.json"):
                    with patch.object(desktop_app.subprocess, "Popen", fake_popen):
                        with patch.object(desktop_app, "schedule_process_exit", fake_schedule, create=True):
                            result = DesktopApi().start_release_update_install({"localPath": str(package_zip), "expectedSha256": package_sha256, "shutdownAfterStart": True})

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "start_failed")
        self.assertFalse(result["shutdownScheduled"])
        self.assertIn("blocked by policy", result["message"])
        self.assertEqual(scheduled, {})


if __name__ == "__main__":
    unittest.main()
