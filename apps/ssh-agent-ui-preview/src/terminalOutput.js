export const TERMINAL_CLEAR_MARKER = "\u0000SSH_AGENT_CLEAR_SCREEN\u0000";
export const TERMINAL_REWRITE_LINE_MARKER = "\u0000SSH_AGENT_REWRITE_LINE\u0000";
const TERMINAL_CLEAR_NOTICE = "# 远程程序已清屏，正在等待新的终端输出...";
const TERMINAL_OPEN_LINE_MARKER = "\u0000SSH_AGENT_OPEN_LINE\u0000";
const TERMINAL_LINE_BREAK_MARKER = "\u0000SSH_AGENT_LINE_BREAK\u0000";
const TERMINAL_REWRITE_VISIBLE_LINE_MARKER = "\u0000SSH_AGENT_REWRITE_VISIBLE_LINE\u0000";
const TERMINAL_CURSOR_LEFT_PREFIX = "\u0000SSH_AGENT_CURSOR_LEFT:";
const TERMINAL_CURSOR_COLUMN_PREFIX = "\u0000SSH_AGENT_CURSOR_COLUMN:";
const TERMINAL_ERASE_RIGHT_MARKER = "\u0000SSH_AGENT_ERASE_RIGHT\u0000";
const TERMINAL_TRUNCATION_NOTICE_PREFIX = "# 已截断前 ";
const MAX_INLINE_TERMINAL_ROWS = 200;
const MAX_INLINE_TERMINAL_COLUMNS = 500;
const MAX_INLINE_TERMINAL_CURSOR_COLUMN = MAX_INLINE_TERMINAL_COLUMNS - 20;

export function formatSshCommandResults(serverName, results) {
  return (results || []).flatMap((result) => {
    const lines = [`[${serverName}]$ ${result.command || ""}`];
    lines.push(...formatParsedOutput(result.stdout));
    lines.push(...formatParsedOutput(result.stderr));
    return lines;
  });
}

export function formatInteractiveSessionLines(serverName, command, output) {
  const safeCommand = String(command || "").trim();
  return [`[${serverName}]$ ${safeCommand}`, ...formatParsedOutput(output, { allowRewrite: !safeCommand })];
}

export function stripSubmittedCommandEcho(output = "", command = "") {
  const text = String(output || "");
  const expected = String(command || "").trim();
  if (!text || !expected) return text;

  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  let echoLineIndex = 0;
  while (echoLineIndex < lines.length && !stripAnsi(lines[echoLineIndex]).trim()) echoLineIndex += 1;
  const firstLine = lines[echoLineIndex] || "";
  if (!firstLineEchoesSubmittedCommand(firstLine, expected)) return text;
  return lines.slice(echoLineIndex + 1).join("\n");
}

function firstLineEchoesSubmittedCommand(line = "", expected = "") {
  const visibleLine = stripAnsi(String(line || "")).trim();
  if (visibleLine === expected) return true;
  const escapedExpected = escapeRegExp(expected);
  const bracketPrompt = String.raw`\[[^\]]+\]`;
  const userHostPrompt = String.raw`[^\s$#>%]+@[^\s$#>%]+(?::[^\s$#>%]*)?`;
  return new RegExp(String.raw`^(?:${bracketPrompt}|${userHostPrompt})\s*[$#>%]\s*${escapedExpected}$`).test(visibleLine);
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractTerminalCommandFromLine(line = "") {
  const visibleLine = stripAnsi(String(line || "")).trim();
  if (!visibleLine) return "";

  const bracketPromptMatch = visibleLine.match(/^\[[^\]]+\]\s*[$#]\s+(.+)$/);
  if (bracketPromptMatch) return bracketPromptMatch[1].trim();

  const shellPromptMatch = visibleLine.match(/^[$#]\s+(.+)$/);
  if (shellPromptMatch) return shellPromptMatch[1].trim();

  return "";
}

export function buildTerminalCommandOutputBlock(lines = [], lineIndex = -1) {
  const safeLines = Array.isArray(lines) ? lines : [];
  const startIndex = Number(lineIndex);
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= safeLines.length) return [];
  if (!extractTerminalCommandFromLine(safeLines[startIndex])) return [];

  const block = [];
  for (let index = startIndex; index < safeLines.length; index += 1) {
    if (index > startIndex && extractTerminalCommandFromLine(safeLines[index])) break;
    block.push(safeLines[index]);
  }
  return block;
}

export function appendTerminalOutputLines(currentLines = [], incomingLines = [], limit = 1000) {
  return appendTerminalOutputState({ lines: currentLines, openLine: false }, incomingLines, limit).lines;
}

export function appendTerminalOutputState(currentState = {}, incomingLines = [], limit = 1000) {
  const safeIncoming = Array.isArray(incomingLines) ? incomingLines : [];
  const nextLines = [...(Array.isArray(currentState.lines) ? currentState.lines : [])];
  const safeLimit = Math.max(1, Number(limit) || 1000);
  let openLine = Boolean(currentState.openLine && nextLines.length);
  let rewriteNextLine = 0;
  let forceNewLine = false;
  let pendingCursorLeft = Math.max(0, Number(currentState.cursorLeft) || 0);
  let pendingCursorColumn = 0;
  let pendingEraseRight = false;
  let cursorLeft = pendingCursorLeft;

  safeIncoming.forEach((line) => {
    if (line === TERMINAL_CLEAR_MARKER) {
      nextLines.length = 0;
      nextLines.push(TERMINAL_CLEAR_NOTICE);
      openLine = false;
      rewriteNextLine = 0;
      forceNewLine = false;
      pendingCursorLeft = 0;
      pendingCursorColumn = 0;
      pendingEraseRight = false;
      cursorLeft = 0;
      return;
    }
    if (line === TERMINAL_REWRITE_LINE_MARKER) {
      rewriteNextLine = Math.max(rewriteNextLine, 1);
      return;
    }
    if (line === TERMINAL_REWRITE_VISIBLE_LINE_MARKER) {
      rewriteNextLine += 1;
      openLine = false;
      forceNewLine = false;
      return;
    }
    if (line === TERMINAL_LINE_BREAK_MARKER) {
      openLine = false;
      forceNewLine = true;
      return;
    }
    if (line === TERMINAL_OPEN_LINE_MARKER) {
      openLine = nextLines.length > 0;
      return;
    }
    if (line === TERMINAL_ERASE_RIGHT_MARKER) {
      pendingEraseRight = true;
      return;
    }
    if (String(line || "").startsWith(TERMINAL_CURSOR_LEFT_PREFIX)) {
      pendingCursorLeft = Math.max(0, Number.parseInt(String(line).slice(TERMINAL_CURSOR_LEFT_PREFIX.length), 10) || 0);
      cursorLeft = pendingCursorLeft;
      return;
    }
    if (String(line || "").startsWith(TERMINAL_CURSOR_COLUMN_PREFIX)) {
      pendingCursorColumn = Math.max(1, Number.parseInt(String(line).slice(TERMINAL_CURSOR_COLUMN_PREFIX.length), 10) || 1);
      pendingCursorLeft = 0;
      cursorLeft = 0;
      return;
    }
    if (rewriteNextLine) {
      const rewriteCount = Math.min(rewriteNextLine, nextLines.length);
      nextLines.splice(nextLines.length - rewriteCount, rewriteCount);
      openLine = false;
      rewriteNextLine = 0;
    }
    if (nextLines.length === 1 && nextLines[0] === TERMINAL_CLEAR_NOTICE && !String(line || "").trim()) {
      openLine = false;
      forceNewLine = false;
      pendingCursorLeft = 0;
      pendingCursorColumn = 0;
      pendingEraseRight = false;
      cursorLeft = 0;
      return;
    }
    if (nextLines.length === 1 && nextLines[0] === TERMINAL_CLEAR_NOTICE) {
      nextLines.length = 0;
    }
    if (openLine && !forceNewLine && nextLines.length) {
      const cursorPrefix = pendingCursorColumn > 0 ? `\u001b[${pendingCursorColumn}G` : pendingCursorLeft > 0 ? `\u001b[${pendingCursorLeft}D` : "";
      const eraseRightPrefix = pendingEraseRight ? "\u001b[K" : "";
      nextLines[nextLines.length - 1] = applyBackspaceCharacters(applyInlineCursorPositioning(`${nextLines[nextLines.length - 1]}${cursorPrefix}${eraseRightPrefix}${line}`));
    } else {
      nextLines.push(applyBackspaceCharacters(line));
    }
    openLine = false;
    forceNewLine = false;
    pendingCursorLeft = 0;
    pendingCursorColumn = 0;
    pendingEraseRight = false;
    cursorLeft = 0;
  });

  const limitedLines = limitTerminalOutputLines(nextLines, safeLimit);
  const nextState = { lines: limitedLines, openLine: openLine && limitedLines.length > 0 };
  if (nextState.openLine && cursorLeft > 0) nextState.cursorLeft = cursorLeft;
  return nextState;
}

function limitTerminalOutputLines(lines = [], limit = 1000) {
  const safeLines = Array.isArray(lines) ? lines : [];
  if (safeLines.length <= limit) return safeLines;
  if (limit <= 1) return [`${TERMINAL_TRUNCATION_NOTICE_PREFIX}${safeLines.length} 行终端输出，仅保留最新内容。`];

  const keptOutputCount = limit - 1;
  const droppedCount = Math.max(1, safeLines.length - keptOutputCount);
  return [
    `${TERMINAL_TRUNCATION_NOTICE_PREFIX}${droppedCount} 行终端输出，仅保留最新 ${keptOutputCount} 行。`,
    ...safeLines.slice(-keptOutputCount),
  ];
}

export function buildVisibleTerminalLines({ baseLines = [], appendedLines = [], clearIndex = 0 } = {}) {
  if (clearIndex !== null && clearIndex !== undefined) {
    const appendStart = Math.max(0, Number(clearIndex) || 0);
    return appendedLines.slice(appendStart);
  }
  return [...baseLines, ...appendedLines];
}

export function buildTerminalSearchState(lines = [], query = "", cursor = 0) {
  const nextQuery = String(query || "");
  const normalizedQuery = nextQuery.trim().toLowerCase();
  const safeLines = Array.isArray(lines) ? lines : [];
  if (!normalizedQuery) {
    return { query: nextQuery, matchIndexes: [], matches: [], currentIndex: -1, currentLineIndex: -1, total: 0 };
  }

  const matches = safeLines.flatMap((line, lineIndex) => buildLineSearchMatches(line, normalizedQuery, lineIndex));
  const matchIndexes = [...new Set(matches.map((match) => match.lineIndex))];
  if (matches.length === 0) {
    return { query: nextQuery, matchIndexes, matches, currentIndex: -1, currentLineIndex: -1, total: 0 };
  }

  const currentIndex = wrapIndex(Number(cursor) || 0, matches.length);
  return {
    query: nextQuery,
    matchIndexes,
    matches,
    currentIndex,
    currentLineIndex: matches[currentIndex]?.lineIndex ?? -1,
    total: matches.length,
  };
}

function buildLineSearchMatches(line, normalizedQuery, lineIndex) {
  const visibleLine = stripAnsi(line);
  const lowerLine = visibleLine.toLowerCase();
  const matches = [];
  let cursor = 0;
  while (cursor < lowerLine.length) {
    const index = lowerLine.indexOf(normalizedQuery, cursor);
    if (index < 0) break;
    matches.push({ lineIndex, start: index, end: index + normalizedQuery.length });
    cursor = index + normalizedQuery.length;
  }
  return matches;
}

export function formatTerminalClipboardText(lines = [], limit = null) {
  const safeLines = Array.isArray(lines) ? lines : [];
  const copiedLines = limit ? safeLines.slice(-limit) : safeLines;
  return copiedLines.map((line) => stripAnsi(line).trimEnd()).join("\n");
}

export function formatTerminalSelectionText(selectionText = "") {
  return stripAnsi(String(selectionText || ""))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

export function getTerminalControlModeUpdate(output = "") {
  const text = String(output || "");
  const bracketedPastePattern = /\u001b\[\?2004([hl])/g;
  let bracketedPaste = null;
  let match;
  while ((match = bracketedPastePattern.exec(text))) {
    bracketedPaste = match[1] === "h";
  }
  const title = extractTerminalTitle(text);
  const cwd = extractTerminalCwd(text);
  return {
    bracketedPaste,
    ...(title ? { title } : {}),
    ...(cwd ? { cwd } : {}),
  };
}

export function wrapBracketedPasteText(text = "", enabled = false) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return enabled ? `\u001b[200~${normalized}\u001b[201~` : normalized;
}

export function buildTerminalExportFileName(serverName = "", now = new Date()) {
  const safeName = String(serverName || "session")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "session";
  return `ssh-terminal-${safeName}-${formatExportTimestamp(now).replace(/ /g, "-").replace(/:/g, "-")}.txt`;
}

export function buildTerminalExportText(serverName = "", lines = [], now = new Date()) {
  const title = "# SSH 终端输出";
  const safeServerName = String(serverName || "当前会话").trim() || "当前会话";
  const body = formatTerminalClipboardText(lines).trimEnd();
  return [
    title,
    `服务器: ${safeServerName}`,
    `导出时间: ${formatExportTimestamp(now)}`,
    "",
    body || "暂无终端输出。",
  ].join("\n");
}

function formatExportTimestamp(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join("-") + ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function splitOutput(value) {
  return translateVt100LineDrawing(String(value || ""))
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(collapseCarriageReturnLine)
    .map(applyInlineCursorPositioning)
    .flatMap((line) => String(line || "").split("\n"))
    .map(stripNonDisplayAnsi)
    .map((line) => applyBackspaceCharacters(line, { preserveLeading: true }))
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

const VT100_LINE_DRAWING_CHARS = {
  "`": "◆",
  a: "▒",
  f: "°",
  g: "±",
  h: "␤",
  i: "␋",
  j: "┘",
  k: "┐",
  l: "┌",
  m: "└",
  n: "┼",
  o: "⎺",
  p: "⎻",
  q: "─",
  r: "⎼",
  s: "⎽",
  t: "├",
  u: "┤",
  v: "┴",
  w: "┬",
  x: "│",
  y: "≤",
  z: "≥",
  "{": "π",
  "|": "≠",
  "}": "£",
  "~": "·",
};

function translateVt100LineDrawing(value) {
  const text = String(value || "");
  let lineDrawing = false;
  let output = "";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    const third = text[index + 2];
    if (char === "\u001b" && (next === "(" || next === ")") && (third === "0" || third === "B")) {
      lineDrawing = third === "0";
      index += 2;
      continue;
    }
    if (char === "\u000e") {
      lineDrawing = true;
      continue;
    }
    if (char === "\u000f") {
      lineDrawing = false;
      continue;
    }
    output += lineDrawing ? VT100_LINE_DRAWING_CHARS[char] || char : char;
  }

  return output;
}

function extractTerminalTitle(value = "") {
  const text = String(value || "");
  const titlePattern = /\u001b\](?:0|1|2);([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;
  let title = "";
  let match;
  while ((match = titlePattern.exec(text))) {
    title = String(match[1] || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  }
  return title.slice(0, 80);
}

function extractTerminalCwd(value = "") {
  const text = String(value || "");
  const cwdPattern = /\u001b\]7;file:\/\/[^\u0007\u001b/]*(\/[^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;
  let cwd = "";
  let match;
  while ((match = cwdPattern.exec(text))) {
    cwd = safeDecodeTerminalPath(match[1] || "");
  }
  return cwd.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 240);
}

function safeDecodeTerminalPath(value = "") {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function formatParsedOutput(value, { allowRewrite = false } = {}) {
  const parsed = parseTerminalOutput(value);
  return [
    ...(parsed.clearScreen ? [TERMINAL_CLEAR_MARKER] : []),
    ...(allowRewrite && parsed.rewriteFirstLine ? [TERMINAL_REWRITE_LINE_MARKER] : []),
    ...(allowRewrite && parsed.rewriteLineCount > 0 ? Array.from({ length: parsed.rewriteLineCount }, () => TERMINAL_REWRITE_VISIBLE_LINE_MARKER) : []),
    ...(allowRewrite && parsed.startsWithLineBreak ? [TERMINAL_LINE_BREAK_MARKER] : []),
    ...(allowRewrite && parsed.leadingCursorLeft > 0 ? [`${TERMINAL_CURSOR_LEFT_PREFIX}${parsed.leadingCursorLeft}\u0000`] : []),
    ...(allowRewrite && parsed.leadingCursorColumn > 0 ? [`${TERMINAL_CURSOR_COLUMN_PREFIX}${parsed.leadingCursorColumn}\u0000`] : []),
    ...(allowRewrite && parsed.leadingEraseRight ? [TERMINAL_ERASE_RIGHT_MARKER] : []),
    ...parsed.lines,
    ...(allowRewrite && parsed.openLine ? [TERMINAL_OPEN_LINE_MARKER] : []),
    ...(allowRewrite && parsed.trailingCursorLeft > 0 ? [`${TERMINAL_CURSOR_LEFT_PREFIX}${parsed.trailingCursorLeft}\u0000`] : []),
  ];
}

function parseTerminalOutput(value) {
  const { value: visibleValue, clearScreen } = sliceAfterLastClear(String(value || ""));
  const { value: leadingHomeValue, rewriteLineCount: homeRewriteLineCount } = sliceLeadingCursorHomeRewrite(visibleValue);
  const { value: leadingCursorValue, cursorLeft } = sliceLeadingCursorLeft(leadingHomeValue);
  const { value: leadingColumnValue, cursorColumn } = sliceLeadingCursorColumn(leadingCursorValue);
  const { value: leadingEraseRightValue, eraseRight } = sliceLeadingEraseRight(leadingColumnValue, cursorLeft > 0 || cursorColumn > 0);
  const { value: cursorValue, rewriteLineCount } = sliceTerminalLineRewriteControls(leadingEraseRightValue, { suppressLeadingEraseLineRewrite: cursorLeft > 0 || cursorColumn > 0 });
  const normalizedValue = leadingCursorValue.replace(/\r\n/g, "\n");
  const lines = splitOutput(cursorValue);
  const endsWithCarriageReturn = cursorValue.endsWith("\r") && !cursorValue.endsWith("\r\n");
  return {
    clearScreen,
    rewriteFirstLine: leadingCursorValue.startsWith("\r"),
    rewriteLineCount: Math.max(rewriteLineCount, homeRewriteLineCount),
    startsWithLineBreak: normalizedValue.startsWith("\n"),
    openLine: lines.length > 0 && !cursorValue.replace(/\r\n/g, "\n").endsWith("\n"),
    leadingCursorLeft: cursorLeft,
    leadingCursorColumn: cursorColumn,
    leadingEraseRight: eraseRight,
    trailingCursorLeft: endsWithCarriageReturn ? stripAnsi(lines[lines.length - 1] || "").length : 0,
    lines,
  };
}

function sliceAfterLastClear(value) {
  const clearPattern = /\u001b\[(?:(?:2|3)J|\?(?:47|1047|1049)[hl])/g;
  let clearScreen = false;
  let start = 0;
  let match;
  while ((match = clearPattern.exec(value))) {
    clearScreen = true;
    start = match.index + match[0].length;
  }
  const formFeedIndex = value.lastIndexOf("\u000c");
  if (formFeedIndex >= start) {
    clearScreen = true;
    start = formFeedIndex + 1;
  }
  const terminalResetIndex = value.lastIndexOf("\u001bc");
  if (terminalResetIndex >= start) {
    clearScreen = true;
    start = terminalResetIndex + 2;
  }
  return { value: value.slice(start), clearScreen };
}

function sliceLeadingCursorHomeRewrite(value) {
  const text = String(value || "");
  const match = /^\u001b\[(?:1;1)?H/.exec(text);
  if (!match) return { value: text, rewriteLineCount: 0 };

  const nextValue = text.slice(match[0].length);
  const visibleLineCount = splitOutput(nextValue).length;
  return {
    value: nextValue,
    rewriteLineCount: visibleLineCount > 1 ? visibleLineCount : 0,
  };
}

function collapseCarriageReturnLine(line) {
  const parts = String(line || "").split("\r");
  const lastPart = parts[parts.length - 1] || "";
  if (lastPart || parts.length <= 1) return lastPart;
  return parts[parts.length - 2] || "";
}

function applyBackspaceCharacters(line, { preserveLeading = false } = {}) {
  const chars = [];
  for (const char of String(line || "")) {
    if (char === "\b") {
      if (chars.length) {
        chars.pop();
      } else if (preserveLeading) {
        chars.push(char);
      }
    } else {
      chars.push(char);
    }
  }
  return chars.join("");
}

function sliceLeadingCursorLeft(value) {
  const text = String(value || "");
  const match = /^\u001b\[([0-9]*)D/.exec(text);
  if (!match) return { value: text, cursorLeft: 0 };
  return {
    value: text.slice(match[0].length),
    cursorLeft: Math.max(1, Number.parseInt(match[1], 10) || 1),
  };
}

function sliceLeadingCursorColumn(value) {
  const text = String(value || "");
  const match = /^\u001b\[([0-9]*)(G|`)/.exec(text);
  if (!match) return { value: text, cursorColumn: 0 };
  return {
    value: text.slice(match[0].length),
    cursorColumn: Math.max(1, Number.parseInt(match[1], 10) || 1),
  };
}

function sliceLeadingEraseRight(value, enabled = false) {
  const text = String(value || "");
  if (!enabled) return { value: text, eraseRight: false };
  const match = /^\u001b\[(0?)K/.exec(text);
  if (!match) return { value: text, eraseRight: false };
  return { value: text.slice(match[0].length), eraseRight: true };
}

function applyInlineCursorPositioning(line) {
  const text = String(line || "");
  const controlPattern = /\u001b\[([0-9;]*)([@ABCDEFG`IJKLMNPXHZSTfabdesu])/g;
  if (!controlPattern.test(text) && !/\u001b[78]/.test(text) && !text.includes("\t")) return text;

  const rows = [[]];
  let row = 0;
  let cursor = 0;
  let savedRow = 0;
  let savedCursor = 0;
  let index = 0;
  let pendingAnsi = "";
  controlPattern.lastIndex = 0;

  const clampRow = (value) => Math.min(Math.max(Number(value) || 0, 0), MAX_INLINE_TERMINAL_ROWS - 1);
  const clampCursor = (value) => Math.min(Math.max(Number(value) || 0, 0), MAX_INLINE_TERMINAL_CURSOR_COLUMN);
  const clampWriteCursor = (value) => Math.min(Math.max(Number(value) || 0, 0), MAX_INLINE_TERMINAL_COLUMNS);
  const boundedCount = (value, fallback = 1) => Math.min(Math.max(1, Number.parseInt(value, 10) || fallback), MAX_INLINE_TERMINAL_ROWS);
  const currentCells = () => {
    row = clampRow(row);
    while (rows.length <= row) rows.push([]);
    return rows[row];
  };
  const moveToNextTabStop = () => {
    cursor = clampCursor(Math.floor(cursor / 8 + 1) * 8);
  };
  const moveToPreviousTabStop = () => {
    cursor = clampCursor(Math.max(0, (Math.ceil(cursor / 8) - 1) * 8));
  };
  const writeVisibleCharacter = (char) => {
    const width = terminalCellWidth(char);
    if (width === 0) {
      if (cursor > 0) {
        currentCells()[cursor - 1] = `${currentCells()[cursor - 1] || ""}${pendingAnsi}${char}`;
      } else {
        currentCells()[cursor] = `${pendingAnsi}${char}`;
      }
      pendingAnsi = "";
      return;
    }
    currentCells()[cursor] = `${pendingAnsi}${char}`;
    pendingAnsi = "";
    for (let offset = 1; offset < width; offset += 1) {
      if (cursor + offset <= MAX_INLINE_TERMINAL_COLUMNS) currentCells()[cursor + offset] = "";
    }
    cursor = clampWriteCursor(cursor + width);
  };

  while (index < text.length) {
    if (text[index] === "\u001b") {
      const nextChar = text[index + 1];
      if (nextChar === "7") {
        savedRow = row;
        savedCursor = cursor;
        index += 2;
        continue;
      }
      if (nextChar === "8") {
        row = clampRow(savedRow);
        cursor = clampCursor(savedCursor);
        while (currentCells().length < cursor) currentCells().push(" ");
        index += 2;
        continue;
      }
      const csiMatch = /^\u001b\[([0-?]*)([ -/]*)([@-~])/.exec(text.slice(index));
      if (csiMatch) {
        const [sequence, params, intermediates, final] = csiMatch;
        if (!intermediates && (final === "C" || final === "D" || final === "G" || final === "`" || final === "a")) {
          const distance = Math.max(1, Number.parseInt(params, 10) || 1);
          if (final === "D") {
            cursor = clampCursor(cursor - distance);
          } else if (final === "C" || final === "a") {
            cursor = clampCursor(cursor + distance);
          } else {
            cursor = clampCursor(distance - 1);
          }
          while (currentCells().length < cursor) currentCells().push(" ");
        } else if (!intermediates && final === "A") {
          const distance = Math.max(1, Number.parseInt(params, 10) || 1);
          row = clampRow(row - distance);
          while (currentCells().length < cursor) currentCells().push(" ");
        } else if (!intermediates && final === "B") {
          const distance = Math.max(1, Number.parseInt(params, 10) || 1);
          row = clampRow(row + distance);
          while (currentCells().length < cursor) currentCells().push(" ");
        } else if (!intermediates && final === "E") {
          const distance = Math.max(1, Number.parseInt(params, 10) || 1);
          row = clampRow(row + distance);
          cursor = 0;
        } else if (!intermediates && final === "F") {
          const distance = Math.max(1, Number.parseInt(params, 10) || 1);
          row = clampRow(row - distance);
          cursor = 0;
        } else if (!intermediates && final === "I") {
          const count = boundedCount(params);
          for (let step = 0; step < count; step += 1) moveToNextTabStop();
          while (currentCells().length < cursor) currentCells().push(" ");
        } else if (!intermediates && final === "Z") {
          const count = boundedCount(params);
          for (let step = 0; step < count; step += 1) moveToPreviousTabStop();
          while (currentCells().length < cursor) currentCells().push(" ");
        } else if (!intermediates && final === "d") {
          const targetRow = Math.max(1, Number.parseInt(params, 10) || 1);
          row = clampRow(targetRow - 1);
          while (currentCells().length < cursor) currentCells().push(" ");
        } else if (!intermediates && final === "e") {
          const distance = Math.max(1, Number.parseInt(params, 10) || 1);
          row = clampRow(row + distance);
          while (currentCells().length < cursor) currentCells().push(" ");
        } else if (!intermediates && (final === "H" || final === "f")) {
          const [rowParam = "1", columnParam = "1"] = String(params || "").split(";");
          row = clampRow((Number.parseInt(rowParam, 10) || 1) - 1);
          cursor = clampCursor((Number.parseInt(columnParam, 10) || 1) - 1);
          while (currentCells().length < cursor) currentCells().push(" ");
        } else if (!intermediates && final === "s") {
          savedRow = row;
          savedCursor = cursor;
        } else if (!intermediates && final === "u") {
          row = clampRow(savedRow);
          cursor = clampCursor(savedCursor);
          while (currentCells().length < cursor) currentCells().push(" ");
        } else if (!intermediates && final === "J" && (String(params || "") === "" || String(params || "") === "0")) {
          currentCells().length = cursor;
          rows.length = row + 1;
        } else if (!intermediates && final === "J" && String(params || "") === "1") {
          for (let rowIndex = 0; rowIndex < row; rowIndex += 1) {
            rows[rowIndex] = [];
          }
          while (currentCells().length <= cursor) currentCells().push(" ");
          for (let cellIndex = 0; cellIndex <= cursor; cellIndex += 1) {
            currentCells()[cellIndex] = " ";
          }
        } else if (!intermediates && final === "J" && String(params || "") === "2") {
          rows.length = 1;
          rows[0] = [];
          row = 0;
          cursor = 0;
        } else if (!intermediates && final === "L") {
          const count = boundedCount(params);
          rows.splice(row, 0, ...Array.from({ length: count }, () => []));
          rows.length = Math.min(rows.length, MAX_INLINE_TERMINAL_ROWS);
        } else if (!intermediates && final === "M") {
          const count = boundedCount(params);
          rows.splice(row, count);
          currentCells();
        } else if (!intermediates && final === "S") {
          const count = boundedCount(params);
          rows.splice(0, count);
          currentCells();
        } else if (!intermediates && final === "T") {
          const count = boundedCount(params);
          rows.splice(0, 0, ...Array.from({ length: count }, () => []));
          rows.length = Math.min(rows.length, MAX_INLINE_TERMINAL_ROWS);
          currentCells();
        } else if (!intermediates && final === "K" && String(params || "") === "2") {
          currentCells().length = 0;
          while (currentCells().length < cursor) currentCells().push(" ");
        } else if (!intermediates && final === "K" && (String(params || "") === "" || String(params || "") === "0")) {
          currentCells().length = cursor;
        } else if (!intermediates && final === "K" && String(params || "") === "1") {
          while (currentCells().length <= cursor) currentCells().push(" ");
          for (let cellIndex = 0; cellIndex <= cursor; cellIndex += 1) {
            currentCells()[cellIndex] = " ";
          }
        } else if (!intermediates && final === "X") {
          const count = Math.min(Math.max(1, Number.parseInt(params, 10) || 1), MAX_INLINE_TERMINAL_COLUMNS);
          while (currentCells().length < cursor + count) currentCells().push(" ");
          for (let cellIndex = cursor; cellIndex < cursor + count; cellIndex += 1) {
            currentCells()[cellIndex] = " ";
          }
        } else if (!intermediates && final === "P") {
          const count = Math.min(Math.max(1, Number.parseInt(params, 10) || 1), MAX_INLINE_TERMINAL_COLUMNS);
          currentCells().splice(cursor, count);
        } else if (!intermediates && final === "@") {
          const count = Math.min(Math.max(1, Number.parseInt(params, 10) || 1), MAX_INLINE_TERMINAL_COLUMNS);
          while (currentCells().length < cursor) currentCells().push(" ");
          currentCells().splice(cursor, 0, ...Array.from({ length: count }, () => " "));
          currentCells().length = Math.min(currentCells().length, MAX_INLINE_TERMINAL_COLUMNS + 1);
        } else if (!intermediates && final === "b") {
          const count = Math.min(Math.max(1, Number.parseInt(params, 10) || 1), MAX_INLINE_TERMINAL_COLUMNS);
          const repeatedCell = currentCells()[cursor - 1] || "";
          if (repeatedCell) {
            for (let repeatIndex = 0; repeatIndex < count; repeatIndex += 1) {
              currentCells()[cursor] = repeatedCell;
              cursor = clampCursor(cursor + 1);
            }
          }
        } else {
          pendingAnsi += sequence;
        }
        index += sequence.length;
        continue;
      }
    }

    if (text[index] === "\t") {
      const targetCursor = Math.floor(cursor / 8 + 1) * 8;
      while (cursor < targetCursor) {
        currentCells()[cursor] = pendingAnsi ? `${pendingAnsi} ` : " ";
        pendingAnsi = "";
        cursor += 1;
      }
      index += 1;
      continue;
    }

    const codePoint = text.codePointAt(index);
    const char = String.fromCodePoint(codePoint);
    writeVisibleCharacter(char);
    index += char.length;
  }

  if (pendingAnsi) {
    currentCells()[cursor] = `${currentCells()[cursor] || ""}${pendingAnsi}`;
  }
  return rows.map((cells) => cells.join("")).join("\n");
}

function terminalCellWidth(char = "") {
  const codePoint = String(char || "").codePointAt(0);
  if (!codePoint) return 0;
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  ) {
    return 0;
  }
  if (
    codePoint >= 0x1100 && (
      codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f000 && codePoint <= 0x1faff)
    )
  ) {
    return 2;
  }
  return 1;
}

function sliceTerminalLineRewriteControls(value, { suppressLeadingEraseLineRewrite = false } = {}) {
  const text = String(value || "");
  const controlPattern = /\u001b\[([0-9]*)([AK])/g;
  let rewriteLineCount = 0;
  let match;
  while ((match = controlPattern.exec(text))) {
    const count = Math.max(1, Number.parseInt(match[1], 10) || 1);
    if (match[2] === "A" && !isRewriteCursorUpControl(text, match.index)) continue;
    if (match[2] === "K" && String(match[1] || "") === "1") continue;
    if (match[2] === "K" && suppressLeadingEraseLineRewrite && match.index === 0) continue;
    if (match[2] === "K" && !isRewriteEraseLineControl(text, match.index)) continue;
    rewriteLineCount = match[2] === "A" ? Math.max(rewriteLineCount, count) : Math.max(rewriteLineCount, 1);
  }
  return {
    value: text.replace(controlPattern, (sequence, params, final, offset) => {
      if (final === "A" && !isRewriteCursorUpControl(text, offset)) return sequence;
      if (final === "K" && suppressLeadingEraseLineRewrite && offset === 0) return sequence;
      if (final === "K" && (String(params || "") === "1" || !isRewriteEraseLineControl(text, offset))) return sequence;
      return "";
    }),
    rewriteLineCount,
  };
}

function isRewriteCursorUpControl(text, offset) {
  const prefix = String(text || "").slice(0, offset).replace(/\u001b\[[0-9]*A/g, "").replace(/\r/g, "");
  return prefix.length === 0;
}

function isRewriteEraseLineControl(text, offset) {
  const prefix = String(text || "").slice(0, offset).replace(/\u001b\[[0-9]*A/g, "").replace(/\r/g, "");
  return prefix.length === 0;
}

export function stripAnsi(value) {
  return String(value || "")
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b[PX^_][\s\S]*?(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[=>c]/g, "");
}

export function parseAnsiLineSegments(line = "") {
  const text = String(line || "");
  const segments = [];
  const terminalStylePattern = /\u001b\[([0-9;]*)m|\u001b\]8;[^\u0007\u001b;]*;([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;
  const state = createAnsiState();
  let cursor = 0;
  let match;

  while ((match = terminalStylePattern.exec(text))) {
    pushAnsiSegment(segments, text.slice(cursor, match.index), state);
    if (match[1] !== undefined) {
      applySgrCodes(state, match[1]);
    } else {
      state.href = normalizeTerminalLinkHref(match[2] || "");
    }
    cursor = terminalStylePattern.lastIndex;
  }
  pushAnsiSegment(segments, text.slice(cursor), state);

  return segments.length ? segments : [{ text: "", className: "" }];
}

export function highlightTerminalSearchSegments(line = "", query = "") {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const segments = parseAnsiLineSegments(line);
  if (!normalizedQuery) return segments;

  const matchRanges = buildSearchMatchRanges(segments.map((segment) => segment.text).join(""), normalizedQuery);
  if (!matchRanges.length) return segments;

  let offset = 0;
  return segments.flatMap((segment) => {
    const segmentStart = offset;
    offset += String(segment.text || "").length;
    return splitSegmentBySearchRanges(segment, segmentStart, matchRanges);
  });
}

function buildSearchMatchRanges(visibleText, normalizedQuery) {
  const ranges = [];
  const lowerText = String(visibleText || "").toLowerCase();
  let cursor = 0;
  while (cursor < lowerText.length) {
    const index = lowerText.indexOf(normalizedQuery, cursor);
    if (index < 0) break;
    ranges.push({ start: index, end: index + normalizedQuery.length });
    cursor = index + normalizedQuery.length;
  }
  return ranges;
}

function splitSegmentBySearchRanges(segment, segmentStart, matchRanges) {
  const text = String(segment?.text || "");
  if (!text) return [{ ...segment, text: "" }];

  const parts = [];
  let cursor = 0;
  while (cursor < text.length) {
    const absoluteCursor = segmentStart + cursor;
    const range = matchRanges.find((item) => item.end > absoluteCursor && item.start < segmentStart + text.length);
    if (!range) {
      parts.push(copySegmentMeta(segment, text.slice(cursor), segment.className || ""));
      break;
    }
    const matchStart = Math.max(cursor, range.start - segmentStart);
    const matchEnd = Math.min(text.length, range.end - segmentStart);
    if (matchStart > cursor) {
      parts.push(copySegmentMeta(segment, text.slice(cursor, matchStart), segment.className || ""));
    }
    parts.push(copySegmentMeta(segment, text.slice(matchStart, matchEnd), [segment.className || "", "terminal-search-hit"].filter(Boolean).join(" ")));
    cursor = matchEnd;
  }

  return parts.length ? parts : [{ text, className: segment.className || "" }];
}

function copySegmentMeta(segment, text, className) {
  return {
    text,
    className,
    ...(segment?.href ? { href: segment.href } : {}),
    ...(segment?.style ? { style: segment.style } : {}),
  };
}

function stripNonDisplayAnsi(value) {
  return String(value || "")
    .replace(/\u001b[PX^_][\s\S]*?(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\]([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g, (sequence, payload) => {
      const hyperlinkMatch = /^8;[^;]*;([\s\S]*)$/.exec(String(payload || ""));
      if (!hyperlinkMatch) return "";
      const rawHref = hyperlinkMatch[1] || "";
      if (!rawHref) return "\u001b]8;;\u001b\\";
      const href = normalizeTerminalLinkHref(rawHref);
      return href ? `\u001b]8;;${href}\u001b\\` : "";
    })
    .replace(/\u001b\[([0-?]*)([ -/]*)([@-~])/g, (match, params, intermediates, final) => {
      if (final === "m" && !intermediates && /^[0-9;]*$/.test(params)) return match;
      return "";
    })
    .replace(/\u001b[=>]/g, "")
    .replace(/[\u0000-\u0007\u000b\u000e-\u001a\u001c-\u001f\u007f]/g, "");
}

function pushAnsiSegment(segments, text, state) {
  if (!text) return;
  const className = [ansiClassName(state), state.href ? "terminal-link" : ""].filter(Boolean).join(" ");
  const style = ansiStyle(state);
  if (!state.href) {
    pushPlainTextLinkSegments(segments, text, className, style);
    return;
  }
  segments.push({
    text,
    className,
    ...(state.href ? { href: state.href } : {}),
    ...(style ? { style } : {}),
  });
}

function pushPlainTextLinkSegments(segments, text, className = "", style = null) {
  const value = String(text || "");
  const urlPattern = /https?:\/\/[^\s<>"']+/gi;
  let cursor = 0;
  let match;

  while ((match = urlPattern.exec(value))) {
    if (match.index > cursor) {
      appendTerminalSegment(segments, { text: value.slice(cursor, match.index), className, style });
    }

    const rawUrl = match[0] || "";
    const { href, suffix } = splitTerminalUrlSuffix(rawUrl);
    if (href) {
      appendTerminalSegment(segments, {
        text: href,
        className: [className, "terminal-link"].filter(Boolean).join(" "),
        href,
        style,
      });
    }
    if (suffix) {
      appendTerminalSegment(segments, { text: suffix, className, style });
    }
    cursor = match.index + rawUrl.length;
  }

  if (cursor < value.length) {
    appendTerminalSegment(segments, { text: value.slice(cursor), className, style });
  }
}

function appendTerminalSegment(segments, segment) {
  if (!segment?.text) return;
  const previous = segments[segments.length - 1];
  if (
    previous &&
    previous.className === (segment.className || "") &&
    (previous.href || "") === (segment.href || "") &&
    terminalSegmentStyleKey(previous.style) === terminalSegmentStyleKey(segment.style)
  ) {
    previous.text += segment.text;
    return;
  }
  segments.push({
    text: segment.text,
    className: segment.className || "",
    ...(segment.href ? { href: segment.href } : {}),
    ...(segment.style ? { style: segment.style } : {}),
  });
}

function createAnsiState() {
  return { bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, strikethrough: false, foreground: "", background: "", style: {}, href: "" };
}

function applySgrCodes(state, value) {
  const codes = String(value || "0").split(";").filter(Boolean).map((item) => Number(item));
  const safeCodes = codes.length ? codes : [0];
  for (let index = 0; index < safeCodes.length; index += 1) {
    const code = safeCodes[index];
      if (code === 0) {
        state.bold = false;
        state.dim = false;
        state.italic = false;
        state.underline = false;
        state.blink = false;
        state.inverse = false;
        state.conceal = false;
        state.strikethrough = false;
        state.foreground = "";
        state.background = "";
        state.style = {};
    } else if (code === 1) {
      state.bold = true;
    } else if (code === 2) {
      state.dim = true;
    } else if (code === 22) {
      state.bold = false;
      state.dim = false;
    } else if (code === 3) {
      state.italic = true;
    } else if (code === 23) {
      state.italic = false;
    } else if (code === 4) {
      state.underline = true;
      } else if (code === 24) {
        state.underline = false;
      } else if (code === 5 || code === 6) {
        state.blink = true;
      } else if (code === 25) {
        state.blink = false;
      } else if (code === 7) {
        state.inverse = true;
      } else if (code === 27) {
        state.inverse = false;
      } else if (code === 8) {
        state.conceal = true;
      } else if (code === 28) {
        state.conceal = false;
      } else if (code === 9) {
        state.strikethrough = true;
      } else if (code === 29) {
        state.strikethrough = false;
      } else if (code === 39) {
        state.foreground = "";
        delete state.style.color;
    } else if (code === 49) {
      state.background = "";
      delete state.style.backgroundColor;
    } else if ((code === 38 || code === 48) && safeCodes[index + 1] === 5) {
      const color = ansi256Color(safeCodes[index + 2]);
      if (color) applyExtendedAnsiColor(state, code, color);
      index += 2;
    } else if ((code === 38 || code === 48) && safeCodes[index + 1] === 2) {
      const color = rgbColor(safeCodes[index + 2], safeCodes[index + 3], safeCodes[index + 4]);
      if (color) applyExtendedAnsiColor(state, code, color);
      index += 4;
    } else if (ANSI_FOREGROUND[code]) {
      state.foreground = ANSI_FOREGROUND[code];
      delete state.style.color;
    } else if (ANSI_BACKGROUND[code]) {
      state.background = ANSI_BACKGROUND[code];
      delete state.style.backgroundColor;
    }
  }
}

function ansiClassName(state) {
  return [
    state.bold ? "ansi-bold" : "",
    state.dim ? "ansi-dim" : "",
    state.italic ? "ansi-italic" : "",
    state.underline ? "ansi-underline" : "",
    state.blink ? "ansi-blink" : "",
    state.inverse ? "ansi-inverse" : "",
    state.conceal ? "ansi-conceal" : "",
    state.strikethrough ? "ansi-strikethrough" : "",
    state.foreground ? `ansi-fg-${state.foreground}` : "",
    state.background ? `ansi-bg-${state.background}` : "",
  ].filter(Boolean).join(" ");
}

function ansiStyle(state) {
  const style = state?.style || {};
  const result = {
    ...(style.color ? { color: style.color } : {}),
    ...(style.backgroundColor ? { backgroundColor: style.backgroundColor } : {}),
  };
  return Object.keys(result).length ? result : null;
}

function terminalSegmentStyleKey(style = null) {
  if (!style) return "";
  return `${style.color || ""}|${style.backgroundColor || ""}`;
}

function applyExtendedAnsiColor(state, mode, color) {
  if (mode === 38) {
    state.foreground = "";
    state.style.color = color;
    return;
  }
  state.background = "";
  state.style.backgroundColor = color;
}

function rgbColor(red, green, blue) {
  const values = [red, green, blue].map((value) => Math.min(Math.max(Number(value) || 0, 0), 255));
  return `rgb(${values[0]},${values[1]},${values[2]})`;
}

function ansi256Color(value) {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index > 255) return "";
  if (index < 16) return ANSI_16_RGB[index];
  if (index >= 232) {
    const level = 8 + (index - 232) * 10;
    return rgbColor(level, level, level);
  }

  const colorIndex = index - 16;
  const red = Math.floor(colorIndex / 36);
  const green = Math.floor((colorIndex % 36) / 6);
  const blue = colorIndex % 6;
  return rgbColor(ansi256Level(red), ansi256Level(green), ansi256Level(blue));
}

function ansi256Level(value) {
  return value === 0 ? 0 : 55 + value * 40;
}

function normalizeTerminalLinkHref(value = "") {
  const href = String(value || "").trim();
  if (!href || !/^https?:\/\/[^\s<>"']+$/i.test(href)) return "";
  return href.slice(0, 2048);
}

function splitTerminalUrlSuffix(value = "") {
  let href = String(value || "");
  let suffix = "";
  while (/[),.;:!?]$/.test(href)) {
    suffix = href.slice(-1) + suffix;
    href = href.slice(0, -1);
  }
  return { href: normalizeTerminalLinkHref(href), suffix };
}

const ANSI_FOREGROUND = {
  30: "black",
  31: "red",
  32: "green",
  33: "yellow",
  34: "blue",
  35: "magenta",
  36: "cyan",
  37: "white",
  90: "bright-black",
  91: "bright-red",
  92: "bright-green",
  93: "bright-yellow",
  94: "bright-blue",
  95: "bright-magenta",
  96: "bright-cyan",
  97: "bright-white",
};

const ANSI_BACKGROUND = {
  40: "black",
  41: "red",
  42: "green",
  43: "yellow",
  44: "blue",
  45: "magenta",
  46: "cyan",
  47: "white",
  100: "bright-black",
  101: "bright-red",
  102: "bright-green",
  103: "bright-yellow",
  104: "bright-blue",
  105: "bright-magenta",
  106: "bright-cyan",
  107: "bright-white",
};

const ANSI_16_RGB = [
  "rgb(0,0,0)",
  "rgb(205,49,49)",
  "rgb(13,188,121)",
  "rgb(229,229,16)",
  "rgb(36,114,200)",
  "rgb(188,63,188)",
  "rgb(17,168,205)",
  "rgb(229,229,229)",
  "rgb(102,102,102)",
  "rgb(241,76,76)",
  "rgb(35,209,139)",
  "rgb(245,245,67)",
  "rgb(59,142,234)",
  "rgb(214,112,214)",
  "rgb(41,184,219)",
  "rgb(255,255,255)",
];

function wrapIndex(index, length) {
  if (length <= 0) return -1;
  return ((index % length) + length) % length;
}
