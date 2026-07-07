import json
import hashlib
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import desktop_app
from server_backup import build_backup_payload
from desktop_app import DesktopApi


class FakeCredentialStore:
    secrets = {}
    metadata = {}

    def __init__(self, _root):
        pass

    def read_secret(self, credential_ref):
        if credential_ref == "sshcred-prod-web":
            return "ServerPassword!123"
        return self.secrets.get(credential_ref, "")

    def save_secret(self, connection_name, secret, metadata=None):
        credential_ref = f"restored-{connection_name}"
        self.secrets[credential_ref] = secret
        self.metadata[credential_ref] = metadata if isinstance(metadata, dict) else {}
        return {"credentialRef": credential_ref, "hasSecret": True, "updatedAt": "2026-06-27T00:00:00Z"}


class DesktopBackupFileApiTests(unittest.TestCase):
    def test_app_title_is_readable_chinese(self):
        self.assertEqual(desktop_app.APP_TITLE, "SSH Agent 工具")

    def test_export_backup_file_writes_encrypted_json_without_plaintext_secret(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            FakeCredentialStore.secrets = {}
            FakeCredentialStore.metadata = {}
            target = Path(temp_dir) / "prod-backup.json"
            servers = {
                "prod-web-01": {
                    "ip": "10.0.1.23",
                    "port": "22",
                    "user": "root",
                    "group": "生产环境",
                    "authType": "密码",
                    "credentialRef": "sshcred-prod-web",
                }
            }

            with patch.object(desktop_app, "CredentialStore", FakeCredentialStore):
                with patch.object(desktop_app, "log_tool_event") as log_event:
                    result = DesktopApi().export_backup_file(
                        servers,
                        {"hosts": True, "sftp": False, "skills": False, "mcp": False, "cli": False, "secrets": True},
                        "BackupMaster!123",
                        str(target),
                    )

            log_event.assert_called_once()
            logged_event = log_event.call_args.args[0]
            self.assertEqual(logged_event["component"], "backup")
            self.assertEqual(logged_event["action"], "export_file")
            self.assertEqual(logged_event["context"]["sha256"], result["sha256"])
            self.assertNotIn("ServerPassword!123", json.dumps(logged_event, ensure_ascii=False))
            self.assertNotIn("BackupMaster!123", json.dumps(logged_event, ensure_ascii=False))

            self.assertTrue(result["ok"])
            self.assertEqual(result["path"], str(target))
            self.assertGreater(result["sizeBytes"], 100)
            raw = target.read_text(encoding="utf-8")
            expected_sha256 = hashlib.sha256(target.read_bytes()).hexdigest().upper()
            self.assertEqual(result["sha256"], expected_sha256)
            self.assertRegex(result["sha256"], r"^[A-F0-9]{64}$")
            payload = json.loads(raw)
            self.assertEqual(payload["schema"], "ssh-agent-tool.backup.v1")
            self.assertTrue(payload["encryption"]["enabled"])
            self.assertEqual(payload["manifest"]["hostCount"], 1)
            self.assertEqual(payload["manifest"]["encryptedCredentialCount"], 1)
            self.assertNotIn("ServerPassword!123", raw)
            self.assertNotIn("sshcred-prod-web", raw)

    def test_export_backup_file_returns_structured_failure_and_logs_when_write_fails(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            FakeCredentialStore.secrets = {}
            FakeCredentialStore.metadata = {}
            target_directory = Path(temp_dir) / "not-a-file"
            target_directory.mkdir()
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "CredentialStore", FakeCredentialStore):
                with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                    result = DesktopApi().export_backup_file(
                        {"prod-web-01": {"ip": "10.0.1.23", "port": "22", "user": "root"}},
                        {"hosts": True, "sftp": False, "skills": False, "mcp": False, "cli": False, "secrets": False},
                        "",
                        str(target_directory),
                    )

            log_entries = [
                json.loads(line)
                for path in log_root.rglob("*.jsonl")
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            combined_logs = "\n".join(json.dumps(entry, ensure_ascii=False) for entry in log_entries)
            self.assertFalse(result["ok"])
            self.assertEqual(result["state"], "failed")
            self.assertIn("backup", combined_logs)
            self.assertIn("export_file", combined_logs)
            self.assertTrue(any(entry.get("context", {}).get("path") == str(target_directory) for entry in log_entries))

    def test_restore_backup_credentials_uses_desktop_credential_store(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            FakeCredentialStore.secrets = {}
            FakeCredentialStore.metadata = {}
            source_store = FakeCredentialStore(Path(temp_dir) / "source")
            source_store.secrets["sshcred-prod-web"] = "ServerPassword!123"
            backup = build_backup_payload(
                {
                    "prod-web-01": {
                        "ip": "10.0.1.23",
                        "port": "22",
                        "user": "root",
                        "authType": "密码",
                        "credentialRef": "sshcred-prod-web",
                    }
                },
                {"hosts": True, "sftp": False, "skills": False, "mcp": False, "cli": False, "secrets": True},
                "BackupMaster!123",
                source_store,
                exported_at="2026-06-27T00:00:00Z",
            )

            with patch.object(desktop_app, "CredentialStore", FakeCredentialStore):
                result = DesktopApi().restore_backup_credentials(
                    [{"name": "prod-web-01", "host": backup["hosts"][0]}],
                    "BackupMaster!123",
                )

            self.assertTrue(result["ok"])
            self.assertEqual(result["credentials"][0]["credentialRef"], "restored-prod-web-01")
            self.assertEqual(FakeCredentialStore.secrets["restored-prod-web-01"], "ServerPassword!123")
            self.assertEqual(FakeCredentialStore.metadata["restored-prod-web-01"]["source"], "backup-import")
            self.assertNotIn("ServerPassword!123", json.dumps(result, ensure_ascii=False))

    def test_restore_backup_credentials_wrong_password_returns_structured_failure_and_logs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            FakeCredentialStore.secrets = {}
            FakeCredentialStore.metadata = {}
            source_store = FakeCredentialStore(Path(temp_dir) / "source")
            source_store.secrets["sshcred-prod-web"] = "ServerPassword!123"
            backup = build_backup_payload(
                {
                    "prod-web-01": {
                        "ip": "10.0.1.23",
                        "port": "22",
                        "user": "root",
                        "authType": "密码",
                        "credentialRef": "sshcred-prod-web",
                    }
                },
                {"hosts": True, "sftp": False, "skills": False, "mcp": False, "cli": False, "secrets": True},
                "BackupMaster!123",
                source_store,
                exported_at="2026-06-27T00:00:00Z",
            )
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "CredentialStore", FakeCredentialStore):
                with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                    result = DesktopApi().restore_backup_credentials(
                        [{"name": "prod-web-01", "host": backup["hosts"][0]}],
                        "WrongMaster!123",
                    )

            combined_logs = "\n".join(path.read_text(encoding="utf-8") for path in log_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn("备份", result["message"])
            self.assertIn("backup", combined_logs)
            self.assertIn("restore_credentials", combined_logs)
            self.assertNotIn("ServerPassword!123", json.dumps(result, ensure_ascii=False) + combined_logs)

    def test_open_backup_file_validates_schema_and_returns_import_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "prod-backup.json"
            source.write_text(
                json.dumps(
                    {
                        "schema": "ssh-agent-tool.backup.v1",
                        "exportedAt": "2026-06-26T02:00:00Z",
                        "manifest": {
                            "schemaVersion": 1,
                            "exportedAt": "2026-06-26T02:00:00Z",
                            "hostCount": 2,
                            "agentCapabilityCount": 3,
                            "encryptedCredentialCount": 1,
                            "sensitiveMcpHeaderCount": 1,
                            "includesSecrets": True,
                        },
                        "encryption": {"enabled": True},
                        "hosts": [{"name": "prod-web-01"}, {"name": "prod-db-01"}],
                        "skills": [{"type": "Skill", "name": "Linux 基础检查"}],
                        "mcp": [{"type": "MCP", "name": "Prometheus"}],
                        "cli": [{"type": "CLI", "name": "本地诊断"}],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            result = DesktopApi().open_backup_file(str(source))

            self.assertTrue(result["ok"])
            self.assertEqual(result["path"], str(source))
            self.assertEqual(result["fileName"], "prod-backup.json")
            self.assertEqual(result["summary"]["hostCount"], 2)
            self.assertEqual(result["summary"]["agentCapabilityCount"], 3)
            self.assertEqual(result["summary"]["encryptedCredentialCount"], 1)
            self.assertTrue(result["summary"]["requiresMasterPassword"])
            self.assertIn("2 台服务器", result["summary"]["message"])

    def test_open_backup_file_summary_reports_skipped_credentials(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "partial-backup.json"
            source.write_text(
                json.dumps(
                    {
                        "schema": "ssh-agent-tool.backup.v1",
                        "exportedAt": "2026-06-26T02:00:00Z",
                        "manifest": {
                            "schemaVersion": 1,
                            "exportedAt": "2026-06-26T02:00:00Z",
                            "hostCount": 2,
                            "agentCapabilityCount": 0,
                            "encryptedCredentialCount": 1,
                            "skippedCredentialCount": 1,
                            "includesSecrets": True,
                        },
                        "encryption": {"enabled": True},
                        "hosts": [
                            {"name": "prod-web-01", "secretStatus": "encrypted"},
                            {"name": "prod-db-01", "secretStatus": "unavailable"},
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            result = DesktopApi().open_backup_file(str(source))

            self.assertTrue(result["ok"])
            self.assertEqual(result["summary"]["encryptedCredentialCount"], 1)
            self.assertEqual(result["summary"]["skippedCredentialCount"], 1)
            self.assertIn("1 个凭据未导出", result["summary"]["message"])

    def test_open_backup_file_summary_reports_model_api_profiles(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "model-backup.json"
            source.write_text(
                json.dumps(
                    {
                        "schema": "ssh-agent-tool.backup.v1",
                        "exportedAt": "2026-06-30T00:00:00Z",
                        "manifest": {
                            "schemaVersion": 1,
                            "exportedAt": "2026-06-30T00:00:00Z",
                            "hostCount": 0,
                            "agentCapabilityCount": 0,
                            "modelProfileCount": 2,
                            "includesSecrets": False,
                        },
                        "encryption": {"enabled": False},
                        "modelProfiles": [
                            {"id": "openai", "name": "OpenAI 兼容", "config": {"provider": "OpenAI 兼容", "apiKey": ""}},
                            {"id": "relay", "name": "中转站", "config": {"provider": "中转站 API", "apiKey": ""}},
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            result = DesktopApi().open_backup_file(str(source))

            self.assertTrue(result["ok"])
            self.assertEqual(result["summary"]["modelProfileCount"], 2)
            self.assertIn("2 个模型 API 档案", result["summary"]["message"])

    def test_open_backup_file_rejects_unknown_schema_without_crashing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "broken.json"
            source.write_text('{"schema":"unknown"}', encoding="utf-8")

            result = DesktopApi().open_backup_file(str(source))

            self.assertFalse(result["ok"])
            self.assertEqual(result["errorCode"], "unsupported_schema")
            self.assertIn("不支持", result["message"])

    def test_open_backup_file_logs_invalid_backup_import_attempts(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "broken.json"
            source.write_text('{"schema":"unknown"}', encoding="utf-8")
            log_root = Path(temp_dir) / "tool-logs"

            with patch.object(desktop_app, "tool_log_path", lambda: log_root):
                result = DesktopApi().open_backup_file(str(source))

            log_entries = [
                json.loads(line)
                for path in log_root.rglob("*.jsonl")
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            combined_logs = "\n".join(json.dumps(entry, ensure_ascii=False) for entry in log_entries)
            self.assertFalse(result["ok"])
            self.assertIn("backup", combined_logs)
            self.assertIn("open_file", combined_logs)
            self.assertIn("unsupported_schema", combined_logs)
            self.assertTrue(any(entry.get("context", {}).get("path") == str(source) for entry in log_entries))

    def test_pick_backup_file_returns_selected_path(self):
        class FakeWindow:
            def create_file_dialog(self, dialog_type, allow_multiple=False):
                self.dialog_type = dialog_type
                self.allow_multiple = allow_multiple
                return [r"C:\backups\prod-backup.json"]

        fake_window = FakeWindow()
        fake_webview = SimpleNamespace(OPEN_DIALOG="open", windows=[fake_window])

        with patch.dict("sys.modules", {"webview": fake_webview}):
            result = DesktopApi().pick_backup_file()

        self.assertEqual(result, r"C:\backups\prod-backup.json")
        self.assertEqual(fake_window.dialog_type, "open")
        self.assertFalse(fake_window.allow_multiple)


if __name__ == "__main__":
    unittest.main()
