"""Monitoring and analysis tool module used by the out-of-terminal Agent."""

from __future__ import annotations

import json
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from langchain_core.tools import tool


def query_prometheus_text(query: str, *, environ=None, opener=None, timeout: int = 8) -> str:
    env = environ if isinstance(environ, dict) else os.environ
    base_url = str(env.get("SSH_AGENT_PROMETHEUS_URL") or "").strip().rstrip("/")
    if not base_url:
        return "未配置 Prometheus。请设置 SSH_AGENT_PROMETHEUS_URL 后再查询真实指标。"

    endpoint = base_url if base_url.endswith("/api/v1/query") else f"{base_url}/api/v1/query"
    request_url = f"{endpoint}?{urlencode({'query': str(query or '').strip()})}"
    headers = _auth_headers(env.get("SSH_AGENT_PROMETHEUS_TOKEN"))
    try:
        with (opener or urlopen)(Request(request_url, headers=headers), timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
        return _format_prometheus_result(str(query or "").strip(), payload)
    except Exception as error:
        return f"Prometheus 查询失败：{error}"


def search_logs_text(service: str, keywords: str = "", *, environ=None, opener=None, timeout: int = 8) -> str:
    env = environ if isinstance(environ, dict) else os.environ
    endpoint = str(env.get("SSH_AGENT_LOG_SEARCH_URL") or "").strip()
    if not endpoint:
        return "未配置日志搜索接口。请设置 SSH_AGENT_LOG_SEARCH_URL 后再查询真实日志。"

    params = {"service": str(service or "").strip(), "keywords": str(keywords or "").strip()}
    separator = "&" if "?" in endpoint else "?"
    request_url = f"{endpoint}{separator}{urlencode(params)}"
    headers = _auth_headers(env.get("SSH_AGENT_LOG_SEARCH_TOKEN"))
    try:
        with (opener or urlopen)(Request(request_url, headers=headers), timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
        return _format_log_search_result(params["service"], params["keywords"], payload)
    except Exception as error:
        return f"日志搜索失败：{error}"


@tool
def query_prometheus(query: str) -> str:
    """Query Prometheus metrics.

    Args:
        query: PromQL query statement
    """
    return query_prometheus_text(query)


@tool
def search_logs(service: str, keywords: str = "") -> str:
    """Search logs through a configured Loki/ELK-compatible HTTP endpoint.

    Args:
        service: service name
        keywords: search keywords
    """
    return search_logs_text(service, keywords)


def _auth_headers(token) -> dict:
    token_text = str(token or "").strip()
    return {"Authorization": f"Bearer {token_text}"} if token_text else {}


def _format_prometheus_result(query: str, payload: dict) -> str:
    data = payload.get("data") if isinstance(payload, dict) else {}
    rows = data.get("result") if isinstance(data, dict) else []
    if not isinstance(rows, list) or not rows:
        return f"Prometheus 查询完成，但没有返回数据。\n查询：{query}"

    lines = [f"Prometheus 查询：{query}", f"返回 {len(rows)} 条结果："]
    for row in rows[:20]:
        metric = row.get("metric") if isinstance(row, dict) else {}
        value = row.get("value") if isinstance(row, dict) else None
        lines.append(f"- {_format_metric_labels(metric)}: {_format_prometheus_value(value)}")
    if len(rows) > 20:
        lines.append(f"... 已截断，仅显示前 20 条，共 {len(rows)} 条。")
    return "\n".join(lines)


def _format_metric_labels(metric) -> str:
    if not isinstance(metric, dict) or not metric:
        return "metric"
    preferred = [key for key in ("instance", "job", "pod", "service", "name") if metric.get(key)]
    keys = preferred or list(metric.keys())[:3]
    return ", ".join(f"{key}={metric.get(key)}" for key in keys)


def _format_prometheus_value(value) -> str:
    if isinstance(value, list) and len(value) >= 2:
        return str(value[1])
    return str(value)


def _format_log_search_result(service: str, keywords: str, payload: dict) -> str:
    hits = _extract_log_hits(payload)
    if not hits:
        return f"日志搜索完成，但没有匹配记录。\n服务：{service or '--'}\n关键字：{keywords or '--'}"

    lines = [f"日志搜索：服务={service or '--'}，关键字={keywords or '--'}", f"返回 {len(hits)} 条记录："]
    for item in hits[:20]:
        timestamp, message = _format_log_hit(item)
        lines.append(f"- {timestamp} {message}".strip())
    if len(hits) > 20:
        lines.append(f"... 已截断，仅显示前 20 条，共 {len(hits)} 条。")
    return "\n".join(lines)


def _extract_log_hits(payload) -> list:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("hits", "results", "logs", "items", "data"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            nested = _extract_log_hits(value)
            if nested:
                return nested
    return []


def _format_log_hit(item) -> tuple[str, str]:
    if isinstance(item, str):
        return "", item
    if not isinstance(item, dict):
        return "", str(item)
    timestamp = str(item.get("timestamp") or item.get("time") or item.get("@timestamp") or "").strip()
    message = str(item.get("message") or item.get("line") or item.get("log") or item.get("content") or item).strip()
    return timestamp, message


MONITORING_TOOLS = [query_prometheus, search_logs]
