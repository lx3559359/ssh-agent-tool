import tempfile
import unittest
from pathlib import Path

from credential_store import CredentialStore
from model_credentials import resolve_model_config, sanitize_model_config, save_model_api_key


def fake_protect(value: bytes) -> bytes:
    return b"enc:" + value[::-1]


def fake_unprotect(value: bytes) -> bytes:
    if not value.startswith(b"enc:"):
        raise ValueError("invalid encrypted payload")
    return value[4:][::-1]


class ModelCredentialTests(unittest.TestCase):
    def make_store(self, temp_dir):
        return CredentialStore(
            Path(temp_dir),
            protect=fake_protect,
            unprotect=fake_unprotect,
            clock=lambda: "2026-06-25T00:00:00Z",
        )

    def test_save_model_api_key_returns_config_without_plaintext_key(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = self.make_store(temp_dir)

            result = save_model_api_key(
                {
                    "provider": "OpenAI 兼容",
                    "baseUrl": "https://api.example.com/v1",
                    "model": "test-model",
                },
                "sk-real-secret",
                store,
            )

            self.assertTrue(result["ok"])
            self.assertTrue(result["config"]["hasApiKey"])
            self.assertTrue(result["config"]["apiKeyRef"].startswith("sshcred-"))
            self.assertEqual(result["config"]["apiKey"], "")
            self.assertEqual(store.read_secret(result["config"]["apiKeyRef"]), "sk-real-secret")

    def test_resolve_model_config_reads_key_from_encrypted_reference(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = self.make_store(temp_dir)
            saved = save_model_api_key(
                {
                    "provider": "中转站 API",
                    "baseUrl": "https://relay.example/v1",
                    "model": "gpt-compatible",
                },
                "relay-secret",
                store,
            )

            resolved = resolve_model_config(saved["config"], store)

            self.assertEqual(resolved["apiKey"], "relay-secret")
            self.assertEqual(resolved["baseUrl"], "https://relay.example/v1")
            self.assertEqual(resolved["model"], "gpt-compatible")

    def test_resolve_model_config_handles_missing_key_reference_without_throwing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = self.make_store(temp_dir)

            resolved = resolve_model_config(
                {
                    "provider": "OpenAI 兼容",
                    "baseUrl": "https://api.example.com/v1",
                    "model": "test-model",
                    "apiKeyRef": "sshcred-missing",
                    "hasApiKey": True,
                },
                store,
            )

            self.assertEqual(resolved["apiKey"], "")
            self.assertFalse(resolved["hasApiKey"])
            self.assertIn("API Key", resolved["credentialError"])

    def test_sanitize_model_config_preserves_only_non_sensitive_extra_headers(self):
        config = sanitize_model_config(
            {
                "provider": "中转站 API",
                "baseUrl": "https://relay.example/v1",
                "model": "gpt-compatible",
                "extraHeaders": [
                    {"name": "HTTP-Referer", "value": "https://ops.example.com", "enabled": True},
                    {"name": "Authorization", "value": "Bearer secret", "enabled": True},
                    {"name": "X-API-Key", "value": "secret", "enabled": True},
                ],
            }
        )

        self.assertEqual(config["extraHeaders"], [{"name": "HTTP-Referer", "value": "https://ops.example.com", "enabled": True}])

    def test_placeholder_key_is_not_saved_as_secret(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = self.make_store(temp_dir)

            result = save_model_api_key(
                {"provider": "OpenAI 兼容", "baseUrl": "https://api.example.com/v1", "model": "test-model"},
                "sk-************************",
                store,
            )

            self.assertFalse(result["ok"])
            self.assertIn("不是有效的模型 API Key", result["message"])


if __name__ == "__main__":
    unittest.main()
