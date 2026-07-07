import json
import tempfile
import unittest
from pathlib import Path

from credential_store import CredentialStore
from server_backup import build_backup_payload, restore_backup_credentials, restore_backup_agent_capabilities


def protect_for_test(value: bytes) -> bytes:
    return b"protected:" + value


def unprotect_for_test(value: bytes) -> bytes:
    if not value.startswith(b"protected:"):
        raise ValueError("Unexpected protected value.")
    return value.removeprefix(b"protected:")


class SecureBackupTests(unittest.TestCase):
    def test_backup_encryption_notes_are_readable_chinese(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = CredentialStore(Path(temp_dir), protect=protect_for_test, unprotect=unprotect_for_test)
            encrypted = build_backup_payload(
                {},
                {"hosts": False, "sftp": False, "skills": False, "mcp": False, "cli": False, "secrets": True},
                "BackupMaster!123",
                store,
                exported_at="2026-06-26T01:02:03Z",
            )
            redacted = build_backup_payload(
                {},
                {"hosts": False, "sftp": False, "skills": False, "mcp": False, "cli": False, "secrets": False},
                "",
                store,
                exported_at="2026-06-26T01:02:03Z",
            )

            self.assertIn("备份主密码", encrypted["encryption"]["note"])
            self.assertIn("未导出密码", redacted["encryption"]["note"])
            self.assertNotIn("�", encrypted["encryption"]["note"])
            self.assertNotIn("�", redacted["encryption"]["note"])

    def test_exports_and_restores_encrypted_server_secret(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source_store = CredentialStore(
                Path(temp_dir) / "source",
                protect=protect_for_test,
                unprotect=unprotect_for_test,
            )
            credential = source_store.save_secret(
                "prod-web-01",
                "ServerPassword!123",
                {"authType": "密码", "user": "root", "host": "10.0.1.23"},
            )
            servers = {
                "prod-web-01": {
                    "ip": "10.0.1.23",
                    "port": "22",
                    "group": "生产环境",
                    "user": "root",
                    "cwd": "/var/www/app",
                    "policy": "生产只读策略",
                    "authType": "密码",
                    "credentialRef": credential["credentialRef"],
                    "files": [{"type": "folder", "name": "/var/www/app"}],
                }
            }

            backup = build_backup_payload(
                servers,
                {"hosts": True, "sftp": True, "skills": False, "mcp": False, "secrets": True},
                "BackupMaster!123",
                source_store,
                exported_at="2026-06-26T01:02:03Z",
            )

            raw_backup = json.dumps(backup, ensure_ascii=False)
            self.assertTrue(backup["encryption"]["enabled"])
            self.assertEqual(backup["hosts"][0]["secret"]["schema"], "ssh-agent-tool.secret.v1")
            self.assertNotIn("ServerPassword!123", raw_backup)
            self.assertNotIn(credential["credentialRef"], raw_backup)

            target_store = CredentialStore(
                Path(temp_dir) / "target",
                protect=protect_for_test,
                unprotect=unprotect_for_test,
            )
            restored = restore_backup_credentials(
                [{"name": "prod-web-01-导入", "host": backup["hosts"][0]}],
                "BackupMaster!123",
                target_store,
            )

            self.assertTrue(restored["ok"])
            self.assertEqual(restored["credentials"][0]["name"], "prod-web-01-导入")
            self.assertEqual(target_store.read_secret(restored["credentials"][0]["credentialRef"]), "ServerPassword!123")

    def test_rejects_short_master_password_when_exporting_secrets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = CredentialStore(Path(temp_dir), protect=protect_for_test, unprotect=unprotect_for_test)
            with self.assertRaises(ValueError):
                build_backup_payload(
                    {},
                    {"hosts": True, "secrets": True},
                    "short",
                    store,
                    exported_at="2026-06-26T01:02:03Z",
                )

    def test_exports_server_connection_metadata_without_plaintext_secret(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = CredentialStore(Path(temp_dir), protect=protect_for_test, unprotect=unprotect_for_test)
            credential = store.save_secret("prod-web-01", "ServerPassword!123", {"authType": "密码"})
            backup = build_backup_payload(
                {
                    "prod-web-01": {
                        "ip": "10.0.1.23",
                        "port": "2222",
                        "group": "生产环境",
                        "user": "deploy",
                        "cwd": "/srv/app",
                        "policy": "生产只读策略",
                        "authType": "密码",
                        "credentialRef": credential["credentialRef"],
                        "timeoutSeconds": 25,
                        "retryCount": 2,
                        "keepaliveSeconds": 45,
                        "keepaliveCountMax": 6,
                        "tags": ["nginx", "重要"],
                        "identityFile": "~/.ssh/prod_web_ed25519",
                        "forwardAgent": True,
                        "proxyJump": "bastion",
                        "localForwards": [
                            {"localHost": "127.0.0.1", "localPort": "18080", "remoteHost": "127.0.0.1", "remotePort": "80"},
                            {"localPort": "", "remoteHost": "127.0.0.1", "remotePort": "443"},
                        ],
                        "remoteForwards": [
                            {"remoteHost": "127.0.0.1", "remotePort": "22022", "localHost": "127.0.0.1", "localPort": "22"}
                        ],
                        "dynamicForwards": [{"bindHost": "127.0.0.1", "bindPort": "1080"}],
                        "hostKey": {"type": "ssh-ed25519", "sha256": "SHA256:current"},
                        "trustedHostKey": {
                            "type": "ssh-ed25519",
                            "sha256": "SHA256:trusted",
                            "trustedAt": "2026-06-26T03:20:00Z",
                        },
                        "hostKeyTrust": {"status": "trusted", "label": "已信任"},
                    }
                },
                {"hosts": True, "sftp": False, "skills": False, "mcp": False, "cli": False, "secrets": True},
                "BackupMaster!123",
                store,
                exported_at="2026-06-26T01:02:03Z",
            )

            host = backup["hosts"][0]
            raw_backup = json.dumps(backup, ensure_ascii=False)
            self.assertEqual(host["timeoutSeconds"], 25)
            self.assertEqual(host["retryCount"], 2)
            self.assertEqual(host["keepaliveSeconds"], 45)
            self.assertEqual(host["keepaliveCountMax"], 6)
            self.assertEqual(host["tags"], ["nginx", "重要"])
            self.assertEqual(host["identityFile"], "~/.ssh/prod_web_ed25519")
            self.assertEqual(host["forwardAgent"], True)
            self.assertEqual(host["proxyJump"], "bastion")
            self.assertEqual(host["localForwards"], [{"localHost": "127.0.0.1", "localPort": "18080", "remoteHost": "127.0.0.1", "remotePort": "80"}])
            self.assertEqual(host["remoteForwards"], [{"remoteHost": "127.0.0.1", "remotePort": "22022", "localHost": "127.0.0.1", "localPort": "22"}])
            self.assertEqual(host["dynamicForwards"], [{"bindHost": "127.0.0.1", "bindPort": "1080"}])
            self.assertEqual(host["hostKey"]["sha256"], "SHA256:current")
            self.assertEqual(host["trustedHostKey"]["trustedAt"], "2026-06-26T03:20:00Z")
            self.assertEqual(host["hostKeyTrust"]["status"], "trusted")
            self.assertNotIn("ServerPassword!123", raw_backup)
            self.assertNotIn(credential["credentialRef"], raw_backup)

    def test_backup_skips_unreadable_server_secret_without_failing_export(self):
        class PartialCredentialStore:
            def read_secret(self, credential_ref):
                if credential_ref == "sshcred-ok":
                    return "ServerPassword!123"
                raise FileNotFoundError("missing credential")

        backup = build_backup_payload(
            {
                "prod-web-01": {
                    "ip": "10.0.1.23",
                    "port": "22",
                    "user": "root",
                    "authType": "密码",
                    "credentialRef": "sshcred-ok",
                },
                "prod-db-01": {
                    "ip": "10.0.1.31",
                    "port": "22",
                    "user": "root",
                    "authType": "密码",
                    "credentialRef": "sshcred-missing",
                },
            },
            {"hosts": True, "sftp": False, "skills": False, "mcp": False, "cli": False, "secrets": True},
            "BackupMaster!123",
            PartialCredentialStore(),
            exported_at="2026-06-26T01:02:03Z",
        )

        raw_backup = json.dumps(backup, ensure_ascii=False)
        hosts = {host["name"]: host for host in backup["hosts"]}
        self.assertEqual(backup["manifest"]["hostCount"], 2)
        self.assertEqual(backup["manifest"]["encryptedCredentialCount"], 1)
        self.assertEqual(backup["manifest"]["skippedCredentialCount"], 1)
        self.assertTrue(hosts["prod-web-01"]["hasSecret"])
        self.assertFalse(hosts["prod-db-01"]["hasSecret"])
        self.assertEqual(hosts["prod-db-01"]["secretStatus"], "unavailable")
        self.assertNotIn("ServerPassword!123", raw_backup)
        self.assertNotIn("sshcred-ok", raw_backup)
        self.assertNotIn("sshcred-missing", raw_backup)

    def test_backup_payload_includes_auditable_manifest(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = CredentialStore(Path(temp_dir), protect=protect_for_test, unprotect=unprotect_for_test)
            credential = store.save_secret("prod-web-01", "ServerPassword!123", {"authType": "password"})
            backup = build_backup_payload(
                {
                    "prod-web-01": {
                        "ip": "10.0.1.23",
                        "port": "22",
                        "group": "prod",
                        "user": "root",
                        "cwd": "/var/www/app",
                        "authType": "password",
                        "credentialRef": credential["credentialRef"],
                        "files": [{"type": "folder", "name": "/var/www/app"}],
                    }
                },
                {"hosts": True, "sftp": True, "skills": True, "mcp": True, "cli": True, "secrets": True},
                "BackupMaster!123",
                store,
                agent_capabilities=[
                    {"type": "Skill", "name": "Nginx health", "entry": "skills/nginx.md"},
                    {
                        "type": "MCP",
                        "name": "Internal MCP",
                        "endpoint": "https://mcp.example.com/rpc",
                        "headers": [
                            {"name": "Authorization", "value": "Bearer token", "enabled": True},
                            {"name": "X-Team", "value": "ops", "enabled": True},
                        ],
                    },
                    {"type": "CLI", "name": "Local df", "entry": "local:df -h"},
                ],
                exported_at="2026-06-26T01:02:03Z",
            )

            self.assertEqual(backup["manifest"]["schemaVersion"], 1)
            self.assertEqual(backup["manifest"]["exportedAt"], "2026-06-26T01:02:03Z")
            self.assertEqual(backup["manifest"]["hostCount"], 1)
            self.assertEqual(backup["manifest"]["sftpBookmarkCount"], 1)
            self.assertEqual(backup["manifest"]["agentCapabilityCount"], 3)
            self.assertEqual(backup["manifest"]["capabilityCounts"], {"skill": 1, "mcp": 1, "cli": 1})
            self.assertEqual(backup["manifest"]["encryptedCredentialCount"], 1)
            self.assertEqual(backup["manifest"]["sensitiveMcpHeaderCount"], 1)
            self.assertTrue(backup["manifest"]["includesSecrets"])

    def test_exports_port_forwards_and_safe_command_snippets_without_sensitive_commands(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = CredentialStore(Path(temp_dir), protect=protect_for_test, unprotect=unprotect_for_test)
            backup = build_backup_payload(
                {},
                {
                    "hosts": False,
                    "sftp": False,
                    "skills": False,
                    "mcp": False,
                    "cli": False,
                    "portForwards": True,
                    "commandSnippets": True,
                    "secrets": True,
                },
                "BackupMaster!123",
                store,
                port_forward_presets=[
                    {
                        "id": "pfpreset-prod-web",
                        "serverName": "prod-web-01",
                        "name": "Nginx 管理页",
                        "localHost": "127.0.0.1",
                        "localPort": 18080,
                        "remoteHost": "127.0.0.1",
                        "remotePort": 80,
                        "password": "DoNotExport",
                    },
                    {
                        "id": "unsafe",
                        "serverName": "prod-web-01",
                        "localHost": "0.0.0.0",
                        "localPort": 18081,
                        "remoteHost": "127.0.0.1",
                        "remotePort": 80,
                    },
                ],
                command_snippets=[
                    {"label": "磁盘检查", "command": "df -hT"},
                    {"label": "Token 调试", "command": 'curl -H "Authorization: Bearer abc" https://example.com'},
                    {"label": "数据库密码", "command": "mysql --password=DoNotExport"},
                ],
                exported_at="2026-06-26T01:02:03Z",
            )

            raw_backup = json.dumps(backup, ensure_ascii=False)
            self.assertEqual(backup["manifest"]["portForwardPresetCount"], 1)
            self.assertEqual(backup["manifest"]["commandSnippetCount"], 1)
            self.assertEqual(backup["portForwards"][0]["id"], "pfpreset-prod-web")
            self.assertEqual(backup["commandSnippets"], [{"label": "磁盘检查", "command": "df -hT", "custom": True}])
            self.assertNotIn("DoNotExport", raw_backup)
            self.assertNotIn("Bearer abc", raw_backup)

    def test_exports_agent_capabilities_by_type(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = CredentialStore(Path(temp_dir), protect=protect_for_test, unprotect=unprotect_for_test)
            backup = build_backup_payload(
                {},
                {"hosts": False, "sftp": False, "skills": True, "mcp": True, "cli": True, "secrets": False},
                "",
                store,
                agent_capabilities=[
                    {"type": "Skill", "name": "Nginx 深度排查", "entry": "skills/nginx.md"},
                    {"type": "MCP", "name": "Grafana", "endpoint": "http://127.0.0.1:3000/mcp"},
                    {"type": "CLI", "name": "慢查询分析", "entry": "mysql-slowlog --summary"},
                ],
                exported_at="2026-06-26T01:02:03Z",
            )

            self.assertEqual(backup["skills"][0]["name"], "Nginx 深度排查")
            self.assertEqual(backup["mcp"][0]["name"], "Grafana")
            self.assertEqual(backup["cli"][0]["name"], "慢查询分析")


    def test_encrypts_sensitive_mcp_headers_when_exporting_secrets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = CredentialStore(Path(temp_dir), protect=protect_for_test, unprotect=unprotect_for_test)
            backup = build_backup_payload(
                {},
                {"hosts": False, "sftp": False, "skills": False, "mcp": True, "cli": False, "secrets": True},
                "BackupMaster!123",
                store,
                agent_capabilities=[
                    {
                        "type": "MCP",
                        "name": "Internal MCP",
                        "endpoint": "https://mcp.example.com/rpc",
                        "headers": [
                            {"name": "Authorization", "value": "Bearer token", "enabled": True},
                            {"name": "X-Team", "value": "ops", "enabled": True},
                        ],
                    }
                ],
                exported_at="2026-06-26T01:02:03Z",
            )

            raw_backup = json.dumps(backup, ensure_ascii=False)
            headers = backup["mcp"][0]["headers"]
            self.assertTrue(backup["encryption"]["enabled"])
            self.assertEqual(headers[0]["name"], "Authorization")
            self.assertEqual(headers[0]["value"], "")
            self.assertTrue(headers[0]["sensitive"])
            self.assertEqual(headers[0]["secret"]["schema"], "ssh-agent-tool.secret.v1")
            self.assertEqual(headers[1]["value"], "ops")
            self.assertNotIn("Bearer token", raw_backup)

    def test_restores_encrypted_mcp_header_values(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = CredentialStore(Path(temp_dir), protect=protect_for_test, unprotect=unprotect_for_test)
            backup = build_backup_payload(
                {},
                {"hosts": False, "sftp": False, "skills": False, "mcp": True, "cli": False, "secrets": True},
                "BackupMaster!123",
                store,
                agent_capabilities=[
                    {
                        "type": "MCP",
                        "name": "Internal MCP",
                        "endpoint": "https://mcp.example.com/rpc",
                        "headers": [{"name": "Authorization", "value": "Bearer token", "enabled": True}],
                    }
                ],
                exported_at="2026-06-26T01:02:03Z",
            )

            restored = restore_backup_agent_capabilities(backup, "BackupMaster!123")

            self.assertTrue(restored["ok"])
            self.assertEqual(restored["restoredHeaderCount"], 1)
            self.assertEqual(restored["backup"]["mcp"][0]["headers"][0]["value"], "Bearer token")
            self.assertTrue(restored["backup"]["mcp"][0]["headers"][0]["sensitive"])
            self.assertNotIn("secret", restored["backup"]["mcp"][0]["headers"][0])


if __name__ == "__main__":
    unittest.main()
