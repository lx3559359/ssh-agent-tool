import tempfile
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import desktop_app
from desktop_app import DesktopApi


class FakeCredentialStore:
    def __init__(self, *_args):
        self.secrets = {}

    def save_secret(self, connection_name, secret, metadata=None):
        self.secrets["sshcred-model"] = secret
        return {"credentialRef": "sshcred-model", "hasSecret": True, "updatedAt": "2026-06-27T00:00:00Z"}

    def read_secret(self, credential_ref):
        return self.secrets[credential_ref]


class DesktopToolLogApiTests(unittest.TestCase):
    def test_classify_ssh_failure_uses_standard_failure_kinds(self):
        cases = [
            ({"message": "Connection refused"}, "refused"),
            ({"message": "ssh: connect to host 10.0.1.23 port 22: No route to host"}, "timeout"),
            ({"message": "Could not resolve hostname app.internal"}, "dns"),
            ({"message": "Unable to negotiate: no matching host key type found"}, "algorithm"),
            ({"message": "UNPROTECTED PRIVATE KEY FILE! Permissions are too open"}, "key-file"),
            ({"message": "Too many authentication failures"}, "agent-auth"),
        ]

        for result, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(desktop_app.classify_ssh_failure(result), expected)

    def test_desktop_main_logs_startup_failures_before_window_exists(self):
        class FakeLock:
            def release(self):
                return None

        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "install_runtime_exception_logging", lambda: None):
                    with patch.object(desktop_app, "acquire_single_instance_lock", lambda: FakeLock(), create=True):
                        with patch.object(desktop_app, "show_startup_failure_dialog", lambda error: None):
                            result = desktop_app.run_desktop_entry(lambda: (_ for _ in ()).throw(RuntimeError("webview import failed")))

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
        self.assertEqual(result, 1)
        self.assertIn('"component":"runtime"', saved)
        self.assertIn('"action":"startup_failed"', saved)
        self.assertIn("webview import failed", saved)

    def test_desktop_main_writes_latest_startup_failure_text_log(self):
        class FakeLock:
            def release(self):
                return None

        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "install_runtime_exception_logging", lambda: None):
                    with patch.object(desktop_app, "acquire_single_instance_lock", lambda: FakeLock(), create=True):
                        with patch.object(desktop_app, "show_startup_failure_dialog", lambda error: None):
                            result = desktop_app.run_desktop_entry(lambda: (_ for _ in ()).throw(RuntimeError("password=ServerPassword!123")))

            latest = log_root / "startup-failure-latest.log"
            saved = latest.read_text(encoding="utf-8")

        self.assertEqual(result, 1)
        self.assertIn("启动失败", saved)
        self.assertIn("RuntimeError", saved)
        self.assertIn("SSH-Agent-Tool", saved)
        self.assertNotIn("ServerPassword!123", saved)

    def test_startup_failure_text_log_includes_runtime_diagnostics(self):
        class FakeLock:
            def release(self):
                return None

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            log_root = root / "tool-logs"
            manifest_path = root / "manifest.json"
            assets = root / "dist" / "assets"
            assets.mkdir(parents=True)
            (assets / "index-fresh.js").write_text("console.log('fresh');", encoding="utf-8")
            (assets / "index-fresh.css").write_text("body { color: #111; }", encoding="utf-8")
            index_path = root / "dist" / "index.html"
            index_path.write_text(
                '<script type="module" crossorigin src="./assets/index-fresh.js"></script>'
                '<link rel="stylesheet" crossorigin href="./assets/index-fresh.css">',
                encoding="utf-8",
            )
            manifest_path.write_text('{"version":"20260702","executable":"SSH-Agent-Tool.exe"}', encoding="utf-8")

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                    with patch.object(desktop_app, "ui_index_path", lambda: index_path):
                        with patch.object(desktop_app, "detect_webview2_runtime", return_value={"available": False, "source": "registry", "message": "WebView2 Runtime missing"}):
                            with patch.object(desktop_app, "install_runtime_exception_logging", lambda: None):
                                with patch.object(desktop_app, "acquire_single_instance_lock", lambda: FakeLock(), create=True):
                                    with patch.object(desktop_app, "show_startup_failure_dialog", lambda error: None):
                                        result = desktop_app.run_desktop_entry(lambda: (_ for _ in ()).throw(RuntimeError("startup crash")))

            saved = (log_root / "startup-failure-latest.log").read_text(encoding="utf-8")

        self.assertEqual(result, 1)
        self.assertIn("WebView2 Runtime missing", saved)
        self.assertIn("assets/index-fresh.js", saved)
        self.assertIn("manifest.json", saved)
        self.assertIn("frontendAssets", saved)
        self.assertIn("webView2Runtime", saved)
        self.assertIn("releaseManifestPath", saved)

    def test_startup_repair_advice_explains_webview2_and_broken_assets(self):
        with patch.object(desktop_app.sys, "platform", "win32"):
            advice = desktop_app.build_startup_repair_advice(
                RuntimeError("webview runtime missing"),
                {
                    "webView2Runtime": {"available": False, "message": "WebView2 Runtime missing"},
                    "uiIndexExists": False,
                    "frontendAssets": {"ok": False, "message": "asset missing"},
                },
            )

        joined = "\n".join(advice)
        self.assertIn("WebView2 Runtime", joined)
        self.assertIn("go.microsoft.com/fwlink", joined)
        self.assertIn("重新解压", joined)
        self.assertIn("不要在压缩包预览窗口里直接运行", joined)
        self.assertIn("startup-failure-latest.log", joined)

    def test_startup_failure_text_log_includes_repair_advice(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"
            context = {
                "executable": "C:\\tools\\SSH-Agent-Tool.exe",
                "resourceRoot": "C:\\tools",
                "webView2Runtime": {"available": False, "message": "WebView2 Runtime missing"},
                "uiIndexExists": False,
                "frontendAssets": {"ok": False, "message": "asset missing"},
            }

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app.sys, "platform", "win32"):
                    path = desktop_app.write_latest_startup_failure_log(RuntimeError("webview runtime missing"), context)

            saved = path.read_text(encoding="utf-8")

        self.assertIn("建议处理", saved)
        self.assertIn("WebView2 Runtime", saved)
        self.assertIn("重新解压", saved)
        self.assertIn("不要在压缩包预览窗口里直接运行", saved)
        self.assertIn("startup-failure-latest.log", saved)

    def test_latest_startup_failure_log_info_classifies_stale_frontend_bundle(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"
            log_root.mkdir(parents=True)
            latest = log_root / "startup-failure-latest.log"
            latest.write_text(
                "\n".join(
                    [
                        "SSH-Agent-Tool 启动失败",
                        "ReferenceError: Power is not defined",
                        "at file:///C:/Users/me/AppData/Local/Temp/_MEI123/dist/assets/index-BCGy_mkD.js",
                    ]
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                result = desktop_app.latest_startup_failure_log_info()

        self.assertTrue(result["exists"])
        self.assertEqual(result["knownIssue"], "stale_frontend_bundle")
        self.assertIn("Power is not defined", result["knownSignature"])

    def test_desktop_entry_shows_native_startup_failure_notice(self):
        calls = []

        class FakeLock:
            def release(self):
                calls.append(("release", None))

        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "install_runtime_exception_logging", lambda: None):
                    with patch.object(desktop_app, "acquire_single_instance_lock", lambda: FakeLock(), create=True):
                        with patch.object(desktop_app, "show_startup_failure_dialog", lambda error: calls.append(("dialog", str(error)))):
                            result = desktop_app.run_desktop_entry(lambda: (_ for _ in ()).throw(RuntimeError("webview runtime missing")))

        self.assertEqual(result, 1)
        self.assertIn(("dialog", "webview runtime missing"), calls)
        self.assertEqual(calls[-1], ("release", None))

    def test_startup_failure_dialog_message_points_to_logs_and_in_app_diagnostics(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                message = desktop_app.build_startup_failure_message(RuntimeError("webview runtime missing"))

        self.assertIn("SSH Agent", message)
        self.assertIn("webview runtime missing", message)
        self.assertIn(str(log_root), message)
        self.assertIn(str(log_root / "startup-failure-latest.log"), message)
        self.assertNotIn(".bat", message.lower())
        self.assertIn("WebView2 Runtime", message)
        self.assertIn("https://go.microsoft.com/fwlink/?LinkId=2124703", message)
        self.assertIn("启动失败", message)
        self.assertIn("不需要任何命令行脚本", message)
        self.assertIn("诊断包", message)
        self.assertNotIn("高级诊断", message)
        self.assertNotIn("诊断脚本", message)
        self.assertNotIn(".ps1", message.lower())
        self.assertNotRegex(message, r"[锛歿閿鍐宸濡姝]")

    def test_detect_webview2_runtime_reads_registered_runtime_version(self):
        calls = []

        def fake_registry_reader(root, subkey, value_name):
            calls.append((root, subkey, value_name))
            return "126.0.2592.113"

        result = desktop_app.detect_webview2_runtime(registry_reader=fake_registry_reader, platform="win32")

        self.assertTrue(result["available"])
        self.assertEqual(result["version"], "126.0.2592.113")
        self.assertEqual(result["source"], "registry")
        self.assertGreaterEqual(len(calls), 1)

    def test_detect_webview2_runtime_skips_non_windows(self):
        result = desktop_app.detect_webview2_runtime(platform="linux")

        self.assertFalse(result["available"])
        self.assertEqual(result["source"], "non-windows")

    def test_write_tool_log_event_uses_tool_log_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                result = DesktopApi().write_tool_log_event(
                    {
                        "level": "info",
                        "component": "ssh",
                        "action": "open_session",
                        "message": "open session",
                    }
                )

            self.assertTrue(result["ok"])
            self.assertTrue(Path(result["path"]).exists())
            self.assertIn(str(log_root), result["path"])

    def test_get_tool_log_dir_creates_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                result = DesktopApi().get_tool_log_dir()

            self.assertEqual(result, str(log_root))
            self.assertTrue(log_root.exists())

    def test_log_tool_result_records_failed_api_result(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                result = desktop_app.log_tool_result(
                    "ssh",
                    "open_session",
                    {"ok": False, "message": "password=ServerPassword!123"},
                    {"server": "prod-web-01", "password": "ServerPassword!123"},
                )

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertFalse(result["ok"])
            self.assertIn("open_session", saved)
            self.assertNotIn("ServerPassword!123", saved)

    def test_failed_ssh_probe_is_recorded_in_tool_log(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "probe_ssh_endpoint", return_value={"ok": False, "message": "port unavailable"}):
                    result = DesktopApi().test_ssh_connection("10.0.1.23", "22")

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertFalse(result["ok"])
            self.assertIn("test_connection", saved)
            self.assertIn("10.0.1.23", saved)

    def test_failed_sftp_action_is_recorded_in_tool_log_without_secret(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "CredentialStore") as store_class:
                    store = store_class.return_value
                    store.read_secret.return_value = "ServerPassword!123"
                    store.read_metadata.return_value = {}
                    with patch.object(desktop_app, "list_sftp_directory", return_value={"ok": False, "message": "SFTP 权限不足"}):
                        result = DesktopApi().list_sftp_directory({"ip": "10.0.1.23"}, "cred-1", "/root")

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertFalse(result["ok"])
            self.assertIn("sftp", saved)
            self.assertIn("list_directory", saved)
            self.assertIn("/root", saved)
            self.assertNotIn("ServerPassword!123", saved)

    def test_failed_ssh_readonly_command_is_recorded_in_tool_log_without_secret(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "CredentialStore") as store_class:
                    store = store_class.return_value
                    store.read_secret.return_value = "ServerPassword!123"
                    store.read_metadata.return_value = {"authType": "密码"}
                    with patch.object(desktop_app, "run_readonly_command", return_value={"ok": False, "message": "SSH 认证失败"}):
                        result = DesktopApi().run_ssh_readonly_command({"name": "prod-web-01", "ip": "10.0.1.23"}, "cred-1", "uptime")

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertFalse(result["ok"])
            self.assertIn("ssh", saved)
            self.assertIn("readonly_command", saved)
            self.assertIn("prod-web-01", saved)
            self.assertIn("uptime", saved)
            self.assertNotIn("ServerPassword!123", saved)

    def test_failed_ssh_readonly_command_logs_safe_context_without_credential_ref(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "CredentialStore") as store_class:
                    store = store_class.return_value
                    store.read_secret.return_value = "ServerPassword!123"
                    store.read_metadata.return_value = {"authType": "password"}
                    with patch.object(desktop_app, "run_readonly_command", return_value={"ok": False, "message": "Permission denied password=NoLeak"}):
                        result = DesktopApi().run_ssh_readonly_command(
                            {
                                "name": "prod-web-01",
                                "ip": "10.0.1.23",
                                "port": "2222",
                                "user": "root",
                                "credentialRef": "sshcred-prod",
                                "timeoutSeconds": 18,
                            },
                            "sshcred-prod",
                            "uptime",
                        )

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertFalse(result["ok"])
            self.assertIn('"serverName":"prod-web-01"', saved)
            self.assertIn('"host":"10.0.1.23"', saved)
            self.assertIn('"port":2222', saved)
            self.assertIn('"user":"root"', saved)
            self.assertIn('"authType":"password"', saved)
            self.assertIn('"timeoutSeconds":18', saved)
            self.assertIn('"failureKind":"auth"', saved)
            self.assertIn('"command":"uptime"', saved)
            self.assertNotIn("credentialRef", saved)
            self.assertNotIn("sshcred-prod", saved)
            self.assertNotIn("ServerPassword!123", saved)
            self.assertNotIn("NoLeak", saved)

    def test_failed_ssh_login_logs_safe_context_without_credential_ref(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "CredentialStore") as store_class:
                    store = store_class.return_value
                    store.read_secret.return_value = "ServerPassword!123"
                    store.read_metadata.return_value = {"authType": "password"}
                    with patch.object(desktop_app, "run_readonly_command", return_value={"ok": False, "message": "SSH authentication failed password=NoLeak"}):
                        result = DesktopApi().test_ssh_login(
                            {
                                "name": "prod-web-01",
                                "ip": "10.0.1.23",
                                "port": "2222",
                                "user": "root",
                                "credentialRef": "sshcred-prod",
                                "timeoutSeconds": 18,
                            },
                            "sshcred-prod",
                        )

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertFalse(result["ok"])
            self.assertIn('"action":"test_login"', saved)
            self.assertIn('"serverName":"prod-web-01"', saved)
            self.assertIn('"host":"10.0.1.23"', saved)
            self.assertIn('"failureKind":"auth"', saved)
            self.assertNotIn("credentialRef", saved)
            self.assertNotIn("sshcred-prod", saved)
            self.assertNotIn("ServerPassword!123", saved)
            self.assertNotIn("NoLeak", saved)

    def test_failed_local_cli_action_is_recorded_in_tool_log(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "run_local_cli_command", return_value={"ok": False, "message": "命令执行失败"}):
                    result = DesktopApi().run_local_cli_command("bad-command", timeout=3, run_id="run-1")

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertFalse(result["ok"])
            self.assertIn("local-cli", saved)
            self.assertIn("run_command", saved)
            self.assertIn("bad-command", saved)

    def test_model_api_key_save_is_recorded_without_secret(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"
            store = FakeCredentialStore()

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "CredentialStore", lambda *_args: store):
                    result = DesktopApi().save_model_api_key(
                        {"provider": "OpenAI Compatible", "baseUrl": "https://api.example.com/v1", "model": "test-model"},
                        "sk-real-secret",
                    )

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertTrue(result["ok"])
            self.assertIn("model-api", saved)
            self.assertIn("save_api_key", saved)
            self.assertIn("test-model", saved)
            self.assertNotIn("sk-real-secret", saved)

    def test_app_config_write_is_recorded_with_safe_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"
            config_path = Path(temp_dir) / "config.json"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "app_config_path", lambda: config_path):
                    result = DesktopApi().write_app_config(
                        {
                            "customServers": {"prod-web-01": {"ip": "10.0.1.23"}},
                            "modelConfig": {"baseUrl": "https://api.example.com/v1", "model": "test-model", "apiKey": "sk-real-secret"},
                            "modelProfiles": [{"id": "default", "name": "Default", "config": {"model": "test-model"}}],
                            "activeModelProfileId": "default",
                        }
                    )

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertEqual(result, str(config_path))
            self.assertIn("app-config", saved)
            self.assertIn("write_config", saved)
            self.assertIn("serverCount", saved)
            self.assertNotIn("sk-real-secret", saved)

    def test_list_tool_log_entries_uses_tool_log_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                api = DesktopApi()
                api.write_tool_log_event({"level": "warn", "component": "ssh", "action": "open_session", "message": "connect failed"})
                result = api.list_tool_log_entries({"component": "ssh", "query": "connect"})

            self.assertTrue(result["ok"])
            self.assertEqual(result["total"], 1)
            self.assertEqual(result["entries"][0]["action"], "open_session")

    def test_build_tool_log_export_returns_markdown(self):
        content = DesktopApi().build_tool_log_export(
            [{"createdAt": "2026-06-27T01:00:00Z", "level": "error", "component": "model-api", "action": "chat"}],
            {"exportedAt": "2026-06-27T02:00:00Z"},
        )

        self.assertIn("# ", content)
        self.assertIn("model-api", content)


    def test_delete_old_tool_logs_uses_tool_log_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"
            log_root.mkdir()
            (log_root / "2026-05-01.jsonl").write_text("old", encoding="utf-8")
            (log_root / "2026-06-20.jsonl").write_text("recent", encoding="utf-8")

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                result = DesktopApi().delete_old_tool_logs(30, "2026-06-27T00:00:00Z")

            self.assertTrue(result["ok"])
            self.assertEqual(result["deleted"], 1)
            self.assertFalse((log_root / "2026-05-01.jsonl").exists())
            self.assertTrue((log_root / "2026-06-20.jsonl").exists())

    def test_log_app_startup_records_runtime_context(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                desktop_app.log_app_startup({"mode": "test"})

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertIn("app_start", saved)
            self.assertIn("test", saved)

    def test_log_app_startup_records_runtime_paths_for_exe_diagnostics(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            log_root = root / "tool-logs"

            with patch.object(desktop_app, "app_data_root", lambda: root):
                with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                    with patch.object(desktop_app, "session_log_path", lambda: root / "session-logs"):
                        desktop_app.log_app_startup({"mode": "test"})

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertIn('"appDataRoot"', saved)
            self.assertIn(str(root).replace("\\", "\\\\"), saved)
            self.assertIn('"toolLogDir"', saved)
            self.assertIn('"sessionLogDir"', saved)
            self.assertIn('"cwd"', saved)

    def test_log_app_startup_prunes_old_tool_and_session_logs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            log_root = root / "tool-logs"
            session_root = root / "session-logs"
            log_root.mkdir()
            (log_root / "2000-01-01.jsonl").write_text("old tool", encoding="utf-8")
            (log_root / "2999-01-01.jsonl").write_text("recent tool", encoding="utf-8")
            old_session_dir = session_root / "2000-01-01"
            recent_session_dir = session_root / "2999-01-01"
            old_session_dir.mkdir(parents=True)
            recent_session_dir.mkdir(parents=True)
            (old_session_dir / "prod-default.jsonl").write_text("old session", encoding="utf-8")
            (recent_session_dir / "prod-default.jsonl").write_text("recent session", encoding="utf-8")

            with patch.object(desktop_app, "app_data_root", lambda: root):
                with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                    with patch.object(desktop_app, "session_log_path", lambda: session_root):
                        desktop_app.log_app_startup({"mode": "test"})

            saved = "\n".join(path.read_text(encoding="utf-8") for path in log_root.glob("*.jsonl"))
            self.assertFalse((log_root / "2000-01-01.jsonl").exists())
            self.assertTrue((log_root / "2999-01-01.jsonl").exists())
            self.assertFalse((old_session_dir / "prod-default.jsonl").exists())
            self.assertTrue((recent_session_dir / "prod-default.jsonl").exists())
            self.assertIn('"logRetention"', saved)
            self.assertIn('"toolLogs"', saved)
            self.assertIn('"sessionLogs"', saved)
            self.assertIn('"deleted":1', saved)

    def test_runtime_diagnostics_reports_windows_gui_exe_mode(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            exe_path = Path(temp_dir) / "SSH-Agent-Tool.exe"
            pe_offset = 0x80
            data = bytearray(512)
            data[0:2] = b"MZ"
            data[0x3C:0x40] = pe_offset.to_bytes(4, "little")
            data[pe_offset:pe_offset + 4] = b"PE\0\0"
            data[pe_offset + 0x5C:pe_offset + 0x5E] = (2).to_bytes(2, "little")
            exe_path.write_bytes(data)

            with patch.object(desktop_app.sys, "executable", str(exe_path)):
                result = DesktopApi().read_runtime_diagnostics()

        self.assertEqual(result["executableMode"]["subsystem"], 2)
        self.assertEqual(result["executableMode"]["subsystemName"], "Windows GUI")
        self.assertFalse(result["executableMode"]["consoleWindow"])
        self.assertIn("图形客户端", result["executableMode"]["label"])

    def test_runtime_diagnostics_reports_current_executable_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            exe_dir = Path(temp_dir) / "current-client"
            exe_dir.mkdir()
            exe_path = exe_dir / "SSH-Agent-Tool.exe"
            exe_path.write_bytes(b"fake exe")

            with patch.object(desktop_app.sys, "executable", str(exe_path)):
                result = DesktopApi().read_runtime_diagnostics()

        self.assertEqual(result["executable"], str(exe_path))
        self.assertEqual(result["executableDirectory"], str(exe_dir.resolve()))

    def test_runtime_diagnostics_reports_command_line_launcher_scan(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "manifest.json"
            manifest_path.write_text('{"executable":"SSH-Agent-Tool.exe"}', encoding="utf-8")
            (root / "SSH-Agent-Tool.exe").write_bytes(b"fake exe")
            (root / "debug-launch.bat").write_text("@echo off\n", encoding="utf-8")
            (root / "notes.txt").write_text("ok\n", encoding="utf-8")

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                result = DesktopApi().read_runtime_diagnostics()

        self.assertFalse(result["commandLineLaunchers"]["ok"])
        self.assertEqual(result["commandLineLaunchers"]["count"], 1)
        self.assertEqual(result["commandLineLaunchers"]["extensions"], [".bat"])
        self.assertIn("debug-launch.bat", result["commandLineLaunchers"]["files"][0])
        self.assertIn("命令行脚本", result["commandLineLaunchers"]["message"])

    def test_runtime_diagnostics_reports_latest_startup_failure_log(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"
            log_root.mkdir()
            latest = log_root / "startup-failure-latest.log"
            latest.write_text("SSH-Agent-Tool 启动失败\n", encoding="utf-8")

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                result = DesktopApi().read_runtime_diagnostics()

        self.assertEqual(result["startupFailureLog"]["path"], str(latest))
        self.assertTrue(result["startupFailureLog"]["exists"])
        self.assertGreater(result["startupFailureLog"]["size"], 0)
        self.assertTrue(result["startupFailureLog"]["updatedAt"])

    def test_log_app_startup_records_webview2_runtime_status(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "detect_webview2_runtime", return_value={"available": True, "source": "registry"}):
                    desktop_app.log_app_startup({"mode": "test"})

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertIn('"webView2Runtime"', saved)
            self.assertIn('"available":true', saved)
            self.assertIn('"source":"registry"', saved)

    def test_log_app_startup_records_release_and_ui_entry_diagnostics(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            log_root = root / "tool-logs"
            manifest_path = root / "manifest.json"
            index_path = root / "dist" / "index.html"
            index_path.parent.mkdir()
            manifest_path.write_text('{"version":"20260701","executable":"SSH-Agent-Tool.exe"}', encoding="utf-8")
            index_path.write_text("<html></html>", encoding="utf-8")

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                    with patch.object(desktop_app, "ui_index_path", lambda: index_path):
                        desktop_app.log_app_startup({"mode": "test"})

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertIn('"releaseVersion":"20260701"', saved)
            self.assertIn('"releaseExecutable":"SSH-Agent-Tool.exe"', saved)
            self.assertIn('"releaseManifestPath"', saved)
            self.assertIn(str(manifest_path).replace("\\", "\\\\"), saved)
            self.assertIn('"uiIndexPath"', saved)
            self.assertIn(str(index_path).replace("\\", "\\\\"), saved)
            self.assertIn('"uiIndexExists":true', saved)

    def test_log_app_startup_records_frontend_asset_fingerprint(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            log_root = root / "tool-logs"
            assets = root / "dist" / "assets"
            assets.mkdir(parents=True)
            (assets / "index-fresh.js").write_text("console.log('fresh');", encoding="utf-8")
            (assets / "index-fresh.css").write_text("body { color: #111; }", encoding="utf-8")
            index_path = root / "dist" / "index.html"
            index_path.write_text(
                '<script type="module" crossorigin src="./assets/index-fresh.js"></script>'
                '<link rel="stylesheet" crossorigin href="./assets/index-fresh.css">',
                encoding="utf-8",
            )

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "ui_index_path", lambda: index_path):
                    desktop_app.log_app_startup({"mode": "test"})

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertIn('"frontendAssets"', saved)
            self.assertIn('"script":"assets/index-fresh.js"', saved)
            self.assertIn('"stylesheet":"assets/index-fresh.css"', saved)
            self.assertIn('"scriptSha256"', saved)
            self.assertIn('"stylesheetSha256"', saved)

    def test_runtime_diagnostics_reports_frontend_asset_fingerprint(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            assets = root / "dist" / "assets"
            assets.mkdir(parents=True)
            (assets / "index-fresh.js").write_text("console.log('fresh');", encoding="utf-8")
            (assets / "index-fresh.css").write_text("body { color: #111; }", encoding="utf-8")
            index_path = root / "dist" / "index.html"
            index_path.write_text(
                '<script type="module" crossorigin src="./assets/index-fresh.js"></script>'
                '<link rel="stylesheet" crossorigin href="./assets/index-fresh.css">',
                encoding="utf-8",
            )

            with patch.object(desktop_app, "ui_index_path", lambda: index_path):
                result = DesktopApi().read_runtime_diagnostics()

        self.assertTrue(result["frontendAssets"]["ok"])
        self.assertEqual(result["frontendAssets"]["script"], "assets/index-fresh.js")
        self.assertEqual(result["frontendAssets"]["stylesheet"], "assets/index-fresh.css")

    def test_runtime_diagnostics_reports_startup_identity_match(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            assets = root / "dist" / "assets"
            assets.mkdir(parents=True)
            script = assets / "index-fresh.js"
            stylesheet = assets / "index-fresh.css"
            script.write_text("console.log('fresh');", encoding="utf-8")
            stylesheet.write_text("body { color: #111; }", encoding="utf-8")
            script_hash = desktop_app.hashlib.sha256(script.read_bytes()).hexdigest().upper()
            stylesheet_hash = desktop_app.hashlib.sha256(stylesheet.read_bytes()).hexdigest().upper()
            index_path = root / "dist" / "index.html"
            index_path.write_text(
                '<script type="module" crossorigin src="./assets/index-fresh.js"></script>'
                '<link rel="stylesheet" crossorigin href="./assets/index-fresh.css">',
                encoding="utf-8",
            )
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                desktop_app.json.dumps(
                    {
                        "version": "20260702",
                        "executable": "SSH-Agent-Tool.exe",
                        "frontendAssets": {
                            "script": "assets/index-fresh.js",
                            "scriptSha256": script_hash,
                            "stylesheet": "assets/index-fresh.css",
                            "stylesheetSha256": stylesheet_hash,
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "ui_index_path", lambda: index_path):
                    with patch.object(desktop_app, "describe_executable_client_mode", return_value={"subsystemName": "Windows GUI", "consoleWindow": False}):
                        result = DesktopApi().read_runtime_diagnostics()

        self.assertTrue(result["startupIdentity"]["ok"])
        self.assertEqual(result["startupIdentity"]["version"], "20260702")
        self.assertEqual(result["startupIdentity"]["executable"], "SSH-Agent-Tool.exe")
        self.assertEqual(result["startupIdentity"]["runtimeScript"], "assets/index-fresh.js")
        self.assertEqual(result["startupIdentity"]["manifestScript"], "assets/index-fresh.js")
        self.assertEqual(result["startupIdentity"]["runtimeScriptSha256"], script_hash)
        self.assertTrue(result["startupIdentity"]["frontendMatchesManifest"])
        self.assertFalse(result["startupIdentity"]["consoleWindow"])

    def test_client_entry_diagnostics_rejects_zip_preview_temp_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            temp_exe_dir = root / "Temp" / "zip-preview"
            temp_exe = temp_exe_dir / "SSH-Agent-Tool.exe"
            resource_dir = root / "Temp" / "_MEI305162"
            manifest_path = temp_exe_dir / "manifest.json"
            ui_path = resource_dir / "dist" / "index.html"
            temp_exe_dir.mkdir(parents=True)
            ui_path.parent.mkdir(parents=True)
            ui_path.write_text("<html></html>", encoding="utf-8")

            result = desktop_app.build_client_entry_diagnostics(
                executable=temp_exe,
                cwd=temp_exe_dir,
                resource_root_path=resource_dir,
                manifest_path=manifest_path,
                ui_index_path=ui_path,
                temp_root=root / "Temp",
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["riskLevel"], "error")
        self.assertTrue(result["inTempExecutableDirectory"])
        self.assertTrue(result["inTempResourceRoot"])
        self.assertFalse(result["manifestExists"])
        self.assertTrue(result["uiIndexExists"])
        self.assertIn("完整解压", result["message"])
        self.assertIn("SSH-Agent-Tool.exe", result["recommendedEntry"])

    def test_client_entry_diagnostics_allows_normal_pyinstaller_resource_temp(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            client_dir = root / "Windows客户端"
            resource_dir = root / "Temp" / "_MEI305162"
            manifest_path = client_dir / "manifest.json"
            ui_path = resource_dir / "dist" / "index.html"
            client_dir.mkdir(parents=True)
            ui_path.parent.mkdir(parents=True)
            manifest_path.write_text("{}", encoding="utf-8")
            ui_path.write_text("<html></html>", encoding="utf-8")

            result = desktop_app.build_client_entry_diagnostics(
                executable=client_dir / "SSH-Agent-Tool.exe",
                cwd=client_dir,
                resource_root_path=resource_dir,
                manifest_path=manifest_path,
                ui_index_path=ui_path,
                temp_root=root / "Temp",
            )

        self.assertTrue(result["ok"])
        self.assertFalse(result["inTempExecutableDirectory"])
        self.assertTrue(result["inTempResourceRoot"])
        self.assertTrue(result["manifestExists"])
        self.assertTrue(result["uiIndexExists"])
        self.assertEqual(result["riskLevel"], "ok")
        self.assertIn("正常", result["message"])

    def test_runtime_diagnostics_reports_client_entry_health(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "manifest.json"
            index_path = root / "dist" / "index.html"
            index_path.parent.mkdir()
            manifest_path.write_text('{"version":"20260703","executable":"SSH-Agent-Tool.exe"}', encoding="utf-8")
            index_path.write_text("<html></html>", encoding="utf-8")

            with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                with patch.object(desktop_app, "ui_index_path", lambda: index_path):
                    result = DesktopApi().read_runtime_diagnostics()

        self.assertIn("clientEntry", result)
        self.assertIn("recommendedEntry", result["clientEntry"])
        self.assertIn("executableDirectory", result["clientEntry"])
        self.assertIn("inTempExecutableDirectory", result["clientEntry"])

    def test_log_app_startup_records_client_entry_diagnostics(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            log_root = root / "tool-logs"
            manifest_path = root / "manifest.json"
            index_path = root / "dist" / "index.html"
            index_path.parent.mkdir()
            manifest_path.write_text('{"version":"20260703","executable":"SSH-Agent-Tool.exe"}', encoding="utf-8")
            index_path.write_text("<html></html>", encoding="utf-8")

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                    with patch.object(desktop_app, "ui_index_path", lambda: index_path):
                        desktop_app.log_app_startup({"mode": "test"})

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")

        self.assertIn('"clientEntry"', saved)
        self.assertIn('"recommendedEntry"', saved)
        self.assertIn('"inTempExecutableDirectory"', saved)

    def test_startup_smoke_report_includes_client_entry_diagnostics(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            log_root = root / "tool-logs"
            data_root = root / "app-data"
            manifest_path = root / "manifest.json"
            assets = root / "dist" / "assets"
            assets.mkdir(parents=True)
            (assets / "index-fresh.js").write_text("console.log('fresh');", encoding="utf-8")
            (assets / "index-fresh.css").write_text("body { color: #111; }", encoding="utf-8")
            index_path = root / "dist" / "index.html"
            index_path.write_text(
                '<script type="module" crossorigin src="./assets/index-fresh.js"></script>'
                '<link rel="stylesheet" crossorigin href="./assets/index-fresh.css">',
                encoding="utf-8",
            )
            manifest_path.write_text('{"version":"20260703","executable":"SSH-Agent-Tool.exe"}', encoding="utf-8")

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "app_data_root", lambda: data_root):
                    with patch.object(desktop_app, "release_manifest_path", lambda: manifest_path):
                        with patch.object(desktop_app, "ui_index_path", lambda: index_path):
                            with patch.object(desktop_app, "detect_webview2_runtime", return_value={"available": True, "source": "registry"}):
                                report = desktop_app.build_startup_smoke_report()

        self.assertTrue(report["ok"])
        self.assertIn("clientEntry", report)
        self.assertTrue(report["clientEntry"]["ok"])
        self.assertTrue(any(item["name"] == "clientEntry" and item["ok"] for item in report["checks"]))
        self.assertIn("recommendedEntry", report["clientEntry"])

    def test_delete_credential_removes_saved_secret_and_logs_action(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                with patch.object(desktop_app, "CredentialStore") as store_class:
                    store_class.return_value.delete_secret.return_value = {
                        "ok": True,
                        "deleted": True,
                        "credentialRef": "cred-1",
                    }

                    result = DesktopApi().delete_credential("cred-1")

            store_class.return_value.delete_secret.assert_called_once_with("cred-1")
            self.assertTrue(result["ok"])
            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertIn("credential", saved)
            self.assertIn("delete_credential", saved)
            self.assertNotIn("cred-1", saved)

    def test_log_tool_exception_records_traceback_without_secrets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                try:
                    raise RuntimeError("password=ServerPassword!123")
                except RuntimeError as error:
                    desktop_app.log_tool_exception("runtime", "uncaught_exception", error, {"apiKey": "sk-secret-value"})

            saved = next(log_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertIn("RuntimeError", saved)
            self.assertIn("uncaught_exception", saved)
            self.assertNotIn("ServerPassword!123", saved)
            self.assertNotIn("sk-secret-value", saved)

    def test_entry_focuses_existing_window_when_another_instance_is_running(self):
        calls = []

        class FakeWebview:
            def create_window(self, **kwargs):
                calls.append(("create_window", kwargs["title"]))
                return object()

            def start(self, debug=False):
                calls.append(("start", debug))

        with tempfile.TemporaryDirectory() as temp_dir:
            index = Path(temp_dir) / "index.html"
            index.write_text("<html></html>", encoding="utf-8")
            fake_webview = FakeWebview()

            with patch.dict(sys.modules, {"webview": fake_webview}):
                with patch.object(desktop_app, "ui_index_path", lambda: index):
                    with patch.object(desktop_app, "acquire_single_instance_lock", lambda: None, create=True):
                        with patch.object(desktop_app, "log_tool_event", lambda event: calls.append(("log_tool_event", event))):
                            with patch.object(desktop_app, "focus_existing_window", lambda: calls.append(("focus_existing_window", None)) or True):
                                result = desktop_app.run_desktop_entry()

            self.assertEqual(result, 0)
            self.assertEqual(calls[0][0], "log_tool_event")
            self.assertEqual(calls[0][1]["action"], "app_already_running")
            self.assertEqual(calls[0][1]["context"], {"pid": desktop_app.os.getpid()})

            self.assertIn(("focus_existing_window", None), calls)

    def test_entry_shows_notice_when_existing_instance_cannot_be_focused(self):
        calls = []

        with patch.object(desktop_app, "acquire_single_instance_lock", lambda: None, create=True):
            with patch.object(desktop_app, "log_tool_event", lambda event: calls.append(("log_tool_event", event))):
                with patch.object(desktop_app, "focus_existing_window", lambda: calls.append(("focus_existing_window", None)) or False):
                    with patch.object(desktop_app, "show_already_running_dialog", lambda: calls.append(("show_already_running_dialog", None)), create=True):
                        result = desktop_app.run_desktop_entry()

        self.assertEqual(result, 0)
        self.assertIn(("focus_existing_window", None), calls)
        self.assertIn(("show_already_running_dialog", None), calls)

    def test_already_running_message_points_to_normal_windows_client_actions(self):
        message = desktop_app.build_already_running_message()

        self.assertIn("SSH Agent 工具已经在运行", message)
        self.assertIn("Windows 任务栏", message)
        self.assertIn("SSH-Agent-Tool.exe", message)
        self.assertNotIn(".bat", message.lower())
        self.assertNotIn(".ps1", message.lower())
        self.assertNotIn("命令行", message)

    def test_focus_existing_window_restores_and_foregrounds_matching_window(self):
        calls = []

        class FakeUser32:
            def FindWindowW(self, class_name, title):
                calls.append(("FindWindowW", class_name, title))
                return 101

            def IsIconic(self, hwnd):
                calls.append(("IsIconic", hwnd))
                return True

            def ShowWindow(self, hwnd, command):
                calls.append(("ShowWindow", hwnd, command))
                return True

            def SetForegroundWindow(self, hwnd):
                calls.append(("SetForegroundWindow", hwnd))
                return True

        result = desktop_app.focus_existing_window(user32=FakeUser32(), platform="win32")

        self.assertTrue(result)
        self.assertEqual(calls[0], ("FindWindowW", None, desktop_app.APP_TITLE))
        self.assertIn(("ShowWindow", 101, 9), calls)
        self.assertEqual(calls[-1], ("SetForegroundWindow", 101))

    def test_entry_installs_runtime_exception_logging_before_starting_webview(self):
        calls = []

        class FakeLock:
            def release(self):
                calls.append(("release_lock", None))

        class FakeWebview:
            def create_window(self, **kwargs):
                calls.append(("create_window", kwargs["title"]))
                return object()

            def start(self, debug=False):
                calls.append(("start", debug))

        with tempfile.TemporaryDirectory() as temp_dir:
            index = Path(temp_dir) / "index.html"
            index.write_text("<html></html>", encoding="utf-8")
            fake_webview = FakeWebview()

            with patch.dict(sys.modules, {"webview": fake_webview}):
                with patch.object(desktop_app, "ui_index_path", lambda: index):
                    with patch.object(desktop_app, "acquire_single_instance_lock", lambda: FakeLock(), create=True):
                        with patch.object(desktop_app, "hide_packaged_console", lambda: calls.append(("hide_packaged_console", None))):
                            with patch.object(desktop_app, "install_runtime_exception_logging", lambda: calls.append(("install_runtime_exception_logging", None))):
                                with patch.object(desktop_app, "log_app_startup", lambda context=None: calls.append(("log_app_startup", context))):
                                    result = desktop_app.run_desktop_entry()

            self.assertEqual(result, 0)
            self.assertEqual(calls[0][0], "hide_packaged_console")
            self.assertEqual(calls[1][0], "install_runtime_exception_logging")
            self.assertEqual(calls[2][0], "log_app_startup")
            self.assertEqual(calls[-2], ("start", False))
            self.assertEqual(calls[-1], ("release_lock", None))

    def test_runtime_exception_logging_records_unraisable_exceptions(self):
        calls = []
        original_unraisablehook = getattr(sys, "unraisablehook", None)
        original_installed = desktop_app._runtime_exception_logging_installed

        class UnraisableArgs:
            exc_type = RuntimeError
            exc_value = RuntimeError("cleanup callback failed")
            exc_traceback = None
            err_msg = "Exception ignored in"
            object = "native callback"

        try:
            desktop_app._runtime_exception_logging_installed = False
            sys.unraisablehook = lambda args: calls.append(("original", getattr(args, "err_msg", "")))

            with patch.object(desktop_app, "log_tool_exception", lambda component, action, error, context=None: calls.append((component, action, str(error), context))):
                desktop_app.install_runtime_exception_logging()
                sys.unraisablehook(UnraisableArgs())

            self.assertEqual(calls[0][0], "runtime")
            self.assertEqual(calls[0][1], "unraisable_exception")
            self.assertIn("cleanup callback failed", calls[0][2])
            self.assertEqual(calls[0][3]["exceptionType"], "RuntimeError")
            self.assertEqual(calls[0][3]["errMsg"], "Exception ignored in")
            self.assertEqual(calls[0][3]["object"], "native callback")
            self.assertEqual(calls[-1], ("original", "Exception ignored in"))
        finally:
            desktop_app._runtime_exception_logging_installed = original_installed
            if original_unraisablehook is not None:
                sys.unraisablehook = original_unraisablehook

    def test_desktop_main_shuts_down_runtime_after_webview_exits(self):
        calls = []

        class FakeApi:
            def shutdown_runtime(self, reason):
                calls.append(("shutdown_runtime", reason))
                return {"ok": True}

        class FakeWebview:
            def create_window(self, **kwargs):
                calls.append(("create_window", kwargs["js_api"]))
                return object()

            def start(self, debug=False):
                calls.append(("start", debug))

        with tempfile.TemporaryDirectory() as temp_dir:
            index = Path(temp_dir) / "index.html"
            index.write_text("<html></html>", encoding="utf-8")

            with patch.dict(sys.modules, {"webview": FakeWebview()}):
                with patch.object(desktop_app, "ui_index_path", lambda: index):
                    with patch.object(desktop_app, "log_app_startup", lambda context=None: calls.append(("log_app_startup", context))):
                        with patch.object(desktop_app, "DesktopApi", FakeApi):
                            result = desktop_app.main()

        self.assertEqual(result, 0)
        self.assertEqual(calls[-1], ("shutdown_runtime", "window_closed"))
        self.assertEqual(calls[1][0], "create_window")
        self.assertIsInstance(calls[1][1], FakeApi)

    def test_desktop_main_stops_with_clear_webview2_message_before_window_when_runtime_missing(self):
        calls = []

        class FakeWebview:
            def create_window(self, **kwargs):
                calls.append(("create_window", kwargs))
                return object()

            def start(self, debug=False):
                calls.append(("start", debug))

        with tempfile.TemporaryDirectory() as temp_dir:
            index = Path(temp_dir) / "index.html"
            index.write_text("<html></html>", encoding="utf-8")

            with patch.dict(sys.modules, {"webview": FakeWebview()}):
                with patch.object(sys, "platform", "win32"):
                    with patch.object(desktop_app, "ui_index_path", lambda: index):
                        with patch.object(desktop_app, "detect_webview2_runtime", return_value={"available": False, "source": "registry", "message": "WebView2 Runtime missing"}):
                            with patch.object(desktop_app, "log_app_startup", lambda context=None: calls.append(("log_app_startup", context))):
                                with self.assertRaises(RuntimeError) as raised:
                                    desktop_app.main()

        self.assertIn("WebView2 Runtime missing", str(raised.exception))
        self.assertIn("Microsoft Edge WebView2 Runtime", str(raised.exception))
        self.assertNotIn(("create_window",), calls)
        self.assertFalse(any(call[0] == "create_window" for call in calls))


if __name__ == "__main__":
    unittest.main()
