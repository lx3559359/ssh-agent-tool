from __future__ import annotations

import logging
import webbrowser
import httpx
from datetime import datetime
from typing import Any, Literal, Optional

logger = logging.getLogger("routes")

import json
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic

from backend.agent.graph import get_graph
from backend.agent.tools.terminal_legacy import get_terminal_context_raw
from backend.config import UserConfig, AgentDocs, settings
from backend.model_api import (
    build_model_list_endpoints,
    build_model_list_headers,
    extract_model_list,
    format_model_list_error_message,
    model_api_requires_key,
    normalize_extra_headers,
    resolve_model_api_key_for_request,
)

router = APIRouter()

# In-memory analysis history (should be persisted to a database in production)
_analysis_history: list[dict[str, Any]] = []


class AnalyzeRequest(BaseModel):
    message: str
    terminal_context: str = ""


class AnalyzeResponse(BaseModel):
    result: str
    timestamp: str


# === Settings ===
class ModelInfo(BaseModel):
    id: str
    name: str = ""


class ModelHeader(BaseModel):
    name: str
    value: str = ""
    enabled: bool = True


class SettingsModel(BaseModel):
    # All fields optional: only update fields explicitly provided in the request,
    # so partial saves (e.g. language only) do not clear other fields
    api_format: Optional[Literal["openai", "anthropic"]] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    extra_headers: Optional[list[ModelHeader]] = Field(default=None, alias="extraHeaders")
    models: Optional[list[ModelInfo]] = None
    selected_model: Optional[str] = None
    language: Optional[str] = None
    theme: Optional[str] = None
    agent_api_token: Optional[str] = None
    web_access_key: Optional[str] = None


class ModelsRequest(BaseModel):
    base_url: str
    api_key: str
    api_format: Literal["openai", "anthropic"]
    extra_headers: Optional[list[ModelHeader]] = Field(default=None, alias="extraHeaders")


class StreamTestRequest(BaseModel):
    base_url: str
    api_key: str
    api_format: Literal["openai", "anthropic"]
    model: str = ""
    extra_headers: Optional[list[ModelHeader]] = Field(default=None, alias="extraHeaders")


@router.get("/settings")
async def get_settings() -> dict:
    """Return settings with API keys masked."""
    return UserConfig.get_masked()


@router.get("/settings/token/reveal")
async def reveal_agent_token(request: Request) -> dict:
    """Return the full agent_api_token for copy on the settings page.
    Auth: localhost allowed; remote requests require a valid X-Access-Key header.
    """
    from backend.api.auth_routes import is_local_request, verify_web_key
    if not is_local_request(request) and not verify_web_key(request.headers.get("X-Access-Key", "")):
        raise HTTPException(status_code=403, detail="需本机访问或有效的 X-Access-Key")
    token = UserConfig.load().get("agent_api_token") or settings.agent_api_token
    if not token:
        raise HTTPException(status_code=404, detail="未配置 agent_api_token")
    return {"token": token}


@router.get("/settings/export")
async def export_settings(request: Request) -> Response:
    """Export the full config file (including plaintext secrets); requires localhost or valid X-Access-Key."""
    from backend.api.auth_routes import is_local_request, verify_web_key
    if not is_local_request(request) and not verify_web_key(request.headers.get("X-Access-Key", "")):
        raise HTTPException(status_code=403, detail="需本机访问或有效的 X-Access-Key")
    config = UserConfig.load()
    content = json.dumps(config, indent=2, ensure_ascii=False)
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=winkterm-config.json"},
    )


@router.post("/settings")
async def save_settings(payload: SettingsModel) -> dict:
    """Save settings: only update fields explicitly provided in the request."""
    data = payload.model_dump(exclude_none=True)
    original = UserConfig.load()
    # Masked values (containing ****) or empty strings (left blank when editing) mean unchanged — keep originals
    for secret in ("api_key", "agent_api_token", "web_access_key"):
        if secret not in data:
            continue
        val = data[secret] or ""
        if "****" in val or (val == "" and original.get(secret)):
            data[secret] = original.get(secret, "")
    UserConfig.merge_save(data)
    return {"success": True}


class DocContent(BaseModel):
    content: str


@router.get("/settings/agents-md")
async def get_agents_md() -> dict:
    """Read user-defined operating instructions (agents.md)."""
    return {"content": AgentDocs.read_agents()}


@router.put("/settings/agents-md")
async def put_agents_md(payload: DocContent) -> dict:
    """Save user-defined operating instructions (agents.md)."""
    AgentDocs.write_agents(payload.content)
    return {"success": True}


@router.get("/settings/memory-md")
async def get_memory_md() -> dict:
    """Read AI long-term memory (memory.md)."""
    return {"content": AgentDocs.read_memory()}


@router.put("/settings/memory-md")
async def put_memory_md(payload: DocContent) -> dict:
    """Save AI long-term memory (memory.md); auto-backup to .bak before write."""
    AgentDocs.write_memory(payload.content)
    return {"success": True}


@router.post("/models/fetch")
async def fetch_models(req: ModelsRequest) -> dict:
    """Fetch available model list from the API."""
    # If api_key contains ****, use the original key from the config file
    api_key = req.api_key
    if "****" in api_key:
        config = UserConfig.load()
        api_key = config.get("api_key", "")

    endpoints = build_model_list_endpoints(req.base_url, req.api_format)
    extra_headers = [item.model_dump() for item in (req.extra_headers or [])]
    headers = build_model_list_headers(req.api_format, api_key, req.base_url, extra_headers)

    last_error = ""
    async with httpx.AsyncClient(timeout=10.0) as client:
        for url in endpoints:
            try:
                resp = await client.get(url, headers=headers)
                text = resp.text
                if resp.status_code >= 400:
                    last_error = format_model_list_error_message(url, status_code=resp.status_code, response_text=text)
                    continue
                if not text.strip():
                    last_error = format_model_list_error_message(url, status_code=resp.status_code, response_text=text)
                    continue
                try:
                    payload = resp.json()
                except json.JSONDecodeError as error:
                    last_error = format_model_list_error_message(url, status_code=resp.status_code, response_text=text, error=error)
                    continue
                models = extract_model_list(payload)
                if models:
                    return {
                        "models": models,
                        "attemptedEndpoints": endpoints,
                        "usedEndpoint": url,
                    }
                last_error = format_model_list_error_message(url, status_code=resp.status_code, response_text=text)
            except Exception as e:
                last_error = format_model_list_error_message(url, error=e)

    return {
        "models": [],
        "error": last_error or "No model endpoints were available",
        "attemptedEndpoints": endpoints,
        "lastError": last_error or "No model endpoints were available",
    }


@router.post("/models/stream-test")
async def stream_test(req: StreamTestRequest) -> StreamingResponse:
    """Send a short streaming request to verify API config and model streaming support."""
    api_key = req.api_key
    if "****" in api_key:
        config = UserConfig.load()
        api_key = config.get("api_key", "")
    api_key = resolve_model_api_key_for_request(req.api_format, req.base_url, api_key)

    model = req.model.strip()
    if not model:
        user_config = UserConfig.load()
        model = user_config.get("selected_model") or settings.effective_model

    if not req.base_url or not model or (model_api_requires_key(req.api_format, req.base_url) and not api_key):
        raise HTTPException(status_code=400, detail="缺少 base_url、api_key 或 model")
    extra_headers = [item.model_dump() for item in (req.extra_headers or [])]
    safe_extra_headers = normalize_extra_headers(extra_headers)

    async def gen():
        try:
            if req.api_format == "anthropic":
                llm = ChatAnthropic(
                    model=model,
                    temperature=1,
                    max_tokens=32,
                    api_key=api_key,
                    base_url=req.base_url.rstrip("/").split("/v1")[0] if req.base_url else None,
                    thinking={"type": "disabled"},
                )
            else:
                llm = ChatOpenAI(
                    model=model,
                    temperature=0,
                    max_tokens=32,
                    api_key=api_key,
                    base_url=req.base_url if req.base_url else None,
                    default_headers=safe_extra_headers,
                )

            messages = [HumanMessage(content="Reply with exactly: OK")]
            chunk_count = 0
            async for chunk in llm.astream(messages):
                content = chunk.content
                if isinstance(content, list):
                    text_blocks = [
                        b["text"] for b in content
                        if isinstance(b, dict) and b.get("type") == "text"
                    ]
                    content = "".join(text_blocks)
                if content:
                    chunk_count += 1
                    payload = json.dumps(
                        {"type": "token", "content": str(content)},
                        ensure_ascii=False,
                    )
                    yield f"data: {payload}\n\n"

            done_payload = json.dumps(
                {"type": "done", "chunks": chunk_count},
                ensure_ascii=False,
            )
            yield f"data: {done_payload}\n\n"
        except Exception as e:
            logger.warning(f"Stream test failed: {e}")
            err_payload = json.dumps(
                {"type": "error", "message": str(e)},
                ensure_ascii=False,
            )
            yield f"data: {err_payload}\n\n"

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(gen(), media_type="text/event-stream", headers=headers)


# === Chat history persistence (process-level + file) ===
@router.get("/chat/conversations")
async def list_chat_conversations() -> dict:
    """List all saved conversations (for frontend restore on mount)."""
    from backend.api import chat_store
    return {"conversations": chat_store.list_conversations()}


class TitleUpdate(BaseModel):
    title: str


@router.post("/chat/conversations/{conv_id}/title")
async def set_chat_title(conv_id: str, body: TitleUpdate) -> dict:
    from backend.api import chat_store
    chat_store.update_title(conv_id, body.title)
    return {"ok": True}


@router.delete("/chat/conversations/{conv_id}")
async def delete_chat_conversation(conv_id: str) -> dict:
    from backend.api import chat_store
    ok = chat_store.delete_conversation(conv_id)
    return {"ok": ok}


# === Chat title generation ===
class TitleRequest(BaseModel):
    messages: list[dict]  # [{"role": "user"|"assistant", "content": str}]


@router.post("/chat/title")
async def generate_title(req: TitleRequest) -> dict:
    """Generate a short conversation title from chat content using AI."""
    user_config = UserConfig.load()
    api_format = user_config.get("api_format", "openai")
    base_url = user_config.get("base_url") or settings.effective_base_url
    api_key = resolve_model_api_key_for_request(
        api_format,
        base_url,
        user_config.get("api_key") or settings.effective_api_key,
    )
    safe_extra_headers = normalize_extra_headers(user_config.get("extra_headers"))
    model = user_config.get("selected_model") or settings.effective_model

    if not model or not req.messages or (model_api_requires_key(api_format, base_url) and not api_key):
        return {"title": ""}

    try:
        if api_format == "anthropic":
            llm = ChatAnthropic(
                model=model,
                temperature=1,  # required when thinking disabled
                max_tokens=100,
                api_key=api_key,
                base_url=base_url.split("/v1")[0] if base_url else None,
                thinking={"type": "disabled"},
            )
        else:
            llm = ChatOpenAI(
                model=model,
                temperature=0,
                max_tokens=20,
                api_key=api_key,
                base_url=base_url if base_url else None,
                default_headers=safe_extra_headers,
            )

        recent = req.messages[:8]
        history_text = "\n".join(
            f"{m['role'].upper()}: {str(m.get('content', ''))[:300]}"
            for m in recent
        )
        system = SystemMessage(content=(
            "Generate a very short title (3-5 words) summarizing the conversation below. "
            "Ignore greetings and pleasantries; focus on the actual topic or task. "
            "Return ONLY the title text, no quotes, no trailing punctuation."
        ))
        response = await llm.ainvoke([system, HumanMessage(content=history_text)])
        content = response.content
        if isinstance(content, list):
            text_blocks = [b["text"] for b in content if isinstance(b, dict) and b.get("type") == "text"]
            content = " ".join(text_blocks)
        title = str(content).strip().strip('"')
        logger.info(f"Generated title: {title!r} from {len(recent)} messages")
        return {"title": title}
    except Exception as e:
        logger.warning(f"Title generation failed: {e}")
        return {"title": ""}


# === Chat continuation suggestions ===
class SuggestionsRequest(BaseModel):
    messages: list[dict]  # [{"role": "user"|"assistant", "content": str}]


@router.post("/chat/suggestions")
async def generate_suggestions(req: SuggestionsRequest) -> dict:
    """Generate 3 suggested follow-up messages the user might send next."""
    user_config = UserConfig.load()
    api_format = user_config.get("api_format", "openai")
    base_url = user_config.get("base_url") or settings.effective_base_url
    api_key = resolve_model_api_key_for_request(
        api_format,
        base_url,
        user_config.get("api_key") or settings.effective_api_key,
    )
    safe_extra_headers = normalize_extra_headers(user_config.get("extra_headers"))
    model = user_config.get("selected_model") or settings.effective_model

    if not model or not req.messages or (model_api_requires_key(api_format, base_url) and not api_key):
        return {"suggestions": []}

    # Use recent turns as context (avoid excessive tokens)
    recent = req.messages[-6:]
    history_text = "\n".join(
        f"{m['role'].upper()}: {str(m.get('content', ''))[:300]}"
        for m in recent
    )

    try:
        if api_format == "anthropic":
            llm = ChatAnthropic(
                model=model,
                temperature=1,
                max_tokens=200,
                api_key=api_key,
                base_url=base_url.split("/v1")[0] if base_url else None,
                thinking={"type": "disabled"},
            )
        else:
            llm = ChatOpenAI(
                model=model,
                temperature=0.7,
                max_tokens=200,
                api_key=api_key,
                base_url=base_url if base_url else None,
                default_headers=safe_extra_headers,
            )

        system = SystemMessage(content=(
            "You are a helpful assistant. Based on the conversation below, generate exactly 3 short follow-up questions or messages "
            "the user might want to send next. Each suggestion should be concise (under 15 words). "
            "Return ONLY the 3 suggestions, one per line, no numbering, no bullets, no extra text."
        ))
        response = await llm.ainvoke([system, HumanMessage(content=history_text)])
        content = response.content
        if isinstance(content, list):
            text_blocks = [b["text"] for b in content if isinstance(b, dict) and b.get("type") == "text"]
            content = " ".join(text_blocks)
        lines = [line.strip().lstrip("0123456789.-) ") for line in str(content).strip().splitlines() if line.strip()]
        suggestions = lines[:3]
        logger.info(f"Generated {len(suggestions)} suggestions")
        return {"suggestions": suggestions}
    except Exception as e:
        logger.warning(f"Suggestions generation failed: {e}")
        return {"suggestions": []}


# === History ===
@router.get("/history")
async def get_history() -> dict[str, Any]:
    """Return analysis history records."""
    return {"history": list(reversed(_analysis_history)), "total": len(_analysis_history)}


# === Open URL ===
class OpenUrlRequest(BaseModel):
    url: str


@router.post("/open-url")
async def open_url(req: OpenUrlRequest) -> dict:
    """Open a URL in the system default browser."""
    try:
        webbrowser.open(req.url)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}
