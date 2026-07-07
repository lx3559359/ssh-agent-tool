import unittest

from port_forward import LocalPortForward, PortForwardManager, validate_forward_config
from ssh_session import HostKeyVerificationError


class FakeForward:
    instances = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.started = False
        self.stopped = False
        FakeForward.instances.append(self)

    def start(self):
        self.started = True
        return {"localPort": self.kwargs["config"]["localPort"]}

    def stop(self):
        self.stopped = True


class HostKeyFailureForward(FakeForward):
    def start(self):
        raise HostKeyVerificationError(
            "主机指纹变更，已阻止连接。",
            {"type": "ssh-ed25519", "sha256": "SHA256:new"},
            {"type": "ssh-ed25519", "sha256": "SHA256:old"},
        )


class StartFailureForward(FakeForward):
    def start(self):
        self.started = True
        raise RuntimeError("bind failed after partial startup")


class StopFailureForward(FakeForward):
    def stop(self):
        self.stopped = True
        raise RuntimeError("listener close failed")


class FakeSshClient:
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

    def close(self):
        self.closed = True

    def get_transport(self):
        return self.transport


class FakeTransport:
    def __init__(self):
        self.channel = object()
        self.opened = []

    def get_remote_server_key(self):
        return FakeRemoteKey()

    def open_channel(self, kind, destination, source):
        self.opened.append((kind, destination, source))
        return self.channel


class FakeRemoteKey:
    def get_name(self):
        return "ssh-ed25519"

    def asbytes(self):
        return b"port-forward-server-key"


class FakeParamiko:
    class AutoAddPolicy:
        pass

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


class PortForwardTests(unittest.TestCase):
    def setUp(self):
        FakeForward.instances = []

    def test_validate_forward_config_defaults_to_localhost_and_normalizes_ports(self):
        result = validate_forward_config({"localPort": "18080", "remoteHost": "127.0.0.1", "remotePort": "80"})

        self.assertTrue(result["ok"])
        self.assertEqual(result["config"]["localHost"], "127.0.0.1")
        self.assertEqual(result["config"]["localPort"], 18080)
        self.assertEqual(result["config"]["remotePort"], 80)

    def test_validate_forward_config_rejects_invalid_ports_and_remote_host(self):
        result = validate_forward_config({"localPort": "0", "remoteHost": "", "remotePort": "99999"})

        self.assertFalse(result["ok"])
        self.assertIn("远程地址", result["message"])

    def test_manager_starts_and_stops_forward(self):
        manager = PortForwardManager(forward_factory=FakeForward, id_factory=lambda: "pf-1")

        result = manager.start_forward(
            {"ip": "10.0.1.23", "port": "22", "user": "root"},
            "secret",
            {"authType": "密码"},
            {"localPort": "18080", "remoteHost": "127.0.0.1", "remotePort": "80"},
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["forward"]["id"], "pf-1")
        self.assertTrue(FakeForward.instances[0].started)
        self.assertEqual(len(manager.list_forwards()["forwards"]), 1)

        stopped = manager.stop_forward("pf-1")

        self.assertTrue(stopped["ok"])
        self.assertTrue(FakeForward.instances[0].stopped)
        self.assertEqual(manager.list_forwards()["forwards"], [])

    def test_manager_rejects_duplicate_local_endpoint(self):
        manager = PortForwardManager(forward_factory=FakeForward, id_factory=lambda: f"pf-{len(FakeForward.instances) + 1}")
        config = {"localPort": "18080", "remoteHost": "127.0.0.1", "remotePort": "80"}

        first = manager.start_forward({"ip": "10.0.1.23"}, "secret", {}, config)
        second = manager.start_forward({"ip": "10.0.1.23"}, "secret", {}, config)

        self.assertTrue(first["ok"])
        self.assertFalse(second["ok"])
        self.assertIn("本地端口已在转发", second["message"])

    def test_manager_requires_credential(self):
        manager = PortForwardManager(forward_factory=FakeForward)

        result = manager.start_forward({"ip": "10.0.1.23"}, "", {}, {"localPort": "18080", "remoteHost": "127.0.0.1", "remotePort": "80"})

        self.assertFalse(result["ok"])
        self.assertIn("缺少凭据", result["message"])

    def test_manager_accepts_identity_file_without_secret(self):
        manager = PortForwardManager(forward_factory=FakeForward, id_factory=lambda: "pf-identity")

        result = manager.start_forward(
            {"ip": "10.0.1.23"},
            "",
            {"authType": "私钥", "identityFile": "~/.ssh/prod"},
            {"localPort": "18080", "remoteHost": "127.0.0.1", "remotePort": "80"},
        )

        self.assertTrue(result["ok"])
        self.assertEqual(FakeForward.instances[0].kwargs["credential_metadata"]["identityFile"], "~/.ssh/prod")

    def test_manager_accepts_ssh_agent_without_secret(self):
        manager = PortForwardManager(forward_factory=FakeForward, id_factory=lambda: "pf-agent")

        result = manager.start_forward(
            {"ip": "10.0.1.23"},
            "",
            {"authType": "SSH Agent"},
            {"localPort": "18080", "remoteHost": "127.0.0.1", "remotePort": "80"},
        )

        self.assertTrue(result["ok"])
        self.assertEqual(FakeForward.instances[0].kwargs["credential_metadata"]["authType"], "SSH Agent")

    def test_manager_returns_structured_host_key_error(self):
        manager = PortForwardManager(forward_factory=HostKeyFailureForward, id_factory=lambda: "pf-hostkey")

        result = manager.start_forward(
            {"ip": "10.0.1.23"},
            "secret",
            {"authType": "password"},
            {"localPort": "18080", "remoteHost": "127.0.0.1", "remotePort": "80"},
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["hostKey"], {"type": "ssh-ed25519", "sha256": "SHA256:new"})
        self.assertEqual(result["trustedHostKey"], {"type": "ssh-ed25519", "sha256": "SHA256:old"})
        self.assertEqual(result["hostKeyTrust"]["status"], "changed")
        self.assertEqual(manager.list_forwards()["forwards"], [])

    def test_manager_stops_partial_forward_when_start_fails(self):
        manager = PortForwardManager(forward_factory=StartFailureForward, id_factory=lambda: "pf-fail")

        result = manager.start_forward(
            {"ip": "10.0.1.23"},
            "secret",
            {"authType": "password"},
            {"localPort": "18080", "remoteHost": "127.0.0.1", "remotePort": "80"},
        )

        self.assertFalse(result["ok"])
        self.assertIn("bind failed", result["message"])
        self.assertTrue(FakeForward.instances[0].stopped)
        self.assertEqual(manager.list_forwards()["forwards"], [])

    def test_manager_keeps_forward_record_when_stop_fails(self):
        manager = PortForwardManager(forward_factory=StopFailureForward, id_factory=lambda: "pf-stop-fail")

        started = manager.start_forward(
            {"ip": "10.0.1.23"},
            "secret",
            {"authType": "password"},
            {"localPort": "18080", "remoteHost": "127.0.0.1", "remotePort": "80"},
        )

        result = manager.stop_forward("pf-stop-fail")

        self.assertTrue(started["ok"])
        self.assertFalse(result["ok"])
        self.assertIn("listener close failed", result["message"])
        self.assertTrue(FakeForward.instances[0].stopped)
        self.assertEqual([item["id"] for item in manager.list_forwards()["forwards"]], ["pf-stop-fail"])

    def test_local_forward_uses_server_connection_timeout(self):
        client = FakeSshClient()
        forward = LocalPortForward(
            forward_id="pf-1",
            server={"ip": "10.0.1.23", "port": "22", "user": "root", "timeoutSeconds": "28"},
            secret="secret",
            credential_metadata={"authType": "password"},
            config={"localHost": "127.0.0.1", "localPort": 0, "remoteHost": "127.0.0.1", "remotePort": 80},
            paramiko_module=FakeParamiko(client),
        )

        try:
            forward.start()
        finally:
            forward.stop()

        self.assertEqual(client.connected_with["timeout"], 28)

    def test_local_forward_connects_through_proxy_jump(self):
        bastion = FakeSshClient()
        target = FakeSshClient()
        forward = LocalPortForward(
            forward_id="pf-1",
            server={"ip": "10.0.1.23", "port": "2222", "user": "root", "proxyJump": "jump@bastion.example.com:2200"},
            secret="secret",
            credential_metadata={"authType": "password"},
            config={"localHost": "127.0.0.1", "localPort": 0, "remoteHost": "127.0.0.1", "remotePort": 80},
            paramiko_module=CyclingParamiko([target, bastion]),
        )

        try:
            forward.start()
        finally:
            forward.stop()

        self.assertEqual(bastion.connected_with["hostname"], "bastion.example.com")
        self.assertEqual(bastion.transport.opened[0], ("direct-tcpip", ("10.0.1.23", 2222), ("127.0.0.1", 0)))
        self.assertIs(target.connected_with["sock"], bastion.transport.channel)
        self.assertTrue(target.closed)
        self.assertTrue(bastion.closed)

    def test_local_forward_rejects_changed_trusted_host_key_before_listening(self):
        client = FakeSshClient()
        forward = LocalPortForward(
            forward_id="pf-1",
            server={
                "ip": "10.0.1.23",
                "port": "22",
                "user": "root",
                "trustedHostKey": {"type": "ssh-ed25519", "sha256": "SHA256:trusted-old"},
            },
            secret="secret",
            credential_metadata={"authType": "password"},
            config={"localHost": "127.0.0.1", "localPort": 0, "remoteHost": "127.0.0.1", "remotePort": 80},
            paramiko_module=FakeParamiko(client),
        )

        with self.assertRaisesRegex(ValueError, "主机指纹"):
            forward.start()

        self.assertTrue(client.closed)
        self.assertIsNone(forward.listener)

    def test_local_forward_reports_unknown_host_key_before_listening(self):
        client = FakeSshClient()
        client.reject_before_auth = True
        forward = LocalPortForward(
            forward_id="pf-1",
            server={"ip": "10.0.1.23", "port": "22", "user": "root"},
            secret="secret",
            credential_metadata={"authType": "password"},
            config={"localHost": "127.0.0.1", "localPort": 0, "remoteHost": "127.0.0.1", "remotePort": 80},
            paramiko_module=FakeParamiko(client),
        )

        with self.assertRaises(HostKeyVerificationError) as raised:
            forward.start()

        self.assertIsNone(client.connected_with)
        self.assertNotIsInstance(client.policy, FakeParamiko.AutoAddPolicy)
        self.assertEqual(raised.exception.host_key_trust["status"], "unknown")
        self.assertTrue(client.closed)
        self.assertIsNone(forward.listener)


if __name__ == "__main__":
    unittest.main()
