import assert from "node:assert/strict";
import test from "node:test";

import * as terminalHistory from "./terminalHistory.js";
import {
  addCommandToHistory,
  addCustomCommandSnippet,
  adjustTerminalFontSize,
  buildRunningSessionKeyInput,
  buildRunningSessionControlInput,
  buildConnectedShellInput,
  buildRunningSessionMetaInput,
  buildRunningSessionTextInput,
  completeCommandDraft,
  clearCommandHistoryForServer,
  createHistoryCursor,
  formatTerminalInputForLog,
  getCommandHistoryKeyAction,
  getTerminalSearchKeyAction,
  getTerminalShortcutAction,
  isInteractiveExitInput,
  isTerminalInteractiveMode,
  isLongRunningCommand,
  mergeTerminalCommandSnippets,
  moveHistoryCursor,
  prepareClipboardCommandPaste,
  prepareInteractiveClipboardPaste,
  removeCommandFromHistoryForServer,
  removeCustomCommandSnippet,
  searchCommandHistory,
  shouldSubmitAsSensitiveTerminalInput,
  normalizeCommandHistories,
  validateCustomCommandSnippet,
  TERMINAL_COMMAND_SNIPPETS,
} from "./terminalHistory.js";

test("addCommandToHistory trims commands, removes duplicates, and caps newest first", () => {
  const history = addCommandToHistory(["df -h", "uptime", "journalctl -xe"], " uptime ", 3);

  assert.deepEqual(history, ["uptime", "df -h", "journalctl -xe"]);
});

test("addCommandToHistory skips commands with sensitive material", () => {
  const history = ["df -h", "uptime"];

  assert.deepEqual(addCommandToHistory(history, "mysql --password=DoNotSave"), history);
  assert.deepEqual(addCommandToHistory(history, 'curl -H "Authorization: Bearer token" https://example.com'), history);
});

test("addCommandToHistory skips multiline commands to avoid unsafe reruns", () => {
  const history = ["df -h", "uptime"];

  assert.deepEqual(addCommandToHistory(history, "cd /var/www\nnpm run deploy"), history);
  assert.deepEqual(addCommandToHistory(history, "cd /var/www\r\nnpm run deploy"), history);
});

test("clearCommandHistoryForServer removes only the selected server history", () => {
  const histories = {
    "prod-web-01": ["uptime", "df -hT"],
    "prod-db-01": ["show processlist"],
  };

  assert.deepEqual(clearCommandHistoryForServer(histories, "prod-web-01"), {
    "prod-db-01": ["show processlist"],
  });
  assert.deepEqual(clearCommandHistoryForServer(histories, ""), histories);
});

test("removeCommandFromHistoryForServer removes one selected SSH history command", () => {
  const histories = {
    "prod-web-01": ["uptime", "df -hT", "docker ps", "df -hT"],
    "prod-db-01": ["show processlist"],
  };

  assert.deepEqual(removeCommandFromHistoryForServer(histories, "prod-web-01", " df -hT "), {
    "prod-web-01": ["uptime", "docker ps"],
    "prod-db-01": ["show processlist"],
  });
  assert.deepEqual(removeCommandFromHistoryForServer(histories, "prod-web-01", "missing"), histories);
  assert.deepEqual(removeCommandFromHistoryForServer(histories, "", "uptime"), histories);
});

test("normalizeCommandHistories cleans persisted command history before reuse", () => {
  const raw = {
    " prod-web-01 ": [
      " df -hT ",
      "mysql --password=DoNotSave",
      "df -hT",
      "cd /var/www\nnpm run deploy",
      "uptime",
      "",
      "export TOKEN=prod-token",
    ],
    "prod-db-01": "not an array",
    "": ["whoami"],
  };

  assert.deepEqual(normalizeCommandHistories(raw, 2), {
    "prod-web-01": ["df -hT", "uptime"],
  });
});

test("moveHistoryCursor walks older and newer commands while preserving draft", () => {
  const history = ["systemctl --failed", "free -h", "df -h"];
  let cursor = createHistoryCursor("ngi");

  cursor = moveHistoryCursor(cursor, history, "older");
  assert.equal(cursor.value, "systemctl --failed");
  cursor = moveHistoryCursor(cursor, history, "older");
  assert.equal(cursor.value, "free -h");
  cursor = moveHistoryCursor(cursor, history, "newer");
  assert.equal(cursor.value, "systemctl --failed");
  cursor = moveHistoryCursor(cursor, history, "newer");
  assert.equal(cursor.value, "ngi");
});

test("getCommandHistoryKeyAction maps arrow and readline history shortcuts", () => {
  assert.equal(getCommandHistoryKeyAction({ key: "ArrowUp" }), "older");
  assert.equal(getCommandHistoryKeyAction({ key: "ArrowDown" }), "newer");
  assert.equal(getCommandHistoryKeyAction({ key: "p", ctrlKey: true }), "older");
  assert.equal(getCommandHistoryKeyAction({ key: "P", ctrlKey: true }), "older");
  assert.equal(getCommandHistoryKeyAction({ key: "n", ctrlKey: true }), "newer");
  assert.equal(getCommandHistoryKeyAction({ key: "Escape" }), "restore");
  assert.equal(getCommandHistoryKeyAction({ key: "p", ctrlKey: true, shiftKey: true }), "");
  assert.equal(getCommandHistoryKeyAction({ key: "n", ctrlKey: true, altKey: true }), "");
  assert.equal(getCommandHistoryKeyAction({ key: "p", ctrlKey: true, metaKey: true }), "");
});

test("searchCommandHistory finds the newest matching command for a draft", () => {
  const history = ["journalctl -u nginx -n 100", "docker ps", "nginx -t", "df -hT"];

  assert.deepEqual(searchCommandHistory(history, "ngi"), {
    found: true,
    value: "journalctl -u nginx -n 100",
    query: "ngi",
  });
  assert.deepEqual(searchCommandHistory(history, "NGINX -T"), {
    found: true,
    value: "nginx -t",
    query: "NGINX -T",
  });
  assert.deepEqual(searchCommandHistory(history, ""), {
    found: true,
    value: "journalctl -u nginx -n 100",
    query: "",
  });
  assert.deepEqual(searchCommandHistory(history, "mysql"), {
    found: false,
    value: "mysql",
    query: "mysql",
  });
  assert.deepEqual(searchCommandHistory([], "df"), {
    found: false,
    value: "df",
    query: "df",
  });
});

test("filterCommandHistory searches reusable SSH commands and caps visible results", () => {
  const history = [
    "journalctl -u nginx -n 100",
    "docker ps",
    "nginx -t",
    "df -hT",
    "docker logs api --tail 200",
    "free -h",
  ];

  assert.equal(typeof terminalHistory.filterCommandHistory, "function");
  assert.deepEqual(terminalHistory.filterCommandHistory(history, "docker", 4), [
    "docker ps",
    "docker logs api --tail 200",
  ]);
  assert.deepEqual(terminalHistory.filterCommandHistory(history, "NGINX", 4), [
    "journalctl -u nginx -n 100",
    "nginx -t",
  ]);
  assert.deepEqual(terminalHistory.filterCommandHistory(history, "", 3), history.slice(0, 3));
  assert.deepEqual(terminalHistory.filterCommandHistory(history, "mysql", 4), []);
});

test("command history reuse hides sensitive legacy entries", () => {
  const history = [
    "mysql --password=DoNotReuse",
    "df -hT",
    'curl -H "Authorization: Bearer prod-token" https://example.com',
    "docker ps",
  ];

  assert.deepEqual(terminalHistory.filterCommandHistory(history, "", 10), ["df -hT", "docker ps"]);
  assert.deepEqual(searchCommandHistory(history, "password"), {
    found: false,
    value: "password",
    query: "password",
  });
  assert.deepEqual(moveHistoryCursor(createHistoryCursor(""), history, "older"), {
    index: 0,
    draft: "",
    value: "df -hT",
  });
  assert.deepEqual(completeCommandDraft("curl", history, []), {
    completed: false,
    value: "curl",
    source: "",
  });
});

test("completeCommandDraft fills the first matching snippet or history command", () => {
  const history = ["journalctl -u nginx -n 100", "docker ps", "systemctl status nginx"];
  const snippets = [
    { label: "失败服务", command: "systemctl --failed" },
    { label: "磁盘", command: "df -hT" },
  ];

  assert.deepEqual(completeCommandDraft("df", history, snippets), {
    completed: true,
    value: "df -hT",
    source: "snippet",
  });
  assert.deepEqual(completeCommandDraft("dock", history, snippets), {
    completed: true,
    value: "docker ps",
    source: "history",
  });
  assert.deepEqual(completeCommandDraft("unknown", history, snippets), {
    completed: false,
    value: "unknown",
    source: "",
  });
});

test("completeCommandDraft reports multiple candidates without replacing the draft", () => {
  const history = ["docker ps", "docker logs api --tail 100", "du -sh /var/log"];
  const snippets = [
    { label: "磁盘", command: "df -hT" },
    { label: "端口", command: "ss -lntp" },
  ];

  assert.deepEqual(completeCommandDraft("d", history, snippets), {
    completed: false,
    value: "d",
    source: "multiple",
    candidates: ["df -hT", "docker ps", "docker logs api --tail 100", "du -sh /var/log"],
  });
});

test("terminal command snippets expose practical readonly diagnostics", () => {
  assert.ok(TERMINAL_COMMAND_SNIPPETS.length >= 5);
  assert.ok(TERMINAL_COMMAND_SNIPPETS.every((item) => item.label && item.command));
  assert.ok(TERMINAL_COMMAND_SNIPPETS.some((item) => item.command === "df -hT"));
});

test("terminal command snippets and paste warnings stay readable Chinese", () => {
  assert.deepEqual(
    TERMINAL_COMMAND_SNIPPETS.map((item) => item.label),
    ["负载", "磁盘", "内存", "失败服务", "端口", "最近日志"],
  );

  assert.match(validateCustomCommandSnippet("mysql --password=DoNotSave").message, /敏感信息/);
  assert.match(prepareClipboardCommandPaste("cd /var/www\nnpm run deploy").message, /多行命令/);
  assert.match(prepareInteractiveClipboardPaste("cd /var/www\nnpm run deploy").message, /SSH 交互程序/);
});

test("isLongRunningCommand keeps streaming SSH commands interruptible", () => {
  assert.equal(isLongRunningCommand("tail -f /var/log/nginx/error.log"), true);
  assert.equal(isLongRunningCommand("journalctl -u nginx -f"), true);
  assert.equal(isLongRunningCommand("watch -n 1 df -h"), true);
  assert.equal(isLongRunningCommand("top"), true);
  assert.equal(isLongRunningCommand("ping 10.0.0.1"), true);
  assert.equal(isLongRunningCommand("ping -c 4 10.0.0.1"), false);
  assert.equal(isLongRunningCommand("df -hT"), false);
});

test("isLongRunningCommand keeps common interactive SSH tools in input mode", () => {
  assert.equal(isLongRunningCommand("ssh root@10.0.1.24"), true);
  assert.equal(isLongRunningCommand("sudo mysql -uroot -p"), true);
  assert.equal(isLongRunningCommand("psql -h 127.0.0.1 -U app"), true);
  assert.equal(isLongRunningCommand("redis-cli -h 127.0.0.1"), true);
  assert.equal(isLongRunningCommand("python3"), true);
  assert.equal(isLongRunningCommand("node"), true);
  assert.equal(isLongRunningCommand("docker exec -it app bash"), true);
  assert.equal(isLongRunningCommand("kubectl exec -it pod/app -- sh"), true);
});

test("isInteractiveExitInput detects common submitted REPL exit commands", () => {
  assert.equal(isInteractiveExitInput("exit", true), true);
  assert.equal(isInteractiveExitInput("exit()", true), true);
  assert.equal(isInteractiveExitInput("quit", true), true);
  assert.equal(isInteractiveExitInput("quit;", true), true);
  assert.equal(isInteractiveExitInput("\\q", true), true);
  assert.equal(isInteractiveExitInput(":q", true), true);
  assert.equal(isInteractiveExitInput("exit", false), false);
  assert.equal(isInteractiveExitInput("exit 1", true), false);
  assert.equal(isInteractiveExitInput("echo exit", true), false);
});

test("shouldSubmitAsSensitiveTerminalInput detects password prompts in recent SSH output", () => {
  assert.equal(shouldSubmitAsSensitiveTerminalInput(["[prod]$ sudo systemctl restart nginx", "[sudo] password for root:"]), true);
  assert.equal(shouldSubmitAsSensitiveTerminalInput(["Enter passphrase for key '/home/root/.ssh/id_rsa':"]), true);
  assert.equal(shouldSubmitAsSensitiveTerminalInput(["请输入密码："]), true);
  assert.equal(shouldSubmitAsSensitiveTerminalInput(["[prod]$ uptime", "load average: 0.42", "[prod]$ "]), false);
  assert.equal(shouldSubmitAsSensitiveTerminalInput(["password policy updated successfully", "[prod]$ "]), false);
});

test("isTerminalInteractiveMode requires an explicit interactive marker", () => {
  assert.equal(isTerminalInteractiveMode({ sessionId: "session-1", busy: true }), false);
  assert.equal(isTerminalInteractiveMode({ sessionId: "session-1", interactiveMode: true }), true);
  assert.equal(isTerminalInteractiveMode({ sessionId: "", interactiveMode: true }), false);
  assert.equal(isTerminalInteractiveMode({ interactiveMode: true }), false);
});

test("buildRunningSessionKeyInput maps terminal navigation keys to SSH escape input", () => {
  assert.deepEqual(buildRunningSessionKeyInput("ArrowUp", ""), { text: "\x1b[A", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("ArrowDown", ""), { text: "\x1b[B", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("ArrowRight", ""), { text: "\x1b[C", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("ArrowLeft", ""), { text: "\x1b[D", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("Home", ""), { text: "\x1b[H", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("End", ""), { text: "\x1b[F", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("Delete", ""), { text: "\x1b[3~", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("PageUp", ""), { text: "\x1b[5~", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("PageDown", ""), { text: "\x1b[6~", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("Enter", ""), { text: "", submit: true });
  assert.deepEqual(buildRunningSessionKeyInput("Backspace", ""), { text: "\x7f", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("Tab", ""), { text: "\t", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("Tab", "", { shiftKey: true }), { text: "\x1b[Z", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("Escape", ""), { text: "\x1b", submit: false });
  assert.equal(buildRunningSessionKeyInput("ArrowUp", "draft"), null);
  assert.equal(buildRunningSessionKeyInput("a", ""), null);
});

test("buildRunningSessionKeyInput maps Ctrl modified navigation keys for SSH programs", () => {
  assert.deepEqual(buildRunningSessionKeyInput("ArrowUp", "", { ctrlKey: true }), { text: "\x1b[1;5A", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("ArrowDown", "", { ctrlKey: true }), { text: "\x1b[1;5B", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("ArrowRight", "", { ctrlKey: true }), { text: "\x1b[1;5C", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("ArrowLeft", "", { ctrlKey: true }), { text: "\x1b[1;5D", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("Home", "", { ctrlKey: true }), { text: "\x1b[1;5H", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("End", "", { ctrlKey: true }), { text: "\x1b[1;5F", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("Delete", "", { ctrlKey: true }), { text: "\x1b[3;5~", submit: false });
  assert.equal(buildRunningSessionKeyInput("ArrowLeft", "draft", { ctrlKey: true }), null);
});

test("buildRunningSessionKeyInput maps Shift and Ctrl+Shift navigation for terminal programs", () => {
  assert.deepEqual(buildRunningSessionKeyInput("ArrowLeft", "", { shiftKey: true }), { text: "\x1b[1;2D", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("ArrowRight", "", { shiftKey: true }), { text: "\x1b[1;2C", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("Home", "", { shiftKey: true }), { text: "\x1b[1;2H", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("End", "", { shiftKey: true }), { text: "\x1b[1;2F", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("PageUp", "", { shiftKey: true }), { text: "\x1b[5;2~", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("Delete", "", { shiftKey: true }), { text: "\x1b[3;2~", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("ArrowLeft", "", { ctrlKey: true, shiftKey: true }), { text: "\x1b[1;6D", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("End", "", { ctrlKey: true, shiftKey: true }), { text: "\x1b[1;6F", submit: false });
});

test("buildRunningSessionKeyInput maps terminal function keys to SSH escape input", () => {
  assert.deepEqual(buildRunningSessionKeyInput("Insert", ""), { text: "\x1b[2~", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F1", ""), { text: "\x1bOP", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F2", ""), { text: "\x1bOQ", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F3", ""), { text: "\x1bOR", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F4", ""), { text: "\x1bOS", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F5", ""), { text: "\x1b[15~", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F6", ""), { text: "\x1b[17~", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F7", ""), { text: "\x1b[18~", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F8", ""), { text: "\x1b[19~", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F9", ""), { text: "\x1b[20~", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F10", ""), { text: "\x1b[21~", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F11", ""), { text: "\x1b[23~", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F12", ""), { text: "\x1b[24~", submit: false });
  assert.equal(buildRunningSessionKeyInput("F1", "draft"), null);
});

test("buildRunningSessionKeyInput maps modified function keys for SSH TUI programs", () => {
  assert.deepEqual(buildRunningSessionKeyInput("F1", "", { shiftKey: true }), { text: "\x1b[1;2P", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F2", "", { shiftKey: true }), { text: "\x1b[1;2Q", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F4", "", { ctrlKey: true }), { text: "\x1b[1;5S", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F5", "", { ctrlKey: true }), { text: "\x1b[15;5~", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F10", "", { shiftKey: true }), { text: "\x1b[21;2~", submit: false });
  assert.deepEqual(buildRunningSessionKeyInput("F12", "", { ctrlKey: true, shiftKey: true }), { text: "\x1b[24;6~", submit: false });
  assert.deepEqual(buildRunningSessionMetaInput({ key: "F1", altKey: true }, ""), { text: "\x1b[1;3P", submit: false });
  assert.deepEqual(buildRunningSessionMetaInput({ key: "F8", altKey: true }, ""), { text: "\x1b[19;3~", submit: false });
  assert.deepEqual(buildConnectedShellInput({ key: "F2", shiftKey: true }), { text: "\x1b[1;2Q", submit: false });
  assert.equal(buildRunningSessionKeyInput("F5", "draft", { ctrlKey: true }), null);
});

test("buildRunningSessionTextInput forwards printable keys while a SSH program is running", () => {
  assert.deepEqual(buildRunningSessionTextInput({ key: "q" }, ""), { text: "q", submit: false });
  assert.deepEqual(buildRunningSessionTextInput({ key: "?" }, ""), { text: "?", submit: false });
  assert.deepEqual(buildRunningSessionTextInput({ key: "A", shiftKey: true }, ""), { text: "A", submit: false });
  assert.equal(buildRunningSessionTextInput({ key: "q" }, "draft"), null);
  assert.equal(buildRunningSessionTextInput({ key: "Enter" }, ""), null);
  assert.equal(buildRunningSessionTextInput({ key: "q", ctrlKey: true }, ""), null);
  assert.equal(buildRunningSessionTextInput({ key: "q", altKey: true }, ""), null);
  assert.equal(buildRunningSessionTextInput({ key: "q", metaKey: true }, ""), null);
  assert.equal(buildRunningSessionTextInput({ key: "Process", isComposing: true }, ""), null);
});

test("buildConnectedShellInput maps normal connected shell keys directly to SSH input", () => {
  assert.deepEqual(buildConnectedShellInput({ key: "c", ctrlKey: true }), { text: "\x03", submit: false });
  assert.deepEqual(buildConnectedShellInput({ key: "Pause", ctrlKey: true }), { text: "\x03", submit: false });
  assert.deepEqual(buildConnectedShellInput({ key: "Cancel", ctrlKey: true }), { text: "\x03", submit: false });
  assert.deepEqual(buildConnectedShellInput({ key: "Break", ctrlKey: true }), { text: "\x03", submit: false });
  assert.deepEqual(buildConnectedShellInput({ key: "Enter" }), { text: "", submit: true });
  assert.deepEqual(buildConnectedShellInput({ key: "l", ctrlKey: true }), { text: "\x0c", submit: false });
  assert.deepEqual(buildConnectedShellInput({ key: "ArrowUp" }), { text: "\x1b[A", submit: false });
  assert.deepEqual(buildConnectedShellInput({ key: "x" }), { text: "x", submit: false });
  assert.equal(buildConnectedShellInput({ key: "PageUp" }, "", { allowScrollKeys: false }), null);
  assert.equal(buildConnectedShellInput({ key: "Enter" }, "draft command"), null);
  assert.equal(buildConnectedShellInput({ key: "Enter" }, "", { connected: false }), null);
  assert.equal(buildConnectedShellInput({ key: "Enter" }, "", { interactive: true }), null);
});

test("buildConnectedShellInput can forward review keys from the focused SSH command input", () => {
  const options = { connected: true, allowScrollKeys: false, forwardReviewKeys: true };

  assert.deepEqual(buildConnectedShellInput({ key: "Home" }, "", options), { text: "\x1b[H", submit: false });
  assert.deepEqual(buildConnectedShellInput({ key: "End" }, "", options), { text: "\x1b[F", submit: false });
  assert.deepEqual(buildConnectedShellInput({ key: "PageUp" }, "", options), { text: "\x1b[5~", submit: false });
  assert.deepEqual(buildConnectedShellInput({ key: "PageDown" }, "", options), { text: "\x1b[6~", submit: false });
});

test("buildRunningSessionControlInput maps running SSH control keys", () => {
  assert.deepEqual(buildRunningSessionControlInput({ key: "c", ctrlKey: true }, ""), { action: "interrupt" });
  assert.deepEqual(buildRunningSessionControlInput({ key: "Pause", ctrlKey: true }, ""), { action: "interrupt" });
  assert.deepEqual(buildRunningSessionControlInput({ key: "Cancel", ctrlKey: true }, ""), { action: "interrupt" });
  assert.deepEqual(buildRunningSessionControlInput({ key: " ", ctrlKey: true }, ""), { text: "\x00", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "@", ctrlKey: true }, ""), { text: "\x00", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "2", ctrlKey: true }, ""), { text: "\x00", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "3", ctrlKey: true }, ""), { text: "\x1b", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "4", ctrlKey: true }, ""), { text: "\x1c", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "5", ctrlKey: true }, ""), { text: "\x1d", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "6", ctrlKey: true }, ""), { text: "\x1e", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "7", ctrlKey: true }, ""), { text: "\x1f", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "8", ctrlKey: true }, ""), { text: "\x7f", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "a", ctrlKey: true }, ""), { text: "\x01", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "d", ctrlKey: true }, ""), { text: "\x04", submit: false, finishInteractiveMode: true });
  assert.deepEqual(buildRunningSessionControlInput({ key: "e", ctrlKey: true }, ""), { text: "\x05", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "k", ctrlKey: true }, ""), { text: "\x0b", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "l", ctrlKey: true }, ""), { text: "\x0c", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "r", ctrlKey: true }, ""), { text: "\x12", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "u", ctrlKey: true }, ""), { text: "\x15", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "Backspace", ctrlKey: true }, ""), { text: "\x17", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "Delete", ctrlKey: true }, ""), { text: "\x17", submit: false });
  assert.deepEqual(buildRunningSessionControlInput({ key: "z", ctrlKey: true }, ""), { text: "\x1a", submit: false, finishInteractiveMode: true });
  assert.deepEqual(buildRunningSessionControlInput({ key: "\\", ctrlKey: true }, ""), { text: "\x1c", submit: false, finishInteractiveMode: true });
  assert.deepEqual(buildRunningSessionControlInput({ key: "c", ctrlKey: true }, "tail -f /var/log/nginx/error.log"), { action: "interrupt" });
  assert.equal(buildRunningSessionControlInput({ key: "d", ctrlKey: true }, "draft"), null);
  assert.equal(buildRunningSessionControlInput({ key: "c", ctrlKey: true, shiftKey: true }, ""), null);
  assert.equal(buildRunningSessionControlInput({ key: "c", ctrlKey: true, altKey: true }, ""), null);
});

test("applyTerminalCommandEditKey maps readline style command input editing", () => {
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "a", ctrlKey: true }, "journalctl -u nginx", 9, 9),
    { handled: true, value: "journalctl -u nginx", selectionStart: 0, selectionEnd: 0 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "e", ctrlKey: true }, "journalctl -u nginx", 3, 3),
    { handled: true, value: "journalctl -u nginx", selectionStart: 19, selectionEnd: 19 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "k", ctrlKey: true }, "journalctl -u nginx", 10, 10),
    { handled: true, value: "journalctl", selectionStart: 10, selectionEnd: 10 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "w", ctrlKey: true }, "sudo systemctl restart nginx", 22, 22),
    { handled: true, value: "sudo systemctl nginx", selectionStart: 15, selectionEnd: 15 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "w", ctrlKey: true }, "sudo systemctl restart nginx", 5, 14),
    { handled: true, value: "sudo  restart nginx", selectionStart: 5, selectionEnd: 5 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "w", ctrlKey: true, shiftKey: true }, "uptime", 6, 6),
    { handled: false, value: "uptime", selectionStart: 6, selectionEnd: 6 },
  );
});

test("applyTerminalCommandEditKey maps Ctrl+A and Ctrl+E to the current multiline command row", () => {
  const draft = "cd /var/www\nnpm run build\nsystemctl restart nginx";

  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "a", ctrlKey: true }, draft, 18, 18),
    { handled: true, value: draft, selectionStart: 12, selectionEnd: 12 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "e", ctrlKey: true }, draft, 18, 18),
    { handled: true, value: draft, selectionStart: 25, selectionEnd: 25 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "Home", ctrlKey: true }, draft, 18, 18),
    { handled: true, value: draft, selectionStart: 0, selectionEnd: 0 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "End", ctrlKey: true }, draft, 18, 18),
    { handled: true, value: draft, selectionStart: draft.length, selectionEnd: draft.length },
  );
});

test("applyTerminalCommandEditKey supports more shell style cursor editing", () => {
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "b", ctrlKey: true }, "journalctl -u nginx", 10, 10),
    { handled: true, value: "journalctl -u nginx", selectionStart: 9, selectionEnd: 9 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "f", ctrlKey: true }, "journalctl -u nginx", 9, 9),
    { handled: true, value: "journalctl -u nginx", selectionStart: 10, selectionEnd: 10 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "h", ctrlKey: true }, "journalctl -u nginx", 10, 10),
    { handled: true, value: "journalct -u nginx", selectionStart: 9, selectionEnd: 9 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "u", ctrlKey: true }, "journalctl -u nginx", 14, 14),
    { handled: true, value: "nginx", selectionStart: 0, selectionEnd: 0 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "d", ctrlKey: true }, "journalctl -u nginx", 10, 10),
    { handled: true, value: "journalctl-u nginx", selectionStart: 10, selectionEnd: 10 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "d", ctrlKey: true }, "uptime", 6, 6),
    { handled: true, value: "uptime", selectionStart: 6, selectionEnd: 6 },
  );
});

test("applyTerminalCommandEditKey can yank the last shell kill buffer when enabled", () => {
  const cutBeforeCursor = terminalHistory.applyTerminalCommandEditKey(
    { key: "u", ctrlKey: true },
    "journalctl -u nginx",
    14,
    14,
    { trackKillBuffer: true },
  );
  assert.deepEqual(cutBeforeCursor, {
    handled: true,
    value: "nginx",
    selectionStart: 0,
    selectionEnd: 0,
    killBuffer: "journalctl -u ",
  });

  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey(
      { key: "y", ctrlKey: true },
      cutBeforeCursor.value,
      0,
      0,
      { trackKillBuffer: true, killBuffer: cutBeforeCursor.killBuffer },
    ),
    {
      handled: true,
      value: "journalctl -u nginx",
      selectionStart: 14,
      selectionEnd: 14,
      killBuffer: "journalctl -u ",
    },
  );

  const cutAfterCursor = terminalHistory.applyTerminalCommandEditKey(
    { key: "k", ctrlKey: true },
    "journalctl -u nginx",
    10,
    10,
    { trackKillBuffer: true },
  );
  assert.deepEqual(cutAfterCursor, {
    handled: true,
    value: "journalctl",
    selectionStart: 10,
    selectionEnd: 10,
    killBuffer: " -u nginx",
  });

  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey(
      { key: "y", ctrlKey: true },
      "journalctl",
      10,
      10,
      { trackKillBuffer: true, killBuffer: cutAfterCursor.killBuffer },
    ),
    {
      handled: true,
      value: "journalctl -u nginx",
      selectionStart: 19,
      selectionEnd: 19,
      killBuffer: " -u nginx",
    },
  );
});

test("applyTerminalCommandEditKey maps Alt word cursor movement", () => {
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "b", altKey: true }, "sudo systemctl restart nginx", 22, 22),
    { handled: true, value: "sudo systemctl restart nginx", selectionStart: 15, selectionEnd: 15 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "b", altKey: true }, "sudo systemctl   restart nginx", 17, 17),
    { handled: true, value: "sudo systemctl   restart nginx", selectionStart: 5, selectionEnd: 5 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "f", altKey: true }, "sudo systemctl restart nginx", 5, 5),
    { handled: true, value: "sudo systemctl restart nginx", selectionStart: 14, selectionEnd: 14 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "f", altKey: true }, "sudo systemctl restart nginx", 23, 23),
    { handled: true, value: "sudo systemctl restart nginx", selectionStart: 28, selectionEnd: 28 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "b", altKey: true, ctrlKey: true }, "uptime", 6, 6),
    { handled: false, value: "uptime", selectionStart: 6, selectionEnd: 6 },
  );
});

test("applyTerminalCommandEditKey maps Alt delete next word", () => {
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "d", altKey: true }, "sudo systemctl restart nginx", 5, 5),
    { handled: true, value: "sudo  restart nginx", selectionStart: 5, selectionEnd: 5 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "d", altKey: true }, "sudo systemctl restart nginx", 4, 4),
    { handled: true, value: "sudo restart nginx", selectionStart: 4, selectionEnd: 4 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "d", altKey: true }, "sudo systemctl restart nginx", 5, 14),
    { handled: true, value: "sudo  restart nginx", selectionStart: 5, selectionEnd: 5 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "d", altKey: true, shiftKey: true }, "uptime", 0, 0),
    { handled: false, value: "uptime", selectionStart: 0, selectionEnd: 0 },
  );
});

test("applyTerminalCommandEditKey maps Alt delete previous word", () => {
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "Backspace", altKey: true }, "sudo systemctl restart nginx", 22, 22),
    { handled: true, value: "sudo systemctl nginx", selectionStart: 15, selectionEnd: 15 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "Backspace", altKey: true }, "sudo systemctl restart nginx", 5, 14),
    { handled: true, value: "sudo  restart nginx", selectionStart: 5, selectionEnd: 5 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "Backspace", altKey: true, shiftKey: true }, "uptime", 6, 6),
    { handled: false, value: "uptime", selectionStart: 6, selectionEnd: 6 },
  );
});

test("applyTerminalCommandEditKey maps desktop word deletion keys", () => {
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "Backspace", ctrlKey: true }, "sudo systemctl restart nginx", 22, 22),
    { handled: true, value: "sudo systemctl nginx", selectionStart: 15, selectionEnd: 15 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "Delete", ctrlKey: true }, "sudo systemctl restart nginx", 5, 5),
    { handled: true, value: "sudo  restart nginx", selectionStart: 5, selectionEnd: 5 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "Backspace", ctrlKey: true }, "sudo systemctl restart nginx", 5, 14),
    { handled: true, value: "sudo  restart nginx", selectionStart: 5, selectionEnd: 5 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "Delete", ctrlKey: true, shiftKey: true }, "uptime", 0, 0),
    { handled: false, value: "uptime", selectionStart: 0, selectionEnd: 0 },
  );
});

test("applyTerminalCommandEditKey maps desktop word cursor keys", () => {
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "ArrowLeft", ctrlKey: true }, "sudo systemctl restart nginx", 22, 22),
    { handled: true, value: "sudo systemctl restart nginx", selectionStart: 15, selectionEnd: 15 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "ArrowRight", ctrlKey: true }, "sudo systemctl restart nginx", 5, 5),
    { handled: true, value: "sudo systemctl restart nginx", selectionStart: 14, selectionEnd: 14 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "ArrowLeft", ctrlKey: true }, "sudo systemctl restart nginx", 5, 14),
    { handled: true, value: "sudo systemctl restart nginx", selectionStart: 0, selectionEnd: 0 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "ArrowRight", ctrlKey: true, shiftKey: true }, "uptime", 0, 0),
    { handled: false, value: "uptime", selectionStart: 0, selectionEnd: 0 },
  );
});

test("applyTerminalCommandEditKey maps desktop line boundary cursor keys", () => {
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "Home", ctrlKey: true }, "sudo systemctl restart nginx", 15, 15),
    { handled: true, value: "sudo systemctl restart nginx", selectionStart: 0, selectionEnd: 0 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "End", ctrlKey: true }, "sudo systemctl restart nginx", 5, 14),
    { handled: true, value: "sudo systemctl restart nginx", selectionStart: 28, selectionEnd: 28 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "Home", ctrlKey: true, shiftKey: true }, "uptime", 6, 6),
    { handled: false, value: "uptime", selectionStart: 6, selectionEnd: 6 },
  );
});

test("applyTerminalCommandEditKey maps plain Home and End to the current multiline command row", () => {
  const draft = "cd /var/www\nnpm run build\nsystemctl restart nginx";

  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "Home" }, draft, 18, 18),
    { handled: true, value: draft, selectionStart: 12, selectionEnd: 12 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "End" }, draft, 18, 18),
    { handled: true, value: draft, selectionStart: 25, selectionEnd: 25 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "Home" }, draft, 0, 0),
    { handled: true, value: draft, selectionStart: 0, selectionEnd: 0 },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "End" }, draft, draft.length, draft.length),
    { handled: true, value: draft, selectionStart: draft.length, selectionEnd: draft.length },
  );
  assert.deepEqual(
    terminalHistory.applyTerminalCommandEditKey({ key: "Home", shiftKey: true }, draft, 18, 18),
    { handled: false, value: draft, selectionStart: 18, selectionEnd: 18 },
  );
});

test("buildRunningSessionMetaInput maps Alt key combinations for terminal programs", () => {
  assert.deepEqual(buildRunningSessionMetaInput({ key: "b", altKey: true }, ""), { text: "\x1bb", submit: false });
  assert.deepEqual(buildRunningSessionMetaInput({ key: "B", altKey: true, shiftKey: true }, ""), { text: "\x1bB", submit: false });
  assert.deepEqual(buildRunningSessionMetaInput({ key: "ArrowLeft", altKey: true }, ""), { text: "\x1b[1;3D", submit: false });
  assert.deepEqual(buildRunningSessionMetaInput({ key: "ArrowRight", altKey: true }, ""), { text: "\x1b[1;3C", submit: false });
  assert.deepEqual(buildRunningSessionMetaInput({ key: "Home", altKey: true }, ""), { text: "\x1b[1;3H", submit: false });
  assert.deepEqual(buildRunningSessionMetaInput({ key: "Delete", altKey: true }, ""), { text: "\x1b[3;3~", submit: false });
  assert.equal(buildRunningSessionMetaInput({ key: "b", altKey: true }, "draft"), null);
  assert.equal(buildRunningSessionMetaInput({ key: "b" }, ""), null);
  assert.equal(buildRunningSessionMetaInput({ key: "b", altKey: true, ctrlKey: true }, ""), null);
});

test("buildConnectedShellInput forwards terminal newline and tab control keys", () => {
  assert.deepEqual(buildConnectedShellInput({ key: "m", ctrlKey: true }, "", { connected: true }), { text: "\r", submit: false });
  assert.deepEqual(buildConnectedShellInput({ key: "j", ctrlKey: true }, "", { connected: true }), { text: "\n", submit: false });
  assert.deepEqual(buildConnectedShellInput({ key: "i", ctrlKey: true }, "", { connected: true }), { text: "\t", submit: false });
});

test("buildConnectedShellInput forwards Ctrl Backspace and Ctrl Delete as remote word erase", () => {
  assert.deepEqual(buildConnectedShellInput({ key: "Backspace", ctrlKey: true }, "", { connected: true }), { text: "\x17", submit: false });
  assert.deepEqual(buildConnectedShellInput({ key: "Delete", ctrlKey: true }, "", { connected: true }), { text: "\x17", submit: false });
  assert.equal(buildConnectedShellInput({ key: "Backspace", ctrlKey: true }, "draft", { connected: true }), null);
});

test("buildConnectedShellInput forwards Ctrl slash punctuation controls", () => {
  assert.deepEqual(buildConnectedShellInput({ key: "@", ctrlKey: true }, "", { connected: true }), { text: "\x00", submit: false });
  assert.deepEqual(buildConnectedShellInput({ key: "/", ctrlKey: true }, "", { connected: true }), { text: "\x1f", submit: false });
  assert.deepEqual(buildConnectedShellInput({ key: "?", ctrlKey: true }, "", { connected: true }), { text: "\x7f", submit: false });
  assert.equal(buildConnectedShellInput({ key: "/", ctrlKey: true }, "draft", { connected: true }), null);
});

test("formatTerminalInputForLog keeps SSH input logs readable and safe", () => {
  assert.equal(formatTerminalInputForLog("uptime"), "uptime");
  assert.equal(formatTerminalInputForLog("", { submit: true }), "[Enter]");
  assert.equal(formatTerminalInputForLog("secret", { sensitiveInput: true }), "[敏感输入已隐藏]");
  assert.equal(formatTerminalInputForLog("\x03"), "[控制输入 Ctrl+C]");
  assert.equal(formatTerminalInputForLog("\x1b[A"), "[控制输入 方向键上]");
  assert.doesNotMatch(formatTerminalInputForLog("\x04"), /\x04/);
});

test("formatTerminalInputForLog names common terminal navigation escape sequences", () => {
  assert.equal(formatTerminalInputForLog("\x1b[A"), "[控制输入 方向键上]");
  assert.equal(formatTerminalInputForLog("\x1b[B"), "[控制输入 方向键下]");
  assert.equal(formatTerminalInputForLog("\x1b[C"), "[控制输入 方向键右]");
  assert.equal(formatTerminalInputForLog("\x1b[D"), "[控制输入 方向键左]");
  assert.equal(formatTerminalInputForLog("\x1b[H"), "[控制输入 Home]");
  assert.equal(formatTerminalInputForLog("\x1b[F"), "[控制输入 End]");
  assert.equal(formatTerminalInputForLog("\x1b[3~"), "[控制输入 Delete]");
  assert.equal(formatTerminalInputForLog("\x1b[5~"), "[控制输入 PageUp]");
  assert.equal(formatTerminalInputForLog("\x1b[6~"), "[控制输入 PageDown]");
});

test("formatTerminalInputForLog names modified SSH navigation keys for shortcut diagnostics", () => {
  assert.match(formatTerminalInputForLog("\x1b[1;5D"), /Ctrl\+Left/);
  assert.match(formatTerminalInputForLog("\x1b[1;5C"), /Ctrl\+Right/);
  assert.match(formatTerminalInputForLog("\x1b[1;3D"), /Alt\+Left/);
  assert.match(formatTerminalInputForLog("\x1b[1;3C"), /Alt\+Right/);
  assert.match(formatTerminalInputForLog("\x1b[1;6F"), /Ctrl\+Shift\+End/);
  assert.match(formatTerminalInputForLog("\x1b[3;2~"), /Shift\+Delete/);
});

test("formatTerminalInputForLog names common SSH control keys", () => {
  assert.match(formatTerminalInputForLog("\x01"), /Ctrl\+A/);
  assert.match(formatTerminalInputForLog("\x02"), /Ctrl\+B/);
  assert.match(formatTerminalInputForLog("\x03"), /Ctrl\+C/);
  assert.match(formatTerminalInputForLog("\x04"), /Ctrl\+D/);
  assert.match(formatTerminalInputForLog("\x05"), /Ctrl\+E/);
  assert.match(formatTerminalInputForLog("\x06"), /Ctrl\+F/);
  assert.match(formatTerminalInputForLog("\x07"), /Ctrl\+G/);
  assert.match(formatTerminalInputForLog("\x0c"), /Ctrl\+L/);
  assert.match(formatTerminalInputForLog("\x0e"), /Ctrl\+N/);
  assert.match(formatTerminalInputForLog("\x10"), /Ctrl\+P/);
  assert.match(formatTerminalInputForLog("\x11"), /Ctrl\+Q/);
  assert.match(formatTerminalInputForLog("\x12"), /Ctrl\+R/);
  assert.match(formatTerminalInputForLog("\x13"), /Ctrl\+S/);
  assert.match(formatTerminalInputForLog("\x14"), /Ctrl\+T/);
  assert.match(formatTerminalInputForLog("\x15"), /Ctrl\+U/);
  assert.match(formatTerminalInputForLog("\x0b"), /Ctrl\+K/);
  assert.match(formatTerminalInputForLog("\x17"), /Ctrl\+W/);
  assert.match(formatTerminalInputForLog("\x18"), /Ctrl\+X/);
  assert.match(formatTerminalInputForLog("\x19"), /Ctrl\+Y/);
  assert.match(formatTerminalInputForLog("\x1a"), /Ctrl\+Z/);
  assert.match(formatTerminalInputForLog("\x1c"), /Ctrl\+\\/);
});

test("formatTerminalInputForLog names punctuation control keys for support logs", () => {
  assert.match(formatTerminalInputForLog("\x00"), /Ctrl\+Space\/Ctrl\+@\/Ctrl\+2/);
  assert.match(formatTerminalInputForLog("\x1d"), /Ctrl\+\]/);
  assert.match(formatTerminalInputForLog("\x1e"), /Ctrl\+\^/);
  assert.match(formatTerminalInputForLog("\x1f"), /Ctrl\+_\/Ctrl\+\//);
});

test("formatTerminalInputForLog redacts secrets embedded in SSH commands", () => {
  const passwordCommand = formatTerminalInputForLog("mysql --password=DoNotSave -e status");
  const apiKeyCommand = formatTerminalInputForLog("curl https://api.example.com?api_key=sk-test-123");
  const authCommand = formatTerminalInputForLog('curl -H "Authorization: Bearer abc123" https://example.com');
  const tokenCommand = formatTerminalInputForLog("export TOKEN=prod-token SECRET=plain-secret");

  assert.doesNotMatch(passwordCommand, /DoNotSave/);
  assert.doesNotMatch(apiKeyCommand, /sk-test-123/);
  assert.doesNotMatch(authCommand, /abc123/);
  assert.doesNotMatch(tokenCommand, /prod-token|plain-secret/);
  assert.match(passwordCommand, /--password=\[敏感信息已隐藏\]/);
  assert.match(apiKeyCommand, /api_key=\[敏感信息已隐藏\]/);
  assert.match(authCommand, /Authorization: Bearer \[敏感信息已隐藏\]/);
  assert.match(tokenCommand, /TOKEN=\[敏感信息已隐藏\]/);
  assert.match(tokenCommand, /SECRET=\[敏感信息已隐藏\]/);
});

test("getTerminalShortcutAction maps familiar desktop terminal shortcuts", () => {
  assert.equal(getTerminalShortcutAction({ key: "F2" }, ""), "rename-tab");
  assert.equal(getTerminalShortcutAction({ key: "F11" }, ""), "toggle-terminal-focus");
  assert.equal(getTerminalShortcutAction({ key: "A", ctrlKey: true, shiftKey: true }, ""), "select-all-output");
  assert.equal(getTerminalShortcutAction({ key: "a", ctrlKey: true }, ""), null);
  assert.equal(getTerminalShortcutAction({ key: "C", ctrlKey: true, shiftKey: true }, ""), "copy-output");
  assert.equal(getTerminalShortcutAction({ key: "c", ctrlKey: true }, ""), "interrupt-session");
  assert.equal(getTerminalShortcutAction({ key: "Insert", ctrlKey: true }, ""), "copy-output");
  assert.equal(getTerminalShortcutAction({ key: "v", ctrlKey: true }, ""), "paste-command");
  assert.equal(getTerminalShortcutAction({ key: "V", ctrlKey: true, shiftKey: true }, ""), "paste-command");
  assert.equal(getTerminalShortcutAction({ key: "Insert", shiftKey: true }, ""), "paste-command");
  assert.equal(getTerminalShortcutAction({ key: "+", ctrlKey: true }, ""), "zoom-in");
  assert.equal(getTerminalShortcutAction({ key: "=", ctrlKey: true }, ""), "zoom-in");
  assert.equal(getTerminalShortcutAction({ key: "-", ctrlKey: true }, ""), "zoom-out");
  assert.equal(getTerminalShortcutAction({ key: "0", ctrlKey: true }, ""), "zoom-reset");
  assert.equal(getTerminalShortcutAction({ key: "f", ctrlKey: true }, ""), "focus-search");
  assert.equal(getTerminalShortcutAction({ key: "F", ctrlKey: true, shiftKey: true }, ""), "focus-search");
  assert.equal(getTerminalShortcutAction({ key: "l", ctrlKey: true }, "df -hT"), "clear-output");
  assert.equal(getTerminalShortcutAction({ key: "L", ctrlKey: true, shiftKey: true }, "df -hT"), "clear-output");
  assert.equal(getTerminalShortcutAction({ key: "u", ctrlKey: true }, "draft command"), "clear-input");
  assert.equal(getTerminalShortcutAction({ key: "d", ctrlKey: true }, ""), "disconnect-session");
  assert.equal(getTerminalShortcutAction({ key: "PageUp", ctrlKey: true }, ""), "previous-tab");
  assert.equal(getTerminalShortcutAction({ key: "PageDown", ctrlKey: true }, ""), "next-tab");
  assert.equal(getTerminalShortcutAction({ key: "Tab", ctrlKey: true }, ""), "next-tab");
  assert.equal(getTerminalShortcutAction({ key: "Tab", ctrlKey: true, shiftKey: true }, ""), "previous-tab");
  assert.equal(getTerminalShortcutAction({ key: "1", ctrlKey: true }, ""), "select-tab-1");
  assert.equal(getTerminalShortcutAction({ key: "9", ctrlKey: true }, ""), "select-tab-9");
  assert.equal(getTerminalShortcutAction({ key: "w", ctrlKey: true }, ""), "close-tab");
  assert.equal(getTerminalShortcutAction({ key: "w", ctrlKey: true }, "draft command"), null);
  assert.equal(getTerminalShortcutAction({ key: "W", ctrlKey: true, shiftKey: true }, "draft command"), "close-tab");
  assert.equal(getTerminalShortcutAction({ key: "T", ctrlKey: true, shiftKey: true }, ""), "duplicate-tab");
  assert.equal(getTerminalShortcutAction({ key: "N", ctrlKey: true, shiftKey: true }, ""), "new-connection");
  assert.equal(getTerminalShortcutAction({ key: "R", ctrlKey: true, shiftKey: true }, ""), "reconnect-session");
  assert.equal(getTerminalShortcutAction({ key: "E", ctrlKey: true, shiftKey: true }, ""), "reopen-closed-tab");
  assert.equal(getTerminalShortcutAction({ key: "B", ctrlKey: true, shiftKey: true }, ""), "open-backup-center");
  assert.equal(getTerminalShortcutAction({ key: "G", ctrlKey: true, shiftKey: true }, ""), "open-tool-logs");
  assert.equal(getTerminalShortcutAction({ key: "I", ctrlKey: true, shiftKey: true }, ""), "edit-current-connection");
  assert.equal(getTerminalShortcutAction({ key: "K", ctrlKey: true, shiftKey: true }, ""), "open-auth-center");
  assert.equal(getTerminalShortcutAction({ key: "H", ctrlKey: true, shiftKey: true }, ""), "open-session-logs");
  assert.equal(getTerminalShortcutAction({ key: "O", ctrlKey: true, shiftKey: true }, ""), "open-cwd-in-sftp");
  assert.equal(getTerminalShortcutAction({ key: "P", ctrlKey: true, shiftKey: true }, ""), "toggle-pin-tab");
  assert.equal(getTerminalShortcutAction({ key: "S", ctrlKey: true, shiftKey: true }, ""), "export-terminal-output");
  assert.equal(getTerminalShortcutAction({ key: "Y", ctrlKey: true, shiftKey: true }, ""), "copy-ssh-command");
  assert.equal(getTerminalShortcutAction({ key: "D", ctrlKey: true, shiftKey: true }, "draft command"), "disconnect-session");
  assert.equal(getTerminalShortcutAction({ key: "d", ctrlKey: true }, "draft command"), null);
  assert.equal(getTerminalShortcutAction({ key: "c", ctrlKey: true }, "draft command"), "interrupt-session");
  assert.equal(getTerminalShortcutAction({ key: "v", ctrlKey: true, shiftKey: true, altKey: true }, ""), null);
  assert.equal(getTerminalShortcutAction({ key: "c" }, ""), null);
});

test("getTerminalSearchKeyAction maps terminal search navigation keys", () => {
  assert.equal(getTerminalSearchKeyAction({ key: "Enter" }), "next-match");
  assert.equal(getTerminalSearchKeyAction({ key: "Enter", shiftKey: true }), "previous-match");
  assert.equal(getTerminalSearchKeyAction({ key: "F3" }), "next-match");
  assert.equal(getTerminalSearchKeyAction({ key: "F3", shiftKey: true }), "previous-match");
  assert.equal(getTerminalSearchKeyAction({ key: "Escape" }), "blur-search");
  assert.equal(getTerminalSearchKeyAction({ key: "Enter", ctrlKey: true }), null);
  assert.equal(getTerminalSearchKeyAction({ key: "F3", altKey: true }), null);
  assert.equal(getTerminalSearchKeyAction({ key: "f", ctrlKey: true }), null);
});

test("getTerminalScrollKeyAction maps terminal output review keys", () => {
  assert.equal(terminalHistory.getTerminalScrollKeyAction({ key: "PageUp" }), "page-up");
  assert.equal(terminalHistory.getTerminalScrollKeyAction({ key: "PageDown" }), "page-down");
  assert.equal(terminalHistory.getTerminalScrollKeyAction({ key: "Home" }), "top");
  assert.equal(terminalHistory.getTerminalScrollKeyAction({ key: "End" }), "bottom");
  assert.equal(terminalHistory.getTerminalScrollKeyAction({ key: "PageUp", shiftKey: true }), "page-up");
  assert.equal(terminalHistory.getTerminalScrollKeyAction({ key: "PageDown", shiftKey: true }), "page-down");
  assert.equal(terminalHistory.getTerminalScrollKeyAction({ key: "Home", shiftKey: true }), "top");
  assert.equal(terminalHistory.getTerminalScrollKeyAction({ key: "End", shiftKey: true }), "bottom");
  assert.equal(terminalHistory.getTerminalScrollKeyAction({ key: "PageUp", ctrlKey: true }), null);
  assert.equal(terminalHistory.getTerminalScrollKeyAction({ key: "PageDown", altKey: true }), null);
});

test("adjustTerminalFontSize changes terminal font size within a safe range", () => {
  assert.equal(adjustTerminalFontSize(14, "zoom-in"), 15);
  assert.equal(adjustTerminalFontSize(14, "zoom-out"), 13);
  assert.equal(adjustTerminalFontSize(18, "zoom-reset"), 14);
  assert.equal(adjustTerminalFontSize(99, "zoom-in"), 20);
  assert.equal(adjustTerminalFontSize(1, "zoom-out"), 11);
  assert.equal(adjustTerminalFontSize("bad", "zoom-in"), 15);
  assert.equal(adjustTerminalFontSize(14, "unknown"), 14);
});

test("addCustomCommandSnippet trims commands and avoids duplicate custom snippets", () => {
  const snippets = addCustomCommandSnippet([], " docker ps --format '{{.Names}}' ");
  const duplicated = addCustomCommandSnippet(snippets, "docker ps --format '{{.Names}}'");

  assert.deepEqual(snippets, [
    {
      label: "docker ps --format '{{.Names}}'",
      command: "docker ps --format '{{.Names}}'",
      custom: true,
    },
  ]);
  assert.deepEqual(duplicated, snippets);
});

test("validateCustomCommandSnippet rejects commands with sensitive material", () => {
  assert.equal(validateCustomCommandSnippet("df -hT").ok, true);

  const passwordCommand = validateCustomCommandSnippet("mysql --password=DoNotSave");
  assert.equal(passwordCommand.ok, false);
  assert.match(passwordCommand.message, /敏感信息/);

  const tokenCommand = validateCustomCommandSnippet('curl -H "Authorization: Bearer token" https://example.com');
  assert.equal(tokenCommand.ok, false);

  assert.deepEqual(addCustomCommandSnippet([], "mysql --password=DoNotSave"), []);
});

test("removeCustomCommandSnippet removes only the selected custom command", () => {
  const snippets = [
    { label: "docker", command: "docker ps", custom: true },
    { label: "nginx", command: "nginx -t", custom: true },
  ];

  assert.deepEqual(removeCustomCommandSnippet(snippets, "docker ps"), [{ label: "nginx", command: "nginx -t", custom: true }]);
});

test("mergeTerminalCommandSnippets appends custom snippets and skips builtin duplicates", () => {
  const merged = mergeTerminalCommandSnippets(TERMINAL_COMMAND_SNIPPETS, [
    { label: "磁盘别名", command: "df -hT", custom: true },
    { label: "容器", command: "docker ps", custom: true },
  ]);

  assert.equal(merged.filter((item) => item.command === "df -hT").length, 1);
  assert.equal(merged.at(-1).label, "容器");
  assert.equal(merged.at(-1).custom, true);
});

test("prepareClipboardCommandPaste protects multiline terminal paste", () => {
  const single = prepareClipboardCommandPaste(" df -hT ", "uptime");
  assert.equal(single.ok, true);
  assert.equal(single.nextCommand, "uptime df -hT");
  assert.equal(single.requiresConfirmation, false);

  const guarded = prepareClipboardCommandPaste("cd /var/www\nnpm run deploy", "");
  assert.equal(guarded.ok, false);
  assert.equal(guarded.requiresConfirmation, true);
  assert.equal(guarded.lineCount, 2);
  assert.match(guarded.message, /多行/);
  assert.match(guarded.message, /cd \/var\/www/);
  assert.match(guarded.message, /npm run deploy/);

  const guardedSecret = prepareClipboardCommandPaste("export TOKEN=prod-secret\nnpm run deploy\nsystemctl reload nginx\nwhoami", "");
  assert.match(guardedSecret.message, /预览/);
  assert.match(guardedSecret.message, /TOKEN=\[敏感信息已隐藏\]/);
  assert.doesNotMatch(guardedSecret.message, /prod-secret/);
  assert.doesNotMatch(guardedSecret.message, /whoami/);

  const confirmed = prepareClipboardCommandPaste("cd /var/www\r\nnpm run deploy", "sudo -iu deploy", { allowMultiline: true });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.nextCommand, "sudo -iu deploy\ncd /var/www\nnpm run deploy");
  assert.equal(confirmed.lineCount, 2);
});

test("prepareInteractiveClipboardPaste guards multiline and large running-program paste", () => {
  const single = prepareInteractiveClipboardPaste("y");
  assert.equal(single.ok, true);
  assert.equal(single.requiresConfirmation, false);
  assert.equal(single.text, "y");

  const multiline = prepareInteractiveClipboardPaste("cd /var/www\nnpm run deploy");
  assert.equal(multiline.ok, false);
  assert.equal(multiline.requiresConfirmation, true);
  assert.equal(multiline.lineCount, 2);
  assert.match(multiline.message, /交互程序/);
  assert.match(multiline.message, /cd \/var\/www/);
  assert.match(multiline.message, /npm run deploy/);

  const large = prepareInteractiveClipboardPaste("x".repeat(1201));
  assert.equal(large.ok, false);
  assert.equal(large.requiresConfirmation, true);
  assert.equal(large.charCount, 1201);

  const confirmed = prepareInteractiveClipboardPaste("cd /var/www\r\nnpm run deploy", { allowRiskyPaste: true });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.requiresConfirmation, false);
  assert.equal(confirmed.text, "cd /var/www\nnpm run deploy");
});
