from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.api.routes import (  # noqa: E402
    build_model_list_endpoints,
    build_model_list_headers,
    extract_model_list,
    format_model_list_error_message,
    model_api_requires_key,
    resolve_model_api_key_for_request,
    SettingsModel,
)


def test_openai_model_list_endpoints_accept_root_or_v1_base_url() -> None:
    assert build_model_list_endpoints("https://api.aigh.store", "openai") == [
        "https://api.aigh.store/v1/models",
        "https://api.aigh.store/models",
    ]
    assert build_model_list_endpoints("https://api.aigh.store/v1", "openai") == [
        "https://api.aigh.store/v1/models",
        "https://api.aigh.store/models",
    ]


def test_model_list_endpoints_strip_common_request_suffixes() -> None:
    assert build_model_list_endpoints("https://relay.example/openai/v1/chat/completions", "openai") == [
        "https://relay.example/openai/v1/models",
        "https://relay.example/openai/models",
    ]
    assert build_model_list_endpoints("https://relay.example/openai/v1/models", "openai") == [
        "https://relay.example/openai/v1/models",
        "https://relay.example/openai/models",
    ]


def test_model_list_endpoints_support_native_ollama_tags() -> None:
    assert build_model_list_endpoints("http://127.0.0.1:11434", "openai") == [
        "http://127.0.0.1:11434/v1/models",
        "http://127.0.0.1:11434/models",
        "http://127.0.0.1:11434/api/tags",
    ]
    assert build_model_list_endpoints("http://localhost:11434/v1/models", "openai") == [
        "http://localhost:11434/v1/models",
        "http://localhost:11434/models",
        "http://localhost:11434/api/tags",
    ]
    assert build_model_list_endpoints("http://127.0.0.1:11434/api/tags", "openai") == [
        "http://127.0.0.1:11434/v1/models",
        "http://127.0.0.1:11434/models",
        "http://127.0.0.1:11434/api/tags",
    ]


def test_extract_model_list_accepts_openai_plain_and_proxy_shapes() -> None:
    assert extract_model_list({"data": [{"id": "gpt-4.1-mini"}, {"id": "qwen-plus"}]}) == [
        {"id": "gpt-4.1-mini", "name": "gpt-4.1-mini"},
        {"id": "qwen-plus", "name": "qwen-plus"},
    ]
    assert extract_model_list({"models": [{"name": "deepseek-chat"}, "moonshot-v1-8k"]}) == [
        {"id": "deepseek-chat", "name": "deepseek-chat"},
        {"id": "moonshot-v1-8k", "name": "moonshot-v1-8k"},
    ]
    assert extract_model_list(["glm-4.5", {"id": "local-model", "name": "Local Model"}]) == [
        {"id": "glm-4.5", "name": "glm-4.5"},
        {"id": "local-model", "name": "Local Model"},
    ]


def test_extract_model_list_accepts_nested_proxy_shapes() -> None:
    assert extract_model_list({"result": {"models": [{"id": "relay-gpt"}, {"model": "relay-qwen"}]}}) == [
        {"id": "relay-gpt", "name": "relay-gpt"},
        {"id": "relay-qwen", "name": "relay-qwen"},
    ]
    assert extract_model_list({"data": {"items": [{"name": "nested-deepseek"}]}}) == [
        {"id": "nested-deepseek", "name": "nested-deepseek"},
    ]
    assert extract_model_list({"data": {"list": [{"id": "relay-list-gpt"}, {"name": "relay-list-qwen"}]}}) == [
        {"id": "relay-list-gpt", "name": "relay-list-gpt"},
        {"id": "relay-list-qwen", "name": "relay-list-qwen"},
    ]


def test_extract_model_list_accepts_nonstandard_relay_choice_fields() -> None:
    assert extract_model_list({
        "model_list": [
            {"id": "relay-model-list-a"},
            {"model": "relay-model-list-b"},
        ],
    }) == [
        {"id": "relay-model-list-a", "name": "relay-model-list-a"},
        {"id": "relay-model-list-b", "name": "relay-model-list-b"},
    ]
    assert extract_model_list({
        "result": {
            "choices": [
                {"value": "choice-gpt", "label": "Choice GPT"},
                {"displayName": "Display Name Only"},
            ],
        },
    }) == [
        {"id": "choice-gpt", "name": "Choice GPT"},
        {"id": "Display Name Only", "name": "Display Name Only"},
    ]


def test_extract_model_list_accepts_additional_relay_collection_fields() -> None:
    assert extract_model_list({
        "available_models": [
            {"id": "relay-available-a"},
            {"modelId": "relay-model-id-b", "displayName": "Relay Model Id B"},
        ],
    }) == [
        {"id": "relay-available-a", "name": "relay-available-a"},
        {"id": "relay-model-id-b", "name": "Relay Model Id B"},
    ]
    assert extract_model_list({
        "response": {
            "records": [
                {"uid": "relay-record-a", "title": "Relay Record A"},
                {"key": "relay-record-b"},
            ],
        },
    }) == [
        {"id": "relay-record-a", "name": "Relay Record A"},
        {"id": "relay-record-b", "name": "relay-record-b"},
    ]


def test_extract_model_list_accepts_ollama_tags_shape() -> None:
    assert extract_model_list({"models": [{"name": "qwen2.5-coder:7b"}, {"model": "llama3.1:8b"}]}) == [
        {"id": "qwen2.5-coder:7b", "name": "qwen2.5-coder:7b"},
        {"id": "llama3.1:8b", "name": "llama3.1:8b"},
    ]


def test_extract_model_list_accepts_relay_alias_fields() -> None:
    assert extract_model_list({
        "data": [
            {"model_id": "anthropic/claude-sonnet-4", "display_name": "Claude Sonnet 4"},
            {"slug": "openrouter/horizon-beta", "label": "OpenRouter Horizon Beta"},
            {"display_name": "Display Only Model"},
            {"label": "Label Only Model"},
        ],
    }) == [
        {"id": "anthropic/claude-sonnet-4", "name": "Claude Sonnet 4"},
        {"id": "openrouter/horizon-beta", "name": "OpenRouter Horizon Beta"},
        {"id": "Display Only Model", "name": "Display Only Model"},
        {"id": "Label Only Model", "name": "Label Only Model"},
    ]


def test_extract_model_list_accepts_camel_case_display_name_fields() -> None:
    assert extract_model_list({
        "models": [
            {"name": "models/gemini-2.5-pro", "displayName": "Gemini 2.5 Pro"},
            {"model": "relay-gpt", "displayName": "Relay GPT"},
        ],
    }) == [
        {"id": "models/gemini-2.5-pro", "name": "Gemini 2.5 Pro"},
        {"id": "relay-gpt", "name": "Relay GPT"},
    ]


def test_format_model_list_error_message_explains_non_json_html_without_dumping_page() -> None:
    message = format_model_list_error_message(
        "https://relay.example/v1/models",
        status_code=200,
        response_text="<html><body>login page with a very long body</body></html>",
    )

    assert "不是有效 JSON" in message
    assert "HTML" in message
    assert "Base URL" in message
    assert "https://relay.example/v1/models" in message
    assert "<html><body>" not in message


def test_format_model_list_error_message_explains_auth_status_codes() -> None:
    message = format_model_list_error_message(
        "https://relay.example/v1/models",
        status_code=401,
        response_text='{"error":"invalid api key"}',
    )

    assert "401" in message
    assert "API Key" in message
    assert "Header" in message


def test_model_list_headers_omit_empty_authorization_for_local_ollama() -> None:
    assert build_model_list_headers("openai", "", "http://127.0.0.1:11434/api/tags") == {}
    assert build_model_list_headers("openai", "sk-relay", "https://relay.example/v1") == {
        "Authorization": "Bearer sk-relay",
    }
    assert build_model_list_headers("anthropic", "", "https://api.anthropic.com") == {
        "anthropic-version": "2023-06-01",
    }


def test_model_list_headers_include_safe_relay_metadata_headers() -> None:
    headers = build_model_list_headers(
        "openai",
        "sk-relay",
        "https://openrouter.ai/api/v1",
        [
            {"name": "HTTP-Referer", "value": "https://ops.example.com", "enabled": True},
            {"name": "X-Title", "value": "SSH Agent Tool", "enabled": True},
            {"name": "X-Disabled", "value": "nope", "enabled": False},
            {"name": "Authorization", "value": "Bearer wrong", "enabled": True},
            {"name": "X-API-Key", "value": "wrong", "enabled": True},
            {"name": "Bad Header", "value": "wrong", "enabled": True},
        ],
    )

    assert headers == {
        "HTTP-Referer": "https://ops.example.com",
        "X-Title": "SSH Agent Tool",
        "Authorization": "Bearer sk-relay",
    }


def test_local_ollama_stream_test_can_run_without_user_api_key() -> None:
    assert model_api_requires_key("openai", "http://127.0.0.1:11434") is False
    assert model_api_requires_key("openai", "http://localhost:11434/v1") is False
    assert resolve_model_api_key_for_request("openai", "http://127.0.0.1:11434", "") == "ollama"


def test_remote_model_apis_still_require_user_api_key() -> None:
    assert model_api_requires_key("openai", "https://relay.example/v1") is True
    assert model_api_requires_key("anthropic", "https://api.anthropic.com") is True
    assert resolve_model_api_key_for_request("openai", "https://relay.example/v1", "sk-relay") == "sk-relay"


def test_settings_model_accepts_extra_headers_for_saved_model_api_profiles() -> None:
    settings = SettingsModel(
        base_url="https://openrouter.ai/api/v1",
        api_key="sk-relay",
        extraHeaders=[
            {"name": "HTTP-Referer", "value": "https://ops.example.com", "enabled": True},
            {"name": "X-Title", "value": "SSH Agent Tool", "enabled": True},
        ],
    )

    assert [item.model_dump() for item in settings.extra_headers or []] == [
        {"name": "HTTP-Referer", "value": "https://ops.example.com", "enabled": True},
        {"name": "X-Title", "value": "SSH Agent Tool", "enabled": True},
    ]
