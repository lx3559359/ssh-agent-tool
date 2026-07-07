from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from backend.api import routes  # noqa: E402


class FakeResponse:
    def __init__(self, content: str):
        self.content = content


@pytest.mark.asyncio
async def test_chat_title_uses_placeholder_key_for_local_ollama(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def ainvoke(self, messages):
            return FakeResponse("SSH 排障")

    monkeypatch.setattr(
        routes.UserConfig,
        "load",
        lambda: {
            "api_format": "openai",
            "base_url": "http://127.0.0.1:11434/v1",
            "api_key": "",
            "selected_model": "qwen2.5-coder:7b",
        },
    )
    monkeypatch.setattr(routes, "ChatOpenAI", FakeChatOpenAI)

    result = await routes.generate_title(
        routes.TitleRequest(messages=[{"role": "user", "content": "帮我分析 SSH 连接失败"}])
    )

    assert result == {"title": "SSH 排障"}
    assert captured["api_key"] == "ollama"
    assert captured["base_url"] == "http://127.0.0.1:11434/v1"


@pytest.mark.asyncio
async def test_chat_suggestions_use_placeholder_key_for_local_ollama(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def ainvoke(self, messages):
            return FakeResponse("查看错误日志\n检查端口监听\n测试凭据")

    monkeypatch.setattr(
        routes.UserConfig,
        "load",
        lambda: {
            "api_format": "openai",
            "base_url": "http://localhost:11434/v1",
            "api_key": "",
            "selected_model": "qwen2.5-coder:7b",
        },
    )
    monkeypatch.setattr(routes, "ChatOpenAI", FakeChatOpenAI)

    result = await routes.generate_suggestions(
        routes.SuggestionsRequest(messages=[{"role": "user", "content": "Nginx 502 怎么排查"}])
    )

    assert result == {"suggestions": ["查看错误日志", "检查端口监听", "测试凭据"]}
    assert captured["api_key"] == "ollama"
    assert captured["base_url"] == "http://localhost:11434/v1"


@pytest.mark.asyncio
async def test_chat_title_passes_safe_relay_headers_to_openai_client(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def ainvoke(self, messages):
            return FakeResponse("SSH 排障")

    monkeypatch.setattr(
        routes.UserConfig,
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
    monkeypatch.setattr(routes, "ChatOpenAI", FakeChatOpenAI)

    result = await routes.generate_title(
        routes.TitleRequest(messages=[{"role": "user", "content": "帮我分析 SSH 连接失败"}])
    )

    assert result == {"title": "SSH 排障"}
    assert captured["default_headers"] == {
        "HTTP-Referer": "https://ops.example.com",
        "X-Title": "SSH Agent Tool",
    }


@pytest.mark.asyncio
async def test_chat_suggestions_pass_safe_relay_headers_to_openai_client(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def ainvoke(self, messages):
            return FakeResponse("查看错误日志\n检查端口监听\n测试凭据")

    monkeypatch.setattr(
        routes.UserConfig,
        "load",
        lambda: {
            "api_format": "openai",
            "base_url": "https://openrouter.ai/api/v1",
            "api_key": "sk-relay",
            "selected_model": "openrouter-model",
            "extra_headers": [
                {"name": "HTTP-Referer", "value": "https://ops.example.com", "enabled": True},
                {"name": "X-Title", "value": "SSH Agent Tool", "enabled": True},
            ],
        },
    )
    monkeypatch.setattr(routes, "ChatOpenAI", FakeChatOpenAI)

    result = await routes.generate_suggestions(
        routes.SuggestionsRequest(messages=[{"role": "user", "content": "Nginx 502 怎么排查"}])
    )

    assert result == {"suggestions": ["查看错误日志", "检查端口监听", "测试凭据"]}
    assert captured["default_headers"] == {
        "HTTP-Referer": "https://ops.example.com",
        "X-Title": "SSH Agent Tool",
    }


@pytest.mark.asyncio
async def test_stream_test_passes_safe_relay_headers_to_openai_client(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def astream(self, messages):
            yield FakeResponse("OK")

    monkeypatch.setattr(routes, "ChatOpenAI", FakeChatOpenAI)

    response = await routes.stream_test(
        routes.StreamTestRequest(
            base_url="https://openrouter.ai/api/v1",
            api_key="sk-relay",
            api_format="openai",
            model="openrouter-model",
            extraHeaders=[
                {"name": "HTTP-Referer", "value": "https://ops.example.com", "enabled": True},
                {"name": "X-Title", "value": "SSH Agent Tool", "enabled": True},
                {"name": "Authorization", "value": "Bearer wrong", "enabled": True},
            ],
        )
    )

    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk)

    assert any("OK" in chunk for chunk in chunks)
    assert captured["default_headers"] == {
        "HTTP-Referer": "https://ops.example.com",
        "X-Title": "SSH Agent Tool",
    }
    assert captured["api_key"] == "sk-relay"
