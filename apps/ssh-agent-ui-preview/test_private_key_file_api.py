import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from desktop_app import DesktopApi


class PrivateKeyFileApiTests(unittest.TestCase):
    def test_open_private_key_file_returns_content_and_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            key_path = Path(temp_dir) / "id_ed25519"
            key_content = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n"
            key_path.write_text(key_content, encoding="utf-8")

            class FakeWindow:
                def create_file_dialog(self, *_args, **_kwargs):
                    return [str(key_path)]

            fake_webview = type("FakeWebview", (), {"OPEN_DIALOG": object(), "windows": [FakeWindow()]})

            with patch.dict("sys.modules", {"webview": fake_webview}):
                result = DesktopApi().open_private_key_file()

        self.assertEqual(result["path"], str(key_path))
        self.assertEqual(result["name"], "id_ed25519")
        self.assertEqual(result["content"], key_content)

    def test_open_ai_attachment_file_returns_limited_text_content(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            attachment_path = Path(temp_dir) / "nginx-error.log"
            attachment_content = "upstream timed out\n" * 2000
            attachment_path.write_text(attachment_content, encoding="utf-8")
            attachment_size = attachment_path.stat().st_size

            class FakeWindow:
                def create_file_dialog(self, *_args, **_kwargs):
                    return [str(attachment_path)]

            fake_webview = type("FakeWebview", (), {"OPEN_DIALOG": object(), "windows": [FakeWindow()]})

            with patch.dict("sys.modules", {"webview": fake_webview}):
                result = DesktopApi().open_ai_attachment_file()

        self.assertEqual(result["path"], str(attachment_path))
        self.assertEqual(result["name"], "nginx-error.log")
        self.assertEqual(result["type"], "本地文件")
        self.assertEqual(result["content"], attachment_content[:12000])
        self.assertEqual(result["sizeBytes"], attachment_size)


if __name__ == "__main__":
    unittest.main()
