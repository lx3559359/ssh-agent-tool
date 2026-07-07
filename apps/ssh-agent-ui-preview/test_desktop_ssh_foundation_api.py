import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import desktop_app
from desktop_app import DesktopApi


def read_log_text(root: Path) -> str:
    return "\n".join(path.read_text(encoding="utf-8") for path in root.rglob("*.jsonl"))


class RaisingPortForwardManager:
    def start_forward(self, server, secret, metadata, config):
        raise RuntimeError("forward start failed token=secret-token")

    def stop_forward(self, forward_id):
        raise RuntimeError("forward stop failed token=secret-token")

    def list_forwards(self):
        raise RuntimeError("forward list failed token=secret-token")


class DesktopSshFoundationApiTests(unittest.TestCase):
    def test_ssh_connection_probe_exception_returns_failure_and_logs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            tool_root = Path(temp_dir) / "tool-logs"
            with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                with patch.object(desktop_app, "probe_ssh_endpoint", side_effect=RuntimeError("probe failed token=secret-token")):
                    result = DesktopApi().test_ssh_connection("10.0.1.23", "22")

            tool_log = read_log_text(tool_root)
            self.assertFalse(result["ok"])
            self.assertIn("SSH", result["message"])
            self.assertIn("日志", result["message"])
            self.assertIn("test_connection", tool_log)
            self.assertIn("10.0.1.23", tool_log)
            self.assertNotIn("secret-token", tool_log)

    def test_ssh_login_exception_returns_failure_and_logs_without_credential_ref(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            tool_root = Path(temp_dir) / "tool-logs"

            class FakeStore:
                def read_secret(self, _credential_ref):
                    raise RuntimeError("credential read failed password=secret-token")

                def read_metadata(self, _credential_ref):
                    return {"authType": "password"}

            server = {"name": "prod-web-01", "ip": "10.0.1.23", "user": "root", "credentialRef": "sshcred-prod"}
            with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeStore()):
                    result = DesktopApi().test_ssh_login(server, "sshcred-prod")

            tool_log = read_log_text(tool_root)
            self.assertFalse(result["ok"])
            self.assertIn("SSH", result["message"])
            self.assertIn("日志", result["message"])
            self.assertIn("test_login", tool_log)
            self.assertIn("prod-web-01", tool_log)
            self.assertNotIn("secret-token", tool_log)
            self.assertNotIn("sshcred-prod", tool_log)

    def test_readonly_command_exception_returns_failure_and_logs_without_secret(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            tool_root = Path(temp_dir) / "tool-logs"

            class FakeStore:
                def read_secret(self, _credential_ref):
                    return "ServerPassword!123"

                def read_metadata(self, _credential_ref):
                    return {"authType": "password"}

            server = {"name": "prod-web-01", "ip": "10.0.1.23", "user": "root"}
            with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeStore()):
                    with patch.object(desktop_app, "run_readonly_command", side_effect=RuntimeError("command failed token=secret-token")):
                        result = DesktopApi().run_ssh_readonly_command(server, "sshcred-prod", "uptime")

            tool_log = read_log_text(tool_root)
            self.assertFalse(result["ok"])
            self.assertIn("SSH", result["message"])
            self.assertIn("日志", result["message"])
            self.assertIn("readonly_command", tool_log)
            self.assertIn("prod-web-01", tool_log)
            self.assertNotIn("secret-token", tool_log)
            self.assertNotIn("ServerPassword!123", tool_log)

    def test_port_forward_exceptions_return_failure_and_logs(self):
        cases = [
            (lambda api: api.start_port_forward({"name": "prod-web-01", "ip": "10.0.1.23"}, "sshcred-prod", {"localPort": "18080"}), "start_forward"),
            (lambda api: api.stop_port_forward("forward-1"), "stop_forward"),
            (lambda api: api.list_port_forwards(), "list_forwards"),
        ]
        for action, tool_action in cases:
            with self.subTest(tool_action=tool_action):
                with tempfile.TemporaryDirectory() as temp_dir:
                    tool_root = Path(temp_dir) / "tool-logs"

                    class FakeStore:
                        def read_secret(self, _credential_ref):
                            return "ServerPassword!123"

                        def read_metadata(self, _credential_ref):
                            return {"authType": "password"}

                    api = DesktopApi()
                    api._port_forwards = RaisingPortForwardManager()
                    with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                        with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeStore()):
                            result = action(api)

                    tool_log = read_log_text(tool_root)
                    self.assertFalse(result["ok"])
                    self.assertIn("端口转发", result["message"])
                    self.assertIn("日志", result["message"])
                    self.assertIn(tool_action, tool_log)
                    self.assertNotIn("secret-token", tool_log)
                    self.assertNotIn("ServerPassword!123", tool_log)
                    self.assertNotIn("sshcred-prod", tool_log)


if __name__ == "__main__":
    unittest.main()
