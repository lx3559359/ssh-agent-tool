import { buildConnectionQuickFixActions, buildSshConnectionDiagnostics } from "./connectionState.js";
import { buildOpenSshConfigExport } from "./backupData.js";
import { normalizeSftpBookmarks } from "./sftpBookmarks.js";

export function buildCustomServer(form, existingServer = {}) {
  const name = String(form?.name || "").trim();
  const host = String(form?.host || form?.ip || "").trim();
  const user = String(form?.user || "root").trim() || "root";
  const port = String(form?.port || "22").trim() || "22";
  const group = String(form?.group || "自定义").trim() || "自定义";
  const cwd = String(form?.cwd || `/home/${user}`).trim() || `/home/${user}`;
  const credentialRef = String(form?.credentialRef || existingServer.credentialRef || "").trim();
  const authType = normalizeServerAuthType(form?.authType || existingServer.authType || "密码");
  const identityFile = String(
    Object.prototype.hasOwnProperty.call(form || {}, "identityFile") ? form.identityFile || existingServer.identityFile || "" : existingServer.identityFile || "",
  ).trim();
  const proxyJump = String(
    Object.prototype.hasOwnProperty.call(form || {}, "proxyJump") ? form.proxyJump || existingServer.proxyJump || "" : existingServer.proxyJump || "",
  ).trim();
  const hostKeyAlias = String(
    Object.prototype.hasOwnProperty.call(form || {}, "hostKeyAlias") ? form.hostKeyAlias || existingServer.hostKeyAlias || "" : existingServer.hostKeyAlias || "",
  ).trim();
  const forwardAgent = Object.prototype.hasOwnProperty.call(form || {}, "forwardAgent")
    ? Boolean(form.forwardAgent)
    : Boolean(existingServer.forwardAgent);
  const localForwards = normalizeServerForwardList(
    Object.prototype.hasOwnProperty.call(form || {}, "localForwards") ? form.localForwards : existingServer.localForwards,
    "local",
  );
  const remoteForwards = normalizeServerForwardList(
    Object.prototype.hasOwnProperty.call(form || {}, "remoteForwards") ? form.remoteForwards : existingServer.remoteForwards,
    "remote",
  );
  const dynamicForwards = normalizeServerForwardList(
    Object.prototype.hasOwnProperty.call(form || {}, "dynamicForwards") ? form.dynamicForwards : existingServer.dynamicForwards,
    "dynamic",
  );
  const note = String(form?.note || "").trim();
  const rawTags = Object.prototype.hasOwnProperty.call(form || {}, "tags") ? form.tags : existingServer.tags;
  const tags = normalizeServerTags(rawTags);
  const timeoutSeconds = normalizeConnectionTimeout(
    Object.prototype.hasOwnProperty.call(form || {}, "timeoutSeconds") ? form.timeoutSeconds : existingServer.timeoutSeconds,
  );
  const retryCount = normalizeConnectionRetries(
    Object.prototype.hasOwnProperty.call(form || {}, "retryCount") ? form.retryCount : existingServer.retryCount,
  );
  const keepaliveSeconds = normalizeKeepaliveSeconds(
    Object.prototype.hasOwnProperty.call(form || {}, "keepaliveSeconds") ? form.keepaliveSeconds : existingServer.keepaliveSeconds,
  );
  const keepaliveCountMax = normalizeKeepaliveCountMax(
    Object.prototype.hasOwnProperty.call(form || {}, "keepaliveCountMax") ? form.keepaliveCountMax : existingServer.keepaliveCountMax,
  );
  const isFavorite = normalizeServerFavorite(form, existingServer);
  const sftpBookmarks = normalizeSftpBookmarks(
    Object.prototype.hasOwnProperty.call(form || {}, "sftpBookmarks") ? form.sftpBookmarks : existingServer.sftpBookmarks,
  );

  return {
    [name]: {
      ip: host,
      port,
      group,
      state: existingServer.state || "未测试",
      tone: existingServer.tone || "amber",
      user,
      cwd,
      latency: existingServer.latency || "--",
      timeoutSeconds,
      retryCount,
      keepaliveSeconds,
      keepaliveCountMax,
      policy: String(form?.policy || existingServer.policy || (group.includes("生产") ? "生产确认策略" : "默认确认策略")),
      authType,
      identityFile,
      proxyJump,
      hostKeyAlias,
      forwardAgent,
      ...(localForwards.length ? { localForwards } : {}),
      ...(remoteForwards.length ? { remoteForwards } : {}),
      ...(dynamicForwards.length ? { dynamicForwards } : {}),
      credentialRef,
      hasCredential: Boolean(credentialRef),
      note,
      tags,
      isFavorite,
      ...(sftpBookmarks.length ? { sftpBookmarks } : {}),
      terminal: buildTerminalIntro({ name, host, user, port, credentialRef }),
      files: [
        { type: "folder", name: cwd, meta: "默认目录" },
        { type: "file", name: "连接说明.txt", meta: "连接配置" },
      ],
      plan: ["测试 SSH 端口连通性", "验证认证方式", "读取系统基础信息", "生成首次巡检建议"],
      evidence: [
        { label: "host", value: `${host}:${port}` },
        { label: "auth", value: authType },
        ...(proxyJump ? [{ label: "proxyJump", value: proxyJump }] : []),
        ...(hostKeyAlias ? [{ label: "hostKeyAlias", value: hostKeyAlias }] : []),
        ...(forwardAgent ? [{ label: "forwardAgent", value: "yes" }] : []),
      ],
    },
  };
}

export function buildVisibleServerMap(builtinServers = {}, customServers = {}, hiddenBuiltinNames = []) {
  const hidden = new Set(
    (Array.isArray(hiddenBuiltinNames) ? hiddenBuiltinNames : [])
      .map((name) => String(name || "").trim())
      .filter(Boolean),
  );
  const visibleBuiltins = Object.fromEntries(
    Object.entries(builtinServers || {}).filter(([name]) => !hidden.has(name)),
  );
  return { ...visibleBuiltins, ...(customServers || {}) };
}

export function normalizeConnectionTimeout(value, fallback = 10) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  const timeout = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(timeout, 3), 60);
}

export function normalizeConnectionRetries(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  const retries = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(retries, 0), 3);
}

export function normalizeKeepaliveSeconds(value, fallback = 30) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (Number.isFinite(parsed) && parsed <= 0) return 0;
  const keepalive = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(keepalive, 10), 300);
}

export function normalizeKeepaliveCountMax(value, fallback = 3) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  const count = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(count, 0), 10);
}

export function normalizeServerAuthType(value = "") {
  const text = String(value || "").trim();
  const lower = text.toLowerCase();
  if (["password", "passwd", "pwd", "密码"].includes(lower)) return "密码";
  if (["key", "privatekey", "private-key", "private key", "identityfile", "identity-file", "私钥"].includes(lower)) return "私钥";
  if (["agent", "ssh-agent", "ssh agent"].includes(lower)) return "SSH Agent";
  return text || "密码";
}

function normalizePortNumber(value, fallback = 22) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

export function buildSshSessionLogContext(serverName = "", server = {}) {
  const safeServer = server && typeof server === "object" ? server : {};
  const context = {
    server: String(serverName || safeServer.name || "").trim(),
    host: String(safeServer.ip || safeServer.host || "").trim(),
    port: normalizePortNumber(safeServer.port),
    user: String(safeServer.user || "root").trim() || "root",
    authType: String(safeServer.authType || "").trim(),
    timeoutSeconds: normalizeConnectionTimeout(safeServer.timeoutSeconds, 10),
    retryCount: normalizeConnectionRetries(safeServer.retryCount, 0),
    keepaliveSeconds: normalizeKeepaliveSeconds(safeServer.keepaliveSeconds, 30),
    proxyJump: String(safeServer.proxyJump || "").trim(),
    identityFile: String(safeServer.identityFile || "").trim(),
  };
  if (Object.prototype.hasOwnProperty.call(safeServer, "keepaliveCountMax")) {
    context.keepaliveCountMax = normalizeKeepaliveCountMax(safeServer.keepaliveCountMax, 3);
  }
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== "" && value !== null && value !== undefined),
  );
}

export function buildServerContextActionModel(name = "", options = {}) {
  const serverName = String(name || "").trim();
  const server = options?.server && typeof options.server === "object" ? options.server : {};
  const session = options?.session && typeof options.session === "object" ? options.session : {};
  const isCustomServer = Boolean(options?.isCustomServer);
  const hasAuth = hasUsableServerAuth(server);
  const isConnected = Boolean(session.sessionId);
  const isBusy = Boolean(session.busy);
  const isSftpBusy = Boolean(options?.sftpBusy);

  return {
    title: serverName,
    items: [
      { id: "connect", label: "连接 SSH", disabled: isBusy || isConnected || !hasAuth },
      { id: "open-server-new-terminal-tab", label: "打开新终端标签" },
      { id: "connect-server-new-terminal-tab", label: "连接到新终端标签", disabled: isBusy || !hasAuth },
      { id: "interrupt-server-command", label: "中断当前命令", disabled: !isConnected },
      { id: "reconnect-server-session", label: "重连 SSH 会话", disabled: isBusy || !hasAuth },
      { id: "disconnect-server-session", label: isBusy ? "强制断开会话" : "断开当前会话", disabled: !isConnected },
      { id: "separator-sftp", separator: true },
      { id: "open-sftp", label: "打开 SFTP 文件", disabled: !hasAuth || isSftpBusy },
      { id: "refresh-sftp", label: "刷新 SFTP 目录", disabled: !hasAuth || isSftpBusy },
      { id: "upload-sftp", label: "上传文件到当前目录", disabled: !hasAuth || isSftpBusy },
      { id: "separator-diagnostic", separator: true },
      { id: "test", label: "测试连接" },
      { id: "basic", label: "读取基础信息" },
      { id: "server-session-logs", label: "查看会话日志" },
      { id: "server-tool-logs", label: "查看工具日志" },
      { id: "server-diagnostic-package", label: "导出诊断包" },
      { id: "server-auth-center", label: "认证中心" },
      { id: "separator-copy", separator: true },
      { id: "copy-ssh-command", label: "复制 SSH 命令", shortcut: "Ctrl+Shift+Y" },
      { id: "copy-server-info", label: "复制连接信息" },
      { id: "copy-openssh-config", label: "复制 OpenSSH Config" },
      { id: "copy-troubleshooting-summary", label: "复制排障摘要" },
      { id: "separator-manage", separator: true },
      { id: "toggle-server-favorite", label: server.isFavorite ? "取消固定服务器" : "固定服务器", disabled: !isCustomServer },
      { id: "edit", label: isCustomServer ? "编辑服务器" : "转为自定义并编辑", shortcut: "Ctrl+Shift+I" },
      { id: "duplicate-server-as-new-host", label: "复制为新连接" },
      { id: "export", label: "导出连接档案" },
      { id: "backup-server", label: "备份此服务器" },
      { id: "delete", label: isCustomServer ? "删除服务器" : "从列表隐藏", shortcut: "Delete", danger: true },
    ],
  };
}

export function validateServerConnectionForm(form = {}, existingNames = [], initialName = "") {
  const name = String(form?.name ?? "").trim();
  if (!name) {
    return { ok: false, field: "name", message: "请填写连接名称。" };
  }

  const host = String(form?.host ?? form?.ip ?? "").trim();
  if (!host) {
    return { ok: false, field: "host", message: "请填写服务器地址。" };
  }

  const currentName = String(initialName ?? "").trim();
  const duplicateNames = new Set(
    (Array.isArray(existingNames) ? existingNames : [])
      .map((item) => String(item ?? "").trim())
      .filter(Boolean),
  );
  if (duplicateNames.has(name) && name !== currentName) {
    return { ok: false, field: "name", message: "连接名称已存在，请换一个名称。" };
  }

  if (!isValidSshPort(form?.port ?? "22")) {
    return { ok: false, field: "port", message: "端口必须是 1-65535 之间的数字。" };
  }

  if (!isIntegerInRange(form?.timeoutSeconds ?? "10", 3, 60)) {
    return { ok: false, field: "timeoutSeconds", message: "连接超时必须是 3-60 秒之间的数字。" };
  }

  if (!isIntegerInRange(form?.retryCount ?? "0", 0, 3)) {
    return { ok: false, field: "retryCount", message: "重试次数必须是 0-3 之间的数字。" };
  }

  if (!isIntegerInRange(form?.keepaliveSeconds ?? "30", 0, 300)) {
    return { ok: false, field: "keepaliveSeconds", message: "SSH 保活间隔必须是 0-300 秒之间的数字，0 表示关闭。" };
  }

  if (!isIntegerInRange(form?.keepaliveCountMax ?? "3", 0, 10)) {
    return { ok: false, field: "keepaliveCountMax", message: "ServerAliveCountMax \u5fc5\u987b\u662f 0-10 \u4e4b\u95f4\u7684\u6570\u5b57\u3002" };
  }

  const authType = normalizeServerAuthType(form?.authType ?? "");
  const isPrivateKeyAuth = authType === "私钥";
  const hasPrivateKey = Boolean(
    String(form?.identityFile ?? "").trim() ||
      String(form?.credentialSecret ?? "").trim() ||
      String(form?.credentialRef ?? "").trim(),
  );
  if (isPrivateKeyAuth && !hasPrivateKey) {
    return { ok: false, field: "identityFile", message: "私钥认证需要填写私钥路径，或选择/粘贴私钥内容。" };
  }

  return { ok: true, field: "", message: "" };
}

function isIntegerInRange(value, min, max) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return false;
  const number = Number.parseInt(text, 10);
  return number >= min && number <= max;
}

function shellArg(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

export function parseSshCommandToServerForm(command = "") {
  let args = tokenizeShellCommand(command);
  if (args.length === 1 && looksLikeLightweightSshTarget(args[0])) {
    args = ["ssh", args[0]];
  }
  if (!args.length || !isSshCommandExecutable(args[0])) {
    return { ok: false, message: "请粘贴以 ssh 开头的连接命令。" };
  }

  const draft = {
    port: "22",
    user: "",
    hostName: "",
    identityFile: "",
    proxyJump: "",
    hostKeyAlias: "",
    timeoutSeconds: "10",
    retryCount: "0",
    keepaliveSeconds: "30",
    keepaliveCountMax: "",
    forwardAgent: null,
    localForwards: [],
    remoteForwards: [],
    dynamicForwards: [],
  };
  let target = "";

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "-p" && args[index + 1]) {
      draft.port = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("-p") && arg.length > 2) {
      draft.port = arg.slice(2);
      continue;
    }
    if (arg === "-i" && args[index + 1]) {
      draft.identityFile = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("-i") && arg.length > 2) {
      draft.identityFile = arg.slice(2);
      continue;
    }
    if (arg === "-J" && args[index + 1]) {
      draft.proxyJump = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("-J") && arg.length > 2) {
      draft.proxyJump = arg.slice(2);
      continue;
    }
    if (arg === "-l" && args[index + 1]) {
      draft.user = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("-l") && arg.length > 2) {
      draft.user = arg.slice(2);
      continue;
    }
    if (arg === "-A") {
      draft.forwardAgent = true;
      continue;
    }
    if (arg === "-a") {
      draft.forwardAgent = false;
      continue;
    }
    if (arg === "-L" && args[index + 1]) {
      appendParsedForward(draft.localForwards, parseOpenSshLocalForward(args[index + 1]));
      index += 1;
      continue;
    }
    if (arg.startsWith("-L") && arg.length > 2) {
      appendParsedForward(draft.localForwards, parseOpenSshLocalForward(arg.slice(2)));
      continue;
    }
    if (arg === "-R" && args[index + 1]) {
      appendParsedForward(draft.remoteForwards, parseOpenSshRemoteForward(args[index + 1]));
      index += 1;
      continue;
    }
    if (arg.startsWith("-R") && arg.length > 2) {
      appendParsedForward(draft.remoteForwards, parseOpenSshRemoteForward(arg.slice(2)));
      continue;
    }
    if (arg === "-D" && args[index + 1]) {
      appendParsedForward(draft.dynamicForwards, parseOpenSshDynamicForward(args[index + 1]));
      index += 1;
      continue;
    }
    if (arg.startsWith("-D") && arg.length > 2) {
      appendParsedForward(draft.dynamicForwards, parseOpenSshDynamicForward(arg.slice(2)));
      continue;
    }
    if (arg === "-o" && args[index + 1]) {
      const optionText = args[index + 1];
      if (isSshOptionKeyOnly(optionText) && args[index + 2] && !args[index + 2].startsWith("-")) {
        applySshOptionToDraft(draft, `${optionText} ${args[index + 2]}`);
        index += 2;
      } else {
        applySshOptionToDraft(draft, optionText);
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("-o") && arg.length > 2) {
      applySshOptionToDraft(draft, arg.slice(2));
      continue;
    }
    if (arg.startsWith("-")) {
      const optionValueCount = sshOptionValueCount(arg);
      index += optionValueCount;
      continue;
    }
    target = arg;
  }

  const parsedTarget = parseSshTarget(target, draft.user);
  if (!parsedTarget.host && !draft.hostName) {
    return { ok: false, message: "没有识别到 SSH 目标主机，请确认命令包含 user@host 或 host。" };
  }

  const user = parsedTarget.user || draft.user || "root";
  const host = draft.hostName || parsedTarget.host;
  const port = parsedTarget.port || draft.port;
  const name = sanitizeImportedServerName(draft.hostName && parsedTarget.host ? parsedTarget.host : host);
  const authType = draft.identityFile ? "私钥" : "未绑定凭据";
  return {
    ok: true,
    form: {
      name,
      host,
      user,
      port: String(normalizePortNumber(port, 22)),
      group: "SSH 命令导入",
      authType,
      identityFile: draft.identityFile,
      proxyJump: draft.proxyJump,
      ...(draft.hostKeyAlias ? { hostKeyAlias: draft.hostKeyAlias } : {}),
      timeoutSeconds: String(normalizeConnectionTimeout(draft.timeoutSeconds, 10)),
      retryCount: String(normalizeConnectionRetries(draft.retryCount, 0)),
      keepaliveSeconds: String(normalizeKeepaliveSeconds(draft.keepaliveSeconds, 30)),
      ...(draft.keepaliveCountMax ? { keepaliveCountMax: String(normalizeKeepaliveCountMax(draft.keepaliveCountMax, 3)) } : {}),
      ...(draft.forwardAgent !== null ? { forwardAgent: draft.forwardAgent } : {}),
      ...(draft.localForwards.length ? { localForwards: draft.localForwards } : {}),
      ...(draft.remoteForwards.length ? { remoteForwards: draft.remoteForwards } : {}),
      ...(draft.dynamicForwards.length ? { dynamicForwards: draft.dynamicForwards } : {}),
      cwd: `/home/${user}`,
      note: "从 SSH 命令导入，已解析端口、用户、私钥、ProxyJump 和常用连接参数。",
      tags: "ssh-command-import",
    },
  };
}

function isSshCommandExecutable(value = "") {
  const executable = String(value || "").trim().replaceAll("\\", "/").split("/").pop().toLowerCase();
  return executable === "ssh" || executable === "ssh.exe";
}

function tokenizeShellCommand(command = "") {
  const text = String(command || "").trim();
  const tokens = [];
  let current = "";
  let quote = "";
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      const nextChar = text[index + 1] || "";
      if (nextChar && /[\s'"\\]/.test(nextChar)) {
        escaping = true;
      } else {
        current += char;
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping) current += "\\";
  if (current) tokens.push(current);
  return tokens;
}

function applySshOptionToDraft(draft, option = "") {
  const text = String(option || "").trim();
  const equalsIndex = text.indexOf("=");
  const spaceMatch = equalsIndex < 0 ? text.match(/^(\S+)\s+(.+)$/) : null;
  const rawKey = equalsIndex >= 0 ? text.slice(0, equalsIndex) : spaceMatch?.[1] || text;
  const rawValue = equalsIndex >= 0 ? text.slice(equalsIndex + 1) : spaceMatch?.[2] || "";
  const key = rawKey.trim().toLowerCase();
  const value = rawValue.trim();
  if (!key || !value) return;
  if (key === "connecttimeout") draft.timeoutSeconds = value;
  if (key === "connectionattempts") draft.retryCount = String(Math.max(Number.parseInt(value, 10) - 1, 0));
  if (key === "serveraliveinterval") draft.keepaliveSeconds = value;
  if (key === "serveralivecountmax") draft.keepaliveCountMax = value;
  if (key === "proxyjump") draft.proxyJump = value;
  if (key === "hostkeyalias") draft.hostKeyAlias = value;
  if (key === "identityfile") draft.identityFile = value;
  if (key === "hostname") draft.hostName = value;
  if (key === "user") draft.user = value;
  if (key === "port") draft.port = value;
  if (key === "forwardagent") draft.forwardAgent = normalizeOpenSshBooleanOption(value);
}

function normalizeOpenSshBooleanOption(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return ["yes", "true", "on", "1"].includes(text);
}

function isSshOptionKeyOnly(option = "") {
  const text = String(option || "").trim();
  return Boolean(text) && !text.includes("=") && !/\s/.test(text);
}

function sshOptionValueCount(option = "") {
  const normalized = String(option || "").trim();
  return new Set(["-b", "-c", "-D", "-E", "-e", "-F", "-I", "-L", "-l", "-m", "-O", "-p", "-Q", "-R", "-S", "-W", "-w"]).has(normalized) ? 1 : 0;
}

function parseSshTarget(target = "", fallbackUser = "") {
  const text = String(target || "").trim();
  if (!text) return { user: fallbackUser, host: "" };
  if (/^ssh:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      return {
        user: decodeURIComponent(url.username || "") || fallbackUser,
        host: url.hostname,
        port: url.port,
      };
    } catch {
      return { user: fallbackUser, host: "" };
    }
  }
  const atIndex = text.lastIndexOf("@");
  if (atIndex > 0) {
    const parsedHost = parseHostPortTarget(text.slice(atIndex + 1).trim());
    return {
      user: text.slice(0, atIndex).trim() || fallbackUser,
      host: parsedHost.host,
      port: parsedHost.port,
    };
  }
  const parsedHost = parseHostPortTarget(text);
  return { user: fallbackUser, host: parsedHost.host, port: parsedHost.port };
}

function looksLikeLightweightSshTarget(value = "") {
  const text = String(value || "").trim();
  if (!text || /\s/.test(text) || text.startsWith("-")) return false;
  if (/^ssh:\/\//i.test(text)) return true;
  if (text.includes("/")) return false;
  return /^[^@]+@[^:]+(?::\d{1,5})?$/.test(text) || /^[A-Za-z0-9_.-]+(?::\d{1,5})?$/.test(text);
}

function parseHostPortTarget(value = "") {
  const text = String(value || "").trim();
  const match = text.match(/^\[([^\]]+)\]:(\d{1,5})$/) || text.match(/^([^:]+):(\d{1,5})$/);
  if (match) {
    return { host: match[1], port: match[2] };
  }
  return { host: text, port: "" };
}

function sanitizeImportedServerName(host = "") {
  return String(host || "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/[:/\\\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "ssh-import";
}

function normalizeServerForwardList(value, kind) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      if (kind === "dynamic") {
        const bindHost = String(item?.bindHost || "127.0.0.1").trim() || "127.0.0.1";
        const bindPort = String(item?.bindPort || "").trim();
        return bindPort ? { bindHost, bindPort } : null;
      }
      if (kind === "remote") {
        const remoteHost = String(item?.remoteHost || "127.0.0.1").trim() || "127.0.0.1";
        const remotePort = String(item?.remotePort || "").trim();
        const localHost = String(item?.localHost || "").trim();
        const localPort = String(item?.localPort || "").trim();
        return remotePort && localHost && localPort ? { remoteHost, remotePort, localHost, localPort } : null;
      }
      const localHost = String(item?.localHost || "127.0.0.1").trim() || "127.0.0.1";
      const localPort = String(item?.localPort || "").trim();
      const remoteHost = String(item?.remoteHost || "").trim();
      const remotePort = String(item?.remotePort || "").trim();
      return localPort && remoteHost && remotePort ? { localHost, localPort, remoteHost, remotePort } : null;
    })
    .filter(Boolean);
}

function appendParsedForward(target, parsed) {
  if (parsed) target.push(parsed);
}

function parseOpenSshLocalForward(spec = "") {
  const parts = splitForwardSpec(spec);
  if (parts.length === 3) {
    return normalizeServerForwardList([{ localPort: parts[0], remoteHost: parts[1], remotePort: parts[2] }], "local")[0] || null;
  }
  if (parts.length >= 4) {
    return normalizeServerForwardList([{ localHost: parts[0], localPort: parts[1], remoteHost: parts[2], remotePort: parts[3] }], "local")[0] || null;
  }
  return null;
}

function parseOpenSshRemoteForward(spec = "") {
  const parts = splitForwardSpec(spec);
  if (parts.length === 3) {
    return normalizeServerForwardList([{ remotePort: parts[0], localHost: parts[1], localPort: parts[2] }], "remote")[0] || null;
  }
  if (parts.length >= 4) {
    return normalizeServerForwardList([{ remoteHost: parts[0], remotePort: parts[1], localHost: parts[2], localPort: parts[3] }], "remote")[0] || null;
  }
  return null;
}

function parseOpenSshDynamicForward(spec = "") {
  const parts = splitForwardSpec(spec);
  if (parts.length === 1) {
    return normalizeServerForwardList([{ bindPort: parts[0] }], "dynamic")[0] || null;
  }
  if (parts.length >= 2) {
    return normalizeServerForwardList([{ bindHost: parts[0], bindPort: parts[1] }], "dynamic")[0] || null;
  }
  return null;
}

function splitForwardSpec(spec = "") {
  return String(spec || "")
    .trim()
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function buildServerCopySshCommand(name, server = {}) {
  const host = String(server.ip || server.host || "").trim();
  const user = String(server.user || "root").trim() || "root";
  const port = String(server.port || "22").trim() || "22";
  if (!host) return "";

  const parts = ["ssh"];
  if (server.identityFile) {
    parts.push("-i", shellArg(server.identityFile));
    parts.push("-o", "IdentitiesOnly=yes");
  }
  if (server.proxyJump) {
    parts.push("-J", shellArg(server.proxyJump));
  }
  if (server.hostKeyAlias) {
    parts.push("-o", shellArg(`HostKeyAlias=${server.hostKeyAlias}`));
  }
  if (server.forwardAgent) {
    parts.push("-A");
  }
  const timeoutSeconds = normalizeConnectionTimeout(server.timeoutSeconds, 10);
  if (timeoutSeconds !== 10) {
    parts.push("-o", `ConnectTimeout=${timeoutSeconds}`);
  }
  const retryCount = normalizeConnectionRetries(server.retryCount, 0);
  if (retryCount > 0) {
    parts.push("-o", `ConnectionAttempts=${retryCount + 1}`);
  }
  const keepaliveSeconds = normalizeKeepaliveSeconds(server.keepaliveSeconds, 30);
  const keepaliveCountMax = normalizeKeepaliveCountMax(server.keepaliveCountMax, 3);
  if (keepaliveSeconds !== 30 || keepaliveCountMax !== 3) {
    parts.push("-o", `ServerAliveInterval=${keepaliveSeconds}`);
    parts.push("-o", `ServerAliveCountMax=${keepaliveCountMax}`);
  }
  normalizeServerForwardList(server.localForwards, "local").forEach((forward) => {
    parts.push("-L", shellArg(`${forward.localHost}:${forward.localPort}:${forward.remoteHost}:${forward.remotePort}`));
  });
  normalizeServerForwardList(server.remoteForwards, "remote").forEach((forward) => {
    parts.push("-R", shellArg(`${forward.remoteHost}:${forward.remotePort}:${forward.localHost}:${forward.localPort}`));
  });
  normalizeServerForwardList(server.dynamicForwards, "dynamic").forEach((forward) => {
    parts.push("-D", shellArg(`${forward.bindHost}:${forward.bindPort}`));
  });
  if (port !== "22") {
    parts.push("-p", shellArg(port));
  }
  parts.push(shellArg(`${user}@${host}`));
  return parts.filter(Boolean).join(" ");
}

export function buildServerCopyInfo(name, server = {}) {
  const sshCommand = buildServerCopySshCommand(name, server);
  const tags = normalizeServerTags(server.tags).join(", ");
  const authBound = Boolean(String(server.credentialRef || "").trim() || server.hasCredential);
  const rows = [
    ["服务器", name],
    ["主机", server.ip || server.host || ""],
    ["端口", server.port || "22"],
    ["用户", server.user || "root"],
    ["分组", server.group || ""],
    ["认证方式", `${server.authType || ""}${authBound ? "（已绑定凭据）" : "（未绑定凭据）"}`],
    ["私钥路径", server.identityFile || ""],
    ["ProxyJump", server.proxyJump || ""],
    ["连接超时", `${normalizeConnectionTimeout(server.timeoutSeconds, 10)} 秒`],
    ["重试次数", `${normalizeConnectionRetries(server.retryCount, 0)} 次`],
    ["SSH 保活", `${normalizeKeepaliveSeconds(server.keepaliveSeconds, 30)} 秒`],
    ["默认目录", server.cwd || ""],
    ["标签", tags],
    ["备注", server.note || ""],
    ["SSH 命令", sshCommand],
    ["安全说明", "连接信息不包含密码、私钥内容、模型密钥或本机凭据引用"],
  ];
  const summary = rows
    .filter(([, value]) => String(value || "").trim())
    .map(([label, value]) => `${label}：${value}`)
    .join("\n");
  const openSshConfig = buildProfileOpenSshConfig(name, server, new Date().toISOString());
  return [summary, openSshConfig ? `OpenSSH Config：\n${openSshConfig}` : ""].filter(Boolean).join("\n\n");
}

export function buildServerTroubleshootingSummary(name, server = {}) {
  const host = String(server.ip || server.host || "").trim();
  const port = String(server.port || "22").trim() || "22";
  const sshCommand = buildServerCopySshCommand(name, server);
  const authStatus = getServerAuthStatus(server);
  const diagnostics = server.sshDiagnostics || {};
  const diagnosticActions = Array.isArray(diagnostics.actions)
    ? diagnostics.actions.map((item) => item.label || item.id).filter(Boolean)
    : [];
  return [
    "SSH 服务器排障摘要",
    `服务器：${name}`,
    host ? `主机：${host}:${port}` : "",
    server.group ? `分组：${server.group}` : "",
    `用户：${server.user || "root"}`,
    `认证状态：${authStatus.label}`,
    `连接超时：${normalizeConnectionTimeout(server.timeoutSeconds, 10)} 秒`,
    `重试次数：${normalizeConnectionRetries(server.retryCount, 0)} 次`,
    `SSH 保活：${normalizeKeepaliveSeconds(server.keepaliveSeconds, 30)} 秒`,
    server.proxyJump ? `ProxyJump：${server.proxyJump}` : "",
    server.cwd ? `默认目录：${server.cwd}` : "",
    sshCommand ? `复现命令：${sshCommand}` : "",
    diagnostics.kind ? `诊断类型：${diagnostics.kind}` : "",
    diagnostics.title ? `诊断标题：${diagnostics.title}` : "",
    diagnostics.summary ? `诊断摘要：${diagnostics.summary}` : "",
    diagnosticActions.length ? `建议动作：${diagnosticActions.join("；")}` : "",
  ].filter(Boolean).join("\n");
}

function normalizeServerFavorite(form = {}, existingServer = {}) {
  let value = existingServer.isFavorite ?? existingServer.favorite ?? false;
  if (Object.prototype.hasOwnProperty.call(form || {}, "isFavorite")) {
    value = form.isFavorite;
  } else if (Object.prototype.hasOwnProperty.call(form || {}, "favorite")) {
    value = form.favorite;
  }

  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    return text === "true" || text === "1" || text === "yes";
  }
  return value === true || value === 1;
}

export function normalizeServerTags(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[,，;；\n]/);
  const seen = new Set();
  const tags = [];

  source.forEach((item) => {
    const tag = String(item || "").trim();
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(tag);
  });

  return tags;
}

export function filterServerGroups(servers, filters = {}) {
  const query = String(filters.query || "").trim().toLowerCase();
  const status = String(filters.status || "全部").trim() || "全部";
  const authStatus = String(filters.authStatus || "全部认证").trim() || "全部认证";
  const groups = [];
  const groupIndex = new Map();

  Object.entries(servers || {}).forEach(([name, server]) => {
    if (status !== "全部" && String(server?.state || "") !== status) return;
    if (authStatus !== "全部认证" && getServerAuthStatus(server).state !== authStatus) return;
    if (query && !serverMatchesQuery(name, server, query)) return;

    const group = String(server?.group || "未分组").trim() || "未分组";
    if (!groupIndex.has(group)) {
      groupIndex.set(group, groups.length);
      groups.push({ group, servers: [] });
    }
    groups[groupIndex.get(group)].servers.push([name, server]);
  });

  groups.forEach((group) => {
    group.servers = group.servers
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => {
        const favoriteRank = Number(Boolean(b.entry?.[1]?.isFavorite)) - Number(Boolean(a.entry?.[1]?.isFavorite));
        return favoriteRank || a.index - b.index;
      })
      .map(({ entry }) => entry);
  });

  return groups;
}

export function flattenServerGroupNames(groups) {
  return (Array.isArray(groups) ? groups : []).flatMap((group) =>
    (Array.isArray(group?.servers) ? group.servers : [])
      .map(([name]) => String(name || "").trim())
      .filter(Boolean),
  );
}

export function summarizeBatchServerResults(results) {
  const summary = { total: 0, ok: 0, failed: 0, skipped: 0 };
  (Array.isArray(results) ? results : []).forEach((result) => {
    summary.total += 1;
    const status = String(result?.status || "").trim();
    if (status === "ok") summary.ok += 1;
    else if (status === "skipped") summary.skipped += 1;
    else summary.failed += 1;
  });
  return summary;
}

export function buildConnectionCheckReport({ title = "批量连接校验报告", generatedAt = new Date().toISOString(), servers = {}, results = [] } = {}) {
  const safeResults = Array.isArray(results) ? results : [];
  const summary = summarizeBatchServerResults(safeResults);
  const lines = [
    `# ${String(title || "批量连接校验报告").trim() || "批量连接校验报告"}`,
    "",
    `生成时间：${generatedAt}`,
    "",
    `总数 ${summary.total}，成功 ${summary.ok}，失败 ${summary.failed}，跳过 ${summary.skipped}`,
    "",
    "| 服务器 | 地址 | 端口 | 用户 | 分组 | 状态 | 延迟 | 说明 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  safeResults.forEach((result) => {
    const name = String(result?.name || "").trim();
    const server = servers?.[name] || {};
    lines.push([
      name || "未知",
      server.ip || server.host || "",
      server.port || "22",
      server.user || "root",
      server.group || "",
      formatConnectionCheckStatus(result?.status),
      result?.latency || server.latency || "--",
      result?.message || "",
    ].map(markdownCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  });

  lines.push("", "说明：报告不会导出密码、私钥、凭据引用或 API Key。");
  return lines.join("\n");
}

export function buildConnectionCheckRepairPlan({ servers = {}, results = [] } = {}) {
  const safeResults = Array.isArray(results) ? results : [];
  const rows = safeResults
    .filter((result) => String(result?.status || "").trim() === "failed")
    .map((result) => {
      const name = String(result?.name || "").trim();
      const server = servers?.[name] || {};
      const diagnostics = buildSshConnectionDiagnostics({ ok: false, message: result?.message || "", ...result }, server);
      const actions = buildConnectionQuickFixActions(diagnostics, server);
      return {
        name,
        kind: diagnostics.kind,
        title: diagnostics.title,
        message: result?.message || diagnostics.summary,
        actions,
      };
    })
    .filter((row) => row.name);

  const summary = {
    total: safeResults.length,
    failed: rows.length,
    auth: rows.filter((row) => ["auth", "key-file", "agent-auth"].includes(row.kind)).length,
    network: rows.filter((row) => ["timeout", "refused", "dns", "handshake"].includes(row.kind)).length,
    hostKey: rows.filter((row) => row.kind === "host-key").length,
    algorithm: rows.filter((row) => row.kind === "algorithm").length,
    unknown: rows.filter((row) => !["auth", "key-file", "agent-auth", "timeout", "refused", "dns", "handshake", "host-key", "algorithm"].includes(row.kind)).length,
  };

  return {
    visible: rows.length > 0,
    summary,
    rows,
    primaryActions: buildConnectionCheckPrimaryRepairActions(summary),
  };
}

function buildConnectionCheckPrimaryRepairActions(summary = {}) {
  const actions = [];
  if (summary.auth > 0) {
    actions.push({ id: "repair-auth", label: "批量补录凭据", tone: "primary", target: "auth-center" });
  }
  if ((summary.network || 0) + (summary.hostKey || 0) + (summary.unknown || 0) > 0) {
    actions.push({ id: "queue-agent", label: "失败项交给 Agent", tone: "secondary", target: "agent-diagnostic" });
  }
  actions.push({ id: "export-report", label: "导出校验报告", tone: "secondary", target: "connection-report" });
  return actions;
}

export function buildServerProfileMarkdown({ generatedAt = new Date().toISOString(), servers = {}, latestConnectionCheck = null } = {}) {
  const entries = Object.entries(servers || {}).filter(([, server]) => server && typeof server === "object");
  const boundAuthCount = entries.filter(([, server]) => hasUsableServerAuth(server)).length;
  const latestResults = Array.isArray(latestConnectionCheck?.results) ? latestConnectionCheck.results : [];
  const latestResultByName = new Map(
    latestResults
      .map((result) => [String(result?.name || "").trim(), result])
      .filter(([name]) => name),
  );
  const lines = [
    "# SSH 服务器连接档案",
    "",
    `生成时间：${generatedAt}`,
    `服务器总数 ${entries.length}，已绑定认证 ${boundAuthCount}，未绑定认证 ${entries.length - boundAuthCount}`,
    latestConnectionCheck?.generatedAt ? `最近连接校验：${latestConnectionCheck.generatedAt}` : "",
    "",
    "说明：档案已脱敏，不包含凭据引用、密码、私钥或 API Key。",
  ].filter((line) => line !== "");

  entries.forEach(([name, server]) => {
    const authStatus = getServerAuthStatus(server);
    const tags = normalizeServerTags(server.tags).join(", ");
    const trustedHostKey = normalizeProfileHostKey(server.trustedHostKey || server.hostKey);
    const latestResult = latestResultByName.get(name);

    lines.push(
      "",
      `## ${name}`,
      "",
      "| 字段 | 内容 |",
      "| --- | --- |",
      profileRow("主机地址", server.ip || server.host || ""),
      profileRow("端口", server.port || "22"),
      profileRow("用户", server.user || "root"),
      profileRow("分组", server.group || ""),
      profileRow("状态", server.state || "未测试"),
      profileRow("延迟", server.latency || "--"),
      profileRow("认证状态", authStatus.label),
      profileRow("认证方式", server.authType || ""),
      profileRow("认证恢复建议", buildProfileAuthRecoveryAdvice(server)),
      profileRow("默认目录", server.cwd || ""),
      profileRow("连接超时", `${normalizeConnectionTimeout(server.timeoutSeconds)} 秒`),
      profileRow("重试次数", `${normalizeConnectionRetries(server.retryCount)} 次`),
      profileRow("SSH 保活", `${normalizeKeepaliveSeconds(server.keepaliveSeconds)} 秒`),
      profileRow("命令策略", server.policy || ""),
      profileRow("SSH 命令", wrapMarkdownCode(buildServerCopySshCommand(name, server))),
      profileRow("标签", tags),
      profileRow("ProxyJump", server.proxyJump || ""),
      profileRow("LocalForward", formatProfileLocalForwards(server)),
      profileRow("RemoteForward", formatProfileRemoteForwards(server)),
      profileRow("DynamicForward", formatProfileDynamicForwards(server)),
      profileRow("主机指纹", trustedHostKey),
      profileRow("最近校验", formatProfileConnectionCheck(latestResult)),
      profileRow("排障建议", buildProfileTroubleshootingAdvice(server, latestResult)),
      profileRow("备注", server.note || ""),
    );

    const bookmarks = buildProfileSftpBookmarks(server);
    if (bookmarks.length > 0) {
      lines.push("", "SFTP 书签：", ...bookmarks.map((item) => `- ${item}`));
    }
    const openSshConfig = buildProfileOpenSshConfig(name, server, generatedAt);
    if (openSshConfig) {
      lines.push("", "OpenSSH Config：", "```sshconfig", openSshConfig, "```");
    }
  });

  return lines.join("\n").trimEnd() + "\n";
}

export function buildImportFollowupPrompt({ source = "backup", importedNames = [], servers = {} } = {}) {
  const seen = new Set();
  const targetNames = (Array.isArray(importedNames) ? importedNames : [])
    .map((name) => String(name || "").trim())
    .filter((name) => {
      if (!name || seen.has(name) || !servers?.[name]) return false;
      seen.add(name);
      return true;
    });

  if (targetNames.length === 0) {
    return {
      visible: false,
      source,
      targetNames: [],
      title: "",
      message: "",
      actions: [],
    };
  }

  const sourceLabel = source === "ssh-config" ? "SSH 配置导入" : "备份导入";
  const readiness = buildImportReadinessSummary(targetNames, servers);
  return {
    visible: true,
    source,
    targetNames,
    readiness,
    title: `${sourceLabel}后校验`,
    message: `已导入 ${targetNames.length} 台服务器。${readiness.message} 建议先测试连通性，再读取基础信息或交给 Agent 巡检。`,
    actions: [
      { id: "test", label: "测试本次导入" },
      { id: "basic", label: "读取基础信息" },
      { id: "agent", label: "加入 Agent 巡检" },
    ],
  };
}

export function buildImportReadinessSummary(importedNames = [], servers = {}) {
  const seen = new Set();
  const names = (Array.isArray(importedNames) ? importedNames : [])
    .map((name) => String(name || "").trim())
    .filter((name) => {
      if (!name || seen.has(name) || !servers?.[name]) return false;
      seen.add(name);
      return true;
    });
  const summary = {
    total: names.length,
    ready: 0,
    missingAuth: 0,
    invalidAddress: 0,
    invalidPort: 0,
    proxyJump: 0,
    identityFile: 0,
    readyNames: [],
    needsAttention: [],
    message: "",
  };

  names.forEach((name) => {
    const server = servers[name] || {};
    const hasAddress = Boolean(String(server.ip || server.host || "").trim());
    const portValid = isValidSshPort(server.port || "22");
    const hasAuth = hasUsableServerAuth(server);
    if (!hasAddress) summary.invalidAddress += 1;
    if (!portValid) summary.invalidPort += 1;
    if (!hasAuth) summary.missingAuth += 1;
    if (String(server.proxyJump || "").trim()) summary.proxyJump += 1;
    if (String(server.identityFile || "").trim()) summary.identityFile += 1;
    if (hasAddress && portValid && hasAuth) {
      summary.ready += 1;
      summary.readyNames.push(name);
    } else {
      summary.needsAttention.push(name);
    }
  });

  summary.message = [
    `预检：${summary.total} 台服务器`,
    `可直接测试 ${summary.ready} 台`,
    `缺少认证 ${summary.missingAuth} 台`,
    `地址异常 ${summary.invalidAddress} 台`,
    `端口异常 ${summary.invalidPort} 台`,
    summary.proxyJump ? `包含 ProxyJump ${summary.proxyJump} 台` : "",
    summary.identityFile ? `包含私钥路径 ${summary.identityFile} 台` : "",
  ].filter(Boolean).join("，") + "。";

  return summary;
}

function isValidSshPort(value) {
  const text = String(value ?? "22").trim();
  if (!/^\d+$/.test(text)) return false;
  const port = Number.parseInt(text, 10);
  return port >= 1 && port <= 65535;
}

function formatConnectionCheckStatus(status) {
  const normalized = String(status || "").trim();
  if (normalized === "ok") return "成功";
  if (normalized === "skipped") return "跳过";
  return "失败";
}

function markdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function profileRow(label, value) {
  return `| ${markdownCell(label)} | ${markdownCell(value || "-")} |`;
}

function wrapMarkdownCode(value) {
  const text = String(value || "").trim();
  return text ? `\`${text.replace(/`/g, "\\`")}\`` : "";
}

function buildProfileOpenSshConfig(name, server, generatedAt) {
  return buildOpenSshConfigExport({ [name]: server }, { exportedAt: generatedAt })
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("#"))
    .join("\n")
    .trim();
}

function normalizeProfileForwardList(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function formatProfileForwardEndpoint(host, port, fallbackHost = "") {
  const hostText = String(host || fallbackHost || "").trim();
  const portText = String(port || "").trim();
  if (!portText) return "";
  return hostText ? `${hostText}:${portText}` : portText;
}

function joinProfileForwardSummaries(items) {
  return items.filter(Boolean).join("; ");
}

function formatProfileLocalForwards(server = {}) {
  return joinProfileForwardSummaries(
    normalizeProfileForwardList(server.localForwards).map((forward) => {
      const localSpec = formatProfileForwardEndpoint(forward.localHost, forward.localPort, "127.0.0.1");
      const remoteSpec = formatProfileForwardEndpoint(forward.remoteHost, forward.remotePort);
      return localSpec && remoteSpec ? `${localSpec} -> ${remoteSpec}` : "";
    }),
  );
}

function formatProfileRemoteForwards(server = {}) {
  return joinProfileForwardSummaries(
    normalizeProfileForwardList(server.remoteForwards).map((forward) => {
      const remoteSpec = formatProfileForwardEndpoint(forward.remoteHost, forward.remotePort, "127.0.0.1");
      const localSpec = formatProfileForwardEndpoint(forward.localHost, forward.localPort);
      return remoteSpec && localSpec ? `${remoteSpec} -> ${localSpec}` : "";
    }),
  );
}

function formatProfileDynamicForwards(server = {}) {
  return joinProfileForwardSummaries(
    normalizeProfileForwardList(server.dynamicForwards).map((forward) =>
      formatProfileForwardEndpoint(forward.bindHost, forward.bindPort, "127.0.0.1"),
    ),
  );
}

function formatProfileConnectionCheck(result) {
  if (!result) return "暂无";
  return [formatConnectionCheckStatus(result.status), result.latency || "--", result.message || ""]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" / ");
}

function buildProfileAuthRecoveryAdvice(server = {}) {
  const authType = normalizeServerAuthType(server?.authType || "密码");
  const identityFile = String(server?.identityFile || "").trim();
  if (String(server?.credentialRef || "").trim() || server?.hasCredential) {
    return "完整备份可恢复到本机加密凭据库";
  }
  if (authType === "私钥" && identityFile) {
    return "私钥文件不进入档案，新机器需准备相同路径或重新选择私钥";
  }
  if (authType === "SSH Agent") {
    return "需要确认 Windows OpenSSH Agent 已启动并已加载目标私钥";
  }
  return "导入后需要重新录入密码或选择私钥";
}

function buildProfileTroubleshootingAdvice(server = {}, result = null) {
  const status = String(result?.status || "").trim();
  const message = String(result?.message || "").trim();
  if (status === "ok") {
    return "连接正常。建议保留当前 OpenSSH Config、端口转发和主机指纹记录，后续变更前可先导出连接档案。";
  }
  if (!result) {
    return hasUsableServerAuth(server)
      ? "尚未执行连接校验。建议先测试连接，再根据结果查看会话日志或工具日志。"
      : "尚未执行连接校验，且当前缺少可用认证。请先绑定密码、私钥或 SSH Agent。";
  }
  const lowerMessage = message.toLowerCase();
  if (/permission denied|authentication|auth|publickey|password/.test(lowerMessage)) {
    return `最近校验失败：${message || "认证失败"}。请检查密码、私钥、SSH Agent 或服务器允许的认证方式。`;
  }
  if (/timed? out|timeout|超时|refused|network|unreachable|no route|connection reset|连接超时/.test(lowerMessage)) {
    return `最近校验失败：${message || "网络异常"}。请检查网络连通性、端口、防火墙、安全组和 ProxyJump 设置。`;
  }
  if (/host identification|host key|fingerprint|known_hosts|主机指纹/i.test(message)) {
    return `最近校验失败：${message}。请核对主机指纹，确认无风险后再更新信任记录。`;
  }
  if (/no matching|algorithm|kex|cipher|mac|ssh-rsa|算法/i.test(message)) {
    return `最近校验失败：${message}。请优先升级服务端 OpenSSH，必要时再评估兼容旧算法配置。`;
  }
  return `最近校验失败：${message || "原因未知"}。建议复制排障摘要给 Agent，并同时查看会话日志和工具日志。`;
}

function normalizeProfileHostKey(hostKey) {
  if (!hostKey || typeof hostKey !== "object") return "";
  return [hostKey.type, hostKey.sha256, hostKey.trustedAt ? `信任时间 ${hostKey.trustedAt}` : ""]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" / ");
}

function buildProfileSftpBookmarks(server = {}) {
  return (Array.isArray(server.files) ? server.files : [])
    .map((item) => {
      const name = String(item?.path || item?.name || "").trim();
      if (!name) return "";
      const meta = String(item?.meta || "").trim();
      return meta ? `${name}（${meta}）` : name;
    })
    .filter(Boolean);
}

export function getServerAuthStatus(server = {}) {
  const authType = normalizeServerAuthType(server?.authType || "密码");
  if (String(server?.credentialRef || "").trim() || server?.hasCredential) {
    return {
      label: `${authType}已绑定`,
      state: "已绑定",
      tone: "green",
    };
  }
  if (hasIdentityFileAuth(server)) {
    return {
      label: "私钥路径可用",
      state: "已绑定",
      tone: "green",
    };
  }
  if (hasSshAgentAuth(server)) {
    return {
      label: "SSH Agent 可用",
      state: "已绑定",
      tone: "green",
    };
  }
  if (authType === "密码") {
    return {
      label: "密码未绑定",
      state: "未绑定",
      tone: "amber",
    };
  }
  if (authType === "私钥") {
    return {
      label: "私钥未设置",
      state: "未绑定",
      tone: "amber",
    };
  }
  return {
    label: "未绑定凭据",
    state: "未绑定",
    tone: "amber",
  };
}

export function hasUsableServerAuth(server = {}) {
  return Boolean(String(server?.credentialRef || "").trim() || server?.hasCredential || hasIdentityFileAuth(server) || hasSshAgentAuth(server));
}

export function validateSshSessionOpenTarget(server = {}) {
  const host = String(server?.ip || server?.host || "").trim();
  const user = String(server?.user || "").trim();
  if (!host) {
    return { ok: false, field: "host", message: "当前服务器缺少主机地址，请先编辑连接并填写主机/IP。" };
  }
  if (!user) {
    return { ok: false, field: "user", message: "当前服务器缺少用户名，请先编辑连接并填写 SSH 用户名。" };
  }
  if (!hasUsableServerAuth(server)) {
    return { ok: false, field: "auth", message: "请先在认证中心绑定或填写 SSH 凭据。" };
  }
  return { ok: true, message: "" };
}

export function buildAuthCenterModel(serverName = "", server = {}) {
  const name = String(serverName || server?.name || "未选择服务器").trim() || "未选择服务器";
  const status = getServerAuthStatus(server);
  const ready = hasUsableServerAuth(server);
  const authType = normalizeServerAuthType(server?.authType || "密码");
  const identityFile = String(server?.identityFile || "").trim();
  const proxyJump = String(server?.proxyJump || "").trim();
  const timeoutSeconds = normalizeConnectionTimeout(server?.timeoutSeconds, 10);
  const retryCount = normalizeConnectionRetries(server?.retryCount, 0);
  const hostKey = server?.trustedHostKey || server?.hostKey || {};
  const hostKeySha256 = String(hostKey?.sha256 || "").trim();
  const hostKeyLabel = String(server?.hostKeyTrust?.label || (hostKeySha256 ? "已记录" : "未记录")).trim();
  const guidance = ready
    ? [`${name} 已具备可用认证，可以直接发起 SSH 连接。`, "如需更换密码、私钥或 ProxyJump，请编辑连接并重新保存认证。"]
    : [`${name} 尚未绑定可用认证。`, buildMissingAuthGuidance(authType)];

  if (proxyJump) {
    guidance.push(`当前会通过 ProxyJump：${proxyJump}`);
  }
  if (authType === "SSH Agent") {
    guidance.push("请确认 Windows OpenSSH Agent 已启动，并且目标私钥已添加到 Agent。");
  }
  if (identityFile && authType === "私钥") {
    guidance.push(`将使用私钥路径：${identityFile}`);
  }

  return {
    title: `${name} 认证中心`,
    serverName: name,
    ready,
    status,
    summaryItems: [
      { label: "认证方式", value: authType },
      { label: "凭据状态", value: status.label, tone: status.tone },
      { label: "私钥路径", value: identityFile || "未设置" },
      { label: "ProxyJump", value: proxyJump || "未设置" },
      { label: "连接超时", value: `${timeoutSeconds} 秒` },
      { label: "重试次数", value: `${retryCount} 次` },
      { label: "主机指纹", value: hostKeySha256 ? `${hostKeyLabel} / ${hostKeySha256}` : hostKeyLabel },
    ],
    guidance,
    primaryAction: { label: "编辑认证", target: name },
    secondaryAction: { label: "测试连接", target: name },
  };
}

function buildMissingAuthGuidance(authType = "") {
  if (authType === "密码") return "请保存 SSH 密码后再连接。";
  if (authType === "私钥") return "请选择私钥文件或填写私钥路径后再连接。";
  if (authType === "SSH Agent") return "请确认 Windows OpenSSH Agent 已启动，并且目标私钥已添加到 Agent。";
  return "请保存密码、选择私钥文件或路径，或切换为 SSH Agent 认证后再连接。";
}

function hasIdentityFileAuth(server = {}) {
  const authType = normalizeServerAuthType(server?.authType || "");
  return authType === "私钥" && Boolean(String(server?.identityFile || "").trim());
}

function hasSshAgentAuth(server = {}) {
  return normalizeServerAuthType(server?.authType || "") === "SSH Agent";
}

export function upsertCustomServer(currentServers, oldName, form) {
  const servers = { ...(currentServers || {}) };
  const existing = oldName ? servers[oldName] || {} : {};
  const next = buildCustomServer(form, existing);
  const [name] = Object.keys(next);

  if (oldName && oldName !== name) {
    delete servers[oldName];
  }
  return { servers: { ...servers, ...next }, name };
}

export function deleteCustomServer(currentServers, name) {
  const servers = { ...(currentServers || {}) };
  const existed = Object.prototype.hasOwnProperty.call(servers, name);
  if (existed) delete servers[name];
  return { servers, deleted: existed };
}

export function toggleCustomServerFavorite(currentServers, name, isFavorite) {
  const servers = { ...(currentServers || {}) };
  const serverName = String(name || "").trim();
  if (!serverName || !servers[serverName]) {
    return { servers, updated: false };
  }

  servers[serverName] = {
    ...servers[serverName],
    isFavorite: Boolean(isFavorite),
  };

  return { servers, updated: true };
}

export function trustHostKeyForServer(currentServers, name, hostKey, trustedAt = new Date().toISOString()) {
  const servers = { ...(currentServers || {}) };
  const serverName = String(name || "").trim();
  const sha256 = String(hostKey?.sha256 || "").trim();
  if (!serverName || !servers[serverName] || !sha256) {
    return { servers, trusted: false };
  }

  servers[serverName] = {
    ...servers[serverName],
    trustedHostKey: {
      type: String(hostKey?.type || "unknown").trim() || "unknown",
      sha256,
      trustedAt,
    },
  };

  return { servers, trusted: true };
}

export function revokeHostKeyTrustForServer(currentServers, name) {
  const servers = { ...(currentServers || {}) };
  const serverName = String(name || "").trim();
  const server = servers[serverName];
  if (!serverName || !server || !server.trustedHostKey?.sha256) {
    return { servers, revoked: false };
  }

  const evidence = (Array.isArray(server.evidence) ? server.evidence : []).filter(
    (item) => item?.label !== "指纹状态",
  );

  servers[serverName] = {
    ...server,
    trustedHostKey: undefined,
    hostKeyTrust: {
      status: "untrusted",
      label: "未信任",
      tone: "amber",
      message: "已撤销本工具保存的信任记录，请重新核对后再信任。",
    },
    evidence: [
      ...evidence,
      { label: "指纹状态", value: "未信任：已撤销本工具保存的信任记录，请重新核对后再信任。" },
    ],
  };

  return { servers, revoked: true };
}

export function batchUpdateCustomServers(currentServers, targetNames, patch = {}) {
  const servers = { ...(currentServers || {}) };
  const names = (Array.isArray(targetNames) ? targetNames : [])
    .map((name) => String(name || "").trim())
    .filter(Boolean);
  const skippedNames = [];
  let updated = 0;

  names.forEach((name) => {
    if (!servers[name]) {
      skippedNames.push(name);
      return;
    }

    const current = servers[name];
    const next = { ...current };
    const group = String(patch.group || "").trim();
    const policy = String(patch.policy || "").trim();
    const rawTags = Object.prototype.hasOwnProperty.call(patch || {}, "tags") ? patch.tags : undefined;
    const tags = rawTags === undefined ? [] : normalizeServerTags(rawTags);

    if (group) next.group = group;
    if (policy) next.policy = policy;
    if (tags.length > 0) next.tags = tags;

    servers[name] = next;
    updated += 1;
  });

  return {
    servers,
    updated,
    skipped: skippedNames.length,
    skippedNames,
  };
}

function serverMatchesQuery(name, server, query) {
  const fields = [
    name,
    server?.ip,
    server?.host,
    server?.user,
    server?.group,
    server?.state,
    server?.note,
    server?.policy,
    server?.authType,
    server?.proxyJump,
    ...(Array.isArray(server?.tags) ? server.tags : normalizeServerTags(server?.tags)),
  ];

  return fields.some((field) => String(field || "").toLowerCase().includes(query));
}

function buildTerminalIntro({ name, host, user, port, credentialRef }) {
  return [
    `[${user}@${name} ~]# ssh ${user}@${host} -p ${port}`,
    credentialRef ? "连接已保存，凭据已进入本机加密凭据库，可用于真实 SSH 登录。" : "连接已保存，等待绑定密码、私钥或 SSH Agent 后进行真实登录。",
    "",
    "当前工具会保存服务器信息、认证方式和策略；敏感凭据不会在界面明文展示。",
  ];
}
