import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import desktop_app
from desktop_app import DesktopApi
from ssh_config_import import parse_ssh_config


class SshConfigImportTests(unittest.TestCase):
    def test_parse_ssh_config_imports_concrete_hosts_and_skips_patterns(self):
        config = """
Host *
  User ignored

Host prod-web web-short
  HostName 10.0.1.23
  User root
  Port 2222
  IdentityFile ~/.ssh/prod_web_ed25519
  ConnectTimeout 25
  ConnectionAttempts 4
  ServerAliveInterval 45
  ServerAliveCountMax 6
  ForwardAgent yes
  ProxyJump bastion
  HostKeyAlias prod-web.internal
  LocalForward 127.0.0.1:18080 127.0.0.1:80
  LocalForward 15432 db.internal:5432
  RemoteForward 127.0.0.1:22022 127.0.0.1:22
  DynamicForward 127.0.0.1:1080

Host *.internal
  User deploy

Host bastion
  User ubuntu
"""

        result = parse_ssh_config(config)

        self.assertTrue(result["ok"])
        self.assertEqual([host["name"] for host in result["hosts"]], ["prod-web", "web-short", "bastion"])
        self.assertEqual(result["hosts"][0]["host"], "10.0.1.23")
        self.assertEqual(result["hosts"][0]["user"], "root")
        self.assertEqual(result["hosts"][0]["port"], "2222")
        self.assertEqual(result["hosts"][0]["identityFile"], "~/.ssh/prod_web_ed25519")
        self.assertEqual(result["hosts"][0]["connectTimeout"], "25")
        self.assertEqual(result["hosts"][0]["connectionAttempts"], "4")
        self.assertEqual(result["hosts"][0]["serverAliveInterval"], "45")
        self.assertEqual(result["hosts"][0]["serverAliveCountMax"], "6")
        self.assertEqual(result["hosts"][0]["forwardAgent"], "yes")
        self.assertEqual(result["hosts"][0]["proxyJump"], "bastion")
        self.assertEqual(result["hosts"][0]["hostKeyAlias"], "prod-web.internal")
        self.assertEqual(
            result["hosts"][0]["localForwards"],
            [
                {
                    "localHost": "127.0.0.1",
                    "localPort": "18080",
                    "remoteHost": "127.0.0.1",
                    "remotePort": "80",
                },
                {
                    "localHost": "127.0.0.1",
                    "localPort": "15432",
                    "remoteHost": "db.internal",
                    "remotePort": "5432",
                },
            ],
        )
        self.assertEqual(
            result["hosts"][0]["remoteForwards"],
            [
                {
                    "remoteHost": "127.0.0.1",
                    "remotePort": "22022",
                    "localHost": "127.0.0.1",
                    "localPort": "22",
                },
            ],
        )
        self.assertEqual(result["hosts"][0]["dynamicForwards"], [{"bindHost": "127.0.0.1", "bindPort": "1080"}])
        self.assertEqual(result["hosts"][2]["host"], "bastion")
        self.assertEqual(result["skipped"], 2)

    def test_desktop_api_reads_selected_ssh_config_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config"
            config_path.write_text("Host db\n  HostName 10.0.1.31\n  User mysql\n", encoding="utf-8")

            class FakeWindow:
                def create_file_dialog(self, *_args, **_kwargs):
                    return [str(config_path)]

            fake_webview = type("FakeWebview", (), {"OPEN_DIALOG": object(), "windows": [FakeWindow()]})

            with patch.dict("sys.modules", {"webview": fake_webview}):
                result = DesktopApi().open_ssh_config_file()

        self.assertTrue(result["ok"])
        self.assertEqual(result["path"], str(config_path))
        self.assertEqual(result["hosts"][0]["name"], "db")
        self.assertEqual(result["hosts"][0]["host"], "10.0.1.31")


if __name__ == "__main__":
    unittest.main()
