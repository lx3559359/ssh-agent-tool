from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.agent.core import builder as agent_builder  # noqa: E402


def test_agent_builder_uses_placeholder_key_for_local_ollama(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        def bind_tools(self, tools):
            return self

    monkeypatch.setattr(
        agent_builder.UserConfig,
        "load",
        lambda: {
            "api_format": "openai",
            "base_url": "http://127.0.0.1:11434/v1",
            "api_key": "",
            "selected_model": "qwen2.5-coder:7b",
        },
    )
    monkeypatch.setattr(agent_builder, "ChatOpenAI", FakeChatOpenAI)

    agent_builder.AgentBuilder("test", "system", [], model="default")._build_llm()

    assert captured["api_key"] == "ollama"
    assert captured["base_url"] == "http://127.0.0.1:11434/v1"
    assert captured["model"] == "qwen2.5-coder:7b"


def test_agent_builder_passes_safe_relay_headers_to_openai_client(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        def bind_tools(self, tools):
            return self

    monkeypatch.setattr(
        agent_builder.UserConfig,
        "load",
        lambda: {
            "api_format": "openai",
            "base_url": "https://openrouter.ai/api/v1",
            "api_key": "sk-relay",
            "selected_model": "openrouter-model",
            "extra_headers": [
                {"name": "HTTP-Referer", "value": "https://ops.example.com", "enabled": True},
                {"name": "X-Title", "value": "SSH Agent Tool", "enabled": True},
                {"name": "Authorization", "value": "Bearer wrong", "enabled": True},
            ],
        },
    )
    monkeypatch.setattr(agent_builder, "ChatOpenAI", FakeChatOpenAI)

    agent_builder.AgentBuilder("test", "system", [], model="default")._build_llm()

    assert captured["default_headers"] == {
        "HTTP-Referer": "https://ops.example.com",
        "X-Title": "SSH Agent Tool",
    }
    assert captured["api_key"] == "sk-relay"
