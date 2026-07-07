import unittest
import tempfile
import json
from pathlib import Path
from unittest.mock import patch

import desktop_app
from desktop_app import DesktopApi


class FakeCredentialStore:
    def __init__(self, *_args):
        self.secrets = {}

    def save_secret(self, connection_name, secret, metadata=None):
        self.secrets["sshcred-model"] = secret
        return {"credentialRef": "sshcred-model", "hasSecret": True, "updatedAt": "2026-06-25T00:00:00Z"}

    def read_secret(self, credential_ref):
        return self.secrets[credential_ref]


class RaisingCredentialStore(FakeCredentialStore):
    def save_secret(self, connection_name, secret, metadata=None):
        raise RuntimeError("save failed api_key=sk-secret-token")


def read_tool_log(root: Path) -> str:
    return "\n".join(path.read_text(encoding="utf-8") for path in root.rglob("*.jsonl"))


class DesktopModelApiTests(unittest.TestCase):
    def test_desktop_api_initialization_does_not_load_ssh_session_manager(self):
        def fail_if_loaded():
            raise AssertionError("SSH session manager should be lazy-loaded")

        with patch.object(desktop_app, "SshSessionManager", fail_if_loaded):
            api = DesktopApi()

        self.assertIsNotNone(api)

    def test_save_model_api_key_returns_redacted_config_to_frontend(self):
        store = FakeCredentialStore()
        with patch.object(desktop_app, "CredentialStore", lambda *_args: store):
            api = DesktopApi()

            result = api.save_model_api_key(
                {"provider": "OpenAI 兼容", "baseUrl": "https://api.example.com/v1", "model": "test-model"},
                "sk-real-secret",
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["config"]["apiKeyRef"], "sshcred-model")
        self.assertEqual(result["config"]["apiKey"], "")
        self.assertEqual(store.read_secret("sshcred-model"), "sk-real-secret")

    def test_chat_with_model_resolves_encrypted_key_reference(self):
        store = FakeCredentialStore()
        store.secrets["sshcred-model"] = "sk-real-secret"
        captured = {}

        def fake_chat_with_model(model_config, messages):
            captured["model_config"] = model_config
            captured["messages"] = messages
            return {"ok": True, "content": "ok", "message": "done"}

        with patch.object(desktop_app, "CredentialStore", lambda *_args: store):
            with patch.object(desktop_app, "call_model_chat", fake_chat_with_model):
                api = DesktopApi()
                result = api.chat_with_model(
                    {"provider": "OpenAI 兼容", "baseUrl": "https://api.example.com/v1", "model": "test-model", "apiKeyRef": "sshcred-model"},
                    [{"role": "user", "content": "hello"}],
                )

        self.assertTrue(result["ok"])
        self.assertEqual(captured["model_config"]["apiKey"], "sk-real-secret")
        self.assertEqual(captured["messages"][0]["content"], "hello")

    def test_chat_with_model_preserves_anthropic_api_format(self):
        store = FakeCredentialStore()
        store.secrets["sshcred-model"] = "sk-ant-secret"
        captured = {}

        def fake_chat_with_model(model_config, messages):
            captured["model_config"] = model_config
            return {"ok": True, "content": "ok", "message": "done"}

        with patch.object(desktop_app, "CredentialStore", lambda *_args: store):
            with patch.object(desktop_app, "call_model_chat", fake_chat_with_model):
                result = DesktopApi().chat_with_model(
                    {
                        "provider": "Anthropic Claude",
                        "baseUrl": "https://api.anthropic.com",
                        "model": "claude-3-5-sonnet-latest",
                        "apiFormat": "anthropic",
                        "apiKeyRef": "sshcred-model",
                    },
                    [{"role": "user", "content": "hello"}],
                )

        self.assertTrue(result["ok"])
        self.assertEqual(captured["model_config"]["apiKey"], "sk-ant-secret")
        self.assertEqual(captured["model_config"]["apiFormat"], "anthropic")

    def test_search_web_delegates_to_agent_search_helper(self):
        captured = {}

        def fake_search_web(query):
            captured["query"] = query
            return {"ok": True, "summary": "联网搜索结果：nginx 502", "results": []}

        with patch.object(desktop_app, "call_web_search", fake_search_web):
            api = DesktopApi()
            result = api.search_web("nginx 502 排查")

        self.assertTrue(result["ok"])
        self.assertEqual(captured["query"], "nginx 502 排查")
        self.assertIn("联网搜索结果", result["summary"])

    def test_test_model_connection_resolves_encrypted_key_reference(self):
        store = FakeCredentialStore()
        store.secrets["sshcred-model"] = "sk-real-secret"
        captured = {}

        def fake_test_model_connection(model_config):
            captured["model_config"] = model_config
            return {"ok": True, "message": "连接测试通过", "model": model_config["model"]}

        with patch.object(desktop_app, "CredentialStore", lambda *_args: store):
            with patch.object(desktop_app, "call_model_test", fake_test_model_connection):
                api = DesktopApi()
                result = api.test_model_connection(
                    {"provider": "OpenAI 兼容", "baseUrl": "https://api.example.com/v1", "model": "test-model", "apiKeyRef": "sshcred-model"},
                )

        self.assertTrue(result["ok"])
        self.assertEqual(result["model"], "test-model")
        self.assertEqual(captured["model_config"]["apiKey"], "sk-real-secret")

    def test_list_model_options_resolves_encrypted_key_reference(self):
        store = FakeCredentialStore()
        store.secrets["sshcred-model"] = "sk-real-secret"
        captured = {}

        def fake_list_model_options(model_config):
            captured["model_config"] = model_config
            return {"ok": True, "models": ["gpt-4.1-mini", "gpt-5.5"]}

        with patch.object(desktop_app, "CredentialStore", lambda *_args: store):
            with patch.object(desktop_app, "call_model_list", fake_list_model_options):
                api = DesktopApi()
                result = api.list_model_options(
                    {"provider": "OpenAI 鍏煎", "baseUrl": "https://api.example.com/v1", "apiKeyRef": "sshcred-model"},
                )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["gpt-4.1-mini", "gpt-5.5"])
        self.assertEqual(captured["model_config"]["apiKey"], "sk-real-secret")

    def test_list_model_options_accepts_model_ids_from_relay_mapping(self):
        store = FakeCredentialStore()
        store.secrets["sshcred-model"] = "sk-real-secret"

        def fake_list_model_options(model_config):
            self.assertEqual(model_config["apiKey"], "sk-real-secret")
            return {"ok": True, "models": ["gpt-4.1-mini", "deepseek-chat"]}

        with patch.object(desktop_app, "CredentialStore", lambda *_args: store):
            with patch.object(desktop_app, "call_model_list", fake_list_model_options):
                api = DesktopApi()
                result = api.list_model_options(
                    {"provider": "中转站 API", "baseUrl": "https://relay.example/v1", "apiKeyRef": "sshcred-model"},
                )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["gpt-4.1-mini", "deepseek-chat"])

    def test_read_app_config_does_not_return_plaintext_model_api_key(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            config_path.write_text(
                json.dumps({
                    "customServers": {},
                    "modelConfig": {"baseUrl": "https://api.example.com/v1", "model": "test", "apiKey": "sk-plain"},
                    "modelProfiles": [
                        {"id": "relay", "name": "Relay", "config": {"baseUrl": "https://relay.example/v1", "model": "relay", "apiKey": "sk-profile-plain"}},
                    ],
                    "activeModelProfileId": "relay",
                }),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "app_config_path", lambda: config_path):
                config = DesktopApi().read_app_config()

        self.assertEqual(config["modelConfig"]["apiKey"], "")
        self.assertEqual(config["modelProfiles"][0]["config"]["apiKey"], "")
        self.assertEqual(config["activeModelProfileId"], "relay")
        self.assertNotIn("sk-plain", json.dumps(config, ensure_ascii=False))
        self.assertNotIn("sk-profile-plain", json.dumps(config, ensure_ascii=False))

    def test_app_config_preserves_safe_model_profile_test_status(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            payload = {
                "customServers": {},
                "modelConfig": {"baseUrl": "https://api.example.com/v1", "model": "test"},
                "modelProfiles": [
                    {
                        "id": "relay",
                        "name": "Relay",
                        "config": {"baseUrl": "https://relay.example/v1", "model": "relay"},
                        "lastTest": {
                            "ok": True,
                            "message": "模型 API 连接测试通过。",
                            "latencyMs": 128,
                            "testedAt": "2026-06-29 13:50:00",
                            "apiKey": "sk-must-not-store",
                        },
                    },
                ],
                "activeModelProfileId": "relay",
            }
            config_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

            with patch.object(desktop_app, "app_config_path", lambda: config_path):
                api = DesktopApi()
                config = api.read_app_config()
                api.write_app_config(config)

            raw = config_path.read_text(encoding="utf-8")

        self.assertEqual(config["modelProfiles"][0]["lastTest"]["ok"], True)
        self.assertEqual(config["modelProfiles"][0]["lastTest"]["latencyMs"], 128)
        self.assertEqual(config["modelProfiles"][0]["lastTest"]["testedAt"], "2026-06-29 13:50:00")
        self.assertNotIn("apiKey", config["modelProfiles"][0]["lastTest"])
        self.assertNotIn("sk-must-not-store", raw)

    def test_app_config_normalizes_invalid_model_profile_test_latency(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            config_path.write_text(
                json.dumps({
                    "customServers": {},
                    "modelConfig": {"baseUrl": "https://api.example.com/v1", "model": "test"},
                    "modelProfiles": [
                        {
                            "id": "relay",
                            "name": "Relay",
                            "config": {"baseUrl": "https://relay.example/v1", "model": "relay"},
                            "lastTest": {"ok": False, "message": "failed", "latencyMs": "bad", "testedAt": "2026-06-29 14:10:00"},
                        },
                    ],
                    "activeModelProfileId": "relay",
                }),
                encoding="utf-8",
            )

            with patch.object(desktop_app, "app_config_path", lambda: config_path):
                config = DesktopApi().read_app_config()

        self.assertEqual(config["modelProfiles"][0]["lastTest"]["latencyMs"], 0)

    def test_write_app_config_does_not_persist_plaintext_model_api_key(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"

            with patch.object(desktop_app, "app_config_path", lambda: config_path):
                DesktopApi().write_app_config(
                    {
                        "customServers": {},
                        "modelConfig": {"baseUrl": "https://api.example.com/v1", "model": "test", "apiKey": "sk-plain"},
                        "modelProfiles": [
                            {"id": "relay", "name": "Relay", "config": {"baseUrl": "https://relay.example/v1", "model": "relay", "apiKey": "sk-profile-plain"}},
                        ],
                        "activeModelProfileId": "relay",
                    }
                )

            raw = config_path.read_text(encoding="utf-8")

        self.assertNotIn("sk-plain", raw)
        self.assertNotIn("sk-profile-plain", raw)

    def test_save_model_api_key_exception_returns_failure_and_logs_without_secret(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            tool_root = Path(temp_dir) / "tool-logs"
            with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                with patch.object(desktop_app, "CredentialStore", lambda *_args: RaisingCredentialStore()):
                    result = DesktopApi().save_model_api_key(
                        {"provider": "OpenAI 兼容", "baseUrl": "https://api.example.com/v1", "model": "test-model"},
                        "sk-secret-token",
                    )

            tool_log = read_tool_log(tool_root)
            self.assertFalse(result["ok"])
            self.assertIn("模型 API", result["message"])
            self.assertIn("日志", result["message"])
            self.assertIn("save_api_key", tool_log)
            self.assertNotIn("sk-secret-token", tool_log)

    def test_model_api_runtime_exceptions_return_failure_and_logs(self):
        cases = [
            (
                lambda api: api.chat_with_model(
                    {"provider": "OpenAI 兼容", "baseUrl": "https://api.example.com/v1", "model": "test-model"},
                    [{"role": "user", "content": "hello token=secret-token"}],
                ),
                "call_model_chat",
                "chat",
                "content",
            ),
            (
                lambda api: api.test_model_connection({"provider": "OpenAI 兼容", "baseUrl": "https://api.example.com/v1", "model": "test-model"}),
                "call_model_test",
                "test_connection",
                "message",
            ),
            (
                lambda api: api.list_model_options({"provider": "OpenAI 兼容", "baseUrl": "https://api.example.com/v1", "model": "test-model"}),
                "call_model_list",
                "list_models",
                "models",
            ),
        ]
        for action, patched_name, log_action, result_key in cases:
            with self.subTest(log_action=log_action):
                with tempfile.TemporaryDirectory() as temp_dir:
                    tool_root = Path(temp_dir) / "tool-logs"
                    with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                        with patch.object(desktop_app, patched_name, side_effect=RuntimeError("relay failed token=secret-token")):
                            result = action(DesktopApi())

                    tool_log = read_tool_log(tool_root)
                    self.assertFalse(result["ok"])
                    self.assertIn("模型 API", result["message"])
                    self.assertIn("日志", result["message"])
                    self.assertIn(log_action, tool_log)
                    self.assertIn("test-model", tool_log)
                    self.assertIn(result_key, result)
                    self.assertNotIn("secret-token", tool_log)

    def test_model_api_success_logs_safe_diagnostic_context_without_key_fields(self):
        store = FakeCredentialStore()
        store.secrets["sshcred-model"] = "sk-real-secret"

        def fake_chat_with_model(model_config, messages):
            self.assertEqual(model_config["apiKey"], "sk-real-secret")
            return {"ok": True, "content": "ok", "message": "done"}

        with tempfile.TemporaryDirectory() as temp_dir:
            tool_root = Path(temp_dir) / "tool-logs"
            with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                with patch.object(desktop_app, "CredentialStore", lambda *_args: store):
                    with patch.object(desktop_app, "call_model_chat", fake_chat_with_model):
                        result = DesktopApi().chat_with_model(
                            {
                                "provider": "OpenAI 兼容",
                                "baseUrl": "https://api.example.com/v1",
                                "model": "test-model",
                                "apiKeyRef": "sshcred-model",
                            },
                            [{"role": "user", "content": "hello"}],
                        )

            tool_log = read_tool_log(tool_root)

        self.assertTrue(result["ok"])
        self.assertIn("model-api", tool_log)
        self.assertIn("chat", tool_log)
        self.assertIn("OpenAI", tool_log)
        self.assertIn("https://api.example.com/v1", tool_log)
        self.assertIn("test-model", tool_log)
        self.assertIn("hasApiKey", tool_log)
        self.assertNotIn('"apiKey"', tool_log)
        self.assertNotIn('"apiKeyRef"', tool_log)
        self.assertNotIn("sk-real-secret", tool_log)
        self.assertNotIn("sshcred-model", tool_log)

    def test_list_model_success_logs_safe_endpoint_diagnostics(self):
        def fake_list_model_options(model_config):
            return {
                "ok": True,
                "models": ["gpt-4.1-mini"],
                "message": "已获取 1 个模型。",
                "usedEndpoint": "https://relay.example/v1/models",
                "attemptedEndpoints": [
                    "https://relay.example/v1/models",
                    "https://relay.example/models",
                ],
            }

        with tempfile.TemporaryDirectory() as temp_dir:
            tool_root = Path(temp_dir) / "tool-logs"
            with patch.object(desktop_app, "tool_log_path", lambda: tool_root):
                with patch.object(desktop_app, "call_model_list", fake_list_model_options):
                    result = DesktopApi().list_model_options(
                        {"provider": "OpenAI 兼容", "baseUrl": "https://relay.example/v1", "apiKey": "sk-secret-key"},
                    )

            tool_log = read_tool_log(tool_root)

        self.assertTrue(result["ok"])
        self.assertIn("usedEndpoint", tool_log)
        self.assertIn("https://relay.example/v1/models", tool_log)
        self.assertIn("https://relay.example/models", tool_log)
        self.assertNotIn("sk-secret-key", tool_log)


if __name__ == "__main__":
    unittest.main()
