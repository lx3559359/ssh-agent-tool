import json
import tempfile
import unittest
from pathlib import Path

from credential_store import CredentialStore


def fake_protect(value: bytes) -> bytes:
    return b"enc:" + value[::-1]


def fake_unprotect(value: bytes) -> bytes:
    if not value.startswith(b"enc:"):
        raise ValueError("invalid encrypted payload")
    return value[4:][::-1]


class CredentialStoreTests(unittest.TestCase):
    def test_saves_secret_without_plaintext_on_disk(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = CredentialStore(
                Path(temp_dir),
                protect=fake_protect,
                unprotect=fake_unprotect,
                clock=lambda: "2026-06-25T00:00:00Z",
            )

            result = store.save_secret(
                connection_name="prod-web-01",
                secret="P@ssw0rd!",
                metadata={"authType": "密码", "user": "root"},
            )

            saved = json.loads(Path(result["path"]).read_text(encoding="utf-8"))
            self.assertNotIn("P@ssw0rd!", Path(result["path"]).read_text(encoding="utf-8"))
            self.assertEqual(saved["schema"], "ssh-agent-tool.credential.v1")
            self.assertEqual(result["credentialRef"], saved["credentialRef"])
            self.assertEqual(store.read_secret(result["credentialRef"]), "P@ssw0rd!")

    def test_metadata_does_not_include_secret(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = CredentialStore(
                Path(temp_dir),
                protect=fake_protect,
                unprotect=fake_unprotect,
                clock=lambda: "2026-06-25T00:00:00Z",
            )

            result = store.save_secret("prod-db-01", "mysql-secret", {"authType": "密码"})
            metadata = store.read_metadata(result["credentialRef"])

            self.assertTrue(metadata["hasSecret"])
            self.assertEqual(metadata["authType"], "密码")
            self.assertNotIn("secret", metadata)
            self.assertNotIn("encryptedSecret", metadata)

    def test_deletes_saved_secret_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = CredentialStore(
                Path(temp_dir),
                protect=fake_protect,
                unprotect=fake_unprotect,
                clock=lambda: "2026-06-25T00:00:00Z",
            )

            saved = store.save_secret("prod-web-01", "ServerPassword!123", {"authType": "密码"})
            credential_path = Path(saved["path"])

            result = store.delete_secret(saved["credentialRef"])

            self.assertTrue(result["ok"])
            self.assertTrue(result["deleted"])
            self.assertEqual(result["credentialRef"], saved["credentialRef"])
            self.assertFalse(credential_path.exists())


if __name__ == "__main__":
    unittest.main()
