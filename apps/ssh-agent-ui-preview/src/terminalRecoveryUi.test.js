import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(projectRoot, "src", "App.jsx");
const stylesPath = join(projectRoot, "src", "styles.css");

test("terminal recovery card renders action model buttons", () => {
  const app = readFileSync(appPath, "utf8");
  const workspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function PlanCard"));
  const mainStart = app.indexOf("<TerminalWorkspace");
  const mainSource = app.slice(mainStart, app.indexOf("<AgentPanel", mainStart));

  assert.match(workspaceSource, /buildTerminalSessionRecoveryActions/);
  assert.match(workspaceSource, /primaryRecoveryActions\.map/);
  assert.match(workspaceSource, /secondaryRecoveryActions\.map/);
  assert.match(workspaceSource, /onRunSessionRecoveryAction\(action\)/);
  assert.match(mainSource, /onRunSessionRecoveryAction=\{runTerminalSessionRecoveryAction\}/);
});

test("terminal command input forwards connected shell control keys before app shortcuts", () => {
  const app = readFileSync(appPath, "utf8");
  const workspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function PlanCard"));
  const handlerSource = workspaceSource.slice(workspaceSource.indexOf("function handleCommandInputKeyDown"), workspaceSource.indexOf("function handleTerminalSearchKeyDown"));

  assert.match(app, /buildConnectedShellInput/);
  assert.match(handlerSource, /buildConnectedShellInput\(event,\s*commandValue \|\| ""/);
  assert.match(handlerSource, /onSendInteractiveInput\(event,\s*\{ \.\.\.connectedShellInput,\s*clearInput: false \}\)/);
  assert.ok(
    handlerSource.indexOf("buildConnectedShellInput") < handlerSource.indexOf("onTerminalShortcutKeyDown"),
    "connected shell input must run before client shortcuts such as Ctrl+D disconnect",
  );
});

test("terminal command input forwards connected shell Alt keys before local command editing", () => {
  const app = readFileSync(appPath, "utf8");
  const mainHandlerStart = app.indexOf("function handleTerminalShortcutKeyDown");
  const mainHandlerEnd = app.indexOf("async function pasteClipboardToCommandInput", mainHandlerStart);
  const mainHandlerSource = app.slice(mainHandlerStart, mainHandlerEnd);

  assert.match(mainHandlerSource, /const connectedShellMetaInput = buildRunningSessionMetaInput\(event,\s*commandValue\)/);
  assert.match(mainHandlerSource, /sendSelectedSessionInput\(event,\s*\{ \.\.\.connectedShellMetaInput,\s*clearInput: false \}\)/);
  assert.ok(
    mainHandlerSource.indexOf("const connectedShellMetaInput") < mainHandlerSource.indexOf("const edit = applyTerminalCommandEditKey"),
    "Alt+Backspace should reach the connected SSH shell before local empty-draft editing can consume it",
  );
});

test("terminal connected-shell direct controls include tab and newline aliases", () => {
  const app = readFileSync(appPath, "utf8");
  const directControlSource = app.slice(app.indexOf("function isConnectedShellDirectControlKey"), app.indexOf("function isConnectedShellScreenControlKey"));

  assert.match(directControlSource, /"i"/, "Ctrl+I should be forwarded as Tab when connected");
  assert.match(directControlSource, /"j"/, "Ctrl+J should be forwarded as newline when connected");
  assert.match(directControlSource, /"m"/, "Ctrl+M should be forwarded as carriage return when connected");
});

test("terminal connected-shell direct controls include slash punctuation aliases", () => {
  const app = readFileSync(appPath, "utf8");
  const directControlSource = app.slice(app.indexOf("function isConnectedShellDirectControlKey"), app.indexOf("function isConnectedShellScreenControlKey"));

  assert.match(directControlSource, /"@"/, "Ctrl+@ should be forwarded as NUL when connected");
  assert.match(directControlSource, /"\/"/, "Ctrl+/ should be forwarded as Ctrl+_ when connected");
  assert.match(directControlSource, /"\?"/, "Ctrl+? should be forwarded as Delete when connected");
});

test("terminal connected-shell direct controls include word delete aliases", () => {
  const app = readFileSync(appPath, "utf8");
  const directControlSource = app.slice(app.indexOf("function isConnectedShellDirectControlKey"), app.indexOf("function isConnectedShellScreenControlKey"));

  assert.match(directControlSource, /"backspace"/, "Ctrl+Backspace should be forwarded as Ctrl+W when connected");
  assert.match(directControlSource, /"delete"/, "Ctrl+Delete should be forwarded as remote word erase when connected");
});

test("terminal shortcut help mentions connected shell word erase aliases", () => {
  const app = readFileSync(appPath, "utf8");

  assert.match(app, /Ctrl\+Backspace \/ Ctrl\+Delete 直通远端词删除/);
});

test("terminal shortcut help mentions shell line editing controls", () => {
  const app = readFileSync(appPath, "utf8");
  const shortcutStart = app.indexOf("Ctrl+C 中断远程命令");
  assert.notEqual(shortcutStart, -1, "shortcut help list should include the terminal control help row");
  const shortcutSource = app.slice(shortcutStart, app.indexOf("</ul>", shortcutStart));

  assert.match(shortcutSource, /Ctrl\+U/);
  assert.match(shortcutSource, /Ctrl\+K/);
  assert.match(shortcutSource, /\u5220\u9664\u5149\u6807\u524d\u5185\u5bb9/);
  assert.match(shortcutSource, /\u5220\u9664\u5149\u6807\u540e\u5185\u5bb9/);
});

test("terminal shortcut help mentions remote job suspend and quit controls", () => {
  const app = readFileSync(appPath, "utf8");

  assert.match(app, /Ctrl\+Z/);
  assert.match(app, /Ctrl\+\\\\/);
  assert.match(app, /挂起前台程序|寮哄埗閫€鍑洪儴鍒嗗墠鍙扮▼搴?/);
});

test("terminal shortcut help explains Ctrl S pause and Ctrl Q resume flow control", () => {
  const app = readFileSync(appPath, "utf8");
  const shortcutStart = app.indexOf('<h3>{"常用快捷键"}</h3>');
  const shortcutSource = app.slice(shortcutStart, app.indexOf("</ul>", shortcutStart));

  assert.match(shortcutSource, /Ctrl\+S[\s\S]*\u6682\u505c\u8fdc\u7a0b\u7ec8\u7aef\u8f93\u51fa/);
  assert.match(shortcutSource, /Ctrl\+Q[\s\S]*\u6062\u590d\u8fdc\u7a0b\u7ec8\u7aef\u8f93\u51fa/);
});

test("terminal keeps Ctrl+D as a normal SSH EOF control in connected sessions", () => {
  const app = readFileSync(appPath, "utf8");
  const workspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function PlanCard"));
  const mainHandlerStart = app.indexOf("function handleTerminalShortcutKeyDown");
  const mainHandlerEnd = app.indexOf("async function pasteClipboardToCommandInput", mainHandlerStart);
  const mainHandlerSource = app.slice(mainHandlerStart, mainHandlerEnd);
  const directControlSource = app.slice(app.indexOf("function isConnectedShellDirectControlKey"), app.indexOf("function isConnectedShellScreenControlKey"));

  assert.match(app, /\{ label: "Ctrl\+D", text: "\\x04", title: "发送 Ctrl\+D", finishInteractiveMode: true \}/);
  assert.match(directControlSource, /"d"/, "Ctrl+D should stay in the connected-shell direct control whitelist");
  assert.match(workspaceSource, /const connectedShellInput = buildConnectedShellInput\(event,\s*commandValue \|\| ""/);
  assert.match(workspaceSource, /onSendInteractiveInput\(event,\s*\{ \.\.\.connectedShellInput,\s*clearInput: false \}\)/);
  assert.match(mainHandlerSource, /const connectedShellDirectControlInput = isConnectedShellDirectControlKey\(event\) \? runningSessionControlInput : null/);
  assert.match(mainHandlerSource, /sendSelectedSessionInput\(event,\s*\{ \.\.\.connectedShellDirectControlInput,\s*clearInput: false \}\)/);
  assert.doesNotMatch(mainHandlerSource, /ctrlKey[\s\S]{0,120}key\.toLowerCase\(\) === "d"[\s\S]{0,120}disconnect/i);
});

test("terminal Ctrl+C cancels the remote line and clears the local command draft", () => {
  const app = readFileSync(appPath, "utf8");
  const workspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function PlanCard"));
  const commandHandlerSource = workspaceSource.slice(workspaceSource.indexOf("function handleCommandInputKeyDown"), workspaceSource.indexOf("function insertCommandInputNewline"));
  const ctrlCButtonSource = workspaceSource.slice(workspaceSource.indexOf("function handleTerminalCtrlCButtonClick"), workspaceSource.indexOf("function handleTerminalControlButtonClick"));
  const mainHandlerSource = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("if (event.key === \"Enter\"", app.indexOf("function handleCommandHistoryKeyDown")));
  const signalSource = app.slice(app.indexOf("async function sendTerminalControlSignal"), app.indexOf("const controlInputs =", app.indexOf("async function sendTerminalControlSignal")));

  assert.match(commandHandlerSource, /text:\s*"\\x03"[\s\S]{0,80}clearInput:\s*true/);
  assert.match(ctrlCButtonSource, /text:\s*"\\x03"[\s\S]{0,80}clearInput:\s*true/);
  assert.match(mainHandlerSource, /text:\s*"\\x03"[\s\S]{0,80}clearInput:\s*true/);
  assert.match(signalSource, /text:\s*"\\x03"[\s\S]{0,80}clearInput:\s*true/);
});

test("terminal exposes Ctrl+H as an explicit remote backspace control", () => {
  const app = readFileSync(appPath, "utf8");
  const controlButtonsSource = app.slice(app.indexOf("const TERMINAL_INTERACTIVE_CONTROL_BUTTONS"), app.indexOf("function isConnectedShellFlowControlKey"));

  assert.match(controlButtonsSource, /\{ label: "Ctrl\+H", text: "\\x08", title: "发送 Ctrl\+H，兼容远端 Backspace" \}/);
});

test("terminal recovery dispatcher routes reconnect test agent and diagnostic export actions", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("function runTerminalSessionRecoveryAction"), app.indexOf("async function openSelectedSession"));
  const dismissSource = app.slice(app.indexOf("function dismissTerminalSessionRecovery"), app.indexOf("async function runTerminalSessionRecoveryAction"));

  assert.match(dismissSource, /function dismissTerminalSessionRecovery/);
  assert.match(source, /case "reconnect"/);
  assert.match(source, /reconnectSelectedSession\(\)/);
  assert.doesNotMatch(source, /case "reconnect":\s*return openSelectedSession\(\)/);
  assert.match(source, /case "reconnect-clear"/);
  assert.match(source, /reconnectAndClearSelectedSession\(\)/);
  assert.match(source, /case "connection-test"/);
  assert.match(source, /testSelectedConnection\(\)/);
  assert.match(source, /case "auth-center"/);
  assert.match(source, /openAuthCenter\(selectedServer\)/);
  assert.match(source, /case "agent-diagnostic"/);
  assert.match(source, /queueSelectedSshDiagnostic\(\)/);
  assert.match(source, /case "export-diagnostic"/);
  assert.match(source, /exportDiagnosticPackage\(\)/);
  assert.match(source, /case "dismiss-recovery"/);
  assert.match(source, /dismissTerminalSessionRecovery\(\)/);
});

test("terminal recovery dismiss clears stale failure fields from the selected session", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("function dismissTerminalSessionRecovery"), app.indexOf("async function runTerminalSessionRecoveryAction"));

  assert.match(source, /function dismissTerminalSessionRecovery\(targetName = selectedServer,\s*targetSessionKey = selectedTerminalSessionKey\)/);
  assert.match(source, /const sessionKey = targetSessionKey \|\| resolveTerminalSessionKey\(name\)/);
  assert.match(source, /setSshSessions\(\(state\) =>/);
  assert.match(source, /lastError:\s*""/);
  assert.match(source, /failureKind:\s*""/);
  assert.match(source, /sshFailure:\s*null/);
  assert.match(source, /disconnectedAt:\s*""/);
  assert.match(source, /status:\s*current\.sessionId \? "connected" : "idle"/);
});

test("terminal reconnect keeps the current terminal tab session key", () => {
  const app = readFileSync(appPath, "utf8");
  const selectSource = app.slice(app.indexOf("function selectServerTab"), app.indexOf("function openSavedServerTab"));
  const reconnectSource = app.slice(app.indexOf("async function reconnectSelectedSession"), app.indexOf("async function reconnectAndClearSelectedSession"));
  const openSource = app.slice(app.indexOf("async function openSelectedSession"), app.indexOf("async function ensureCommandSession"));

  assert.match(selectSource, /function selectServerTab\(name,\s*options = \{\}\)/);
  assert.match(selectSource, /options\.sessionKey/);
  assert.match(selectSource, /visibleTerminalTabs\.find\(\(tab\) => tab\.id === options\.sessionKey\)/);
  assert.match(reconnectSource, /const sessionKey = options\.sessionKey \|\| resolveTerminalSessionKey\(targetName\)/);
  assert.match(reconnectSource, /closeSessionByName\(targetName,\s*"正在重新连接 SSH 会话\.\.\.",\s*\{ sessionKey \}\)/);
  assert.match(reconnectSource, /openSelectedSession\(targetName,\s*\{ force: true,\s*skipExistingClose: true,\s*sessionKey \}\)/);
  assert.match(openSource, /selectServerTab\(name,\s*\{ sessionKey \}\)/);
});

test("terminal reconnect and clear keeps the current terminal tab session key", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("async function reconnectAndClearSelectedSession"), app.indexOf("async function stopSelectedCommand"));
  const clearSource = app.slice(app.indexOf("function clearSelectedTerminalOutput"), app.indexOf("async function writeAuditEvent"));

  assert.match(clearSource, /function clearSelectedTerminalOutput\(targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(clearSource, /const terminalKey = options\.sessionKey \|\| resolveTerminalSessionKey\(name\)/);
  assert.match(source, /async function reconnectAndClearSelectedSession\(targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(source, /const sessionKey = options\.sessionKey \|\| resolveTerminalSessionKey\(name\)/);
  assert.match(source, /clearSelectedTerminalOutput\(name,\s*\{ sessionKey \}\)/);
  assert.match(source, /reconnectSelectedSession\(name,\s*\{ sessionKey \}\)/);
});

test("terminal polling failures preserve backend SSH diagnostics for recovery actions", () => {
  const app = readFileSync(appPath, "utf8");
  const outputPollingSource = app.slice(app.indexOf("async function pollActiveSshSessionOutput"), app.indexOf("const intervalId = window.setInterval(pollActiveSshSessionOutput"));
  const healthPollingSource = app.slice(app.indexOf("api?.check_ssh_session_health"), app.indexOf("}, 5000);"));

  assert.match(outputPollingSource, /failureKind:\s*result\?\.failureKind \|\| result\?\.sshFailure\?\.kind \|\| ""/);
  assert.match(outputPollingSource, /sshFailure:\s*result\?\.sshFailure \|\| null/);
  assert.match(healthPollingSource, /failureKind:\s*result\?\.failureKind \|\| result\?\.sshFailure\?\.kind \|\| ""/);
  assert.match(healthPollingSource, /sshFailure:\s*result\?\.sshFailure \|\| null/);
});

test("terminal health polling writes session log context for support diagnostics", () => {
  const app = readFileSync(appPath, "utf8");
  const healthPollingSource = app.slice(app.indexOf("api?.check_ssh_session_health"), app.indexOf("}, 5000);"));

  assert.match(healthPollingSource, /const healthLogContext = \{ \.\.\.buildSshSessionLogContext\(name,\s*servers\[name\] \|\| \{\}\),\s*sessionKey \}/);
  assert.match(healthPollingSource, /writeSessionLogEvent\(\{ type: "session_health_failed", server: name, sessionId: session\.sessionId, actor: "system", message, status: "failed", context: healthLogContext \}\)/);
});

test("terminal health polling records successful checks for visible session status", () => {
  const app = readFileSync(appPath, "utf8");
  const healthPollingSource = app.slice(app.indexOf("api?.check_ssh_session_health"), app.indexOf("}, 5000);"));

  assert.match(healthPollingSource, /healthCheckedAt:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(healthPollingSource, /healthMessage:\s*result\?\.message \|\| "SSH 会话正常。"/);
  assert.match(healthPollingSource, /keepaliveSeconds:\s*result\?\.keepaliveSeconds \?\? servers\[name\]\?\.keepaliveSeconds \?\? 30/);
});

test("terminal output polling writes session log context for support diagnostics", () => {
  const app = readFileSync(appPath, "utf8");
  const outputPollingSource = app.slice(app.indexOf("async function pollActiveSshSessionOutput"), app.indexOf("const intervalId = window.setInterval(pollActiveSshSessionOutput"));

  assert.match(outputPollingSource, /const outputLogContext = \{ \.\.\.buildSshSessionLogContext\(name,\s*servers\[name\] \|\| \{\}\),\s*sessionKey \}/);
  assert.match(outputPollingSource, /writeSessionLogEvent\(\{ type: "output", server: name, sessionId: session\.sessionId, actor: "server", output: result\.output, status: "ok", context: outputLogContext \}\)/);
  assert.match(outputPollingSource, /writeSessionLogEvent\(\{ type: "output_failed", server: name, sessionId: session\.sessionId, actor: "system", message, status: "failed", context: outputLogContext \}\)/);
});

test("copied SSH error details include backend failure diagnosis and suggestions", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("async function copySelectedSessionErrorDetail"), app.indexOf("async function copySelectedSessionDiagnosticSummary"));

  assert.match(source, /const sshFailure = session\.sshFailure \|\| \{\}/);
  assert.match(source, /const failureKind = String\(session\.failureKind \|\| sshFailure\.kind \|\| ""\)\.trim\(\)/);
  assert.match(source, /Array\.isArray\(sshFailure\.suggestions\)/);
  assert.match(source, /sshFailure\.suggestions\.map\(\(item\) => String\(item \|\| ""\)\.trim\(\)\)\.filter\(Boolean\)/);
  assert.match(source, /`失败类型：\$\{failureKind \|\| "--"\}`/);
  assert.match(source, /`诊断标签：\$\{sshFailure\.label \|\| sshFailure\.title \|\| "--"\}`/);
  assert.match(source, /sshFailure\.summary \? `诊断摘要：\$\{sshFailure\.summary\}` : ""/);
  assert.match(source, /failureSuggestions\.length \? `处理建议：\\n\$\{failureSuggestions\.map\(\(item,\s*index\) => `\$\{index \+ 1\}\. \$\{item\}`\)\.join\("\\n"\)\}` : ""/);
  assert.match(source, /\.filter\(Boolean\)\.join\("\\n"\)/);
});

test("copied SSH diagnostic summary includes backend failure diagnosis and suggestions", () => {
  const app = readFileSync(appPath, "utf8");
  const source = app.slice(app.indexOf("async function copySelectedSessionDiagnosticSummary"), app.indexOf("function dismissTerminalSessionRecovery"));

  assert.match(source, /const sshFailure = session\.sshFailure \|\| \{\}/);
  assert.match(source, /const failureKind = String\(session\.failureKind \|\| sshFailure\.kind \|\| ""\)\.trim\(\)/);
  assert.match(source, /Array\.isArray\(sshFailure\.suggestions\)/);
  assert.match(source, /sshFailure\.suggestions\.map\(\(item\) => String\(item \|\| ""\)\.trim\(\)\)\.filter\(Boolean\)/);
  assert.match(source, /`失败类型：\$\{failureKind \|\| "--"\}`/);
  assert.match(source, /`诊断标签：\$\{sshFailure\.label \|\| sshFailure\.title \|\| "--"\}`/);
  assert.match(source, /sshFailure\.summary \? `诊断摘要：\$\{sshFailure\.summary\}` : ""/);
  assert.match(source, /failureSuggestions\.length \? `处理建议：\\n\$\{failureSuggestions\.map\(\(item,\s*index\) => `\$\{index \+ 1\}\. \$\{item\}`\)\.join\("\\n"\)\}` : ""/);
});

test("terminal workspace exposes a compact SSH diagnostic badge in the toolbar", () => {
  const app = readFileSync(appPath, "utf8");
  const workspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function PlanCard"));

  assert.match(app, /getTerminalSessionDiagnosticBadge/);
  assert.match(workspaceSource, /const sessionDiagnosticBadge = getTerminalSessionDiagnosticBadge\(sessionState\)/);
  assert.match(workspaceSource, /sessionDiagnosticBadge\?\.visible/);
  assert.match(workspaceSource, /className=\{`terminal-diagnostic-badge \$\{sessionDiagnosticBadge\.tone \|\| "gray"\}`\}/);
  assert.match(workspaceSource, /title=\{sessionDiagnosticBadge\.title\}/);
  assert.match(workspaceSource, /aria-label="查看 SSH 会话诊断日志"/);
  assert.match(workspaceSource, /onClick=\{\(\) => onRunSessionRecoveryAction\?\.\(\{ id: "diagnostic-session-logs", target: "session-logs", label: "查看会话日志" \}\)\}/);
  assert.match(workspaceSource, /\{sessionDiagnosticBadge\.label\}/);
});

test("terminal workspace shows keepalive and last health check status in the toolbar", () => {
  const app = readFileSync(appPath, "utf8");
  const workspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function PlanCard"));

  assert.match(workspaceSource, /const terminalHealthText = buildTerminalHealthText\(sessionState,\s*server\)/);
  assert.match(app, /function buildTerminalHealthText\(sessionState = \{\},\s*server = \{\}\)/);
  assert.match(app, /SSH 保活关闭/);
  assert.match(app, /保活 \$\{keepaliveSeconds\}s/);
  assert.match(app, /最近检查/);
  assert.match(workspaceSource, /className="terminal-health-pill"/);
  assert.match(workspaceSource, /\{terminalHealthText\}/);
});

test("terminal workspace exposes a manual SSH health check action", () => {
  const app = readFileSync(appPath, "utf8");
  const workspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function PlanCard"));
  const renderSource = app.slice(app.indexOf("<TerminalWorkspace"), app.indexOf("<div", app.indexOf("<TerminalWorkspace")));
  const handlerIndex = app.indexOf("async function checkSelectedSessionHealth");
  const handlerSource = handlerIndex >= 0 ? app.slice(handlerIndex, app.indexOf("async function resizeSelectedSession", handlerIndex)) : "";

  assert.match(workspaceSource, /onCheckSessionHealth/);
  assert.match(workspaceSource, /className="terminal-health-group"/);
  assert.match(workspaceSource, /className="terminal-health-check-button"/);
  assert.match(workspaceSource, /aria-label="立即检查 SSH 会话状态"/);
  assert.match(workspaceSource, /onClick=\{onCheckSessionHealth\}/);
  assert.match(workspaceSource, /disabled=\{!isConnected \|\| Boolean\(sessionState\?\.healthChecking\)\}/);
  assert.match(renderSource, /onCheckSessionHealth=\{checkSelectedSessionHealth\}/);
  assert.ok(handlerIndex > -1);
  assert.match(handlerSource, /api\?\.check_ssh_session_health/);
  assert.match(handlerSource, /healthChecking:\s*true/);
  assert.match(handlerSource, /healthCheckedAt:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(handlerSource, /writeSessionLogEvent\(\{\s*type:\s*"session_health_manual"/);
});

test("terminal recovery card renders backend suggestions as a compact list", () => {
  const app = readFileSync(appPath, "utf8");
  const workspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function PlanCard"));

  assert.match(workspaceSource, /sessionRecovery\.suggestions\?\.length/);
  assert.match(workspaceSource, /className="terminal-recovery-suggestions"/);
  assert.match(workspaceSource, /sessionRecovery\.suggestions\.map\(\(suggestion,\s*index\) =>/);
  assert.match(workspaceSource, /<li key=\{`\$\{index\}-\$\{suggestion\}`\}>\{suggestion\}<\/li>/);
});

test("terminal recovery card separates primary actions from secondary support actions", () => {
  const app = readFileSync(appPath, "utf8");
  const workspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function PlanCard"));

  assert.match(workspaceSource, /const primaryRecoveryActions = sessionRecoveryActions\.filter\(\(action\) => action\.tone === "primary"\)/);
  assert.match(workspaceSource, /const secondaryRecoveryActions = sessionRecoveryActions\.filter\(\(action\) => action\.tone !== "primary"\)/);
  assert.match(workspaceSource, /className="terminal-recovery-primary-actions"/);
  assert.match(workspaceSource, /primaryRecoveryActions\.map\(\(action\) =>/);
  assert.match(workspaceSource, /className="terminal-recovery-secondary"/);
  assert.match(workspaceSource, /<span>更多处理<\/span>/);
  assert.match(workspaceSource, /secondaryRecoveryActions\.map\(\(action\) =>/);
});

test("terminal recovery card renders error detail in a compact readable block", () => {
  const app = readFileSync(appPath, "utf8");
  const styles = readFileSync(stylesPath, "utf8");
  const workspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function PlanCard"));

  assert.match(workspaceSource, /className="terminal-recovery-detail"/);
  assert.match(workspaceSource, /\{sessionRecovery\.detail \|\| "可以使用下方操作恢复当前 SSH 会话。"\}/);
  assert.match(styles, /\.terminal-recovery-detail\s*\{[\s\S]*max-height:\s*84px/);
  assert.match(styles, /\.terminal-recovery-detail\s*\{[\s\S]*overflow:\s*auto/);
  assert.match(styles, /\.terminal-recovery-secondary\s*\{[\s\S]*display:\s*grid/);
});

test("terminal shortcut help mentions modified navigation keys forwarded to SSH", () => {
  const app = readFileSync(appPath, "utf8");

  assert.match(app, /Alt\+Left \/ Alt\+Right/);
  assert.match(app, /Ctrl\+Left \/ Ctrl\+Right/);
});
