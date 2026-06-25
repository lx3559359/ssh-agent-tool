from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol
from urllib import error, parse, request


@dataclass(frozen=True)
class ExecutionResponse:
    exit_code: int | None
    stdout: str = ""
    stderr: str = ""
    message: str = ""
    duration_ms: int | None = None
    timed_out: bool = False


class CommandExecutor(Protocol):
    def run(self, command: str, timeout_seconds: int) -> ExecutionResponse:
        ...


@dataclass(frozen=True)
class FakeExecutorCall:
    command: str
    timeout_seconds: int


class FakeExecutor:
    def __init__(self, responses: dict[str, ExecutionResponse]):
        self._responses = responses
        self.calls: list[FakeExecutorCall] = []

    def run(self, command: str, timeout_seconds: int) -> ExecutionResponse:
        self.calls.append(FakeExecutorCall(command, timeout_seconds))
        if command not in self._responses:
            return ExecutionResponse(
                exit_code=127,
                message=f"未配置命令响应：{command}",
            )
        return self._responses[command]


class AgentApiExecutor:
    def __init__(
        self,
        base_url: str,
        connection_id: str,
        *,
        token: str | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.connection_id = connection_id
        self.token = token

    def run(self, command: str, timeout_seconds: int) -> ExecutionResponse:
        body = json.dumps(
            {"command": command, "timeout": timeout_seconds},
            ensure_ascii=False,
        ).encode("utf-8")
        req = request.Request(
            self._url(),
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/json",
            },
        )
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")

        try:
            with request.urlopen(req, timeout=timeout_seconds + 15) as response:
                payload = response.read().decode("utf-8")
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"SSH 命令接口调用失败：HTTP {exc.code}，{detail or exc.reason}"
            ) from exc
        except error.URLError as exc:
            raise RuntimeError(f"SSH 命令接口调用失败：{exc.reason}") from exc
        except TimeoutError as exc:
            raise RuntimeError("SSH 命令接口调用失败：调用超时") from exc
        except UnicodeDecodeError as exc:
            raise RuntimeError("SSH 命令接口返回内容无法按 UTF-8 解码") from exc

        try:
            data = json.loads(payload or "{}")
        except json.JSONDecodeError as exc:
            raise RuntimeError("SSH 命令接口返回了无法解析的 JSON") from exc
        if not isinstance(data, dict):
            raise RuntimeError("SSH 命令接口返回的 JSON 格式不符合预期")

        return ExecutionResponse(
            exit_code=_optional_int(data.get("exit_code")),
            stdout=str(data.get("stdout") or data.get("output") or ""),
            stderr=str(data.get("stderr") or ""),
            message=_message_from_response(data),
            duration_ms=_optional_int(data.get("duration_ms")),
            timed_out=bool(
                data.get("timed_out")
                or data.get("timeout")
                or data.get("reason") == "timeout"
            ),
        )

    def _url(self) -> str:
        conn_id = parse.quote(self.connection_id, safe="")
        return f"{self.base_url}/api/agent/ssh/{conn_id}/run"


def _optional_int(value: object) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _message_from_response(data: dict[str, object]) -> str:
    for key in ("message", "error", "detail"):
        value = data.get(key)
        if value:
            return str(value)
    if data.get("ok") is False:
        return "命令执行失败"
    return ""
