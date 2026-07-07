import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("SSH operation menu exposes one-click basic smoke test for the selected server", () => {
  const start = app.indexOf("const sshTopbarActions = [");
  const end = app.indexOf("const diagnosticTopbarActions = ", start + 1);
  assert.notEqual(start, -1, "SSH topbar actions should exist");
  assert.notEqual(end, -1, "diagnostic topbar actions should follow SSH actions");
  const source = app.slice(start, end);

  assert.match(source, /label:\s*isSshSmokeTesting\s*\?\s*"自检中\.\.\."\s*:\s*"一键基础自检"/);
  assert.match(source, /onClick:\s*onRunSshSmokeTest/);
  assert.match(source, /disabled:\s*isSshSmokeTesting/);
});

test("App wires the one-click SSH smoke test runner into the desktop toolbar", () => {
  assert.match(app, /import\s+\{[^}]*buildSshSmokeTestReport[^}]*buildSshSmokeTestStepRows[^}]*\}\s+from\s+"\.\/sshSmokeTest\.js"/s);
  assert.match(app, /const\s+\[sshSmokeTesting,\s*setSshSmokeTesting\]\s*=\s*useState\(\{\}\)/);
  assert.match(app, /async function runSelectedSshSmokeTest/);
  assert.match(app, /onRunSshSmokeTest=\{runSelectedSshSmokeTest\}/);
});

test("App uses the shared smoke test summary for notices and tool logs", () => {
  assert.match(app, /import\s+\{[^}]*buildSshSmokeTestSummaryText[^}]*\}\s+from\s+"\.\/sshSmokeTest\.js"/s);

  const start = app.indexOf("async function runSelectedSshSmokeTest");
  const end = app.indexOf("async function exportSshSmokeTestReport", start + 1);
  assert.notEqual(start, -1, "basic smoke test runner should exist");
  assert.notEqual(end, -1, "export function should follow the smoke test runner");
  const source = app.slice(start, end);

  assert.match(source, /const\s+summaryText\s*=\s*buildSshSmokeTestSummaryText\(summary\)/);
  assert.match(source, /message:\s*summaryText/);
  assert.match(source, /showNotice\(summaryText\)/);
  assert.doesNotMatch(source, /showNotice\(`基础自检完成：通过 \$\{summary\.ok\}/);
});

test("App marks smoke tests with skipped checks as warning in connection results", () => {
  assert.match(app, /import\s+\{[^}]*getSshSmokeTestOutcome[^}]*\}\s+from\s+"\.\/sshSmokeTest\.js"/s);

  const start = app.indexOf("async function runSelectedSshSmokeTest");
  const end = app.indexOf("async function exportSshSmokeTestReport", start + 1);
  assert.notEqual(start, -1, "basic smoke test runner should exist");
  assert.notEqual(end, -1, "export function should follow the smoke test runner");
  const source = app.slice(start, end);

  assert.match(source, /const\s+outcome\s*=\s*getSshSmokeTestOutcome\(summary\)/);
  assert.match(source, /ok:\s*outcome\.ok/);
  assert.match(source, /status:\s*outcome\.status/);
  assert.match(source, /level:\s*outcome\.level/);
  assert.doesNotMatch(source, /status:\s*summary\.failed\s*===\s*0\s*\?\s*"ok"\s*:\s*"failed"/);
});

test("basic smoke test verifies SFTP temporary file read write and cleanup", () => {
  const start = app.indexOf("async function runSelectedSshSmokeTest");
  const end = app.indexOf("async function exportSshSmokeTestReport", start + 1);
  assert.notEqual(start, -1, "basic smoke test runner should exist");
  assert.notEqual(end, -1, "export function should follow the smoke test runner");
  const source = app.slice(start, end);

  assert.match(source, /api\?\.create_sftp_file/);
  assert.match(source, /api\.write_sftp_text_file/);
  assert.match(source, /api\.preview_sftp_file/);
  assert.match(source, /api\?\.delete_sftp_item/);
  assert.match(source, /SFTP 临时文件读写/);
});

test("basic smoke test falls back to tmp when the current SFTP directory is not writable", () => {
  const start = app.indexOf("async function runSelectedSshSmokeTest");
  const end = app.indexOf("async function exportSshSmokeTestReport", start + 1);
  assert.notEqual(start, -1, "basic smoke test runner should exist");
  assert.notEqual(end, -1, "export function should follow the smoke test runner");
  const source = app.slice(start, end);

  const candidatesIndex = source.indexOf("const sftpSmokeBasePaths =");
  const tmpIndex = source.indexOf("\"/tmp\"", candidatesIndex);
  const loopIndex = source.indexOf("for (const smokeBasePath of sftpSmokeBasePaths)", tmpIndex);
  const pathIndex = source.indexOf("resolveSftpChildPath(smokeBasePath", loopIndex);
  const fallbackMessageIndex = source.indexOf("通过兜底目录", pathIndex);

  assert.notEqual(candidatesIndex, -1, "SFTP smoke test should build candidate write directories");
  assert.notEqual(tmpIndex, -1, "SFTP smoke test should include /tmp as a writable fallback");
  assert.notEqual(loopIndex, -1, "SFTP smoke test should try candidate directories in order");
  assert.notEqual(pathIndex, -1, "temporary file path should use the current candidate directory");
  assert.notEqual(fallbackMessageIndex, -1, "successful fallback should be visible in the smoke result");
  assert.ok(candidatesIndex < tmpIndex && tmpIndex < loopIndex && loopIndex < pathIndex && pathIndex < fallbackMessageIndex);
});

test("basic smoke test starts a long running command before interrupting it", () => {
  const start = app.indexOf("async function runSelectedSshSmokeTest");
  const end = app.indexOf("async function exportSshSmokeTestReport", start + 1);
  assert.notEqual(start, -1, "basic smoke test runner should exist");
  assert.notEqual(end, -1, "export function should follow the smoke test runner");
  const source = app.slice(start, end);

  const commandIndex = source.indexOf("const sleepCommand = \"sleep 30\"");
  const typeIndex = source.indexOf("api.send_ssh_session_input(sessionId, sleepCommand, false)", commandIndex);
  const enterIndex = source.indexOf("api.send_ssh_session_input(sessionId, \"\\r\", false)", typeIndex);
  const waitIndex = source.indexOf("waitForSshSmokeInterruptWindow", enterIndex);
  const interruptIndex = source.indexOf("interrupt_ssh_session_command", waitIndex);

  assert.notEqual(commandIndex, -1, "Ctrl+C smoke test should use a long running command");
  assert.notEqual(typeIndex, -1, "long running command should be typed without waiting for a command result");
  assert.notEqual(enterIndex, -1, "long running command should be submitted with a raw Enter key");
  assert.notEqual(waitIndex, -1, "smoke test should give the remote command a short startup window");
  assert.notEqual(interruptIndex, -1, "Ctrl+C should be sent after the long running command has started");
  assert.ok(commandIndex < typeIndex && typeIndex < enterIndex && enterIndex < waitIndex && waitIndex < interruptIndex);
});

test("basic smoke test verifies the SSH session is usable after Ctrl+C", () => {
  const start = app.indexOf("async function runSelectedSshSmokeTest");
  const end = app.indexOf("async function exportSshSmokeTestReport", start + 1);
  assert.notEqual(start, -1, "basic smoke test runner should exist");
  assert.notEqual(end, -1, "export function should follow the smoke test runner");
  const source = app.slice(start, end);

  const interruptIndex = source.indexOf("interrupt_ssh_session_command");
  const recoveryCommandIndex = source.indexOf("const interruptRecoveryCommand = \"echo ssh-agent-interrupt-ok\"", interruptIndex);
  const sendRecoveryIndex = source.indexOf("api.send_ssh_session_input(sessionId, interruptRecoveryCommand, true)", recoveryCommandIndex);
  const recoveryStepIndex = source.indexOf("label: \"中断后会话恢复\"", sendRecoveryIndex);

  assert.notEqual(interruptIndex, -1, "Ctrl+C should be sent during the smoke test");
  assert.notEqual(recoveryCommandIndex, -1, "smoke test should prepare a post-interrupt recovery command");
  assert.notEqual(sendRecoveryIndex, -1, "post-interrupt recovery command should be executed through the SSH session");
  assert.notEqual(recoveryStepIndex, -1, "post-interrupt recovery should be reported as its own step");
  assert.ok(interruptIndex < recoveryCommandIndex && recoveryCommandIndex < sendRecoveryIndex && sendRecoveryIndex < recoveryStepIndex);
});

test("basic smoke test report can be exported after a smoke test run", () => {
  const start = app.indexOf("const sshTopbarActions = [");
  const end = app.indexOf("const diagnosticTopbarActions = ", start + 1);
  const source = app.slice(start, end);

  assert.match(source, /onClick:\s*onExportSshSmokeTestReport/);
  assert.match(source, /disabled:\s*!latestSshSmokeTest\?\.report/);
  assert.match(app, /const\s+\[latestSshSmokeTest,\s*setLatestSshSmokeTest\]\s*=\s*useState\(null\)/);
  assert.match(app, /async function exportSshSmokeTestReport/);
  assert.match(app, /basic-smoke-test-/);
  assert.match(app, /onExportSshSmokeTestReport=\{exportSshSmokeTestReport\}/);
});
