import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function openSessionSource() {
  const start = app.indexOf("async function openSelectedSession");
  const end = app.indexOf("async function ensureCommandSession", start + 1);
  assert.notEqual(start, -1, "openSelectedSession should exist");
  assert.notEqual(end, -1, "ensureCommandSession should follow openSelectedSession");
  return app.slice(start, end);
}

function closeSessionSource() {
  const start = app.indexOf("async function closeSessionByName");
  const end = app.indexOf("async function closeSelectedSession", start + 1);
  assert.notEqual(start, -1, "closeSessionByName should exist");
  assert.notEqual(end, -1, "closeSelectedSession should follow closeSessionByName");
  return app.slice(start, end);
}

test("SSH disconnect invalidates pending terminal command output before closing backend session", () => {
  const source = closeSessionSource();
  const invalidateIndex = source.indexOf("invalidateTerminalCommandRequest(sessionKey)");
  const closeIndex = source.indexOf("api.close_ssh_session");

  assert.notEqual(invalidateIndex, -1, "disconnect should invalidate pending command output");
  assert.notEqual(closeIndex, -1, "disconnect should call the backend close API");
  assert.ok(invalidateIndex < closeIndex, "stale command output must be invalidated before backend close");
});

test("SSH disconnect invalidates a pending open request before any local early return", () => {
  const source = closeSessionSource();
  const invalidateOpenIndex = source.indexOf("invalidateSshOpenRequest(sessionKey)");
  const earlyReturnIndex = source.indexOf("return; }");
  const closeIndex = source.indexOf("api.close_ssh_session");

  assert.notEqual(invalidateOpenIndex, -1, "disconnect should invalidate a pending SSH open request");
  assert.notEqual(earlyReturnIndex, -1, "disconnect should keep the local no-session early return");
  assert.notEqual(closeIndex, -1, "disconnect should still call the backend close API when needed");
  assert.ok(invalidateOpenIndex < earlyReturnIndex, "open request invalidation must run before the no-session early return");
  assert.ok(invalidateOpenIndex < closeIndex, "open request invalidation must run before backend close");
});

test("stale SSH open results are closed and ignored instead of reconnecting a cancelled tab", () => {
  const source = openSessionSource();
  const beginIndex = source.indexOf("const openRequestId = nextSshOpenRequestId(sessionKey)");
  const awaitIndex = source.indexOf("await api.open_ssh_session");
  const staleCheckIndex = source.indexOf("if (!isCurrentSshOpenRequest(sessionKey, openRequestId))");
  const staleCloseIndex = source.indexOf("await api.close_ssh_session(result.sessionId)");
  const connectedStateIndex = source.indexOf("sessionId: result.sessionId");

  assert.notEqual(beginIndex, -1, "open should create a cancellable request id");
  assert.notEqual(awaitIndex, -1, "open should call the backend SSH open API");
  assert.notEqual(staleCheckIndex, -1, "open should check whether the request is still current after await");
  assert.notEqual(staleCloseIndex, -1, "a stale backend session should be closed immediately");
  assert.notEqual(connectedStateIndex, -1, "open should still mark current successful requests connected");
  assert.ok(beginIndex < awaitIndex, "request id must exist before the backend open starts");
  assert.ok(awaitIndex < staleCheckIndex, "stale check should run after the backend response returns");
  assert.ok(staleCheckIndex < connectedStateIndex, "stale responses must be ignored before connected state is written");
});

test("SSH disconnect treats backend ok false as a close failure and clears local session state", () => {
  const source = closeSessionSource();

  assert.match(source, /const sessionId = session\.sessionId/);
  assert.match(source, /const closeResult = await api\.close_ssh_session\(sessionId\)/);
  assert.match(source, /if \(!closeResult\?\.ok\)/);
  assert.match(source, /closeFailureMessage = closeResult\?\.message/);
  assert.match(source, /type:\s*closeFailureMessage \? "session_close_failed" : "session_closed"/);
  assert.match(source, /status:\s*closeFailureMessage \? "failed" : "ok"/);
  assert.match(source, /sessionId:\s*""/);
  assert.match(source, /disconnectedAt:\s*new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(source, /writeSessionLogEvent\(\{ type:\s*"session_closed"[\s\S]*writeSessionLogEvent\(\{ type:\s*"session_close_failed"/);
});

test("SSH disconnect session logs include safe connection context", () => {
  const source = closeSessionSource();

  assert.match(source, /const server = servers\[name\] \|\| \{\}/);
  assert.match(source, /const sessionLogContext = buildSshSessionLogContext\(name,\s*server\)/);
  assert.match(source, /writeSessionLogEvent\(\{ type:\s*closeFailureMessage \? "session_close_failed" : "session_closed"[\s\S]{0,260}context:\s*sessionLogContext/);
});

test("manual SSH disconnect is recorded as a user action", () => {
  const closeSource = closeSessionSource();
  const selectedStart = app.indexOf("async function closeSelectedSession");
  const selectedEnd = app.indexOf("async function reconnectSelectedSession", selectedStart + 1);
  assert.notEqual(selectedStart, -1, "closeSelectedSession should exist");
  assert.notEqual(selectedEnd, -1, "reconnectSelectedSession should follow closeSelectedSession");
  const selectedSource = app.slice(selectedStart, selectedEnd);

  assert.match(closeSource, /const closeActor = options\.actor \|\| "system"/);
  assert.match(closeSource, /actor:\s*closeActor/);
  assert.match(selectedSource, /closeSessionByName\(targetName,\s*"SSH 会话已断开",\s*\{ sessionKey,\s*actor:\s*"user" \}\)/);
});

test("batch SSH disconnect is recorded as a user action", () => {
  const start = app.indexOf("async function batchCloseSshSessions");
  const end = app.indexOf("async function batchReconnectSshSessions", start + 1);
  assert.notEqual(start, -1, "batchCloseSshSessions should exist");
  assert.notEqual(end, -1, "batchReconnectSshSessions should follow batchCloseSshSessions");
  const source = app.slice(start, end);

  assert.match(source, /for \(const name of names \|\| \[\]\) await closeSessionByName\(name,\s*"批量断开 SSH 会话",\s*\{ actor:\s*"user" \}\)/);
});

test("closing SSH tabs records disconnects as user actions", () => {
  const singleStart = app.indexOf("async function confirmCloseServerTab");
  const singleEnd = app.indexOf("function finalizeClosedServerTab", singleStart + 1);
  const groupStart = app.indexOf("async function confirmCloseTerminalTabGroup");
  const groupEnd = app.indexOf("function openNextServerTab", groupStart + 1);
  assert.notEqual(singleStart, -1, "confirmCloseServerTab should exist");
  assert.notEqual(singleEnd, -1, "finalizeClosedServerTab should follow confirmCloseServerTab");
  assert.notEqual(groupStart, -1, "confirmCloseTerminalTabGroup should exist");
  assert.notEqual(groupEnd, -1, "openNextServerTab should follow confirmCloseTerminalTabGroup");
  const singleSource = app.slice(singleStart, singleEnd);
  const groupSource = app.slice(groupStart, groupEnd);

  assert.match(singleSource, /closeSessionByName\(name,\s*"关闭 SSH 标签",\s*\{ sessionKey,\s*actor:\s*"user" \}\)/);
  assert.match(groupSource, /closeSessionByName\(tab\.serverName,\s*"关闭 SSH 标签",\s*\{ sessionKey,\s*actor:\s*"user" \}\)/);
});

test("forced SSH open closes an existing backend session before opening a replacement", () => {
  const source = openSessionSource();
  const existingSessionStart = source.indexOf("if (current.sessionId && !force)");
  const forceCloseStart = source.indexOf("if (current.sessionId && force && !options.skipExistingClose)");
  const openStart = source.indexOf("api.open_ssh_session");

  assert.notEqual(existingSessionStart, -1, "normal existing session reuse branch should exist");
  assert.notEqual(forceCloseStart, -1, "force open should close the existing session first");
  assert.notEqual(openStart, -1, "open branch should call backend open API");
  assert.ok(existingSessionStart < forceCloseStart, "force close should follow normal reuse guard");
  assert.ok(forceCloseStart < openStart, "old backend session should be closed before opening a replacement");
  assert.match(source.slice(forceCloseStart, openStart), /await closeSessionByName\(name,\s*"正在重新连接 SSH 会话\.\.\.",\s*\{ sessionKey \}\)/);
});

test("reconnect flow skips duplicate close after it has already disconnected the session", () => {
  const start = app.indexOf("async function reconnectSelectedSession");
  const end = app.indexOf("async function reconnectAndClearSelectedSession", start + 1);
  assert.notEqual(start, -1, "reconnectSelectedSession should exist");
  assert.notEqual(end, -1, "reconnectAndClearSelectedSession should follow reconnectSelectedSession");
  const source = app.slice(start, end);

  assert.match(source, /const sessionKey = options\.sessionKey \|\| resolveTerminalSessionKey\(targetName\)/);
  assert.match(source, /await closeSessionByName\(targetName,\s*"正在重新连接 SSH 会话\.\.\.",\s*\{ sessionKey \}\)/);
  assert.match(source, /openSelectedSession\(targetName,\s*\{ force:\s*true,\s*skipExistingClose:\s*true,\s*sessionKey \}\)/);
});
