import unittest
from unittest.mock import patch

import desktop_app
from desktop_app import DesktopApi


class DesktopMcpApiTests(unittest.TestCase):
    def test_call_mcp_http_delegates_to_client(self):
        with patch.object(desktop_app, "call_mcp_http", return_value={"ok": True, "results": []}) as fake_call:
            result = DesktopApi().call_mcp_http(
                "https://mcp.example.com/mcp",
                [{"payload": {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}}],
                7,
                [{"name": "Authorization", "value": "Bearer token", "enabled": True}],
            )

        self.assertEqual(result, {"ok": True, "results": []})
        fake_call.assert_called_once_with(
            "https://mcp.example.com/mcp",
            [{"payload": {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}}],
            timeout=7,
            headers=[{"name": "Authorization", "value": "Bearer token", "enabled": True}],
            cancel_event=None,
        )

    def test_call_mcp_http_logs_http_calls_without_header_secrets(self):
        events = []

        with patch.object(desktop_app, "call_mcp_http", return_value={"ok": True, "message": "ok", "results": []}):
            with patch.object(desktop_app, "log_tool_event", lambda event: events.append(event)):
                result = DesktopApi().call_mcp_http(
                    "https://mcp.example.com/mcp",
                    [{"payload": {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}}],
                    7,
                    [
                        {"name": "Authorization", "value": "Bearer secret-token", "enabled": True},
                        {"name": "X-Api-Key", "value": "api-secret", "enabled": True},
                    ],
                )

        self.assertTrue(result["ok"])
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["level"], "info")
        self.assertEqual(events[0]["component"], "mcp")
        self.assertEqual(events[0]["action"], "call_http")
        self.assertEqual(events[0]["context"]["endpoint"], "https://mcp.example.com/mcp")
        self.assertEqual(events[0]["context"]["requestCount"], 1)
        self.assertEqual(events[0]["context"]["headerNames"], ["Authorization", "X-Api-Key"])
        self.assertNotIn("secret-token", str(events[0]))
        self.assertNotIn("api-secret", str(events[0]))

    def test_call_mcp_http_logs_failed_http_calls_as_warning(self):
        events = []

        with patch.object(desktop_app, "call_mcp_http", return_value={"ok": False, "message": "boom", "results": []}):
            with patch.object(desktop_app, "log_tool_event", lambda event: events.append(event)):
                result = DesktopApi().call_mcp_http("https://mcp.example.com/mcp", [{"method": "tools/list"}], 7, [])

        self.assertFalse(result["ok"])
        self.assertEqual(events[0]["level"], "warn")
        self.assertEqual(events[0]["message"], "boom")

    def test_mcp_http_call_can_be_cancelled_by_run_id(self):
        captured = {}

        def fake_call(endpoint, requests, timeout=15, headers=None, cancel_event=None):
            captured["event"] = cancel_event
            self.assertFalse(cancel_event.is_set())
            self.assertIs(DesktopApi._active_mcp_runs["agent-task-1"], cancel_event)
            return {"ok": False, "message": "MCP HTTP 调用已取消。", "results": []}

        api = DesktopApi()
        with patch.object(desktop_app, "call_mcp_http", fake_call):
            result = api.call_mcp_http("https://mcp.example.com/mcp", [{"method": "tools/list"}], 7, [], "agent-task-1")

        self.assertEqual(result["message"], "MCP HTTP 调用已取消。")
        self.assertNotIn("agent-task-1", DesktopApi._active_mcp_runs)
        self.assertIsNotNone(captured["event"])

    def test_cancel_mcp_http_call_marks_active_run(self):
        api = DesktopApi()
        event = desktop_app.threading.Event()
        DesktopApi._active_mcp_runs["agent-task-2"] = event

        result = api.cancel_mcp_http_call("agent-task-2")

        self.assertTrue(result["ok"])
        self.assertTrue(event.is_set())

    def test_builtin_prometheus_mcp_reports_missing_config(self):
        api = DesktopApi()
        with patch.object(api, "read_app_config", return_value={"mcpSettings": {}}):
            with patch.dict(desktop_app.os.environ, {}, clear=True):
                result = api.call_mcp_http(
                    "mcp://prometheus",
                    [{"label": "CPU", "tool": "query", "params": {"query": "up"}}],
                    7,
                    [],
                )

        self.assertFalse(result["ok"])
        self.assertEqual(result["endpoint"], "mcp://prometheus")
        self.assertEqual(result["results"], [])
        self.assertIn("Prometheus", result["message"])
        self.assertIn("MCP", result["message"])

    def test_builtin_prometheus_mcp_uses_saved_config_and_formats_results(self):
        def fake_query(base_url, query, timeout=15, token="", range_text=""):
            return {
                "ok": True,
                "status": 200,
                "query": query,
                "range": range_text,
                "response": {"data": {"result": [{"metric": {"instance": "prod-web-01"}, "value": [1, "0.42"]}]}},
                "message": "ok",
            }

        api = DesktopApi()
        with patch.object(
            api,
            "read_app_config",
            return_value={"mcpSettings": {"prometheus": {"baseUrl": "https://prom.example.com", "token": "prom-token"}}},
        ):
            with patch.object(desktop_app, "query_builtin_prometheus", fake_query):
                result = api.call_mcp_http(
                    "mcp://prometheus",
                    [{"label": "CPU", "tool": "query_range", "params": {"query": "node_load1", "range": "30m"}}],
                    9,
                    [],
                )

        self.assertTrue(result["ok"])
        self.assertEqual(result["endpoint"], "mcp://prometheus")
        self.assertEqual(result["connector"], "prometheus")
        self.assertEqual(result["results"][0]["label"], "CPU")
        self.assertEqual(result["results"][0]["status"], 200)
        self.assertEqual(result["results"][0]["query"], "node_load1")
        self.assertEqual(result["results"][0]["range"], "30m")
        self.assertIn("1/1", result["message"])

    def test_restore_backup_agent_capabilities_delegates_to_server_backup(self):
        backup = {"schema": "ssh-agent-tool.backup.v1", "mcp": []}
        with patch.object(desktop_app, "restore_backup_agent_capabilities", return_value={"ok": True, "backup": backup}) as fake_restore:
            result = DesktopApi().restore_backup_agent_capabilities(backup, "BackupMaster!123")

        self.assertEqual(result, {"ok": True, "backup": backup})
        fake_restore.assert_called_once_with(backup, "BackupMaster!123")

    def test_run_local_cli_command_delegates_to_runner(self):
        with patch.object(desktop_app, "run_local_cli_command", return_value={"ok": True, "stdout": "ok"}) as fake_run:
            result = DesktopApi().run_local_cli_command("local:ssh-ai diagnose", 11)

        self.assertEqual(result, {"ok": True, "stdout": "ok"})
        fake_run.assert_called_once_with("local:ssh-ai diagnose", timeout=11, cancel_event=None)

    def test_local_cli_command_can_be_cancelled_by_run_id(self):
        captured = {}

        def fake_run(command, timeout=20, cancel_event=None):
            captured["event"] = cancel_event
            self.assertFalse(cancel_event.is_set())
            result = DesktopApi._active_cli_runs["agent-task-1"]
            self.assertIs(result, cancel_event)
            return {"ok": False, "message": "本地 CLI 执行已取消。"}

        api = DesktopApi()
        with patch.object(desktop_app, "run_local_cli_command", fake_run):
            result = api.run_local_cli_command("local:ssh-ai diagnose", 11, "agent-task-1")

        self.assertEqual(result["message"], "本地 CLI 执行已取消。")
        self.assertNotIn("agent-task-1", DesktopApi._active_cli_runs)
        self.assertIsNotNone(captured["event"])

    def test_cancel_local_cli_command_marks_active_run(self):
        api = DesktopApi()
        event = desktop_app.threading.Event()
        DesktopApi._active_cli_runs["agent-task-2"] = event

        result = api.cancel_local_cli_command("agent-task-2")

        self.assertTrue(result["ok"])
        self.assertTrue(event.is_set())


if __name__ == "__main__":
    unittest.main()
