import unittest
from unittest.mock import patch

import desktop_app
from desktop_app import DesktopApi


class FakeCredentialStore:
    def read_secret(self, credential_ref):
        return "secret"

    def read_metadata(self, credential_ref):
        return {"authType": "密码"}


class FakePortForwardManager:
    def __init__(self):
        self.started = []
        self.stopped = []

    def start_forward(self, server, secret, metadata, config):
        self.started.append((server, secret, metadata, config))
        return {"ok": True, "forward": {"id": "pf-1"}, "message": "started"}

    def stop_forward(self, forward_id):
        self.stopped.append(forward_id)
        return {"ok": True, "message": "stopped"}

    def list_forwards(self):
        return {"ok": True, "forwards": [{"id": "pf-1"}]}


class DesktopPortForwardApiTests(unittest.TestCase):
    def test_start_port_forward_reads_encrypted_credential(self):
        manager = FakePortForwardManager()
        with patch.object(desktop_app, "CredentialStore", lambda *_args: FakeCredentialStore()):
            with patch.object(desktop_app, "PortForwardManager", lambda: manager):
                api = DesktopApi()
                result = api.start_port_forward(
                    {"ip": "10.0.1.23", "user": "root"},
                    "sshcred-1",
                    {"localPort": "18080", "remoteHost": "127.0.0.1", "remotePort": "80"},
                )

        self.assertTrue(result["ok"])
        self.assertEqual(manager.started[0][1], "secret")
        self.assertEqual(manager.started[0][2]["authType"], "密码")

    def test_stop_and_list_port_forwards_delegate_to_manager(self):
        manager = FakePortForwardManager()
        with patch.object(desktop_app, "PortForwardManager", lambda: manager):
            api = DesktopApi()

            listed = api.list_port_forwards()
            stopped = api.stop_port_forward("pf-1")

        self.assertEqual(listed["forwards"][0]["id"], "pf-1")
        self.assertTrue(stopped["ok"])
        self.assertEqual(manager.stopped, ["pf-1"])


if __name__ == "__main__":
    unittest.main()
