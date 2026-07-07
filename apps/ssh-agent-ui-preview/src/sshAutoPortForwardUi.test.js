import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "App.jsx");
const app = readFileSync(sourcePath, "utf8");

test("SSH session open auto starts saved local port forwards", () => {
  const source = app.slice(app.indexOf("async function openSelectedSession"), app.indexOf("async function ensureCommandSession"));

  assert.match(app, /buildAutoStartLocalForwardConfigs/);
  assert.match(source, /buildAutoStartLocalForwardConfigs\(server\)/);
  assert.match(source, /api\.start_port_forward\(server,\s*server\.credentialRef,\s*forwardConfig\)/);
  assert.match(source, /自动端口转发/);
  assert.match(source, /writeToolLogEvent\(\{\s*level:\s*"warn",\s*component:\s*"port-forward",\s*action:\s*"auto_start_failed"/);
});

test("SSH session close stops port forwards auto started for that session", () => {
  const openSource = app.slice(app.indexOf("async function openSelectedSession"), app.indexOf("async function ensureCommandSession"));
  const closeSource = app.slice(app.indexOf("async function closeSessionByName"), app.indexOf("async function closeSelectedSession"));

  assert.match(openSource, /autoStartedForwardIds/);
  assert.match(openSource, /forwardResult\?\.forward\?\.id/);
  assert.match(openSource, /autoPortForwardIds:\s*autoStartedForwardIds/);
  assert.match(closeSource, /session\.autoPortForwardIds/);
  assert.match(closeSource, /api\.stop_port_forward\(forwardId\)/);
  assert.match(closeSource, /action:\s*"auto_stop_failed"/);
  assert.match(closeSource, /自动端口转发已停止/);
  assert.match(closeSource, /autoPortForwardIds:\s*\[\]/);
});

test("SSH session close still stops auto port forwards after the SSH session id is already cleared", () => {
  const closeSource = app.slice(app.indexOf("async function closeSessionByName"), app.indexOf("async function closeSelectedSession"));
  const autoIdsIndex = closeSource.indexOf("const autoForwardIds = Array.isArray(session.autoPortForwardIds)");
  const noSessionReturnIndex = closeSource.indexOf("if (!session.sessionId && autoForwardIds.length === 0)");
  const stopLoopIndex = closeSource.indexOf("for (const forwardId of autoForwardIds)");

  assert.notEqual(autoIdsIndex, -1, "close should read remembered auto-started port forwards");
  assert.notEqual(noSessionReturnIndex, -1, "close should still handle missing backend session ids");
  assert.notEqual(stopLoopIndex, -1, "close should stop remembered port forwards");
  assert.ok(autoIdsIndex < noSessionReturnIndex, "auto forward ids must be known before the missing-session branch");
  assert.ok(noSessionReturnIndex < stopLoopIndex, "missing-session branch must not return before auto forwards can be stopped");
  assert.match(closeSource, /if \(!session\.sessionId && autoForwardIds\.length === 0\)/);
});
