import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = app.indexOf(`async function ${name}`);
  const end = app.indexOf(`async function ${nextName}`, start);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return app.slice(start, end);
}

test("tool log export builds markdown from full filtered entries and saves it", () => {
  const source = functionSource("exportToolLogs", "deleteOldToolLogs");

  assert.match(source, /api\?\.list_tool_log_entries/);
  assert.match(source, /limit:\s*Math\.max\(toolLogTotal,\s*toolLogEntries\.length,\s*200\)/);
  assert.match(source, /api\.build_tool_log_export\(exportEntries,\s*\{\s*filters:\s*toolLogFilters,\s*total:\s*exportTotal\s*\}\)/);
  assert.match(source, /api\.save_text_file\("ssh-agent-tool-logs\.md",\s*content\)/);
  assert.match(source, /工具日志已导出/);
  assert.doesNotMatch(source, /api\.export_tool_logs/);
});

test("session log export uses the existing markdown bridge and save dialog", () => {
  const source = functionSource("exportSessionLogs", "copyPortForwardLocalUrl");

  assert.match(source, /api\?\.list_session_log_entries/);
  assert.match(source, /limit:\s*Math\.max\(sessionLogTotal,\s*sessionLogEntries\.length,\s*200\)/);
  assert.match(source, /api\.build_session_log_export\(exportEntries,\s*\{\s*filters:\s*sessionLogFilters,\s*total:\s*exportTotal\s*\}\)/);
  assert.match(source, /api\.save_text_file\("ssh-agent-session-logs\.md",\s*content\)/);
  assert.match(source, /会话日志已导出/);
  assert.doesNotMatch(source, /api\.export_session_logs/);
});
