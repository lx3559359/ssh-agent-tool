import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = app.indexOf(`async function ${name}`);
  const end = app.indexOf(`async function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return app.slice(start, end);
}

test("SSH session input keeps the typed command when the backend rejects the send", () => {
  const source = functionSource("sendSelectedSessionInput", "sendSelectedCommand");
  const failureIndex = source.indexOf("if (!result?.ok)");
  const clearIndex = source.indexOf("if (clearInput) updateCommandInput(inputKey, \"\")");

  assert.notEqual(failureIndex, -1, "send failure branch should exist");
  assert.notEqual(clearIndex, -1, "successful send should clear input");
  assert.ok(failureIndex < clearIndex, "input must only clear after result.ok is known");
  assert.match(source.slice(failureIndex, clearIndex), /return \{ ok:\s*false,\s*message \}/);
});

test("SSH session input ignores stale backend results after disconnect or interruption", () => {
  const source = functionSource("sendSelectedSessionInput", "sendSelectedCommand");
  const requestIndex = source.indexOf("const inputRequestId = nextTerminalInputRequestId(sessionKey)");
  const awaitIndex = source.indexOf("await withSshApiTimeout");
  const staleCheckIndex = source.indexOf("if (!isCurrentTerminalInputRequest(sessionKey, inputRequestId))");
  const outputIndex = source.indexOf("if (result?.output)");
  const failureIndex = source.indexOf("if (!result?.ok)");
  const clearIndex = source.indexOf("if (clearInput) updateCommandInput(inputKey, \"\")");

  assert.notEqual(requestIndex, -1, "input send should create a cancellable request id");
  assert.notEqual(awaitIndex, -1, "input send should await the backend");
  assert.notEqual(staleCheckIndex, -1, "input send should ignore stale backend results");
  assert.notEqual(outputIndex, -1, "input output append branch should exist");
  assert.notEqual(failureIndex, -1, "input failure branch should exist");
  assert.notEqual(clearIndex, -1, "input success clear branch should exist");
  assert.ok(requestIndex < awaitIndex, "request id must exist before the backend send starts");
  assert.ok(awaitIndex < staleCheckIndex, "stale check should run after backend result returns");
  assert.ok(staleCheckIndex < outputIndex, "stale input output must not append to the terminal");
  assert.ok(staleCheckIndex < failureIndex, "stale input failure must not mark the session disconnected");
  assert.ok(staleCheckIndex < clearIndex, "stale input success must not clear the command draft");
  assert.match(source.slice(staleCheckIndex, outputIndex), /stale:\s*true/);
});

test("SSH disconnect and interrupt invalidate pending terminal input requests", () => {
  const closeSource = functionSource("closeSessionByName", "closeSelectedSession");
  const stopSource = functionSource("stopSelectedCommand", "checkSelectedSessionHealth");
  const closeInvalidateIndex = closeSource.indexOf("invalidateTerminalInputRequest(sessionKey)");
  const closeApiIndex = closeSource.indexOf("api.close_ssh_session");
  const stopInvalidateIndex = stopSource.indexOf("invalidateTerminalInputRequest(sessionKey)");
  const stopApiIndex = stopSource.indexOf("api?.interrupt_ssh_session_command");

  assert.notEqual(closeInvalidateIndex, -1, "disconnect should invalidate pending SSH input");
  assert.notEqual(closeApiIndex, -1, "disconnect should still call backend close when needed");
  assert.notEqual(stopInvalidateIndex, -1, "Ctrl+C interrupt should invalidate pending SSH input");
  assert.notEqual(stopApiIndex, -1, "Ctrl+C interrupt should still reach backend");
  assert.ok(closeInvalidateIndex < closeApiIndex, "disconnect should invalidate input before backend close");
  assert.ok(stopInvalidateIndex < stopApiIndex, "interrupt should invalidate input before sending Ctrl+C");
});

test("manual SSH command sender does not record stale input results as command failures", () => {
  const start = app.indexOf("async function sendSelectedCommand");
  const end = app.indexOf("\n  return (", start);
  assert.notEqual(start, -1, "sendSelectedCommand should exist");
  assert.notEqual(end, -1, "sendSelectedCommand should appear before render");
  const source = app.slice(start, end);
  const sendIndex = source.indexOf("const result = await sendSelectedSessionInput");
  const staleIndex = source.indexOf("if (result?.stale) return result");
  const failureIndex = source.indexOf("if (!result?.ok)");

  assert.notEqual(sendIndex, -1, "manual command sender should send through the SSH session API");
  assert.notEqual(staleIndex, -1, "manual command sender should return stale results without logging failure");
  assert.notEqual(failureIndex, -1, "manual command sender should still log real failures");
  assert.ok(sendIndex < staleIndex, "stale guard should inspect the send result");
  assert.ok(staleIndex < failureIndex, "stale guard should run before command failure logging");
});

test("SSH session input appends a visible terminal failure line when sending fails", () => {
  const source = functionSource("sendSelectedSessionInput", "sendSelectedCommand");
  const failureIndex = source.indexOf("if (!result?.ok)");
  const returnIndex = source.indexOf("return { ok: false, message }", failureIndex);
  const failureBlock = source.slice(failureIndex, returnIndex);

  assert.notEqual(failureIndex, -1, "send failure branch should exist");
  assert.notEqual(returnIndex, -1, "failure branch should return an error result");
  assert.match(failureBlock, /appendTerminalLines\(name/);
  assert.match(failureBlock, /terminalKey:\s*sessionKey/);
  assert.match(failureBlock, /SSH 发送失败/);
  assert.match(failureBlock, /message/);
});

test("SSH session input appends a visible terminal failure line when the send API throws", () => {
  const source = functionSource("sendSelectedSessionInput", "sendSelectedCommand");
  const catchIndex = source.indexOf("} catch (error) {");
  const returnIndex = source.indexOf("return { ok: false, message }", catchIndex);
  const catchBlock = source.slice(catchIndex, returnIndex);

  assert.notEqual(catchIndex, -1, "send exception branch should exist");
  assert.notEqual(returnIndex, -1, "send exception branch should return an error result");
  assert.match(catchBlock, /appendTerminalLines\(name/);
  assert.match(catchBlock, /terminalKey:\s*sessionKey/);
  assert.match(catchBlock, /SSH 发送失败/);
  assert.match(catchBlock, /message/);
});

test("SSH session input preflight failures are visible in the terminal", () => {
  const source = functionSource("sendSelectedSessionInput", "sendSelectedCommand");
  const noSessionIndex = source.indexOf("if (!sessionId)");
  const textIndex = source.indexOf("const text =", noSessionIndex);
  const apiIndex = source.indexOf("if (!api?.send_ssh_session_input", textIndex);
  const tryIndex = source.indexOf("try {", apiIndex);

  assert.notEqual(noSessionIndex, -1, "missing session branch should exist");
  assert.notEqual(apiIndex, -1, "missing SSH input API branch should exist");
  assert.notEqual(textIndex, -1, "command text should be resolved after session preflight");
  assert.notEqual(tryIndex, -1, "try block should follow SSH input API preflight");

  const noSessionBranch = source.slice(noSessionIndex, textIndex);
  const apiBranch = source.slice(apiIndex, tryIndex);

  assert.match(noSessionBranch, /appendTerminalLines\(name/);
  assert.match(noSessionBranch, /terminalKey:\s*sessionKey/);
  assert.match(noSessionBranch, /当前没有已连接的 SSH 会话/);
  assert.match(apiBranch, /appendTerminalLines\(name/);
  assert.match(apiBranch, /terminalKey:\s*sessionKey/);
  assert.match(apiBranch, /当前环境不支持 SSH 输入/);
});

test("SSH session input preflight failures are recorded in tool logs", () => {
  const source = functionSource("sendSelectedSessionInput", "sendSelectedCommand");
  const noSessionIndex = source.indexOf("if (!sessionId)");
  const textIndex = source.indexOf("const text =", noSessionIndex);
  const apiIndex = source.indexOf("if (!api?.send_ssh_session_input", textIndex);
  const tryIndex = source.indexOf("try {", apiIndex);

  const noSessionBranch = source.slice(noSessionIndex, textIndex);
  const apiBranch = source.slice(apiIndex, tryIndex);

  assert.match(noSessionBranch, /writeToolLogEvent\(\{/);
  assert.match(noSessionBranch, /level:\s*"warn"/);
  assert.match(noSessionBranch, /component:\s*"ssh"/);
  assert.match(noSessionBranch, /action:\s*"interactive_input_no_session"/);
  assert.match(noSessionBranch, /failureKind:\s*"input"/);
  assert.match(apiBranch, /writeToolLogEvent\(\{/);
  assert.match(apiBranch, /level:\s*"error"/);
  assert.match(apiBranch, /component:\s*"ssh"/);
  assert.match(apiBranch, /action:\s*"interactive_input_api_unavailable"/);
  assert.match(apiBranch, /failureKind:\s*"input"/);
});

test("SSH session input tool logs include safe connection context", () => {
  const source = functionSource("sendSelectedSessionInput", "sendSelectedCommand");
  const contextIndex = source.indexOf("const sshInputLogContext = {");
  const noSessionIndex = source.indexOf("if (!sessionId)");
  const failureIndex = source.indexOf("if (!result?.ok)");
  const catchIndex = source.indexOf("} catch (error) {");

  assert.notEqual(contextIndex, -1, "input log context should be built once");
  assert.ok(contextIndex < noSessionIndex, "preflight failures should use the same safe context");
  assert.match(source, /const inputServer = servers\[name\] \|\| \{\};/);
  assert.match(source, /host:\s*inputServer\?\.ip \|\| inputServer\?\.host \|\| ""/);
  assert.match(source, /port:\s*inputServer\?\.port \|\| 22/);
  assert.match(source, /user:\s*inputServer\?\.user \|\| ""/);
  assert.match(source, /sessionKey/);

  const logSource = source.slice(contextIndex);
  assert.doesNotMatch(logSource, /credentialSecret|password|apiKey|token|identityFile/);
  assert.match(source.slice(noSessionIndex, failureIndex), /context:\s*\{\s*\.\.\.sshInputLogContext,\s*failureKind:\s*"input"\s*\}/);
  assert.match(source.slice(failureIndex, catchIndex), /context:\s*\{\s*\.\.\.sshInputLogContext,\s*sessionId,\s*failureKind:\s*failureDiagnostics\?\.kind \|\| result\?\.failureKind \|\| "input"\s*\}/);
  assert.match(source.slice(catchIndex), /context:\s*\{\s*\.\.\.sshInputLogContext,\s*sessionId,\s*failureKind:\s*failureDiagnostics\?\.kind \|\| "input"\s*\}/);
});

test("SSH session input failures are recorded in session logs", () => {
  const source = functionSource("sendSelectedSessionInput", "sendSelectedCommand");
  const failureIndex = source.indexOf("if (!result?.ok)");
  const catchIndex = source.indexOf("} catch (error) {");
  const failureBlock = source.slice(failureIndex, catchIndex);
  const catchBlock = source.slice(catchIndex, source.indexOf("return { ok: false, message }", catchIndex));

  assert.notEqual(failureIndex, -1, "backend failure branch should exist");
  assert.notEqual(catchIndex, -1, "exception failure branch should exist");
  assert.match(failureBlock, /writeSessionLogEvent\(\{ type:\s*"interactive_input_failed"/);
  assert.match(failureBlock, /sessionId/);
  assert.match(failureBlock, /const loggedInput = formatTerminalInputForLog\(text,\s*\{ sensitiveInput,\s*submit \}\)/);
  assert.match(failureBlock, /command:\s*loggedInput/);
  assert.match(failureBlock, /status:\s*"failed",\s*context:\s*sshInputLogContext/);
  assert.match(catchBlock, /writeSessionLogEvent\(\{ type:\s*"interactive_input_failed"/);
  assert.match(catchBlock, /sessionId/);
  assert.match(catchBlock, /const loggedInput = formatTerminalInputForLog\(text,\s*\{ sensitiveInput,\s*submit \}\)/);
  assert.match(catchBlock, /command:\s*loggedInput/);
  assert.match(catchBlock, /status:\s*"failed",\s*context:\s*sshInputLogContext/);
});

test("SSH session input failures are recorded in audit logs", () => {
  const source = functionSource("sendSelectedSessionInput", "sendSelectedCommand");
  const failureIndex = source.indexOf("if (!result?.ok)");
  const catchIndex = source.indexOf("} catch (error) {");
  const failureBlock = source.slice(failureIndex, catchIndex);
  const catchBlock = source.slice(catchIndex, source.indexOf("return { ok: false, message }", catchIndex));

  assert.notEqual(failureIndex, -1, "backend failure branch should exist");
  assert.notEqual(catchIndex, -1, "exception failure branch should exist");
  assert.match(failureBlock, /writeAuditEvent\(\{ type:\s*"interactive_input_failed"/);
  assert.match(failureBlock, /sessionId/);
  assert.match(failureBlock, /const loggedInput = formatTerminalInputForLog\(text,\s*\{ sensitiveInput,\s*submit \}\)/);
  assert.match(failureBlock, /command:\s*loggedInput/);
  assert.match(failureBlock, /status:\s*"failed"/);
  assert.match(catchBlock, /writeAuditEvent\(\{ type:\s*"interactive_input_failed"/);
  assert.match(catchBlock, /sessionId/);
  assert.match(catchBlock, /const loggedInput = formatTerminalInputForLog\(text,\s*\{ sensitiveInput,\s*submit \}\)/);
  assert.match(catchBlock, /command:\s*loggedInput/);
  assert.match(catchBlock, /status:\s*"failed"/);
});

test("SSH session input failures are recorded in tool logs for diagnostics", () => {
  const source = functionSource("sendSelectedSessionInput", "sendSelectedCommand");
  const failureIndex = source.indexOf("if (!result?.ok)");
  const catchIndex = source.indexOf("} catch (error) {");
  const failureBlock = source.slice(failureIndex, catchIndex);
  const catchBlock = source.slice(catchIndex, source.indexOf("return { ok: false, message }", catchIndex));

  assert.notEqual(failureIndex, -1, "backend failure branch should exist");
  assert.notEqual(catchIndex, -1, "exception failure branch should exist");
  assert.match(failureBlock, /writeToolLogEvent\(\{/);
  assert.match(failureBlock, /level:\s*"warn"/);
  assert.match(failureBlock, /component:\s*"ssh"/);
  assert.match(failureBlock, /action:\s*"interactive_input_failed"/);
  assert.match(failureBlock, /failureKind:\s*failureDiagnostics\?\.kind \|\| result\?\.failureKind \|\| "input"/);
  assert.match(catchBlock, /writeToolLogEvent\(\{/);
  assert.match(catchBlock, /level:\s*"error"/);
  assert.match(catchBlock, /component:\s*"ssh"/);
  assert.match(catchBlock, /action:\s*"interactive_input_error"/);
  assert.match(catchBlock, /failureKind:\s*failureDiagnostics\?\.kind \|\| "input"/);
});

test("manual SSH command sender keeps the command draft until the send succeeds", () => {
  const start = app.indexOf("async function sendSelectedCommand");
  const end = app.indexOf("\n  return (", start);
  assert.notEqual(start, -1, "sendSelectedCommand should exist");
  assert.notEqual(end, -1, "sendSelectedCommand should appear before render");
  const source = app.slice(start, end);
  const sendIndex = source.indexOf("const result = await sendSelectedSessionInput");
  const clearIndex = source.indexOf("setCommandInputs((current) => ({ ...current, [commandInputKey]: \"\" }))");

  assert.notEqual(sendIndex, -1, "manual command sender should send through the SSH session API");
  assert.notEqual(clearIndex, -1, "successful command send should clear the draft");
  assert.ok(sendIndex < clearIndex, "manual command draft must clear only after sendSelectedSessionInput returns");
  assert.match(source.slice(sendIndex, clearIndex), /if \(result\?\.ok\)/);
});

test("manual SSH command sender shows the unsent command when auto connect fails", () => {
  const start = app.indexOf("async function sendSelectedCommand");
  const end = app.indexOf("\n  return (", start);
  assert.notEqual(start, -1, "sendSelectedCommand should exist");
  assert.notEqual(end, -1, "sendSelectedCommand should appear before render");
  const source = app.slice(start, end);
  const connectIndex = source.indexOf("sessionId = await ensureCommandSession");
  const noSessionIndex = source.indexOf("if (!sessionId)", connectIndex);
  const sensitiveIndex = source.indexOf("if (shouldSubmitAsSensitiveTerminalInput", noSessionIndex);
  const noSessionBlock = source.slice(noSessionIndex, sensitiveIndex);

  assert.notEqual(connectIndex, -1, "manual command sender should try to auto connect first");
  assert.notEqual(noSessionIndex, -1, "manual command sender should handle auto connect failure");
  assert.match(noSessionBlock, /appendTerminalLines\(name/);
  assert.match(noSessionBlock, /terminalKey:\s*sessionKey/);
  assert.match(noSessionBlock, /命令未发送/);
  assert.match(noSessionBlock, /rawCommand/);
  assert.match(noSessionBlock, /return \{ ok:\s*false/);
});

test("SSH session input uses a timeout guard and clears busy state on failures", () => {
  const source = functionSource("sendSelectedSessionInput", "sendSelectedCommand");
  const failureIndex = source.indexOf("if (!result?.ok)");
  const catchIndex = source.indexOf("} catch (error) {");
  const failureBlock = source.slice(failureIndex, catchIndex);
  const catchBlock = source.slice(catchIndex, source.indexOf("return { ok: false, message }", catchIndex));

  assert.match(app, /function withSshApiTimeout\(promise,\s*message\)/);
  assert.match(source, /withSshApiTimeout\(\s*api\.send_ssh_session_input\(sessionId,\s*text,\s*submit\),\s*"SSH 交互输入响应超时，请检查网络或重新连接会话。",?\s*\)/);
  assert.match(source, /return result;\s*}\s*catch \(error\)/);
  assert.match(failureBlock, /busy:\s*false/);
  assert.match(catchBlock, /busy:\s*false/);
  assert.match(source.slice(catchIndex), /return \{ ok:\s*false,\s*message \}/);
});

test("SSH session input failures mark the session disconnected for recovery", () => {
  const source = functionSource("sendSelectedSessionInput", "sendSelectedCommand");
  const failureIndex = source.indexOf("if (!result?.ok)");
  const catchIndex = source.indexOf("} catch (error) {");
  const failureBlock = source.slice(failureIndex, catchIndex);
  const catchBlock = source.slice(catchIndex, source.indexOf("return { ok: false, message }", catchIndex));

  assert.match(failureBlock, /sessionId:\s*""/);
  assert.match(failureBlock, /const disconnectedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(failureBlock, /disconnectedAt/);
  assert.match(failureBlock, /lastError:\s*message/);
  assert.match(catchBlock, /sessionId:\s*""/);
  assert.match(catchBlock, /const disconnectedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(catchBlock, /disconnectedAt/);
  assert.match(catchBlock, /lastError:\s*message/);
});

test("SSH session input failures preserve structured diagnostics for recovery actions", () => {
  const source = functionSource("sendSelectedSessionInput", "sendSelectedCommand");
  const failureIndex = source.indexOf("if (!result?.ok)");
  const catchIndex = source.indexOf("} catch (error) {");
  const failureBlock = source.slice(failureIndex, catchIndex);
  const catchBlock = source.slice(catchIndex, source.indexOf("return { ok: false, message }", catchIndex));

  assert.match(app, /buildSshConnectionDiagnostics/);
  assert.match(failureBlock, /const failureDiagnostics = result\?\.sshFailure \|\| buildSshConnectionDiagnostics\(/);
  assert.match(failureBlock, /failureKind:\s*failureDiagnostics\?\.kind \|\| result\?\.failureKind \|\| "input"/);
  assert.match(failureBlock, /sshFailure:\s*failureDiagnostics/);
  assert.match(failureBlock, /context:\s*\{\s*\.\.\.sshInputLogContext,\s*sessionId,\s*failureKind:\s*failureDiagnostics\?\.kind \|\| result\?\.failureKind \|\| "input"\s*\}/);

  assert.match(catchBlock, /const failureDiagnostics = buildSshConnectionDiagnostics\(/);
  assert.match(catchBlock, /failureKind:\s*failureDiagnostics\?\.kind \|\| "input"/);
  assert.match(catchBlock, /sshFailure:\s*failureDiagnostics/);
  assert.match(catchBlock, /context:\s*\{\s*\.\.\.sshInputLogContext,\s*sessionId,\s*failureKind:\s*failureDiagnostics\?\.kind \|\| "input"\s*\}/);
});
