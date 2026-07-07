from __future__ import annotations

import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen as default_urlopen


def chat_with_model(model_config: dict, messages: list, urlopen=None, timeout: int = 30) -> dict:
    credential_error = model_credential_error(model_config)
    if credential_error:
        return {"ok": False, "content": "", "message": credential_error}
    base_url = str((model_config or {}).get("baseUrl") or "").strip().rstrip("/")
    model = str((model_config or {}).get("model") or "").strip()
    api_key = str((model_config or {}).get("apiKey") or "").strip()
    api_format = model_api_format(model_config)
    if not base_url or not model:
        return {"ok": False, "content": "", "message": "模型 API 配置不完整：请填写 Base URL 和默认模型。"}

    endpoints = build_chat_endpoint_candidates(base_url, api_format)
    last_result = None
    endpoint = endpoints[0]
    payload = build_chat_payload(endpoint, model, messages, api_format)
    request = Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=build_headers(api_key, (model_config or {}).get("extraHeaders"), api_format),
        method="POST",
    )

    try:
        with (urlopen or default_urlopen)(request, timeout=timeout) as response:
            status = int(getattr(response, "status", 200) or 200)
            data = read_json_response(response, endpoint)
            if status >= 400:
                if len(endpoints) > 1:
                    return retry_chat_with_fallback(model_config, messages, urlopen, timeout, endpoints, api_key, api_format)
                return api_error(data, status)
            content = extract_content(data)
            if not content:
                if len(endpoints) > 1:
                    return retry_chat_with_fallback(model_config, messages, urlopen, timeout, endpoints, api_key, api_format)
                return {"ok": False, "content": "", "message": "模型 API 返回为空。"}
            return {"ok": True, "content": content, "message": "模型 API 调用完成。"}
    except HTTPError as error:
        data = read_http_error_response(error, endpoint)
        if len(endpoints) > 1:
            return retry_chat_with_fallback(model_config, messages, urlopen, timeout, endpoints, api_key, api_format)
        return api_error(data, int(getattr(error, "code", 0) or 0))
    except (URLError, TimeoutError, OSError) as error:
        if len(endpoints) > 1:
            return retry_chat_with_fallback(model_config, messages, urlopen, timeout, endpoints, api_key, api_format)
        return {"ok": False, "content": "", "message": format_model_network_error(error, api_key)}
    except (ValueError, json.JSONDecodeError) as error:
        if len(endpoints) > 1:
            return retry_chat_with_fallback(model_config, messages, urlopen, timeout, endpoints, api_key, api_format)
        return {"ok": False, "content": "", "message": f"模型 API 调用失败：{error}"}


def retry_chat_with_fallback(model_config: dict, messages: list, urlopen, timeout: int, endpoints: list[str], api_key: str, api_format: str = "openai") -> dict:
    result = {"ok": False, "content": "", "message": "模型 API 调用失败。"}
    for endpoint in endpoints[1:]:
        payload = build_chat_payload(endpoint, str((model_config or {}).get("model") or "").strip(), messages, api_format)
        request = Request(
            endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=build_headers(api_key, (model_config or {}).get("extraHeaders"), api_format),
            method="POST",
        )
        try:
            with (urlopen or default_urlopen)(request, timeout=timeout) as response:
                status = int(getattr(response, "status", 200) or 200)
                data = read_json_response(response, endpoint)
                if status >= 400:
                    result = api_error(data, status)
                    continue
                content = extract_content(data)
                if content:
                    return {"ok": True, "content": content, "message": "模型 API 调用完成。"}
                result = {"ok": False, "content": "", "message": "模型 API 返回为空。"}
        except HTTPError as error:
            data = read_http_error_response(error, endpoint)
            result = api_error(data, int(getattr(error, "code", 0) or 0))
        except (URLError, TimeoutError, OSError) as error:
            result = {"ok": False, "content": "", "message": format_model_network_error(error, api_key)}
        except (ValueError, json.JSONDecodeError) as error:
            result = {"ok": False, "content": "", "message": f"模型 API 调用失败：{error}"}
    return {
        **result,
        "message": build_chat_failure_message(endpoints, str(result.get("message") or ""), api_key),
    }


def test_model_connection(model_config: dict, urlopen=None, timeout: int = 15) -> dict:
    safe_config = model_config if isinstance(model_config, dict) else {}
    base_url = str(safe_config.get("baseUrl") or "").strip().rstrip("/")
    model = str(safe_config.get("model") or "").strip()
    provider = str(safe_config.get("provider") or "").strip() or "OpenAI 兼容"
    result = chat_with_model(
        {**safe_config, "baseUrl": base_url, "model": model},
        [{"role": "user", "content": "请只回复：连接正常"}],
        urlopen=urlopen,
        timeout=timeout,
    )
    return {
        "ok": bool(result.get("ok")),
        "provider": provider,
        "baseUrl": base_url,
        "model": model,
        "message": "模型 API 连接测试通过。" if result.get("ok") else result.get("message", "模型 API 连接测试失败。"),
    }


test_model_connection.__test__ = False


def list_model_options(model_config: dict, urlopen=None, timeout: int = 15) -> dict:
    safe_config = model_config if isinstance(model_config, dict) else {}
    base_url = str(safe_config.get("baseUrl") or "").strip().rstrip("/")
    credential_error = model_credential_error(safe_config)
    if credential_error:
        return {"ok": False, "provider": str(safe_config.get("provider") or "").strip() or "OpenAI 兼容", "models": [], "message": credential_error}
    api_key = str(safe_config.get("apiKey") or "").strip()
    provider = str(safe_config.get("provider") or "").strip() or "OpenAI 兼容"
    api_format = model_api_format(safe_config)
    if not base_url:
        return {"ok": False, "provider": provider, "models": [], "message": "请先填写 Base URL。"}

    last_message = ""
    endpoints = build_model_endpoint_candidates(base_url, api_format)
    attempted_endpoints = []
    try:
        for endpoint in endpoints:
            attempted_endpoints.append(endpoint)
            request = Request(
                endpoint,
                headers=build_headers(api_key, safe_config.get("extraHeaders"), api_format),
                method="GET",
            )
            try:
                with (urlopen or default_urlopen)(request, timeout=timeout) as response:
                    status = int(getattr(response, "status", 200) or 200)
                    data = read_json_response(response, endpoint)
                    if status >= 400:
                        error = model_list_error(data, status)
                        last_message = error["message"]
                        continue
                    models = extract_model_ids(data)
                    if not models:
                        last_message = "模型列表为空，请确认中转站是否支持 /models 接口。"
                        continue
                    return {
                        "ok": True,
                        "provider": provider,
                        "models": models,
                        "attemptedEndpoints": list(dict.fromkeys(attempted_endpoints)),
                        "usedEndpoint": endpoint,
                        "message": f"已获取 {len(models)} 个模型。",
                    }
            except HTTPError as error:
                data = read_http_error_response(error, endpoint)
                api_result = model_list_error(data, int(getattr(error, "code", 0) or 0))
                last_message = api_result["message"]
                continue
            except (ValueError, json.JSONDecodeError) as error:
                last_message = str(error)
                continue
        return {
            "ok": False,
            "provider": provider,
            "baseUrl": base_url,
            "models": [],
            "attemptedEndpoints": list(dict.fromkeys(attempted_endpoints)),
            "lastError": redact_sensitive_text(last_message, [api_key]),
            "message": build_model_list_failure_message(base_url, attempted_endpoints, last_message, api_key),
        }
    except HTTPError as error:
        data = read_http_error_response(error, attempted_endpoints[-1] if attempted_endpoints else base_url)
        api_result = model_list_error(data, int(getattr(error, "code", 0) or 0))
        return {
            "ok": False,
            "provider": provider,
            "baseUrl": base_url,
            "models": [],
            "attemptedEndpoints": list(dict.fromkeys(attempted_endpoints)),
            "lastError": redact_sensitive_text(api_result["message"], [api_key]),
            "message": build_model_list_failure_message(base_url, attempted_endpoints, api_result["message"], api_key),
        }
    except (URLError, TimeoutError, OSError) as error:
        last_error = format_model_network_error(error, api_key)
        return {
            "ok": False,
            "provider": provider,
            "baseUrl": base_url,
            "models": [],
            "attemptedEndpoints": list(dict.fromkeys(attempted_endpoints)),
            "lastError": redact_sensitive_text(last_error, [api_key]),
            "message": build_model_list_failure_message(base_url, attempted_endpoints, last_error, api_key),
        }
    except (ValueError, json.JSONDecodeError) as error:
        last_error = f"模型列表获取失败：{error}"
        return {
            "ok": False,
            "provider": provider,
            "baseUrl": base_url,
            "models": [],
            "attemptedEndpoints": list(dict.fromkeys(attempted_endpoints)),
            "lastError": redact_sensitive_text(last_error, [api_key]),
            "message": build_model_list_failure_message(base_url, attempted_endpoints, last_error, api_key),
        }


def build_chat_endpoint(base_url: str) -> str:
    normalized = str(base_url or "").strip().rstrip("/")
    if normalized.lower().endswith("/chat/completions"):
        return normalized
    return f"{build_openai_api_base(normalized)}/chat/completions"


def build_chat_endpoint_candidates(base_url: str, api_format: str = "openai") -> list[str]:
    if api_format == "anthropic":
        return [build_anthropic_messages_endpoint(base_url)]
    normalized = str(base_url or "").strip().rstrip("/")
    if normalized.lower().endswith("/responses"):
        chat_endpoint = build_chat_endpoint(normalized)
        return [normalized, chat_endpoint] if chat_endpoint != normalized else [normalized]
    primary = build_chat_endpoint(normalized)
    parsed = urlparse(normalized)
    candidates = [primary]
    if parsed.scheme and parsed.netloc and parsed.path not in {"", "/"} and not parsed.path.rstrip("/").lower().endswith("/v1"):
        path_v1 = f"{normalized}/v1/chat/completions"
        if path_v1 not in candidates:
            candidates.append(path_v1)
    if parsed.scheme and parsed.netloc and parsed.path in {"", "/"}:
        plain = f"{normalized}/chat/completions"
        if plain not in candidates:
            candidates.append(plain)
    return candidates


def build_anthropic_messages_endpoint(base_url: str) -> str:
    normalized = str(base_url or "").strip().rstrip("/")
    lower = normalized.lower()
    if lower.endswith("/v1/messages"):
        return normalized
    if lower.endswith("/messages"):
        return normalized
    if lower.endswith("/v1"):
        return f"{normalized}/messages"
    return f"{normalized}/v1/messages"


def build_chat_payload(endpoint: str, model: str, messages: list, api_format: str = "openai") -> dict:
    normalized_messages = normalize_messages(messages)
    if api_format == "anthropic":
        system_messages = [item["content"] for item in normalized_messages if item.get("role") == "system"]
        chat_messages = [
            item
            for item in normalized_messages
            if item.get("role") in {"user", "assistant"}
        ]
        if not chat_messages:
            chat_messages = [{"role": "user", "content": "请帮我排查当前服务器问题。"}]
        payload = {
            "model": model,
            "max_tokens": 1024,
            "temperature": 0.2,
            "messages": chat_messages,
        }
        if system_messages:
            payload["system"] = "\n\n".join(system_messages)
        return payload

    payload = {
        "model": model,
        "temperature": 0.2,
    }
    if is_responses_endpoint(endpoint):
        payload["input"] = normalized_messages
    else:
        payload["messages"] = normalized_messages
    return payload


def is_responses_endpoint(endpoint: str) -> bool:
    return str(endpoint or "").strip().rstrip("/").lower().endswith("/responses")


def model_credential_error(model_config: dict | None) -> str:
    return str((model_config or {}).get("credentialError") or "").strip() if isinstance(model_config, dict) else ""


def build_chat_failure_message(attempted_endpoints: list[str], last_message: str = "", api_key: str = "") -> str:
    endpoint_text = "、".join(dict.fromkeys([endpoint for endpoint in attempted_endpoints if endpoint]))
    detail = redact_sensitive_text(str(last_message or "模型 API 调用失败。"), [api_key])
    if endpoint_text:
        return f"模型 API 调用失败。已尝试聊天接口：{endpoint_text}。最后错误：{detail}"
    return f"模型 API 调用失败。最后错误：{detail}"


def format_model_network_error(error: BaseException, api_key: str = "") -> str:
    reason = getattr(error, "reason", None)
    raw_detail = str(reason or error or "").strip()
    raw_detail = raw_detail.replace("<urlopen error", "").replace(">", "").strip()
    detail = redact_sensitive_text(raw_detail or type(error).__name__, [api_key])
    return (
        "模型 API 网络连接失败。请检查 Base URL、网络代理、防火墙、本地 Ollama 是否已启动，"
        f"以及中转站域名是否可访问。错误详情：{detail}"
    )


def build_model_list_failure_message(base_url: str, attempted_endpoints: list[str], last_message: str = "", api_key: str = "") -> str:
    endpoint_text = "、".join(dict.fromkeys([endpoint for endpoint in attempted_endpoints if endpoint]))
    detail = redact_sensitive_text(str(last_message or "模型列表获取失败。"), [api_key])
    hint = "请确认 Base URL 是否为 OpenAI 兼容地址、API Key 是否有效且有模型列表权限，以及中转站是否支持 /models 接口。"
    if endpoint_text:
        return f"模型列表获取失败。已尝试模型接口：{endpoint_text}。{hint} 最后错误：{detail}"
    return f"模型列表获取失败。{hint} 最后错误：{detail}"


def redact_sensitive_text(text: str, secrets: list[str]) -> str:
    redacted = str(text or "")
    for secret in secrets:
        secret_text = str(secret or "").strip()
        if secret_text:
            redacted = redacted.replace(secret_text, "[已隐藏]")
    return redacted


def build_models_endpoint(base_url: str) -> str:
    normalized = str(base_url or "").strip().rstrip("/")
    lower = normalized.lower()
    if lower.endswith("/models"):
        return normalized
    normalized = strip_openai_endpoint_suffix(normalized)
    return f"{build_openai_api_base(normalized)}/models"


def build_model_endpoint_candidates(base_url: str, api_format: str = "openai") -> list[str]:
    if api_format == "anthropic":
        normalized = str(base_url or "").strip().rstrip("/")
        lower = normalized.lower()
        if lower.endswith("/v1/models") or lower.endswith("/models"):
            return [normalized]
        if lower.endswith("/v1"):
            return [f"{normalized}/models"]
        return [f"{normalized}/v1/models"]
    normalized = strip_openai_endpoint_suffix(base_url)
    primary = build_models_endpoint(normalized)
    parsed = urlparse(normalized)
    candidates = [primary]
    if parsed.scheme and parsed.netloc and parsed.path not in {"", "/"} and not parsed.path.rstrip("/").lower().endswith("/v1"):
        path_v1 = f"{normalized}/v1/models"
        if path_v1 not in candidates:
            candidates.append(path_v1)
    if parsed.scheme and parsed.netloc and parsed.path in {"", "/"}:
        plain = f"{normalized}/models"
        if plain not in candidates:
            candidates.append(plain)
    if parsed.scheme and parsed.netloc and parsed.path.rstrip("/").lower().endswith("/v1"):
        root_base = normalized[: -len("/v1")].rstrip("/")
        plain = f"{root_base}/models"
        if plain not in candidates:
            candidates.append(plain)
    if is_local_ollama_base(parsed):
        ollama = f"{parsed.scheme}://{parsed.netloc}/api/tags"
        if ollama not in candidates:
            candidates.append(ollama)
    return candidates


def build_openai_api_base(base_url: str) -> str:
    normalized = strip_openai_endpoint_suffix(base_url)
    parsed = urlparse(normalized)
    if parsed.scheme and parsed.netloc and parsed.path in {"", "/"}:
        return f"{normalized}/v1"
    return normalized


def strip_openai_endpoint_suffix(base_url: str) -> str:
    normalized = str(base_url or "").strip().rstrip("/")
    lower = normalized.lower()
    for suffix in ("/chat/completions", "/responses", "/models", "/api/tags"):
        if lower.endswith(suffix):
            normalized = normalized[: -len(suffix)].rstrip("/")
            break
    return normalized


def is_local_ollama_base(parsed) -> bool:
    host = (parsed.hostname or "").lower()
    return parsed.scheme in {"http", "https"} and host in {"127.0.0.1", "localhost", "::1"} and parsed.port == 11434


def normalize_messages(messages: list) -> list:
    normalized = []
    for item in messages if isinstance(messages, list) else []:
        role = str(item.get("role") or "user").strip()
        content = str(item.get("content") or item.get("text") or "").strip()
        if role not in {"system", "user", "assistant"}:
            role = "user"
        if content:
            normalized.append({"role": role, "content": content})
    if not normalized:
        normalized.append({"role": "user", "content": "请帮助我排查当前服务器问题。"})
    return normalized


def model_api_format(model_config: dict | None) -> str:
    raw = ""
    if isinstance(model_config, dict):
        raw = str(model_config.get("apiFormat") or model_config.get("api_format") or "").strip().lower()
    return "anthropic" if raw == "anthropic" else "openai"


def build_headers(api_key: str, extra_headers=None, api_format: str = "openai") -> dict:
    headers = {"Content-Type": "application/json"}
    for item in normalize_extra_headers(extra_headers):
        headers[item["name"]] = item["value"]
    if api_key:
        if api_format == "anthropic":
            headers["x-api-key"] = api_key
        else:
            headers["Authorization"] = f"Bearer {api_key}"
    if api_format == "anthropic":
        headers["anthropic-version"] = "2023-06-01"
    return headers


def normalize_extra_headers(extra_headers) -> list[dict]:
    normalized = []
    for item in extra_headers if isinstance(extra_headers, list) else []:
        name = str((item or {}).get("name") or "").strip()
        value = str((item or {}).get("value") or "").strip()
        if not name or not value or (item or {}).get("enabled") is False:
            continue
        if is_sensitive_header_name(name):
            continue
        if not all(char.isalnum() or char == "-" for char in name):
            continue
        normalized.append({"name": name, "value": value})
    return normalized


def is_sensitive_header_name(name: str) -> bool:
    compact = str(name or "").strip().lower().replace("_", "-")
    return compact == "authorization" or "api-key" in compact or "token" in compact or "secret" in compact or "cookie" in compact


def extract_content(data: dict) -> str:
    if not isinstance(data, dict):
        return ""

    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        first_choice = choices[0] if isinstance(choices[0], dict) else {}
        message = first_choice.get("message") if isinstance(first_choice.get("message"), dict) else {}
        content = extract_text_fragment(message.get("content"))
        if content:
            return content
        content = extract_text_fragment(first_choice.get("text"))
        if content:
            return content
        delta = first_choice.get("delta") if isinstance(first_choice.get("delta"), dict) else {}
        content = extract_text_fragment(delta.get("content"))
        if content:
            return content

    candidates = data.get("candidates")
    if isinstance(candidates, list) and candidates:
        first_candidate = candidates[0] if isinstance(candidates[0], dict) else {}
        candidate_content = first_candidate.get("content") if isinstance(first_candidate.get("content"), dict) else {}
        content = extract_text_fragment(candidate_content.get("parts"))
        if content:
            return content
        content = extract_text_fragment(first_candidate.get("text"))
        if content:
            return content

    for key in ("output_text", "response", "content", "output"):
        content = extract_text_fragment(data.get(key))
        if content:
            return content

    message = data.get("message") if isinstance(data.get("message"), dict) else {}
    return extract_text_fragment(message.get("content"))


def extract_text_fragment(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict):
                parts.append(extract_text_fragment(item.get("text") or item.get("content")))
            else:
                parts.append(extract_text_fragment(item))
        return "\n".join(part for part in parts if part).strip()
    if isinstance(value, dict):
        return extract_text_fragment(value.get("text") or value.get("content"))
    return str(value).strip()


def extract_model_ids(data: dict) -> list[str]:
    if isinstance(data, dict):
        alias_items = []
        for key, value in data.items():
            if not is_model_container_key(key):
                continue
            if isinstance(value, (list, dict)):
                alias_items.append(value)
        items = alias_items if alias_items else data
    else:
        items = data

    def collect(value) -> list[str]:
        if isinstance(value, list):
            result = []
            for child in value:
                result.extend(collect(child))
            return result
        if isinstance(value, dict):
            nested_models = []
            for key, child in value.items():
                if not is_model_container_key(key):
                    continue
                nested_models.extend(collect(child))
            if nested_models:
                return nested_models
            model_id = str(
                value.get("id")
                or value.get("name")
                or value.get("model")
                or value.get("model_id")
                or value.get("modelId")
                or value.get("model_name")
                or value.get("modelName")
                or value.get("slug")
                or value.get("value")
                or value.get("key")
                or value.get("code")
                or value.get("display_name")
                or value.get("displayName")
                or value.get("label")
                or ""
            ).strip()
            if model_id:
                return [model_id]
            keyed_models = collect_model_ids_from_mapping_keys(value)
            if keyed_models:
                return keyed_models
            mapped_models = collect_model_ids_from_mapping_values(value)
            if mapped_models:
                return mapped_models
            return []
        model_id = str(value or "").strip()
        if not model_id:
            return []
        parts = [part.strip() for part in re.split(r"[,;\r\n]+", model_id) if part.strip()]
        return parts or [model_id]

    models = []
    for model_id in collect(items):
        if model_id and model_id not in models:
            models.append(model_id)
    return models


def collect_model_ids_from_mapping_keys(value: dict) -> list[str]:
    models = []
    for key, child in value.items():
        model_id = str(key or "").strip()
        if is_model_metadata_key(model_id):
            continue
        if not looks_like_model_id(model_id):
            continue
        if isinstance(child, dict) and any(field in child for field in ("id", "name", "model")):
            continue
        if model_id not in models:
            models.append(model_id)
    return models


def collect_model_ids_from_mapping_values(value: dict) -> list[str]:
    models = []
    for key, child in value.items():
        if is_model_metadata_key(key):
            continue
        if not isinstance(child, (list, dict)):
            continue
        for model_id in extract_model_ids(child):
            if model_id and model_id not in models:
                models.append(model_id)
    return models


def is_model_container_key(value: str) -> bool:
    return str(value or "").strip() in {
        "data",
        "models",
        "model",
        "available_models",
        "availableModels",
        "model_list",
        "modelList",
        "result",
        "items",
        "list",
        "rows",
        "available",
        "default",
        "options",
        "providers",
        "groups",
        "children",
        "page",
        "records",
    }


def is_model_metadata_key(value: str) -> bool:
    return str(value or "").strip().lower() in {
        "object",
        "has_more",
        "hasmore",
        "next",
        "previous",
        "total",
        "count",
        "created",
        "owned_by",
        "owner",
        "context_length",
        "display_name",
        "displayname",
        "model_id",
        "modelid",
        "model_name",
        "modelname",
        "permission",
        "current",
        "page",
        "page_size",
        "pagesize",
        "size",
    }


def looks_like_model_id(value: str) -> bool:
    text = str(value or "").strip()
    if not text or len(text) < 2:
        return False
    if text.lower() in {"data", "models", "available", "default", "owned_by", "created", "context_length"}:
        return False
    if " " in text:
        return False
    return any(char.isalpha() for char in text) and any(char in text for char in ("-", "_", "/", ".", ":"))


def read_json_response(response, endpoint: str) -> dict:
    raw = response.read()
    text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw or "")
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        preview = text.strip().replace("\r", " ").replace("\n", " ")[:120]
        raise ValueError(
            f"模型 API 返回的不是 JSON。请确认 Base URL 是 OpenAI 兼容地址，例如 https://你的中转站/v1。当前请求：{endpoint}。响应预览：{preview or '空响应'}"
        ) from error


def read_http_error_response(error: HTTPError, endpoint: str) -> dict:
    raw = error.read()
    text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw or "")
    try:
        return json.loads(text)
    except Exception:
        preview = text.strip().replace("\r", " ").replace("\n", " ")[:120]
        detail = preview or str(error)
        return {
            "error": {
                "message": (
                    "模型 API 返回的不是 JSON。请确认 Base URL 是 OpenAI 兼容地址，"
                    f"例如 https://你的中转站/v1。当前请求：{endpoint}。响应预览：{detail}"
                )
            }
        }


def api_error(data: dict, status: int) -> dict:
    error = data.get("error") if isinstance(data, dict) else {}
    message = error.get("message") if isinstance(error, dict) else ""
    hint = model_api_status_hint(status)
    if message and status:
        detail = f"HTTP {status}，{message}"
    else:
        detail = str(message or hint or f"HTTP {status}" if status else "未知错误")
    return {"ok": False, "content": "", "message": f"模型 API 调用失败：{detail}"}


def model_list_error(data: dict, status: int) -> dict:
    error = data.get("error") if isinstance(data, dict) else {}
    message = error.get("message") if isinstance(error, dict) else ""
    hint = model_api_status_hint(status)
    if message and status:
        detail = f"HTTP {status}，{message}"
    else:
        detail = str(message or hint or f"HTTP {status}" if status else "未知错误")
    return {"ok": False, "models": [], "message": detail}


def model_api_status_hint(status: int) -> str:
    try:
        code = int(status or 0)
    except (TypeError, ValueError):
        code = 0
    hints = {
        401: "HTTP 401，API Key 无效、已过期或未被中转站接受，认证权限未通过，请重新保存 API Key。",
        403: "HTTP 403，当前账号、API Key 或模型没有调用权限，请检查中转站权限和默认模型。",
        404: "HTTP 404，请检查 Base URL 是否为 OpenAI 兼容地址，通常需要以 /v1 结尾。",
        429: "HTTP 429，请求被限流或额度不足，请稍后重试或检查账户额度。",
    }
    return hints.get(code, "")
