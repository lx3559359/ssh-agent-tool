import json
import tempfile
import unittest
from pathlib import Path

from tool_log import ToolLogger, build_tool_log_markdown, delete_old_tool_logs, list_tool_log_entries


class ToolLogTests(unittest.TestCase):
    def test_write_event_creates_jsonl_tool_log_without_secrets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            logger = ToolLogger(Path(temp_dir), clock=lambda: "2026-06-27T01:02:03Z")

            result = logger.write_event(
                {
                    "level": "error",
                    "component": "model-api",
                    "action": "test_connection",
                    "message": "Authorization: Bearer sk-real-secret failed",
                    "error": "api_key=sk-another-secret",
                    "context": {"server": "prod-web-01", "apiKey": "sk-context-secret"},
                }
            )

            saved = json.loads(Path(result["path"]).read_text(encoding="utf-8").strip())
            self.assertTrue(result["ok"])
            self.assertEqual(saved["schema"], "ssh-agent-tool.tool-log.v1")
            self.assertEqual(saved["level"], "error")
            self.assertEqual(saved["component"], "model-api")
            self.assertNotIn("sk-real-secret", json.dumps(saved, ensure_ascii=False))
            self.assertNotIn("sk-another-secret", json.dumps(saved, ensure_ascii=False))
            self.assertNotIn("sk-context-secret", json.dumps(saved, ensure_ascii=False))
            self.assertIn("[已脱敏]", json.dumps(saved, ensure_ascii=False))

    def test_list_tool_log_entries_filters_component_and_query(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            logger = ToolLogger(Path(temp_dir), clock=lambda: "2026-06-27T01:00:00Z")
            logger.write_event({"level": "warn", "component": "ssh", "action": "open_session", "message": "connect failed"})
            logger.write_event({"level": "error", "component": "model-api", "action": "chat", "message": "bad api key"})

            result = list_tool_log_entries(Path(temp_dir), {"component": "ssh", "query": "connect"})

            self.assertTrue(result["ok"])
            self.assertEqual(result["total"], 1)
            self.assertEqual(result["entries"][0]["component"], "ssh")
            self.assertEqual(result["entries"][0]["action"], "open_session")

    def test_warning_level_is_normalized_to_warn(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            logger = ToolLogger(Path(temp_dir), clock=lambda: "2026-06-27T01:00:00Z")

            logger.write_event({"level": "warning", "component": "frontend", "action": "local_storage_read_failed"})
            result = list_tool_log_entries(Path(temp_dir), {"level": "warn"})

            self.assertEqual(result["total"], 1)
            self.assertEqual(result["entries"][0]["level"], "warn")
            self.assertEqual(result["entries"][0]["action"], "local_storage_read_failed")

    def test_build_tool_log_markdown_exports_readable_summary(self):
        content = build_tool_log_markdown(
            [
                {
                    "createdAt": "2026-06-27T01:00:00Z",
                    "level": "warn",
                    "component": "ssh",
                    "action": "open_session",
                    "message": "password=ServerPassword!123",
                    "error": "连接失败",
                    "context": {"host": "10.0.1.23", "apiKey": "sk-context-secret"},
                }
            ],
            {"exportedAt": "2026-06-27T02:00:00Z"},
        )

        self.assertIn("# 工具运行日志", content)
        self.assertIn("导出时间：2026-06-27T02:00:00Z", content)
        self.assertIn("事件数量：1", content)
        self.assertIn("消息：", content)
        self.assertIn("错误：", content)
        self.assertIn("上下文：", content)
        self.assertIn("open_session", content)
        self.assertIn('"apiKey": "[已脱敏]"', content)
        self.assertNotIn("ServerPassword!123", content)
        self.assertNotIn("sk-context-secret", content)

    def test_build_tool_log_markdown_includes_export_scope(self):
        content = build_tool_log_markdown(
            [],
            {
                "exportedAt": "2026-06-27T02:00:00Z",
                "total": 8,
                "filters": {
                    "component": "ssh",
                    "level": "error",
                    "query": "timeout",
                },
            },
        )

        self.assertIn("匹配总数：8", content)
        self.assertIn("导出条数：0", content)
        self.assertIn("筛选条件：", content)
        self.assertIn("- 模块：ssh", content)
        self.assertIn("- 级别：error", content)
        self.assertIn("- 关键词：timeout", content)

    def test_delete_old_tool_logs_removes_only_logs_before_cutoff(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            old_log = root / "2026-05-01.jsonl"
            recent_log = root / "2026-06-20.jsonl"
            other_file = root / "notes.txt"
            old_log.write_text("old", encoding="utf-8")
            recent_log.write_text("recent", encoding="utf-8")
            other_file.write_text("keep", encoding="utf-8")

            result = delete_old_tool_logs(root, keep_days=30, now="2026-06-27T00:00:00Z")

            self.assertTrue(result["ok"])
            self.assertEqual(result["deleted"], 1)
            self.assertFalse(old_log.exists())
            self.assertTrue(recent_log.exists())
            self.assertTrue(other_file.exists())


if __name__ == "__main__":
    unittest.main()
