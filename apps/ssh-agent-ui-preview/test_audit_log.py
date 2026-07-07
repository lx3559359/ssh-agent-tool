import json
import tempfile
import unittest
from pathlib import Path

from audit_log import AuditLogger


class AuditLogTests(unittest.TestCase):
    def test_writes_jsonl_event_to_daily_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            logger = AuditLogger(Path(temp_dir), clock=lambda: "2026-06-26T01:02:03Z")

            result = logger.write_event(
                {
                    "type": "command",
                    "server": "prod-web-01",
                    "sessionId": "session-1",
                    "actor": "user",
                    "command": "whoami",
                }
            )

            target = Path(result["path"])
            self.assertEqual(target.name, "2026-06-26.jsonl")
            events = [json.loads(line) for line in target.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(events[0]["schema"], "ssh-agent-tool.audit.v1")
            self.assertEqual(events[0]["type"], "command")
            self.assertEqual(events[0]["server"], "prod-web-01")
            self.assertEqual(events[0]["createdAt"], "2026-06-26T01:02:03Z")

    def test_output_is_stored_as_bounded_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            logger = AuditLogger(Path(temp_dir), clock=lambda: "2026-06-26T01:02:03Z", max_output_preview=12)

            result = logger.write_event({"type": "output", "output": "line1\nline2\nline3"})

            event = json.loads(Path(result["path"]).read_text(encoding="utf-8").strip())
            self.assertEqual(event["outputLength"], 17)
            self.assertEqual(event["outputPreview"], "line1\nline2...")
            self.assertNotIn("output", event)

    def test_sensitive_command_and_output_preview_are_redacted(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            logger = AuditLogger(Path(temp_dir), clock=lambda: "2026-06-26T01:02:03Z", max_output_preview=200)

            result = logger.write_event(
                {
                    "type": "command",
                    "server": "prod-web-01",
                    "sessionId": "session-1",
                    "actor": "user",
                    "command": "mysql --password=DoNotSave && curl -H 'Authorization: Bearer sk-secret-token' https://api.example.com",
                    "output": "api_key=sk-real-secret\npassword=ServerPassword!123",
                }
            )

            raw = Path(result["path"]).read_text(encoding="utf-8")
            self.assertNotIn("DoNotSave", raw)
            self.assertNotIn("sk-secret-token", raw)
            self.assertNotIn("sk-real-secret", raw)
            self.assertNotIn("ServerPassword!123", raw)
            event = json.loads(raw.strip())
            self.assertIn("[", event["command"])
            self.assertIn("[", event["outputPreview"])


if __name__ == "__main__":
    unittest.main()
