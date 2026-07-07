import tempfile
import unittest
import zipfile
import json
import re
from pathlib import Path
from unittest.mock import patch

import diagnostic_package
import desktop_app
from desktop_app import DesktopApi


class DesktopDiagnosticPackageApiTests(unittest.TestCase):
    def test_export_diagnostic_package_uses_app_paths(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_path = root / "config.json"
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            release_manifest = root / "manifest.json"
            release_update_status = root / "updates" / "update-status.json"
            release_update_log = root / "updates" / "release-updater.log"
            target = root / "ssh-agent-diagnostic.zip"
            config_path.write_text('{"customServers":{"prod-web-01":{}}}', encoding="utf-8")
            tool_root.mkdir()
            (tool_root / "2026-06-27.jsonl").write_text('{"message":"ok"}\n', encoding="utf-8")
            release_manifest.write_text('{"version":"dev-test"}', encoding="utf-8")
            release_update_status.parent.mkdir()
            release_update_status.write_text('{"status":"failed","message":"replace denied"}', encoding="utf-8")
            release_update_log.write_text("2026-07-03 update failed: replace denied\n", encoding="utf-8")

            with patch.object(desktop_app, "app_config_path", lambda: config_path):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    with patch.object(desktop_app, "session_log_path", lambda: session_root):
                        with patch.object(desktop_app, "release_manifest_path", lambda: release_manifest):
                            with patch.object(desktop_app, "release_update_status_path", lambda: release_update_status):
                                result = DesktopApi().export_diagnostic_package(str(target), {"createdAt": "2026-06-27T12:00:00Z"})

            self.assertTrue(result["ok"])
            self.assertEqual(result["path"], str(target))
            with zipfile.ZipFile(target) as archive:
                self.assertIn("manifest.json", archive.namelist())
                self.assertIn("release-update-status.json", archive.namelist())
                self.assertIn("release-update/release-updater.log", archive.namelist())
                manifest = archive.read("manifest.json").decode("utf-8")
                archived_status = archive.read("release-update-status.json").decode("utf-8")
                archived_updater_log = archive.read("release-update/release-updater.log").decode("utf-8")
            self.assertIn("dev-test", manifest)
            self.assertIn("replace denied", archived_status)
            self.assertIn("replace denied", archived_updater_log)

    def test_export_diagnostic_package_includes_current_runtime_diagnostics(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_path = root / "config.json"
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            release_manifest = root / "manifest.json"
            target = root / "ssh-agent-diagnostic.zip"
            config_path.write_text("{}", encoding="utf-8")
            tool_root.mkdir()
            session_root.mkdir()
            release_manifest.write_text('{"version":"dev-test"}', encoding="utf-8")
            runtime_diagnostics = {
                "ok": True,
                "uiIndexPath": str(root / "dist" / "index.html"),
                "uiIndexExists": True,
                "frontendAssets": {
                    "script": "assets/index-Co2gkFMc.js",
                    "scriptSha256": "1524723F1BE266470F41537D2EF03066EDDB378BD88EEE70DC69B63B771D8CC6",
                },
            }

            with patch.object(desktop_app, "app_config_path", lambda: config_path):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    with patch.object(desktop_app, "session_log_path", lambda: session_root):
                        with patch.object(desktop_app, "release_manifest_path", lambda: release_manifest):
                            with patch.object(DesktopApi, "read_runtime_diagnostics", lambda self: runtime_diagnostics):
                                result = DesktopApi().export_diagnostic_package(str(target), {"createdAt": "2026-07-02T13:20:00Z"})

            self.assertTrue(result["ok"])
            with zipfile.ZipFile(target) as archive:
                runtime_snapshot = json.loads(archive.read("runtime-diagnostics.json").decode("utf-8"))
                runtime_summary = json.loads(archive.read("runtime-summary.json").decode("utf-8"))

            self.assertEqual(runtime_snapshot["frontendAssets"]["script"], "assets/index-Co2gkFMc.js")
            self.assertEqual(runtime_summary["runtimeDiagnostics"]["uiIndexExists"], True)

    def test_export_diagnostic_package_summarizes_runtime_readiness_for_support(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_path = root / "config.json"
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            release_manifest = root / "manifest.json"
            target = root / "ssh-agent-diagnostic.zip"
            config_path.write_text("{}", encoding="utf-8")
            tool_root.mkdir()
            session_root.mkdir()
            release_manifest.write_text('{"version":"dev-test"}', encoding="utf-8")
            runtime_diagnostics = {
                "ok": False,
                "uiIndexPath": str(root / "dist" / "index.html"),
                "uiIndexExists": True,
                "frontendAssets": {
                    "ok": True,
                    "script": "assets/index-Co2gkFMc.js",
                },
                "webView2Runtime": {
                    "available": False,
                    "source": "registry",
                    "message": "WebView2 Runtime missing",
                },
                "startupIdentity": {
                    "ok": True,
                    "version": "20260704",
                    "message": "startup identity passed",
                },
                "commandLineLaunchers": {
                    "ok": True,
                    "count": 0,
                    "message": "no command line launchers",
                },
            }

            with patch.object(desktop_app, "app_config_path", lambda: config_path):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    with patch.object(desktop_app, "session_log_path", lambda: session_root):
                        with patch.object(desktop_app, "release_manifest_path", lambda: release_manifest):
                            with patch.object(DesktopApi, "read_runtime_diagnostics", lambda self: runtime_diagnostics):
                                result = DesktopApi().export_diagnostic_package(str(target), {"createdAt": "2026-07-04T06:00:00Z"})

            self.assertTrue(result["ok"])
            with zipfile.ZipFile(target) as archive:
                runtime_summary = json.loads(archive.read("runtime-summary.json").decode("utf-8"))
                environment_summary = archive.read("runtime-environment-summary.md").decode("utf-8")

            readiness = runtime_summary["runtimeReadiness"]
            self.assertFalse(readiness["ok"])
            self.assertEqual(readiness["state"], "failed")
            self.assertEqual(readiness["failedChecks"], ["webview2-runtime"])
            self.assertIn("WebView2 Runtime missing", readiness["summary"])
            self.assertEqual(
                [item["id"] for item in readiness["checks"]],
                [
                    "client-entry",
                    "frontend-assets",
                    "webview2-runtime",
                    "startup-identity",
                    "command-line-launchers",
                ],
            )
            webview_check = next(item for item in readiness["checks"] if item["id"] == "webview2-runtime")
            self.assertFalse(webview_check["ok"])
            self.assertIn("WebView2 Runtime missing", webview_check["message"])
            self.assertIn("runtimeReadiness", environment_summary)
            self.assertIn("webview2-runtime", environment_summary)

    def test_export_diagnostic_package_writes_tool_log_event(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_path = root / "config.json"
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            release_manifest = root / "manifest.json"
            target = root / "ssh-agent-diagnostic.zip"
            config_path.write_text("{}", encoding="utf-8")
            tool_root.mkdir()
            session_root.mkdir()
            release_manifest.write_text('{"version":"dev-test"}', encoding="utf-8")

            with patch.object(desktop_app, "app_config_path", lambda: config_path):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    with patch.object(desktop_app, "session_log_path", lambda: session_root):
                        with patch.object(desktop_app, "release_manifest_path", lambda: release_manifest):
                            result = DesktopApi().export_diagnostic_package(str(target), {"createdAt": "2026-07-03T14:00:00Z"})

            self.assertTrue(result["ok"])
            events = []
            for log_file in tool_root.glob("*.jsonl"):
                events.extend(json.loads(line) for line in log_file.read_text(encoding="utf-8").splitlines())

            matching = [event for event in events if event.get("component") == "app" and event.get("action") == "export_diagnostic_package"]
            self.assertEqual(len(matching), 1)
            self.assertEqual(matching[0]["level"], "info")
            self.assertIn("诊断包已导出", matching[0]["message"])
            self.assertEqual(matching[0]["context"]["path"], str(target))
            self.assertGreater(matching[0]["context"]["sizeBytes"], 0)

    def test_export_diagnostic_package_reports_and_logs_packaging_failure(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_path = root / "config.json"
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            release_manifest = root / "manifest.json"
            target = root / "ssh-agent-diagnostic.zip"
            config_path.write_text("{}", encoding="utf-8")
            tool_root.mkdir()
            session_root.mkdir()
            release_manifest.write_text('{"version":"dev-test"}', encoding="utf-8")

            with patch.object(desktop_app, "app_config_path", lambda: config_path):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    with patch.object(desktop_app, "session_log_path", lambda: session_root):
                        with patch.object(desktop_app, "release_manifest_path", lambda: release_manifest):
                            with patch.object(desktop_app, "write_diagnostic_package", side_effect=OSError("disk full")):
                                result = DesktopApi().export_diagnostic_package(str(target), {"createdAt": "2026-07-03T14:10:00Z"})

            self.assertFalse(result["ok"])
            self.assertEqual(result["state"], "failed")
            self.assertEqual(result["path"], str(target))
            self.assertIn("诊断包导出失败", result["message"])
            self.assertIn("disk full", result["message"])

            events = []
            for log_file in tool_root.glob("*.jsonl"):
                events.extend(json.loads(line) for line in log_file.read_text(encoding="utf-8").splitlines())

            matching = [event for event in events if event.get("component") == "app" and event.get("action") == "export_diagnostic_package"]
            self.assertEqual(len(matching), 1)
            self.assertEqual(matching[0]["level"], "warn")
            self.assertIn("诊断包导出失败", matching[0]["message"])
            self.assertEqual(matching[0]["context"]["path"], str(target))

    def test_export_diagnostic_package_includes_latest_startup_failure_log(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_path = root / "config.json"
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            release_manifest = root / "manifest.json"
            target = root / "ssh-agent-diagnostic.zip"
            config_path.write_text("{}", encoding="utf-8")
            tool_root.mkdir()
            session_root.mkdir()
            release_manifest.write_text('{"version":"dev-test"}', encoding="utf-8")
            (tool_root / "startup-failure-latest.log").write_text(
                "ReferenceError: Power is not defined password=StartupSecret!123\n",
                encoding="utf-8",
            )

            with patch.object(desktop_app, "app_config_path", lambda: config_path):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    with patch.object(desktop_app, "session_log_path", lambda: session_root):
                        with patch.object(desktop_app, "release_manifest_path", lambda: release_manifest):
                            result = DesktopApi().export_diagnostic_package(str(target), {"createdAt": "2026-07-03T08:10:00Z"})

            self.assertTrue(result["ok"])
            with zipfile.ZipFile(target) as archive:
                names = archive.namelist()
                startup_log = archive.read("startup-failure/startup-failure-latest.log").decode("utf-8")

            self.assertIn("startup-failure/startup-failure-latest.log", names)
            self.assertIn("Power is not defined", startup_log)
            self.assertNotIn("StartupSecret!123", startup_log)

    def test_export_diagnostic_package_uses_default_target_when_path_is_missing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_path = root / "config.json"
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            release_manifest = root / "manifest.json"
            update_status = root / "updates" / "update-status.json"
            data_root = root / "data"
            config_path.write_text("{}", encoding="utf-8")
            tool_root.mkdir()
            session_root.mkdir()
            release_manifest.write_text('{"version":"dev-test"}', encoding="utf-8")
            update_status.parent.mkdir()
            update_status.write_text('{"status":"completed"}', encoding="utf-8")

            with patch.object(desktop_app, "app_config_path", lambda: config_path):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    with patch.object(desktop_app, "session_log_path", lambda: session_root):
                        with patch.object(desktop_app, "release_manifest_path", lambda: release_manifest):
                            with patch.object(desktop_app, "release_update_status_path", lambda: update_status):
                                with patch.object(desktop_app, "app_data_root", lambda: data_root):
                                    result = DesktopApi().export_diagnostic_package(options={"createdAt": "2026-07-02T12:00:00Z"})

            self.assertTrue(result["ok"])
            self.assertTrue(result["path"].endswith(".zip"))
            self.assertIn("diagnostic-packages", result["path"])
            self.assertIn("诊断包已导出", result["message"])
            self.assertIn(result["path"], result["message"])
            self.assertTrue(Path(result["path"]).exists())
            with zipfile.ZipFile(result["path"]) as archive:
                self.assertIn("release-update-status.json", archive.namelist())

    def test_open_diagnostic_package_directory_launches_explorer_for_default_folder(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_path = root / "config.json"
            config_path.write_text("{}", encoding="utf-8")

            with patch.object(desktop_app, "app_config_path", lambda: config_path):
                with patch.object(desktop_app.subprocess, "Popen") as popen_mock:
                    result = DesktopApi().open_diagnostic_package_directory()

                    self.assertTrue(result["ok"])
                    self.assertEqual(result["state"], "opened")
                    self.assertTrue(result["path"].endswith("diagnostic-packages"))
                    self.assertTrue(Path(result["path"]).exists())
                    args = popen_mock.call_args.args[0]
                    self.assertEqual(args[0], "explorer.exe")
                    self.assertEqual(args[1], result["path"])
                    self.assertIn("诊断包目录已打开", result["message"])

    def test_open_current_executable_directory_opens_parent_folder(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            exe_dir = root / "current-client"
            exe_dir.mkdir()
            exe_path = exe_dir / "SSH-Agent-Tool.exe"
            exe_path.write_text("fake exe", encoding="utf-8")

            with patch.object(desktop_app.sys, "executable", str(exe_path)):
                with patch.object(desktop_app.subprocess, "Popen") as popen_mock:
                    result = DesktopApi().open_current_executable_directory()

            self.assertTrue(result["ok"])
            self.assertEqual(result["state"], "opened")
            self.assertEqual(result["path"], str(exe_dir.resolve()))
            args = popen_mock.call_args.args[0]
            self.assertEqual(args[0], "explorer.exe")
            self.assertEqual(args[1], str(exe_dir.resolve()))
            self.assertNotEqual(args[1], str(exe_path))

    def test_export_diagnostic_package_keeps_chinese_text_readable(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_path = root / "missing-config.json"
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            release_manifest = root / "missing-manifest.json"
            target = root / "ssh-agent-diagnostic.zip"

            with patch.object(desktop_app, "app_config_path", lambda: config_path):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    with patch.object(desktop_app, "session_log_path", lambda: session_root):
                        with patch.object(desktop_app, "release_manifest_path", lambda: release_manifest):
                            result = DesktopApi().export_diagnostic_package(str(target), {"createdAt": "2026-06-27T12:00:00Z"})

            self.assertTrue(result["ok"])
            with zipfile.ZipFile(target) as archive:
                readme = archive.read("README.txt").decode("utf-8")
                manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
                release_manifest_summary = json.loads(archive.read("release-manifest.json").decode("utf-8"))
                empty_tool_logs = archive.read("tool-logs/EMPTY.txt").decode("utf-8")

            combined = "\n".join([readme, manifest["privacy"], release_manifest_summary["message"], empty_tool_logs])
            self.assertIn("SSH Agent 工具诊断包", readme)
            self.assertIn("日志和配置摘要已脱敏", manifest["privacy"])
            self.assertIn("文件不存在", release_manifest_summary["message"])
            self.assertIn("当前没有可导出的日志文件", empty_tool_logs)
            self.assertNotRegex(combined, r"[鍦宸璇鏂妫鏈褰鐢锛€俓歿]")

    def test_diagnostic_package_source_has_single_clean_implementation(self):
        source = Path(diagnostic_package.__file__).read_text(encoding="utf-8")

        for function_name in [
            "write_diagnostic_package",
            "build_manifest",
            "summarize_webview2_runtime",
            "read_json_file",
            "add_log_tree",
            "build_readme",
        ]:
            self.assertEqual(len(re.findall(rf"^def {function_name}\(", source, flags=re.MULTILINE)), 1, function_name)

        self.assertNotRegex(source, r"[鍦宸璇鏂妫鏈褰鐢锛€俓歿]")
