import unittest
from urllib.error import URLError

from web_search import search_web


class FakeResponse:
    status = 200

    def __init__(self, text):
        self.text = text

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return self.text.encode("utf-8")


class WebSearchTest(unittest.TestCase):
    def test_search_web_extracts_duckduckgo_results_for_agent_context(self):
        calls = []

        def fake_urlopen(request, timeout=0):
            calls.append((request.full_url, timeout, dict(request.header_items())))
            return FakeResponse(
                """
                <html><body>
                  <a class="result__a" href="https://example.com/nginx-502">Nginx 502 排查</a>
                  <a class="result__snippet">检查 upstream、php-fpm 和错误日志。</a>
                  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.example.com%2Fnginx">官方文档</a>
                  <a class="result__snippet">Nginx proxy_next_upstream 说明。</a>
                </body></html>
                """
            )

        result = search_web("nginx 502 排查", urlopen=fake_urlopen, timeout=7, limit=2)

        self.assertTrue(result["ok"])
        self.assertIn("nginx+502", calls[0][0])
        self.assertEqual(calls[0][1], 7)
        self.assertEqual(result["results"][0]["title"], "Nginx 502 排查")
        self.assertEqual(result["results"][0]["url"], "https://example.com/nginx-502")
        self.assertEqual(result["provider"], "DuckDuckGo")
        self.assertEqual(result["results"][0]["source"], "DuckDuckGo")
        self.assertIn("搜索来源：DuckDuckGo", result["summary"])
        self.assertIn("upstream", result["summary"])
        self.assertIn("官方文档", result["summary"])

    def test_search_web_falls_back_to_bing_when_duckduckgo_has_no_results(self):
        calls = []

        def fake_urlopen(request, timeout=0):
            calls.append(request.full_url)
            if "duckduckgo.com" in request.full_url:
                return FakeResponse("<html><body>no usable results</body></html>")
            return FakeResponse(
                """
                <html><body>
                  <li class="b_algo">
                    <h2><a href="https://learn.example.com/ssh">Windows SSH 工具排查</a></h2>
                    <p>检查 SSH 会话、终端快捷键和连接日志。</p>
                  </li>
                </body></html>
                """
            )

        result = search_web("Windows SSH 工具", urlopen=fake_urlopen, timeout=7, limit=2)

        self.assertTrue(result["ok"])
        self.assertIn("duckduckgo.com", calls[0])
        self.assertIn("bing.com/search", calls[1])
        self.assertEqual(result["provider"], "Bing")
        self.assertEqual(result["results"][0]["source"], "Bing")
        self.assertEqual(result["results"][0]["title"], "Windows SSH 工具排查")
        self.assertEqual(result["results"][0]["url"], "https://learn.example.com/ssh")
        self.assertIn("终端快捷键", result["summary"])

    def test_search_web_falls_back_to_bing_when_duckduckgo_request_fails(self):
        calls = []

        def fake_urlopen(request, timeout=0):
            calls.append(request.full_url)
            if "duckduckgo.com" in request.full_url:
                raise URLError("duckduckgo unavailable")
            return FakeResponse(
                """
                <html><body>
                  <li class="b_algo">
                    <h2><a href="https://learn.example.com/nginx">Nginx 502 修复</a></h2>
                    <p>先检查 upstream、错误日志和服务状态。</p>
                  </li>
                </body></html>
                """
            )

        result = search_web("nginx 502", urlopen=fake_urlopen, timeout=7, limit=2)

        self.assertTrue(result["ok"])
        self.assertEqual(calls, [
            "https://duckduckgo.com/html/?q=nginx+502",
            "https://www.bing.com/search?q=nginx+502",
        ])
        self.assertEqual(result["provider"], "Bing")
        self.assertEqual(result["results"][0]["title"], "Nginx 502 修复")

    def test_search_web_rejects_empty_query_without_network(self):
        result = search_web("   ", urlopen=lambda *_args, **_kwargs: self.fail("should not call network"))

        self.assertFalse(result["ok"])
        self.assertEqual(result["results"], [])
        self.assertIn("搜索关键词不能为空", result["message"])


if __name__ == "__main__":
    unittest.main()
