import json
import threading
import unittest
from io import BytesIO
from urllib.error import HTTPError, URLError

from mcp_http_client import call_mcp_http


class FakeResponse:
    def __init__(self, body, status=200):
        self._body = body
        self.status = status
        self.code = status

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class McpHttpClientTests(unittest.TestCase):
    def test_posts_jsonrpc_payloads_and_collects_results(self):
        calls = []

        def fake_opener(request, timeout=0):
            calls.append((request, timeout))
            return FakeResponse(json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"tools": []}}).encode("utf-8"))

        result = call_mcp_http(
            "https://mcp.example.com/mcp",
            [
                {
                    "label": "List tools",
                    "payload": {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
                }
            ],
            opener=fake_opener,
            timeout=9,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["endpoint"], "https://mcp.example.com/mcp")
        self.assertEqual(result["results"][0]["status"], 200)
        self.assertEqual(result["results"][0]["response"]["result"], {"tools": []})
        self.assertEqual(calls[0][1], 9)
        self.assertEqual(calls[0][0].full_url, "https://mcp.example.com/mcp")
        self.assertEqual(calls[0][0].get_method(), "POST")
        self.assertEqual(calls[0][0].get_header("Content-type"), "application/json")
        self.assertEqual(json.loads(calls[0][0].data.decode("utf-8"))["method"], "tools/list")

    def test_builds_payload_from_method_when_payload_is_missing(self):
        bodies = []

        def fake_opener(request, timeout=0):
            bodies.append(json.loads(request.data.decode("utf-8")))
            return FakeResponse(b'{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')

        result = call_mcp_http(
            "http://127.0.0.1:8765/mcp",
            [{"label": "Initialize", "method": "initialize", "params": {"client": "ssh-agent-tool"}}],
            opener=fake_opener,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(bodies[0]["jsonrpc"], "2.0")
        self.assertEqual(bodies[0]["id"], 1)
        self.assertEqual(bodies[0]["method"], "initialize")
        self.assertEqual(bodies[0]["params"], {"client": "ssh-agent-tool"})

    def test_sends_custom_headers_to_mcp_endpoint(self):
        calls = []

        def fake_opener(request, timeout=0):
            calls.append(request)
            return FakeResponse(b'{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')

        result = call_mcp_http(
            "https://mcp.example.com/mcp",
            [{"method": "tools/list"}],
            headers=[
                {"name": "Authorization", "value": "Bearer token", "enabled": True},
                {"name": "X-Disabled", "value": "nope", "enabled": False},
            ],
            opener=fake_opener,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(calls[0].get_header("Authorization"), "Bearer token")
        self.assertIsNone(calls[0].get_header("X-disabled"))

    def test_rejects_non_http_endpoint_without_calling_opener(self):
        called = False

        def fake_opener(_request, timeout=0):
            nonlocal called
            called = True
            return FakeResponse(b"{}")

        result = call_mcp_http("mcp://prometheus", [{"method": "tools/list"}], opener=fake_opener)

        self.assertFalse(result["ok"])
        self.assertFalse(called)
        self.assertIn("HTTP", result["message"])

    def test_collects_http_and_transport_errors(self):
        def fake_opener(request, timeout=0):
            if request.full_url.startswith("https://"):
                raise HTTPError(request.full_url, 500, "Server Error", {}, BytesIO(b'{"error":"boom"}'))
            raise URLError("connection refused")

        http_result = call_mcp_http("https://mcp.example.com/mcp", [{"method": "tools/list"}], opener=fake_opener)
        network_result = call_mcp_http("http://127.0.0.1:8765/mcp", [{"method": "tools/list"}], opener=fake_opener)

        self.assertFalse(http_result["ok"])
        self.assertEqual(http_result["results"][0]["status"], 500)
        self.assertEqual(http_result["results"][0]["response"], {"error": "boom"})
        self.assertFalse(network_result["ok"])
        self.assertEqual(network_result["results"][0]["status"], 0)
        self.assertIn("connection refused", network_result["results"][0]["message"])

    def test_stops_before_next_request_when_cancelled(self):
        calls = []
        cancel_event = threading.Event()

        def fake_opener(request, timeout=0):
            calls.append(request)
            cancel_event.set()
            return FakeResponse(b'{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')

        result = call_mcp_http(
            "https://mcp.example.com/mcp",
            [{"method": "initialize"}, {"method": "tools/list"}],
            opener=fake_opener,
            cancel_event=cancel_event,
        )

        self.assertFalse(result["ok"])
        self.assertEqual(len(calls), 1)
        self.assertEqual(result["results"][1]["message"], "MCP HTTP 调用已取消。")


if __name__ == "__main__":
    unittest.main()
