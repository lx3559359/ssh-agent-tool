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

test("SSH auto-connect preflight failures are visible in the terminal", () => {
  const source = functionSource("openSelectedSession", "ensureCommandSession");
  const apiBranchStart = source.indexOf("if (!api?.open_ssh_session)");
  const targetValidationStart = source.indexOf("const targetValidation = validateSshSessionOpenTarget(server)");
  const authBranchStart = source.indexOf("if (!hasUsableServerAuth(server))");

  assert.notEqual(apiBranchStart, -1, "desktop SSH API branch should exist");
  assert.notEqual(targetValidationStart, -1, "missing target configuration branch should exist");
  assert.notEqual(authBranchStart, -1, "missing authentication branch should exist");

  const apiBranch = source.slice(apiBranchStart, targetValidationStart);
  const targetValidationBranch = source.slice(targetValidationStart, authBranchStart);
  const authBranch = source.slice(authBranchStart, source.indexOf("const size = getRememberedTerminalPtySize", authBranchStart));

  assert.match(apiBranch, /appendTerminalLines\(name/);
  assert.match(apiBranch, /terminalKey:\s*sessionKey/);
  assert.match(apiBranch, /当前环境不支持 SSH 会话/);
  assert.match(targetValidationBranch, /targetValidation\.message/);
  assert.match(targetValidationBranch, /appendTerminalLines\(name/);
  assert.match(targetValidationBranch, /terminalKey:\s*sessionKey/);
  assert.match(authBranch, /appendTerminalLines\(name/);
  assert.match(authBranch, /terminalKey:\s*sessionKey/);
  assert.match(authBranch, /请先在认证中心绑定或填写 SSH 凭据/);
});

test("SSH session open failures are recorded in session logs", () => {
  const source = functionSource("openSelectedSession", "ensureCommandSession");
  const apiBranchStart = source.indexOf("if (!api?.open_ssh_session)");
  const targetValidationStart = source.indexOf("const targetValidation = validateSshSessionOpenTarget(server)");
  const authBranchStart = source.indexOf("if (!hasUsableServerAuth(server))");
  const backendFailureStart = source.indexOf("if (!result?.ok || !result.sessionId)");
  const catchStart = source.indexOf("} catch (error) {");

  assert.notEqual(apiBranchStart, -1, "desktop SSH API branch should exist");
  assert.notEqual(targetValidationStart, -1, "missing target configuration branch should exist");
  assert.notEqual(authBranchStart, -1, "missing authentication branch should exist");
  assert.notEqual(backendFailureStart, -1, "backend open failure branch should exist");
  assert.notEqual(catchStart, -1, "open exception branch should exist");

  const apiBranch = source.slice(apiBranchStart, targetValidationStart);
  const targetValidationBranch = source.slice(targetValidationStart, authBranchStart);
  const authBranch = source.slice(authBranchStart, source.indexOf("const size = getRememberedTerminalPtySize", authBranchStart));
  const backendFailureBranch = source.slice(backendFailureStart, source.indexOf("return \"\"", backendFailureStart));
  const catchBranch = source.slice(catchStart, source.indexOf("return \"\"", catchStart));

  assert.match(source, /const openActor = options\.actor \|\| "user"/);
  for (const branch of [apiBranch, targetValidationBranch, authBranch, backendFailureBranch, catchBranch]) {
    assert.match(branch, /writeSessionLogEvent\(\{ type:\s*"session_open_failed"/);
    assert.match(branch, /server:\s*name/);
    assert.match(branch, /actor:\s*openActor/);
    assert.match(branch, /message/);
    assert.match(branch, /status:\s*"failed"/);
  }
});

test("SSH session open exceptions are recorded in tool logs for diagnostics", () => {
  const source = functionSource("openSelectedSession", "ensureCommandSession");
  const catchStart = source.indexOf("} catch (error) {");
  const returnIndex = source.indexOf("return \"\"", catchStart);
  assert.notEqual(catchStart, -1, "open exception branch should exist");
  assert.notEqual(returnIndex, -1, "open exception branch should return an empty session id");
  const catchBranch = source.slice(catchStart, returnIndex);

  assert.match(catchBranch, /writeToolLogEvent\(\{/);
  assert.match(catchBranch, /level:\s*"error"/);
  assert.match(catchBranch, /component:\s*"ssh"/);
  assert.match(catchBranch, /action:\s*"open_session_error"/);
  assert.match(catchBranch, /failureKind:\s*failureDiagnostics\?\.kind \|\| "unknown"/);
  assert.match(catchBranch, /serverName:\s*name/);
  assert.match(catchBranch, /sessionKey/);
});

test("SSH backend session open failures are recorded in tool logs for diagnostics", () => {
  const source = functionSource("openSelectedSession", "ensureCommandSession");
  const backendFailureStart = source.indexOf("if (!result?.ok || !result.sessionId)");
  const returnIndex = source.indexOf("return \"\"", backendFailureStart);
  assert.notEqual(backendFailureStart, -1, "backend open failure branch should exist");
  assert.notEqual(returnIndex, -1, "backend open failure branch should return an empty session id");
  const backendFailureBranch = source.slice(backendFailureStart, returnIndex);

  assert.match(backendFailureBranch, /writeToolLogEvent\(\{/);
  assert.match(backendFailureBranch, /level:\s*"warn"/);
  assert.match(backendFailureBranch, /component:\s*"ssh"/);
  assert.match(backendFailureBranch, /action:\s*"open_session_failed"/);
  assert.match(backendFailureBranch, /failureKind:\s*failureDiagnostics\?\.kind \|\| result\?\.failureKind \|\| "unknown"/);
  assert.match(backendFailureBranch, /serverName:\s*name/);
  assert.match(backendFailureBranch, /sessionKey/);
});

test("SSH session open tool logs include safe connection context", () => {
  const source = functionSource("openSelectedSession", "ensureCommandSession");
  const logContextStart = source.indexOf("const sshLogContext");
  const openCallStart = source.indexOf("const result = await api.open_ssh_session");
  const backendFailureStart = source.indexOf("if (!result?.ok || !result.sessionId)");
  const catchStart = source.indexOf("} catch (error) {");

  assert.notEqual(logContextStart, -1, "safe SSH log context should be prepared before opening the session");
  assert.notEqual(openCallStart, -1, "open session call should exist");
  assert.ok(logContextStart < openCallStart, "safe SSH log context should be ready before backend calls can fail");

  const logContextSource = source.slice(logContextStart, openCallStart);
  assert.match(logContextSource, /serverName:\s*name/);
  assert.match(logContextSource, /host:\s*server\?\.ip \|\| server\?\.host \|\| ""/);
  assert.match(logContextSource, /port:\s*server\?\.port \|\| 22/);
  assert.match(logContextSource, /user:\s*server\?\.user \|\| ""/);
  assert.match(logContextSource, /sessionKey/);
  assert.doesNotMatch(logContextSource, /credentialRef|credentialSecret|password|identityFile/);

  const backendFailureBranch = source.slice(backendFailureStart, source.indexOf("return \"\"", backendFailureStart));
  const catchBranch = source.slice(catchStart, source.indexOf("return \"\"", catchStart));
  assert.match(backendFailureBranch, /context:\s*{\s*\.\.\.sshLogContext,/);
  assert.match(catchBranch, /context:\s*{\s*\.\.\.sshLogContext,/);
}
);

test("SSH preflight failures update terminal recovery diagnostics", () => {
  const source = functionSource("openSelectedSession", "ensureCommandSession");
  const apiBranchStart = source.indexOf("if (!api?.open_ssh_session)");
  const targetValidationStart = source.indexOf("const targetValidation = validateSshSessionOpenTarget(server)");
  const authBranchStart = source.indexOf("if (!hasUsableServerAuth(server))");
  const sizeStart = source.indexOf("const size = getRememberedTerminalPtySize", authBranchStart);
  const busyStart = source.indexOf("setSshSessions((state) => ({ ...state, [sessionKey]: { ...(state[sessionKey] || {}), serverName: name, busy: true");

  const apiBranch = source.slice(apiBranchStart, targetValidationStart);
  const targetValidationBranch = source.slice(targetValidationStart, authBranchStart);
  const authBranch = source.slice(authBranchStart, sizeStart);
  const busyBranch = source.slice(busyStart, source.indexOf("appendTerminalLines(name, [\"[\" + name + \"]$ # connecting SSH...\"]", busyStart));

  for (const branch of [apiBranch, targetValidationBranch, authBranch]) {
    assert.match(branch, /setSshSessions\(\(state\) =>/);
    assert.match(branch, /lastError:\s*message/);
    assert.match(branch, /sshFailure:\s*\{/);
    assert.match(branch, /summary:\s*message/);
  }
  assert.match(apiBranch, /failureKind:\s*"environment"/);
  assert.match(apiBranch, /kind:\s*"environment"/);
  assert.match(targetValidationBranch, /failureKind:\s*"config"/);
  assert.match(targetValidationBranch, /kind:\s*"config"/);
  assert.match(authBranch, /failureKind:\s*"auth"/);
  assert.match(authBranch, /kind:\s*"auth"/);
  assert.match(busyBranch, /failureKind:\s*""/);
  assert.match(busyBranch, /sshFailure:\s*null/);
});

test("SSH session open success is recorded in session logs", () => {
  const source = functionSource("openSelectedSession", "ensureCommandSession");
  const successStart = source.indexOf("sessionId: result.sessionId");
  const returnIndex = source.indexOf("return result.sessionId", successStart);

  assert.notEqual(successStart, -1, "open success branch should exist");
  assert.notEqual(returnIndex, -1, "open success branch should return the session id");

  const successBranch = source.slice(successStart, returnIndex);
  assert.match(successBranch, /writeSessionLogEvent\(\{ type:\s*"session_opened"/);
  assert.match(successBranch, /server:\s*name/);
  assert.match(successBranch, /sessionId:\s*result\.sessionId/);
  assert.match(successBranch, /actor:\s*openActor/);
  assert.match(successBranch, /status:\s*"ok"/);
});

test("manual SSH session open is recorded as a user action", () => {
  const source = functionSource("openSelectedSession", "ensureCommandSession");
  const successStart = source.indexOf("sessionId: result.sessionId");
  const returnIndex = source.indexOf("return result.sessionId", successStart);
  assert.notEqual(successStart, -1, "open success branch should exist");
  assert.notEqual(returnIndex, -1, "open success branch should return the session id");
  const successBranch = source.slice(successStart, returnIndex);

  assert.match(source, /const openActor = options\.actor \|\| "user"/);
  assert.match(successBranch, /actor:\s*openActor/);
  assert.doesNotMatch(successBranch, /actor:\s*"system"/);
});

test("SSH session open failure preserves backend diagnostics and success clears stale diagnostics", () => {
  const source = functionSource("openSelectedSession", "ensureCommandSession");
  const backendFailureStart = source.indexOf("if (!result?.ok || !result.sessionId)");
  const successStart = source.indexOf("sessionId: result.sessionId");
  const writeSuccessLogStart = source.indexOf("writeAuditEvent({ type: \"session_opened\"", successStart);

  assert.notEqual(backendFailureStart, -1, "backend open failure branch should exist");
  assert.notEqual(successStart, -1, "open success branch should exist");

  const backendFailureBranch = source.slice(backendFailureStart, source.indexOf("return \"\"", backendFailureStart));
  const successBranch = source.slice(successStart, writeSuccessLogStart);

  assert.match(backendFailureBranch, /failureKind:\s*failureDiagnostics\?\.kind \|\| result\?\.failureKind \|\| "unknown"/);
  assert.match(backendFailureBranch, /sshFailure:\s*failureDiagnostics/);
  assert.match(successBranch, /failureKind:\s*""/);
  assert.match(successBranch, /sshFailure:\s*null/);
});

test("SSH session open failures infer diagnostics when backend omits structured sshFailure", () => {
  const source = functionSource("openSelectedSession", "ensureCommandSession");
  const backendFailureStart = source.indexOf("if (!result?.ok || !result.sessionId)");
  const catchStart = source.indexOf("} catch (error) {");
  const catchReturnStart = source.indexOf("return \"\"", catchStart);

  assert.match(app, /buildSshConnectionDiagnostics/);
  assert.notEqual(backendFailureStart, -1, "backend open failure branch should exist");
  assert.notEqual(catchStart, -1, "open exception branch should exist");
  assert.notEqual(catchReturnStart, -1, "open exception branch should return an empty session id");

  const backendFailureBranch = source.slice(backendFailureStart, source.indexOf("return \"\"", backendFailureStart));
  const catchBranch = source.slice(catchStart, catchReturnStart);

  assert.match(backendFailureBranch, /const failureDiagnostics = result\?\.sshFailure \|\| buildSshConnectionDiagnostics\(/);
  assert.match(backendFailureBranch, /failureKind:\s*failureDiagnostics\?\.kind \|\| result\?\.failureKind \|\| "unknown"/);
  assert.match(backendFailureBranch, /sshFailure:\s*failureDiagnostics/);
  assert.match(backendFailureBranch, /buildSshOpenFailureTerminalLines\(message,\s*failureDiagnostics,\s*server\)/);

  assert.match(catchBranch, /const failureDiagnostics = buildSshConnectionDiagnostics\(/);
  assert.match(catchBranch, /failureKind:\s*failureDiagnostics\?\.kind \|\| "unknown"/);
  assert.match(catchBranch, /sshFailure:\s*failureDiagnostics/);
  assert.match(catchBranch, /buildSshOpenFailureTerminalLines\(message,\s*failureDiagnostics,\s*server\)/);
});

test("SSH session open host-key failures preserve the returned fingerprint for trust flow", () => {
  const source = functionSource("openSelectedSession", "ensureCommandSession");
  const backendFailureStart = source.indexOf("if (!result?.ok || !result.sessionId)");
  assert.notEqual(backendFailureStart, -1, "backend open failure branch should exist");
  const backendFailureBranch = source.slice(backendFailureStart, source.indexOf("return \"\"", backendFailureStart));

  assert.match(backendFailureBranch, /const hostKey = extractHostKeyFromSshResult\(result\)/);
  assert.match(backendFailureBranch, /if \(hostKey\?\.sha256\)/);
  assert.match(backendFailureBranch, /setConnectionOverrides\(\(current\) =>/);
  assert.match(backendFailureBranch, /buildHostKeyEvidenceOverride\(/);
  assert.match(backendFailureBranch, /server\.trustedHostKey/);
});

test("SSH session close is recorded in session logs", () => {
  const source = functionSource("closeSessionByName", "closeSelectedSession");
  const closeStart = source.indexOf("const closeResult = await api.close_ssh_session(sessionId)");
  const appendIndex = source.indexOf("if (closeFailureMessage)", closeStart);

  assert.notEqual(closeStart, -1, "close API branch should exist");
  assert.notEqual(appendIndex, -1, "close branch should append terminal notice");

  const closeBranch = source.slice(closeStart, appendIndex);
  assert.match(source, /const closeActor = options\.actor \|\| "system"/);
  assert.match(closeBranch, /writeSessionLogEvent\(\{ type:\s*closeFailureMessage \? "session_close_failed" : "session_closed"/);
  assert.match(closeBranch, /server:\s*name/);
  assert.match(closeBranch, /sessionId/);
  assert.match(closeBranch, /actor:\s*closeActor/);
  assert.match(closeBranch, /message:\s*closeFailureMessage \|\| reason/);
  assert.match(closeBranch, /status:\s*closeFailureMessage \? "failed" : "ok"/);
});

test("SSH session close failures are recorded in session logs", () => {
  const source = functionSource("closeSessionByName", "closeSelectedSession");
  const backendFailureStart = source.indexOf("if (!closeResult?.ok)");
  const catchStart = source.indexOf("} catch");
  const logStart = source.indexOf("writeSessionLogEvent", catchStart);

  assert.notEqual(backendFailureStart, -1, "close backend failure branch should exist");
  assert.notEqual(catchStart, -1, "close exception branch should exist");
  assert.notEqual(logStart, -1, "close failure should be written to session logs after local state is cleared");

  const failureSource = source.slice(backendFailureStart, logStart + 260);
  assert.match(failureSource, /closeFailureMessage = closeResult\?\.message/);
  assert.match(failureSource, /closeFailureMessage = "关闭 SSH 会话失败："/);
  assert.match(failureSource, /disconnectedAt:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(failureSource, /writeSessionLogEvent\(\{ type:\s*closeFailureMessage \? "session_close_failed" : "session_closed"/);
  assert.match(failureSource, /status:\s*closeFailureMessage \? "failed" : "ok"/);
});
