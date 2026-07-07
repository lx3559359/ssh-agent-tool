import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from diagnostic_package import build_runtime_environment_summary_markdown, write_diagnostic_package


class DiagnosticPackageTests(unittest.TestCase):
    def test_diagnostic_package_includes_problem_feedback_template(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            release_manifest = root / "manifest.json"
            release_manifest.write_text(
                json.dumps(
                    {
                        "version": "preview-test",
                        "packageFile": "SSH-Agent-Tool-preview-test.zip",
                        "packageSha256": "ZIPHASH123456",
                        "standaloneExeSha256": "EXEHASH123456",
                        "frontendAssets": {
                            "script": "assets/index-latest-test.js",
                            "scriptSha256": "SCRIPTHASH123456",
                        },
                    }
                ),
                encoding="utf-8-sig",
            )
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"releaseManifest": release_manifest},
                {
                    "createdAt": "2026-07-04T12:30:00Z",
                    "runtimeDiagnostics": {
                        "executable": "D:\\SSHAgent\\SSH-Agent-Tool.exe",
                        "executableDirectory": "D:\\SSHAgent",
                        "startupFailureLog": {
                            "exists": True,
                            "knownSignature": "ReferenceError: Power is not defined",
                        },
                    },
                },
            )

            self.assertTrue(result["ok"])
            self.assertIn("\u95ee\u9898\u53cd\u9988\u6a21\u677f.txt", result["files"])
            with zipfile.ZipFile(target) as archive:
                template = archive.read("\u95ee\u9898\u53cd\u9988\u6a21\u677f.txt").decode("utf-8")

            self.assertIn("\u590d\u73b0\u6b65\u9aa4", template)
            self.assertIn("assets/index-latest-test.js", template)
            self.assertIn("ReferenceError: Power is not defined", template)
            self.assertIn("ZIPHASH123456", template)
            self.assertIn("\u4e0d\u8981\u53d1\u9001\u5bc6\u7801", template)
            self.assertIn("API Key", template)

    def test_write_diagnostic_package_collects_logs_manifest_and_redacts_secrets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            tool_root.mkdir()
            (session_root / "2026-06-27").mkdir(parents=True)
            (tool_root / "2026-06-27.jsonl").write_text(
                '{"message":"api_key=sk-secret-value password=ServerPassword!123"}\n',
                encoding="utf-8",
            )
            (tool_root / "2026-06-28.jsonl").write_text(
                "\n".join(
                    [
                        '{"schema":"ssh-agent-tool.tool-log.v1","createdAt":"2026-06-28T09:00:00Z","level":"info","component":"ssh","action":"open_session","message":"ok"}',
                        '{"schema":"ssh-agent-tool.tool-log.v1","createdAt":"2026-06-28T09:00:30Z","level":"info","component":"app","action":"app_start","message":"应用启动","context":{"webView2Runtime":{"available":false,"source":"registry","message":"未检测到 Microsoft Edge WebView2 Runtime。"}}}',
                        '{"schema":"ssh-agent-tool.tool-log.v1","createdAt":"2026-06-28T09:01:00Z","level":"warning","component":"frontend","action":"local_storage_read_failed","message":"apiKey sk-runtime-secret"}',
                        '{"schema":"ssh-agent-tool.tool-log.v1","createdAt":"2026-06-28T09:02:00Z","level":"error","component":"ssh","action":"pty_input_failed","message":"password=RuntimePassword!123"}',
                        '{"schema":"ssh-agent-tool.tool-log.v1","createdAt":"2026-06-28T09:03:00Z","level":"warn","component":"ssh","action":"open_session","message":"Permission denied password=RuntimePassword!123","context":{"serverName":"prod-web-01","host":"10.0.1.23","port":22,"user":"root","failureKind":"auth","credentialRef":"sshcred-prod"}}',
                        '{"schema":"ssh-agent-tool.tool-log.v1","createdAt":"2026-06-28T09:04:00Z","level":"warn","component":"ssh","action":"test_login","message":"Connection timed out","context":{"serverName":"prod-db-01","host":"10.0.1.31","port":2222,"user":"deploy","failureKind":"timeout"}}',
                        '{"schema":"ssh-agent-tool.tool-log.v1","createdAt":"2026-06-28T09:05:00Z","level":"warn","component":"ssh","action":"readonly_command","message":"Permission denied","context":{"serverName":"prod-web-01","host":"10.0.1.23","port":22,"user":"root","failureKind":"auth","command":"uptime"}}',
                        '{"schema":"ssh-agent-tool.tool-log.v1","createdAt":"2026-06-28T09:06:00Z","level":"warn","component":"sftp","action":"download_file","message":"SFTP 下载失败：Permission denied","context":{"server":{"name":"prod-web-01","ip":"10.0.1.23","user":"root"},"remotePath":"/var/log/secure","localPath":"C:/Users/Admin/Desktop/secure.log"}}',
                        '{"schema":"ssh-agent-tool.tool-log.v1","createdAt":"2026-06-28T09:07:00Z","level":"error","component":"sftp","action":"upload_file","message":"SFTP 上传失败：No such file","context":{"server":{"name":"prod-db-01","ip":"10.0.1.31","user":"deploy"},"remotePath":"/opt/app/release.zip","localPath":"C:/Users/Admin/Secrets/release.zip"}}',
                        '{"schema":"ssh-agent-tool.tool-log.v1","createdAt":"2026-06-28T09:08:00Z","level":"error","component":"model-api","action":"list_models","message":"model list failed sk-model-secret","context":{"model":{"provider":"Relay API","baseUrl":"https://relay.example/v1","model":"gpt-4.1-mini","apiKey":"sk-model-secret"}}}',
                        '{"schema":"ssh-agent-tool.tool-log.v1","createdAt":"2026-06-28T09:09:00Z","level":"warn","component":"model-api","action":"test_connection","message":"model api returned non-json","context":{"model":{"provider":"Ollama Local","baseUrl":"http://127.0.0.1:11434","model":"qwen2.5-coder:7b"}}}',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            (session_root / "2026-06-27" / "prod-sess.jsonl").write_text(
                '{"command":"curl -H Authorization: Bearer token-secret https://example.com"}\n',
                encoding="utf-8",
            )
            config_path = root / "config.json"
            config_path.write_text(
                json.dumps(
                    {
                        "modelConfig": {"apiKey": "sk-secret-value"},
                        "customServers": {"prod-web-01": {"password": "ServerPassword!123"}},
                    }
                ),
                encoding="utf-8",
            )
            release_manifest = root / "manifest.json"
            release_manifest.write_text(
                json.dumps(
                    {
                        "version": "preview-test",
                        "sha256": "ABCDEF123456",
                        "packageFile": "SSH-Agent-Tool-preview-test.zip",
                        "packageSha256": "ZIPHASH123456",
                        "standaloneExeSha256": "EXEHASH123456",
                        "frontendAssets": {
                            "script": "assets/index-preview-test.js",
                            "scriptSha256": "SCRIPTHASH123456",
                            "stylesheet": "assets/index-preview-test.css",
                            "stylesheetSha256": "STYLEHASH123456",
                        },
                        "verification": [
                            {"name": "frontend", "status": "passed"},
                            {"name": "backend", "status": "passed"},
                            {"name": "smoke", "status": "skipped"},
                        ],
                    }
                ),
                encoding="utf-8-sig",
            )
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {
                    "toolLogs": tool_root,
                    "sessionLogs": session_root,
                    "config": config_path,
                    "releaseManifest": release_manifest,
                },
                {
                    "createdAt": "2026-06-27T12:00:00Z",
                    "runtimeDiagnostics": {
                        "executable": "D:\\tools\\SSH-Agent-Tool.exe",
                        "executableDirectory": "D:\\tools",
                    },
                },
            )

            self.assertTrue(result["ok"])
            self.assertTrue(target.exists())
            self.assertIn("manifest.json", result["files"])
            self.assertIn("runtime-summary.json", result["files"])
            self.assertIn("config-summary.json", result["files"])
            self.assertIn("支持排查说明.md", result["files"])
            with zipfile.ZipFile(target) as archive:
                names = archive.namelist()
                combined = "\n".join(archive.read(name).decode("utf-8") for name in names)
                package_manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
                runtime_summary = json.loads(archive.read("runtime-summary.json").decode("utf-8"))
                support_readme = archive.read("支持排查说明.md").decode("utf-8")
                readme = archive.read("README.txt").decode("utf-8")

            self.assertIn("tool-logs/2026-06-27.jsonl", names)
            self.assertIn("session-logs/2026-06-27/prod-sess.jsonl", names)
            self.assertIn("SSH Agent 工具诊断包", readme)
            self.assertIn("工具自身 BUG", readme)
            self.assertIn("不包含明文密码、API Key、Token 或私钥", package_manifest["privacy"])
            self.assertEqual(runtime_summary["schema"], "ssh-agent-tool.runtime-summary.v1")
            self.assertEqual(runtime_summary["runtimeDiagnostics"]["executableDirectory"], "D:\\tools")
            self.assertIn("D:\\tools", support_readme)
            self.assertEqual(runtime_summary["logs"]["toolLogs"]["count"], 2)
            self.assertEqual(runtime_summary["logs"]["sessionLogs"]["count"], 1)
            self.assertEqual(runtime_summary["webView2Runtime"]["available"], False)
            self.assertEqual(runtime_summary["webView2Runtime"]["source"], "registry")
            self.assertEqual(runtime_summary["recentToolEvents"]["counts"]["warn"], 6)
            self.assertEqual(runtime_summary["recentToolEvents"]["counts"]["error"], 3)
            recent_actions = [event["action"] for event in runtime_summary["recentToolEvents"]["events"]]
            self.assertIn("readonly_command", recent_actions)
            self.assertIn("test_login", recent_actions)
            self.assertEqual(runtime_summary["frontendIncidents"]["counts"]["local_storage_read_failed"], 1)
            self.assertEqual(runtime_summary["frontendIncidents"]["recent"][0]["action"], "local_storage_read_failed")
            self.assertEqual(runtime_summary["modelApiFailures"]["counts"]["list_models"], 1)
            self.assertEqual(runtime_summary["modelApiFailures"]["counts"]["test_connection"], 1)
            self.assertEqual(runtime_summary["modelApiFailures"]["recent"][0]["provider"], "Ollama Local")
            self.assertEqual(runtime_summary["modelApiFailures"]["recent"][1]["provider"], "Relay API")
            self.assertNotIn("sk-model-secret", json.dumps(runtime_summary["modelApiFailures"], ensure_ascii=False))
            self.assertEqual(runtime_summary["sftpFailures"]["counts"]["download_file"], 1)
            self.assertEqual(runtime_summary["sftpFailures"]["counts"]["upload_file"], 1)
            self.assertEqual(runtime_summary["sftpFailures"]["recent"][0]["serverName"], "prod-db-01")
            self.assertEqual(runtime_summary["sftpFailures"]["recent"][0]["localName"], "release.zip")
            self.assertNotIn("C:/Users/Admin/Secrets", json.dumps(runtime_summary["sftpFailures"], ensure_ascii=False))
            self.assertEqual(runtime_summary["sshFailures"]["counts"]["auth"], 2)
            self.assertEqual(runtime_summary["sshFailures"]["counts"]["timeout"], 1)
            self.assertEqual(runtime_summary["sshFailures"]["counts"]["host-key"], 0)
            self.assertEqual(runtime_summary["sshFailures"]["recent"][0]["serverName"], "prod-web-01")
            self.assertEqual(runtime_summary["sshFailures"]["recent"][0]["failureKind"], "auth")
            self.assertEqual(runtime_summary["sshFailures"]["recent"][1]["serverName"], "prod-db-01")
            self.assertEqual(runtime_summary["sshFailures"]["recent"][1]["failureKind"], "timeout")
            self.assertEqual(runtime_summary["inputs"]["config"]["exists"], True)
            self.assertEqual(package_manifest["releaseSummary"]["version"], "preview-test")
            self.assertEqual(package_manifest["releaseSummary"]["sha256"], "ABCDEF123456")
            self.assertEqual(package_manifest["releaseSummary"]["packageFile"], "SSH-Agent-Tool-preview-test.zip")
            self.assertEqual(package_manifest["releaseSummary"]["packageSha256"], "ZIPHASH123456")
            self.assertEqual(package_manifest["releaseSummary"]["standaloneExeSha256"], "EXEHASH123456")
            self.assertEqual(package_manifest["releaseSummary"]["frontendAssets"]["script"], "assets/index-preview-test.js")
            self.assertEqual(package_manifest["releaseSummary"]["frontendAssets"]["scriptSha256"], "SCRIPTHASH123456")
            self.assertEqual(package_manifest["releaseSummary"]["verification"]["total"], 3)
            self.assertEqual(package_manifest["releaseSummary"]["verification"]["passed"], 2)
            self.assertEqual(package_manifest["releaseSummary"]["verification"]["skipped"], 1)
            self.assertEqual(runtime_summary["release"]["packageSha256"], "ZIPHASH123456")
            self.assertEqual(runtime_summary["release"]["frontendAssets"]["scriptSha256"], "SCRIPTHASH123456")
            self.assertEqual(runtime_summary["release"]["verification"]["passed"], 2)
            self.assertIn("python", runtime_summary["runtime"])
            self.assertIn("ZIPHASH123456", combined)
            self.assertIn("EXEHASH123456", combined)
            self.assertIn("assets/index-preview-test.js", combined)
            self.assertIn("SCRIPTHASH123456", combined)
            self.assertIn("# SSH Agent 工具诊断包", support_readme)
            self.assertIn("版本：preview-test", support_readme)
            self.assertIn("ZIP SHA256：ZIPHASH123456", support_readme)
            self.assertIn("EXE SHA256：EXEHASH123456", support_readme)
            self.assertIn("前端资源：assets/index-preview-test.js", support_readme)
            self.assertIn("前端资源 SHA256：SCRIPTHASH123456", support_readme)
            self.assertIn("工具日志：2 个文件", support_readme)
            self.assertIn("会话日志：1 个文件", support_readme)
            self.assertIn("不包含明文密码、API Key、Token 或私钥", support_readme)
            self.assertIn("如果是跨电脑打不开或白屏", support_readme)
            self.assertIn("preview-test", combined)
            self.assertIn("prod-web-01", combined)
            self.assertIn("[已脱敏]", combined)
            self.assertNotIn("sk-secret-value", combined)
            self.assertNotIn("sk-runtime-secret", combined)
            self.assertNotIn("ServerPassword!123", combined)
            self.assertNotIn("RuntimePassword!123", combined)
            self.assertNotIn("sshcred-prod", combined)
            self.assertNotIn("credentialRef", combined)
            self.assertNotIn("token-secret", combined)

    def test_empty_log_directories_are_documented_in_chinese(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"toolLogs": root / "missing-tool-logs", "sessionLogs": root / "missing-session-logs"},
                {"createdAt": "2026-06-27T12:00:00Z"},
            )

            self.assertTrue(result["ok"])
            with zipfile.ZipFile(target) as archive:
                tool_empty = archive.read("tool-logs/EMPTY.txt").decode("utf-8")
                session_empty = archive.read("session-logs/EMPTY.txt").decode("utf-8")

            self.assertIn("当前没有可导出的日志文件", tool_empty)
            self.assertIn("当前没有可导出的日志文件", session_empty)


    def test_diagnostic_package_includes_release_update_status_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            update_status = root / "updates" / "update-status.json"
            update_status.parent.mkdir()
            update_status.write_text(
                json.dumps(
                    {
                        "status": "failed",
                        "message": "replace denied",
                        "updatedAt": "2026-07-02 12:30:00",
                        "packageZip": "C:/Users/Admin/AppData/Roaming/SSHAgentTool/updates/SSH-Agent-Tool-20260702.zip",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"releaseUpdateStatus": update_status},
                {"createdAt": "2026-07-02T12:35:00Z"},
            )

            self.assertTrue(result["ok"])
            self.assertIn("release-update-status.json", result["files"])
            with zipfile.ZipFile(target) as archive:
                archived_status = json.loads(archive.read("release-update-status.json").decode("utf-8"))
                runtime_summary = json.loads(archive.read("runtime-summary.json").decode("utf-8"))

            self.assertEqual(archived_status["status"], "failed")
            self.assertEqual(archived_status["message"], "replace denied")
            self.assertEqual(runtime_summary["inputs"]["releaseUpdateStatus"]["exists"], True)
            self.assertNotIn("C:/Users/Admin/AppData", json.dumps(archived_status, ensure_ascii=False))

    def test_diagnostic_package_includes_release_updater_log_when_available(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            updater_log = root / "updates" / "release-updater.log"
            updater_log.parent.mkdir()
            updater_log.write_text(
                "2026-07-03 12:00:00 update failed: replace denied password=Secret!123\n",
                encoding="utf-8",
            )
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"releaseUpdateLog": updater_log},
                {"createdAt": "2026-07-03T12:05:00Z"},
            )

            self.assertTrue(result["ok"])
            self.assertIn("release-update/release-updater.log", result["files"])
            with zipfile.ZipFile(target) as archive:
                archived_log = archive.read("release-update/release-updater.log").decode("utf-8")

            self.assertIn("replace denied", archived_log)
            self.assertNotIn("Secret!123", archived_log)

    def test_support_readme_points_to_release_updater_log(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            updater_log = root / "updates" / "release-updater.log"
            updater_log.parent.mkdir()
            updater_log.write_text("2026-07-03 updater started\n", encoding="utf-8")
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"releaseUpdateLog": updater_log},
                {"createdAt": "2026-07-03T12:10:00Z"},
            )

            self.assertTrue(result["ok"])
            with zipfile.ZipFile(target) as archive:
                support_readme = archive.read("支持排查说明.md").decode("utf-8")

            self.assertIn("release-update/release-updater.log", support_readme)
            self.assertIn("更新器日志", support_readme)

    def test_diagnostic_package_includes_startup_failure_log_when_available(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            startup_log = root / "logs" / "startup-failure-latest.log"
            startup_log.parent.mkdir()
            startup_log.write_text(
                "\n".join(
                    [
                        "SSH-Agent-Tool 启动失败",
                        "错误信息: ReferenceError: Power is not defined",
                        "上下文: password=StartupSecret!123 token=startup-token-secret",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"startupFailureLog": startup_log},
                {"createdAt": "2026-07-03T08:00:00Z"},
            )

            self.assertTrue(result["ok"])
            self.assertIn("startup-failure/startup-failure-latest.log", result["files"])
            self.assertIn("startup-failure-summary.md", result["files"])
            with zipfile.ZipFile(target) as archive:
                runtime_summary = json.loads(archive.read("runtime-summary.json").decode("utf-8"))
                archived_log = archive.read("startup-failure/startup-failure-latest.log").decode("utf-8")
                startup_summary = archive.read("startup-failure-summary.md").decode("utf-8")

            self.assertEqual(runtime_summary["inputs"]["startupFailureLog"]["exists"], True)
            self.assertGreater(runtime_summary["inputs"]["startupFailureLog"]["sizeBytes"], 0)
            self.assertIn("启动失败摘要", startup_summary)
            self.assertIn("旧版前端资源或旧安装包", startup_summary)
            self.assertIn("删除旧解压目录和旧桌面快捷方式", startup_summary)
            self.assertIn("Power is not defined", archived_log)
            self.assertNotIn("StartupSecret!123", archived_log)
            self.assertNotIn("startup-token-secret", archived_log)
            self.assertNotIn("StartupSecret!123", startup_summary)
            self.assertNotIn("startup-token-secret", startup_summary)

    def test_startup_failure_summary_includes_frontend_mismatch_from_runtime_diagnostics(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            startup_log = root / "logs" / "startup-failure-latest.log"
            startup_log.parent.mkdir()
            startup_log.write_text("界面发生错误，但日志里没有明确旧包资源名。\n", encoding="utf-8")
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"startupFailureLog": startup_log},
                {
                    "createdAt": "2026-07-04T10:40:00Z",
                    "runtimeDiagnostics": {
                        "startupIdentity": {
                            "runtimeScript": "assets/index-old.js",
                            "manifestScript": "assets/index-current.js",
                            "frontendMatchesManifest": False,
                        }
                    },
                },
            )

            self.assertTrue(result["ok"])
            with zipfile.ZipFile(target) as archive:
                startup_summary = archive.read("startup-failure-summary.md").decode("utf-8")

            self.assertIn("assets/index-old.js", startup_summary)
            self.assertIn("assets/index-current.js", startup_summary)
            self.assertIn("frontendMatchesManifest", startup_summary)

    def test_diagnostic_package_includes_runtime_diagnostics_and_frontend_assets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {},
                {
                    "createdAt": "2026-07-02T13:10:00Z",
                    "runtimeDiagnostics": {
                        "ok": True,
                        "uiIndexPath": "C:/Program Files/SSH Agent/dist/index.html",
                        "uiIndexExists": True,
                        "frontendAssets": {
                            "script": "assets/index-Co2gkFMc.js",
                            "scriptSha256": "1524723F1BE266470F41537D2EF03066EDDB378BD88EEE70DC69B63B771D8CC6",
                            "stylesheet": "assets/index-DCTW_QqN.css",
                            "stylesheetSha256": "A057DACF6B561CFC65E1E0A6EA84A93FA9FF515AA4E0CD1AF98A7E9E710FCC60",
                        },
                        "executableMode": {"mode": "single-exe", "message": "normal client"},
                        "apiKey": "sk-runtime-hidden",
                    },
                },
            )

            self.assertTrue(result["ok"])
            self.assertIn("runtime-diagnostics.json", result["files"])
            with zipfile.ZipFile(target) as archive:
                runtime_diagnostics = json.loads(archive.read("runtime-diagnostics.json").decode("utf-8"))
                runtime_summary = json.loads(archive.read("runtime-summary.json").decode("utf-8"))
                combined = "\n".join(archive.read(name).decode("utf-8") for name in archive.namelist())

            self.assertEqual(runtime_diagnostics["frontendAssets"]["script"], "assets/index-Co2gkFMc.js")
            self.assertEqual(
                runtime_summary["runtimeDiagnostics"]["frontendAssets"]["scriptSha256"],
                "1524723F1BE266470F41537D2EF03066EDDB378BD88EEE70DC69B63B771D8CC6",
            )
            self.assertEqual(runtime_summary["runtimeDiagnostics"]["executableMode"]["mode"], "single-exe")
            self.assertNotIn("sk-runtime-hidden", combined)

    def test_diagnostic_package_preserves_specific_ssh_failure_kinds(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            tool_root.mkdir()
            session_root.mkdir()
            kinds = ["dns", "refused", "handshake", "algorithm", "host-key", "key-file", "agent-auth", "transport", "config", "environment", "input"]
            lines = [
                json.dumps(
                    {
                        "schema": "ssh-agent-tool.tool-log.v1",
                        "createdAt": f"2026-06-28T09:0{index}:00Z",
                        "level": "warn",
                        "component": "ssh",
                        "action": "test_login",
                        "message": f"SSH failure {kind}",
                        "context": {
                            "serverName": f"prod-{kind}",
                            "host": "10.0.1.23",
                            "port": 22,
                            "user": "root",
                            "failureKind": kind,
                        },
                    },
                    ensure_ascii=False,
                )
                for index, kind in enumerate(kinds)
            ]
            (tool_root / "2026-06-28.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"toolLogs": tool_root, "sessionLogs": session_root},
                {"createdAt": "2026-06-28T12:00:00Z"},
            )

            self.assertTrue(result["ok"])
            with zipfile.ZipFile(target) as archive:
                runtime_summary = json.loads(archive.read("runtime-summary.json").decode("utf-8"))

            self.assertEqual(runtime_summary["sshFailures"]["total"], len(kinds))
            for kind in kinds:
                self.assertEqual(runtime_summary["sshFailures"]["counts"][kind], 1)
            self.assertEqual(runtime_summary["sshFailures"]["counts"]["unknown"], 0)
            self.assertEqual(
                {item["failureKind"] for item in runtime_summary["sshFailures"]["recent"]},
                set(kinds),
            )

    def test_diagnostic_package_includes_readable_ssh_failure_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            tool_root.mkdir()
            session_root.mkdir()
            (tool_root / "2026-06-28.jsonl").write_text(
                "\n".join(
                    [
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-06-28T09:00:00Z",
                                "level": "warn",
                                "component": "ssh",
                                "action": "test_login",
                                "message": "Permission denied password=TopSecret!123",
                                "context": {
                                    "serverName": "prod-web-01",
                                    "host": "10.0.1.23",
                                    "port": 22,
                                    "user": "root",
                                    "failureKind": "auth",
                                    "credentialRef": "sshcred-prod-web",
                                },
                            },
                            ensure_ascii=False,
                        ),
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-06-28T09:05:00Z",
                                "level": "warn",
                                "component": "ssh",
                                "action": "open_session",
                                "message": "Could not resolve hostname sk-hidden",
                                "context": {
                                    "serverName": "prod-api-01",
                                    "host": "api.internal",
                                    "port": 2222,
                                    "user": "deploy",
                                    "failureKind": "dns",
                                },
                            },
                            ensure_ascii=False,
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"toolLogs": tool_root, "sessionLogs": session_root},
                {"createdAt": "2026-06-28T12:00:00Z"},
            )

            self.assertTrue(result["ok"])
            self.assertIn("ssh-failures-summary.md", result["files"])
            with zipfile.ZipFile(target) as archive:
                summary = archive.read("ssh-failures-summary.md").decode("utf-8")

            self.assertIn("# SSH 连接失败摘要", summary)
            self.assertIn("| auth | 1 |", summary)
            self.assertIn("| dns | 1 |", summary)
            self.assertIn("prod-web-01", summary)
            self.assertIn("prod-api-01", summary)
            self.assertIn("api.internal", summary)
            self.assertNotIn("TopSecret!123", summary)
            self.assertNotIn("sshcred-prod-web", summary)
            self.assertNotIn("sk-hidden", summary)

    def test_diagnostic_package_summarizes_ssh_connection_health(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            tool_root.mkdir()
            (session_root / "2026-07-03").mkdir(parents=True)
            (tool_root / "2026-07-03.jsonl").write_text(
                "\n".join(
                    [
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-07-03T10:00:00Z",
                                "level": "info",
                                "component": "ssh",
                                "action": "auto_test_saved_connection",
                                "message": "连接测试通过",
                                "context": {
                                    "serverName": "prod-web-01",
                                    "host": "10.0.1.23",
                                    "port": 22,
                                    "user": "root",
                                    "password": "ServerPassword!123",
                                },
                            },
                            ensure_ascii=False,
                        ),
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-07-03T10:01:00Z",
                                "level": "warn",
                                "component": "ssh",
                                "action": "open_session",
                                "message": "Permission denied token=hidden-token",
                                "context": {
                                    "serverName": "prod-db-01",
                                    "host": "10.0.1.31",
                                    "port": 2222,
                                    "user": "deploy",
                                    "failureKind": "auth",
                                    "credentialRef": "cred-prod-db",
                                },
                            },
                            ensure_ascii=False,
                        ),
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-07-03T10:02:00Z",
                                "level": "warn",
                                "component": "ssh",
                                "action": "check_session_health",
                                "message": "SSH session disconnected",
                                "context": {
                                    "sessionId": "sess-1",
                                    "failureKind": "transport",
                                },
                            },
                            ensure_ascii=False,
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            (session_root / "2026-07-03" / "prod-db-01-sess-1.jsonl").write_text(
                json.dumps(
                    {
                        "schema": "ssh-agent-tool.session-log.v1",
                        "createdAt": "2026-07-03T10:03:00Z",
                        "type": "session_health_failed",
                        "server": "prod-db-01",
                        "sessionId": "sess-1",
                        "actor": "system",
                        "status": "failed",
                        "message": "health failed api_key=sk-health-secret",
                        "context": {"failureKind": "transport", "host": "10.0.1.31"},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"toolLogs": tool_root, "sessionLogs": session_root},
                {"createdAt": "2026-07-03T10:30:00Z"},
            )

            self.assertTrue(result["ok"])
            self.assertIn("ssh-connection-health-summary.md", result["files"])
            with zipfile.ZipFile(target) as archive:
                runtime_summary = json.loads(archive.read("runtime-summary.json").decode("utf-8"))
                summary = archive.read("ssh-connection-health-summary.md").decode("utf-8")

            health = runtime_summary["sshConnectionHealth"]
            self.assertEqual(health["total"], 4)
            self.assertEqual(health["countsByAction"]["auto_test_saved_connection"], 1)
            self.assertEqual(health["countsByAction"]["open_session"], 1)
            self.assertEqual(health["countsByAction"]["check_session_health"], 1)
            self.assertEqual(health["countsByAction"]["session_health_failed"], 1)
            self.assertEqual(health["countsByStatus"]["ok"], 1)
            self.assertEqual(health["countsByStatus"]["failed"], 3)
            self.assertEqual(health["recent"][0]["action"], "session_health_failed")
            self.assertEqual(health["recent"][0]["serverName"], "prod-db-01")
            self.assertEqual(health["recent"][0]["failureKind"], "transport")
            self.assertIn("prod-web-01", summary)
            self.assertIn("prod-db-01", summary)
            self.assertIn("check_session_health", summary)
            combined = json.dumps(health, ensure_ascii=False) + summary
            self.assertNotIn("ServerPassword!123", combined)
            self.assertNotIn("hidden-token", combined)
            self.assertNotIn("cred-prod-db", combined)
            self.assertNotIn("sk-health-secret", combined)

    def test_diagnostic_package_includes_readable_model_api_failure_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            tool_root.mkdir()
            session_root.mkdir()
            (tool_root / "2026-06-28.jsonl").write_text(
                "\n".join(
                    [
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-06-28T10:00:00Z",
                                "level": "error",
                                "component": "model-api",
                                "action": "list_models",
                                "message": "model list failed apiKey=sk-model-secret",
                                "context": {
                                    "model": {
                                        "provider": "Relay API",
                                        "baseUrl": "https://relay.example/v1",
                                        "model": "gpt-4.1-mini",
                                        "apiKey": "sk-model-secret",
                                    }
                                },
                            },
                            ensure_ascii=False,
                        ),
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-06-28T10:05:00Z",
                                "level": "warn",
                                "component": "model-api",
                                "action": "test_connection",
                                "message": "model api returned non-json",
                                "context": {
                                    "model": {
                                        "provider": "Ollama Local",
                                        "baseUrl": "http://127.0.0.1:11434",
                                        "model": "qwen2.5-coder:7b",
                                    }
                                },
                            },
                            ensure_ascii=False,
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"toolLogs": tool_root, "sessionLogs": session_root},
                {"createdAt": "2026-06-28T12:00:00Z"},
            )

            self.assertTrue(result["ok"])
            self.assertIn("model-api-failures-summary.md", result["files"])
            with zipfile.ZipFile(target) as archive:
                summary = archive.read("model-api-failures-summary.md").decode("utf-8")

            self.assertIn("# 模型 API 失败摘要", summary)
            self.assertIn("| list_models | 1 |", summary)
            self.assertIn("| test_connection | 1 |", summary)
            self.assertIn("Relay API", summary)
            self.assertIn("https://relay.example/v1", summary)
            self.assertIn("gpt-4.1-mini", summary)
            self.assertIn("Ollama Local", summary)
            self.assertNotIn("sk-model-secret", summary)
            self.assertNotIn("apiKey=sk-model-secret", summary)

    def test_diagnostic_package_includes_readable_sftp_failure_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            tool_root.mkdir()
            session_root.mkdir()
            (tool_root / "2026-06-28.jsonl").write_text(
                "\n".join(
                    [
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-06-28T11:00:00Z",
                                "level": "warn",
                                "component": "sftp",
                                "action": "download_file",
                                "message": "download failed password=FileSecret!123",
                                "context": {
                                    "server": {"name": "prod-web-01", "ip": "10.0.1.23", "user": "root"},
                                    "remotePath": "/var/log/secure",
                                    "localPath": "C:/Users/Admin/Secrets/secure.log",
                                },
                            },
                            ensure_ascii=False,
                        ),
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-06-28T11:05:00Z",
                                "level": "error",
                                "component": "sftp",
                                "action": "upload_file",
                                "message": "upload failed api_key=sk-sftp-secret",
                                "context": {
                                    "server": {"name": "prod-api-01", "ip": "10.0.1.24", "user": "deploy"},
                                    "remotePath": "/opt/app/release.zip",
                                    "localPath": "C:/Users/Admin/Secrets/release.zip",
                                },
                            },
                            ensure_ascii=False,
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"toolLogs": tool_root, "sessionLogs": session_root},
                {"createdAt": "2026-06-28T12:00:00Z"},
            )

            self.assertTrue(result["ok"])
            self.assertIn("sftp-failures-summary.md", result["files"])
            with zipfile.ZipFile(target) as archive:
                summary = archive.read("sftp-failures-summary.md").decode("utf-8")

            self.assertIn("# SFTP 文件失败摘要", summary)
            self.assertIn("| download_file | 1 |", summary)
            self.assertIn("| upload_file | 1 |", summary)
            self.assertIn("prod-web-01", summary)
            self.assertIn("prod-api-01", summary)
            self.assertIn("/var/log/secure", summary)
            self.assertIn("/opt/app/release.zip", summary)
            self.assertIn("secure.log", summary)
            self.assertIn("release.zip", summary)
            self.assertNotIn("C:/Users/Admin/Secrets", summary)
            self.assertNotIn("FileSecret!123", summary)
            self.assertNotIn("sk-sftp-secret", summary)

    def test_diagnostic_package_includes_readable_release_update_failure_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            tool_root.mkdir()
            session_root.mkdir()
            (tool_root / "2026-06-28.jsonl").write_text(
                "\n".join(
                    [
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-06-28T12:00:00Z",
                                "level": "error",
                                "component": "release-update",
                                "action": "download_update",
                                "message": "更新包校验失败 api_key=sk-update-secret",
                                "context": {
                                    "updateCheckUrl": "https://updates.example.com/ssh-agent/latest.json",
                                    "updateSource": "remote",
                                    "version": "20260701",
                                    "latestVersion": "20260702",
                                    "packageUrl": "https://updates.example.com/SSH-Agent-Tool-20260702.zip",
                                    "localPath": "C:/Users/Admin/AppData/Local/SSH-Agent-Tool/updates/SSH-Agent-Tool-20260702.zip",
                                },
                            },
                            ensure_ascii=False,
                        ),
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-06-28T12:05:00Z",
                                "level": "warn",
                                "component": "release-update",
                                "action": "start_install",
                                "message": "更新器启动失败 password=UpdateSecret!123",
                                "context": {
                                    "updateSource": "local",
                                    "version": "20260701",
                                    "latestVersion": "20260702",
                                    "localPath": "C:/Users/Admin/AppData/Local/SSH-Agent-Tool/updates/SSH-Agent-Tool-20260702.zip",
                                },
                            },
                            ensure_ascii=False,
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"toolLogs": tool_root, "sessionLogs": session_root},
                {"createdAt": "2026-06-28T12:30:00Z"},
            )

            self.assertTrue(result["ok"])
            self.assertIn("release-update-failures-summary.md", result["files"])
            with zipfile.ZipFile(target) as archive:
                runtime_summary = json.loads(archive.read("runtime-summary.json").decode("utf-8"))
                summary = archive.read("release-update-failures-summary.md").decode("utf-8")

            self.assertEqual(runtime_summary["releaseUpdateFailures"]["counts"]["download_update"], 1)
            self.assertEqual(runtime_summary["releaseUpdateFailures"]["counts"]["start_install"], 1)
            self.assertIn("# 在线更新失败摘要", summary)
            self.assertIn("| download_update | 1 |", summary)
            self.assertIn("| start_install | 1 |", summary)
            self.assertIn("https://updates.example.com/ssh-agent/latest.json", summary)
            self.assertIn("20260701", summary)
            self.assertIn("20260702", summary)
            self.assertIn("SSH-Agent-Tool-20260702.zip", summary)
            self.assertNotIn("C:/Users/Admin/AppData", summary)
            self.assertNotIn("sk-update-secret", summary)
            self.assertNotIn("UpdateSecret!123", summary)

    def test_diagnostic_package_includes_readable_session_events_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            tool_root.mkdir()
            (session_root / "2026-06-28").mkdir(parents=True)
            (session_root / "2026-06-28" / "prod-web-01-sess-1.jsonl").write_text(
                "\n".join(
                    [
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.session-log.v1",
                                "createdAt": "2026-06-28T13:00:00Z",
                                "type": "ssh_connect_failed",
                                "server": "prod-web-01",
                                "sessionId": "sess-1",
                                "actor": "system",
                                "status": "failed",
                                "message": "Permission denied password=SessionSecret!123",
                                "context": {"host": "10.0.1.23", "port": 22, "user": "root", "password": "DoNotExport"},
                            },
                            ensure_ascii=False,
                        ),
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.session-log.v1",
                                "createdAt": "2026-06-28T13:01:00Z",
                                "type": "command",
                                "server": "prod-web-01",
                                "sessionId": "sess-1",
                                "actor": "user",
                                "status": "sent",
                                "command": "curl -H Authorization: Bearer token-secret https://example.com",
                            },
                            ensure_ascii=False,
                        ),
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.session-log.v1",
                                "createdAt": "2026-06-28T13:02:00Z",
                                "type": "sftp_preview_failed",
                                "server": "prod-web-01",
                                "sessionId": "sess-1",
                                "actor": "user",
                                "status": "failed",
                                "message": "preview failed api_key=sk-session-secret",
                                "context": {"remotePath": "/var/log/nginx/error.log"},
                            },
                            ensure_ascii=False,
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"toolLogs": tool_root, "sessionLogs": session_root},
                {"createdAt": "2026-06-28T13:30:00Z"},
            )

            self.assertTrue(result["ok"])
            self.assertIn("session-events-summary.md", result["files"])
            with zipfile.ZipFile(target) as archive:
                runtime_summary = json.loads(archive.read("runtime-summary.json").decode("utf-8"))
                summary = archive.read("session-events-summary.md").decode("utf-8")

            self.assertEqual(runtime_summary["sessionEvents"]["countsByType"]["ssh_connect_failed"], 1)
            self.assertEqual(runtime_summary["sessionEvents"]["countsByType"]["command"], 1)
            self.assertEqual(runtime_summary["sessionEvents"]["countsByType"]["sftp_preview_failed"], 1)
            self.assertEqual(runtime_summary["sessionEvents"]["countsByStatus"]["failed"], 2)
            self.assertIn("# 会话事件摘要", summary)
            self.assertIn("| ssh_connect_failed | 1 |", summary)
            self.assertIn("| failed | 2 |", summary)
            self.assertIn("prod-web-01", summary)
            self.assertIn("sftp_preview_failed", summary)
            self.assertIn("/var/log/nginx/error.log", summary)
            self.assertNotIn("SessionSecret!123", summary)
            self.assertNotIn("DoNotExport", summary)
            self.assertNotIn("token-secret", summary)
            self.assertNotIn("sk-session-secret", summary)

    def test_diagnostic_package_summarizes_terminal_control_events(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            tool_root.mkdir()
            (session_root / "2026-07-03").mkdir(parents=True)
            (tool_root / "2026-07-03.jsonl").write_text(
                "\n".join(
                    [
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-07-03T09:00:00Z",
                                "level": "info",
                                "component": "ssh",
                                "action": "interrupt_command",
                                "message": "已发送 Ctrl+C",
                                "context": {
                                    "sessionId": "sess-1",
                                    "serverName": "prod-web-01",
                                    "host": "10.0.1.23",
                                    "user": "root",
                                    "password": "ServerPassword!123",
                                },
                            },
                            ensure_ascii=False,
                        ),
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-07-03T09:01:00Z",
                                "level": "error",
                                "component": "ssh",
                                "action": "resize_session",
                                "message": "resize failed token=resize-token-secret",
                                "context": {
                                    "sessionId": "sess-1",
                                    "serverName": "prod-web-01",
                                    "width": 120,
                                    "height": 32,
                                    "credentialRef": "cred-prod-web",
                                },
                            },
                            ensure_ascii=False,
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            (session_root / "2026-07-03" / "prod-web-01-sess-1.jsonl").write_text(
                "\n".join(
                    [
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.session-log.v1",
                                "createdAt": "2026-07-03T09:02:00Z",
                                "type": "session_interrupt_sent",
                                "server": "prod-web-01",
                                "sessionId": "sess-1",
                                "actor": "user",
                                "status": "ok",
                                "context": {"signal": "interrupt", "host": "10.0.1.23", "apiKey": "sk-control-secret"},
                            },
                            ensure_ascii=False,
                        ),
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.session-log.v1",
                                "createdAt": "2026-07-03T09:03:00Z",
                                "type": "session_control_signal_failed",
                                "server": "prod-web-01",
                                "sessionId": "sess-1",
                                "actor": "user",
                                "status": "failed",
                                "message": "Ctrl+D failed password=SessionPassword!123",
                                "context": {"signal": "eof", "failureKind": "input"},
                            },
                            ensure_ascii=False,
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"toolLogs": tool_root, "sessionLogs": session_root},
                {"createdAt": "2026-07-03T09:30:00Z"},
            )

            self.assertTrue(result["ok"])
            self.assertIn("terminal-control-summary.md", result["files"])
            with zipfile.ZipFile(target) as archive:
                runtime_summary = json.loads(archive.read("runtime-summary.json").decode("utf-8"))
                summary = archive.read("terminal-control-summary.md").decode("utf-8")

            events = runtime_summary["terminalControlEvents"]
            self.assertEqual(events["total"], 4)
            self.assertEqual(events["counts"]["interrupt_command"], 1)
            self.assertEqual(events["counts"]["resize_session"], 1)
            self.assertEqual(events["counts"]["session_interrupt_sent"], 1)
            self.assertEqual(events["counts"]["session_control_signal_failed"], 1)
            self.assertEqual(events["recent"][0]["type"], "session")
            self.assertEqual(events["recent"][0]["control"], "eof")
            self.assertEqual(events["recent"][1]["control"], "interrupt")
            self.assertIn("prod-web-01", summary)
            self.assertIn("resize_session", summary)
            self.assertIn("session_control_signal_failed", summary)
            combined = json.dumps(events, ensure_ascii=False) + summary
            self.assertNotIn("ServerPassword!123", combined)
            self.assertNotIn("resize-token-secret", combined)
            self.assertNotIn("cred-prod-web", combined)
            self.assertNotIn("sk-control-secret", combined)
            self.assertNotIn("SessionPassword!123", combined)

    def test_diagnostic_package_includes_readable_frontend_incidents_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            tool_root.mkdir()
            session_root.mkdir()
            (tool_root / "2026-06-28.jsonl").write_text(
                "\n".join(
                    [
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-06-28T14:00:00Z",
                                "level": "error",
                                "component": "frontend",
                                "action": "render_crash",
                                "message": "React render failed api_key=sk-frontend-secret",
                                "error": "Cannot read properties of undefined",
                            },
                            ensure_ascii=False,
                        ),
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-06-28T14:05:00Z",
                                "level": "warn",
                                "component": "frontend",
                                "action": "local_storage_read_failed",
                                "message": "local storage read failed token=frontend-token-secret",
                                "error": "QuotaExceededError",
                            },
                            ensure_ascii=False,
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"toolLogs": tool_root, "sessionLogs": session_root},
                {"createdAt": "2026-06-28T14:30:00Z"},
            )

            self.assertTrue(result["ok"])
            self.assertIn("frontend-incidents-summary.md", result["files"])
            with zipfile.ZipFile(target) as archive:
                runtime_summary = json.loads(archive.read("runtime-summary.json").decode("utf-8"))
                summary = archive.read("frontend-incidents-summary.md").decode("utf-8")

            self.assertEqual(runtime_summary["frontendIncidents"]["counts"]["render_crash"], 1)
            self.assertEqual(runtime_summary["frontendIncidents"]["counts"]["local_storage_read_failed"], 1)
            self.assertIn("# 前端异常摘要", summary)
            self.assertIn("| render_crash | 1 |", summary)
            self.assertIn("| local_storage_read_failed | 1 |", summary)
            self.assertIn("Cannot read properties of undefined", summary)
            self.assertIn("QuotaExceededError", summary)
            self.assertNotIn("sk-frontend-secret", summary)
            self.assertNotIn("frontend-token-secret", summary)

    def test_diagnostic_package_includes_readable_runtime_environment_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            tool_root.mkdir()
            session_root.mkdir()
            (tool_root / "2026-06-28.jsonl").write_text(
                json.dumps(
                    {
                        "schema": "ssh-agent-tool.tool-log.v1",
                        "createdAt": "2026-06-28T15:00:00Z",
                        "level": "info",
                        "component": "app",
                        "action": "app_start",
                        "message": "应用启动",
                        "context": {
                            "webView2Runtime": {
                                "available": False,
                                "source": "registry",
                                "message": "未检测到 Microsoft Edge WebView2 Runtime",
                            }
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            release_manifest = root / "manifest.json"
            release_manifest.write_text(
                json.dumps(
                    {
                        "version": "20260701",
                        "updateChannel": "stable",
                        "executable": "当前正式版/SSH-Agent-Tool.exe",
                        "verification": [
                            {"name": "frontend", "status": "passed"},
                            {"name": "backend", "status": "passed"},
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"toolLogs": tool_root, "sessionLogs": session_root, "releaseManifest": release_manifest},
                {"createdAt": "2026-06-28T15:30:00Z"},
            )

            self.assertTrue(result["ok"])
            self.assertIn("runtime-environment-summary.md", result["files"])
            with zipfile.ZipFile(target) as archive:
                summary = archive.read("runtime-environment-summary.md").decode("utf-8")

            self.assertIn("# 运行环境摘要", summary)
            self.assertIn("20260701", summary)
            self.assertIn("stable", summary)
            self.assertIn("当前正式版/SSH-Agent-Tool.exe", summary)
            self.assertIn("WebView2 Runtime", summary)
            self.assertIn("registry", summary)
            self.assertIn("未检测到 Microsoft Edge WebView2 Runtime", summary)
            self.assertIn("frontend", summary)
            self.assertIn("backend", summary)

    def test_runtime_environment_summary_lists_release_fingerprints(self):
        summary = build_runtime_environment_summary_markdown(
            {
                "createdAt": "2026-07-03T10:00:00Z",
                "runtime": {},
                "release": {
                    "version": "20260703",
                    "updateChannel": "stable",
                    "packageFile": "SSH-Agent-Tool-20260703.zip",
                    "packageSha256": "ZIP-SHA-20260703",
                    "executable": "SSH-Agent-Tool.exe",
                    "sha256": "EXE-SHA-LEGACY",
                    "standaloneExeSha256": "EXE-SHA-20260703",
                    "frontendAssets": {
                        "script": "assets/index-current.js",
                        "scriptSha256": "FRONTEND-SHA-20260703",
                    },
                    "verification": {"total": 1, "passed": 1, "failed": 0, "skipped": 0, "unknown": 0},
                },
            }
        )

        self.assertIn("SSH-Agent-Tool-20260703.zip", summary)
        self.assertIn("ZIP-SHA-20260703", summary)
        self.assertIn("EXE-SHA-20260703", summary)
        self.assertIn("assets/index-current.js", summary)
        self.assertIn("FRONTEND-SHA-20260703", summary)

    def test_runtime_environment_summary_includes_startup_identity_and_launchers(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {},
                {
                    "createdAt": "2026-07-03T09:00:00Z",
                    "runtimeDiagnostics": {
                        "startupIdentity": {
                            "ok": False,
                            "version": "20260703",
                            "runtimeScript": "assets/index-Cp9tIJY7.js",
                            "manifestScript": "assets/index-Cp9tIJY7.js",
                            "frontendMatchesManifest": True,
                            "consoleWindow": True,
                            "executableSubsystem": "console",
                            "message": "启动身份需要检查",
                        },
                        "commandLineLaunchers": {
                            "hasBatchFiles": True,
                            "batchFiles": ["启动调试.bat"],
                            "message": "检测到命令行启动器",
                        },
                    },
                },
            )

            self.assertTrue(result["ok"])
            with zipfile.ZipFile(target) as archive:
                runtime_summary = json.loads(archive.read("runtime-summary.json").decode("utf-8"))
                summary = archive.read("runtime-environment-summary.md").decode("utf-8")

            self.assertEqual(runtime_summary["runtimeDiagnostics"]["startupIdentity"]["version"], "20260703")
            self.assertIn("启动身份", summary)
            self.assertIn("20260703", summary)
            self.assertIn("assets/index-Cp9tIJY7.js", summary)
            self.assertIn("frontendMatchesManifest", summary)
            self.assertIn("console", summary)
            self.assertIn("启动身份需要检查", summary)
            self.assertIn("命令行启动器", summary)
            self.assertIn("启动调试.bat", summary)

    def test_diagnostic_package_summarizes_server_management_events(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            tool_root = root / "tool-logs"
            tool_root.mkdir()
            (tool_root / "2026-07-03.jsonl").write_text(
                "\n".join(
                    [
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-07-03T08:00:00Z",
                                "level": "info",
                                "component": "server-management",
                                "action": "create_server",
                                "message": "服务器配置已更新",
                                "context": {
                                    "serverName": "prod-web-01",
                                    "host": "10.0.1.23",
                                    "port": "22",
                                    "user": "root",
                                    "authType": "password",
                                    "group": "生产环境",
                                    "password": "ServerPassword!123",
                                    "credentialRef": "cred-prod-web",
                                },
                            },
                            ensure_ascii=False,
                        ),
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-07-03T08:05:00Z",
                                "level": "info",
                                "component": "server-management",
                                "action": "edit_server",
                                "message": "服务器配置已更新",
                                "context": {
                                    "serverName": "prod-web-01",
                                    "host": "10.0.1.24",
                                    "port": "2222",
                                    "user": "deploy",
                                    "authType": "key",
                                    "group": "生产环境",
                                    "oldName": "prod-web-old",
                                    "renamed": True,
                                    "resetSession": True,
                                    "identityFile": "C:/Users/me/.ssh/prod.pem",
                                },
                            },
                            ensure_ascii=False,
                        ),
                        json.dumps(
                            {
                                "schema": "ssh-agent-tool.tool-log.v1",
                                "createdAt": "2026-07-03T08:10:00Z",
                                "level": "info",
                                "component": "server-management",
                                "action": "delete_server",
                                "message": "服务器配置已更新",
                                "context": {
                                    "serverName": "prod-db-01",
                                    "host": "10.0.1.31",
                                    "port": "22",
                                    "user": "root",
                                    "authType": "password",
                                    "group": "生产环境",
                                },
                            },
                            ensure_ascii=False,
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"toolLogs": tool_root},
                {"createdAt": "2026-07-03T08:30:00Z"},
            )

            self.assertTrue(result["ok"])
            self.assertIn("server-management-summary.md", result["files"])
            with zipfile.ZipFile(target) as archive:
                runtime_summary = json.loads(archive.read("runtime-summary.json").decode("utf-8"))
                management_summary = archive.read("server-management-summary.md").decode("utf-8")

            events = runtime_summary["serverManagementEvents"]
            self.assertEqual(events["total"], 3)
            self.assertEqual(events["counts"]["create_server"], 1)
            self.assertEqual(events["counts"]["edit_server"], 1)
            self.assertEqual(events["counts"]["delete_server"], 1)
            self.assertEqual(events["recent"][0]["action"], "delete_server")
            self.assertEqual(events["recent"][0]["serverName"], "prod-db-01")
            self.assertEqual(events["recent"][1]["oldName"], "prod-web-old")
            self.assertEqual(events["recent"][1]["renamed"], True)
            self.assertEqual(events["recent"][1]["resetSession"], True)
            combined = json.dumps(events, ensure_ascii=False) + management_summary
            self.assertIn("prod-web-01", combined)
            self.assertIn("prod-db-01", combined)
            self.assertIn("edit_server", combined)
            self.assertNotIn("ServerPassword!123", combined)
            self.assertNotIn("cred-prod-web", combined)
            self.assertNotIn("prod.pem", combined)

    def test_diagnostic_package_includes_readable_configuration_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            tool_root = root / "tool-logs"
            session_root = root / "session-logs"
            tool_root.mkdir()
            session_root.mkdir()
            config_path = root / "config.json"
            config_path.write_text(
                json.dumps(
                    {
                        "customServers": {
                            "prod-web-01": {
                                "host": "10.0.1.23",
                                "user": "root",
                                "password": "ServerPassword!123",
                            },
                            "prod-db-01": {
                                "host": "10.0.1.31",
                                "user": "deploy",
                                "credentialRef": "cred-prod-db",
                            },
                        },
                        "modelProfiles": [
                            {
                                "name": "OpenAI 兼容",
                                "config": {
                                    "provider": "OpenAI 兼容",
                                    "baseUrl": "https://api.example.com/v1",
                                    "apiKey": "sk-config-secret",
                                },
                            }
                        ],
                        "customAgentCapabilities": [
                            {"name": "Nginx 深度检查", "type": "skill"},
                            {"name": "Prometheus", "type": "mcp"},
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            target = root / "diagnostic.zip"

            result = write_diagnostic_package(
                target,
                {"toolLogs": tool_root, "sessionLogs": session_root, "config": config_path},
                {"createdAt": "2026-06-28T16:30:00Z"},
            )

            self.assertTrue(result["ok"])
            self.assertIn("configuration-summary.md", result["files"])
            with zipfile.ZipFile(target) as archive:
                summary = archive.read("configuration-summary.md").decode("utf-8")

            self.assertIn("# 配置摘要", summary)
            self.assertIn("prod-web-01", summary)
            self.assertIn("prod-db-01", summary)
            self.assertIn("customServers", summary)
            self.assertIn("modelProfiles", summary)
            self.assertIn("OpenAI 兼容", summary)
            self.assertIn("Nginx 深度检查", summary)
            self.assertIn("Prometheus", summary)
            self.assertNotIn("ServerPassword!123", summary)
            self.assertNotIn("cred-prod-db", summary)
            self.assertNotIn("sk-config-secret", summary)


if __name__ == "__main__":
    unittest.main()
