import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from desktop_app import DesktopApi


class FakeWindow:
    def __init__(self, selected_path):
        self.selected_path = selected_path

    def create_file_dialog(self, *_args, **_kwargs):
        return [str(self.selected_path)]


class DesktopAiAttachmentApiTests(unittest.TestCase):
    def test_open_ai_attachment_file_decodes_gb18030_text_without_replacement_characters(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "nginx-gbk.log"
            source.write_bytes("中文日志\n服务正常\n".encode("gb18030"))
            fake_webview = types.SimpleNamespace(OPEN_DIALOG="open", windows=[FakeWindow(source)])

            with patch.dict(sys.modules, {"webview": fake_webview}):
                result = DesktopApi().open_ai_attachment_file()

        self.assertEqual(result["name"], "nginx-gbk.log")
        self.assertEqual(result["content"], "中文日志\n服务正常\n")
        self.assertEqual(result["encoding"], "gb18030")
        self.assertNotIn("\ufffd", result["content"])


if __name__ == "__main__":
    unittest.main()
