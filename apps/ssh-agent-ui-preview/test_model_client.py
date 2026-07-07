import json
import unittest
from urllib.error import HTTPError, URLError

from model_client import chat_with_model, list_model_options, test_model_connection


class FakeResponse:
    def __init__(self, body, status=200):
        self.body = body
        self.status = status

    def read(self):
        return self.body

    def close(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class FakeUrlopen:
    def __init__(self, body, status=200):
        self.body = body
        self.status = status
        self.requests = []

    def __call__(self, request, timeout=30):
        self.requests.append((request, timeout))
        return FakeResponse(self.body, self.status)


class FakeHTTPErrorUrlopen:
    def __init__(self, body, status=502, reason="Bad Gateway"):
        self.body = body
        self.status = status
        self.reason = reason
        self.requests = []

    def __call__(self, request, timeout=30):
        self.requests.append((request, timeout))
        raise HTTPError(request.full_url, self.status, self.reason, {}, FakeResponse(self.body, self.status))


class SequenceUrlopen:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def __call__(self, request, timeout=30):
        self.requests.append((request, timeout))
        if not self.responses:
            raise AssertionError("unexpected extra request")
        body, status = self.responses.pop(0)
        return FakeResponse(body, status)


class FailingUrlopen:
    def __init__(self, error):
        self.error = error
        self.requests = []

    def __call__(self, request, timeout=30):
        self.requests.append((request, timeout))
        raise self.error


class ModelClientTests(unittest.TestCase):
    def test_sends_openai_compatible_chat_request(self):
        body = json.dumps({"choices": [{"message": {"content": "可以先检查负载和 Nginx 日志。"}}]}).encode("utf-8")
        urlopen = FakeUrlopen(body)

        result = chat_with_model(
            {
                "baseUrl": "https://api.example.com/v1/",
                "apiKey": "sk-test",
                "model": "test-model",
            },
            [{"role": "user", "content": "怎么排查 502？"}],
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["content"], "可以先检查负载和 Nginx 日志。")
        request, timeout = urlopen.requests[0]
        self.assertEqual(request.full_url, "https://api.example.com/v1/chat/completions")
        self.assertEqual(request.headers["Authorization"], "Bearer sk-test")
        self.assertEqual(timeout, 30)
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["model"], "test-model")
        self.assertEqual(payload["messages"][0]["content"], "怎么排查 502？")

    def test_sends_anthropic_native_chat_request(self):
        body = json.dumps({"content": [{"type": "text", "text": "可以先检查负载。"}]}).encode("utf-8")
        urlopen = FakeUrlopen(body)

        result = chat_with_model(
            {
                "baseUrl": "https://api.anthropic.com",
                "apiKey": "sk-ant-test",
                "model": "claude-3-5-sonnet-latest",
                "apiFormat": "anthropic",
            },
            [{"role": "user", "content": "怎么排查 502？"}],
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["content"], "可以先检查负载。")
        request, _ = urlopen.requests[0]
        self.assertEqual(request.full_url, "https://api.anthropic.com/v1/messages")
        self.assertEqual(request.headers["X-api-key"], "sk-ant-test")
        self.assertEqual(request.headers["Anthropic-version"], "2023-06-01")
        self.assertNotIn("Authorization", request.headers)
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["model"], "claude-3-5-sonnet-latest")
        self.assertEqual(payload["max_tokens"], 1024)
        self.assertEqual(payload["messages"][0]["content"], "怎么排查 502？")

    def test_anthropic_model_list_uses_native_headers(self):
        body = json.dumps({"data": [{"id": "claude-3-5-sonnet-latest"}]}).encode("utf-8")
        urlopen = FakeUrlopen(body)

        result = list_model_options(
            {
                "baseUrl": "https://api.anthropic.com",
                "apiKey": "sk-ant-test",
                "apiFormat": "anthropic",
            },
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["claude-3-5-sonnet-latest"])
        request, _ = urlopen.requests[0]
        self.assertEqual(request.full_url, "https://api.anthropic.com/v1/models")
        self.assertEqual(request.headers["X-api-key"], "sk-ant-test")
        self.assertEqual(request.headers["Anthropic-version"], "2023-06-01")
        self.assertNotIn("Authorization", request.headers)

    def test_accepts_full_chat_completions_endpoint_from_relay(self):
        body = json.dumps({"choices": [{"message": {"content": "ok"}}]}).encode("utf-8")
        urlopen = FakeUrlopen(body)

        result = chat_with_model(
            {
                "baseUrl": "https://relay.example/openai/v1/chat/completions",
                "apiKey": "relay-key",
                "model": "gpt-compatible",
            },
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        request, _ = urlopen.requests[0]
        self.assertEqual(request.full_url, "https://relay.example/openai/v1/chat/completions")

    def test_accepts_models_endpoint_as_base_url_for_chat(self):
        body = json.dumps({"choices": [{"message": {"content": "ok"}}]}).encode("utf-8")
        urlopen = FakeUrlopen(body)

        result = chat_with_model(
            {
                "baseUrl": "https://relay.example/openai/v1/models",
                "apiKey": "relay-key",
                "model": "gpt-compatible",
            },
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        request, _ = urlopen.requests[0]
        self.assertEqual(request.full_url, "https://relay.example/openai/v1/chat/completions")

    def test_accepts_ollama_tags_endpoint_as_base_url_for_chat(self):
        body = json.dumps({"choices": [{"message": {"content": "local ok"}}]}).encode("utf-8")
        urlopen = FakeUrlopen(body)

        result = chat_with_model(
            {
                "baseUrl": "http://127.0.0.1:11434/api/tags",
                "apiKey": "",
                "model": "qwen2.5-coder:7b",
            },
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        request, _ = urlopen.requests[0]
        self.assertEqual(request.full_url, "http://127.0.0.1:11434/v1/chat/completions")
        self.assertNotIn("Authorization", request.headers)

    def test_accepts_responses_endpoint_as_base_url_for_chat(self):
        body = json.dumps({"output_text": "responses ok"}).encode("utf-8")
        urlopen = FakeUrlopen(body)

        result = chat_with_model(
            {
                "baseUrl": "https://relay.example/openai/v1/responses",
                "apiKey": "relay-key",
                "model": "gpt-compatible",
            },
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["content"], "responses ok")
        request, _ = urlopen.requests[0]
        self.assertEqual(request.full_url, "https://relay.example/openai/v1/responses")
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["model"], "gpt-compatible")
        self.assertNotIn("messages", payload)
        self.assertEqual(payload["input"][0]["role"], "user")
        self.assertEqual(payload["input"][0]["content"], "hello")

    def test_responses_endpoint_falls_back_to_chat_completions_for_older_relays(self):
        urlopen = SequenceUrlopen([
            (json.dumps({"error": {"message": "responses not enabled"}}).encode("utf-8"), 404),
            (json.dumps({"choices": [{"message": {"content": "chat fallback ok"}}]}).encode("utf-8"), 200),
        ])

        result = chat_with_model(
            {
                "baseUrl": "https://relay.example/openai/v1/responses",
                "apiKey": "relay-key",
                "model": "gpt-compatible",
            },
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["content"], "chat fallback ok")
        self.assertEqual([request.full_url for request, _ in urlopen.requests], [
            "https://relay.example/openai/v1/responses",
            "https://relay.example/openai/v1/chat/completions",
        ])
        responses_payload = json.loads(urlopen.requests[0][0].data.decode("utf-8"))
        chat_payload = json.loads(urlopen.requests[1][0].data.decode("utf-8"))
        self.assertIn("input", responses_payload)
        self.assertIn("messages", chat_payload)

    def test_adds_openai_v1_prefix_for_provider_root_url(self):
        body = json.dumps({"choices": [{"message": {"content": "ok"}}]}).encode("utf-8")
        urlopen = FakeUrlopen(body)

        result = chat_with_model(
            {
                "baseUrl": "https://api.aigh.store",
                "apiKey": "relay-key",
                "model": "gpt-5.5",
            },
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        request, _ = urlopen.requests[0]
        self.assertEqual(request.full_url, "https://api.aigh.store/v1/chat/completions")

    def test_chat_falls_back_to_plain_chat_endpoint_for_relays(self):
        urlopen = SequenceUrlopen([
            (b"<html>not json</html>", 404),
            (json.dumps({"choices": [{"message": {"content": "ok"}}]}).encode("utf-8"), 200),
        ])

        result = chat_with_model(
            {
                "baseUrl": "https://relay.example",
                "apiKey": "relay-key",
                "model": "relay-model",
            },
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual([request.full_url for request, _ in urlopen.requests], [
            "https://relay.example/v1/chat/completions",
            "https://relay.example/chat/completions",
        ])

    def test_chat_falls_back_to_path_v1_chat_endpoint_for_relays(self):
        urlopen = SequenceUrlopen([
            (b"<html>not json</html>", 404),
            (json.dumps({"choices": [{"message": {"content": "path v1 ok"}}]}).encode("utf-8"), 200),
        ])

        result = chat_with_model(
            {
                "baseUrl": "https://relay.example/openai",
                "apiKey": "relay-key",
                "model": "relay-model",
            },
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["content"], "path v1 ok")
        self.assertEqual([request.full_url for request, _ in urlopen.requests], [
            "https://relay.example/openai/chat/completions",
            "https://relay.example/openai/v1/chat/completions",
        ])

    def test_chat_failure_reports_attempted_endpoints_without_leaking_key(self):
        urlopen = SequenceUrlopen([
            (b"<html>not json</html>", 404),
            (json.dumps({"error": {"message": "bad key sk-secret-key"}}).encode("utf-8"), 401),
        ])

        result = chat_with_model(
            {
                "baseUrl": "https://relay.example",
                "apiKey": "sk-secret-key",
                "model": "relay-model",
            },
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )

        self.assertFalse(result["ok"])
        self.assertIn("https://relay.example/v1/chat/completions", result["message"])
        self.assertIn("https://relay.example/chat/completions", result["message"])
        self.assertNotIn("sk-secret-key", result["message"])

    def test_allows_local_model_without_api_key(self):
        body = json.dumps({"choices": [{"message": {"content": "本地模型回复"}}]}).encode("utf-8")
        urlopen = FakeUrlopen(body)

        result = chat_with_model(
            {"baseUrl": "http://127.0.0.1:11434/v1", "apiKey": "", "model": "qwen"},
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        request, _ = urlopen.requests[0]
        self.assertNotIn("Authorization", request.headers)

    def test_sends_non_sensitive_extra_headers_for_relay_apis(self):
        body = json.dumps({"choices": [{"message": {"content": "ok"}}]}).encode("utf-8")
        urlopen = FakeUrlopen(body)

        result = chat_with_model(
            {
                "baseUrl": "https://relay.example/v1",
                "apiKey": "relay-key",
                "model": "gpt-compatible",
                "extraHeaders": [
                    {"name": "HTTP-Referer", "value": "https://ops.example.com", "enabled": True},
                    {"name": "X-Title", "value": "SSH Agent Tool", "enabled": True},
                    {"name": "X-API-Key", "value": "must-not-send", "enabled": True},
                ],
            },
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        request, _ = urlopen.requests[0]
        self.assertEqual(request.headers["Http-referer"], "https://ops.example.com")
        self.assertEqual(request.headers["X-title"], "SSH Agent Tool")
        self.assertNotIn("X-api-key", request.headers)

    def test_returns_chinese_error_for_missing_config(self):
        result = chat_with_model({"baseUrl": "", "model": ""}, [{"role": "user", "content": "hello"}])

        self.assertFalse(result["ok"])
        self.assertIn("模型 API 配置不完整", result["message"])

    def test_model_api_errors_are_readable_chinese(self):
        missing = chat_with_model({"baseUrl": "", "model": ""}, [{"role": "user", "content": "hello"}])
        bad_json = list_model_options(
            {"baseUrl": "https://api.example.com", "apiKey": "bad"},
            urlopen=FakeUrlopen(b"<html>not found</html>", status=200),
        )

        self.assertFalse(missing["ok"])
        self.assertIn("模型 API 配置不完整", missing["message"])
        self.assertIn("请填写 Base URL", missing["message"])
        self.assertFalse(bad_json["ok"])
        self.assertIn("模型 API 返回的不是 JSON", bad_json["message"])
        self.assertNotIn("妯", missing["message"] + bad_json["message"])

    def test_model_api_errors_are_plain_chinese_without_json_parser_noise(self):
        missing = chat_with_model({"baseUrl": "", "model": ""}, [{"role": "user", "content": "hello"}])
        empty_response = list_model_options(
            {"baseUrl": "https://api.example.com", "apiKey": "bad"},
            urlopen=FakeUrlopen(b"", status=200),
        )
        html_response = chat_with_model(
            {"baseUrl": "https://api.example.com/v1", "apiKey": "bad", "model": "test"},
            [{"role": "user", "content": "hello"}],
            urlopen=FakeUrlopen(b"<html>not found</html>", status=200),
        )

        self.assertFalse(missing["ok"])
        self.assertIn("模型 API 配置不完整", missing["message"])
        self.assertIn("请填写 Base URL", missing["message"])
        self.assertFalse(empty_response["ok"])
        self.assertIn("模型 API 返回的不是 JSON", empty_response["message"])
        self.assertIn("空响应", empty_response["message"])
        self.assertFalse(html_response["ok"])
        self.assertIn("当前请求：https://api.example.com/v1/chat/completions", html_response["message"])
        combined = missing["message"] + empty_response["message"] + html_response["message"]
        self.assertNotIn("Expecting value", combined)

    def test_model_client_stops_before_request_when_api_key_reference_is_unavailable(self):
        urlopen = FakeUrlopen(json.dumps({"data": [{"id": "should-not-request"}]}).encode("utf-8"))

        chat_result = chat_with_model(
            {
                "baseUrl": "https://api.example.com/v1",
                "model": "test-model",
                "credentialError": "模型 API Key 凭据不可用，请重新保存 API Key",
            },
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )
        list_result = list_model_options(
            {
                "baseUrl": "https://api.example.com/v1",
                "credentialError": "模型 API Key 凭据不可用，请重新保存 API Key",
            },
            urlopen=urlopen,
        )

        self.assertFalse(chat_result["ok"])
        self.assertFalse(list_result["ok"])
        self.assertIn("API Key", chat_result["message"])
        self.assertIn("重新保存", list_result["message"])
        self.assertEqual(urlopen.requests, [])

    def test_returns_chinese_error_for_bad_response(self):
        urlopen = FakeUrlopen(json.dumps({"error": {"message": "bad key"}}).encode("utf-8"), status=401)

        result = chat_with_model(
            {"baseUrl": "https://api.example.com/v1", "apiKey": "bad", "model": "test"},
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )

        self.assertFalse(result["ok"])
        self.assertIn("模型 API 调用失败", result["message"])

    def test_model_api_auth_status_errors_are_actionable(self):
        urlopen = FakeUrlopen(json.dumps({}).encode("utf-8"), status=401)

        result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "bad"},
            urlopen=urlopen,
        )

        self.assertFalse(result["ok"])
        self.assertIn("API Key", result["message"])
        self.assertIn("权限", result["message"])
        self.assertNotEqual(result["message"], "模型 API 调用失败：HTTP 401")

    def test_model_list_http_errors_use_model_list_wording(self):
        urlopen = FakeUrlopen(json.dumps({"error": {"message": "bad key"}}).encode("utf-8"), status=401)

        result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "bad"},
            urlopen=urlopen,
        )

        self.assertFalse(result["ok"])
        self.assertIn("模型列表获取失败", result["message"])
        self.assertIn("HTTP 401", result["message"])
        self.assertNotIn("模型 API 调用失败", result["message"])


    def test_model_api_network_errors_are_actionable_chinese_without_raw_urlopen_noise(self):
        urlopen = FailingUrlopen(URLError("[Errno 11001] getaddrinfo failed"))

        list_result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "sk-secret-key"},
            urlopen=urlopen,
        )
        chat_result = chat_with_model(
            {"baseUrl": "https://relay.example/v1", "apiKey": "sk-secret-key", "model": "gpt-test"},
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )

        combined = list_result["message"] + "\n" + chat_result["message"]
        self.assertFalse(list_result["ok"])
        self.assertFalse(chat_result["ok"])
        self.assertIn("网络连接失败", combined)
        self.assertIn("Base URL", combined)
        self.assertIn("代理", combined)
        self.assertNotIn("<urlopen error", combined)
        self.assertNotIn("sk-secret-key", combined)

    def test_chat_accepts_common_relay_response_shapes(self):
        response_shapes = [
            {"choices": [{"text": "plain choice text"}]},
            {"choices": [{"delta": {"content": "delta choice text"}}]},
            {"output_text": "responses api text"},
            {"output": [{"content": [{"type": "output_text", "text": "responses output text"}]}]},
            {"message": {"content": "ollama chat text"}},
            {"choices": [{"message": {"content": [{"type": "text", "text": "block text"}]}}]},
        ]

        for body in response_shapes:
            with self.subTest(body=body):
                urlopen = FakeUrlopen(json.dumps(body).encode("utf-8"))

                result = chat_with_model(
                    {"baseUrl": "https://relay.example/v1", "apiKey": "relay-key", "model": "relay-model"},
                    [{"role": "user", "content": "hello"}],
                    urlopen=urlopen,
                )

                self.assertTrue(result["ok"])
                self.assertTrue(result["content"].endswith("text"))

    def test_chat_accepts_gemini_candidate_response_shape_from_relays(self):
        urlopen = FakeUrlopen(
            json.dumps(
                {
                    "candidates": [
                        {
                            "content": {
                                "parts": [
                                    {"text": "gemini relay text"},
                                ]
                            }
                        }
                    ]
                }
            ).encode("utf-8")
        )

        result = chat_with_model(
            {"baseUrl": "https://relay.example/v1", "apiKey": "relay-key", "model": "gemini-compatible"},
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["content"], "gemini relay text")


    def test_returns_helpful_error_for_non_json_response(self):
        urlopen = FakeUrlopen(b"<html>not found</html>", status=200)

        result = chat_with_model(
            {"baseUrl": "https://api.example.com", "apiKey": "bad", "model": "test"},
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )

        self.assertFalse(result["ok"])
        self.assertIn("JSON", result["message"])
        self.assertIn("/v1", result["message"])

    def test_http_error_non_json_response_is_actionable(self):
        urlopen = FakeHTTPErrorUrlopen(b"<html>bad gateway</html>", status=502)

        result = chat_with_model(
            {"baseUrl": "https://api.example.com/v1", "apiKey": "bad", "model": "test"},
            [{"role": "user", "content": "hello"}],
            urlopen=urlopen,
        )

        self.assertFalse(result["ok"])
        self.assertIn("JSON", result["message"])
        self.assertIn("bad gateway", result["message"])
        self.assertIn("https://api.example.com/v1/chat/completions", result["message"])
        self.assertNotIn("Expecting value", result["message"])

    def test_lists_openai_compatible_models_from_provider_root_url(self):
        body = json.dumps({"data": [{"id": "gpt-4.1-mini"}, {"id": "gpt-5.5"}]}).encode("utf-8")
        urlopen = FakeUrlopen(body)

        result = list_model_options(
            {"baseUrl": "https://api.aigh.store", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["gpt-4.1-mini", "gpt-5.5"])
        request, timeout = urlopen.requests[0]
        self.assertEqual(request.full_url, "https://api.aigh.store/v1/models")
        self.assertEqual(timeout, 15)

    def test_model_list_success_returns_safe_endpoint_diagnostics(self):
        body = json.dumps({"data": [{"id": "gpt-4.1-mini"}]}).encode("utf-8")
        urlopen = FakeUrlopen(body)

        result = list_model_options(
            {"baseUrl": "https://api.aigh.store", "apiKey": "sk-secret-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["usedEndpoint"], "https://api.aigh.store/v1/models")
        self.assertEqual(result["attemptedEndpoints"], ["https://api.aigh.store/v1/models"])
        self.assertNotIn("sk-secret-key", json.dumps(result, ensure_ascii=False))

    def test_accepts_responses_endpoint_as_base_url_for_model_list(self):
        body = json.dumps({"data": [{"id": "gpt-4.1-mini"}, {"id": "deepseek-chat"}]}).encode("utf-8")
        urlopen = FakeUrlopen(body)

        result = list_model_options(
            {"baseUrl": "https://relay.example/openai/v1/responses", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["gpt-4.1-mini", "deepseek-chat"])
        request, _ = urlopen.requests[0]
        self.assertEqual(request.full_url, "https://relay.example/openai/v1/models")

    def test_model_list_falls_back_to_plain_models_endpoint_for_relays(self):
        urlopen = SequenceUrlopen([
            (b"<html>not json</html>", 404),
            (json.dumps({"data": [{"id": "relay-model"}]}).encode("utf-8"), 200),
        ])

        result = list_model_options(
            {"baseUrl": "https://relay.example", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["relay-model"])
        self.assertEqual([request.full_url for request, _ in urlopen.requests], [
            "https://relay.example/v1/models",
            "https://relay.example/models",
        ])

    def test_model_list_falls_back_from_v1_base_to_plain_models_endpoint_for_relays(self):
        urlopen = SequenceUrlopen([
            (b"<html>not json</html>", 404),
            (json.dumps({"models": ["relay-model"]}).encode("utf-8"), 200),
        ])

        result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["relay-model"])
        self.assertEqual([request.full_url for request, _ in urlopen.requests], [
            "https://relay.example/v1/models",
            "https://relay.example/models",
        ])

    def test_model_list_falls_back_to_path_v1_models_endpoint_for_relays(self):
        urlopen = SequenceUrlopen([
            (b"<html>not json</html>", 404),
            (json.dumps({"models": ["relay-model"]}).encode("utf-8"), 200),
        ])

        result = list_model_options(
            {"baseUrl": "https://relay.example/openai", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["relay-model"])
        self.assertEqual([request.full_url for request, _ in urlopen.requests], [
            "https://relay.example/openai/models",
            "https://relay.example/openai/v1/models",
        ])

    def test_model_list_failure_reports_attempted_endpoints_without_leaking_key(self):
        urlopen = SequenceUrlopen([
            (b"<html>not json</html>", 404),
            (json.dumps({"data": []}).encode("utf-8"), 200),
        ])

        result = list_model_options(
            {"baseUrl": "https://relay.example", "apiKey": "sk-secret-key"},
            urlopen=urlopen,
        )

        self.assertFalse(result["ok"])
        self.assertIn("已尝试模型接口", result["message"])
        self.assertIn("https://relay.example/v1/models", result["message"])
        self.assertIn("https://relay.example/models", result["message"])
        self.assertIn("请确认 Base URL", result["message"])
        self.assertIn("API Key", result["message"])
        self.assertIn("/models", result["message"])
        self.assertNotIn("sk-secret-key", result["message"])

    def test_model_list_failure_returns_structured_diagnostics_without_leaking_key(self):
        urlopen = SequenceUrlopen([
            (b"<html>not json sk-secret-key</html>", 404),
            (json.dumps({"error": {"message": "bad key sk-secret-key"}}).encode("utf-8"), 401),
        ])

        result = list_model_options(
            {"baseUrl": "https://relay.example", "apiKey": "sk-secret-key"},
            urlopen=urlopen,
        )

        self.assertFalse(result["ok"])
        self.assertEqual(result["baseUrl"], "https://relay.example")
        self.assertEqual(result["attemptedEndpoints"], [
            "https://relay.example/v1/models",
            "https://relay.example/models",
        ])
        self.assertIn("HTTP 401", result["lastError"])
        self.assertNotIn("sk-secret-key", json.dumps(result, ensure_ascii=False))

    def test_model_list_accepts_common_relay_models_payload_shapes(self):
        urlopen = FakeUrlopen(
            json.dumps(
                {
                    "models": [
                        "relay-text",
                        {"id": "relay-chat"},
                        {"name": "relay-coder"},
                        {"model": "relay-vision"},
                    ]
                }
            ).encode("utf-8")
        )

        result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["relay-text", "relay-chat", "relay-coder", "relay-vision"])

    def test_model_list_accepts_relay_alias_model_fields(self):
        urlopen = FakeUrlopen(
            json.dumps(
                {
                    "available_models": [
                        "gpt-4o-mini",
                        {"id": "deepseek-chat"},
                    ],
                    "model_list": ["qwen-plus", {"name": "moonshot-v1-8k"}],
                }
            ).encode("utf-8")
        )

        result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["gpt-4o-mini", "deepseek-chat", "qwen-plus", "moonshot-v1-8k"])

    def test_model_list_accepts_common_relay_model_id_alias_fields(self):
        urlopen = FakeUrlopen(
            json.dumps(
                {
                    "models": [
                        {"model_id": "relay-model-id"},
                        {"model_name": "relay-model-name"},
                        {"slug": "provider/relay-slug"},
                    ]
                }
            ).encode("utf-8")
        )

        result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["relay-model-id", "relay-model-name", "provider/relay-slug"])

    def test_model_list_accepts_dropdown_style_model_value_fields(self):
        urlopen = FakeUrlopen(
            json.dumps(
                {
                    "models": [
                        {"value": "gpt-4.1-mini", "label": "GPT 4.1 Mini"},
                        {"key": "deepseek-chat", "title": "DeepSeek Chat"},
                        {"code": "moonshot-v1-8k", "text": "Moonshot"},
                    ]
                }
            ).encode("utf-8")
        )

        result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["gpt-4.1-mini", "deepseek-chat", "moonshot-v1-8k"])

    def test_model_list_accepts_display_only_relay_model_fields(self):
        urlopen = FakeUrlopen(
            json.dumps(
                {
                    "models": [
                        {"display_name": "Claude Sonnet 4"},
                        {"label": "OpenRouter Horizon Beta"},
                    ]
                }
            ).encode("utf-8")
        )

        result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["Claude Sonnet 4", "OpenRouter Horizon Beta"])

    def test_model_list_accepts_grouped_provider_model_payloads(self):
        urlopen = FakeUrlopen(
            json.dumps(
                {
                    "data": [
                        {
                            "provider": "OpenAI",
                            "models": [
                                {"id": "gpt-4.1-mini"},
                                {"value": "gpt-4.1"},
                            ],
                        },
                        {
                            "provider": "DeepSeek",
                            "items": ["deepseek-chat", {"model": "deepseek-reasoner"}],
                        },
                    ]
                }
            ).encode("utf-8")
        )

        result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["gpt-4.1-mini", "gpt-4.1", "deepseek-chat", "deepseek-reasoner"])

    def test_model_list_accepts_provider_children_and_group_options_payloads(self):
        urlopen = FakeUrlopen(
            json.dumps(
                {
                    "providers": [
                        {
                            "name": "OpenAI",
                            "children": [
                                {"value": "gpt-4.1-mini"},
                                {"key": "gpt-4.1"},
                            ],
                        }
                    ],
                    "groups": [
                        {
                            "title": "DeepSeek",
                            "options": [
                                {"code": "deepseek-chat"},
                                {"model": "deepseek-reasoner"},
                            ],
                        }
                    ],
                }
            ).encode("utf-8")
        )

        result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["gpt-4.1-mini", "gpt-4.1", "deepseek-chat", "deepseek-reasoner"])

    def test_model_list_accepts_provider_name_to_models_mapping_payloads(self):
        urlopen = FakeUrlopen(
            json.dumps(
                {
                    "data": {
                        "OpenAI": [
                            {"id": "gpt-4.1-mini"},
                            {"value": "gpt-4.1"},
                        ],
                        "DeepSeek": {
                            "chat": {"model": "deepseek-chat"},
                            "reasoner": {"name": "deepseek-reasoner"},
                        },
                        "metadata": {"total": 4},
                    }
                }
            ).encode("utf-8")
        )

        result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["gpt-4.1-mini", "gpt-4.1", "deepseek-chat", "deepseek-reasoner"])

    def test_model_list_accepts_paginated_records_payloads(self):
        urlopen = FakeUrlopen(
            json.dumps(
                {
                    "page": {
                        "records": [
                            {"id": "gpt-4.1-mini"},
                            {"value": "gpt-4.1"},
                        ],
                        "total": 2,
                    },
                    "data": {
                        "records": [
                            {"model": "deepseek-chat"},
                            {"code": "moonshot-v1-8k"},
                        ],
                        "current": 1,
                    },
                }
            ).encode("utf-8")
        )

        result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["gpt-4.1-mini", "gpt-4.1", "deepseek-chat", "moonshot-v1-8k"])

    def test_model_list_accepts_delimited_model_string_payloads(self):
        urlopen = FakeUrlopen(
            json.dumps(
                {
                    "models": "gpt-4.1-mini, deepseek-chat\nmoonshot-v1-8k",
                }
            ).encode("utf-8")
        )

        result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["gpt-4.1-mini", "deepseek-chat", "moonshot-v1-8k"])

    def test_model_list_accepts_result_and_items_payload_shapes(self):
        urlopen = FakeUrlopen(
            json.dumps(
                {
                    "result": {
                        "items": [
                            {"id": "gemini-2.5-pro"},
                            {"modelName": "claude-sonnet-4"},
                        ]
                    }
                }
            ).encode("utf-8")
        )

        result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["gemini-2.5-pro", "claude-sonnet-4"])

    def test_model_list_accepts_model_ids_as_object_keys(self):
        urlopen = FakeUrlopen(
            json.dumps(
                {
                    "data": {
                        "gpt-4.1-mini": {"owned_by": "relay"},
                        "deepseek-chat": {"context_length": 64000},
                    }
                }
            ).encode("utf-8")
        )

        result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["gpt-4.1-mini", "deepseek-chat"])

    def test_model_list_ignores_nested_relay_metadata_values(self):
        urlopen = FakeUrlopen(
            json.dumps(
                {
                    "data": {
                        "object": "list",
                        "has_more": False,
                        "models": [
                            {"id": "gpt-4.1-mini"},
                            {"name": "deepseek-chat"},
                        ],
                    }
                }
            ).encode("utf-8")
        )

        result = list_model_options(
            {"baseUrl": "https://relay.example/v1", "apiKey": "relay-key"},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["gpt-4.1-mini", "deepseek-chat"])

    def test_model_list_accepts_nested_local_model_payload_shapes(self):
        urlopen = FakeUrlopen(
            json.dumps(
                {
                    "models": {
                        "available": [
                            {"model": "qwen2.5-coder:7b"},
                            {"name": "deepseek-r1:8b"},
                        ],
                        "default": {"id": "local-default"},
                    }
                }
            ).encode("utf-8")
        )

        result = list_model_options(
            {"baseUrl": "http://127.0.0.1:11434/v1", "apiKey": ""},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["qwen2.5-coder:7b", "deepseek-r1:8b", "local-default"])

    def test_model_list_falls_back_to_ollama_tags_endpoint_for_local_base_url(self):
        urlopen = SequenceUrlopen([
            (b"<html>not found</html>", 404),
            (b"<html>not found</html>", 404),
            (json.dumps({"models": [{"name": "qwen2.5-coder:7b"}, {"model": "deepseek-r1:8b"}]}).encode("utf-8"), 200),
        ])

        result = list_model_options(
            {"baseUrl": "http://127.0.0.1:11434", "apiKey": ""},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["qwen2.5-coder:7b", "deepseek-r1:8b"])
        self.assertEqual([request.full_url for request, _ in urlopen.requests], [
            "http://127.0.0.1:11434/v1/models",
            "http://127.0.0.1:11434/models",
            "http://127.0.0.1:11434/api/tags",
        ])

    def test_model_list_accepts_ollama_tags_endpoint_as_base_url(self):
        urlopen = SequenceUrlopen([
            (b"<html>not found</html>", 404),
            (b"<html>not found</html>", 404),
            (json.dumps({"models": [{"name": "qwen2.5-coder:7b"}]}).encode("utf-8"), 200),
        ])

        result = list_model_options(
            {"baseUrl": "http://127.0.0.1:11434/api/tags", "apiKey": ""},
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["qwen2.5-coder:7b"])
        self.assertEqual([request.full_url for request, _ in urlopen.requests], [
            "http://127.0.0.1:11434/v1/models",
            "http://127.0.0.1:11434/models",
            "http://127.0.0.1:11434/api/tags",
        ])

    def test_tests_model_connection_without_leaking_api_key(self):
        body = json.dumps({"choices": [{"message": {"content": "连接正常"}}]}).encode("utf-8")
        urlopen = FakeUrlopen(body)

        result = test_model_connection(
            {
                "provider": "OpenAI 兼容",
                "baseUrl": "https://api.example.com/v1/",
                "apiKey": "sk-real-secret",
                "model": "test-model",
            },
            urlopen=urlopen,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["provider"], "OpenAI 兼容")
        self.assertEqual(result["model"], "test-model")
        self.assertEqual(result["baseUrl"], "https://api.example.com/v1")
        self.assertIn("连接测试通过", result["message"])
        self.assertNotIn("sk-real-secret", json.dumps(result, ensure_ascii=False))
        request, timeout = urlopen.requests[0]
        self.assertEqual(timeout, 15)
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["messages"][0]["content"], "请只回复：连接正常")


if __name__ == "__main__":
    unittest.main()
