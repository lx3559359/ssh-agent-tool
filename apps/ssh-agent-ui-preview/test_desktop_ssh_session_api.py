import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import desktop_app
from desktop_app import DesktopApi, ssh_connection_log_context


class FakeSessionManager:
    def __init__(self):
        self.checked = []
        self.interrupted = []
        self.closed = []
        self.sent = []
        self.opened = []
        self.outputs = []
        self.resized = []
        self.inputs = []
        self.command_result = None
        self.input_result = None
        self.health_result = {"ok": True, "active": True, "sessionId": "session-1"}
        self.close_result = {"ok": True, "message": "closed"}

    def open_session(self, server, password, timeout=10, credential_metadata=None, terminal_size=None):
        self.opened.append((server, password, timeout, credential_metadata, terminal_size))
        return {"ok": True, "sessionId": "session-1", "message": "已连接"}

    def send_command(self, session_id, command):
        self.sent.append((session_id, command))
        if self.command_result is not None:
            return {**self.command_result, "sessionId": session_id, "command": command}
        return {"ok": True, "sessionId": session_id, "command": command, "output": "done\n", "message": "命令执行完成"}

    def close_session(self, session_id):
        self.closed.append(session_id)
        return {**self.close_result, "sessionId": session_id}

    def check_session_health(self, session_id):
        self.checked.append(session_id)
        return {**self.health_result, "sessionId": session_id}

    def read_output(self, session_id):
        if self.outputs:
            return self.outputs.pop(0)
        return {"ok": True, "sessionId": session_id, "output": "", "message": "no output"}

    def interrupt_command(self, session_id):
        self.interrupted.append(session_id)
        return {"ok": True, "message": "已发送 Ctrl+C 中断当前命令。"}

    def send_input(self, session_id, text, submit=False):
        self.inputs.append((session_id, text, submit))
        if self.input_result is not None:
            return {**self.input_result, "sessionId": session_id}
        return {"ok": True, "sessionId": session_id, "output": "continued\n", "message": "input sent"}

    def resize_session(self, session_id, width, height):
        self.resized.append((session_id, width, height))
        return {"ok": True, "sessionId": session_id, "width": width, "height": height}


class FakeRuntimeSessionManager(FakeSessionManager):
    def __init__(self):
        super().__init__()
        self.sessions = {
            "session-1": object(),
            "session-2": object(),
        }


class FakeRuntimePortForwardManager:
    def __init__(self):
        self.forwards = {
            "pf-1": {"id": "pf-1"},
            "pf-2": {"id": "pf-2"},
        }
        self.stopped = []

    def stop_forward(self, forward_id):
        self.stopped.append(forward_id)
        self.forwards.pop(forward_id, None)
        return {"ok": True, "message": "stopped"}


class FailingRuntimePortForwardManager(FakeRuntimePortForwardManager):
    def stop_forward(self, forward_id):
        self.stopped.append(forward_id)
        return {"ok": False, "message": "stop failed"}


class FailingOpenSessionManager(FakeSessionManager):
    def open_session(self, server, password, timeout=10, credential_metadata=None, terminal_size=None):
        self.opened.append((server, password, timeout, credential_metadata, terminal_size))
        return {"ok": False, "message": "connect failed password=DoNotLeak"}


class RaisingSessionManager(FakeSessionManager):
    def send_command(self, session_id, command):
        self.sent.append((session_id, command))
        raise RuntimeError("PTY 写入失败 token=secret-token")

    def send_input(self, session_id, text, submit=False):
        self.inputs.append((session_id, text, submit))
        raise RuntimeError("交互输入失败 password=DoNotLeak")


class RaisingSessionLifecycleManager(FakeSessionManager):
    def read_output(self, session_id):
        raise RuntimeError("read failed token=secret-token")

    def interrupt_command(self, session_id):
        self.interrupted.append(session_id)
        raise RuntimeError("interrupt failed token=secret-token")

    def resize_session(self, session_id, width, height):
        self.resized.append((session_id, width, height))
        raise RuntimeError("resize failed token=secret-token")

    def check_session_health(self, session_id):
        self.checked.append(session_id)
        raise RuntimeError("health failed token=secret-token")

    def close_session(self, session_id):
        self.closed.append(session_id)
        raise RuntimeError("close failed token=secret-token")


class DesktopSshSessionApiTests(unittest.TestCase):
    def test_ssh_connection_log_context_records_host_key_policy(self):
        context = ssh_connection_log_context(
            {
                "name": "prod-web-01",
                "ip": "10.0.1.23",
                "user": "root",
                "hostKeyAlias": "prod-web.internal",
                "trustedHostKey": {
                    "type": "ssh-ed25519",
                    "sha256": "SHA256:trusted-fingerprint",
                    "trustedAt": "2026-07-03T09:00:00.000Z",
                },
                "hostKeyTrust": {"status": "trusted", "label": "已信任"},
            },
            {"authType": "密码"},
        )

        self.assertEqual(context["hostKeyPolicy"], "trusted-fingerprint")
        self.assertEqual(context["trustedHostKeyType"], "ssh-ed25519")
        self.assertEqual(context["trustedHostKeySha256"], "SHA256:trusted-fingerprint")
        self.assertEqual(context["hostKeyTrustStatus"], "trusted")
        self.assertEqual(context["hostKeyAlias"], "prod-web.internal")
        self.assertNotIn("trustedAt", context)

        untrusted_context = ssh_connection_log_context({"ip": "10.0.1.23"}, {})
        self.assertEqual(untrusted_context["hostKeyPolicy"], "prompt-before-trust")

    def test_backend_user_facing_exception_messages_are_readable_chinese(self):
        cases = [
            desktop_app.session_result_output({"output": "x" * 12001}),
            desktop_app.ssh_session_exception_result("send_input", "session-1")["message"],
            desktop_app.ssh_session_exception_result("send_command", "session-1")["message"],
            desktop_app.ssh_operation_exception_result("test_connection")["message"],
            desktop_app.port_forward_exception_result("start_forward")["message"],
            desktop_app.model_api_exception_result("list_models")["message"],
        ]
        suspicious_fragments = [
            text.encode("utf-8").decode("gbk", errors="ignore")
            for text in ["失败", "发送", "连接", "读取", "检查", "操作", "端口", "模型", "会话", "日志", "输出"]
        ]

        for text in cases:
            for fragment in suspicious_fragments:
                self.assertNotIn(fragment, text)

        self.assertTrue(cases[0].endswith("[输出过长，已截断]"))
        self.assertEqual(cases[1], "SSH 发送交互输入失败，请查看会话日志或工具日志。")
        self.assertEqual(cases[2], "SSH 发送命令失败，请查看会话日志或工具日志。")
        self.assertEqual(cases[3], "SSH 连接探测失败，请查看工具日志。")
        self.assertEqual(cases[4], "端口转发启动失败，请查看工具日志。")
        self.assertEqual(cases[5], "模型 API 获取模型列表失败，请查看工具日志。")

    def test_test_ssh_login_uses_plain_secret_before_saving_credential(self):
        captured = {}

        def fake_run_readonly_command(server, password, command, timeout=10, credential_metadata=None):
            captured["server"] = server
            captured["password"] = password
            captured["command"] = command
            captured["timeout"] = timeout
            captured["metadata"] = credential_metadata
            return {"ok": True, "stdout": "root\n", "stderr": "", "message": "SSH 命令执行完成。"}

        with patch("desktop_app.run_readonly_command", fake_run_readonly_command):
            result = DesktopApi().test_ssh_login(
                {"ip": "10.0.1.23", "port": "2222", "user": "root", "authType": "密码", "timeoutSeconds": 15},
                "",
                "secret-before-save",
                {"authType": "密码"},
            )

        self.assertTrue(result["ok"])
        self.assertEqual(captured["password"], "secret-before-save")
        self.assertEqual(captured["command"], "whoami")
        self.assertEqual(captured["timeout"], 15)
        self.assertEqual(captured["metadata"]["authType"], "密码")
        self.assertIn("SSH 登录测试通过", result["message"])

    def test_test_ssh_login_falls_back_to_saved_credential_ref(self):
        class FakeStore:
            def read_secret(self, credential_ref):
                self.credential_ref = credential_ref
                return "saved-secret"

            def read_metadata(self, credential_ref):
                return {"authType": "密码", "identityFile": ""}

        captured = {}

        def fake_run_readonly_command(server, password, command, timeout=10, credential_metadata=None):
            captured["password"] = password
            captured["metadata"] = credential_metadata
            return {"ok": True, "stdout": "deploy\n", "stderr": "", "message": "SSH 命令执行完成。"}

        store = FakeStore()
        with patch("desktop_app.CredentialStore", lambda *_args: store):
            with patch("desktop_app.run_readonly_command", fake_run_readonly_command):
                result = DesktopApi().test_ssh_login({"ip": "10.0.1.23", "user": "deploy"}, "cred-1")

        self.assertTrue(result["ok"])
        self.assertEqual(store.credential_ref, "cred-1")
        self.assertEqual(captured["password"], "saved-secret")
        self.assertEqual(captured["metadata"]["authType"], "密码")

    def test_check_ssh_session_health_delegates_to_session_manager(self):
        api = DesktopApi()
        manager = FakeSessionManager()
        api._ssh_sessions = manager

        result = api.check_ssh_session_health("session-1")

        self.assertTrue(result["ok"])
        self.assertTrue(result["active"])
        self.assertEqual(manager.checked, ["session-1"])

    def test_interrupt_ssh_session_command_delegates_to_session_manager(self):
        api = DesktopApi()
        manager = FakeSessionManager()
        api._ssh_sessions = manager

        result = api.interrupt_ssh_session_command("session-1")

        self.assertTrue(result["ok"])
        self.assertEqual(manager.interrupted, ["session-1"])

    def test_resize_ssh_session_delegates_to_session_manager(self):
        api = DesktopApi()
        manager = FakeSessionManager()
        api._ssh_sessions = manager

        result = api.resize_ssh_session("session-1", 160, 48)

        self.assertTrue(result["ok"])
        self.assertEqual(result["width"], 160)
        self.assertEqual(result["height"], 48)
        self.assertEqual(manager.resized, [("session-1", 160, 48)])

    def test_open_ssh_session_passes_initial_terminal_size_to_session_manager(self):
        api = DesktopApi()
        manager = FakeSessionManager()
        api._ssh_sessions = manager

        class FakeStore:
            def read_secret(self, _credential_ref):
                return "secret"

            def read_metadata(self, _credential_ref):
                return {"authType": "密码"}

        with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeStore()):
            result = api.open_ssh_session(
                {"name": "prod-web-01", "ip": "10.0.1.23", "user": "root"},
                "cred-1",
                {"cols": 188, "rows": 46},
            )

        self.assertTrue(result["ok"])
        self.assertEqual(manager.opened[0][4], {"cols": 188, "rows": 46})

    def test_open_ssh_session_normalizes_initial_terminal_size_at_desktop_boundary(self):
        api = DesktopApi()
        manager = FakeSessionManager()
        api._ssh_sessions = manager

        class FakeStore:
            def read_secret(self, _credential_ref):
                return "secret"

            def read_metadata(self, _credential_ref):
                return {"authType": "password"}

        with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeStore()):
            result = api.open_ssh_session(
                {"name": "prod-web-01", "ip": "10.0.1.23", "user": "root"},
                "cred-1",
                {"cols": "3", "rows": "9999"},
            )

        self.assertTrue(result["ok"])
        self.assertEqual(manager.opened[0][4], {"cols": 40, "rows": 200})

    def test_resize_ssh_session_normalizes_pty_size_at_desktop_boundary(self):
        api = DesktopApi()
        manager = FakeSessionManager()
        api._ssh_sessions = manager

        result = api.resize_ssh_session("session-1", "9999", "bad")

        self.assertTrue(result["ok"])
        self.assertEqual(manager.resized, [("session-1", 500, 32)])
        self.assertEqual(result["width"], 500)
        self.assertEqual(result["height"], 32)

    def test_send_ssh_session_input_delegates_without_logging_sensitive_text(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            api = DesktopApi()
            manager = FakeSessionManager()
            api._ssh_sessions = manager
            api._session_servers["session-1"] = "prod-web-01"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                result = api.send_ssh_session_input("session-1", "sudo-password-secret", True)

            combined = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            self.assertTrue(result["ok"])
            self.assertEqual(manager.inputs, [("session-1", "sudo-password-secret", True)])
            self.assertIn("interactive_input", combined)
            self.assertIn("prod-web-01", combined)
            self.assertIn("inputLength", combined)
            self.assertNotIn("sudo-password-secret", combined)

    def test_ssh_session_actions_are_written_to_session_log_without_secrets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            api = DesktopApi()
            manager = FakeSessionManager()
            api._ssh_sessions = manager

            class FakeStore:
                def read_secret(self, _credential_ref):
                    return "ServerPassword!123"

                def read_metadata(self, _credential_ref):
                    return {"authType": "密码"}

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeStore()):
                    opened = api.open_ssh_session({"name": "prod-web-01", "ip": "10.0.1.23", "user": "root"}, "cred-1")
                    sent = api.send_ssh_session_command("session-1", "curl https://example.com?token=secret-token")
                    closed = api.close_ssh_session("session-1")

            combined = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            self.assertTrue(opened["ok"])
            self.assertTrue(sent["ok"])
            self.assertTrue(closed["ok"])
            self.assertIn("session_open", combined)
            self.assertIn("command", combined)
            self.assertIn("session_close", combined)
            self.assertIn("prod-web-01", combined)
            self.assertNotIn("secret-token", combined)
            self.assertNotIn("ServerPassword!123", combined)

    def test_failed_ssh_session_command_is_written_as_command_failed(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            api = DesktopApi()
            manager = FakeSessionManager()
            manager.command_result = {"ok": False, "message": "command failed token=secret-token", "output": ""}
            api._ssh_sessions = manager
            api._session_servers["session-1"] = "prod-web-01"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                result = api.send_ssh_session_command("session-1", "cat /missing?token=secret-token")

            combined = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn("command_failed", combined)
            self.assertIn("prod-web-01", combined)
            self.assertIn("session-1", combined)
            self.assertNotIn("secret-token", combined)

    def test_failed_ssh_session_command_tool_log_keeps_failure_kind(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            tool_root = Path(temp_dir) / "tool-logs"
            api = DesktopApi()
            manager = FakeSessionManager()
            manager.command_result = {
                "ok": False,
                "message": "SSH session transport is inactive",
                "failureKind": "transport",
                "output": "",
            }
            api._ssh_sessions = manager
            api._session_servers["session-1"] = "prod-web-01"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    result = api.send_ssh_session_command("session-1", "uptime")

            tool_log = "\n".join(path.read_text(encoding="utf-8") for path in tool_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn('"action":"send_command"', tool_log)
            self.assertIn('"failureKind":"transport"', tool_log)
            self.assertIn('"sessionId":"session-1"', tool_log)

    def test_failed_ssh_session_command_session_log_keeps_filterable_failure_kind(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            api = DesktopApi()
            manager = FakeSessionManager()
            manager.command_result = {
                "ok": False,
                "message": "SSH session transport is inactive",
                "failureKind": "transport",
                "output": "",
            }
            api._ssh_sessions = manager
            api._session_servers["session-1"] = "prod-web-01"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                result = api.send_ssh_session_command("session-1", "uptime")

            session_log = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn('"type":"command_failed"', session_log)
            self.assertIn('"failureKind":"transport"', session_log)
            self.assertIn('"sessionId":"session-1"', session_log)

    def test_ssh_session_command_exception_returns_failure_and_logs_recovery_context(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            tool_root = Path(temp_dir) / "tool-logs"
            api = DesktopApi()
            manager = RaisingSessionManager()
            api._ssh_sessions = manager
            api._session_servers["session-1"] = "prod-web-01"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    result = api.send_ssh_session_command("session-1", "uptime && echo token=secret-token")

            session_log = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            tool_log = "\n".join(path.read_text(encoding="utf-8") for path in tool_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn("SSH 会话命令发送失败", result["message"])
            self.assertEqual(manager.sent, [("session-1", "uptime && echo token=secret-token")])
            self.assertIn("command_failed", session_log)
            self.assertIn("prod-web-01", session_log)
            self.assertIn("send_command", tool_log)
            self.assertNotIn("secret-token", session_log)
            self.assertNotIn("secret-token", tool_log)

    def test_ssh_session_input_exception_returns_failure_without_logging_typed_secret(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            tool_root = Path(temp_dir) / "tool-logs"
            api = DesktopApi()
            manager = RaisingSessionManager()
            api._ssh_sessions = manager
            api._session_servers["session-1"] = "prod-web-01"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    result = api.send_ssh_session_input("session-1", "sudo-password-secret", True)

            session_log = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            tool_log = "\n".join(path.read_text(encoding="utf-8") for path in tool_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn("SSH 交互输入发送失败", result["message"])
            self.assertEqual(manager.inputs, [("session-1", "sudo-password-secret", True)])
            self.assertIn("interactive_input_failed", session_log)
            self.assertIn("inputLength", session_log)
            self.assertIn("send_input", tool_log)
            self.assertNotIn("sudo-password-secret", session_log)
            self.assertNotIn("sudo-password-secret", tool_log)
            self.assertNotIn("DoNotLeak", session_log)
            self.assertNotIn("DoNotLeak", tool_log)

    def test_failed_ssh_session_input_session_log_keeps_filterable_failure_kind(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            api = DesktopApi()
            manager = FakeSessionManager()
            manager.input_result = {
                "ok": False,
                "message": "SSH input transport is inactive",
                "failureKind": "transport",
                "output": "",
            }
            api._ssh_sessions = manager
            api._session_servers["session-1"] = "prod-web-01"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                result = api.send_ssh_session_input("session-1", "sudo-password-secret", True)

            session_log = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn('"type":"interactive_input_failed"', session_log)
            self.assertIn('"failureKind":"transport"', session_log)
            self.assertIn('"inputLength":20', session_log)
            self.assertNotIn("sudo-password-secret", session_log)

    def test_failed_ssh_session_open_logs_safe_connection_context(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            api = DesktopApi()
            manager = FailingOpenSessionManager()
            api._ssh_sessions = manager

            class FakeStore:
                def read_secret(self, _credential_ref):
                    return "ServerPassword!123"

                def read_metadata(self, _credential_ref):
                    return {"authType": "password", "identityFile": "C:/Users/me/.ssh/id_rsa"}

            server = {
                "name": "prod-web-01",
                "ip": "10.0.1.23",
                "port": "2222",
                "user": "root",
                "authType": "password",
                "timeoutSeconds": 24,
                "retryCount": 2,
                "proxyJump": "jump@bastion:22",
                "credentialRef": "sshcred-prod",
            }
            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeStore()):
                    result = api.open_ssh_session(server, "sshcred-prod")

            combined = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn('"type":"session_open"', combined)
            self.assertIn('"status":"failed"', combined)
            self.assertIn('"host":"10.0.1.23"', combined)
            self.assertIn('"port":2222', combined)
            self.assertIn('"user":"root"', combined)
            self.assertIn('"authType":"password"', combined)
            self.assertIn('"timeoutSeconds":24', combined)
            self.assertIn('"retryCount":2', combined)
            self.assertIn('"proxyJump":"jump@bastion:22"', combined)
            self.assertNotIn("ServerPassword!123", combined)
            self.assertNotIn("DoNotLeak", combined)
            self.assertNotIn("sshcred-prod", combined)

    def test_failed_ssh_session_open_writes_filterable_failure_kind_to_session_log(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            api = DesktopApi()
            manager = FailingOpenSessionManager()
            api._ssh_sessions = manager

            class FakeStore:
                def read_secret(self, _credential_ref):
                    return "ServerPassword!123"

                def read_metadata(self, _credential_ref):
                    return {"authType": "password"}

            server = {
                "name": "prod-web-01",
                "ip": "10.0.1.23",
                "port": "2222",
                "user": "root",
                "authType": "password",
                "credentialRef": "sshcred-prod",
            }
            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeStore()):
                    result = api.open_ssh_session(server, "sshcred-prod")

            combined = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn('"type":"session_open"', combined)
            self.assertIn('"status":"failed"', combined)
            self.assertIn('"failureKind":"auth"', combined)
            self.assertNotIn("ServerPassword!123", combined)
            self.assertNotIn("DoNotLeak", combined)
            self.assertNotIn("sshcred-prod", combined)

    def test_failed_ssh_session_open_writes_actionable_tool_log_without_credential_refs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            tool_root = Path(temp_dir) / "tool-logs"
            api = DesktopApi()
            manager = FailingOpenSessionManager()
            api._ssh_sessions = manager

            class FakeStore:
                def read_secret(self, _credential_ref):
                    return "ServerPassword!123"

                def read_metadata(self, _credential_ref):
                    return {"authType": "password"}

            server = {
                "name": "prod-web-01",
                "ip": "10.0.1.23",
                "port": "2222",
                "user": "root",
                "authType": "password",
                "timeoutSeconds": 24,
                "retryCount": 2,
                "credentialRef": "sshcred-prod",
            }
            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeStore()):
                        result = api.open_ssh_session(server, "sshcred-prod")

            combined = "\n".join(path.read_text(encoding="utf-8") for path in tool_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn('"action":"open_session"', combined)
            self.assertIn('"serverName":"prod-web-01"', combined)
            self.assertIn('"host":"10.0.1.23"', combined)
            self.assertIn('"port":2222', combined)
            self.assertIn('"user":"root"', combined)
            self.assertIn('"authType":"password"', combined)
            self.assertIn('"timeoutSeconds":24', combined)
            self.assertIn('"retryCount":2', combined)
            self.assertIn('"failureKind":"auth"', combined)
            self.assertNotIn("ServerPassword!123", combined)
            self.assertNotIn("DoNotLeak", combined)
            self.assertNotIn("sshcred-prod", combined)
            self.assertNotIn("credentialRef", combined)

    def test_failed_ssh_session_open_logs_keepalive_for_stability_diagnostics(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            tool_root = Path(temp_dir) / "tool-logs"
            api = DesktopApi()
            manager = FailingOpenSessionManager()
            api._ssh_sessions = manager

            class FakeStore:
                def read_secret(self, _credential_ref):
                    return "ServerPassword!123"

                def read_metadata(self, _credential_ref):
                    return {"authType": "password"}

            server = {
                "name": "prod-web-01",
                "ip": "10.0.1.23",
                "port": "2222",
                "user": "root",
                "authType": "password",
                "timeoutSeconds": 24,
                "keepaliveSeconds": 45,
                "retryCount": 2,
                "credentialRef": "sshcred-prod",
            }
            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeStore()):
                        result = api.open_ssh_session(server, "sshcred-prod")

            session_log = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            tool_log = "\n".join(path.read_text(encoding="utf-8") for path in tool_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn('"keepaliveSeconds":45', session_log)
            self.assertIn('"keepaliveSeconds":45', tool_log)
            self.assertNotIn("ServerPassword!123", session_log)
            self.assertNotIn("ServerPassword!123", tool_log)
            self.assertNotIn("sshcred-prod", session_log)
            self.assertNotIn("sshcred-prod", tool_log)

    def test_ssh_session_output_polling_is_written_to_session_log_without_empty_noise(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            api = DesktopApi()
            manager = FakeSessionManager()
            manager.outputs = [
                {"ok": True, "sessionId": "session-1", "output": "load average: 0.42 token=secret-token\n", "message": "read ok"},
                {"ok": True, "sessionId": "session-1", "output": "", "message": "no output"},
            ]
            api._ssh_sessions = manager
            api._session_servers["session-1"] = "prod-web-01"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                first = api.read_ssh_session_output("session-1")
                second = api.read_ssh_session_output("session-1")

            combined = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            self.assertTrue(first["ok"])
            self.assertTrue(second["ok"])
            self.assertIn("output", combined)
            self.assertIn("load average: 0.42", combined)
            self.assertIn("prod-web-01", combined)
            self.assertNotIn("secret-token", combined)
            self.assertEqual(combined.count("ssh-agent-tool.session-log.v1"), 1)

    def test_failed_ssh_output_polling_is_written_to_tool_log(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            tool_root = Path(temp_dir) / "tool-logs"
            api = DesktopApi()
            manager = FakeSessionManager()
            manager.outputs = [
                {"ok": False, "sessionId": "session-1", "output": "", "message": "读取失败 token=secret-token"},
            ]
            api._ssh_sessions = manager
            api._session_servers["session-1"] = "prod-web-01"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    result = api.read_ssh_session_output("session-1")

            combined = "\n".join(path.read_text(encoding="utf-8") for path in tool_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn("ssh", combined)
            self.assertIn("read_output", combined)
            self.assertIn("session-1", combined)
            self.assertNotIn("secret-token", combined)

    def test_failed_ssh_output_polling_session_log_keeps_failure_kind(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            api = DesktopApi()
            manager = FakeSessionManager()
            manager.outputs = [
                {
                    "ok": False,
                    "sessionId": "session-1",
                    "output": "",
                    "message": "SSH transport is inactive",
                    "sshFailure": {"kind": "transport", "summary": "transport inactive"},
                },
            ]
            api._ssh_sessions = manager
            api._session_servers["session-1"] = "prod-web-01"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                result = api.read_ssh_session_output("session-1")

            combined = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn('"type":"output_failed"', combined)
            self.assertIn('"failureKind":"transport"', combined)
            self.assertIn("prod-web-01", combined)

    def test_ssh_interrupt_is_written_to_session_log(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            api = DesktopApi()
            manager = FakeSessionManager()
            api._ssh_sessions = manager
            api._session_servers["session-1"] = "prod-web-01"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                result = api.interrupt_ssh_session_command("session-1")

            combined = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            self.assertTrue(result["ok"])
            self.assertIn("command_interrupt", combined)
            self.assertIn("prod-web-01", combined)
            self.assertIn("session-1", combined)

    def test_failed_ssh_health_check_is_written_to_session_log(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            api = DesktopApi()
            manager = FakeSessionManager()
            manager.health_result = {"ok": False, "active": False, "message": "SSH session disconnected"}
            api._ssh_sessions = manager
            api._session_servers["session-1"] = "prod-web-01"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                result = api.check_ssh_session_health("session-1")

            combined = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn("session_health_failed", combined)
            self.assertIn("SSH session disconnected", combined)
            self.assertIn("prod-web-01", combined)

    def test_failed_ssh_health_check_session_log_keeps_filterable_failure_kind(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            api = DesktopApi()
            manager = FakeSessionManager()
            manager.health_result = {
                "ok": False,
                "active": False,
                "message": "SSH transport is inactive",
                "failureKind": "transport",
            }
            api._ssh_sessions = manager
            api._session_servers["session-1"] = "prod-web-01"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                result = api.check_ssh_session_health("session-1")

            combined = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn('"type":"session_health_failed"', combined)
            self.assertIn('"failureKind":"transport"', combined)
            self.assertIn('"sessionId":"session-1"', combined)

    def test_failed_ssh_session_close_is_written_to_tool_log(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            tool_root = Path(temp_dir) / "tool-logs"
            api = DesktopApi()
            manager = FakeSessionManager()
            manager.close_result = {"ok": False, "message": "close failed token=secret-token"}
            api._ssh_sessions = manager
            api._session_servers["session-1"] = "prod-web-01"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    result = api.close_ssh_session("session-1")

            combined = "\n".join(path.read_text(encoding="utf-8") for path in tool_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn("ssh", combined)
            self.assertIn("close_session", combined)
            self.assertIn("session-1", combined)
            self.assertNotIn("secret-token", combined)

    def test_failed_ssh_session_close_is_written_to_session_log_without_secrets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            api = DesktopApi()
            manager = FakeSessionManager()
            manager.close_result = {"ok": False, "message": "close failed token=secret-token"}
            api._ssh_sessions = manager
            api._session_servers["session-1"] = "prod-web-01"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                result = api.close_ssh_session("session-1")

            combined = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn("session_close", combined)
            self.assertIn("failed", combined)
            self.assertIn("prod-web-01", combined)
            self.assertIn("session-1", combined)
            self.assertNotIn("secret-token", combined)

    def test_failed_ssh_session_close_session_log_keeps_filterable_failure_kind(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            api = DesktopApi()
            manager = FakeSessionManager()
            manager.close_result = {
                "ok": False,
                "message": "SSH transport is inactive",
                "failureKind": "transport",
            }
            api._ssh_sessions = manager
            api._session_servers["session-1"] = "prod-web-01"

            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                result = api.close_ssh_session("session-1")

            combined = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn('"type":"session_close"', combined)
            self.assertIn('"status":"failed"', combined)
            self.assertIn('"failureKind":"transport"', combined)
            self.assertIn('"sessionId":"session-1"', combined)

    def test_ssh_session_open_exception_returns_failure_and_logs_context(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = Path(temp_dir) / "sessions"
            tool_root = Path(temp_dir) / "tool-logs"
            api = DesktopApi()

            class FakeStore:
                def read_secret(self, _credential_ref):
                    raise RuntimeError("credential read failed password=secret-token")

                def read_metadata(self, _credential_ref):
                    return {"authType": "password"}

            server = {"name": "prod-web-01", "ip": "10.0.1.23", "user": "root", "credentialRef": "sshcred-prod"}
            with patch.object(desktop_app, "session_log_path", lambda: session_root):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeStore()):
                        result = api.open_ssh_session(server, "sshcred-prod")

            session_log = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
            tool_log = "\n".join(path.read_text(encoding="utf-8") for path in tool_root.rglob("*.jsonl"))
            self.assertFalse(result["ok"])
            self.assertIn("SSH", result["message"])
            self.assertIn("日志", result["message"])
            self.assertIn("session_open", session_log)
            self.assertIn("failed", session_log)
            self.assertIn("prod-web-01", session_log)
            self.assertIn("open_session", tool_log)
            self.assertNotIn("secret-token", session_log)
            self.assertNotIn("secret-token", tool_log)
            self.assertNotIn("sshcred-prod", session_log)
            self.assertNotIn("sshcred-prod", tool_log)

    def test_ssh_session_lifecycle_exceptions_return_failure_and_logs(self):
        cases = [
            (lambda api: api.read_ssh_session_output("session-1"), "read_output", "output_failed"),
            (lambda api: api.interrupt_ssh_session_command("session-1"), "interrupt_command", "command_interrupt"),
            (lambda api: api.resize_ssh_session("session-1", 160, 48), "resize_session", ""),
            (lambda api: api.check_ssh_session_health("session-1"), "check_session_health", "session_health_failed"),
            (lambda api: api.close_ssh_session("session-1"), "close_session", "session_close"),
        ]
        for action, tool_action, session_marker in cases:
            with self.subTest(tool_action=tool_action):
                with tempfile.TemporaryDirectory() as temp_dir:
                    session_root = Path(temp_dir) / "sessions"
                    tool_root = Path(temp_dir) / "tool-logs"
                    api = DesktopApi()
                    manager = RaisingSessionLifecycleManager()
                    api._ssh_sessions = manager
                    api._session_servers["session-1"] = "prod-web-01"

                    with patch.object(desktop_app, "session_log_path", lambda: session_root):
                        with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                            result = action(api)

                    session_log = "\n".join(path.read_text(encoding="utf-8") for path in session_root.rglob("*.jsonl"))
                    tool_log = "\n".join(path.read_text(encoding="utf-8") for path in tool_root.rglob("*.jsonl"))
                    self.assertFalse(result["ok"])
                    self.assertIn("SSH", result["message"])
                    self.assertIn("日志", result["message"])
                    self.assertIn(tool_action, tool_log)
                    self.assertIn("session-1", tool_log)
                    if session_marker:
                        self.assertIn(session_marker, session_log)
                        self.assertIn("prod-web-01", session_log)
                    self.assertNotIn("secret-token", session_log)
                    self.assertNotIn("secret-token", tool_log)

    def test_shutdown_runtime_closes_known_ssh_sessions_and_logs_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            tool_root = Path(temp_dir) / "tool-logs"
            api = DesktopApi()
            manager = FakeRuntimeSessionManager()
            api._ssh_sessions = manager
            api._session_servers = {
                "session-1": "prod-web-01",
                "session-2": "prod-db-01",
            }

            with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                result = api.shutdown_runtime("window_closed")

            saved = next(tool_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertTrue(result["ok"])
            self.assertEqual(result["closedSessions"], 2)
            self.assertEqual(manager.closed, ["session-1", "session-2"])
            self.assertEqual(api._session_servers, {})
            self.assertIn('"action":"app_shutdown"', saved)
            self.assertIn('"reason":"window_closed"', saved)
            self.assertIn('"closedSessions":2', saved)

    def test_shutdown_runtime_stops_known_port_forwards_and_logs_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            tool_root = Path(temp_dir) / "tool-logs"
            api = DesktopApi()
            forwards = FakeRuntimePortForwardManager()
            api._port_forwards = forwards

            with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                result = api.shutdown_runtime("window_closed")

            saved = next(tool_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertTrue(result["ok"])
            self.assertEqual(result["closedPortForwards"], 2)
            self.assertEqual(forwards.stopped, ["pf-1", "pf-2"])
            self.assertEqual(forwards.forwards, {})
            self.assertIn('"action":"app_shutdown"', saved)
            self.assertIn('"closedPortForwards":2', saved)
            self.assertIn('"failedPortForwards":0', saved)

    def test_shutdown_runtime_reports_failed_runtime_resource_ids(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            tool_root = Path(temp_dir) / "tool-logs"
            api = DesktopApi()
            manager = FakeRuntimeSessionManager()
            manager.close_result = {"ok": False, "message": "close failed"}
            forwards = FailingRuntimePortForwardManager()
            api._ssh_sessions = manager
            api._port_forwards = forwards
            api._session_servers = {
                "session-1": "prod-web-01",
                "session-2": "prod-db-01",
            }

            with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                result = api.shutdown_runtime("window_closed")

            saved = next(tool_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertFalse(result["ok"])
            self.assertEqual(result["failedSessionIds"], ["session-1", "session-2"])
            self.assertEqual(result["failedPortForwardIds"], ["pf-1", "pf-2"])
            self.assertIn('"failedSessionIds":["session-1","session-2"]', saved)
            self.assertIn('"failedPortForwardIds":["pf-1","pf-2"]', saved)

    def test_shutdown_runtime_cancels_active_agent_runner_tasks_and_logs_ids(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            tool_root = Path(temp_dir) / "tool-logs"
            api = DesktopApi()
            cli_event = threading.Event()
            mcp_event = threading.Event()
            original_cli_runs = DesktopApi._active_cli_runs
            original_mcp_runs = DesktopApi._active_mcp_runs
            DesktopApi._active_cli_runs = {"cli-run-1": cli_event}
            DesktopApi._active_mcp_runs = {"mcp-run-1": mcp_event}
            try:
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    result = api.shutdown_runtime("window_closed")
            finally:
                DesktopApi._active_cli_runs = original_cli_runs
                DesktopApi._active_mcp_runs = original_mcp_runs

            saved = next(tool_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertTrue(result["ok"])
            self.assertTrue(cli_event.is_set())
            self.assertTrue(mcp_event.is_set())
            self.assertEqual(result["cancelledCliRuns"], 1)
            self.assertEqual(result["cancelledMcpRuns"], 1)
            self.assertEqual(result["cancelledCliRunIds"], ["cli-run-1"])
            self.assertEqual(result["cancelledMcpRunIds"], ["mcp-run-1"])
            self.assertIn('"cancelledCliRunIds":["cli-run-1"]', saved)
            self.assertIn('"cancelledMcpRunIds":["mcp-run-1"]', saved)

    def test_shutdown_runtime_cancels_active_sftp_transfer_jobs_and_logs_ids(self):
        class FakeSftpTransferJobs:
            def __init__(self):
                self.cancelled = False

            def cancel_active(self):
                self.cancelled = True
                return [
                    {
                        "id": "sftp-job-1",
                        "direction": "download",
                        "remotePath": "/var/log/app.log",
                        "localPath": "C:/Users/me/app.log",
                        "status": "canceled",
                    },
                    {
                        "id": "sftp-job-2",
                        "direction": "upload",
                        "remotePath": "/var/www/app",
                        "localPath": "C:/Users/me/nginx.conf",
                        "status": "canceled",
                    },
                ]

        with tempfile.TemporaryDirectory() as temp_dir:
            tool_root = Path(temp_dir) / "tool-logs"
            api = DesktopApi()
            fake_jobs = FakeSftpTransferJobs()

            with patch.object(desktop_app, "SFTP_TRANSFER_JOBS", fake_jobs):
                with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                    result = api.shutdown_runtime("window_closed")

            saved = next(tool_root.glob("*.jsonl")).read_text(encoding="utf-8")
            self.assertTrue(result["ok"])
            self.assertTrue(fake_jobs.cancelled)
            self.assertEqual(result["cancelledSftpTransfers"], 2)
            self.assertEqual(result["cancelledSftpTransferIds"], ["sftp-job-1", "sftp-job-2"])
            self.assertIn('"cancelledSftpTransfers":2', saved)
            self.assertIn('"cancelledSftpTransferIds":["sftp-job-1","sftp-job-2"]', saved)


if __name__ == "__main__":
    unittest.main()
