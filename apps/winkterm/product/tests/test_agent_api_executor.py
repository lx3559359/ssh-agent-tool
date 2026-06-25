from io import BytesIO
import json
from urllib import error

import pytest

from product.diagnose.executors import AgentApiExecutor


class _FakeResponse:
    def __init__(self, payload: bytes):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return self._payload


def test_agent_api_executor_posts_command_and_maps_dict_response(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout):
        captured["url"] = req.full_url
        captured["body"] = json.loads(req.data.decode("utf-8"))
        captured["content_type"] = req.get_header("Content-type")
        captured["accept"] = req.get_header("Accept")
        captured["authorization"] = req.get_header("Authorization")
        captured["timeout"] = timeout
        return _FakeResponse(
            json.dumps(
                {
                    "exit_code": 0,
                    "stdout": "ok\n",
                    "duration_ms": 25,
                    "reason": "timeout",
                }
            ).encode("utf-8")
        )

    monkeypatch.setattr("product.diagnose.executors.request.urlopen", fake_urlopen)

    response = AgentApiExecutor(
        "https://agent.example",
        "conn/1",
        token="secret",
    ).run("uptime", 10)

    assert captured == {
        "url": "https://agent.example/api/agent/ssh/conn%2F1/run",
        "body": {"command": "uptime", "timeout": 10},
        "content_type": "application/json; charset=utf-8",
        "accept": "application/json",
        "authorization": "Bearer secret",
        "timeout": 25,
    }
    assert response.exit_code == 0
    assert response.stdout == "ok\n"
    assert response.message == ""
    assert response.duration_ms == 25
    assert response.timed_out is True


def test_agent_api_executor_omits_authorization_for_empty_token(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout):
        captured["authorization"] = req.get_header("Authorization")
        return _FakeResponse(b"{}")

    monkeypatch.setattr("product.diagnose.executors.request.urlopen", fake_urlopen)

    response = AgentApiExecutor("https://agent.example", "conn-1", token="").run(
        "uptime",
        10,
    )

    assert captured["authorization"] is None
    assert response.exit_code is None
    assert response.stdout == ""
    assert response.message == ""
    assert response.timed_out is False


@pytest.mark.parametrize("payload", [b"[]", b'"ok"', b"1", b"null"])
def test_agent_api_executor_rejects_non_object_json(monkeypatch, payload):
    monkeypatch.setattr(
        "product.diagnose.executors.request.urlopen",
        lambda req, timeout: _FakeResponse(payload),
    )

    with pytest.raises(RuntimeError, match="JSON 格式不符合预期"):
        AgentApiExecutor("https://agent.example", "conn-1").run("uptime", 10)


def test_agent_api_executor_wraps_invalid_json(monkeypatch):
    monkeypatch.setattr(
        "product.diagnose.executors.request.urlopen",
        lambda req, timeout: _FakeResponse(b"{not-json"),
    )

    with pytest.raises(RuntimeError, match="SSH 命令接口.*JSON"):
        AgentApiExecutor("https://agent.example", "conn-1").run("uptime", 10)


def test_agent_api_executor_wraps_unicode_decode_error(monkeypatch):
    monkeypatch.setattr(
        "product.diagnose.executors.request.urlopen",
        lambda req, timeout: _FakeResponse(b"\xff"),
    )

    with pytest.raises(RuntimeError, match="SSH 命令接口.*UTF-8"):
        AgentApiExecutor("https://agent.example", "conn-1").run("uptime", 10)


def test_agent_api_executor_wraps_http_error(monkeypatch):
    def fake_urlopen(req, timeout):
        raise error.HTTPError(
            req.full_url,
            502,
            "Bad Gateway",
            hdrs=None,
            fp=BytesIO("上游异常".encode("utf-8")),
        )

    monkeypatch.setattr("product.diagnose.executors.request.urlopen", fake_urlopen)

    with pytest.raises(RuntimeError, match="SSH 命令接口调用失败.*HTTP 502"):
        AgentApiExecutor("https://agent.example", "conn-1").run("uptime", 10)


def test_agent_api_executor_wraps_url_error(monkeypatch):
    def fake_urlopen(req, timeout):
        raise error.URLError("network down")

    monkeypatch.setattr("product.diagnose.executors.request.urlopen", fake_urlopen)

    with pytest.raises(RuntimeError, match="SSH 命令接口调用失败"):
        AgentApiExecutor("https://agent.example", "conn-1").run("uptime", 10)
