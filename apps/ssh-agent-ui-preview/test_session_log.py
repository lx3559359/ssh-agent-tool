import json
import tempfile
import unittest
from pathlib import Path

from session_log import SessionLogger, build_session_log_markdown, delete_old_session_logs, list_session_log_entries, redact_sensitive_text


class SessionLogTests(unittest.TestCase):
    def test_write_event_creates_jsonl_session_log(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            logger = SessionLogger(Path(temp_dir), clock=lambda: "2026-06-26T01:00:00Z")

            result = logger.write_event(
                {
                    "type": "command",
                    "server": "prod/web:01",
                    "sessionId": "sess-123",
                    "actor": "user",
                    "command": "uptime",
                    "status": "sent",
                }
            )

            path = Path(result["path"])
            self.assertTrue(path.exists())
            self.assertIn("prod-web-01", path.name)
            saved = json.loads(path.read_text(encoding="utf-8").strip())
            self.assertEqual(saved["schema"], "ssh-agent-tool.session-log.v1")
            self.assertEqual(saved["command"], "uptime")
            self.assertEqual(saved["server"], "prod/web:01")

    def test_write_event_redacts_common_secrets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            logger = SessionLogger(Path(temp_dir), clock=lambda: "2026-06-26T01:00:00Z")

            result = logger.write_event(
                {
                    "type": "output",
                    "server": "prod-web-01",
                    "sessionId": "sess-123",
                    "actor": "server",
                    "command": "curl -H 'Authorization: Bearer sk-secret-token' https://api.example.com",
                    "output": "password=ServerPassword!123\napi_key=sk-real-secret",
                }
            )

            raw = Path(result["path"]).read_text(encoding="utf-8")
            self.assertNotIn("ServerPassword!123", raw)
            self.assertNotIn("sk-real-secret", raw)
            self.assertNotIn("sk-secret-token", raw)
            self.assertIn("[已脱敏]", raw)

    def test_redact_sensitive_text_handles_private_key_blocks(self):
        value = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----"

        redacted = redact_sensitive_text(value)

        self.assertEqual(redacted, "[已脱敏私钥]")

    def test_list_session_log_entries_filters_server_and_keyword(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            logger = SessionLogger(root, clock=lambda: "2026-06-26T01:00:00Z")
            logger.write_event(
                {
                    "type": "command",
                    "server": "prod-web-01",
                    "sessionId": "sess-1",
                    "actor": "user",
                    "command": "tail -n 100 /var/log/nginx/error.log",
                    "status": "sent",
                }
            )
            logger.write_event(
                {
                    "type": "output",
                    "server": "prod-db-01",
                    "sessionId": "sess-2",
                    "actor": "server",
                    "output": "mysql is healthy",
                    "status": "ok",
                }
            )

            result = list_session_log_entries(root, {"server": "prod-web-01", "query": "nginx"})

            self.assertTrue(result["ok"])
            self.assertEqual(result["total"], 1)
            self.assertEqual(result["entries"][0]["server"], "prod-web-01")
            self.assertEqual(result["entries"][0]["command"], "tail -n 100 /var/log/nginx/error.log")

    def test_list_session_log_entries_filters_type_and_status(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            logger = SessionLogger(root, clock=lambda: "2026-06-26T01:00:00Z")
            logger.write_event(
                {
                    "type": "command",
                    "server": "prod-web-01",
                    "sessionId": "sess-1",
                    "actor": "user",
                    "command": "systemctl restart nginx",
                    "status": "blocked",
                }
            )
            logger.write_event(
                {
                    "type": "output",
                    "server": "prod-web-01",
                    "sessionId": "sess-1",
                    "actor": "server",
                    "output": "nginx is running",
                    "status": "ok",
                }
            )

            result = list_session_log_entries(root, {"type": "command", "status": "blocked"})

            self.assertTrue(result["ok"])
            self.assertEqual(result["total"], 1)
            self.assertEqual(result["entries"][0]["type"], "command")
            self.assertEqual(result["entries"][0]["status"], "blocked")

    def test_list_session_log_entries_can_search_failure_kind(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            logger = SessionLogger(root, clock=lambda: "2026-06-26T01:00:00Z")
            logger.write_event(
                {
                    "type": "output_failed",
                    "server": "prod-web-01",
                    "sessionId": "sess-1",
                    "actor": "system",
                    "status": "failed",
                    "message": "SSH session failed",
                    "failureKind": "transport",
                }
            )

            result = list_session_log_entries(root, {"query": "transport"})

            self.assertTrue(result["ok"])
            self.assertEqual(result["total"], 1)
            self.assertEqual(result["entries"][0]["failureKind"], "transport")

    def test_list_session_log_entries_filters_failure_kind(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            logger = SessionLogger(root, clock=lambda: "2026-06-26T01:00:00Z")
            logger.write_event(
                {
                    "type": "output_failed",
                    "server": "prod-web-01",
                    "sessionId": "sess-1",
                    "actor": "system",
                    "status": "failed",
                    "failureKind": "transport",
                }
            )
            logger.write_event(
                {
                    "type": "session_open_failed",
                    "server": "prod-web-02",
                    "sessionId": "sess-2",
                    "actor": "system",
                    "status": "failed",
                    "failureKind": "auth",
                }
            )

            result = list_session_log_entries(root, {"failureKind": "transport"})

            self.assertTrue(result["ok"])
            self.assertEqual(result["total"], 1)
            self.assertEqual(result["entries"][0]["server"], "prod-web-01")
            self.assertEqual(result["entries"][0]["failureKind"], "transport")

    def test_write_event_promotes_context_failure_kind_for_filtering(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            logger = SessionLogger(root, clock=lambda: "2026-06-26T01:00:00Z")

            logger.write_event(
                {
                    "type": "session_open_failed",
                    "server": "prod-web-01",
                    "sessionId": "sess-1",
                    "actor": "system",
                    "status": "failed",
                    "message": "SSH session failed",
                    "context": {"failureKind": "transport", "host": "10.0.1.23"},
                }
            )

            result = list_session_log_entries(root, {"failureKind": "transport"})

            self.assertTrue(result["ok"])
            self.assertEqual(result["total"], 1)
            self.assertEqual(result["entries"][0]["failureKind"], "transport")
            self.assertEqual(result["entries"][0]["context"]["host"], "10.0.1.23")

    def test_list_session_log_entries_promotes_legacy_context_failure_kind(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            log_dir = root / "2026-06-26"
            log_dir.mkdir()
            log_path = log_dir / "prod-web-01-sess-1.jsonl"
            log_path.write_text(
                json.dumps(
                    {
                        "schema": "ssh-agent-tool.session-log.v1",
                        "createdAt": "2026-06-26T01:00:00Z",
                        "type": "session_open_failed",
                        "server": "prod-web-01",
                        "sessionId": "sess-1",
                        "actor": "system",
                        "status": "failed",
                        "context": {"failureKind": "auth", "host": "10.0.1.23"},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            result = list_session_log_entries(root, {"failureKind": "auth"})

            self.assertTrue(result["ok"])
            self.assertEqual(result["total"], 1)
            self.assertEqual(result["entries"][0]["failureKind"], "auth")

    def test_build_session_log_markdown_exports_readable_summary(self):
        entries = [
            {
                "createdAt": "2026-06-26T01:00:00Z",
                "type": "command",
                "server": "prod-web-01",
                "sessionId": "sess-1",
                "actor": "user",
                "command": "uptime",
                "status": "sent",
            },
            {
                "createdAt": "2026-06-26T01:00:02Z",
                "type": "output",
                "server": "prod-web-01",
                "sessionId": "sess-1",
                "actor": "server",
                "output": "load average: 0.42",
                "status": "ok",
                "context": {
                    "host": "10.0.1.23",
                    "port": 2222,
                    "user": "root",
                    "authType": "password",
                    "password": "DoNotExport",
                },
            },
        ]

        markdown = build_session_log_markdown(entries, {"exportedAt": "2026-06-26T02:00:00Z"})

        self.assertIn("# SSH 会话日志", markdown)
        self.assertIn("导出时间：2026-06-26T02:00:00Z", markdown)
        self.assertIn("事件数量：2", markdown)
        self.assertIn("- 会话：sess-1", markdown)
        self.assertIn("- 来源：user", markdown)
        self.assertIn("prod-web-01", markdown)
        self.assertIn("```bash\nuptime\n```", markdown)
        self.assertIn("```text\nload average: 0.42\n```", markdown)
        self.assertIn('"host": "10.0.1.23"', markdown)
        self.assertIn('"port": 2222', markdown)
        self.assertIn('"password": "[已脱敏]"', markdown)
        self.assertNotIn("DoNotExport", markdown)

    def test_build_session_log_markdown_exposes_failure_kind(self):
        markdown = build_session_log_markdown(
            [
                {
                    "createdAt": "2026-06-26T01:00:02Z",
                    "type": "output_failed",
                    "server": "prod-web-01",
                    "sessionId": "sess-1",
                    "actor": "system",
                    "message": "SSH session failed",
                    "status": "failed",
                    "failureKind": "transport",
                },
            ],
            {"exportedAt": "2026-06-26T02:00:00Z"},
        )

        self.assertIn("- failureKind: transport", markdown)

    def test_build_session_log_markdown_includes_export_scope(self):
        markdown = build_session_log_markdown(
            [],
            {
                "exportedAt": "2026-06-26T02:00:00Z",
                "total": 12,
                "filters": {
                    "server": "prod-web-01",
                    "type": "command",
                    "status": "failed",
                    "query": "nginx",
                },
            },
        )

        self.assertIn("匹配总数：12", markdown)
        self.assertIn("导出条数：0", markdown)
        self.assertIn("筛选条件：", markdown)
        self.assertIn("- 服务器：prod-web-01", markdown)
        self.assertIn("- 类型：command", markdown)
        self.assertIn("- 状态：failed", markdown)
        self.assertIn("- 关键词：nginx", markdown)

    def test_delete_old_session_logs_removes_old_day_logs_only(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            old_dir = root / "2026-05-01"
            recent_dir = root / "2026-06-20"
            old_dir.mkdir()
            recent_dir.mkdir()
            old_log = old_dir / "prod-web-01-sess-1.jsonl"
            recent_log = recent_dir / "prod-web-01-sess-2.jsonl"
            keep_file = old_dir / "notes.txt"
            old_log.write_text("old", encoding="utf-8")
            recent_log.write_text("recent", encoding="utf-8")
            keep_file.write_text("keep", encoding="utf-8")

            result = delete_old_session_logs(root, keep_days=30, now="2026-06-27T00:00:00Z")

            self.assertTrue(result["ok"])
            self.assertEqual(result["deleted"], 1)
            self.assertFalse(old_log.exists())
            self.assertTrue(recent_log.exists())
            self.assertTrue(keep_file.exists())


if __name__ == "__main__":
    unittest.main()
