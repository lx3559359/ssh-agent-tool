import assert from "node:assert/strict";
import test from "node:test";

import * as terminalOutput from "./terminalOutput.js";

const {
  TERMINAL_CLEAR_MARKER,
  appendTerminalOutputState,
  appendTerminalOutputLines,
  buildTerminalSearchState,
  buildVisibleTerminalLines,
  buildTerminalCommandOutputBlock,
  formatInteractiveSessionLines,
  formatSshCommandResults,
  formatTerminalClipboardText,
  formatTerminalSelectionText,
  extractTerminalCommandFromLine,
  getTerminalControlModeUpdate,
  stripSubmittedCommandEcho,
  wrapBracketedPasteText,
  parseAnsiLineSegments,
  highlightTerminalSearchSegments,
} = terminalOutput;

test("formatSshCommandResults appends command, stdout, and stderr lines", () => {
  const lines = formatSshCommandResults("prod-web-01", [
    { ok: true, command: "whoami", stdout: "root\n", stderr: "" },
    { ok: false, command: "uptime", stdout: "", stderr: "permission denied" },
  ]);

  assert.deepEqual(lines, [
    "[prod-web-01]$ whoami",
    "root",
    "[prod-web-01]$ uptime",
    "permission denied",
  ]);
});

test("formatInteractiveSessionLines appends command and shell output", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "pwd", "/root\n$ ");

  assert.deepEqual(lines, ["[prod-web-01]$ pwd", "/root", "$"]);
});

test("stripSubmittedCommandEcho removes only the leading echoed SSH command", () => {
  assert.equal(stripSubmittedCommandEcho("uptime\r\n17:42 up 23 days\n$ ", "uptime"), "17:42 up 23 days\n$ ");
  assert.equal(stripSubmittedCommandEcho(" sudo systemctl status nginx \nactive\n", "sudo systemctl status nginx"), "active\n");
  assert.equal(stripSubmittedCommandEcho("17:42 up 23 days\n", "uptime"), "17:42 up 23 days\n");
  assert.equal(stripSubmittedCommandEcho("echo uptime\nuptime\n", "uptime"), "echo uptime\nuptime\n");
});

test("stripSubmittedCommandEcho removes leading remote prompt and echoed command", () => {
  assert.equal(stripSubmittedCommandEcho("[root@prod-web-01 ~]# uptime\r\n17:42 up 23 days\n$ ", "uptime"), "17:42 up 23 days\n$ ");
  assert.equal(stripSubmittedCommandEcho("\u001b[?2004l\rdeploy@prod-web-01:/var/www$ pwd\n/var/www\n", "pwd"), "/var/www\n");
  assert.equal(stripSubmittedCommandEcho("deploy@prod-web-01:/var/www% pwd\n/var/www\n", "pwd"), "/var/www\n");
});

test("stripSubmittedCommandEcho keeps real output that only contains a prompt-like character", () => {
  assert.equal(stripSubmittedCommandEcho("echo # uptime\nuptime\n", "uptime"), "echo # uptime\nuptime\n");
});

test("formatInteractiveSessionLines preserves ANSI SGR colors and strips non-display control sequences", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "ls", "\u001b[32mapp.log\u001b[0m\n\u001b[?2004h$ ");

  assert.deepEqual(lines, ["[prod-web-01]$ ls", "\u001b[32mapp.log\u001b[0m", "$"]);
});

test("formatInteractiveSessionLines strips terminal bell characters from server output", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "prompt", "ready\u0007\n\u0007$ ");

  assert.deepEqual(lines, ["[prod-web-01]$ prompt", "ready", "$"]);
});

test("formatInteractiveSessionLines treats form feed as terminal clear screen", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "clear", "old output\u000cnew prompt\n");

  assert.deepEqual(lines, ["[prod-web-01]$ clear", TERMINAL_CLEAR_MARKER, "new prompt"]);
});

test("formatInteractiveSessionLines treats terminal reset as clear screen", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "reset", "old output\u001bcfresh prompt\n");

  assert.deepEqual(lines, ["[prod-web-01]$ reset", TERMINAL_CLEAR_MARKER, "fresh prompt"]);
});

test("formatInteractiveSessionLines strips terminal private string controls", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "tmux", "before\u001bPtmux;ignored\u001b\\middle\u001b_private\u001b\\after\n");

  assert.deepEqual(lines, ["[prod-web-01]$ tmux", "beforemiddleafter"]);
});

test("formatInteractiveSessionLines translates VT100 line drawing characters for TUI apps", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "htop", "\u001b(0lqqqk\u001b(B\n\u001b(0x\u001b(B CPU \u001b(0x\u001b(B\n\u001b(0mqqqj\u001b(B\n");

  assert.deepEqual(lines, ["[prod-web-01]$ htop", "┌───┐", "│ CPU │", "└───┘"]);
});

test("formatInteractiveSessionLines renders VT100 line drawing as readable box characters", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "dialog", "\u001b(0lqk\u001b(B\n\u001b(0x x\u001b(B\n\u001b(0mqj\u001b(B\n");

  assert.deepEqual(lines, ["[prod-web-01]$ dialog", "┌─┐", "│ │", "└─┘"]);
});

test("getTerminalControlModeUpdate tracks bracketed paste mode", () => {
  assert.deepEqual(getTerminalControlModeUpdate("plain output"), { bracketedPaste: null });
  assert.deepEqual(getTerminalControlModeUpdate("\u001b[?2004h$ "), { bracketedPaste: true });
  assert.deepEqual(getTerminalControlModeUpdate("\u001b[?2004hvim\n\u001b[?2004l$ "), { bracketedPaste: false });
});

test("getTerminalControlModeUpdate extracts OSC terminal titles without showing them as output", () => {
  const bellTitle = "\u001b]0;root@prod-web-01:/var/www\u0007";
  const stTitle = "\u001b]2;vim /etc/nginx/nginx.conf\u001b\\";

  assert.deepEqual(getTerminalControlModeUpdate(`hello\n${bellTitle}$ `), {
    bracketedPaste: null,
    title: "root@prod-web-01:/var/www",
  });
  assert.deepEqual(getTerminalControlModeUpdate(stTitle), {
    bracketedPaste: null,
    title: "vim /etc/nginx/nginx.conf",
  });
  assert.deepEqual(formatInteractiveSessionLines("prod-web-01", "", `${bellTitle}ready\n`).slice(1), ["ready"]);
});

test("getTerminalControlModeUpdate extracts OSC 7 current working directories", () => {
  const plainCwd = "\u001b]7;file://prod-web-01/var/www/app\u0007";
  const encodedCwd = "\u001b]7;file://prod-web-01/var/log/nginx%20logs\u001b\\";

  assert.deepEqual(getTerminalControlModeUpdate(`${plainCwd}$ `), {
    bracketedPaste: null,
    cwd: "/var/www/app",
  });
  assert.deepEqual(getTerminalControlModeUpdate(encodedCwd), {
    bracketedPaste: null,
    cwd: "/var/log/nginx logs",
  });
  assert.deepEqual(formatInteractiveSessionLines("prod-web-01", "", `${plainCwd}ready\n`).slice(1), ["ready"]);
});

test("wrapBracketedPasteText protects multiline paste when remote mode is enabled", () => {
  assert.equal(wrapBracketedPasteText("a\nb", false), "a\nb");
  assert.equal(wrapBracketedPasteText("a\r\nb", true), "\u001b[200~a\nb\u001b[201~");
});

test("formatInteractiveSessionLines collapses carriage-return progress updates", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "curl", " 10%\r 50%\r100%\n");

  assert.deepEqual(lines, ["[prod-web-01]$ curl", "100%"]);
});

test("formatInteractiveSessionLines emits a clear marker for full-screen terminal controls", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "top", "\u001b[2J\u001b[Htop - 12:00\nload average: 0.42\n");

  assert.deepEqual(lines, ["[prod-web-01]$ top", TERMINAL_CLEAR_MARKER, "top - 12:00", "load average: 0.42"]);
});

test("formatInteractiveSessionLines emits a clear marker when entering alternate screen", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "less app.log", "\u001b[?1049happ log line\n");

  assert.deepEqual(lines, ["[prod-web-01]$ less app.log", TERMINAL_CLEAR_MARKER, "app log line"]);
});

test("appendTerminalOutputLines drops old output after a clear marker", () => {
  const lines = appendTerminalOutputLines(["old uptime", "old df"], ["[prod-web-01]$ top", TERMINAL_CLEAR_MARKER, "top - 12:00"], 50);

  assert.deepEqual(lines, ["top - 12:00"]);
});

test("appendTerminalOutputLines keeps a visible notice after a remote clear without new output", () => {
  const lines = appendTerminalOutputLines(["old uptime", "old df"], [TERMINAL_CLEAR_MARKER], 50);

  assert.equal(lines.length, 1);
  assert.match(lines[0], /远程程序已清屏/);
});

test("appendTerminalOutputLines keeps the clear notice when a remote clear is followed by blank output", () => {
  const lines = appendTerminalOutputLines(["old uptime", "old df"], [TERMINAL_CLEAR_MARKER, "", "   "], 50);

  assert.equal(lines.length, 1);
  assert.match(lines[0], /远程程序已清屏/);
});

test("appendTerminalOutputLines replaces the clear notice when later terminal output arrives", () => {
  const cleared = appendTerminalOutputLines(["old uptime", "old df"], [TERMINAL_CLEAR_MARKER], 50);
  const restored = appendTerminalOutputLines(cleared, ["[root@prod-web-01 ~]#"], 50);

  assert.deepEqual(restored, ["[root@prod-web-01 ~]#"]);
});

test("terminal clear and export helper text stay readable Chinese", () => {
  const cleared = appendTerminalOutputLines(["old uptime"], [TERMINAL_CLEAR_MARKER], 50);
  const exported = terminalOutput.buildTerminalExportText("prod-web-01", [], new Date("2026-06-28T01:40:05.000Z"));
  const mojibakePattern = new RegExp(["\\uFFFD", "\\u6769", "\\u7F01", "\\u7025", "\\u93C6", "\\u9363"].join("|"));

  assert.equal(cleared[0], "# 远程程序已清屏，正在等待新的终端输出...");
  assert.match(exported, /^# SSH 终端输出/);
  assert.match(exported, /服务器: prod-web-01/);
  assert.match(exported, /暂无终端输出。/);
  assert.doesNotMatch(`${cleared[0]}\n${exported}`, mojibakePattern);
});

test("appendTerminalOutputState clears alternate screen content when leaving alternate screen", () => {
  const lessScreen = appendTerminalOutputState(
    { lines: ["old shell line"], openLine: false },
    formatInteractiveSessionLines("prod-web-01", "", "\u001b[?1049happ log line\n").slice(1),
    50,
  );
  const shellScreen = appendTerminalOutputState(lessScreen, formatInteractiveSessionLines("prod-web-01", "", "\u001b[?1049l$ ").slice(1), 50);

  assert.deepEqual(shellScreen, { lines: ["$"], openLine: true });
});

test("appendTerminalOutputLines keeps the newest terminal buffer inside the line limit", () => {
  const lines = appendTerminalOutputLines(["one", "two"], ["three", "four"], 3);

  assert.equal(lines.length, 3);
  assert.match(lines[0], /已截断前 2 行终端输出/);
  assert.deepEqual(lines.slice(1), ["three", "four"]);
});

test("appendTerminalOutputLines shows a truncation notice when old output is dropped", () => {
  const lines = appendTerminalOutputLines(["one", "two"], ["three", "four"], 3);

  assert.equal(lines.length, 3);
  assert.match(lines[0], /已截断前 2 行终端输出/);
  assert.deepEqual(lines.slice(1), ["three", "four"]);
});

test("appendTerminalOutputLines rewrites progress output split across SSH stream chunks", () => {
  const first = appendTerminalOutputLines([], formatInteractiveSessionLines("prod-web-01", "", "10%").slice(1), 50);
  const second = appendTerminalOutputLines(first, formatInteractiveSessionLines("prod-web-01", "", "\r20%").slice(1), 50);
  const third = appendTerminalOutputLines(second, formatInteractiveSessionLines("prod-web-01", "", "\r100%\n").slice(1), 50);

  assert.deepEqual(third, ["100%"]);
});

test("appendTerminalOutputState keeps carriage-return progress visible between SSH chunks", () => {
  const first = appendTerminalOutputState({ lines: [], openLine: false }, formatInteractiveSessionLines("prod-web-01", "", "10%\r").slice(1), 50);
  const second = appendTerminalOutputState(first, formatInteractiveSessionLines("prod-web-01", "", "20%\r").slice(1), 50);
  const third = appendTerminalOutputState(second, formatInteractiveSessionLines("prod-web-01", "", "100%\n").slice(1), 50);

  assert.deepEqual(first, { lines: ["10%"], openLine: true, cursorLeft: 3 });
  assert.deepEqual(second, { lines: ["20%"], openLine: true, cursorLeft: 3 });
  assert.deepEqual(third, { lines: ["100%"], openLine: false });
});

test("appendTerminalOutputState joins SSH output split across stream chunks", () => {
  const first = appendTerminalOutputState({ lines: [], openLine: false }, formatInteractiveSessionLines("prod-web-01", "", "hel").slice(1), 50);
  const second = appendTerminalOutputState(first, formatInteractiveSessionLines("prod-web-01", "", "lo\nnext").slice(1), 50);

  assert.deepEqual(second, { lines: ["hello", "next"], openLine: true });
});

test("appendTerminalOutputState starts a new visible line when a chunk begins with a newline", () => {
  const first = appendTerminalOutputState({ lines: [], openLine: false }, formatInteractiveSessionLines("prod-web-01", "", "prompt").slice(1), 50);
  const second = appendTerminalOutputState(first, formatInteractiveSessionLines("prod-web-01", "", "\nresult\n").slice(1), 50);

  assert.deepEqual(second, { lines: ["prompt", "result"], openLine: false });
});

test("appendTerminalOutputState rewrites the previous line for ANSI cursor-up progress updates", () => {
  const first = appendTerminalOutputState(
    { lines: [], openLine: false },
    formatInteractiveSessionLines("prod-web-01", "", "Pulling fs layer\nDownloading 10%\n").slice(1),
    50,
  );
  const second = appendTerminalOutputState(
    first,
    formatInteractiveSessionLines("prod-web-01", "", "\u001b[1A\u001b[2KDownloading 20%\n").slice(1),
    50,
  );

  assert.deepEqual(second, { lines: ["Pulling fs layer", "Downloading 20%"], openLine: false });
});

test("appendTerminalOutputState rewrites multiple previous lines for ANSI cursor-up progress updates", () => {
  const first = appendTerminalOutputState(
    { lines: [], openLine: false },
    formatInteractiveSessionLines("prod-web-01", "", "Pulling fs layer\nDownloading 10%\n").slice(1),
    50,
  );
  const second = appendTerminalOutputState(
    first,
    formatInteractiveSessionLines("prod-web-01", "", "\u001b[2A\u001b[2KPull complete\n\u001b[2KDownloaded 100%\n").slice(1),
    50,
  );

  assert.deepEqual(second, { lines: ["Pull complete", "Downloaded 100%"], openLine: false });
});

test("appendTerminalOutputState treats cursor-home screen repaints as the latest terminal frame", () => {
  const first = appendTerminalOutputState(
    { lines: [], openLine: false },
    formatInteractiveSessionLines("prod-web-01", "", "top - 12:00\nload average: 0.42\n").slice(1),
    50,
  );
  const second = appendTerminalOutputState(
    first,
    formatInteractiveSessionLines("prod-web-01", "", "\u001b[Htop - 12:01\nload average: 0.65\n").slice(1),
    50,
  );

  assert.deepEqual(second, { lines: ["top - 12:01", "load average: 0.65"], openLine: false });
});

test("formatInteractiveSessionLines does not treat bare cursor-home as a remote clear", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "", "\u001b[H[root@prod-web-01 ~]# uptime\n");

  assert.deepEqual(lines, ["[prod-web-01]$ ", "[root@prod-web-01 ~]# uptime"]);
});

test("formatInteractiveSessionLines maps absolute cursor row and column updates onto visible lines", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "dialog", "\u001b[2J\u001b[HTitle\u001b[2;1HStatus\u001b[3;5HOK\n");

  assert.deepEqual(lines, ["[prod-web-01]$ dialog", TERMINAL_CLEAR_MARKER, "Title", "Status", "    OK"]);
});

test("formatInteractiveSessionLines maps cursor-down movement onto the next visible row", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "htop", "\u001b[2J\u001b[HTitle\u001b[1BOK\n");

  assert.deepEqual(lines, ["[prod-web-01]$ htop", TERMINAL_CLEAR_MARKER, "Title", "     OK"]);
});

test("formatInteractiveSessionLines maps cursor-next-line movement to the next row start", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "installer", "\u001b[2J\u001b[HTitle\u001b[1EOK\n");

  assert.deepEqual(lines, ["[prod-web-01]$ installer", TERMINAL_CLEAR_MARKER, "Title", "OK"]);
});

test("formatInteractiveSessionLines maps cursor-previous-line movement to the previous row start", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "menu", "\u001b[2J\u001b[HHeader\u001b[2ELast\u001b[1FStatus\n");

  assert.deepEqual(lines, ["[prod-web-01]$ menu", TERMINAL_CLEAR_MARKER, "Header", "Status", "Last"]);
});

test("formatInteractiveSessionLines maps cursor-up movement while preserving the current column", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "dashboard", "\u001b[2J\u001b[HCPU: 10\u001b[1EDisk: 90\u001b[1A42\n");

  assert.deepEqual(lines, ["[prod-web-01]$ dashboard", TERMINAL_CLEAR_MARKER, "CPU: 10 42", "Disk: 90"]);
});

test("formatInteractiveSessionLines maps horizontal relative movement aliases", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "dashboard", "abc\u001b[2aX\n");

  assert.deepEqual(lines, ["[prod-web-01]$ dashboard", "abc  X"]);
});

test("formatInteractiveSessionLines maps forward tab cursor movement", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "menu", "A\u001b[IB\n");

  assert.deepEqual(lines, ["[prod-web-01]$ menu", "A       B"]);
});

test("formatInteractiveSessionLines maps backward tab cursor movement", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "menu", "A\u001b[2IB\u001b[2ZC\n");

  assert.deepEqual(lines, ["[prod-web-01]$ menu", "A       C       B"]);
});

test("formatInteractiveSessionLines expands literal tab output to terminal tab stops", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "printf", "NAME\tSTATUS\nweb\tOK\n");

  assert.deepEqual(lines, ["[prod-web-01]$ printf", "NAME    STATUS", "web     OK"]);
});

test("formatInteractiveSessionLines keeps cursor columns correct after literal tabs", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "menu", "A\tB\u001b[1GZ\n");

  assert.deepEqual(lines, ["[prod-web-01]$ menu", "Z       B"]);
});

test("formatInteractiveSessionLines keeps cursor columns correct after wide CJK characters", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "menu", "表\u001b[3GX\n");

  assert.deepEqual(lines, ["[prod-web-01]$ menu", "表X"]);
});

test("formatInteractiveSessionLines expands tabs from the display width of wide CJK characters", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "printf", "表\tOK\n");

  assert.deepEqual(lines, ["[prod-web-01]$ printf", "表      OK"]);
});

test("formatInteractiveSessionLines keeps cursor columns correct after emoji characters", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "deploy", "🚀\u001b[3GX\n");

  assert.deepEqual(lines, ["[prod-web-01]$ deploy", "🚀X"]);
});

test("formatInteractiveSessionLines expands tabs from the display width of emoji characters", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "deploy", "🚀\tOK\n");

  assert.deepEqual(lines, ["[prod-web-01]$ deploy", "🚀      OK"]);
});

test("formatInteractiveSessionLines repeats the previous character with ANSI repeat-character", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "progress", "=\u001b[4b\n");

  assert.deepEqual(lines, ["[prod-web-01]$ progress", "====="]);
});

test("formatInteractiveSessionLines maps vertical absolute row movement while preserving the column", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "dashboard", "\u001b[2J\u001b[Hone\u001b[3dX\n");

  assert.deepEqual(lines, ["[prod-web-01]$ dashboard", TERMINAL_CLEAR_MARKER, "one", "   X"]);
});

test("formatInteractiveSessionLines maps vertical relative row movement while preserving the column", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "dashboard", "\u001b[2J\u001b[Hone\u001b[2eX\n");

  assert.deepEqual(lines, ["[prod-web-01]$ dashboard", TERMINAL_CLEAR_MARKER, "one", "   X"]);
});

test("formatInteractiveSessionLines caps extreme cursor row movement to avoid blank terminal crashes", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "bad-output", `before\u001b[5000Bafter\n`);

  assert.ok(lines.length <= 210);
  assert.equal(lines[0], "[prod-web-01]$ bad-output");
  assert.match(lines.at(-1), /after$/);
});

test("formatInteractiveSessionLines caps extreme cursor columns to avoid oversized terminal rows", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "bad-output", `before\u001b[5000Cafter\n`);

  assert.ok(lines[1].length <= 520);
  assert.ok(lines[1].endsWith("after"));
});

test("formatInteractiveSessionLines restores saved cursor positions for localized screen updates", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "dashboard", "\u001b[2J\u001b[Hone\u001b[s\u001b[2;1Htwo\u001b[uX\n");

  assert.deepEqual(lines, ["[prod-web-01]$ dashboard", TERMINAL_CLEAR_MARKER, "oneX", "two"]);
});

test("formatInteractiveSessionLines restores DEC saved cursor positions for legacy terminal programs", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "dashboard", "\u001b[2J\u001b[Hone\u001b7\u001b[2;1Htwo\u001b8X\n");

  assert.deepEqual(lines, ["[prod-web-01]$ dashboard", TERMINAL_CLEAR_MARKER, "oneX", "two"]);
});

test("formatInteractiveSessionLines erases screen content after the cursor with ANSI erase-display", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "dashboard", "\u001b[2J\u001b[HTitle\u001b[1EStale\u001b[1FNew\u001b[J\n");

  assert.deepEqual(lines, ["[prod-web-01]$ dashboard", TERMINAL_CLEAR_MARKER, "New"]);
});

test("formatInteractiveSessionLines erases characters at the cursor with ANSI erase-character", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "prompt", "abcdef\u001b[3D\u001b[2X\n");

  assert.deepEqual(lines, ["[prod-web-01]$ prompt", "abc  f"]);
});

test("formatInteractiveSessionLines deletes characters at the cursor with ANSI delete-character", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "prompt", "abcdef\u001b[3D\u001b[2P\n");

  assert.deepEqual(lines, ["[prod-web-01]$ prompt", "abcf"]);
});

test("formatInteractiveSessionLines inserts blank characters at the cursor with ANSI insert-character", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "prompt", "abcdef\u001b[3D\u001b[2@\n");

  assert.deepEqual(lines, ["[prod-web-01]$ prompt", "abc  def"]);
});

test("formatInteractiveSessionLines inserts visible rows with ANSI insert-line", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "menu", "\u001b[2J\u001b[Hone\u001b[2;1Htwo\u001b[3;1Hthree\u001b[2;1H\u001b[Linserted\n");

  assert.deepEqual(lines, ["[prod-web-01]$ menu", TERMINAL_CLEAR_MARKER, "one", "inserted", "two", "three"]);
});

test("formatInteractiveSessionLines deletes visible rows with ANSI delete-line", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "menu", "\u001b[2J\u001b[Hone\u001b[2;1Htwo\u001b[3;1Hthree\u001b[2;1H\u001b[M\n");

  assert.deepEqual(lines, ["[prod-web-01]$ menu", TERMINAL_CLEAR_MARKER, "one", "three"]);
});

test("formatInteractiveSessionLines scrolls visible rows up with ANSI scroll-up", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "log", "\u001b[2J\u001b[Hone\u001b[2;1Htwo\u001b[3;1Hthree\u001b[2F\u001b[SNEW\n");

  assert.deepEqual(lines, ["[prod-web-01]$ log", TERMINAL_CLEAR_MARKER, "NEW", "three"]);
});

test("formatInteractiveSessionLines scrolls visible rows down with ANSI scroll-down", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "log", "\u001b[2J\u001b[Hone\u001b[2;1Htwo\u001b[3;1Hthree\u001b[2F\u001b[TNEW\n");

  assert.deepEqual(lines, ["[prod-web-01]$ log", TERMINAL_CLEAR_MARKER, "NEW", "one", "two", "three"]);
});

test("appendTerminalOutputState clears the current visible line for ANSI erase-line updates", () => {
  const first = appendTerminalOutputState({ lines: [], openLine: false }, formatInteractiveSessionLines("prod-web-01", "", "Downloading 10%\n").slice(1), 50);
  const second = appendTerminalOutputState(first, formatInteractiveSessionLines("prod-web-01", "", "\u001b[2KDownloading 20%\n").slice(1), 50);

  assert.deepEqual(second, { lines: ["Downloading 20%"], openLine: false });
});

test("appendTerminalOutputState supports shorthand ANSI erase-line updates", () => {
  const first = appendTerminalOutputState({ lines: [], openLine: false }, formatInteractiveSessionLines("prod-web-01", "", "Downloading 10%\n").slice(1), 50);
  const second = appendTerminalOutputState(first, formatInteractiveSessionLines("prod-web-01", "", "\u001b[KDownloading 20%\n").slice(1), 50);
  const third = appendTerminalOutputState(second, formatInteractiveSessionLines("prod-web-01", "", "\u001b[0KDownloading 30%\n").slice(1), 50);

  assert.deepEqual(third, { lines: ["Downloading 30%"], openLine: false });
});

test("appendTerminalOutputState applies backspace updates split across SSH stream chunks", () => {
  const first = appendTerminalOutputState({ lines: [], openLine: false }, formatInteractiveSessionLines("prod-web-01", "", "Load |").slice(1), 50);
  const second = appendTerminalOutputState(first, formatInteractiveSessionLines("prod-web-01", "", "\b/").slice(1), 50);

  assert.deepEqual(second, { lines: ["Load /"], openLine: true });
});

test("appendTerminalOutputState applies cursor-left overwrite split across SSH stream chunks", () => {
  const first = appendTerminalOutputState({ lines: [], openLine: false }, formatInteractiveSessionLines("prod-web-01", "", "abc").slice(1), 50);
  const second = appendTerminalOutputState(first, formatInteractiveSessionLines("prod-web-01", "", "\u001b[2DXY\n").slice(1), 50);

  assert.deepEqual(second, { lines: ["aXY"], openLine: false });
});

test("appendTerminalOutputState applies cursor-left erase-right split across SSH stream chunks", () => {
  const first = appendTerminalOutputState({ lines: [], openLine: false }, formatInteractiveSessionLines("prod-web-01", "", "abcdef").slice(1), 50);
  const second = appendTerminalOutputState(first, formatInteractiveSessionLines("prod-web-01", "", "\u001b[3D\u001b[KXY\n").slice(1), 50);

  assert.deepEqual(second, { lines: ["abcXY"], openLine: false });
});

test("appendTerminalOutputState applies cursor-column overwrite split across SSH stream chunks", () => {
  const first = appendTerminalOutputState({ lines: [], openLine: false }, formatInteractiveSessionLines("prod-web-01", "", "abcdef").slice(1), 50);
  const second = appendTerminalOutputState(first, formatInteractiveSessionLines("prod-web-01", "", "\u001b[1GXY\n").slice(1), 50);
  const third = appendTerminalOutputState(first, formatInteractiveSessionLines("prod-web-01", "", "\u001b[4`Z\n").slice(1), 50);

  assert.deepEqual(second, { lines: ["XYcdef"], openLine: false });
  assert.deepEqual(third, { lines: ["abcZef"], openLine: false });
});

test("formatInteractiveSessionLines applies inline backspace erase sequences", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "", "abc\b \bdone\n").slice(1);

  assert.deepEqual(lines, ["abdone"]);
});

test("formatInteractiveSessionLines applies inline cursor-left overwrite sequences", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "", "abc\u001b[2DXY\n").slice(1);

  assert.deepEqual(lines, ["aXY"]);
});

test("formatInteractiveSessionLines applies inline cursor-column overwrite sequences", () => {
  const firstColumn = formatInteractiveSessionLines("prod-web-01", "", "abc\u001b[1GXY\n").slice(1);
  const secondColumn = formatInteractiveSessionLines("prod-web-01", "", "abc\u001b[2`XY\n").slice(1);

  assert.deepEqual(firstColumn, ["XYc"]);
  assert.deepEqual(secondColumn, ["aXY"]);
});

test("formatInteractiveSessionLines applies ANSI erase-left inline sequences", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "", "abcdef\u001b[3D\u001b[1KXY\n").slice(1);

  assert.deepEqual(lines, ["   XYf"]);
});

test("formatInteractiveSessionLines applies ANSI erase-right inline sequences", () => {
  const shorthand = formatInteractiveSessionLines("prod-web-01", "", "abcdef\u001b[3D\u001b[KXY\n").slice(1);
  const explicit = formatInteractiveSessionLines("prod-web-01", "", "abcdef\u001b[3D\u001b[0KXY\n").slice(1);

  assert.deepEqual(shorthand, ["abcXY"]);
  assert.deepEqual(explicit, ["abcXY"]);
});

test("formatInteractiveSessionLines applies ANSI erase-entire-line inline sequences", () => {
  const lines = formatInteractiveSessionLines("prod-web-01", "", "abcdef\u001b[3D\u001b[2KXY\n").slice(1);

  assert.deepEqual(lines, ["   XY"]);
});

test("parseAnsiLineSegments maps common SGR colors and styles", () => {
  const segments = parseAnsiLineSegments("normal \u001b[1;31mERROR\u001b[0m \u001b[4;36mlink\u001b[0m \u001b[30;43mWARN\u001b[0m");

  assert.deepEqual(segments, [
    { text: "normal ", className: "" },
    { text: "ERROR", className: "ansi-bold ansi-fg-red" },
    { text: " ", className: "" },
    { text: "link", className: "ansi-underline ansi-fg-cyan" },
    { text: " ", className: "" },
    { text: "WARN", className: "ansi-fg-black ansi-bg-yellow" },
  ]);
});

test("parseAnsiLineSegments maps common SGR text effects", () => {
  const segments = parseAnsiLineSegments("\u001b[2mdim\u001b[22m plain \u001b[3mitalic\u001b[23m \u001b[9mdeleted\u001b[29m normal");

  assert.deepEqual(segments, [
    { text: "dim", className: "ansi-dim" },
    { text: " plain ", className: "" },
    { text: "italic", className: "ansi-italic" },
    { text: " ", className: "" },
    { text: "deleted", className: "ansi-strikethrough" },
    { text: " normal", className: "" },
  ]);
});

test("parseAnsiLineSegments maps blink and conceal SGR text effects", () => {
  const segments = parseAnsiLineSegments("\u001b[5mblink\u001b[25m visible \u001b[8msecret\u001b[28m shown");

  assert.deepEqual(segments, [
    { text: "blink", className: "ansi-blink" },
    { text: " visible ", className: "" },
    { text: "secret", className: "ansi-conceal" },
    { text: " shown", className: "" },
  ]);
});

test("parseAnsiLineSegments resets ANSI background colors independently", () => {
  const segments = parseAnsiLineSegments("\u001b[41mred bg\u001b[49m plain");

  assert.deepEqual(segments, [
    { text: "red bg", className: "ansi-bg-red" },
    { text: " plain", className: "" },
  ]);
});

test("parseAnsiLineSegments maps and resets ANSI inverse video", () => {
  const segments = parseAnsiLineSegments("\u001b[7mselected\u001b[27m normal");

  assert.deepEqual(segments, [
    { text: "selected", className: "ansi-inverse" },
    { text: " normal", className: "" },
  ]);
});

test("parseAnsiLineSegments maps ANSI 256 color and truecolor safely", () => {
  const segments = parseAnsiLineSegments("\u001b[38;5;196mhot\u001b[0m \u001b[48;5;25mblue bg\u001b[0m \u001b[38;2;12;34;56mtrue\u001b[0m");

  assert.deepEqual(segments, [
    { text: "hot", className: "", style: { color: "rgb(255,0,0)" } },
    { text: " ", className: "" },
    { text: "blue bg", className: "", style: { backgroundColor: "rgb(0,95,175)" } },
    { text: " ", className: "" },
    { text: "true", className: "", style: { color: "rgb(12,34,56)" } },
  ]);
});

test("highlightTerminalSearchSegments preserves extended ANSI color styles", () => {
  const segments = highlightTerminalSearchSegments("\u001b[38;2;12;34;56mERROR\u001b[0m", "err");

  assert.deepEqual(segments, [
    { text: "ERR", className: "terminal-search-hit", style: { color: "rgb(12,34,56)" } },
    { text: "OR", className: "", style: { color: "rgb(12,34,56)" } },
  ]);
});

test("parseAnsiLineSegments preserves safe OSC 8 terminal hyperlinks", () => {
  const rawLine = "文档: \u001b]8;;https://docs.example.com/runbook\u0007排障手册\u001b]8;;\u0007";
  const lines = formatInteractiveSessionLines("prod-web-01", "", `${rawLine}\n`).slice(1);

  assert.deepEqual(parseAnsiLineSegments(lines[0]), [
    { text: "文档: ", className: "" },
    { text: "排障手册", className: "terminal-link", href: "https://docs.example.com/runbook" },
  ]);
  assert.equal(formatTerminalClipboardText(lines), "文档: 排障手册");
});

test("parseAnsiLineSegments ignores unsafe OSC 8 terminal hyperlinks", () => {
  const segments = parseAnsiLineSegments("\u001b]8;;javascript:alert(1)\u0007点我\u001b]8;;\u0007");

  assert.deepEqual(segments, [{ text: "点我", className: "" }]);
});

test("parseAnsiLineSegments auto-links plain http urls without swallowing punctuation", () => {
  const segments = parseAnsiLineSegments("文档 https://docs.example.com/runbook, 状态 https://status.example.com.");

  assert.deepEqual(segments, [
    { text: "文档 ", className: "" },
    { text: "https://docs.example.com/runbook", className: "terminal-link", href: "https://docs.example.com/runbook" },
    { text: ", 状态 ", className: "" },
    { text: "https://status.example.com", className: "terminal-link", href: "https://status.example.com" },
    { text: ".", className: "" },
  ]);
});

test("parseAnsiLineSegments keeps ANSI styling on auto-linked plain urls", () => {
  const segments = parseAnsiLineSegments("\u001b[31mhttps://errors.example.com/502\u001b[0m");

  assert.deepEqual(segments, [
    { text: "https://errors.example.com/502", className: "ansi-fg-red terminal-link", href: "https://errors.example.com/502" },
  ]);
});

test("highlightTerminalSearchSegments marks matching visible text", () => {
  const segments = highlightTerminalSearchSegments("nginx ERROR nginx", "nginx");

  assert.deepEqual(segments, [
    { text: "nginx", className: "terminal-search-hit" },
    { text: " ERROR ", className: "" },
    { text: "nginx", className: "terminal-search-hit" },
  ]);
});

test("highlightTerminalSearchSegments marks matches split by ANSI styling", () => {
  const segments = highlightTerminalSearchSegments("\u001b[31mERR\u001b[0mOR nginx failed", "error");

  assert.deepEqual(segments, [
    { text: "ERR", className: "ansi-fg-red terminal-search-hit" },
    { text: "OR", className: "terminal-search-hit" },
    { text: " nginx failed", className: "" },
  ]);
});

test("buildVisibleTerminalLines hides base lines and old appends after clear marker", () => {
  const lines = buildVisibleTerminalLines({
    baseLines: ["base uptime", "base df"],
    appendedLines: ["first command", "second command", "third command"],
    clearIndex: 2,
  });

  assert.deepEqual(lines, ["third command"]);
});

test("buildVisibleTerminalLines keeps base and appended lines before clear", () => {
  const lines = buildVisibleTerminalLines({
    baseLines: ["base uptime"],
    appendedLines: ["new command"],
    clearIndex: null,
  });

  assert.deepEqual(lines, ["base uptime", "new command"]);
});

test("buildVisibleTerminalLines can clear before any appended output", () => {
  const lines = buildVisibleTerminalLines({
    baseLines: ["base uptime"],
    appendedLines: ["new command"],
    clearIndex: 0,
  });

  assert.deepEqual(lines, ["new command"]);
});

test("buildTerminalSearchState finds case insensitive terminal matches", () => {
  const result = buildTerminalSearchState(["nginx.service active", "php-fpm running", "NGINX error log"], "nginx", 0);

  assert.equal(result.query, "nginx");
  assert.deepEqual(result.matchIndexes, [0, 2]);
  assert.equal(result.currentIndex, 0);
  assert.equal(result.currentLineIndex, 0);
  assert.equal(result.total, 2);
});

test("buildTerminalSearchState counts repeated matches on the same line", () => {
  const result = buildTerminalSearchState(["nginx nginx active", "NGINX error log"], "nginx", 1);

  assert.deepEqual(result.matchIndexes, [0, 1]);
  assert.deepEqual(result.matches.map((match) => match.lineIndex), [0, 0, 1]);
  assert.equal(result.currentIndex, 1);
  assert.equal(result.currentLineIndex, 0);
  assert.equal(result.total, 3);
});

test("buildTerminalSearchState searches visible text across ANSI style boundaries", () => {
  const result = buildTerminalSearchState(["\u001b[31mERR\u001b[0mOR nginx failed", "ok"], "error", 0);

  assert.deepEqual(result.matchIndexes, [0]);
  assert.equal(result.currentLineIndex, 0);
  assert.equal(result.total, 1);
});

test("buildTerminalSearchState wraps selected match cursor", () => {
  const result = buildTerminalSearchState(["error one", "ok", "error two"], "error", 3);

  assert.equal(result.currentIndex, 1);
  assert.equal(result.currentLineIndex, 2);
  assert.equal(result.total, 2);
});

test("formatTerminalClipboardText strips ANSI control sequences from copied output", () => {
  const content = formatTerminalClipboardText(["\u001b[31mERROR\u001b[0m nginx failed", "plain line"]);

  assert.equal(content, "ERROR nginx failed\nplain line");
});

test("formatTerminalClipboardText strips terminal reset controls from copied output", () => {
  const content = formatTerminalClipboardText(["before\u001bcafter"]);

  assert.equal(content, "beforeafter");
});

test("formatTerminalClipboardText strips terminal private string controls from copied output", () => {
  const content = formatTerminalClipboardText(["before\u001bPtmux;ignored\u001b\\after"]);

  assert.equal(content, "beforeafter");
});

test("formatTerminalClipboardText honors recent output limits before stripping controls", () => {
  const content = formatTerminalClipboardText(["old", "\u001b[32mok\u001b[0m", "new"], 2);

  assert.equal(content, "ok\nnew");
});

test("formatTerminalSelectionText cleans selected terminal text for clipboard use", () => {
  const content = formatTerminalSelectionText(" \u001b[31mERROR\u001b[0m nginx failed  \r\nnext line\t \n\n");

  assert.equal(content, "ERROR nginx failed\nnext line");
  assert.equal(formatTerminalSelectionText(" \n\t "), "");
});

test("extractTerminalCommandFromLine returns editable commands from terminal prompts", () => {
  assert.equal(extractTerminalCommandFromLine("[prod-web-01]$ df -hT"), "df -hT");
  assert.equal(extractTerminalCommandFromLine("[root@prod-web-01 ~]# journalctl -u nginx -n 100"), "journalctl -u nginx -n 100");
  assert.equal(extractTerminalCommandFromLine("$ uptime"), "uptime");
  assert.equal(extractTerminalCommandFromLine("# systemctl --failed"), "systemctl --failed");
  assert.equal(extractTerminalCommandFromLine("[prod-web-01]$ "), "");
  assert.equal(extractTerminalCommandFromLine("nginx.service loaded active running"), "");
});

test("buildTerminalCommandOutputBlock returns a command and its following output", () => {
  const lines = [
    "[root@prod-web-01 ~]# uptime",
    "17:42:11 up 23 days",
    "",
    "[root@prod-web-01 ~]# df -hT",
    "Filesystem Type Size Used Avail Use% Mounted on",
    "/dev/sda1 xfs 50G 18G 32G 37% /",
    "[root@prod-web-01 ~]# free -h",
    "Mem: 7.8Gi 3.2Gi 1.1Gi",
  ];

  assert.deepEqual(buildTerminalCommandOutputBlock(lines, 3), [
    "[root@prod-web-01 ~]# df -hT",
    "Filesystem Type Size Used Avail Use% Mounted on",
    "/dev/sda1 xfs 50G 18G 32G 37% /",
  ]);
  assert.deepEqual(buildTerminalCommandOutputBlock(lines, 4), []);
  assert.deepEqual(buildTerminalCommandOutputBlock(lines, -1), []);
});

test("buildTerminalExportFileName creates a safe dated terminal transcript name", () => {
  assert.equal(typeof terminalOutput.buildTerminalExportFileName, "function");
  const date = new Date("2026-06-28T01:40:05.000Z");

  assert.equal(terminalOutput.buildTerminalExportFileName("prod/web:01", date), "ssh-terminal-prod-web-01-2026-06-28-01-40-05.txt");
  assert.equal(terminalOutput.buildTerminalExportFileName("", date), "ssh-terminal-session-2026-06-28-01-40-05.txt");
});

test("buildTerminalExportText strips terminal controls and includes a readable header", () => {
  assert.equal(typeof terminalOutput.buildTerminalExportText, "function");
  const date = new Date("2026-06-28T01:40:05.000Z");
  const content = terminalOutput.buildTerminalExportText("prod-web-01", ["\u001b[31mERROR\u001b[0m nginx failed", "plain line"], date);

  assert.match(content, /^# SSH 终端输出/);
  assert.match(content, /服务器: prod-web-01/);
  assert.match(content, /导出时间: 2026-06-28 01:40:05/);
  assert.match(content, /ERROR nginx failed\nplain line$/);
  assert.doesNotMatch(content, /\u001b/);
});
