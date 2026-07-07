from __future__ import annotations


MASKED_KEY_VALUES = {
    "sk-************************",
    "************************",
    "********",
}


def save_model_api_key(model_config: dict, api_key: str, credential_store) -> dict:
    secret = str(api_key or "").strip()
    if not secret or is_masked_api_key(secret):
        return {"ok": False, "config": sanitize_model_config(model_config), "message": "这不是有效的模型 API Key，请输入真实 Key 后再保存。"}

    config = sanitize_model_config(model_config)
    credential = credential_store.save_secret(
        model_credential_name(config),
        secret,
        {
            "secretType": "modelApiKey",
            "provider": str(config.get("provider") or ""),
            "baseUrl": str(config.get("baseUrl") or ""),
            "model": str(config.get("model") or ""),
        },
    )

    config["apiKeyRef"] = credential.get("credentialRef", "")
    config["hasApiKey"] = bool(credential.get("hasSecret"))
    return {"ok": True, "config": config, "message": "模型 API Key 已加密保存。"}


def resolve_model_config(model_config: dict, credential_store) -> dict:
    config = sanitize_model_config(model_config)
    api_key = str((model_config or {}).get("apiKey") or "").strip()
    if api_key and not is_masked_api_key(api_key):
        config["apiKey"] = api_key
        config["hasApiKey"] = True
        return config

    api_key_ref = str(config.get("apiKeyRef") or "").strip()
    if api_key_ref:
        try:
            config["apiKey"] = credential_store.read_secret(api_key_ref)
            config["hasApiKey"] = True
        except Exception as error:
            config["apiKey"] = ""
            config["apiKeyRef"] = ""
            config["hasApiKey"] = False
            config["credentialError"] = f"模型 API Key 凭据不可用，请重新保存 API Key：{error}"

    return config


def sanitize_model_config(model_config: dict | None) -> dict:
    raw = model_config if isinstance(model_config, dict) else {}
    raw_api_format = str(raw.get("apiFormat") or raw.get("api_format") or "openai").strip().lower()
    api_format = "anthropic" if raw_api_format == "anthropic" else "openai"
    return {
        "provider": str(raw.get("provider") or "").strip(),
        "baseUrl": str(raw.get("baseUrl") or "").strip(),
        "model": str(raw.get("model") or "").strip(),
        "apiFormat": api_format,
        "apiKey": "",
        "apiKeyRef": str(raw.get("apiKeyRef") or "").strip(),
        "hasApiKey": bool(raw.get("hasApiKey") or raw.get("apiKeyRef")),
        "extraHeaders": normalize_model_headers(raw.get("extraHeaders")),
    }


def model_credential_name(config: dict) -> str:
    provider = str(config.get("provider") or "model").strip() or "model"
    base_url = str(config.get("baseUrl") or "").strip()
    model = str(config.get("model") or "").strip()
    return f"model-api-key:{provider}:{base_url}:{model}"


def is_masked_api_key(api_key: str) -> bool:
    value = str(api_key or "").strip()
    return value in MASKED_KEY_VALUES or (value.startswith("sk-") and set(value[3:]) == {"*"})


def normalize_model_headers(headers) -> list[dict]:
    normalized = []
    for item in headers if isinstance(headers, list) else []:
        name = str((item or {}).get("name") or "").strip()
        value = str((item or {}).get("value") or "").strip()
        if not name or not value or is_sensitive_model_header_name(name):
            continue
        if not all(char.isalnum() or char == "-" for char in name):
            continue
        normalized.append({"name": name, "value": value, "enabled": (item or {}).get("enabled") is not False})
    return normalized


def is_sensitive_model_header_name(name: str) -> bool:
    compact = str(name or "").strip().lower().replace("_", "-")
    return compact == "authorization" or "api-key" in compact or "token" in compact or "secret" in compact or "cookie" in compact
