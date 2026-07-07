import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = app.indexOf(`async function ${name}`);
  const end = app.indexOf(`${nextName}`, start);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return app.slice(start, end);
}

test("SSH stop command uses the desktop interrupt API and polls output immediately", () => {
  const source = functionSource("stopSelectedCommand", "function finishSelectedInteractiveMode");

  assert.match(source, /async function stopSelectedCommand\(targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(source, /const sessionKey = options\.sessionKey \|\| resolveTerminalSessionKey\(targetName\)/);
  assert.match(source, /api\?\.interrupt_ssh_session_command/);
  assert.match(source, /await api\.interrupt_ssh_session_command\(session\.sessionId\)/);
  assert.match(source, /triggerSshOutputPoll\(\)/);
  assert.doesNotMatch(source, /api\?\.stop_ssh_session_command/);
});

test("SSH stop command records successful interrupts in session logs", () => {
  const source = functionSource("stopSelectedCommand", "function finishSelectedInteractiveMode");
  const successStart = source.indexOf("appendTerminalLines(targetName, [\"^C\"]");
  const catchIndex = source.indexOf("} catch (error) {");

  assert.notEqual(successStart, -1, "interrupt success branch should append ^C");
  assert.notEqual(catchIndex, -1, "interrupt failure branch should follow success branch");

  const successBranch = source.slice(successStart, catchIndex);
  assert.match(source, /const interruptLogContext = \{ \.\.\.buildSshSessionLogContext\(targetName,\s*servers\[targetName\] \|\| \{\}\),\s*sessionKey \}/);
  assert.match(successBranch, /writeSessionLogEvent\(\{ type:\s*"session_interrupt_sent"/);
  assert.match(successBranch, /server:\s*targetName/);
  assert.match(successBranch, /sessionId:\s*session\.sessionId/);
  assert.match(successBranch, /actor:\s*"user"/);
  assert.match(successBranch, /status:\s*"ok",\s*context:\s*interruptLogContext/);
});

test("SSH stop command reports and logs interrupt failures", () => {
  const source = functionSource("stopSelectedCommand", "function finishSelectedInteractiveMode");
  const fallbackIndex = source.indexOf("else if (api?.send_ssh_session_input)");
  const successIndex = source.indexOf("appendTerminalLines(targetName, [\"^C\"]", fallbackIndex);
  const catchIndex = source.indexOf("} catch (error) {");
  const catchBlock = source.slice(catchIndex, source.indexOf("\n    }", catchIndex));

  assert.notEqual(fallbackIndex, -1, "Ctrl+C fallback branch should exist");
  assert.notEqual(successIndex, -1, "success branch should append ^C");
  assert.notEqual(catchIndex, -1, "interrupt failure branch should exist");
  assert.match(source.slice(fallbackIndex, successIndex), /throw new Error/);
  assert.match(catchBlock, /writeSessionLogEvent\(\{ type:\s*"session_interrupt_failed"/);
  assert.match(catchBlock, /sessionId:\s*session\.sessionId/);
  assert.match(catchBlock, /message/);
  assert.match(catchBlock, /status:\s*"failed",\s*context:\s*interruptLogContext/);
  assert.match(catchBlock, /appendTerminalLines\(targetName/);
  assert.match(catchBlock, /terminalKey:\s*sessionKey/);
});

test("SSH stop command treats backend ok false as an interrupt failure", () => {
  const source = functionSource("stopSelectedCommand", "function finishSelectedInteractiveMode");
  const tryStart = source.indexOf("try {");
  const successIndex = source.indexOf("appendTerminalLines(targetName, [\"^C\"]", tryStart);

  assert.notEqual(tryStart, -1, "interrupt try block should exist");
  assert.notEqual(successIndex, -1, "success branch should append ^C");
  const sendBlock = source.slice(tryStart, successIndex);

  assert.match(sendBlock, /let result/);
  assert.match(sendBlock, /result = await api\.interrupt_ssh_session_command\(session\.sessionId\)/);
  assert.match(sendBlock, /result = await api\.send_ssh_session_input\(session\.sessionId,\s*"\\x03"/);
  assert.match(sendBlock, /if \(!result\?\.ok\)/);
  assert.match(sendBlock, /throw new Error\(result\?\.message/);
});

test("Ctrl+C sends raw ETX to connected idle shells and clears the local draft", () => {
  const start = app.indexOf("function handleCommandHistoryKeyDown");
  const end = app.indexOf("function useCommandSnippet", start);
  assert.notEqual(start, -1, "command key handler should exist");
  assert.notEqual(end, -1, "useCommandSnippet should follow command key handler");
  const source = app.slice(start, end);
  const idleInterruptStart = source.indexOf('runningSessionControlInput?.action === "interrupt" && isConnectedSession');
  const runningInputStart = source.indexOf("if (isRunningSession && runningSessionControlInput)", idleInterruptStart);

  assert.notEqual(idleInterruptStart, -1, "connected idle Ctrl+C branch should exist");
  assert.notEqual(runningInputStart, -1, "running control input branch should follow idle interrupt branch");
  const idleInterruptBranch = source.slice(idleInterruptStart, runningInputStart);

  assert.match(idleInterruptBranch, /event\.preventDefault\(\)/);
  assert.match(idleInterruptBranch, /sendSelectedSessionInput\(event,\s*\{\s*text:\s*"\\x03",\s*submit:\s*false,\s*clearInput:\s*true\s*\}\)/);
  assert.doesNotMatch(idleInterruptBranch, /stopSelectedCommand\(\)/);
});

test("command input Ctrl+C sends raw ETX to connected idle shells and clears the local draft", () => {
  const start = app.indexOf("function TerminalWorkspace");
  const end = app.indexOf("function LegacyAgentPanel", start + 1);
  assert.notEqual(start, -1, "TerminalWorkspace should exist");
  assert.notEqual(end, -1, "LegacyAgentPanel should follow TerminalWorkspace");
  const source = app.slice(start, end);
  const handlerStart = source.indexOf("function handleCommandInputKeyDown");
  const handlerEnd = source.indexOf("function handleCommandHistorySearchKeyDown", handlerStart);
  assert.notEqual(handlerStart, -1, "command input key handler should exist");
  assert.notEqual(handlerEnd, -1, "history search handler should follow command input handler");
  const handler = source.slice(handlerStart, handlerEnd);

  const ctrlCBranch = handler.indexOf('event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "c"');
  const connectedShellInput = handler.indexOf("const connectedShellInput = buildConnectedShellInput");
  assert.notEqual(ctrlCBranch, -1, "command input should handle Ctrl+C explicitly");
  assert.notEqual(connectedShellInput, -1, "command input should still support raw connected shell input");
  assert.ok(ctrlCBranch < connectedShellInput, "Ctrl+C should interrupt through the visible SSH flow before it can be sent as raw PTY input");

  const branch = handler.slice(ctrlCBranch, connectedShellInput);
  assert.match(branch, /event\.preventDefault\(\)/);
  assert.match(branch, /if \(isConnected && !isRunningInteractiveCommand\)/);
  assert.match(branch, /onSendInteractiveInput\?\.\(event,\s*\{\s*text:\s*"\\x03",\s*submit:\s*false,\s*clearInput:\s*true\s*\}\)/);
  assert.match(branch, /onCommandChange\?\.\(""\)/);
  assert.match(branch, /onStopCommand\?\.\(selectedServer\)/);
  assert.ok(branch.indexOf('onCommandChange?.("")') < branch.indexOf("onStopCommand?.(selectedServer)"), "disconnected Ctrl+C should clear the local draft before stop fallback");
});

test("terminal surface Ctrl+C sends raw ETX to connected idle shells and clears the local draft", () => {
  const start = app.indexOf("function TerminalWorkspace");
  const end = app.indexOf("function LegacyAgentPanel", start + 1);
  assert.notEqual(start, -1, "TerminalWorkspace should exist");
  assert.notEqual(end, -1, "LegacyAgentPanel should follow TerminalWorkspace");
  const source = app.slice(start, end);
  const handlerStart = source.indexOf("function handleTerminalShellKeyDown");
  const handlerEnd = source.indexOf("function handleHistoryUse", handlerStart);
  assert.notEqual(handlerStart, -1, "terminal surface key handler should exist");
  assert.notEqual(handlerEnd, -1, "history handler should follow terminal surface key handler");
  const handler = source.slice(handlerStart, handlerEnd);

  const ctrlCBranch = handler.indexOf('event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "c"');
  const directInputBranch = handler.indexOf("if (sendConnectedShellSurfaceDirectControlInput(event)) return;");
  assert.notEqual(ctrlCBranch, -1, "terminal surface should handle Ctrl+C explicitly");
  assert.notEqual(directInputBranch, -1, "terminal surface should still support direct PTY control input");
  assert.ok(ctrlCBranch < directInputBranch, "terminal surface Ctrl+C should interrupt through the visible SSH flow before raw PTY input");

  const branch = handler.slice(ctrlCBranch, directInputBranch);
  assert.match(branch, /event\.preventDefault\(\)/);
  assert.match(branch, /if \(isConnected && !isRunningInteractiveCommand\)/);
  assert.match(branch, /onSendInteractiveInput\?\.\(event,\s*\{\s*text:\s*"\\x03",\s*submit:\s*false,\s*clearInput:\s*true\s*\}\)/);
  assert.match(branch, /onCommandChange\?\.\(""\)/);
  assert.match(branch, /onStopCommand\?\.\(selectedServer\)/);
  assert.ok(branch.indexOf('onCommandChange?.("")') < branch.indexOf("onStopCommand?.(selectedServer)"), "terminal surface Ctrl+C should clear the local draft before stop fallback");
});

test("terminal toolbar Ctrl+C uses the same idle shell ETX flow", () => {
  const start = app.indexOf("function TerminalWorkspace");
  const end = app.indexOf("function LegacyAgentPanel", start + 1);
  assert.notEqual(start, -1, "TerminalWorkspace should exist");
  assert.notEqual(end, -1, "LegacyAgentPanel should follow TerminalWorkspace");
  const source = app.slice(start, end);
  const handlerStart = source.indexOf("function handleTerminalCtrlCButtonClick");
  const handlerEnd = source.indexOf("function handleCommandHistorySearchKeyDown", handlerStart);

  assert.notEqual(handlerStart, -1, "toolbar Ctrl+C handler should exist");
  assert.notEqual(handlerEnd, -1, "history handler should follow toolbar Ctrl+C handler");
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /if \(isConnected && !isRunningInteractiveCommand\)/);
  assert.match(handler, /onSendInteractiveInput\?\.\(event,\s*\{\s*text:\s*"\\x03",\s*submit:\s*false,\s*clearInput:\s*true\s*\}\)/);
  assert.match(handler, /onCommandChange\?\.\(""\)/);
  assert.match(handler, /onStopCommand\?\.\(selectedServer\)/);
  assert.ok(handler.indexOf('onCommandChange?.("")') < handler.indexOf("onStopCommand?.(selectedServer)"), "toolbar Ctrl+C should clear the local draft before stop fallback");
  assert.match(source, /<button type="button" className="pill-button" onClick=\{handleTerminalCtrlCButtonClick\} disabled=\{!isConnected\}>/);
});

test("terminal workspace renders compact SSH control buttons for connected sessions", () => {
  const start = app.indexOf("function TerminalWorkspace");
  const end = app.indexOf("function LegacyAgentPanel", start + 1);
  assert.notEqual(start, -1, "TerminalWorkspace should exist");
  assert.notEqual(end, -1, "LegacyAgentPanel should follow TerminalWorkspace");
  const source = app.slice(start, end);

  assert.match(source, /function handleTerminalControlButtonClick\(control,\s*event\)/);
  assert.match(source, /TERMINAL_INTERACTIVE_CONTROL_BUTTONS\.map/);
  assert.match(source, /className="terminal-interactive-controls"/);
  assert.match(source, /className="terminal-interactive-control-button"/);
  assert.match(source, /disabled=\{!isConnected\}/);
  assert.match(source, /onSendInteractiveInput\?\.\(event,\s*\{[\s\S]*text:\s*control\.text[\s\S]*submit:\s*false[\s\S]*clearInput:\s*false[\s\S]*finishInteractiveMode:\s*control\.finishInteractiveMode/);
});

test("terminal surface direct control keys include Windows interrupt variants", () => {
  const start = app.indexOf("function isConnectedShellDirectControlKey");
  const end = app.indexOf("function isConnectedShellScreenControlKey", start);
  assert.notEqual(start, -1, "connected shell direct control helper should exist");
  assert.notEqual(end, -1, "screen control helper should follow direct control helper");
  const source = app.slice(start, end);

  assert.match(source, /"pause"/);
  assert.match(source, /"cancel"/);
  assert.match(source, /"break"/);
});

test("terminal quick control buttons include common shell line editing keys", () => {
  const start = app.indexOf("const TERMINAL_INTERACTIVE_CONTROL_BUTTONS");
  const end = app.indexOf("function isConnectedShellFlowControlKey", start);
  assert.notEqual(start, -1, "interactive control button list should exist");
  assert.notEqual(end, -1, "connected shell flow control helper should follow control button list");
  const source = app.slice(start, end);

  assert.match(source, /\{ label:\s*"Ctrl\+A",\s*text:\s*"\\x01",\s*title:\s*"发送 Ctrl\+A，移动到行首" \}/);
  assert.match(source, /\{ label:\s*"Ctrl\+E",\s*text:\s*"\\x05",\s*title:\s*"发送 Ctrl\+E，移动到行尾" \}/);
  assert.match(source, /\{ label:\s*"Ctrl\+U",\s*text:\s*"\\x15",\s*title:\s*"发送 Ctrl\+U，删除光标前内容" \}/);
  assert.match(source, /\{ label:\s*"Ctrl\+K",\s*text:\s*"\\x0b",\s*title:\s*"发送 Ctrl\+K，删除光标后内容" \}/);
});

test("terminal quick control buttons leave interactive mode for suspend and quit controls", () => {
  const start = app.indexOf("const TERMINAL_INTERACTIVE_CONTROL_BUTTONS");
  const end = app.indexOf("function isConnectedShellFlowControlKey", start);
  assert.notEqual(start, -1, "interactive control button list should exist");
  assert.notEqual(end, -1, "connected shell flow control helper should follow control button list");
  const source = app.slice(start, end);

  assert.match(source, /\{ label:\s*"Ctrl\+Z",\s*text:\s*"\\x1a"[\s\S]{0,120}finishInteractiveMode:\s*true/);
  assert.match(source, /\{ label:\s*"Ctrl\\{2}",\s*text:\s*"\\x1c"[\s\S]{0,120}finishInteractiveMode:\s*true/);
});

test("terminal control signal actions record safe audit and session log events", () => {
  const source = functionSource("sendTerminalControlSignal", "function clearSelectedTerminalOutput");
  const controlSendIndex = source.indexOf("const input = controlInputs[signal] || \"\"");
  const endIndex = source.indexOf("\n  }", controlSendIndex);
  assert.notEqual(controlSendIndex, -1, "control input branch should exist");
  assert.notEqual(endIndex, -1, "control input branch should end");
  const controlBranch = source.slice(controlSendIndex, endIndex);

  assert.match(controlBranch, /const controlLogContext = \{ \.\.\.buildSshSessionLogContext\(targetName,\s*servers\[targetName\] \|\| \{\}\),\s*sessionKey,\s*signal \}/);
  assert.match(controlBranch, /const result = await sendSelectedSessionInput/);
  assert.match(controlBranch, /recordTerminalControlSignalResult\(result,\s*signal,\s*targetName,\s*session\.sessionId,\s*controlLogContext\)/);
  assert.doesNotMatch(controlBranch, /command:\s*input/);

  const helperSource = app.slice(app.indexOf("function recordTerminalControlSignalResult"), app.indexOf("async function sendTerminalControlSignal"));
  assert.match(helperSource, /type:\s*ok \? "session_control_signal_sent" : "session_control_signal_failed"/);
  assert.match(helperSource, /command:\s*`control:\$\{signal\}`/);
  assert.match(helperSource, /writeAuditEvent\(event\)/);
  assert.match(helperSource, /writeSessionLogEvent\(\{ \.\.\.event,\s*context:\s*controlLogContext \}\)/);
  assert.doesNotMatch(helperSource, /command:\s*result|command:\s*input/);
});

test("idle Ctrl+C control signal records safe success and failure events", () => {
  const source = functionSource("sendTerminalControlSignal", "function clearSelectedTerminalOutput");
  const interruptIndex = source.indexOf('if (signal === "interrupt")');
  const controlInputsIndex = source.indexOf("const controlInputs", interruptIndex);
  assert.notEqual(interruptIndex, -1, "interrupt branch should exist");
  assert.notEqual(controlInputsIndex, -1, "control map should follow interrupt branch");
  const interruptBranch = source.slice(interruptIndex, controlInputsIndex);

  assert.match(interruptBranch, /const controlLogContext = \{ \.\.\.buildSshSessionLogContext\(targetName,\s*servers\[targetName\] \|\| \{\}\),\s*sessionKey,\s*signal \}/);
  assert.match(interruptBranch, /const result = await sendSelectedSessionInput\(null,\s*\{ text:\s*"\\x03",\s*submit:\s*false,\s*clearInput:\s*true,\s*targetName,\s*sessionKey \}\)/);
  assert.match(interruptBranch, /recordTerminalControlSignalResult\(result,\s*signal,\s*targetName,\s*session\.sessionId,\s*controlLogContext\)/);
  assert.doesNotMatch(interruptBranch, /command:\s*"\\x03"/);
});
