import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import desktop_app
from desktop_app import DesktopApi


class DesktopSessionLogApiTests(unittest.TestCase):
    def test_write_session_log_event_uses_session_log_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                result = DesktopApi().write_session_log_event(
                    {
                        "type": "command",
                        "server": "prod-web-01",
                        "sessionId": "sess-1",
                        "actor": "user",
                        "command": "uptime",
                    }
                )

            self.assertTrue(result["ok"])
            self.assertTrue(Path(result["path"]).exists())
            self.assertIn(str(session_root), result["path"])

    def test_get_session_log_dir_creates_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                result = DesktopApi().get_session_log_dir()

            self.assertEqual(result, str(session_root))
            self.assertTrue(session_root.exists())

    def test_open_path_opens_existing_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(desktop_app.os, "startfile", create=True) as startfile:
                result = DesktopApi().open_path(temp_dir)

            self.assertTrue(result["ok"])
            self.assertEqual(result["path"], str(Path(temp_dir).resolve()))
            self.assertIn("已打开目录", result["message"])
            startfile.assert_called_once_with(str(Path(temp_dir).resolve()))

    def test_open_path_rejects_missing_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            missing = Path(temp_dir) / "missing"

            result = DesktopApi().open_path(str(missing))

            self.assertFalse(result["ok"])
            self.assertIn("路径不存在", result["message"])

    def test_list_session_log_entries_uses_session_log_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                api = DesktopApi()
                api.write_session_log_event(
                    {
                        "type": "command",
                        "server": "prod-web-01",
                        "sessionId": "sess-1",
                        "actor": "user",
                        "command": "df -h",
                    }
                )
                result = api.list_session_log_entries({"server": "prod-web-01", "query": "df"})

            self.assertTrue(result["ok"])
            self.assertEqual(result["total"], 1)
            self.assertEqual(result["entries"][0]["command"], "df -h")

    def test_build_session_log_export_returns_markdown(self):
        result = DesktopApi().build_session_log_export(
            [
                {
                    "createdAt": "2026-06-26T01:00:00Z",
                    "type": "command",
                    "server": "prod-web-01",
                    "sessionId": "sess-1",
                    "actor": "user",
                    "command": "uptime",
                    "status": "sent",
                }
            ],
            {"exportedAt": "2026-06-26T02:00:00Z"},
        )

        self.assertIn("# SSH 会话日志", result)
        self.assertIn("uptime", result)


    def test_delete_old_session_logs_uses_session_log_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            old_dir = session_root / "2026-05-01"
            recent_dir = session_root / "2026-06-20"
            old_dir.mkdir(parents=True)
            recent_dir.mkdir(parents=True)
            (old_dir / "prod-web-01-sess-1.jsonl").write_text("old", encoding="utf-8")
            (recent_dir / "prod-web-01-sess-2.jsonl").write_text("recent", encoding="utf-8")

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                result = DesktopApi().delete_old_session_logs(30, "2026-06-27T00:00:00Z")

            self.assertTrue(result["ok"])
            self.assertEqual(result["deleted"], 1)
            self.assertFalse((old_dir / "prod-web-01-sess-1.jsonl").exists())
            self.assertTrue((recent_dir / "prod-web-01-sess-2.jsonl").exists())


if __name__ == "__main__":
    unittest.main()
