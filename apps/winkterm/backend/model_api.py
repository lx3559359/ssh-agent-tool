from __future__ import annotations

from typing import Any, Literal


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _strip_model_request_suffix(base_url: str) -> str:
    url = (base_url or "").strip().rstrip("/")
    lower = url.lower()
    for suffix in ("/chat/completions", "/responses", "/models", "/api/tags"):
        if lower.endswith(suffix):
            return url[: -len(suffix)].rstrip("/")
    return url


def looks_like_ollama_base_url(base_url: str) -> bool:
    lower = (base_url or "").strip().lower()
    return (
        "ollama" in lower
        or lower.startswith("http://127.0.0.1:11434")
        or lower.startswith("http://localhost:11434")
    )


def build_model_list_endpoints(base_url: str, api_format: Literal["openai", "anthropic"]) -> list[str]:
    """Build tolerant model-list endpoints for common OpenAI-compatible relays."""
    base = _strip_model_request_suffix(base_url)
    if not base:
        return []

    lower = base.lower()
    if lower.endswith("/v1"):
        root = base[:-3].rstrip("/")
        candidates = [f"{base}/models", f"{root}/models"]
        if looks_like_ollama_base_url(root):
            candidates.append(f"{root}/api/tags")
    elif api_format == "anthropic":
        candidates = [f"{base}/v1/models", f"{base}/models"]
    else:
        candidates = [f"{base}/v1/models", f"{base}/models"]
        if looks_like_ollama_base_url(base):
            candidates.append(f"{base}/api/tags")
    return _dedupe_preserve_order(candidates)


def build_model_list_headers(
    api_format: Literal["openai", "anthropic"],
    api_key: str = "",
    base_url: str = "",
    extra_headers: list[dict[str, Any]] | None = None,
) -> dict[str, str]:
    key = (api_key or "").strip()
    if api_format == "anthropic":
        headers = {
            **normalize_extra_headers(extra_headers),
            "anthropic-version": "2023-06-01",
        }
        if key:
            headers["x-api-key"] = key
        return headers
    headers = normalize_extra_headers(extra_headers)
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


def normalize_extra_headers(extra_headers: list[dict[str, Any]] | None = None) -> dict[str, str]:
    headers: dict[str, str] = {}
    for item in extra_headers if isinstance(extra_headers, list) else []:
        source = item if isinstance(item, dict) else {}
        name = str(source.get("name") or "").strip()
        value = str(source.get("value") or "").strip()
        if not name or not value or source.get("enabled") is False:
            continue
        if is_sensitive_header_name(name):
            continue
        if not all(char.isalnum() or char == "-" for char in name):
            continue
        headers[name] = value
    return headers


def is_sensitive_header_name(name: str) -> bool:
    compact = str(name or "").strip().lower().replace("_", "-")
    return (
        compact == "authorization"
        or "api-key" in compact
        or "token" in compact
        or "secret" in compact
        or "cookie" in compact
    )


def model_api_requires_key(api_format: Literal["openai", "anthropic"], base_url: str = "") -> bool:
    if api_format == "openai" and looks_like_ollama_base_url(base_url):
        return False
    return True


def resolve_model_api_key_for_request(api_format: Literal["openai", "anthropic"], base_url: str = "", api_key: str = "") -> str:
    key = (api_key or "").strip()
    if key:
        return key
    if not model_api_requires_key(api_format, base_url):
        return "ollama"
    return ""


def format_model_list_error_message(
    url: str = "",
    *,
    status_code: int | None = None,
    response_text: str = "",
    error: Exception | str | None = None,
) -> str:
    endpoint = str(url or "").strip() or "模型列表接口"
    text = str(response_text or "").strip()
    error_text = str(error or "").strip()

    if status_code in (401, 403):
        return f"模型列表接口返回 {status_code}，通常是 API Key、Authorization 或自定义 Header 无效。请检查模型 API 配置后重试：{endpoint}"
    if status_code and status_code >= 400:
        return f"模型列表接口返回 HTTP {status_code}，请检查 Base URL、接口路径和 API 权限：{endpoint}"
    if not text:
        return f"模型列表接口返回空内容，请检查 Base URL 是否指向 OpenAI 兼容接口根地址：{endpoint}"
    if text.lstrip().startswith("<") or "<html" in text[:200].lower():
        return f"模型列表接口返回 HTML 页面，不是有效 JSON。通常是 Base URL 填错、网关登录页、反向代理错误或中转站地址不是 /v1 根地址：{endpoint}"
    if "Expecting value" in error_text or "JSON" in error_text or "json" in error_text:
        preview = " ".join(text.split())[:120]
        suffix = f" 响应预览：{preview}" if preview else ""
        return f"模型列表接口返回的不是有效 JSON，请检查 Base URL、接口路径和中转站返回格式：{endpoint}.{suffix}"
    return error_text or f"模型列表接口未返回可识别的模型列表：{endpoint}"


def extract_model_list(data: Any) -> list[dict[str, str]]:
    """Normalize OpenAI, proxy, and plain-list model response shapes."""
    def resolve_items(value: Any, depth: int = 0) -> list[Any]:
        if isinstance(value, list):
            return value
        if not isinstance(value, dict) or depth > 2:
            return []
        for key in ("data", "models", "items", "list", "result", "model_list", "modelList", "available_models", "availableModels", "modelIds", "records", "response", "choices"):
            if key in value:
                resolved = resolve_items(value.get(key), depth + 1)
                if resolved:
                    return resolved
        return []

    items = resolve_items(data)

    models: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in items:
        model_id = ""
        model_name = ""
        if isinstance(item, str):
            model_id = item.strip()
            model_name = model_id
        elif isinstance(item, dict):
            model_id = str(
                item.get("id")
                or item.get("model")
                or item.get("model_id")
                or item.get("modelId")
                or item.get("slug")
                or item.get("uid")
                or item.get("key")
                or item.get("name")
                or item.get("value")
                or item.get("display_name")
                or item.get("displayName")
                or item.get("label")
                or item.get("title")
                or ""
            ).strip()
            model_name = str(item.get("display_name") or item.get("displayName") or item.get("label") or item.get("title") or item.get("name") or model_id).strip()
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        models.append({"id": model_id, "name": model_name or model_id})
    return models
