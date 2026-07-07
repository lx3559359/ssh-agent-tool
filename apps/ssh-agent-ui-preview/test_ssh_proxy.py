import unittest

from ssh_proxy import connect_ssh_client


class FakeTransport:
    def __init__(self, channel):
        self.channel = channel
        self.opened = []

    def open_channel(self, kind, destination, source):
        self.opened.append((kind, destination, source))
        return self.channel


class FakeClient:
    def __init__(self, name):
        self.name = name
        self.connected_with = None
        self.connect_calls = []
        self.closed = False
        self.transport = FakeTransport(f"channel:{name}")

    def set_missing_host_key_policy(self, policy):
        self.policy = policy

    def connect(self, **kwargs):
        self.connect_calls.append(kwargs)
        self.connected_with = kwargs

    def get_transport(self):
        return self.transport

    def close(self):
        self.closed = True


class FakeParamiko:
    class AutoAddPolicy:
        pass

    def __init__(self, clients):
        self.clients = list(clients)
        self.index = 0

    def SSHClient(self):
        client = self.clients[self.index]
        self.index += 1
        return client


class FlakyClient(FakeClient):
    def __init__(self, name, failures=1):
        super().__init__(name)
        self.failures = failures

    def connect(self, **kwargs):
        super().connect(**kwargs)
        if self.failures > 0:
            self.failures -= 1
            raise TimeoutError("temporary timeout")


class SshProxyTests(unittest.TestCase):
    def test_host_key_alias_connects_real_target_but_verifies_alias(self):
        target = FakeClient("target")
        sockets = []

        def socket_factory(address, timeout=None):
            sock = {"address": address, "timeout": timeout}
            sockets.append(sock)
            return sock

        proxy_chain = connect_ssh_client(
            FakeParamiko([]),
            target,
            {
                "ip": "10.0.1.23",
                "port": "2222",
                "user": "root",
                "hostKeyAlias": "prod-web.internal",
            },
            "secret",
            {},
            15,
            socket_factory=socket_factory,
        )

        self.assertIsNone(proxy_chain)
        self.assertEqual(sockets, [{"address": ("10.0.1.23", 2222), "timeout": 15}])
        self.assertEqual(target.connected_with["hostname"], "prod-web.internal")
        self.assertEqual(target.connected_with["port"], 2222)
        self.assertIs(target.connected_with["sock"], sockets[0])

    def test_connects_target_through_multiple_proxy_jumps(self):
        target = FakeClient("target")
        jump1 = FakeClient("jump1")
        jump2 = FakeClient("jump2")

        proxy_chain = connect_ssh_client(
            FakeParamiko([jump1, jump2]),
            target,
            {
                "ip": "10.0.1.23",
                "port": "2222",
                "user": "root",
                "proxyJump": "ops@bastion-1.example.com:2201,deploy@bastion-2.example.com:2202",
            },
            "secret",
            {},
            15,
        )

        self.assertEqual(jump1.connected_with["hostname"], "bastion-1.example.com")
        self.assertEqual(jump1.connected_with["port"], 2201)
        self.assertEqual(jump1.connected_with["username"], "ops")
        self.assertNotIn("sock", jump1.connected_with)

        self.assertEqual(jump1.transport.opened[0], ("direct-tcpip", ("bastion-2.example.com", 2202), ("127.0.0.1", 0)))
        self.assertIs(jump2.connected_with["sock"], jump1.transport.channel)
        self.assertEqual(jump2.connected_with["hostname"], "bastion-2.example.com")
        self.assertEqual(jump2.connected_with["username"], "deploy")

        self.assertEqual(jump2.transport.opened[0], ("direct-tcpip", ("10.0.1.23", 2222), ("127.0.0.1", 0)))
        self.assertIs(target.connected_with["sock"], jump2.transport.channel)
        self.assertEqual(target.connected_with["hostname"], "10.0.1.23")
        self.assertEqual(target.connected_with["port"], 2222)

        proxy_chain.close()

        self.assertTrue(jump1.closed)
        self.assertTrue(jump2.closed)

    def test_host_key_alias_with_proxy_keeps_direct_tcpip_destination_real(self):
        target = FakeClient("target")
        jump = FakeClient("jump")

        connect_ssh_client(
            FakeParamiko([jump]),
            target,
            {
                "ip": "10.0.1.23",
                "port": "2222",
                "user": "root",
                "proxyJump": "ops@bastion.example.com:2201",
                "hostKeyAlias": "prod-web.internal",
            },
            "secret",
            {},
            15,
        )

        self.assertEqual(jump.transport.opened[0], ("direct-tcpip", ("10.0.1.23", 2222), ("127.0.0.1", 0)))
        self.assertIs(target.connected_with["sock"], jump.transport.channel)
        self.assertEqual(target.connected_with["hostname"], "prod-web.internal")

    def test_proxy_jump_clients_use_injected_host_key_policy(self):
        target = FakeClient("target")
        jump1 = FakeClient("jump1")
        jump2 = FakeClient("jump2")
        configured = []

        class StrictPolicy:
            pass

        def configure_host_key_policy(client, host_entry):
            configured.append((client.name, host_entry.host, host_entry.port))
            client.set_missing_host_key_policy(StrictPolicy())

        connect_ssh_client(
            FakeParamiko([jump1, jump2]),
            target,
            {
                "ip": "10.0.1.23",
                "port": "2222",
                "user": "root",
                "proxyJump": "ops@bastion-1.example.com:2201,deploy@bastion-2.example.com:2202",
            },
            "secret",
            {},
            15,
            configure_proxy_host_key_policy=configure_host_key_policy,
        )

        self.assertEqual(
            configured,
            [
                ("jump1", "bastion-1.example.com", 2201),
                ("jump2", "bastion-2.example.com", 2202),
            ],
        )
        self.assertIsInstance(jump1.policy, StrictPolicy)
        self.assertIsInstance(jump2.policy, StrictPolicy)
        self.assertNotIsInstance(jump1.policy, FakeParamiko.AutoAddPolicy)
        self.assertNotIsInstance(jump2.policy, FakeParamiko.AutoAddPolicy)

    def test_retries_target_connection_for_transient_failures(self):
        target = FlakyClient("target", failures=1)

        proxy_chain = connect_ssh_client(
            FakeParamiko([]),
            target,
            {"ip": "10.0.1.23", "port": "2222", "user": "root", "retryCount": "1"},
            "secret",
            {"authType": "密码"},
            15,
        )

        self.assertIsNone(proxy_chain)
        self.assertEqual(len(target.connect_calls), 2)
        self.assertEqual(target.connected_with["hostname"], "10.0.1.23")
        self.assertEqual(target.connected_with["port"], 2222)


if __name__ == "__main__":
    unittest.main()
