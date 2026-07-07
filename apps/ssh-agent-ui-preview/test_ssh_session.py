import base64
import hashlib
import unittest

from ssh_session import classify_ssh_error, format_host_key_fingerprint, run_readonly_command


class FakeStream:
    def __init__(self, text):
        self.text = text

    def read(self):
        return self.text.encode("utf-8")


class FakeClient:
    def __init__(self):
        self.connected_with = None
        self.closed = False
        self.transport = FakeTransport()

    def set_missing_host_key_policy(self, policy):
        self.policy = policy

    def connect(self, **kwargs):
        if getattr(self, "reject_before_auth", False) and hasattr(getattr(self, "policy", None), "missing_host_key"):
            self.policy.missing_host_key(self, kwargs.get("hostname"), FakeRemoteKey())
        self.connected_with = kwargs

    def exec_command(self, command, timeout=10):
        self.command = command
        return None, FakeStream("root\n"), FakeStream("")

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


class FakeKey:
    name = "ed25519"


class FakeRemoteKey:
    def get_name(self):
        return "ssh-ed25519"

    def asbytes(self):
        return b"server-key"


class FakeTransport:
    def __init__(self):
        self.channel = object()
        self.opened = []

    def get_remote_server_key(self):
        return FakeRemoteKey()

    def open_channel(self, kind, destination, source):
        self.opened.append((kind, destination, source))
        return self.channel


class FakeParamiko:
    class AutoAddPolicy:
        pass

    class Ed25519Key:
        @staticmethod
        def from_private_key(handle):
            if "OPENSSH PRIVATE KEY" not in handle.read():
                raise ValueError("invalid key")
            return FakeKey()

    def __init__(self, client):
        self.client = client

    def SSHClient(self):
        return self.client


class CyclingParamiko:
    class AutoAddPolicy:
        pass

    def __init__(self, clients):
        self.clients = list(clients)
        self.index = 0

    def SSHClient(self):
        client = self.clients[self.index]
        self.index += 1
        return client


class SshSessionTests(unittest.TestCase):
    def test_classifies_common_ssh_errors_for_client_diagnostics(self):
        cases = [
            (OSError("No route to host"), "timeout", None),
            (RuntimeError("UNPROTECTED PRIVATE KEY FILE! Permissions are too open"), "key-file", None),
            (TimeoutError("timed out"), "timeout", "网络超时"),
            (RuntimeError("Authentication failed."), "auth", "认证失败"),
            (RuntimeError("[Errno 11001] getaddrinfo failed"), "dns", "DNS 解析失败"),
            (ConnectionRefusedError("Connection refused"), "refused", "端口拒绝"),
            (RuntimeError("kex_exchange_identification: Connection reset by peer"), "handshake", "握手失败"),
            (RuntimeError("no matching host key type found. Their offer: ssh-rsa"), "algorithm", "算法不兼容"),
        ]

        for error, expected_kind, expected_label in cases:
            with self.subTest(expected_kind=expected_kind):
                diagnostic = classify_ssh_error(error)

            self.assertEqual(diagnostic["kind"], expected_kind)
            if expected_label is not None:
                self.assertEqual(diagnostic["label"], expected_label)
            self.assertTrue(diagnostic["suggestions"])

    def test_readonly_command_returns_structured_diagnostics_on_connect_failure(self):
        client = FailingConnectClient(TimeoutError("timed out"))

        result = run_readonly_command(
            server={"ip": "10.0.1.23", "port": "22", "user": "root"},
            password="secret",
            command="whoami",
            paramiko_module=FakeParamiko(client),
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["failureKind"], "timeout")
        self.assertEqual(result["sshFailure"]["kind"], "timeout")
        self.assertEqual(result["sshFailure"]["label"], "网络超时")
        self.assertIn("检查网络连通性", result["sshFailure"]["suggestions"][0])
        self.assertTrue(client.closed)

    def test_runs_readonly_command_with_password(self):
        client = FakeClient()

        result = run_readonly_command(
            server={"ip": "10.0.1.23", "port": "22", "user": "root"},
            password="secret",
            command="whoami",
            paramiko_module=FakeParamiko(client),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["stdout"], "root\n")
        self.assertEqual(result["stderr"], "")
        self.assertEqual(result["command"], "whoami")
        self.assertEqual(client.connected_with["hostname"], "10.0.1.23")
        self.assertEqual(client.connected_with["username"], "root")
        self.assertEqual(client.connected_with["password"], "secret")
        self.assertEqual(
            result["hostKey"],
            {
                "type": "ssh-ed25519",
                "sha256": "SHA256:" + base64.b64encode(hashlib.sha256(b"server-key").digest()).decode("ascii").rstrip("="),
            },
        )
        self.assertTrue(client.closed)

    def test_runs_readonly_command_with_private_key(self):
        client = FakeClient()

        result = run_readonly_command(
            server={"ip": "10.0.1.23", "port": "22", "user": "root"},
            password="-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
            command="whoami",
            paramiko_module=FakeParamiko(client),
            credential_metadata={"authType": "私钥"},
        )

        self.assertTrue(result["ok"])
        self.assertEqual(client.connected_with["pkey"].name, "ed25519")
        self.assertNotIn("password", client.connected_with)

    def test_runs_readonly_command_through_proxy_jump(self):
        bastion = FakeClient()
        target = FakeClient()

        result = run_readonly_command(
            server={"ip": "10.0.1.23", "port": "2222", "user": "root", "proxyJump": "jump@bastion.example.com:2200"},
            password="secret",
            command="whoami",
            paramiko_module=CyclingParamiko([target, bastion]),
        )

        self.assertTrue(result["ok"])
        self.assertEqual(bastion.connected_with["hostname"], "bastion.example.com")
        self.assertEqual(bastion.connected_with["port"], 2200)
        self.assertEqual(bastion.connected_with["username"], "jump")
        self.assertEqual(bastion.transport.opened[0], ("direct-tcpip", ("10.0.1.23", 2222), ("127.0.0.1", 0)))
        self.assertIs(target.connected_with["sock"], bastion.transport.channel)
        self.assertEqual(target.connected_with["hostname"], "10.0.1.23")
        self.assertTrue(target.closed)
        self.assertTrue(bastion.closed)

    def test_rejects_changed_trusted_host_key_before_running_command(self):
        client = FakeClient()

        result = run_readonly_command(
            server={
                "ip": "10.0.1.23",
                "port": "22",
                "user": "root",
                "trustedHostKey": {"type": "ssh-ed25519", "sha256": "SHA256:trusted-old"},
            },
            password="secret",
            command="whoami",
            paramiko_module=FakeParamiko(client),
        )

        self.assertFalse(result["ok"])
        self.assertIn("主机指纹", result["message"])
        self.assertEqual(
            result["hostKey"],
            {
                "type": "ssh-ed25519",
                "sha256": "SHA256:" + base64.b64encode(hashlib.sha256(b"server-key").digest()).decode("ascii").rstrip("="),
            },
        )
        self.assertEqual(result["trustedHostKey"], {"type": "ssh-ed25519", "sha256": "SHA256:trusted-old"})
        self.assertEqual(result["hostKeyTrust"]["status"], "changed")
        self.assertFalse(hasattr(client, "command"))
        self.assertTrue(client.closed)

    def test_installs_trusted_host_key_policy_before_authentication(self):
        client = FakeClient()
        client.reject_before_auth = True

        result = run_readonly_command(
            server={
                "ip": "10.0.1.23",
                "port": "22",
                "user": "root",
                "trustedHostKey": {"type": "ssh-ed25519", "sha256": "SHA256:trusted-old"},
            },
            password="secret",
            command="whoami",
            paramiko_module=FakeParamiko(client),
        )

        self.assertFalse(result["ok"])
        self.assertIsNone(client.connected_with)
        self.assertNotIsInstance(client.policy, FakeParamiko.AutoAddPolicy)
        self.assertEqual(result["hostKey"]["type"], "ssh-ed25519")
        self.assertEqual(result["hostKeyTrust"]["status"], "changed")
        self.assertTrue(client.closed)

    def test_unknown_host_key_is_reported_before_authentication(self):
        client = FakeClient()
        client.reject_before_auth = True

        result = run_readonly_command(
            server={"ip": "10.0.1.23", "port": "22", "user": "root"},
            password="secret",
            command="whoami",
            paramiko_module=FakeParamiko(client),
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["failureKind"], "host-key")
        self.assertIsNone(client.connected_with)
        self.assertNotIsInstance(client.policy, FakeParamiko.AutoAddPolicy)
        self.assertEqual(
            result["hostKey"],
            {
                "type": "ssh-ed25519",
                "sha256": "SHA256:" + base64.b64encode(hashlib.sha256(b"server-key").digest()).decode("ascii").rstrip("="),
            },
        )
        self.assertEqual(result["trustedHostKey"], {})
        self.assertEqual(result["hostKeyTrust"]["status"], "unknown")
        self.assertTrue(client.closed)

    def test_proxy_jump_unknown_host_key_is_labeled_as_proxy_context(self):
        target = FakeClient()
        bastion = FakeClient()
        bastion.reject_before_auth = True

        result = run_readonly_command(
            server={
                "ip": "10.0.1.23",
                "port": "2222",
                "user": "root",
                "proxyJump": "jump@bastion.example.com:2200",
            },
            password="secret",
            command="whoami",
            paramiko_module=CyclingParamiko([target, bastion]),
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["failureKind"], "host-key")
        self.assertEqual(result["hostKeyTrust"]["status"], "unknown")
        self.assertEqual(
            result["hostKeyContext"],
            {"role": "proxy-jump", "host": "bastion.example.com", "port": 2200},
        )
        self.assertIsNone(target.connected_with)
        self.assertIsNone(bastion.connected_with)
        self.assertTrue(bastion.closed)

    def test_blocks_dangerous_command(self):
        result = run_readonly_command(
            server={"ip": "10.0.1.23", "port": "22", "user": "root"},
            password="secret",
            command="rm -rf /",
            paramiko_module=FakeParamiko(FakeClient()),
        )

        self.assertFalse(result["ok"])
        self.assertIn("已拦截", result["message"])

    def test_requires_credential(self):
        result = run_readonly_command(
            server={"ip": "10.0.1.23", "port": "22", "user": "root"},
            password="",
            command="uptime",
            paramiko_module=FakeParamiko(FakeClient()),
        )

        self.assertFalse(result["ok"])
        self.assertIn("缺少凭据", result["message"])

    def test_formats_missing_host_key_safely(self):
        self.assertEqual(format_host_key_fingerprint(None), {})


if __name__ == "__main__":
    unittest.main()
