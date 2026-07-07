from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def call_mcp_http(endpoint: str, requests: list, timeout: int = 15, headers: list | None = None, opener=None, cancel_event=None) -> dict:
    safe_endpoint = str(endpoint or "").strip()
    parsed = urlparse(safe_endpoint)
    if parsed.scheme.lower() not in {"http", "https"}:
        return {
            "ok": False,
            "endpoint": safe_endpoint,
            "results": [],
            "message": "MCP HTTP caller only supports HTTP/HTTPS endpoints.",
        }

    safe_requests = requests if isinstance(requests, list) else []
    sender = opener or urlopen
    safe_timeout = _coerce_timeout(timeout)
    results = []

    for index, item in enumerate(safe_requests):
        if cancel_event is not None and cancel_event.is_set():
            results.append(
                {
                    "ok": False,
                    "label": f"request-{index + 1}",
                    "method": "",
                    "status": 0,
                    "response": None,
                    "message": "MCP HTTP 调用已取消。",
                }
            )
            break
        request_item = item if isinstance(item, dict) else {}
        payload = _build_payload(index + 1, request_item)
        label = str(request_item.get("label") or request_item.get("method") or f"request-{index + 1}")
        method = str(payload.get("method") or request_item.get("method") or "")
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        http_request = Request(
            safe_endpoint,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                **_normalize_headers(headers),
            },
        )

        try:
            with sender(http_request, timeout=safe_timeout) as response:
                status = _response_status(response)
                parsed_response = _parse_response_body(response.read())
                item_ok = 200 <= status < 300 and not _has_jsonrpc_error(parsed_response)
                results.append(
                    {
                        "ok": item_ok,
                        "label": label,
                        "method": method,
                        "status": status,
                        "response": parsed_response,
                        "message": "ok" if item_ok else "MCP JSON-RPC response contains an error.",
                    }
                )
        except HTTPError as exc:
            results.append(
                {
                    "ok": False,
                    "label": label,
                    "method": method,
                    "status": int(exc.code or 0),
                    "response": _parse_response_body(exc.read()),
                    "message": str(exc.reason or exc),
                }
            )
        except (URLError, OSError, TimeoutError, ValueError) as exc:
            results.append(
                {
                    "ok": False,
                    "label": label,
                    "method": method,
                    "status": 0,
                    "response": None,
                    "message": str(getattr(exc, "reason", exc)),
                }
            )

    ok_count = sum(1 for result in results if result.get("ok"))
    total = len(results)
    all_ok = total > 0 and ok_count == total
    return {
        "ok": all_ok,
        "endpoint": safe_endpoint,
        "results": results,
        "message": f"MCP HTTP calls completed: {ok_count}/{total} succeeded.",
    }


def _build_payload(request_id: int, request_item: dict) -> dict:
    payload = request_item.get("payload")
    if isinstance(payload, dict):
        return payload

    params = request_item.get("params")
    return {
        "jsonrpc": "2.0",
        "id": request_item.get("id", request_id),
        "method": str(request_item.get("method") or ""),
        "params": params if isinstance(params, dict) else {},
    }


def _coerce_timeout(timeout: Any) -> int:
    try:
        value = int(timeout)
    except (TypeError, ValueError):
        value = 15
    return min(max(value, 3), 60)


def _normalize_headers(headers: list | None) -> dict:
    normalized = {}
    for item in headers if isinstance(headers, list) else []:
        if not isinstance(item, dict) or item.get("enabled") is False:
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        normalized[name] = str(item.get("value") or "")
    return normalized


def _response_status(response) -> int:
    try:
        return int(getattr(response, "status", getattr(response, "code", 200)))
    except (TypeError, ValueError):
        return 200


def _parse_response_body(raw_body: bytes) -> Any:
    text = raw_body.decode("utf-8", errors="replace") if isinstance(raw_body, bytes) else str(raw_body or "")
    if not text.strip():
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _has_jsonrpc_error(response: Any) -> bool:
    return isinstance(response, dict) and response.get("error") is not None
