import unittest
import tempfile
from pathlib import Path

from ssh_auth import build_auth_kwargs


class FakeKey:
    def __init__(self, name, password=None):
        self.name = name
        self.password = password


class FakeRSAKey:
    @staticmethod
    def from_private_key(handle):
        value = handle.read()
        if "RSA PRIVATE KEY" not in value:
            raise ValueError("not rsa")
        return FakeKey("rsa")


class FakeEd25519Key:
    @staticmethod
    def from_private_key(handle):
        value = handle.read()
        if "OPENSSH PRIVATE KEY" not in value:
            raise ValueError("not ed25519")
        return FakeKey("ed25519")

    @staticmethod
    def from_private_key_file(path, password=None):
        value = Path(path).read_text(encoding="utf-8")
        if "OPENSSH PRIVATE KEY" not in value:
            raise ValueError("not ed25519 file")
        return FakeKey("ed25519-file", password=password)


class FakeParamiko:
    RSAKey = FakeRSAKey
    Ed25519Key = FakeEd25519Key


class SshAuthTests(unittest.TestCase):
    def test_builds_password_auth_kwargs_by_default(self):
        auth = build_auth_kwargs("ServerPassword!123", {"authType": "密码"}, FakeParamiko)

        self.assertEqual(auth["password"], "ServerPassword!123")
        self.assertFalse(auth["look_for_keys"])
        self.assertFalse(auth["allow_agent"])
        self.assertNotIn("pkey", auth)

    def test_builds_ssh_agent_auth_kwargs_without_secret(self):
        auth = build_auth_kwargs("", {"authType": "SSH Agent"}, FakeParamiko)

        self.assertTrue(auth["look_for_keys"])
        self.assertTrue(auth["allow_agent"])
        self.assertNotIn("password", auth)
        self.assertNotIn("pkey", auth)

    def test_builds_private_key_auth_kwargs_from_key_content(self):
        private_key = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----"
        auth = build_auth_kwargs(private_key, {"authType": "私钥"}, FakeParamiko)

        self.assertEqual(auth["pkey"].name, "ed25519")
        self.assertFalse(auth["look_for_keys"])
        self.assertFalse(auth["allow_agent"])
        self.assertNotIn("password", auth)

    def test_builds_private_key_auth_kwargs_from_identity_file_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            key_path = Path(temp_dir) / "id_ed25519"
            key_path.write_text("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----", encoding="utf-8")

            auth = build_auth_kwargs("", {"authType": "私钥", "identityFile": str(key_path)}, FakeParamiko)

        self.assertEqual(auth["pkey"].name, "ed25519-file")
        self.assertFalse(auth["look_for_keys"])
        self.assertFalse(auth["allow_agent"])
        self.assertNotIn("password", auth)

    def test_uses_secret_as_passphrase_when_identity_file_is_present(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            key_path = Path(temp_dir) / "id_ed25519"
            key_path.write_text("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----", encoding="utf-8")

            auth = build_auth_kwargs("KeyPassphrase!123", {"authType": "私钥", "identityFile": str(key_path)}, FakeParamiko)

        self.assertEqual(auth["pkey"].name, "ed25519-file")
        self.assertEqual(auth["pkey"].password, "KeyPassphrase!123")
        self.assertNotIn("password", auth)

    def test_private_key_content_wins_over_identity_file_path(self):
        private_key = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----"
        auth = build_auth_kwargs(private_key, {"authType": "私钥", "identityFile": "C:/keys/prod"}, FakeParamiko)

        self.assertEqual(auth["pkey"].name, "ed25519")
        self.assertIsNone(auth["pkey"].password)
        self.assertNotIn("password", auth)

    def test_rejects_empty_secret(self):
        with self.assertRaisesRegex(ValueError, "缺少凭据"):
            build_auth_kwargs("", {"authType": "密码"}, FakeParamiko)

    def test_reports_invalid_private_key_content(self):
        with self.assertRaisesRegex(ValueError, "私钥内容无效"):
            build_auth_kwargs("not-a-key", {"authType": "私钥"}, FakeParamiko)


if __name__ == "__main__":
    unittest.main()
