import socket
import unittest

from ssh_probe import probe_ssh_endpoint


class FakeSocket:
    def __init__(self, payload=b""):
        self.payload = payload
        self.timeout = None
        self.closed = False

    def settimeout(self, timeout):
        self.timeout = timeout

    def recv(self, size):
        return self.payload[:size]

    def close(self):
        self.closed = True


class SshProbeTests(unittest.TestCase):
    def test_reports_online_when_ssh_banner_is_received(self):
        fake_socket = FakeSocket(b"SSH-2.0-OpenSSH_9.6\r\n")

        result = probe_ssh_endpoint(
            "10.0.1.23",
            "22",
            timeout=1,
            socket_factory=lambda address, timeout: fake_socket,
            clock=iter([100.0, 100.024]).__next__,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["state"], "在线")
        self.assertEqual(result["tone"], "green")
        self.assertEqual(result["latency"], "24ms")
        self.assertEqual(result["banner"], "SSH-2.0-OpenSSH_9.6")
        self.assertIn("SSH 服务可达", result["message"])

    def test_reports_warning_when_port_is_not_ssh(self):
        result = probe_ssh_endpoint(
            "10.0.1.23",
            22,
            socket_factory=lambda address, timeout: FakeSocket(b"HTTP/1.1 200 OK\r\n"),
            clock=iter([100.0, 100.01]).__next__,
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "异常")
        self.assertEqual(result["tone"], "amber")
        self.assertIn("不是 SSH 服务", result["message"])

    def test_reports_offline_when_connection_fails(self):
        def fail_connect(address, timeout):
            raise socket.timeout("timed out")

        result = probe_ssh_endpoint(
            "10.0.1.23",
            22,
            socket_factory=fail_connect,
            clock=iter([100.0, 102.0]).__next__,
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "离线")
        self.assertEqual(result["tone"], "gray")
        self.assertEqual(result["latency"], "--")
        self.assertIn("连接失败", result["message"])


if __name__ == "__main__":
    unittest.main()
