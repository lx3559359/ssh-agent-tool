import json
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import desktop_app
from desktop_app import DesktopApi


def write_test_frontend_dist(root: Path) -> Path:
    dist = root / "dist"
    assets = dist / "assets"
    assets.mkdir(parents=True)
    (assets / "index-test.js").write_text("console.log('startup smoke');", encoding="utf-8")
    (assets / "index-test.css").write_text("body { color: #111; }", encoding="utf-8")
    index_path = dist / "index.html"
    index_path.write_text(
        '<script type="module" crossorigin src="./assets/index-test.js"></script>'
        '<link rel="stylesheet" crossorigin href="./assets/index-test.css">',
        encoding="utf-8",
    )
    return index_path


class DesktopAppPathTests(unittest.TestCase):
    def test_app_config_path_uses_formal_data_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict("os.environ", {"APPDATA": temp_dir}):
                path = desktop_app.app_config_path()

        self.assertEqual(path, Path(temp_dir) / "SSHAgentTool" / "config.json")

    def test_read_app_config_migrates_preview_config_once(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            preview_config = root / "SSHAgentToolPreview" / "config.json"
            preview_config.parent.mkdir(parents=True)
            preview_config.write_text(
                json.dumps({"customServers": {"prod-web-01": {"name": "prod-web-01"}}, "modelConfig": {"provider": "OpenAI 兼容"}}),
                encoding="utf-8",
            )

            with patch.dict("os.environ", {"APPDATA": temp_dir}):
                result = DesktopApi().read_app_config()

            formal_config = root / "SSHAgentTool" / "config.json"
            self.assertTrue(formal_config.exists())
            self.assertEqual(result["configPath"], str(formal_config))
            self.assertIn("prod-web-01", result["customServers"])
            self.assertEqual(result["modelConfig"]["provider"], "OpenAI 兼容")

    def test_read_app_config_prefers_existing_formal_config_over_preview(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            preview_config = root / "SSHAgentToolPreview" / "config.json"
            formal_config = root / "SSHAgentTool" / "config.json"
            preview_config.parent.mkdir(parents=True)
            formal_config.parent.mkdir(parents=True)
            preview_config.write_text(json.dumps({"customServers": {"old": {"name": "old"}}}), encoding="utf-8")
            formal_config.write_text(json.dumps({"customServers": {"new": {"name": "new"}}}), encoding="utf-8")

            with patch.dict("os.environ", {"APPDATA": temp_dir}):
                result = DesktopApi().read_app_config()

        self.assertIn("new", result["customServers"])
        self.assertNotIn("old", result["customServers"])

    def test_runtime_formal_client_messages_do_not_call_migration_trial_or_preview(self):
        source = Path(desktop_app.__file__).read_text(encoding="utf-8")
        start = source.index("def read_app_config")
        end = source.index("def write_app_config")
        read_config_source = source[start:end]

        self.assertNotIn("旧试用版", read_config_source)
        self.assertNotIn("预览版", read_config_source)
        self.assertIn("旧版本目录", read_config_source)

    def test_startup_smoke_report_checks_packaged_runtime_without_opening_window(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            ui_path = write_test_frontend_dist(root)
            manifest_path = root / "manifest.json"
            output_path = root / "startup-smoke.json"
            exe_path = root / "SSH-Agent-Tool.exe"
            pe_offset = 0x80
            exe_data = bytearray(512)
            exe_data[0:2] = b"MZ"
            exe_data[0x3C:0x40] = pe_offset.to_bytes(4, "little")
            exe_data[pe_offset:pe_offset + 4] = b"PE\0\0"
            exe_data[pe_offset + 0x5C:pe_offset + 0x5E] = (2).to_bytes(2, "little")
            exe_path.write_bytes(exe_data)
            manifest_path.write_text(
                json.dumps({"appName": "SSH Agent 工具", "version": "20260630", "executable": "SSH-Agent-Tool.exe"}, ensure_ascii=False),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "ui_index_path", lambda: ui_path):
                with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                    with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                        with patch.object(desktop_app, "tool_log_path", lambda: root / "data" / "tool-logs"):
                            with patch.object(desktop_app, "detect_webview2_runtime", return_value={"available": True, "source": "test", "version": "126"}):
                                with patch.object(desktop_app.sys, "executable", str(exe_path)):
                                    result = desktop_app.build_startup_smoke_report(output_path=output_path)
                                    output_exists = output_path.exists()
                                    saved_text = output_path.read_text(encoding="utf-8")
                                    saved = json.loads(saved_text)

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "passed")
        self.assertEqual(result["manifest"]["version"], "20260630")
        self.assertTrue(output_exists)
        self.assertTrue(saved_text.isascii())
        self.assertTrue(saved["ok"])
        self.assertEqual(saved["executableMode"]["subsystemName"], "Windows GUI")
        self.assertFalse(saved["executableMode"]["consoleWindow"])
        self.assertTrue(any(check["name"] == "ui" and check["ok"] for check in saved["checks"]))
        self.assertTrue(any(check["name"] == "toolLog" and check["ok"] for check in saved["checks"]))
        messages = [check["message"] for check in saved["checks"]]
        self.assertIn("UI 文件可用。", messages)
        self.assertIn("数据目录可用。", messages)
        self.assertIn("工具日志目录可写。", messages)
        self.assertIn("WebView2 Runtime 可用。", messages)
        mojibake_markers = [chr(0xFFFD), chr(0x9286)]
        self.assertFalse(any(any(marker in message for marker in mojibake_markers) for message in messages))

    def test_startup_smoke_allows_single_exe_without_manifest(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            ui_path = write_test_frontend_dist(root)
            missing_manifest_path = root / "manifest.json"

            with patch.object(desktop_app, "ui_index_path", lambda: ui_path):
                with patch.object(desktop_app, "release_manifest_path", lambda: missing_manifest_path):
                    with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                        with patch.object(desktop_app, "tool_log_path", lambda: root / "data" / "tool-logs"):
                            with patch.object(desktop_app, "detect_webview2_runtime", return_value={"available": True, "source": "test", "version": "126"}):
                                with patch.object(
                                    desktop_app,
                                    "read_embedded_release_manifest",
                                    return_value={
                                        "ok": True,
                                        "appName": "SSH Agent 工具",
                                        "version": "20260630",
                                        "packageName": "SSH-Agent-Tool-20260630",
                                        "executable": "SSH-Agent-Tool.exe",
                                        "message": "已使用 EXE 内置版本信息。",
                                    },
                                    create=True,
                                ):
                                    result = desktop_app.build_startup_smoke_report()

        manifest_check = next(check for check in result["checks"] if check["name"] == "manifest")
        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "passed")
        self.assertTrue(manifest_check["ok"])
        self.assertEqual(manifest_check["optional"], True)
        self.assertEqual(result["manifest"]["version"], "20260630")
        self.assertEqual(result["packageName"], "SSH-Agent-Tool-20260630")
        self.assertEqual(result["manifest"]["executable"], "SSH-Agent-Tool.exe")

    def test_startup_smoke_report_exposes_repair_advice_when_runtime_check_fails(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            ui_path = write_test_frontend_dist(root)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                json.dumps({"appName": "SSH Agent 工具", "version": "20260630", "executable": "SSH-Agent-Tool.exe"}, ensure_ascii=False),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "ui_index_path", lambda: ui_path):
                with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                    with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                        with patch.object(desktop_app, "tool_log_path", lambda: root / "data" / "tool-logs"):
                            with patch.object(desktop_app.sys, "platform", "win32"):
                                with patch.object(desktop_app, "detect_webview2_runtime", return_value={"available": False, "source": "test", "message": "WebView2 Runtime missing"}):
                                    result = desktop_app.build_startup_smoke_report()

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "failed")
        self.assertIn("startupRepairAdvice", result)
        self.assertTrue(any("WebView2 Runtime" in item for item in result["startupRepairAdvice"]))
        self.assertTrue(any("SSH-Agent-Tool.exe" in item for item in result["startupRepairAdvice"]))

    def test_startup_failure_dialog_gives_cross_machine_repair_steps(self):
        message = desktop_app.build_startup_failure_message(RuntimeError("WebView2 Runtime missing"))

        self.assertIn("完整解压最新版 Windows 客户端 ZIP", message)
        self.assertIn("不要从压缩包预览窗口直接运行", message)
        self.assertIn("删除旧解压目录和旧桌面快捷方式", message)
        self.assertIn("Microsoft Edge WebView2 Runtime", message)
        self.assertIn("https://go.microsoft.com/fwlink/?LinkId=2124703", message)
        self.assertIn("startup-failure-latest.log", message)
        self.assertIn("导出诊断包", message)
        self.assertNotIn("BAT", message)

    def test_run_desktop_entry_startup_smoke_skips_window_and_single_instance_lock(self):
        called = {"entry": False, "lock": False}

        def fake_entry():
            called["entry"] = True
            return 0

        def fake_lock():
            called["lock"] = True
            return desktop_app.SingleInstanceLock()

        with patch.object(desktop_app, "build_startup_smoke_report", return_value={"ok": True, "state": "passed"}):
            with patch.object(desktop_app, "acquire_single_instance_lock", fake_lock):
                exit_code = desktop_app.run_desktop_entry(entry=fake_entry, argv=["SSH-Agent-Tool.exe", "--startup-smoke"])

        self.assertEqual(exit_code, 0)
        self.assertFalse(called["entry"])
        self.assertFalse(called["lock"])

    def test_create_start_menu_shortcut_uses_packaged_exe(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "manifest.json"
            exe_path = root / "SSH-Agent-Tool.exe"
            manifest_path.write_text(
                json.dumps({"version": "20260701", "executable": "SSH-Agent-Tool.exe"}, ensure_ascii=False),
                encoding="utf-8",
            )
            exe_path.write_text("fake exe", encoding="utf-8")
            created = root / "Start Menu" / "SSH-Agent-Tool.lnk"

            def fake_create_start_menu_shortcut(exe_path, shortcut_name="SSH-Agent-Tool.lnk"):
                self.assertTrue(Path(exe_path).samefile(root / "SSH-Agent-Tool.exe"))
                self.assertEqual(shortcut_name, "SSH-Agent-Tool.lnk")
                return created

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "create_windows_start_menu_shortcut", fake_create_start_menu_shortcut):
                    result = DesktopApi().create_start_menu_shortcut()

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "created")
        self.assertEqual(result["shortcutPath"], str(created))
        self.assertEqual(result["targetPath"], str(exe_path))

    def test_download_release_update_records_downloaded_package_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "manifest.json"
            latest_path = root / "latest.json"
            package_path = root / "SSH-Agent-Tool-20260704.zip"
            package_bytes = b"fake update package"
            package_sha = hashlib.sha256(package_bytes).hexdigest().upper()
            package_path.write_bytes(package_bytes)
            manifest_path.write_text(
                json.dumps({"version": "20260703", "executable": "SSH-Agent-Tool.exe"}, ensure_ascii=False),
                encoding="utf-8",
            )
            latest_path.write_text(
                json.dumps(
                    {
                        "version": "20260704",
                        "packageFile": package_path.name,
                        "packageSha256": package_sha,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "app_data_root", lambda: root / "data"):
                    result = DesktopApi().download_release_update()
                    status = DesktopApi().read_release_update_status()
                    downloaded_exists = Path(result.get("localPath") or "").exists()

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "downloaded")
        self.assertTrue(downloaded_exists)
        self.assertEqual(status["state"], "downloaded")
        self.assertEqual(status["localPath"], result["localPath"])
        self.assertEqual(status["packageZip"], result["localPath"])
        self.assertEqual(status["expectedSha256"], package_sha)


if __name__ == "__main__":
    unittest.main()
