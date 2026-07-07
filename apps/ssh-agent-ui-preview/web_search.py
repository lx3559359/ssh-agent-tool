from __future__ import annotations

import html
import re
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote_plus, unquote, urlparse
from urllib.request import Request, urlopen as default_urlopen


def search_web(query: str, urlopen=None, timeout: int = 10, limit: int = 5) -> dict:
    safe_query = str(query or "").strip()
    if not safe_query:
        return {"ok": False, "query": "", "results": [], "summary": "", "message": "搜索关键词不能为空。"}

    providers = [
        {
            "name": "DuckDuckGo",
            "url": f"https://duckduckgo.com/html/?q={quote_plus(safe_query)}",
            "parser": parse_duckduckgo_html,
        },
        {
            "name": "Bing",
            "url": f"https://www.bing.com/search?q={quote_plus(safe_query)}",
            "parser": parse_bing_html,
        },
    ]
    last_message = ""
    for provider in providers:
        request = Request(
            provider["url"],
            headers={
                "User-Agent": "Mozilla/5.0 SSH-Agent-Tool",
                "Accept": "text/html,application/xhtml+xml",
            },
            method="GET",
        )
        try:
            with (urlopen or default_urlopen)(request, timeout=timeout) as response:
                status = int(getattr(response, "status", 200) or 200)
                text = response.read().decode("utf-8", errors="replace")
                if status >= 400:
                    last_message = f"{provider['name']} HTTP {status}"
                    continue
                results = provider["parser"](text, limit=limit)
                if not results:
                    last_message = f"{provider['name']} 未返回可用结果"
                    continue
                for item in results:
                    item["source"] = provider["name"]
                return {
                    "ok": True,
                    "query": safe_query,
                    "provider": provider["name"],
                    "results": results,
                    "summary": format_search_summary(safe_query, results, provider=provider["name"]),
                    "message": f"联网搜索完成，找到 {len(results)} 条结果。",
                }
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
            last_message = f"{provider['name']} 失败：{error}"
            continue
    return {"ok": False, "query": safe_query, "results": [], "summary": "", "message": f"联网搜索未返回可用结果。{last_message}"}


def parse_duckduckgo_html(text: str, limit: int = 5) -> list[dict]:
    titles = list(re.finditer(r'<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', text or "", re.I | re.S))
    snippets = list(re.finditer(r'<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>|<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</div>', text or "", re.I | re.S))
    results = []
    for index, match in enumerate(titles):
        title = clean_html(match.group(2))
        url = normalize_result_url(match.group(1))
        snippet_match = snippets[index] if index < len(snippets) else None
        snippet = clean_html(snippet_match.group(1) or snippet_match.group(2)) if snippet_match else ""
        if title and url:
            results.append({"title": title, "url": url, "snippet": snippet})
        if len(results) >= max(1, int(limit or 1)):
            break
    return results


def parse_bing_html(text: str, limit: int = 5) -> list[dict]:
    blocks = re.finditer(r'<li[^>]+class="[^"]*b_algo[^"]*"[^>]*>(.*?)</li>', text or "", re.I | re.S)
    results = []
    for block in blocks:
        html_block = block.group(1)
        title_match = re.search(r"<h2[^>]*>\s*<a[^>]+href=\"([^\"]+)\"[^>]*>(.*?)</a>\s*</h2>", html_block, re.I | re.S)
        if not title_match:
            continue
        snippet_match = re.search(r"<p[^>]*>(.*?)</p>", html_block, re.I | re.S)
        title = clean_html(title_match.group(2))
        url = normalize_result_url(title_match.group(1))
        snippet = clean_html(snippet_match.group(1)) if snippet_match else ""
        if title and url:
            results.append({"title": title, "url": url, "snippet": snippet})
        if len(results) >= max(1, int(limit or 1)):
            break
    return results


def clean_html(value: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", str(value or ""))
    return re.sub(r"\s+", " ", html.unescape(without_tags)).strip()


def normalize_result_url(value: str) -> str:
    url = html.unescape(str(value or "").strip())
    if url.startswith("//duckduckgo.com/l/"):
        parsed = urlparse("https:" + url)
        target = parse_qs(parsed.query).get("uddg", [""])[0]
        return unquote(target).strip()
    return url


def format_search_summary(query: str, results: list[dict], provider: str = "") -> str:
    lines = [f"联网搜索结果：{query}"]
    if provider:
        lines.append(f"搜索来源：{provider}")
    for index, item in enumerate(results, start=1):
        lines.append(f"{index}. {item['title']}")
        lines.append(f"   链接：{item['url']}")
        if item.get("snippet"):
            lines.append(f"   摘要：{item['snippet']}")
    return "\n".join(lines)
