import unittest
import base64
import hashlib

import ssh_interactive
from ssh_interactive import SshSessionManager


class FakeChannel:
    def __init__(self):
        self.sent = []
        self.closed = False
        self.chunks = [b"welcome\r\n", b"$ "]
        self.resized_to = None

    def settimeout(self, timeout):
        self.timeout = timeout

    def recv_ready(self):
        return bool(self.chunks)

    def recv(self, size):
        return self.chunks.pop(0)

    def send(self, value):
        data = value if isinstance(value, bytes) else str(value).encode("utf-8")
        self.sent.append(data.decode("utf-8"))
        self.chunks.append(b"root\n$ ")
        return len(data)

    def resize_pty(self, width=120, height=32):
        self.resized_to = (width, height)

    def close(self):
        self.closed = True


class StreamingOutputChannel(FakeChannel):
    def __init__(self):
        super().__init__()
        self.stream = b""

    def recv_ready(self):
        return bool(self.chunks or self.stream)

    def recv(self, size):
        if self.chunks:
            return super().recv(size)
        data = self.stream[:size]
        self.stream = self.stream[size:]
        return data


class FailingSendChannel(FakeChannel):
    def send(self, value):
        raise RuntimeError("channel closed")


class FailingResizeChannel(FakeChannel):
    def resize_pty(self, width=120, height=32):
        raise RuntimeError("resize failed")


class PartialSendChannel(FakeChannel):
    def __init__(self, chunk_size=4):
        super().__init__()
        self.chunk_size = chunk_size
        self.sent_bytes = []

    def send(self, value):
        data = value if isinstance(value, bytes) else str(value).encode("utf-8")
        accepted = data[: self.chunk_size]
        self.sent_bytes.append(accepted)
        self.sent.append(accepted.decode("utf-8", errors="replace"))
        self.chunks.append(b"root\n$ ")
        return len(accepted)


class FailingRecvChannel(FakeChannel):
    def recv_ready(self):
        return True

    def recv(self, size):
        raise RuntimeError("recv failed")


class FailingAfterInitialRecvChannel(FakeChannel):
    def __init__(self):
        super().__init__()
        self.fail_reads = False

    def recv_ready(self):
        return self.fail_reads or super().recv_ready()

    def recv(self, size):
        if self.fail_reads:
            raise RuntimeError("recv failed")
        return super().recv(size)


class ExitedChannel(FakeChannel):
    def exit_status_ready(self):
        return True


class ClosedShellChannel(FakeChannel):
    def __init__(self):
        super().__init__()
        self.chunks = []
        self.closed = True


class FakeClient:
    def __init__(self):
        self.channel = FakeChannel()
        self.closed = False
        self.connected_with = None
        self.transport = FakeTransport()

    def set_missing_host_key_policy(self, policy):
        self.policy = policy

    def connect(self, **kwargs):
        self.connected_with = kwargs

    def invoke_shell(self, term="xterm", width=120, height=32):
        self.term = term
        self.width = width
        self.height = height
        return self.channel

    def get_transport(self):
        return self.transport

    def close(self):
        self.closed = True


class FailingConnectClient(FakeClient):
    def __init__(self, error):
        super().__init__()
        self.error = error

    def connect(self, **kwargs):
        raise self.error


class StreamingOutputClient(FakeClient):
    def __init__(self):
        super().__init__()
        self.channel = StreamingOutputChannel()


class FailingSendClient(FakeClient):
    def __init__(self):
        super().__init__()
        self.channel = FailingSendChannel()


class FailingResizeClient(FakeClient):
    def __init__(self):
        super().__init__()
        self.channel = FailingResizeChannel()


class PartialSendClient(FakeClient):
    def __init__(self):
        super().__init__()
        self.channel = PartialSendChannel()


class FailingRecvClient(FakeClient):
    def __init__(self):
        super().__init__()
        self.channel = FailingRecvChannel()


class FailingAfterInitialRecvClient(FakeClient):
    def __init__(self):
        super().__init__()
        self.channel = FailingAfterInitialRecvChannel()


class FailingShellClient(FakeClient):
    def invoke_shell(self, term="xterm", width=120, height=32):
        raise RuntimeError("shell failed")


class ExitedShellClient(FakeClient):
    def __init__(self):
        super().__init__()
        self.channel = ExitedChannel()


class ClosedShellClient(FakeClient):
    def __init__(self):
        super().__init__()
        self.channel = ClosedShellChannel()


class FakeRemoteKey:
    def get_name(self):
        return "ssh-rsa"

    def asbytes(self):
        return b"interactive-server-key"


class FakeTransport:
    def __init__(self):
        self.channel = object()
        self.opened = []
        self.active = True
        self.keepalive_interval = None

    def get_remote_server_key(self):
        return FakeRemoteKey()

    def open_channel(self, kind, destination, source):
        self.opened.append((kind, destination, source))
        return self.channel

    def is_active(self):
        return self.active

    def set_keepalive(self, interval):
        self.keepalive_interval = interval


class FakeParamiko:
    class AutoAddPolicy:
        pass

    def __init__(self, client):
        self.client = client
        self.agent = FakeAgentModule()

    def SSHClient(self):
        return self.client


class FakeAgentModule:
    def __init__(self):
        self.handlers = []

    def AgentRequestHandler(self, channel):
        handler = FakeAgentRequestHandler(channel)
        self.handlers.append(handler)
        return handler


class FakeAgentRequestHandler:
    def __init__(self, channel):
        self.channel = channel
        self.closed = False

    def close(self):
        self.closed = True


class CyclingParamiko:
    class AutoAddPolicy:
        pass

    def __init__(self, clients):
        self.clients = list(clients)
        self.index = 0
        self.agent = FakeAgentModule()

    def SSHClient(self):
        client = self.clients[self.index]
        self.index += 1
        return client


class SshInteractiveTests(unittest.TestCase):
    def test_session_messages_are_readable_chinese(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")

        opened = manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        sent = manager.send_command("session-1", "whoami")
        interrupted = manager.interrupt_command("session-1")
        resized = manager.resize_session("session-1", 160, 48)
        health = manager.check_session_health("session-1")
        closed = manager.close_session("session-1")
        missing = manager.send_command("session-1", "whoami")

        messages = "\n".join(
            [
                opened["message"],
                sent["message"],
                interrupted["message"],
                resized["message"],
                health["message"],
                closed["message"],
                missing["message"],
            ]
        )
        self.assertIn("SSH 会话已连接", messages)
        self.assertIn("命令已发送", messages)
        self.assertIn("已发送 Ctrl+C 中断当前命令", messages)
        self.assertIn("SSH 终端尺寸已同步", messages)
        self.assertIn("SSH 会话正常", messages)
        self.assertIn("SSH 会话已关闭", messages)
        self.assertIn("SSH 会话不存在或已关闭", messages)
        broken_fragments = [
            "\u6d7c",
            "\u95b8",
            "\u93c9",
            "\u9420",
            "\u7039",
            "\u7f02",
            "\u95ba",
            "\ufffd",
        ]
        for broken_fragment in broken_fragments:
            self.assertNotIn(broken_fragment, messages)

    def test_opens_session_sends_command_reads_output_and_closes(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")

        opened = manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        sent = manager.send_command("session-1", "whoami")
        closed = manager.close_session("session-1")

        self.assertTrue(opened["ok"])
        self.assertEqual(opened["sessionId"], "session-1")
        self.assertIn("welcome", opened["output"])
        self.assertEqual(
            opened["hostKey"],
            {
                "type": "ssh-rsa",
                "sha256": "SHA256:" + base64.b64encode(hashlib.sha256(b"interactive-server-key").digest()).decode("ascii").rstrip("="),
            },
        )
        self.assertEqual(client.connected_with["hostname"], "10.0.1.23")
        self.assertEqual(client.connected_with["password"], "secret")
        self.assertEqual(client.term, "xterm-256color")
        self.assertEqual(client.width, 120)
        self.assertEqual(client.height, 32)
        self.assertEqual(client.transport.keepalive_interval, 30)
        self.assertEqual(client.channel.sent, ["whoami\r"])
        self.assertTrue(sent["ok"])
        self.assertIn("root", sent["output"])
        self.assertTrue(closed["ok"])
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_open_session_missing_auth_reports_auth_failure_kind(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")

        opened = manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "")

        self.assertFalse(opened["ok"])
        self.assertEqual(opened["failureKind"], "auth")
        self.assertIn("缺少凭据", opened["message"])
        self.assertEqual(manager.sessions, {})
        self.assertIsNone(client.connected_with)

    def test_open_session_empty_host_reports_config_failure_kind(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")

        opened = manager.open_session({"ip": "", "host": "", "port": "22", "user": "root"}, "secret")

        self.assertFalse(opened["ok"])
        self.assertEqual(opened["failureKind"], "config")
        self.assertIn("服务器地址为空", opened["message"])
        self.assertEqual(manager.sessions, {})
        self.assertIsNone(client.connected_with)

    def test_open_session_uses_configured_keepalive_interval(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")

        opened = manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root", "keepaliveSeconds": 45}, "secret")

        self.assertTrue(opened["ok"])
        self.assertEqual(client.transport.keepalive_interval, 45)

    def test_open_session_uses_requested_initial_terminal_size(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")

        opened = manager.open_session(
            {"ip": "10.0.1.23", "port": "22", "user": "root"},
            "secret",
            terminal_size={"cols": 188, "rows": 46},
        )

        self.assertTrue(opened["ok"])
        self.assertEqual(client.width, 188)
        self.assertEqual(client.height, 46)

    def test_open_session_enables_agent_forwarding_when_requested(self):
        client = FakeClient()
        paramiko = FakeParamiko(client)
        manager = SshSessionManager(paramiko_module=paramiko, id_factory=lambda: "session-1")

        opened = manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root", "forwardAgent": True}, "secret")
        closed = manager.close_session("session-1")

        self.assertTrue(opened["ok"])
        self.assertEqual([handler.channel for handler in paramiko.agent.handlers], [client.channel])
        self.assertTrue(paramiko.agent.handlers[0].closed)
        self.assertTrue(closed["ok"])

    def test_open_session_allows_large_desktop_terminal_size(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")

        opened = manager.open_session(
            {"ip": "10.0.1.23", "port": "22", "user": "root"},
            "secret",
            terminal_size={"cols": 320, "rows": 120},
        )

        self.assertTrue(opened["ok"])
        self.assertEqual(client.width, 320)
        self.assertEqual(client.height, 120)

    def test_opens_session_through_proxy_jump_and_closes_bastion(self):
        bastion = FakeClient()
        target = FakeClient()
        manager = SshSessionManager(paramiko_module=CyclingParamiko([target, bastion]), id_factory=lambda: "session-1")

        opened = manager.open_session(
            {"ip": "10.0.1.23", "port": "2222", "user": "root", "proxyJump": "jump@bastion.example.com:2200"},
            "secret",
        )
        closed = manager.close_session("session-1")

        self.assertTrue(opened["ok"])
        self.assertEqual(bastion.connected_with["hostname"], "bastion.example.com")
        self.assertNotIsInstance(bastion.policy, CyclingParamiko.AutoAddPolicy)
        self.assertEqual(bastion.transport.opened[0], ("direct-tcpip", ("10.0.1.23", 2222), ("127.0.0.1", 0)))
        self.assertIs(target.connected_with["sock"], bastion.transport.channel)
        self.assertTrue(closed["ok"])
        self.assertTrue(target.closed)
        self.assertTrue(bastion.closed)

    def test_open_session_enables_keepalive_on_proxy_jump_chain(self):
        bastion = FakeClient()
        target = FakeClient()
        manager = SshSessionManager(paramiko_module=CyclingParamiko([target, bastion]), id_factory=lambda: "session-1")

        opened = manager.open_session(
            {
                "ip": "10.0.1.23",
                "port": "2222",
                "user": "root",
                "proxyJump": "jump@bastion.example.com:2200",
                "keepaliveSeconds": 45,
            },
            "secret",
        )

        self.assertTrue(opened["ok"])
        self.assertEqual(target.transport.keepalive_interval, 45)
        self.assertEqual(bastion.transport.keepalive_interval, 45)

    def test_rejects_changed_trusted_host_key_before_opening_shell(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")

        opened = manager.open_session(
            {
                "ip": "10.0.1.23",
                "port": "22",
                "user": "root",
                "trustedHostKey": {"type": "ssh-rsa", "sha256": "SHA256:trusted-old"},
            },
            "secret",
        )

        self.assertFalse(opened["ok"])
        self.assertIn("主机指纹", opened["message"])
        self.assertIn("hostKey", opened)
        self.assertEqual(opened["trustedHostKey"], {"type": "ssh-rsa", "sha256": "SHA256:trusted-old"})
        self.assertEqual(opened["hostKeyTrust"]["status"], "changed")
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.closed)

    def test_open_session_returns_error_when_shell_creation_fails(self):
        client = FailingShellClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")

        opened = manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        self.assertFalse(opened["ok"])
        self.assertIn("shell failed", opened["message"])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.closed)

    def test_open_session_returns_structured_diagnostics_on_connect_failure(self):
        client = FailingConnectClient(RuntimeError("Connection refused"))
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")

        opened = manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        self.assertFalse(opened["ok"])
        self.assertEqual(opened["failureKind"], "refused")
        self.assertEqual(opened["sshFailure"]["kind"], "refused")
        self.assertEqual(opened["sshFailure"]["label"], "端口拒绝")
        self.assertIn("SSH 服务", opened["sshFailure"]["suggestions"][0])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.closed)

    def test_open_session_returns_error_when_shell_closes_during_initial_read(self):
        client = ClosedShellClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")

        opened = manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        self.assertFalse(opened["ok"])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_open_session_closes_shell_when_initial_output_read_fails(self):
        client = FailingRecvClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")

        opened = manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        self.assertFalse(opened["ok"])
        self.assertIn("recv failed", opened["message"])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_read_output_limits_one_poll_without_closing_active_session(self):
        client = StreamingOutputClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        client.channel.stream = b"a" * 300000

        result = manager.read_output("session-1", wait_seconds=0)

        self.assertTrue(result["ok"])
        self.assertEqual(len(result["output"]), 262144)
        self.assertTrue(result.get("hasMore"))
        self.assertIn("仍有输出", result["message"])
        self.assertEqual(len(client.channel.stream), 37856)
        self.assertIn("session-1", manager.sessions)
        self.assertFalse(client.channel.closed)

    def test_read_output_preserves_utf8_characters_split_across_polls(self):
        old_limit = ssh_interactive.DEFAULT_READ_OUTPUT_MAX_BYTES
        try:
            client = StreamingOutputClient()
            manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
            manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
            ssh_interactive.DEFAULT_READ_OUTPUT_MAX_BYTES = 2
            client.channel.stream = "中文".encode("utf-8")

            first = manager.read_output("session-1", wait_seconds=0)
            second = manager.read_output("session-1", wait_seconds=0)
            third = manager.read_output("session-1", wait_seconds=0)
        finally:
            ssh_interactive.DEFAULT_READ_OUTPUT_MAX_BYTES = old_limit

        self.assertTrue(first["ok"])
        self.assertTrue(second["ok"])
        self.assertTrue(third["ok"])
        self.assertEqual(first["output"], "")
        self.assertEqual(second["output"], "中")
        self.assertEqual(third["output"], "文")
        self.assertIn("session-1", manager.sessions)

    def test_missing_session_returns_error(self):
        manager = SshSessionManager(paramiko_module=FakeParamiko(FakeClient()))

        result = manager.send_command("missing", "whoami")

        self.assertFalse(result["ok"])
        self.assertIn("会话不存在", result["message"])

    def test_send_command_closes_broken_session_when_channel_send_fails(self):
        client = FailingSendClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        result = manager.send_command("session-1", "whoami")

        self.assertFalse(result["ok"])
        self.assertIn("channel closed", result["message"])
        self.assertEqual(result["output"], "")
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_send_command_closes_session_when_transport_is_inactive_before_send(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        client.transport.active = False

        result = manager.send_command("session-1", "whoami")

        self.assertFalse(result["ok"])
        self.assertEqual(result["output"], "")
        self.assertEqual(client.channel.sent, [])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_send_command_closes_session_when_transport_is_missing_before_send(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        opened = manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        self.assertTrue(opened["ok"])
        client.transport = None

        result = manager.send_command("session-1", "whoami")

        self.assertFalse(result["ok"])
        self.assertEqual(result["output"], "")
        self.assertEqual(client.channel.sent, [])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_send_command_retries_until_full_payload_is_written(self):
        client = PartialSendClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        result = manager.send_command("session-1", "printf abcdefghi")

        self.assertTrue(result["ok"])
        self.assertEqual("".join(client.channel.sent), "printf abcdefghi\r")

    def test_send_command_closes_broken_session_when_output_read_fails(self):
        client = FailingAfterInitialRecvClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        client.channel.fail_reads = True

        result = manager.send_command("session-1", "whoami")

        self.assertFalse(result["ok"])
        self.assertIn("recv failed", result["message"])
        self.assertEqual(result["output"], "")
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_interrupt_command_closes_broken_session_when_output_read_fails(self):
        client = FailingAfterInitialRecvClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        client.channel.fail_reads = True

        result = manager.interrupt_command("session-1")

        self.assertFalse(result["ok"])
        self.assertIn("recv failed", result["message"])
        self.assertEqual(result["output"], "")
        self.assertEqual(client.channel.sent, ["\x03"])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_interrupt_command_closes_broken_session_when_ctrl_c_send_fails(self):
        client = FailingSendClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        result = manager.interrupt_command("session-1")

        self.assertFalse(result["ok"])
        self.assertIn("channel closed", result["message"])
        self.assertEqual(result["output"], "")
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_interrupt_command_closes_session_when_transport_is_inactive_before_send(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        client.transport.active = False

        result = manager.interrupt_command("session-1")

        self.assertFalse(result["ok"])
        self.assertEqual(result["output"], "")
        self.assertEqual(client.channel.sent, [])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_interrupt_command_sends_ctrl_c_without_closing_session(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        result = manager.interrupt_command("session-1")

        self.assertTrue(result["ok"])
        self.assertEqual(client.channel.sent, ["\x03"])
        self.assertIn("中断", result["message"])
        self.assertIn("session-1", manager.sessions)
        self.assertFalse(client.channel.closed)
        self.assertFalse(client.closed)

    def test_send_input_can_write_raw_interactive_text_without_newline(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        result = manager.send_input("session-1", "q", submit=False)

        self.assertTrue(result["ok"])
        self.assertEqual(client.channel.sent, ["q"])
        self.assertIn("root", result["output"])
        self.assertIn("session-1", manager.sessions)

    def test_send_input_can_submit_interactive_text_with_terminal_enter(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        result = manager.send_input("session-1", "yes", submit=True)

        self.assertTrue(result["ok"])
        self.assertEqual(client.channel.sent, ["yes\r"])
        self.assertIn("session-1", manager.sessions)

    def test_send_input_allows_blank_terminal_enter(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        result = manager.send_input("session-1", "", submit=True)

        self.assertTrue(result["ok"])
        self.assertEqual(client.channel.sent, ["\r"])
        self.assertIn("session-1", manager.sessions)

    def test_send_input_uses_command_read_wait_when_submitting_enter(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        waits = []

        def capture_read_output(session_id, wait_seconds=0.1):
            waits.append(wait_seconds)
            return {"ok": True, "output": "root\n$ "}

        manager.read_output = capture_read_output

        result = manager.send_input("session-1", "uptime", submit=True)

        self.assertTrue(result["ok"])
        self.assertEqual(waits, [0.35])

    def test_send_input_does_not_block_terminal_keystrokes_with_command_wait(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        waits = []

        def capture_read_output(session_id, wait_seconds=0.1):
            waits.append(wait_seconds)
            return {"ok": True, "output": "q"}

        manager.read_output = capture_read_output

        result = manager.send_input("session-1", "q", submit=False)

        self.assertTrue(result["ok"])
        self.assertEqual(client.channel.sent, ["q"])
        self.assertLessEqual(waits[-1], 0.05)

    def test_send_input_retries_until_full_paste_payload_is_written(self):
        client = PartialSendClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        result = manager.send_input("session-1", "abcdefghi", submit=True)

        self.assertTrue(result["ok"])
        self.assertEqual("".join(client.channel.sent), "abcdefghi\r")
        self.assertIn("session-1", manager.sessions)

    def test_send_input_retries_unicode_payload_by_utf8_bytes(self):
        client = PartialSendClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        result = manager.send_input("session-1", "echo 中文路径", submit=True)

        self.assertTrue(result["ok"])
        self.assertEqual(b"".join(client.channel.sent_bytes), "echo 中文路径\r".encode("utf-8"))
        self.assertIn("session-1", manager.sessions)

    def test_send_input_closes_session_when_channel_was_already_closed(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        client.channel.closed = True

        result = manager.send_input("session-1", "uptime", submit=True)

        self.assertFalse(result["ok"])
        self.assertIn("断开", result["message"])
        self.assertEqual(result["output"], "")
        self.assertEqual(client.channel.sent, [])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_send_input_closes_session_when_transport_is_inactive_before_send(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        client.transport.active = False

        result = manager.send_input("session-1", "uptime", submit=True)

        self.assertFalse(result["ok"])
        self.assertEqual(result["output"], "")
        self.assertEqual(client.channel.sent, [])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_resizes_session_pty_like_desktop_ssh_tools(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        result = manager.resize_session("session-1", 180, 44)

        self.assertTrue(result["ok"])
        self.assertEqual(client.channel.resized_to, (180, 44))
        self.assertEqual(result["width"], 180)
        self.assertEqual(result["height"], 44)

    def test_resizes_session_pty_for_large_desktop_windows(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        result = manager.resize_session("session-1", 320, 120)

        self.assertTrue(result["ok"])
        self.assertEqual(client.channel.resized_to, (320, 120))
        self.assertEqual(result["width"], 320)
        self.assertEqual(result["height"], 120)

    def test_resize_session_closes_broken_session_when_pty_resize_fails(self):
        client = FailingResizeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        result = manager.resize_session("session-1", 180, 44)

        self.assertFalse(result["ok"])
        self.assertIn("resize failed", result["message"])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_resize_session_closes_session_when_transport_is_inactive_before_resize(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        client.transport.active = False

        result = manager.resize_session("session-1", 180, 44)

        self.assertFalse(result["ok"])
        self.assertIsNone(client.channel.resized_to)
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_checks_active_session_health(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        result = manager.check_session_health("session-1")

        self.assertTrue(result["ok"])
        self.assertTrue(result["active"])
        self.assertEqual(result["sessionId"], "session-1")

    def test_health_check_reports_session_keepalive_interval(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root", "keepaliveSeconds": 45}, "secret")

        result = manager.check_session_health("session-1")

        self.assertTrue(result["ok"])
        self.assertTrue(result["active"])
        self.assertEqual(result["keepaliveSeconds"], 45)

    def test_health_check_closes_inactive_session(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        client.transport.active = False

        result = manager.check_session_health("session-1")

        self.assertFalse(result["ok"])
        self.assertFalse(result["active"])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_health_check_closes_session_when_remote_shell_exited(self):
        client = ExitedShellClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")

        result = manager.check_session_health("session-1")

        self.assertFalse(result["ok"])
        self.assertFalse(result["active"])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_read_output_closes_session_when_remote_shell_exited(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        client.channel.exit_status_ready = lambda: True

        result = manager.read_output("session-1")

        self.assertFalse(result["ok"])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_read_output_closes_session_when_channel_is_closed(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        client.channel.closed = True

        result = manager.read_output("session-1")

        self.assertFalse(result["ok"])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_read_output_closes_session_when_transport_is_inactive(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        client.transport.active = False

        result = manager.read_output("session-1")

        self.assertFalse(result["ok"])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_read_output_closes_session_when_transport_is_missing(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        opened = manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        self.assertTrue(opened["ok"])
        client.transport = None

        result = manager.read_output("session-1")

        self.assertFalse(result["ok"])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_read_output_closes_session_when_recv_raises(self):
        client = FailingAfterInitialRecvClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        client.channel.fail_reads = True

        result = manager.read_output("session-1")

        self.assertFalse(result["ok"])
        self.assertIn("recv failed", result["message"])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)

    def test_read_output_closes_session_when_recv_returns_eof(self):
        client = FakeClient()
        manager = SshSessionManager(paramiko_module=FakeParamiko(client), id_factory=lambda: "session-1")
        manager.open_session({"ip": "10.0.1.23", "port": "22", "user": "root"}, "secret")
        client.channel.chunks = [b""]

        result = manager.read_output("session-1")

        self.assertFalse(result["ok"])
        self.assertEqual(manager.sessions, {})
        self.assertTrue(client.channel.closed)
        self.assertTrue(client.closed)


if __name__ == "__main__":
    unittest.main()
