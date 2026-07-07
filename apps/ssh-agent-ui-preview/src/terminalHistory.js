export const DEFAULT_HISTORY_LIMIT = 50;
export const DEFAULT_TERMINAL_FONT_SIZE = 14;
export const MIN_TERMINAL_FONT_SIZE = 11;
export const MAX_TERMINAL_FONT_SIZE = 20;

export const TERMINAL_COMMAND_SNIPPETS = [
  { label: "负载", command: "uptime" },
  { label: "磁盘", command: "df -hT" },
  { label: "内存", command: "free -h" },
  { label: "失败服务", command: "systemctl --failed" },
  { label: "端口", command: "ss -lntp" },
  { label: "最近日志", command: "journalctl -xe --no-pager -n 80" },
];

export function isLongRunningCommand(command = "") {
  const normalized = String(command || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return false;

  const commandStart = "(?:^|[;&|]\\s*)(?:sudo\\s+)?";
  if (new RegExp(`${commandStart}tail\\b.*(?:^|\\s)-f(?:\\s|$)`).test(normalized)) return true;
  if (new RegExp(`${commandStart}journalctl\\b.*(?:^|\\s)(?:-f|--follow)(?:\\s|$)`).test(normalized)) return true;
  if (new RegExp(`${commandStart}(?:docker|kubectl)\\s+logs\\b.*(?:^|\\s)-f(?:\\s|$)`).test(normalized)) return true;
  if (new RegExp(`${commandStart}(?:watch|top|htop|less|more|vi|vim|nano)\\b`).test(normalized)) return true;
  if (new RegExp(`${commandStart}(?:ssh|sftp|ftp|mysql|psql|redis-cli|python|python3|node|irb|rails\\s+console)\\b`).test(normalized)) return true;
  if (new RegExp(`${commandStart}(?:docker|kubectl)\\s+exec\\b.*(?:^|\\s)-i?t(?:\\s|$)`).test(normalized)) return true;

  if (new RegExp(`${commandStart}ping\\b`).test(normalized)) {
    return !/(^|\s)(?:-c|-w)\s+\d+(\s|$)/.test(normalized);
  }

  return false;
}

export function isInteractiveExitInput(input = "", submit = false) {
  if (!submit) return false;
  const normalized = String(input || "").trim().toLowerCase();
  if (!normalized) return false;
  return ["exit", "exit()", "quit", "quit;", "\\q", ":q"].includes(normalized);
}

export function shouldSubmitAsSensitiveTerminalInput(lines = []) {
  const recent = (Array.isArray(lines) ? lines : [lines])
    .slice(-4)
    .map((line) => String(line || ""))
    .join("\n")
    .trimEnd();
  if (!recent) return false;
  const tail = recent.slice(-320);
  const promptPatterns = [
    /(?:^|\n)\s*(?:\[sudo\]\s*)?password(?:\s+for\s+[^:\n]+)?\s*:\s*$/i,
    /(?:^|\n)\s*enter\s+passphrase(?:\s+for\s+[^:\n]+)?\s*:\s*$/i,
    /(?:^|\n)\s*(?:请输入|输入|請輸入)?(?:密码|密碼|口令|密钥口令|金鑰密碼)\s*[：:]\s*$/i,
  ];
  return promptPatterns.some((pattern) => pattern.test(tail));
}

export function isTerminalInteractiveMode(session = {}) {
  return Boolean(session?.sessionId && session?.interactiveMode);
}

export function buildRunningSessionKeyInput(key = "", commandValue = "", event = {}) {
  if (String(commandValue || "")) return null;
  if (String(key || "") === "Tab" && event?.shiftKey) return { text: "\x1b[Z", submit: false };
  const modifiedFunctionInput = mapModifiedFunctionKeyInput(String(key || ""), event);
  if (modifiedFunctionInput) return { text: modifiedFunctionInput, submit: false };
  const modifiedInput = mapModifiedNavigationInput(String(key || ""), event);
  if (modifiedInput) return { text: modifiedInput, submit: false };
  const ctrlModifiedInputs = {
    ArrowUp: "\x1b[1;5A",
    ArrowDown: "\x1b[1;5B",
    ArrowRight: "\x1b[1;5C",
    ArrowLeft: "\x1b[1;5D",
    Home: "\x1b[1;5H",
    End: "\x1b[1;5F",
    Delete: "\x1b[3;5~",
  };
  if (event?.ctrlKey && !event?.altKey && !event?.metaKey && ctrlModifiedInputs[String(key || "")]) {
    return { text: ctrlModifiedInputs[String(key || "")], submit: false };
  }
  const specialInputs = {
    ArrowUp: "\x1b[A",
    ArrowDown: "\x1b[B",
    ArrowRight: "\x1b[C",
    ArrowLeft: "\x1b[D",
    Home: "\x1b[H",
    End: "\x1b[F",
    Insert: "\x1b[2~",
    Delete: "\x1b[3~",
    PageUp: "\x1b[5~",
    PageDown: "\x1b[6~",
    Enter: "",
    Backspace: "\x7f",
    Tab: "\t",
    Escape: "\x1b",
    F1: "\x1bOP",
    F2: "\x1bOQ",
    F3: "\x1bOR",
    F4: "\x1bOS",
    F5: "\x1b[15~",
    F6: "\x1b[17~",
    F7: "\x1b[18~",
    F8: "\x1b[19~",
    F9: "\x1b[20~",
    F10: "\x1b[21~",
    F11: "\x1b[23~",
    F12: "\x1b[24~",
  };
  const text = specialInputs[String(key || "")];
  if (Object.prototype.hasOwnProperty.call(specialInputs, String(key || ""))) {
    return { text, submit: String(key || "") === "Enter" };
  }
  return null;
}

function mapModifiedNavigationInput(key = "", event = {}) {
  const ctrl = Boolean(event?.ctrlKey);
  const shift = Boolean(event?.shiftKey);
  if (!shift || event?.altKey || event?.metaKey) return "";

  const modifier = ctrl ? 6 : 2;
  const arrowFinals = {
    ArrowUp: "A",
    ArrowDown: "B",
    ArrowRight: "C",
    ArrowLeft: "D",
    Home: "H",
    End: "F",
  };
  if (arrowFinals[key]) return `\x1b[1;${modifier}${arrowFinals[key]}`;

  const tildeInputs = {
    Insert: 2,
    Delete: 3,
    PageUp: 5,
    PageDown: 6,
  };
  if (tildeInputs[key]) return `\x1b[${tildeInputs[key]};${modifier}~`;

  return "";
}

function mapModifiedFunctionKeyInput(key = "", event = {}) {
  if (event?.altKey || event?.metaKey) return "";

  const ctrl = Boolean(event?.ctrlKey);
  const shift = Boolean(event?.shiftKey);
  if (!ctrl && !shift) return "";

  const modifier = ctrl && shift ? 6 : ctrl ? 5 : 2;
  return mapFunctionKeyWithModifier(key, modifier);
}

export function buildRunningSessionMetaInput(event = {}, commandValue = "") {
  if (String(commandValue || "")) return null;
  if (!event?.altKey || event?.ctrlKey || event?.metaKey || event?.isComposing) return null;

  const key = String(event?.key || "");
  if (key.length === 1) return { text: `\x1b${key}`, submit: false };

  const altModifiedInput = mapAltModifiedTerminalInput(key, event);
  if (altModifiedInput) return { text: altModifiedInput, submit: false };

  const specialInput = buildRunningSessionKeyInput(key, "");
  return specialInput ? { text: `\x1b${specialInput.text}`, submit: false } : null;
}

export function buildRunningSessionTextInput(event = {}, commandValue = "") {
  if (String(commandValue || "")) return null;
  if (event?.isComposing || event?.ctrlKey || event?.altKey || event?.metaKey) return null;

  const key = String(event?.key || "");
  if (key.length !== 1) return null;

  return { text: key, submit: false };
}

export function buildConnectedShellInput(event = {}, commandValue = "", options = {}) {
  const connected = options?.connected !== false;
  if (!connected || options?.interactive || String(commandValue || "")) return null;
  if (options?.allowScrollKeys === false && getTerminalScrollKeyAction(event) && !options?.forwardReviewKeys) return null;

  const directControlInput = isConnectedShellDirectControlKey(event) ? buildRunningSessionControlInput(event, "") : null;
  if (directControlInput?.action === "interrupt") return { text: "\x03", submit: false };
  if (directControlInput) return directControlInput;

  const metaInput = buildRunningSessionMetaInput(event, "");
  if (metaInput) return metaInput;

  const keyInput = buildRunningSessionKeyInput(event?.key, "", event);
  if (keyInput) return keyInput;

  return buildRunningSessionTextInput(event, "");
}

export function formatTerminalInputForLog(input = "", options = {}) {
  if (options?.sensitiveInput) return "[敏感输入已隐藏]";

  const text = String(input ?? "");
  if (!text && options?.submit) return "[Enter]";
  if (!text) return "";
  if (!/[\u0000-\u001f\u007f]/.test(text)) return redactTerminalInputSecrets(text);

  const terminalSequenceName = describeTerminalEscapeSequence(text);
  if (terminalSequenceName) return `[控制输入 ${terminalSequenceName}]`;

  const visibleBytes = Array.from(text).map((char) => {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return describeControlInputByte(code);
    return char;
  });
  return `[控制输入 ${visibleBytes.join(" ")}]`;
}

function describeTerminalEscapeSequence(text = "") {
  const namedSequences = {
    "\x1b[A": "方向键上",
    "\x1b[B": "方向键下",
    "\x1b[C": "方向键右",
    "\x1b[D": "方向键左",
    "\x1b[H": "Home",
    "\x1b[F": "End",
    "\x1b[2~": "Insert",
    "\x1b[3~": "Delete",
    "\x1b[5~": "PageUp",
    "\x1b[6~": "PageDown",
    "\x1b[Z": "Shift+Tab",
    "\x1bOP": "F1",
    "\x1bOQ": "F2",
    "\x1bOR": "F3",
    "\x1bOS": "F4",
    "\x1b[15~": "F5",
    "\x1b[17~": "F6",
    "\x1b[18~": "F7",
    "\x1b[19~": "F8",
    "\x1b[20~": "F9",
    "\x1b[21~": "F10",
    "\x1b[23~": "F11",
    "\x1b[24~": "F12",
  };
  return namedSequences[String(text || "")] || describeModifiedTerminalNavigationSequence(String(text || ""));
}

function describeModifiedTerminalNavigationSequence(text = "") {
  const csiNavigationMatch = String(text || "").match(/^\x1b\[1;([2-8])([ABCDFH])$/);
  if (csiNavigationMatch) {
    const keyNames = {
      A: "Up",
      B: "Down",
      C: "Right",
      D: "Left",
      F: "End",
      H: "Home",
    };
    return joinTerminalModifierName(csiNavigationMatch[1], keyNames[csiNavigationMatch[2]]);
  }

  const tildeNavigationMatch = String(text || "").match(/^\x1b\[(2|3|5|6);([2-8])~$/);
  if (tildeNavigationMatch) {
    const keyNames = {
      2: "Insert",
      3: "Delete",
      5: "PageUp",
      6: "PageDown",
    };
    return joinTerminalModifierName(tildeNavigationMatch[2], keyNames[tildeNavigationMatch[1]]);
  }

  return "";
}

function joinTerminalModifierName(modifier = "", keyName = "") {
  const modifiers = {
    2: "Shift",
    3: "Alt",
    4: "Alt+Shift",
    5: "Ctrl",
    6: "Ctrl+Shift",
    7: "Ctrl+Alt",
    8: "Ctrl+Alt+Shift",
  };
  const prefix = modifiers[String(modifier || "")] || "";
  const key = String(keyName || "").trim();
  return prefix && key ? `${prefix}+${key}` : "";
}

function describeControlInputByte(code) {
  const namedControls = {
    0x00: "Ctrl+Space/Ctrl+@/Ctrl+2",
    0x01: "Ctrl+A",
    0x02: "Ctrl+B",
    0x03: "Ctrl+C",
    0x04: "Ctrl+D",
    0x05: "Ctrl+E",
    0x06: "Ctrl+F",
    0x07: "Ctrl+G",
    0x08: "Ctrl+H",
    0x09: "Tab",
    0x0a: "Ctrl+J",
    0x0b: "Ctrl+K",
    0x0c: "Ctrl+L",
    0x0d: "Enter",
    0x0e: "Ctrl+N",
    0x10: "Ctrl+P",
    0x11: "Ctrl+Q",
    0x12: "Ctrl+R",
    0x13: "Ctrl+S",
    0x14: "Ctrl+T",
    0x15: "Ctrl+U",
    0x17: "Ctrl+W",
    0x18: "Ctrl+X",
    0x19: "Ctrl+Y",
    0x1a: "Ctrl+Z",
    0x1b: "Esc",
    0x1c: "Ctrl+\\",
    0x1d: "Ctrl+]",
    0x1e: "Ctrl+^",
    0x1f: "Ctrl+_/Ctrl+/",
    0x7f: "Backspace",
  };
  return namedControls[code] || `0x${code.toString(16).toUpperCase().padStart(2, "0")}`;
}

function redactTerminalInputSecrets(text = "") {
  const replacement = "[敏感信息已隐藏]";
  return String(text || "")
    .replace(/\b(authorization\s*:\s*bearer\s+)(?:"[^"]*"|'[^']*'|[^\s"']+)/gi, `$1${replacement}`)
    .replace(/\b(authorization\s*:\s*)(?!bearer\b)(?:"[^"]*"|'[^']*'|[^\s"']+)/gi, `$1${replacement}`)
    .replace(/\b((?:api[-_]?key|access[-_]?key|secret|token|passwd|password|pwd)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s"'&]+)/gi, `$1${replacement}`)
    .replace(/(--(?:api[-_]?key|access[-_]?key|secret|token|passwd|password|pwd)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s"'&]+)/gi, `$1${replacement}`);
}

export function buildRunningSessionControlInput(event = {}, commandValue = "") {
  if (!event?.ctrlKey || event?.shiftKey || event?.altKey || event?.metaKey) return null;

  const key = String(event?.key || "").toLowerCase();
  if (["c", "pause", "cancel", "break"].includes(key)) return { action: "interrupt" };
  if (String(commandValue || "")) return null;
  const controlInput = mapControlKeyToTerminalInput(key);
  if (controlInput) return { text: controlInput, submit: false, ...(["d", "z", "\\"].includes(key) ? { finishInteractiveMode: true } : {}) };

  return null;
}

function isConnectedShellDirectControlKey(event = {}) {
  const key = String(event?.key || "").toLowerCase();
  return event?.ctrlKey && !event?.shiftKey && !event?.altKey && !event?.metaKey && [" ", "@", "2", "3", "4", "5", "6", "7", "8", "[", "\\", "]", "^", "_", "/", "?", "backspace", "delete", "pause", "cancel", "break", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "w", "x", "y", "z"].includes(key);
}

export function applyTerminalCommandEditKey(event = {}, value = "", selectionStart = 0, selectionEnd = selectionStart, options = {}) {
  const text = String(value || "");
  const start = clampSelectionIndex(selectionStart, text.length);
  const end = clampSelectionIndex(selectionEnd, text.length);
  const rangeStart = Math.min(start, end);
  const rangeEnd = Math.max(start, end);
  const unchanged = { handled: false, value: text, selectionStart: start, selectionEnd: end };

  if (event?.altKey && !event?.ctrlKey && !event?.shiftKey && !event?.metaKey) {
    const key = String(event?.key || "").toLowerCase();
    if (key === "b") {
      const previousWordStart = findPreviousWordStart(text, rangeStart);
      return { handled: true, value: text, selectionStart: previousWordStart, selectionEnd: previousWordStart };
    }
    if (key === "f") {
      const nextWordEnd = findNextWordEnd(text, rangeEnd);
      return { handled: true, value: text, selectionStart: nextWordEnd, selectionEnd: nextWordEnd };
    }
    if (key === "d") {
      const deleteEnd = rangeStart !== rangeEnd ? rangeEnd : findNextWordEnd(text, rangeStart);
      const deletedText = text.slice(rangeStart, deleteEnd);
      const nextValue = text.slice(0, rangeStart) + text.slice(deleteEnd);
      return withCommandKillBuffer({ handled: true, value: nextValue, selectionStart: rangeStart, selectionEnd: rangeStart }, deletedText, options);
    }
    if (key === "backspace") {
      if (rangeStart !== rangeEnd) {
        const deletedText = text.slice(rangeStart, rangeEnd);
        const nextValue = text.slice(0, rangeStart) + text.slice(rangeEnd);
        return withCommandKillBuffer({ handled: true, value: nextValue, selectionStart: rangeStart, selectionEnd: rangeStart }, deletedText, options);
      }
      const deleteStart = findPreviousWordStart(text, rangeStart);
      const deleteEnd = deleteStart > 0 && /\s/.test(text[deleteStart - 1] || "") && /\s/.test(text[rangeStart] || "") ? rangeStart + 1 : rangeStart;
      const deletedText = text.slice(deleteStart, deleteEnd);
      const nextValue = text.slice(0, deleteStart) + text.slice(deleteEnd);
      return withCommandKillBuffer({ handled: true, value: nextValue, selectionStart: deleteStart, selectionEnd: deleteStart }, deletedText, options);
    }
    return unchanged;
  }

  if (!event?.ctrlKey && !event?.shiftKey && !event?.altKey && !event?.metaKey) {
    const key = String(event?.key || "").toLowerCase();
    if (key === "home") {
      const lineStart = findCurrentLineStart(text, rangeStart);
      return { handled: true, value: text, selectionStart: lineStart, selectionEnd: lineStart };
    }
    if (key === "end") {
      const lineEnd = findCurrentLineEnd(text, rangeEnd);
      return { handled: true, value: text, selectionStart: lineEnd, selectionEnd: lineEnd };
    }
    return unchanged;
  }

  if (!event?.ctrlKey || event?.shiftKey || event?.altKey || event?.metaKey) return unchanged;

  const key = String(event?.key || "").toLowerCase();
  if (key === "a") {
    const lineStart = findCurrentLineStart(text, rangeStart);
    return { handled: true, value: text, selectionStart: lineStart, selectionEnd: lineStart };
  }
  if (key === "e") {
    const lineEnd = findCurrentLineEnd(text, rangeEnd);
    return { handled: true, value: text, selectionStart: lineEnd, selectionEnd: lineEnd };
  }
  if (key === "b") return { handled: true, value: text, selectionStart: Math.max(rangeStart - 1, 0), selectionEnd: Math.max(rangeStart - 1, 0) };
  if (key === "f") return { handled: true, value: text, selectionStart: Math.min(rangeEnd + 1, text.length), selectionEnd: Math.min(rangeEnd + 1, text.length) };
  if (key === "arrowleft") {
    const previousWordStart = findPreviousWordStart(text, rangeStart);
    return { handled: true, value: text, selectionStart: previousWordStart, selectionEnd: previousWordStart };
  }
  if (key === "arrowright") {
    const nextWordEnd = findNextWordEnd(text, rangeEnd);
    return { handled: true, value: text, selectionStart: nextWordEnd, selectionEnd: nextWordEnd };
  }
  if (key === "home") return { handled: true, value: text, selectionStart: 0, selectionEnd: 0 };
  if (key === "end") return { handled: true, value: text, selectionStart: text.length, selectionEnd: text.length };
  if (key === "backspace") {
    if (rangeStart !== rangeEnd) {
      const deletedText = text.slice(rangeStart, rangeEnd);
      const nextValue = text.slice(0, rangeStart) + text.slice(rangeEnd);
      return withCommandKillBuffer({ handled: true, value: nextValue, selectionStart: rangeStart, selectionEnd: rangeStart }, deletedText, options);
    }
    const deleteStart = findPreviousWordStart(text, rangeStart);
    const deleteEnd = deleteStart > 0 && /\s/.test(text[deleteStart - 1] || "") && /\s/.test(text[rangeStart] || "") ? rangeStart + 1 : rangeStart;
    const deletedText = text.slice(deleteStart, deleteEnd);
    const nextValue = text.slice(0, deleteStart) + text.slice(deleteEnd);
    return withCommandKillBuffer({ handled: true, value: nextValue, selectionStart: deleteStart, selectionEnd: deleteStart }, deletedText, options);
  }
  if (key === "delete") {
    const deleteEnd = rangeStart !== rangeEnd ? rangeEnd : findNextWordEnd(text, rangeStart);
    const deletedText = text.slice(rangeStart, deleteEnd);
    const nextValue = text.slice(0, rangeStart) + text.slice(deleteEnd);
    return withCommandKillBuffer({ handled: true, value: nextValue, selectionStart: rangeStart, selectionEnd: rangeStart }, deletedText, options);
  }
  if (key === "h") {
    if (rangeStart !== rangeEnd) {
      const nextValue = text.slice(0, rangeStart) + text.slice(rangeEnd);
      return { handled: true, value: nextValue, selectionStart: rangeStart, selectionEnd: rangeStart };
    }
    if (rangeStart === 0) return { handled: true, value: text, selectionStart: 0, selectionEnd: 0 };
    const nextValue = text.slice(0, rangeStart - 1) + text.slice(rangeStart);
    return { handled: true, value: nextValue, selectionStart: rangeStart - 1, selectionEnd: rangeStart - 1 };
  }
  if (key === "u") {
    const deletedText = text.slice(0, rangeEnd);
    const nextValue = text.slice(rangeEnd);
    return withCommandKillBuffer({ handled: true, value: nextValue, selectionStart: 0, selectionEnd: 0 }, deletedText, options);
  }
  if (key === "d") {
    if (rangeStart !== rangeEnd) {
      const nextValue = text.slice(0, rangeStart) + text.slice(rangeEnd);
      return { handled: true, value: nextValue, selectionStart: rangeStart, selectionEnd: rangeStart };
    }
    if (rangeStart >= text.length) return { handled: true, value: text, selectionStart: text.length, selectionEnd: text.length };
    const nextValue = text.slice(0, rangeStart) + text.slice(rangeStart + 1);
    return { handled: true, value: nextValue, selectionStart: rangeStart, selectionEnd: rangeStart };
  }
  if (key === "k") {
    const deletedText = text.slice(rangeStart);
    return withCommandKillBuffer({ handled: true, value: text.slice(0, rangeStart), selectionStart: rangeStart, selectionEnd: rangeStart }, deletedText, options);
  }
  if (key === "w") {
    if (rangeStart !== rangeEnd) {
      const deletedText = text.slice(rangeStart, rangeEnd);
      const nextValue = text.slice(0, rangeStart) + text.slice(rangeEnd);
      return withCommandKillBuffer({ handled: true, value: nextValue, selectionStart: rangeStart, selectionEnd: rangeStart }, deletedText, options);
    }
    const deleteStart = findPreviousWordStart(text, rangeStart);
    const deleteEnd = deleteStart > 0 && /\s/.test(text[deleteStart - 1] || "") && /\s/.test(text[rangeStart] || "") ? rangeStart + 1 : rangeStart;
    const deletedText = text.slice(deleteStart, deleteEnd);
    const nextValue = text.slice(0, deleteStart) + text.slice(deleteEnd);
    return withCommandKillBuffer({ handled: true, value: nextValue, selectionStart: deleteStart, selectionEnd: deleteStart }, deletedText, options);
  }
  if (key === "y" && options?.trackKillBuffer) {
    const killBuffer = String(options?.killBuffer || "");
    const nextValue = text.slice(0, rangeStart) + killBuffer + text.slice(rangeEnd);
    const cursor = rangeStart + killBuffer.length;
    return { handled: true, value: nextValue, selectionStart: cursor, selectionEnd: cursor, killBuffer };
  }

  return unchanged;
}

function withCommandKillBuffer(result, deletedText = "", options = {}) {
  if (!options?.trackKillBuffer) return result;
  const killBuffer = String(deletedText || "");
  return killBuffer ? { ...result, killBuffer } : result;
}

function mapControlKeyToTerminalInput(key = "") {
  if (["backspace", "delete"].includes(key)) return "\x17";

  if (/^[a-z]$/.test(key)) {
    return String.fromCharCode(key.charCodeAt(0) - 96);
  }

  const controlPunctuation = {
    " ": "\x00",
    "@": "\x00",
    "2": "\x00",
    "3": "\x1b",
    "4": "\x1c",
    "5": "\x1d",
    "6": "\x1e",
    "7": "\x1f",
    "8": "\x7f",
    "[": "\x1b",
    "\\": "\x1c",
    "]": "\x1d",
    "^": "\x1e",
    "_": "\x1f",
    "/": "\x1f",
    "?": "\x7f",
  };
  return controlPunctuation[key] || "";
}

function findPreviousWordStart(text, cursor) {
  let index = clampSelectionIndex(cursor, text.length);
  while (index > 0 && /\s/.test(text[index - 1])) index -= 1;
  while (index > 0 && !/\s/.test(text[index - 1])) index -= 1;
  return index;
}

function findNextWordEnd(text, cursor) {
  let index = clampSelectionIndex(cursor, text.length);
  while (index < text.length && /\s/.test(text[index])) index += 1;
  while (index < text.length && !/\s/.test(text[index])) index += 1;
  return index;
}

function findCurrentLineStart(text, cursor) {
  const index = clampSelectionIndex(cursor, text.length);
  return String(text || "").lastIndexOf("\n", Math.max(0, index - 1)) + 1;
}

function findCurrentLineEnd(text, cursor) {
  const source = String(text || "");
  const index = clampSelectionIndex(cursor, source.length);
  const nextLineBreak = source.indexOf("\n", index);
  return nextLineBreak === -1 ? source.length : nextLineBreak;
}

function clampSelectionIndex(index, max) {
  const numericIndex = Number.isFinite(Number(index)) ? Number(index) : 0;
  return Math.min(Math.max(Math.trunc(numericIndex), 0), max);
}

function mapAltModifiedTerminalInput(key = "", event = {}) {
  const modifier = event?.shiftKey ? 4 : 3;
  const arrowInputs = {
    ArrowUp: `\x1b[1;${modifier}A`,
    ArrowDown: `\x1b[1;${modifier}B`,
    ArrowRight: `\x1b[1;${modifier}C`,
    ArrowLeft: `\x1b[1;${modifier}D`,
    Home: `\x1b[1;${modifier}H`,
    End: `\x1b[1;${modifier}F`,
  };
  if (arrowInputs[key]) return arrowInputs[key];

  const tildeInputs = {
    Insert: 2,
    Delete: 3,
    PageUp: 5,
    PageDown: 6,
  };
  if (tildeInputs[key]) return `\x1b[${tildeInputs[key]};${modifier}~`;

  const functionInput = mapFunctionKeyWithModifier(key, modifier);
  if (functionInput) return functionInput;

  return "";
}

function mapFunctionKeyWithModifier(key = "", modifier = 2) {
  const f1ToF4Finals = {
    F1: "P",
    F2: "Q",
    F3: "R",
    F4: "S",
  };
  if (f1ToF4Finals[key]) return `\x1b[1;${modifier}${f1ToF4Finals[key]}`;

  const f5ToF12Numbers = {
    F5: 15,
    F6: 17,
    F7: 18,
    F8: 19,
    F9: 20,
    F10: 21,
    F11: 23,
    F12: 24,
  };
  if (f5ToF12Numbers[key]) return `\x1b[${f5ToF12Numbers[key]};${modifier}~`;

  return "";
}

export function getTerminalShortcutAction(event = {}, commandValue = "") {
  const key = String(event?.key || "").toLowerCase();
  const usesControlModifier = Boolean(event?.ctrlKey || event?.metaKey);
  if (event?.altKey) return null;

  if (!usesControlModifier && !event?.shiftKey && event?.key === "F2") return "rename-tab";
  if (!usesControlModifier && !event?.shiftKey && event?.key === "F11") return "toggle-terminal-focus";
  if (event?.ctrlKey && !event?.shiftKey && key === "insert") return "copy-output";
  if (event?.shiftKey && !usesControlModifier && key === "insert") return "paste-command";
  if (!usesControlModifier) return null;
  if (!event?.shiftKey && event?.ctrlKey && key === "c") return "interrupt-session";
  if (event?.shiftKey && key === "a") return "select-all-output";
  if (event?.shiftKey && key === "c") return "copy-output";
  if (event?.shiftKey && key === "t") return "duplicate-tab";
  if (event?.shiftKey && key === "r") return "reconnect-session";
  if (event?.shiftKey && key === "e") return "reopen-closed-tab";
  if (event?.shiftKey && key === "b") return "open-backup-center";
  if (event?.shiftKey && key === "g") return "open-tool-logs";
  if (event?.shiftKey && key === "i") return "edit-current-connection";
  if (event?.shiftKey && key === "k") return "open-auth-center";
  if (event?.shiftKey && key === "h") return "open-session-logs";
  if (event?.shiftKey && key === "o") return "open-cwd-in-sftp";
  if (event?.shiftKey && key === "p") return "toggle-pin-tab";
  if (event?.shiftKey && key === "s") return "export-terminal-output";
  if (event?.shiftKey && key === "y") return "copy-ssh-command";
  if (event?.shiftKey && key === "d") return "disconnect-session";
  if (event?.shiftKey && key === "w") return "close-tab";
  if (event?.shiftKey && key === "n") return "new-connection";
  if (key === "v") return "paste-command";
  if (["+", "="].includes(key)) return "zoom-in";
  if (["-", "_"].includes(key)) return "zoom-out";
  if (key === "0") return "zoom-reset";
  if (event?.ctrlKey && event?.key === "Tab") return event?.shiftKey ? "previous-tab" : "next-tab";
  if (event?.ctrlKey && !event?.shiftKey && /^[1-9]$/.test(key)) return `select-tab-${key}`;
  if (key === "f") return "focus-search";
  if (event?.shiftKey && key === "l") return "clear-output";
  if (!event?.shiftKey && event?.key === "PageUp") return "previous-tab";
  if (!event?.shiftKey && event?.key === "PageDown") return "next-tab";
  if (!event?.shiftKey && key === "w" && !String(commandValue || "").trim()) return "close-tab";
  if (!event?.shiftKey && key === "l") return "clear-output";
  if (!event?.shiftKey && key === "u") return "clear-input";
  if (!event?.shiftKey && key === "d" && !String(commandValue || "").trim()) return "disconnect-session";

  return null;
}

export function getTerminalSearchKeyAction(event = {}) {
  const key = String(event?.key || "");
  if (event?.ctrlKey || event?.metaKey || event?.altKey) return null;

  if (key === "Enter") return event?.shiftKey ? "previous-match" : "next-match";
  if (key === "F3") return event?.shiftKey ? "previous-match" : "next-match";
  if (!event?.shiftKey && key === "Escape") return "blur-search";

  return null;
}

export function getTerminalScrollKeyAction(event = {}) {
  const key = String(event?.key || "");
  if (event?.ctrlKey || event?.metaKey || event?.altKey) return null;

  if (key === "PageUp") return "page-up";
  if (key === "PageDown") return "page-down";
  if (key === "Home") return "top";
  if (key === "End") return "bottom";

  return null;
}

export function adjustTerminalFontSize(currentSize = DEFAULT_TERMINAL_FONT_SIZE, action = "") {
  const size = Number.isFinite(Number(currentSize)) ? Number(currentSize) : DEFAULT_TERMINAL_FONT_SIZE;
  if (action === "zoom-reset") return DEFAULT_TERMINAL_FONT_SIZE;
  if (action === "zoom-in") return clampTerminalFontSize(size + 1);
  if (action === "zoom-out") return clampTerminalFontSize(size - 1);
  return clampTerminalFontSize(size);
}

export function addCommandToHistory(history, command, limit = DEFAULT_HISTORY_LIMIT) {
  const normalized = String(command || "").trim();
  if (!normalized) return Array.isArray(history) ? history : [];
  if (/[\r\n]/.test(normalized)) return Array.isArray(history) ? history : [];
  if (containsSensitiveCommandMaterial(normalized)) return Array.isArray(history) ? history : [];

  const existing = Array.isArray(history) ? history : [];
  return [normalized, ...existing.filter((item) => item !== normalized)].slice(0, limit);
}

export function clearCommandHistoryForServer(histories, serverName) {
  const name = String(serverName || "").trim();
  if (!name || !histories || typeof histories !== "object" || Array.isArray(histories)) return histories || {};

  const nextHistories = { ...histories };
  delete nextHistories[name];
  return nextHistories;
}

export function removeCommandFromHistoryForServer(histories, serverName, command) {
  const name = String(serverName || "").trim();
  const normalizedCommand = String(command || "").trim().toLowerCase();
  if (!name || !normalizedCommand || !histories || typeof histories !== "object" || Array.isArray(histories)) return histories || {};

  const currentHistory = Array.isArray(histories[name]) ? histories[name] : [];
  const nextHistory = currentHistory.filter((item) => String(item || "").trim().toLowerCase() !== normalizedCommand);
  if (nextHistory.length === currentHistory.length) return histories;

  const nextHistories = { ...histories };
  if (nextHistory.length) nextHistories[name] = nextHistory;
  else delete nextHistories[name];
  return nextHistories;
}

export function normalizeCommandHistories(histories, limit = DEFAULT_HISTORY_LIMIT) {
  if (!histories || typeof histories !== "object" || Array.isArray(histories)) return {};
  const maxItems = Math.max(0, Math.trunc(Number(limit) || DEFAULT_HISTORY_LIMIT));
  const normalizedHistories = {};

  Object.entries(histories).forEach(([serverName, history]) => {
    const name = String(serverName || "").trim();
    if (!name || !Array.isArray(history)) return;

    const seen = new Set();
    const entries = normalizeSafeCommandHistory(history)
      .filter((command) => {
        const key = command.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, maxItems);

    if (entries.length) normalizedHistories[name] = entries;
  });

  return normalizedHistories;
}

export function addCustomCommandSnippet(snippets, command, label = "") {
  const normalized = String(command || "").trim();
  if (!normalized) return Array.isArray(snippets) ? snippets : [];
  if (!validateCustomCommandSnippet(normalized).ok) return normalizeCustomSnippets(snippets);

  const existing = normalizeCustomSnippets(snippets);
  const exists = existing.some((item) => item.command.toLowerCase() === normalized.toLowerCase());
  if (exists) return existing;

  return [
    ...existing,
    {
      label: String(label || normalized).trim(),
      command: normalized,
      custom: true,
    },
  ];
}

export function removeCustomCommandSnippet(snippets, command) {
  const normalized = String(command || "").trim().toLowerCase();
  return normalizeCustomSnippets(snippets).filter((item) => item.command.toLowerCase() !== normalized);
}

export function validateCustomCommandSnippet(command = "") {
  const normalized = String(command || "").trim();
  if (!normalized) {
    return { ok: false, message: "请输入命令后再收藏。" };
  }

  if (containsSensitiveCommandMaterial(normalized)) {
    return { ok: false, message: "命令包含密码、Token、Authorization 等敏感信息，不能收藏。" };
  }

  return { ok: true, message: "可以收藏。" };
}

export function mergeTerminalCommandSnippets(builtinSnippets, customSnippets) {
  const merged = [];
  const commands = new Set();

  [...(Array.isArray(builtinSnippets) ? builtinSnippets : []), ...normalizeCustomSnippets(customSnippets)].forEach((item) => {
    const command = String(item?.command || "").trim();
    const label = String(item?.label || command).trim();
    if (!command || !label) return;
    const key = command.toLowerCase();
    if (commands.has(key)) return;
    commands.add(key);
    merged.push({ ...item, label, command, custom: Boolean(item.custom) });
  });

  return merged;
}

export function prepareClipboardCommandPaste(clipboardText, existingCommand = "", options = {}) {
  const normalized = String(clipboardText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return { ok: false, requiresConfirmation: false, lineCount: 0, nextCommand: "", message: "剪贴板没有可粘贴的命令文本。" };
  }

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const lineCount = lines.length || (normalized ? 1 : 0);
  const isMultiline = lineCount > 1;
  if (isMultiline && !options?.allowMultiline) {
    return {
      ok: false,
      requiresConfirmation: true,
      lineCount,
      nextCommand: normalized,
      message: `检测到 ${lineCount} 行多行命令，粘贴前需要确认。\n\n预览：\n${buildClipboardPastePreview(normalized)}`,
    };
  }

  const existing = String(existingCommand || "").trimEnd();
  const separator = !existing ? "" : isMultiline || existing.includes("\n") ? "\n" : " ";
  return {
    ok: true,
    requiresConfirmation: false,
    lineCount,
    nextCommand: `${existing}${separator}${normalized}`,
    message: isMultiline ? `已粘贴 ${lineCount} 行命令，发送前请逐行检查。` : "已粘贴到命令行，发送前请检查。",
  };
}

export function prepareInteractiveClipboardPaste(clipboardText, options = {}) {
  const normalized = String(clipboardText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmed = normalized.trim();
  if (!trimmed) {
    return { ok: false, requiresConfirmation: false, lineCount: 0, charCount: 0, text: "", message: "剪贴板没有可粘贴的文本。" };
  }

  const lines = normalized.split("\n").filter((line) => line.trim()).length || 1;
  const charCount = normalized.length;
  const maxSafeChars = Number.isFinite(options?.maxSafeChars) ? Number(options.maxSafeChars) : 1200;
  const riskyPaste = lines > 1 || charCount > maxSafeChars;
  if (riskyPaste && !options?.allowRiskyPaste) {
    return {
      ok: false,
      requiresConfirmation: true,
      lineCount: lines,
      charCount,
      text: normalized,
      message: `检测到将向正在运行的 SSH 交互程序粘贴 ${lines} 行、${charCount} 个字符，发送前需要确认。\n\n预览：\n${buildClipboardPastePreview(normalized)}`,
    };
  }

  return {
    ok: true,
    requiresConfirmation: false,
    lineCount: lines,
    charCount,
    text: normalized,
    message: riskyPaste ? `已确认粘贴 ${lines} 行内容到当前 SSH 程序。` : "已粘贴到当前 SSH 程序。",
  };
}

function buildClipboardPastePreview(text = "", maxLines = 3, maxLineLength = 120) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => redactTerminalInputSecrets(line.trim()))
    .filter(Boolean);
  const visibleLines = lines.slice(0, maxLines).map((line) => {
    if (line.length <= maxLineLength) return line;
    return `${line.slice(0, maxLineLength)}...`;
  });
  if (lines.length > maxLines) visibleLines.push(`... 还有 ${lines.length - maxLines} 行`);
  return visibleLines.join("\n") || "[空内容]";
}

export function createHistoryCursor(draft = "") {
  return {
    index: -1,
    draft: String(draft || ""),
    value: String(draft || ""),
  };
}

export function getCommandHistoryKeyAction(event = {}) {
  const key = String(event?.key || "");
  const lowerKey = key.toLowerCase();
  if (key === "ArrowUp") return "older";
  if (key === "ArrowDown") return "newer";
  if (key === "Escape") return "restore";
  if (event?.ctrlKey && !event?.shiftKey && !event?.altKey && !event?.metaKey) {
    if (lowerKey === "p") return "older";
    if (lowerKey === "n") return "newer";
  }
  return "";
}

export function moveHistoryCursor(cursor, history, direction) {
  const entries = normalizeSafeCommandHistory(history);
  const current = cursor || createHistoryCursor();
  if (entries.length === 0) return { ...current, index: -1, value: current.draft };

  if (direction === "older") {
    const index = Math.min(current.index + 1, entries.length - 1);
    return { ...current, index, value: entries[index] };
  }

  const index = Math.max(current.index - 1, -1);
  return {
    ...current,
    index,
    value: index === -1 ? current.draft : entries[index],
  };
}

export function searchCommandHistory(history, query = "") {
  const draft = String(query || "");
  const entries = normalizeSafeCommandHistory(history);
  if (!entries.length) return { found: false, value: draft, query: draft };
  if (!draft.trim()) return { found: true, value: entries[0], query: draft };

  const normalizedQuery = draft.trim().toLowerCase();
  const match = entries.find((item) => item.toLowerCase().includes(normalizedQuery));
  return match
    ? { found: true, value: match, query: draft }
    : { found: false, value: draft, query: draft };
}

export function filterCommandHistory(history, query = "", limit = 8) {
  const maxItems = Math.max(0, Math.trunc(Number(limit) || 0));
  const entries = normalizeSafeCommandHistory(history);
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const matches = normalizedQuery ? entries.filter((item) => item.toLowerCase().includes(normalizedQuery)) : entries;
  return matches.slice(0, maxItems);
}

export function completeCommandDraft(draft = "", history = [], snippets = []) {
  const value = String(draft || "");
  const query = value.trim().toLowerCase();
  if (!query) return { completed: false, value, source: "" };

  const snippetMatches = (Array.isArray(snippets) ? snippets : [])
    .map((item) => String(item?.command || "").trim())
    .filter((command) => command && command.toLowerCase().startsWith(query));

  const historyMatches = normalizeSafeCommandHistory(history)
    .filter((command) => command && command.toLowerCase().startsWith(query));

  const candidates = [...new Set([...snippetMatches, ...historyMatches])];
  if (candidates.length === 1) {
    const source = snippetMatches.includes(candidates[0]) ? "snippet" : "history";
    return { completed: true, value: candidates[0], source };
  }
  if (candidates.length > 1) return { completed: false, value, source: "multiple", candidates };

  return { completed: false, value, source: "" };
}

function containsSensitiveCommandMaterial(command = "") {
  return /(^|\b|[-_])(authorization|bearer|api[-_ ]?key|access[-_ ]?key|secret|token|passwd|password|pwd)(\b|=|:|[-_]|$)|密码|密钥|令牌|口令|授权/i.test(String(command || ""));
}

function normalizeSafeCommandHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .map((item) => String(item || "").trim())
    .filter((command) => command && !/[\r\n]/.test(command) && !containsSensitiveCommandMaterial(command));
}

function clampTerminalFontSize(size) {
  const numericSize = Number.isFinite(Number(size)) ? Number(size) : DEFAULT_TERMINAL_FONT_SIZE;
  return Math.min(Math.max(Math.round(numericSize), MIN_TERMINAL_FONT_SIZE), MAX_TERMINAL_FONT_SIZE);
}

function normalizeCustomSnippets(snippets) {
  return (Array.isArray(snippets) ? snippets : [])
    .map((item) => {
      const command = String(item?.command || "").trim();
      const label = String(item?.label || command).trim();
      if (!command || !label) return null;
      return { label, command, custom: true };
    })
    .filter(Boolean);
}
