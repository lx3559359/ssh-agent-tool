import json
from urllib.parse import parse_qs, urlparse

from backend.agent.tools import monitoring


class FakeResponse:
    def __init__(self, body: bytes):
        self.body = body

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class FakeOpener:
    def __init__(self, payload):
        self.payload = payload
        self.requests = []

    def __call__(self, request, timeout=0):
        self.requests.append((request, timeout))
        return FakeResponse(json.dumps(self.payload, ensure_ascii=False).encode("utf-8"))


def test_prometheus_tool_explains_missing_real_endpoint():
    result = monitoring.query_prometheus_text(
        "up",
        environ={},
        opener=FakeOpener({"status": "success", "data": {"result": []}}),
    )

    assert "未配置 Prometheus" in result
    assert "SSH_AGENT_PROMETHEUS_URL" in result
    assert "Mock" not in result


def test_prometheus_tool_queries_configured_endpoint_and_formats_results():
    opener = FakeOpener(
        {
            "status": "success",
            "data": {
                "result": [
                    {"metric": {"instance": "prod-web-01", "job": "node"}, "value": [1719720000, "0.42"]},
                    {"metric": {"instance": "prod-db-01"}, "value": [1719720000, "0.81"]},
                ]
            },
        }
    )

    result = monitoring.query_prometheus_text(
        'rate(node_cpu_seconds_total{mode!="idle"}[5m])',
        environ={"SSH_AGENT_PROMETHEUS_URL": "https://prom.example.com"},
        opener=opener,
        timeout=6,
    )

    request, timeout = opener.requests[0]
    parsed = urlparse(request.full_url)
    assert parsed.geturl().startswith("https://prom.example.com/api/v1/query?")
    assert parse_qs(parsed.query)["query"] == ['rate(node_cpu_seconds_total{mode!="idle"}[5m])']
    assert timeout == 6
    assert "prod-web-01" in result
    assert "0.42" in result
    assert "prod-db-01" in result


def test_log_search_tool_queries_configured_endpoint_and_formats_hits():
    opener = FakeOpener(
        {
            "hits": [
                {"timestamp": "2026-06-30T12:00:00Z", "message": "nginx upstream timed out"},
                {"time": "2026-06-30T12:01:00Z", "line": "connect() failed"},
            ]
        }
    )

    result = monitoring.search_logs_text(
        "nginx",
        "timeout",
        environ={"SSH_AGENT_LOG_SEARCH_URL": "https://logs.example.com/search"},
        opener=opener,
        timeout=5,
    )

    request, timeout = opener.requests[0]
    parsed = urlparse(request.full_url)
    query = parse_qs(parsed.query)
    assert parsed.geturl().startswith("https://logs.example.com/search?")
    assert query["service"] == ["nginx"]
    assert query["keywords"] == ["timeout"]
    assert timeout == 5
    assert "nginx upstream timed out" in result
    assert "connect() failed" in result
