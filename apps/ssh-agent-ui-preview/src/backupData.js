import { normalizePortForwardConfig } from "./portForwardSettings.js";
import { buildModelProfile, buildStoredModelConfig, normalizeModelProfiles } from "./modelSettings.js";
import { normalizeSftpBookmarks } from "./sftpBookmarks.js";

export const BACKUP_SCHEMA = "ssh-agent-tool.backup.v1";

const DEFAULT_SCOPE = {
  hosts: true,
  sftp: true,
  skills: true,
  mcp: true,
  cli: true,
  portForwards: true,
  commandSnippets: true,
  modelProfiles: true,
  secrets: false,
};

function normalizeBackupBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(normalized)) return true;
  if (["false", "no", "off", "0"].includes(normalized)) return false;
  return false;
}

export function buildBackupPayload({
  servers,
  scope = DEFAULT_SCOPE,
  agentCapabilities = [],
  portForwardPresets = [],
  commandSnippets = [],
  modelConfig = {},
  modelProfiles = [],
  exportedAt = new Date().toISOString(),
}) {
  const nextScope = { ...DEFAULT_SCOPE, ...scope };
  const includeSecrets = Boolean(nextScope.secrets);
  const capabilities = Array.isArray(agentCapabilities) ? agentCapabilities : [];
  const hosts = nextScope.hosts ? buildBackupHosts(servers, includeSecrets) : [];
  const sftpBookmarks = nextScope.sftp ? buildSftpBookmarks(servers) : [];
  const skills = nextScope.skills ? buildCapabilitiesByType(capabilities, "Skill") : [];
  const mcp = nextScope.mcp ? buildCapabilitiesByType(capabilities, "MCP", includeSecrets) : [];
  const cli = nextScope.cli ? buildCapabilitiesByType(capabilities, "CLI") : [];
  const portForwards = nextScope.portForwards ? buildPortForwardPresets(portForwardPresets) : [];
  const safeCommandSnippets = nextScope.commandSnippets ? buildCommandSnippets(commandSnippets) : [];
  const safeModelProfiles = nextScope.modelProfiles ? buildBackupModelProfiles(modelProfiles, modelConfig) : [];
  const safeModelConfig = nextScope.modelProfiles ? buildBackupModelConfig(modelConfig) : null;

  return {
    schema: BACKUP_SCHEMA,
    exportedAt,
    manifest: buildBackupManifest({
      exportedAt,
      includeSecrets,
      hosts,
      sftpBookmarks,
      skills,
      mcp,
      cli,
      portForwards,
      commandSnippets: safeCommandSnippets,
      modelProfiles: safeModelProfiles,
    }),
    encryption: includeSecrets
      ? {
          enabled: true,
          method: "需要桌面 API 加密",
          note: "浏览器预览不会导出敏感字段；exe 会使用备份主密码加密密码、私钥和口令短语。",
        }
      : {
          enabled: false,
          note: "未导出密码、私钥、口令短语等敏感字段。",
        },
    hosts,
    sftpBookmarks,
    skills,
    mcp,
    cli,
    portForwards,
    commandSnippets: safeCommandSnippets,
    modelConfig: safeModelConfig,
    modelProfiles: safeModelProfiles,
  };
}

export function buildBackupExportPreview({
  servers = {},
  scope = DEFAULT_SCOPE,
  agentCapabilities = [],
  portForwardPresets = [],
  commandSnippets = [],
  modelConfig = {},
  modelProfiles = [],
}) {
  const nextScope = { ...DEFAULT_SCOPE, ...scope };
  const capabilities = Array.isArray(agentCapabilities) ? agentCapabilities : [];
  const hosts = nextScope.hosts ? buildBackupHosts(servers || {}, Boolean(nextScope.secrets)) : [];
  const sftpBookmarkCount = nextScope.sftp ? countSftpBookmarkPaths(servers || {}) : 0;
  const skills = nextScope.skills ? buildCapabilitiesByType(capabilities, "Skill") : [];
  const mcp = nextScope.mcp ? buildCapabilitiesByType(capabilities, "MCP") : [];
  const cli = nextScope.cli ? buildCapabilitiesByType(capabilities, "CLI") : [];
  const portForwards = nextScope.portForwards ? buildPortForwardPresets(portForwardPresets) : [];
  const safeCommandSnippets = nextScope.commandSnippets ? buildCommandSnippets(commandSnippets) : [];
  const safeModelProfiles = nextScope.modelProfiles ? buildBackupModelProfiles(modelProfiles, modelConfig) : [];
  const modelProfileSummary = safeModelProfiles.length ? `、${safeModelProfiles.length} 个模型 API 档案` : "";
  const agentCapabilityCount = skills.length + mcp.length + cli.length;
  const encryptedCredentialCount = nextScope.secrets && nextScope.hosts
    ? hosts.filter((host) => Boolean(host.hasSecret)).length
    : 0;
  const sensitiveMcpHeaderCount = nextScope.secrets && nextScope.mcp ? countSensitiveMcpHeaders(mcp) : 0;

  return {
    requiresMasterPassword: Boolean(nextScope.secrets),
    summary: `将导出 ${hosts.length} 台 SSH 主机、${sftpBookmarkCount} 个 SFTP 书签、${agentCapabilityCount} 个 Agent 能力、${portForwards.length} 个端口转发预设、${safeCommandSnippets.length} 个命令片段${modelProfileSummary}。`,
    securityNote: nextScope.secrets
      ? `密码、私钥和口令短语会使用备份主密码加密；本次预计包含 ${encryptedCredentialCount} 个服务器凭据、${sensitiveMcpHeaderCount} 个敏感 MCP Header。`
      : "本次只导出脱敏配置，不包含密码、私钥、口令短语或 MCP Header 密钥。",
    stats: [
      { label: "SSH 主机", value: String(hosts.length) },
      { label: "SFTP 书签", value: String(sftpBookmarkCount) },
      { label: "Agent 能力", value: String(agentCapabilityCount) },
      { label: "端口转发", value: String(portForwards.length) },
      { label: "命令片段", value: String(safeCommandSnippets.length) },
      ...(safeModelProfiles.length ? [{ label: "模型档案", value: String(safeModelProfiles.length) }] : []),
      { label: "加密凭据", value: String(encryptedCredentialCount) },
      { label: "敏感 Header", value: String(sensitiveMcpHeaderCount) },
    ],
  };
}

export function buildBackupCenterModel(preview = {}, options = {}) {
  const historyCount = normalizeInteger(options.historyCount, 0, 0, Number.MAX_SAFE_INTEGER);
  const requiresMasterPassword = Boolean(preview?.requiresMasterPassword);

  return {
    title: "备份中心",
    summary: requiresMasterPassword
      ? "完整备份将使用主密码加密服务器密码、私钥和 MCP Header 密钥；清单类导出仍保持脱敏。"
      : "完整备份、服务器清单和 OpenSSH Config 均可直接导出；默认不会包含明文敏感信息。",
    exportCards: [
      {
        id: "backup-json",
        title: "完整备份 JSON",
        description: "迁移或恢复本工具配置，包含服务器、SFTP、Agent、MCP、CLI、端口转发和命令片段。",
        actionLabel: "导出完整备份",
        security: "可加密保存密码、私钥和 MCP Header 密钥；未勾选时只导出脱敏配置。",
        encryptedCapable: true,
        primary: true,
      },
      {
        id: "inventory-csv",
        title: "服务器清单 CSV",
        description: "导出服务器地址、端口、用户、分组、标签、凭据绑定状态和主机指纹，适合审计。",
        actionLabel: "导出清单",
        security: "不会导出密码、私钥、凭据引用、API Key 或 MCP Header 密钥。",
        encryptedCapable: false,
        primary: false,
      },
      {
        id: "openssh-config",
        title: "OpenSSH Config",
        description: "生成可复用的 Host、User、Port、ConnectTimeout、IdentityFile 和 ProxyJump 配置。",
        actionLabel: "导出 SSH Config",
        security: "不会导出密码；私钥只保留本机路径，便于在 ~/.ssh/config 中复用。",
        encryptedCapable: false,
        primary: false,
      },
    ],
    securityChecklist: [
      "默认导出为脱敏配置，不包含明文密码、私钥、Token 或 MCP Header 密钥。",
      "勾选“加密导出密码/密钥”后，敏感字段只写入主密码加密后的备份 JSON。",
      "CSV 清单和 OpenSSH Config 永远只导出连接元数据，适合分享和审计。",
    ],
    historyNote: historyCount > 0
      ? `已记录最近 ${historyCount} 次导出摘要，不保存备份正文或明文敏感信息。`
      : "尚无最近导出记录；后续只保存导出摘要，不保存备份正文或明文敏感信息。",
  };
}

export function buildBackupCredentialMatrix(servers = {}, options = {}) {
  const includeSecrets = Boolean(options.includeSecrets);
  const rows = Object.entries(servers || {})
    .filter(([, server]) => server && typeof server === "object")
    .map(([name, server]) => buildBackupCredentialRow(name, server, includeSecrets));
  const summary = rows.reduce(
    (totals, row) => {
      totals.total += 1;
      if (row.kind === "encrypted") totals.encryptedReady += 1;
      else if (row.kind === "path") totals.pathOnly += 1;
      else if (row.kind === "agent") totals.sshAgent += 1;
      else totals.missing += 1;
      return totals;
    },
    { total: 0, encryptedReady: 0, pathOnly: 0, sshAgent: 0, missing: 0 },
  );

  return {
    summary,
    rows,
    note: includeSecrets
      ? "已绑定的密码、私钥内容或口令短语会进入加密备份；私钥路径、SSH Agent 和未绑定凭据需要按清单手动确认。"
      : "当前为脱敏导出，不会写入密码、私钥内容或口令短语；恢复后需要重新录入敏感凭据。",
  };
}

export function buildBackupCredentialChecklistText(servers = {}, options = {}) {
  const includeSecrets = Boolean(options.includeSecrets);
  const exportedAt = String(options.exportedAt || new Date().toISOString());
  const matrix = options.matrix || buildBackupCredentialMatrix(servers, { includeSecrets });
  const summary = matrix.summary || {};
  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];

  return [
    "SSH Agent 凭据迁移清单",
    `生成时间：${exportedAt}`,
    `导出模式：${includeSecrets ? "完整加密备份" : "脱敏配置导出"}`,
    `统计：总数 ${summary.total || 0}，可加密恢复 ${summary.encryptedReady || 0}，私钥路径 ${summary.pathOnly || 0}，SSH Agent ${summary.sshAgent || 0}，需补录 ${summary.missing || 0}`,
    "",
    "说明：本清单不包含密码、私钥内容、口令短语或凭据引用。",
    "",
    ...rows.flatMap((row, index) => [
      `${index + 1}. ${row.name || "未命名服务器"}`,
      `   地址：${row.address || "--"}`,
      `   认证方式：${row.authType || "--"}`,
      `   恢复方式：${row.restoreMode || "--"}`,
      `   导出处理：${row.backupAction || "--"}`,
      `   迁移建议：${row.manualAction || "--"}`,
      "",
    ]),
  ].join("\n").trimEnd() + "\n";
}

function buildBackupCredentialRow(name, server, includeSecrets) {
  const authType = String(server?.authType || "密码").trim() || "密码";
  const address = [server?.user || "root", server?.ip || server?.host || ""].filter(Boolean).join("@");
  const hasCredential = Boolean(String(server?.credentialRef || "").trim() || server?.hasCredential);
  const identityFile = String(server?.identityFile || "").trim();

  const base = {
    name,
    address,
    authType,
    credentialState: hasCredential ? "已绑定凭据" : "未绑定凭据",
    canRestoreSecret: false,
  };

  if (hasCredential && includeSecrets) {
    return {
      ...base,
      kind: "encrypted",
      restoreMode: "加密恢复",
      canRestoreSecret: true,
      tone: "green",
      backupAction: "凭据会使用备份主密码加密写入完整备份。",
      manualAction: "导入时输入备份主密码即可恢复到本机加密凭据库。",
    };
  }

  if (hasCredential && !includeSecrets) {
    return {
      ...base,
      kind: "missing",
      restoreMode: "脱敏导出",
      tone: "amber",
      backupAction: "仅导出服务器连接元数据，不导出凭据内容。",
      manualAction: "未勾选加密导出，恢复后需要重新录入密码、私钥内容或口令短语。",
    };
  }

  if (authType === "私钥" && identityFile) {
    return {
      ...base,
      kind: "path",
      credentialState: "私钥路径可用",
      restoreMode: "路径恢复",
      tone: "blue",
      backupAction: "私钥路径会随服务器配置导出。",
      manualAction: "私钥文件本身不会进入备份，新机器上需要准备相同路径或重新选择私钥。",
    };
  }

  if (authType === "SSH Agent") {
    return {
      ...base,
      kind: "agent",
      credentialState: "SSH Agent 可用",
      restoreMode: "Agent 手动恢复",
      tone: "blue",
      backupAction: "会导出 SSH Agent 认证方式。",
      manualAction: "恢复后需要确认 Windows OpenSSH Agent 已启动，并把目标私钥添加到 SSH Agent。",
    };
  }

  return {
    ...base,
    kind: "missing",
    restoreMode: "需要补录",
    tone: "amber",
    backupAction: "没有可备份的凭据内容。",
    manualAction: "恢复后需要重新录入密码、选择私钥，或切换为 SSH Agent 认证。",
  };
}

export function validateBackupMasterPassword(password = "", confirmation = "", required = false) {
  const text = String(password || "");
  const confirmText = String(confirmation || "");

  if (!required) {
    return {
      valid: true,
      required: false,
      level: "none",
      score: 0,
      message: "本次导出不包含敏感凭据，无需备份主密码。",
    };
  }

  const checks = {
    length: text.length >= 8,
    upper: /[A-Z]/.test(text),
    lower: /[a-z]/.test(text),
    number: /\d/.test(text),
    symbol: /[^A-Za-z0-9]/.test(text),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const level = text.length >= 12 && score >= 4 ? "strong" : text.length >= 8 && score >= 3 ? "medium" : "weak";

  if (!checks.length) {
    return {
      valid: false,
      required: true,
      level,
      score,
      checks,
      message: "导出敏感信息时，备份主密码至少需要 8 位。",
    };
  }

  if (text !== confirmText) {
    return {
      valid: false,
      required: true,
      level,
      score,
      checks,
      message: "两次输入的备份主密码不一致。",
    };
  }

  return {
    valid: true,
    required: true,
    level,
    score,
    checks,
    message: level === "strong" ? "备份主密码强度高。" : "备份主密码可用，建议使用更长且包含大小写、数字和符号的密码。",
  };
}

export function buildBackupHistoryEntry({ payload = {}, target = "", scope = {}, exportedAt = "", exportResult = null } = {}) {
  const manifest = normalizeBackupManifest(payload.manifest) || {};
  const time = String(manifest.exportedAt || payload.exportedAt || exportedAt || new Date().toISOString()).trim();
  const normalizedTarget = String(target || "").trim();
  const fileName = extractBackupFileName(normalizedTarget);
  const id = buildBackupHistoryId(time, normalizedTarget || fileName);
  const result = exportResult && typeof exportResult === "object" ? exportResult : {};

  return {
    id,
    exportedAt: time,
    fileName,
    target: normalizedTarget,
    encrypted: Boolean(payload.encryption?.enabled),
    hostCount: normalizeInteger(manifest.hostCount, 0, 0, Number.MAX_SAFE_INTEGER),
    sftpBookmarkCount: normalizeInteger(manifest.sftpBookmarkCount, 0, 0, Number.MAX_SAFE_INTEGER),
    agentCapabilityCount: normalizeInteger(manifest.agentCapabilityCount, 0, 0, Number.MAX_SAFE_INTEGER),
    portForwardPresetCount: normalizeInteger(manifest.portForwardPresetCount, 0, 0, Number.MAX_SAFE_INTEGER),
    commandSnippetCount: normalizeInteger(manifest.commandSnippetCount, 0, 0, Number.MAX_SAFE_INTEGER),
    encryptedCredentialCount: normalizeInteger(manifest.encryptedCredentialCount, 0, 0, Number.MAX_SAFE_INTEGER),
    sensitiveMcpHeaderCount: normalizeInteger(manifest.sensitiveMcpHeaderCount, 0, 0, Number.MAX_SAFE_INTEGER),
    sizeBytes: normalizeInteger(result.sizeBytes, 0, 0, Number.MAX_SAFE_INTEGER),
    sha256: normalizeBackupSha256(result.sha256),
    fingerprint: buildBackupFingerprint(payload),
    scope: normalizeBackupHistoryScope(scope),
  };
}

export function addBackupHistoryEntry(history = [], entry = null, limit = 8) {
  const normalizedEntry = normalizeBackupHistoryEntry(entry);
  if (!normalizedEntry) return (Array.isArray(history) ? history : []).map(normalizeBackupHistoryEntry).filter(Boolean).slice(0, limit);
  const maxItems = normalizeInteger(limit, 8, 1, 50);
  const entries = (Array.isArray(history) ? history : [])
    .map(normalizeBackupHistoryEntry)
    .filter(Boolean)
    .filter((item) => item.id !== normalizedEntry.id);
  return [normalizedEntry, ...entries].slice(0, maxItems);
}

export function removeBackupHistoryEntry(history = [], entryId = "") {
  const targetId = String(entryId || "").trim();
  return (Array.isArray(history) ? history : [])
    .map(normalizeBackupHistoryEntry)
    .filter(Boolean)
    .filter((entry) => !targetId || entry.id !== targetId);
}

export function clearBackupHistory() {
  return [];
}

function normalizeBackupHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const exportedAt = String(entry.exportedAt || "").trim();
  const target = String(entry.target || "").trim();
  const fileName = extractBackupFileName(entry.fileName || target);
  const id = String(entry.id || buildBackupHistoryId(exportedAt, target || fileName)).trim();
  if (!id || !exportedAt) return null;
  return {
    id,
    exportedAt,
    fileName,
    target,
    encrypted: Boolean(entry.encrypted),
    hostCount: normalizeInteger(entry.hostCount, 0, 0, Number.MAX_SAFE_INTEGER),
    sftpBookmarkCount: normalizeInteger(entry.sftpBookmarkCount, 0, 0, Number.MAX_SAFE_INTEGER),
    agentCapabilityCount: normalizeInteger(entry.agentCapabilityCount, 0, 0, Number.MAX_SAFE_INTEGER),
    portForwardPresetCount: normalizeInteger(entry.portForwardPresetCount, 0, 0, Number.MAX_SAFE_INTEGER),
    commandSnippetCount: normalizeInteger(entry.commandSnippetCount, 0, 0, Number.MAX_SAFE_INTEGER),
    encryptedCredentialCount: normalizeInteger(entry.encryptedCredentialCount, 0, 0, Number.MAX_SAFE_INTEGER),
    sensitiveMcpHeaderCount: normalizeInteger(entry.sensitiveMcpHeaderCount, 0, 0, Number.MAX_SAFE_INTEGER),
    sizeBytes: normalizeInteger(entry.sizeBytes, 0, 0, Number.MAX_SAFE_INTEGER),
    sha256: normalizeBackupSha256(entry.sha256),
    fingerprint: normalizeBackupFingerprint(entry.fingerprint),
    scope: normalizeBackupHistoryScope(entry.scope),
  };
}

export function buildBackupFingerprint(payload = {}) {
  const stableText = stableStringify(payload || {});
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;

  for (let index = 0; index < stableText.length; index += 1) {
    const code = stableText.charCodeAt(index);
    hashA ^= code;
    hashA = Math.imul(hashA, 0x01000193);
    hashB ^= code + index;
    hashB = Math.imul(hashB, 0x85ebca6b);
  }

  const first = (hashA >>> 0).toString(16).padStart(8, "0");
  const second = (hashB >>> 0).toString(16).padStart(8, "0");
  return `${first}${second}`.slice(0, 12);
}

export function buildBackupFileName(payload = {}) {
  const exportedAt = String(payload?.manifest?.exportedAt || payload?.exportedAt || "").trim();
  const timestamp = formatBackupTimestamp(exportedAt);
  const fingerprint = buildBackupFingerprint(payload);
  return `ssh-agent-tool-backup-${timestamp}-${fingerprint}.json`;
}

function formatBackupTimestamp(value = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown-time";
  const parts = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    "-",
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0"),
  ];
  return parts.join("");
}

function normalizeBackupFingerprint(value = "") {
  const text = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{12}$/.test(text) ? text : "";
}

function normalizeBackupSha256(value = "") {
  const text = String(value || "").trim().toUpperCase();
  return /^[A-F0-9]{64}$/.test(text) ? text : "";
}

function extractBackupFingerprintFromFileName(value = "") {
  const fileName = extractBackupFileName(value).toLowerCase();
  const match = fileName.match(/(?:^|-)backup-\d{8}-\d{6}-([a-f0-9]{12})\.json$/)
    || fileName.match(/-([a-f0-9]{12})\.json$/);
  return match ? normalizeBackupFingerprint(match[1]) : "";
}

function buildBackupFileNameFingerprintWarning(sourceName = "", fingerprint = "") {
  const expected = normalizeBackupFingerprint(fingerprint);
  const fromName = extractBackupFingerprintFromFileName(sourceName);
  if (!expected || !fromName || expected === fromName) return "";
  return `文件名校验码 ${fromName} 与备份内容校验码 ${expected} 不一致，请确认没有选错或修改过备份文件。`;
}

function stableStringify(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item, seen)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key], seen)}`).join(",")}}`;
}

function normalizeBackupHistoryScope(scope = {}) {
  const normalized = {};
  Object.entries(scope || {}).forEach(([key, value]) => {
    if (typeof value === "boolean") normalized[key] = value;
  });
  return normalized;
}

function extractBackupFileName(value = "") {
  const text = String(value || "").trim();
  const name = text.split(/[\\/]/).filter(Boolean).pop();
  return name || "ssh-agent-tool-backup.json";
}

function buildBackupHistoryId(exportedAt, target) {
  const raw = `${exportedAt || "unknown"}|${target || "backup"}`.toLowerCase();
  return `backup-${raw.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "entry"}`;
}

function buildBackupManifest({ exportedAt, includeSecrets, hosts, sftpBookmarks, skills, mcp, cli, portForwards = [], commandSnippets = [], modelProfiles = [] }) {
  const capabilityCounts = {
    skill: skills.length,
    mcp: mcp.length,
    cli: cli.length,
  };
  return {
    schemaVersion: 1,
    exportedAt,
    hostCount: hosts.length,
    sftpBookmarkCount: sftpBookmarks.reduce((total, item) => total + (Array.isArray(item.paths) ? item.paths.length : 0), 0),
    agentCapabilityCount: capabilityCounts.skill + capabilityCounts.mcp + capabilityCounts.cli,
    portForwardPresetCount: portForwards.length,
    commandSnippetCount: commandSnippets.length,
    modelProfileCount: modelProfiles.length,
    capabilityCounts,
    encryptedCredentialCount: hosts.filter((host) => Boolean(host?.secret || host?.hasSecret)).length,
    sensitiveMcpHeaderCount: countSensitiveMcpHeaders(mcp),
    includesSecrets: Boolean(includeSecrets),
  };
}

function countSftpBookmarkPaths(servers = {}) {
  return buildSftpBookmarks(servers).reduce((total, item) => total + (Array.isArray(item.paths) ? item.paths.length : 0), 0);
}

function buildPortForwardPresets(presets = []) {
  return (Array.isArray(presets) ? presets : [])
    .map(normalizeBackupPortForwardPreset)
    .filter(Boolean);
}

function buildCommandSnippets(snippets = []) {
  const safeSnippets = [];
  const seen = new Set();

  (Array.isArray(snippets) ? snippets : []).forEach((item) => {
    const snippet = normalizeBackupCommandSnippet(item);
    if (!snippet || containsSensitiveCommandMaterial(snippet)) return;
    const key = snippet.command.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    safeSnippets.push(snippet);
  });

  return safeSnippets;
}

function buildBackupModelConfig(config = {}) {
  const stored = buildStoredModelConfig(config || {});
  return {
    ...stored,
    apiKey: "",
    apiKeyRef: "",
    hasApiKey: false,
  };
}

function buildBackupModelProfiles(profiles = [], activeConfig = {}) {
  const profileEntries = Array.isArray(profiles) ? profiles : [];
  const normalized = profileEntries.length ? normalizeModelProfiles(profileEntries, activeConfig) : [];
  const entries = hasBackupModelConfig(activeConfig)
    ? [buildModelProfile(activeConfig, { id: "active-model-config", name: "当前模型 API" }), ...normalized]
    : normalized;
  const seen = new Set();
  const safeProfiles = [];

  entries.forEach((profile) => {
    const nextProfile = buildModelProfile(buildBackupModelConfig(profile?.config || profile), {
      id: profile?.id,
      name: profile?.name,
    });
    const dedupeKey = String(nextProfile.id || `${nextProfile.config.provider}|${nextProfile.config.baseUrl}|${nextProfile.config.model}`).trim();
    if (!dedupeKey || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    safeProfiles.push(nextProfile);
  });

  return safeProfiles;
}

function hasBackupModelConfig(config = {}) {
  const stored = buildStoredModelConfig(config || {});
  return Boolean(
    stored.provider
    || stored.baseUrl
    || stored.model
    || stored.extraHeaders.length
    || stored.modelOptions.length
  );
}

export function buildServerInventoryCsv(servers = {}) {
  const headers = [
    "服务器名称",
    "主机地址",
    "端口",
    "用户名",
    "分组",
    "认证方式",
    "凭据状态",
    "凭据恢复方式",
    "凭据处理建议",
    "连接超时(秒)",
    "重试次数",
    "SSH 保活(秒)",
    "默认目录",
    "命令策略",
    "标签",
    "私钥路径",
    "ProxyJump",
    "LocalForward 数",
    "RemoteForward 数",
    "DynamicForward 数",
    "主机指纹",
    "指纹信任状态",
    "备注",
  ];
  const rows = Object.entries(servers || {})
    .filter(([, item]) => item && typeof item === "object")
    .map(([name, item]) => {
      const trustedHostKey = normalizeHostKey(item.trustedHostKey, true);
      const hostKey = trustedHostKey || normalizeHostKey(item.hostKey);
      const trustLabel = String(item.hostKeyTrust?.label || (trustedHostKey ? "已信任" : "未信任")).trim();
      const credentialReadiness = buildInventoryCredentialReadiness(item);
      return [
        name,
        item.ip || item.host || "",
        item.port || "22",
        item.user || "root",
        item.group || "",
        item.authType || "未设置",
        item.credentialRef || item.hasCredential ? "已绑定凭据" : "未绑定凭据",
        credentialReadiness.restoreMode,
        credentialReadiness.action,
        normalizeInteger(item.timeoutSeconds, 10, 3, 60),
        normalizeInteger(item.retryCount, 0, 0, 3),
        normalizeInteger(item.keepaliveSeconds, 30, 0, 300),
        item.cwd || "",
        item.policy || "",
        normalizeTags(item.tags).join("; "),
        item.identityFile || "",
        item.proxyJump || "",
        normalizeBackupLocalForwards(item.localForwards).length,
        normalizeBackupRemoteForwards(item.remoteForwards).length,
        normalizeBackupDynamicForwards(item.dynamicForwards).length,
        hostKey?.sha256 || "",
        trustLabel || "未信任",
        item.note || "",
      ];
    });

  return `\ufeff${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function buildOpenSshConfigExport(servers = {}, options = {}) {
  const exportedAt = String(options.exportedAt || new Date().toISOString());
  const lines = [
    "# Generated by SSH Agent Tool",
    `# ExportedAt ${exportedAt}`,
    "# Sensitive authentication material is not exported.",
    "",
  ];

  Object.entries(servers || {}).forEach(([name, server]) => {
    if (!server || typeof server !== "object") return;
    const hostName = String(server.ip || server.host || "").trim();
    if (!hostName) return;

    const alias = sanitizeSshHostAlias(name);
    const user = String(server.user || "root").trim() || "root";
    const port = String(server.port || "22").trim() || "22";
    const timeout = normalizeInteger(server.timeoutSeconds, 10, 3, 60);
    const attempts = normalizeInteger(Number(server.retryCount || 0) + 1, 1, 1, 4);
    const keepalive = normalizeInteger(server.keepaliveSeconds, 30, 0, 300);
    const keepaliveCountMax = normalizeInteger(server.keepaliveCountMax, 3, 0, 10);
    const identityFile = String(server.identityFile || "").trim();
    const proxyJump = String(server.proxyJump || "").trim();
    const hostKeyAlias = String(server.hostKeyAlias || "").trim();
    buildOpenSshMetadataCommentLines(server).forEach((line) => lines.push(line));

    lines.push(`Host ${alias}`);
    lines.push(`  HostName ${sshConfigValue(hostName)}`);
    lines.push(`  User ${sshConfigValue(user)}`);
    lines.push(`  Port ${sshConfigValue(port)}`);
    lines.push(`  ConnectTimeout ${timeout}`);
    lines.push(`  ConnectionAttempts ${attempts}`);
    lines.push(`  ServerAliveInterval ${keepalive}`);
    lines.push(`  ServerAliveCountMax ${keepaliveCountMax}`);
    if (identityFile) {
      lines.push(`  IdentityFile ${sshConfigValue(identityFile)}`);
      lines.push("  IdentitiesOnly yes");
    }
    if (server.forwardAgent) lines.push("  ForwardAgent yes");
    if (proxyJump) lines.push(`  ProxyJump ${sshConfigValue(proxyJump)}`);
    if (hostKeyAlias) lines.push(`  HostKeyAlias ${sshConfigValue(hostKeyAlias)}`);
    buildOpenSshForwardLines(server).forEach((line) => lines.push(line));
    lines.push("");
  });

  return lines.join("\n").trimEnd() + "\n";
}

function buildOpenSshMetadataCommentLines(server = {}) {
  const lines = [];
  const group = sanitizeSshConfigCommentValue(server.group);
  const tags = normalizeTags(server.tags).map(sanitizeSshConfigCommentValue).filter(Boolean).join(", ");
  const note = sanitizeSshConfigCommentValue(server.note);
  if (group) lines.push(`# Group ${group}`);
  if (tags) lines.push(`# Tags ${tags}`);
  if (note) lines.push(`# Note ${note}`);
  return lines;
}

function buildOpenSshForwardLines(server = {}) {
  const lines = [];
  normalizeOpenSshForwardList(server.localForwards).forEach((forward) => {
    if (!forward.localPort || !forward.remoteHost || !forward.remotePort) return;
    const localSpec = formatSshForwardEndpoint(forward.localHost || "127.0.0.1", forward.localPort);
    const remoteSpec = formatSshForwardEndpoint(forward.remoteHost, forward.remotePort);
    lines.push(`  LocalForward ${sshConfigValue(localSpec)} ${sshConfigValue(remoteSpec)}`);
  });
  normalizeOpenSshForwardList(server.remoteForwards).forEach((forward) => {
    if (!forward.remotePort || !forward.localHost || !forward.localPort) return;
    const remoteSpec = formatSshForwardEndpoint(forward.remoteHost || "127.0.0.1", forward.remotePort);
    const localSpec = formatSshForwardEndpoint(forward.localHost, forward.localPort);
    lines.push(`  RemoteForward ${sshConfigValue(remoteSpec)} ${sshConfigValue(localSpec)}`);
  });
  normalizeOpenSshForwardList(server.dynamicForwards).forEach((forward) => {
    const bindPort = String(forward?.bindPort || "").trim();
    if (!bindPort) return;
    const bindSpec = formatSshForwardEndpoint(forward.bindHost || "127.0.0.1", bindPort);
    lines.push(`  DynamicForward ${sshConfigValue(bindSpec)}`);
  });
  return lines;
}

function normalizeOpenSshForwardList(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function normalizeBackupLocalForwards(value) {
  return normalizeOpenSshForwardList(value)
    .map((forward) => ({
      localHost: String(forward.localHost || "127.0.0.1").trim() || "127.0.0.1",
      localPort: String(forward.localPort || "").trim(),
      remoteHost: String(forward.remoteHost || "").trim(),
      remotePort: String(forward.remotePort || "").trim(),
    }))
    .filter((forward) => forward.localPort && forward.remoteHost && forward.remotePort);
}

function normalizeBackupRemoteForwards(value) {
  return normalizeOpenSshForwardList(value)
    .map((forward) => ({
      remoteHost: String(forward.remoteHost || "127.0.0.1").trim() || "127.0.0.1",
      remotePort: String(forward.remotePort || "").trim(),
      localHost: String(forward.localHost || "").trim(),
      localPort: String(forward.localPort || "").trim(),
    }))
    .filter((forward) => forward.remotePort && forward.localHost && forward.localPort);
}

function normalizeBackupDynamicForwards(value) {
  return normalizeOpenSshForwardList(value)
    .map((forward) => ({
      bindHost: String(forward.bindHost || "127.0.0.1").trim() || "127.0.0.1",
      bindPort: String(forward.bindPort || "").trim(),
    }))
    .filter((forward) => forward.bindPort);
}

function buildInventoryCredentialReadiness(server = {}) {
  const authType = String(server?.authType || "").trim();
  const hasCredential = Boolean(String(server?.credentialRef || "").trim() || server?.hasCredential);
  const identityFile = String(server?.identityFile || "").trim();

  if (hasCredential) {
    return {
      restoreMode: "加密恢复",
      action: "完整备份可恢复到本机加密凭据库",
    };
  }

  if ((authType === "私钥" || /key/i.test(authType)) && identityFile) {
    return {
      restoreMode: "路径恢复",
      action: "需要确认私钥文件在新机器上可用",
    };
  }

  if (authType === "SSH Agent") {
    return {
      restoreMode: "SSH Agent",
      action: "需要确认 Windows OpenSSH Agent 已启动并已加载私钥",
    };
  }

  return {
    restoreMode: "需要补录",
    action: "导入后需要重新录入密码或选择私钥",
  };
}

function formatSshForwardEndpoint(host, port) {
  const hostText = String(host || "").trim();
  const portText = String(port || "").trim();
  if (!hostText) return portText;
  return `${hostText}:${portText}`;
}

export function mergeBackupHosts(currentServers, backup) {
  if (!backup || backup.schema !== BACKUP_SCHEMA) {
    throw new Error("Unsupported backup schema.");
  }

  const hosts = Array.isArray(backup.hosts) ? backup.hosts : [];
  const servers = { ...currentServers };
  const importedNames = [];
  const importedHosts = [];
  let skipped = 0;

  hosts.forEach((host) => {
    const server = createServerFromBackupHost(host);
    if (!server) {
      skipped += 1;
      return;
    }

    const nextName = uniqueServerName(server.name, servers);
    servers[nextName] = server.data;
    importedNames.push(nextName);
    importedHosts.push({ name: nextName, sourceName: server.name, host });
  });

  return { servers, importedNames, importedHosts, skipped };
}

export function mergeBackupAgentCapabilities(currentCapabilities, backup) {
  if (!backup || backup.schema !== BACKUP_SCHEMA) {
    throw new Error("Unsupported backup schema.");
  }

  const capabilities = [...(Array.isArray(currentCapabilities) ? currentCapabilities : [])];
  const importedNames = [];
  let skipped = 0;
  const backupCapabilities = [
    ...(Array.isArray(backup.skills) ? backup.skills : []),
    ...(Array.isArray(backup.mcp) ? backup.mcp : []),
    ...(Array.isArray(backup.cli) ? backup.cli : []),
  ];

  backupCapabilities.forEach((item) => {
    const capability = normalizeBackupCapability(item);
    if (!capability || capability.builtin) {
      skipped += 1;
      return;
    }

    const exists = capabilities.some(
      (current) => current.type === capability.type && String(current.name).toLowerCase() === capability.name.toLowerCase(),
    );
    if (exists) {
      skipped += 1;
      return;
    }

    capabilities.push(capability);
    importedNames.push(capability.name);
  });

  return { capabilities, importedNames, skipped };
}

export function mergeBackupPortForwardPresets(currentPresets, backup) {
  if (!backup || backup.schema !== BACKUP_SCHEMA) {
    throw new Error("Unsupported backup schema.");
  }

  const presets = [...(Array.isArray(currentPresets) ? currentPresets : [])];
  const importedNames = [];
  let skipped = 0;

  (Array.isArray(backup.portForwards) ? backup.portForwards : []).forEach((item) => {
    const preset = normalizeBackupPortForwardPreset(item);
    if (!preset) {
      skipped += 1;
      return;
    }

    const exists = presets.some((current) => String(current?.id || "").trim() === preset.id);
    if (exists) {
      skipped += 1;
      return;
    }

    presets.push(preset);
    importedNames.push(preset.name);
  });

  return { presets, importedNames, skipped };
}

export function mergeBackupCommandSnippets(currentSnippets, backup) {
  if (!backup || backup.schema !== BACKUP_SCHEMA) {
    throw new Error("Unsupported backup schema.");
  }

  const snippets = buildCommandSnippets(currentSnippets);
  const importedNames = [];
  let skipped = 0;
  const existingCommands = new Set(snippets.map((item) => item.command.toLowerCase()));

  (Array.isArray(backup.commandSnippets) ? backup.commandSnippets : []).forEach((item) => {
    const snippet = normalizeBackupCommandSnippet(item);
    if (!snippet || containsSensitiveCommandMaterial(snippet)) {
      skipped += 1;
      return;
    }

    const key = snippet.command.toLowerCase();
    if (existingCommands.has(key)) {
      skipped += 1;
      return;
    }

    existingCommands.add(key);
    snippets.push(snippet);
    importedNames.push(snippet.label);
  });

  return { snippets, importedNames, skipped };
}

export function mergeBackupModelProfiles(currentProfiles, backup) {
  if (!backup || backup.schema !== BACKUP_SCHEMA) {
    throw new Error("Unsupported backup schema.");
  }

  const profiles = normalizeModelProfiles(currentProfiles, {});
  const importedNames = [];
  let skipped = 0;
  const existingIds = new Set(profiles.map((profile) => profile.id).filter(Boolean));
  const existingNames = new Set(profiles.map((profile) => String(profile.name || "").trim()).filter(Boolean));

  (Array.isArray(backup.modelProfiles) ? backup.modelProfiles : []).forEach((item) => {
    const profile = buildModelProfile(buildBackupModelConfig(item?.config || item), { id: item?.id, name: item?.name });
    const name = String(profile.name || "").trim();
    if (!profile.id || !name || existingIds.has(profile.id) || existingNames.has(name)) {
      skipped += 1;
      return;
    }

    existingIds.add(profile.id);
    existingNames.add(name);
    profiles.push(profile);
    importedNames.push(name);
  });

  return { profiles, importedNames, skipped };
}

function normalizeBackupCommandSnippet(item) {
  const command = String(item?.command || "").trim();
  const label = String(item?.label || command).trim();
  if (!command || !label) return null;
  return { label, command, custom: true };
}

function containsSensitiveCommandMaterial(snippet) {
  const text = `${snippet?.label || ""}\n${snippet?.command || ""}`;
  return /(^|\b|[-_])(authorization|bearer|api[-_ ]?key|access[-_ ]?key|secret|token|passwd|password|pwd)(\b|=|:|[-_]|$)|密码|密钥|令牌|口令|授权/i.test(text);
}

export function buildBackupImportPreview(currentServers, currentCapabilities, backup, options = {}) {
  if (!backup || backup.schema !== BACKUP_SCHEMA) {
    return {
      valid: false,
      encrypted: false,
      manifest: null,
      credentialCount: 0,
      hostNames: [],
      capabilityNames: [],
      portForwardPresetNames: [],
      commandSnippetNames: [],
      modelProfileNames: [],
      integrityWarnings: [],
      hostConflicts: [],
      hostIdentityConflicts: [],
      fingerprint: "",
      missingCredentialCount: 0,
      proxyJumpCount: 0,
      identityFileCount: 0,
      diffSummary: buildBackupImportDiffSummary(),
      skippedHosts: 0,
      skippedCapabilities: 0,
      skippedPortForwards: 0,
      skippedCommandSnippets: 0,
      skippedModelProfiles: 0,
      summary: "备份文件格式不支持。",
    };
  }

  const hostImport = mergeBackupHosts(currentServers, backup);
  const capabilityImport = mergeBackupAgentCapabilities(currentCapabilities, backup);
  const portForwardImport = mergeBackupPortForwardPresets([], backup);
  const commandSnippetImport = mergeBackupCommandSnippets([], backup);
  const modelProfileImport = mergeBackupModelProfiles([], backup);
  const credentialCount = (Array.isArray(backup.hosts) ? backup.hosts : []).filter(
    (host) => Boolean(host?.secret || host?.hasSecret),
  ).length;
  const hostConflicts = hostImport.importedHosts
    .filter((item) => String(item.host?.name || "").trim() && item.name !== String(item.host?.name || "").trim())
    .map((item) => ({
      sourceName: String(item.host?.name || "").trim(),
      importedName: item.name,
      host: String(item.host?.host || item.host?.ip || "").trim(),
    }));
  const hostIdentityConflicts = buildBackupHostIdentityConflicts(currentServers, hostImport.importedHosts);
  const missingCredentialCount = hostImport.importedHosts.filter((item) => !item.host?.secret && !item.host?.hasSecret).length;
  const proxyJumpCount = hostImport.importedHosts.filter((item) => String(item.host?.proxyJump || "").trim()).length;
  const identityFileCount = hostImport.importedHosts.filter((item) => String(item.host?.identityFile || "").trim()).length;
  const encryptedMcpHeaderCount = countEncryptedMcpHeaders(backup);
  const manifest = normalizeBackupManifest(backup.manifest);
  const skippedCredentialCount = normalizeInteger(manifest?.skippedCredentialCount, 0, 0, Number.MAX_SAFE_INTEGER);
  const fingerprint = buildBackupFingerprint(backup);
  const integrityWarnings = buildBackupIntegrityWarnings(backup, manifest, {
    hostCount: Array.isArray(backup.hosts) ? backup.hosts.length : 0,
    agentCapabilityCount:
      (Array.isArray(backup.skills) ? backup.skills.length : 0)
      + (Array.isArray(backup.mcp) ? backup.mcp.length : 0)
      + (Array.isArray(backup.cli) ? backup.cli.length : 0),
    portForwardPresetCount: Array.isArray(backup.portForwards) ? backup.portForwards.length : 0,
    commandSnippetCount: Array.isArray(backup.commandSnippets) ? backup.commandSnippets.length : 0,
    modelProfileCount: Array.isArray(backup.modelProfiles) ? backup.modelProfiles.length : 0,
    encryptedCredentialCount: credentialCount,
    sensitiveMcpHeaderCount: encryptedMcpHeaderCount,
    includesSecrets: Boolean(backup.encryption?.enabled),
  });
  const fileNameWarning = buildBackupFileNameFingerprintWarning(options?.sourceName, fingerprint);
  if (fileNameWarning) integrityWarnings.push(fileNameWarning);
  const diffSummary = buildBackupImportDiffSummary({
    hostImport,
    capabilityImport,
    portForwardImport,
    commandSnippetImport,
    modelProfileImport,
    hostConflicts,
    credentialCount,
    missingCredentialCount,
  });

  return {
    valid: true,
    encrypted: Boolean(backup.encryption?.enabled),
    manifest,
    fingerprint,
    credentialCount,
    hostNames: hostImport.importedNames,
    capabilityNames: capabilityImport.importedNames,
    portForwardPresetNames: portForwardImport.importedNames,
    commandSnippetNames: commandSnippetImport.importedNames,
    modelProfileNames: modelProfileImport.importedNames,
    hostConflicts,
    hostIdentityConflicts,
    missingCredentialCount,
    skippedCredentialCount,
    proxyJumpCount,
    identityFileCount,
    encryptedMcpHeaderCount,
    integrityWarnings,
    diffSummary,
    skippedHosts: hostImport.skipped,
    skippedCapabilities: capabilityImport.skipped,
    skippedPortForwards: portForwardImport.skipped,
    skippedCommandSnippets: commandSnippetImport.skipped,
    skippedModelProfiles: modelProfileImport.skipped,
    summary: [
      buildBackupImportSummary(hostImport.importedNames.length, capabilityImport.importedNames.length, credentialCount, {
        hostConflicts,
        missingCredentialCount,
        skippedCredentialCount,
        proxyJumpCount,
        identityFileCount,
        encryptedMcpHeaderCount,
      }),
      buildBackupImportAssetSummary(portForwardImport.importedNames.length, commandSnippetImport.importedNames.length, modelProfileImport.importedNames.length),
    ].filter(Boolean).join("；"),
  };
}

export function hasBackupImportTargets(preview) {
  return Boolean(
    preview?.hostNames?.length
    || preview?.capabilityNames?.length
    || preview?.portForwardPresetNames?.length
    || preview?.commandSnippetNames?.length
    || preview?.modelProfileNames?.length
  );
}

export function buildBackupImportDialogModel(preview, itemLimit = 5) {
  const manifest = preview?.manifest || {};
  const hostCount = normalizeInteger(manifest.hostCount, preview?.hostNames?.length || 0, 0, Number.MAX_SAFE_INTEGER);
  const capabilityCount = normalizeInteger(
    manifest.agentCapabilityCount,
    preview?.capabilityNames?.length || 0,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const credentialCount = normalizeInteger(manifest.encryptedCredentialCount, preview?.credentialCount || 0, 0, Number.MAX_SAFE_INTEGER);
  const portForwardCount = normalizeInteger(
    manifest.portForwardPresetCount,
    preview?.portForwardPresetNames?.length || 0,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const commandSnippetCount = normalizeInteger(
    manifest.commandSnippetCount,
    preview?.commandSnippetNames?.length || 0,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const modelProfileCount = normalizeInteger(
    manifest.modelProfileCount,
    preview?.modelProfileNames?.length || 0,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const headerCount = normalizeInteger(
    manifest.sensitiveMcpHeaderCount,
    preview?.encryptedMcpHeaderCount || 0,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const skippedCredentialCount = normalizeInteger(
    manifest.skippedCredentialCount,
    preview?.skippedCredentialCount || 0,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const canRestoreSecrets = Boolean(preview?.encrypted && (credentialCount > 0 || headerCount > 0));

  return {
    title: "备份导入预览",
    summary: String(preview?.summary || "").trim(),
    exportedAt: String(manifest.exportedAt || "").trim(),
    fingerprint: normalizeBackupFingerprint(preview?.fingerprint),
    canRestoreSecrets,
    defaultRestoreMode: canRestoreSecrets ? "with-secrets" : "config-only",
    securityNote: canRestoreSecrets
      ? "该备份包含加密敏感信息，可以选择同时恢复加密凭据和 MCP Header 密钥。"
      : "该备份不会恢复密码、私钥或 MCP Header 密钥；导入后可在连接和 Agent 设置中重新绑定。",
    stats: [
      { label: "服务器", value: String(hostCount) },
      { label: "Agent 能力", value: String(capabilityCount) },
      { label: "端口转发", value: String(portForwardCount) },
      { label: "命令片段", value: String(commandSnippetCount) },
      ...(modelProfileCount ? [{ label: "模型档案", value: String(modelProfileCount) }] : []),
      { label: "加密凭据", value: String(credentialCount) },
      ...(skippedCredentialCount ? [{ label: "未导出凭据", value: String(skippedCredentialCount) }] : []),
      { label: "敏感 Header", value: String(headerCount) },
    ],
    diffLines: buildBackupImportDiffLines(preview?.diffSummary),
    conflictLines: buildBackupImportConflictLines(preview?.hostConflicts, itemLimit),
    sections: [
      buildPreviewSection("服务器", preview?.hostNames, itemLimit),
      buildPreviewSection("Agent 能力", preview?.capabilityNames, itemLimit),
      buildPreviewSection("端口转发预设", preview?.portForwardPresetNames, itemLimit),
      buildPreviewSection("命令片段", preview?.commandSnippetNames, itemLimit),
      ...(modelProfileCount ? [buildPreviewSection("模型 API 档案", preview?.modelProfileNames, itemLimit)] : []),
    ],
    risks: buildBackupImportRiskLines(preview),
    restoreCheckLines: buildBackupRestoreCheckLines({
      canRestoreSecrets,
      credentialCount,
      headerCount,
      missingCredentialCount: preview?.missingCredentialCount,
      skippedCredentialCount,
    }),
    restoreOptions: [
      {
        id: "config-only",
        title: "仅导入配置",
        description: "导入服务器、SFTP 书签和 Agent 能力，不恢复密码、私钥或 Header 密钥。",
      },
      {
        id: "with-secrets",
        title: "同时恢复敏感信息",
        description: "需要输入备份主密码，恢复服务器凭据和 MCP Header 密钥。",
        disabled: !canRestoreSecrets,
      },
    ],
  };
}

export function buildBackupImportPlan(backup, scope = {}) {
  if (!backup || backup.schema !== BACKUP_SCHEMA) {
    throw new Error("Unsupported backup schema.");
  }

  const includeServers = scope.servers !== false;
  const includeSftp = includeServers && scope.sftp !== false;
  const includeAgentCapabilities = scope.agentCapabilities !== false;
  const includePortForwards = scope.portForwards === true;
  const includeCommandSnippets = scope.commandSnippets === true;
  const includeModelProfiles = scope.modelProfiles !== false;
  const restoreSecrets = Boolean(scope.restoreSecrets);
  const scopedBackup = {
    ...backup,
    hosts: includeServers && Array.isArray(backup.hosts) ? backup.hosts : [],
    sftpBookmarks: includeSftp && Array.isArray(backup.sftpBookmarks) ? backup.sftpBookmarks : [],
    skills: includeAgentCapabilities && Array.isArray(backup.skills) ? backup.skills : [],
    mcp: includeAgentCapabilities && Array.isArray(backup.mcp) ? backup.mcp : [],
    cli: includeAgentCapabilities && Array.isArray(backup.cli) ? backup.cli : [],
    portForwards: includePortForwards && Array.isArray(backup.portForwards) ? backup.portForwards : [],
    commandSnippets: includeCommandSnippets && Array.isArray(backup.commandSnippets) ? backup.commandSnippets : [],
    modelProfiles: includeModelProfiles && Array.isArray(backup.modelProfiles) ? backup.modelProfiles : [],
  };

  return {
    backup: scopedBackup,
    includeServers,
    includeSftp,
    includeAgentCapabilities,
    includePortForwards,
    includeCommandSnippets,
    includeModelProfiles,
    restoreServerCredentials: restoreSecrets && includeServers,
    restoreAgentSecrets: restoreSecrets && includeAgentCapabilities,
  };
}

export function buildBackupRestoreResultSummary({
  importedNames = [],
  importedHosts = [],
  credentialRestore = null,
  restoreSecrets = false,
} = {}) {
  const names = normalizeImportedNames(importedNames, importedHosts);
  if (names.length === 0) {
    return {
      visible: false,
      message: "",
      stats: { imported: 0, restored: 0, skipped: 0, pending: 0 },
      rows: [],
    };
  }

  const restoredRefs = new Map(
    (Array.isArray(credentialRestore?.credentials) ? credentialRestore.credentials : [])
      .map((item) => [String(item?.name || "").trim(), item])
      .filter(([name]) => name),
  );
  const hostByName = new Map(
    (Array.isArray(importedHosts) ? importedHosts : [])
      .map((item) => [String(item?.name || "").trim(), item?.host || {}])
      .filter(([name]) => name),
  );
  const importedHostByName = new Map(
    (Array.isArray(importedHosts) ? importedHosts : [])
      .map((item) => [String(item?.name || "").trim(), item])
      .filter(([name]) => name),
  );

  const rows = names.map((name) => {
    const host = hostByName.get(name) || {};
    const importedHost = importedHostByName.get(name) || {};
    const sourceName = String(importedHost?.sourceName || host?.name || "").trim();
    const restored = restoredRefs.get(name) || (sourceName ? restoredRefs.get(sourceName) : null);
    const hasEncryptedSecret = Boolean(host?.secret || host?.hasSecret);
    const authType = String(host?.authType || "").trim();

    if (restored?.hasSecret || restored?.credentialRef) {
      return {
        name,
        status: "凭据已恢复",
        tone: "green",
        credentialRef: String(restored.credentialRef || "").trim(),
        detail: "已写入本机加密凭据库，可以继续测试 SSH 连接。",
      };
    }

    if (!restoreSecrets) {
      return {
        name,
        status: "仅导入配置",
        tone: "amber",
        detail: "本次仅导入服务器配置，密码、私钥内容或口令短语需要重新录入。",
      };
    }

    if (hasEncryptedSecret) {
      return {
        name,
        status: "凭据未恢复",
        tone: "amber",
        detail: "备份中存在加密凭据，但本次未成功写入本机凭据库，请检查主密码或重新导入。",
      };
    }

    if (authType === "SSH Agent") {
      return {
        name,
        status: "需要手动确认",
        tone: "blue",
        detail: "SSH Agent 配置已导入，请确认 Windows OpenSSH Agent 已启动并已添加目标私钥。",
      };
    }

    return {
      name,
      status: "需要补录凭据",
      tone: "amber",
      detail: "备份中没有可恢复的凭据内容，请编辑连接后补录密码、私钥或切换 SSH Agent。",
    };
  });

  const restored = rows.filter((row) => row.status === "凭据已恢复").length;
  const skipped = normalizeInteger(credentialRestore?.skipped, 0, 0, Number.MAX_SAFE_INTEGER);
  const pending = rows.length - restored;

  return {
    visible: true,
    message: restoreSecrets
      ? `导入完成：${names.length} 台服务器，已恢复 ${restored} 台服务器凭据，${pending} 台仍需确认或补录。`
      : `导入完成：${names.length} 台服务器，仅导入配置，敏感凭据需要重新录入。`,
    stats: {
      imported: names.length,
      restored,
      skipped,
      pending,
    },
    rows,
  };
}

function normalizeImportedNames(importedNames = [], importedHosts = []) {
  const names = [];
  const seen = new Set();
  const append = (value) => {
    const name = String(value || "").trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    names.push(name);
  };

  (Array.isArray(importedNames) ? importedNames : []).forEach(append);
  (Array.isArray(importedHosts) ? importedHosts : []).forEach((item) => append(item?.name));
  return names;
}

export function buildBackupImportScopeSummary(preview = {}, scope = {}) {
  const manifest = preview?.manifest || {};
  const hostCount = normalizeInteger(manifest.hostCount, preview?.hostNames?.length || 0, 0, Number.MAX_SAFE_INTEGER);
  const capabilityCount = normalizeInteger(manifest.agentCapabilityCount, preview?.capabilityNames?.length || 0, 0, Number.MAX_SAFE_INTEGER);
  const portForwardCount = normalizeInteger(manifest.portForwardPresetCount, preview?.portForwardPresetNames?.length || 0, 0, Number.MAX_SAFE_INTEGER);
  const commandSnippetCount = normalizeInteger(manifest.commandSnippetCount, preview?.commandSnippetNames?.length || 0, 0, Number.MAX_SAFE_INTEGER);
  const modelProfileCount = normalizeInteger(manifest.modelProfileCount, preview?.modelProfileNames?.length || 0, 0, Number.MAX_SAFE_INTEGER);
  const credentialCount = normalizeInteger(manifest.encryptedCredentialCount, preview?.credentialCount || 0, 0, Number.MAX_SAFE_INTEGER);
  const headerCount = normalizeInteger(manifest.sensitiveMcpHeaderCount, preview?.encryptedMcpHeaderCount || 0, 0, Number.MAX_SAFE_INTEGER);
  const missingCredentialCount = normalizeInteger(preview?.missingCredentialCount, 0, 0, Number.MAX_SAFE_INTEGER);
  const includeServers = scope.servers !== false;
  const includeSftp = includeServers && scope.sftp !== false;
  const includeAgentCapabilities = scope.agentCapabilities !== false;
  const includePortForwards = scope.portForwards === true;
  const includeCommandSnippets = scope.commandSnippets === true;
  const includeModelProfiles = scope.modelProfiles !== false && modelProfileCount > 0;
  const restoreSecrets = Boolean(scope.restoreSecrets);
  const canRestoreSecrets = Boolean(preview?.encrypted && (credentialCount > 0 || headerCount > 0));
  const willRestoreServerCredentials = Boolean(restoreSecrets && canRestoreSecrets && includeServers);
  const willRestoreAgentSecrets = Boolean(restoreSecrets && canRestoreSecrets && includeAgentCapabilities);
  const skippedRestorableServerCredentials = !willRestoreServerCredentials && includeServers && canRestoreSecrets ? credentialCount : 0;
  const skippedRestorableMcpHeaders = !willRestoreAgentSecrets && includeAgentCapabilities && canRestoreSecrets ? headerCount : 0;
  const lines = [];

  if (includeServers || includeAgentCapabilities || includePortForwards || includeCommandSnippets || includeModelProfiles) {
    if (includeServers) {
      lines.push(`将导入服务器配置 ${hostCount} 台${includeSftp ? "，SFTP 书签随服务器导入" : "，不导入 SFTP 书签"}。`);
    } else {
      lines.push("不会导入服务器配置或 SFTP 书签。");
    }

    const assetParts = [];
    if (includeAgentCapabilities) assetParts.push(`Agent 能力 ${capabilityCount} 个`);
    if (includePortForwards) assetParts.push(`端口转发预设 ${portForwardCount} 个`);
    if (includeCommandSnippets) assetParts.push(`命令片段 ${commandSnippetCount} 个`);
    if (includeModelProfiles) assetParts.push(`模型 API 档案 ${modelProfileCount} 个`);
    if (assetParts.length > 0) lines.push(`将导入 ${assetParts.join("、")}。`);
  } else {
    lines.push("未选择任何可导入内容。");
  }

  const hasImportTarget = Boolean(includeServers || includeAgentCapabilities || includePortForwards || includeCommandSnippets || includeModelProfiles);
  if (hasImportTarget && !includePortForwards && portForwardCount > 0) lines.push("不会导入端口转发预设。");
  if (hasImportTarget && !includeCommandSnippets && commandSnippetCount > 0) lines.push("不会导入命令片段。");
  if (hasImportTarget && !includeModelProfiles && modelProfileCount > 0) lines.push("不会导入模型 API 档案。");

  if (restoreSecrets && canRestoreSecrets) {
    lines.push(`将尝试恢复服务器凭据 ${includeServers ? credentialCount : 0} 个、MCP Header 密钥 ${includeAgentCapabilities ? headerCount : 0} 个。`);
  } else {
    lines.push("不会恢复服务器密码、私钥或 MCP Header 密钥。");
  }

  if (skippedRestorableServerCredentials > 0 || skippedRestorableMcpHeaders > 0) {
    const skippedParts = [];
    if (skippedRestorableServerCredentials > 0) skippedParts.push(`${skippedRestorableServerCredentials} 个可恢复服务器凭据`);
    if (skippedRestorableMcpHeaders > 0) skippedParts.push(`${skippedRestorableMcpHeaders} 个可恢复 MCP Header 密钥`);
    lines.push(`本次不会恢复 ${skippedParts.join("、")}，导入后需要重新选择“同时恢复敏感信息”或手动补录。`);
  }

  if (missingCredentialCount > 0 && includeServers) {
    lines.push(`预计仍有 ${missingCredentialCount} 台服务器需要重新绑定凭据。`);
  }

  return {
    lines,
    hasImportTarget,
    willRestoreSecrets: Boolean(willRestoreServerCredentials || willRestoreAgentSecrets),
    skippedRestorableServerCredentials,
    skippedRestorableMcpHeaders,
    requiresMasterPassword: Boolean(restoreSecrets && canRestoreSecrets && (includeServers || includeAgentCapabilities)),
  };
}

export function buildBackupImportSubmitState(scopeSummary = {}, masterPassword = "") {
  const requiresMasterPassword = Boolean(scopeSummary?.requiresMasterPassword);
  const hasImportTarget = Boolean(scopeSummary?.hasImportTarget);
  const passwordReady = !requiresMasterPassword || String(masterPassword || "").length >= 8;

  return {
    canSubmit: Boolean(hasImportTarget && passwordReady),
    requiresMasterPassword,
    passwordReady,
  };
}

function buildPreviewSection(title, sourceItems, itemLimit) {
  const limit = normalizeInteger(itemLimit, 5, 1, 20);
  const items = (Array.isArray(sourceItems) ? sourceItems : []).map((item) => String(item || "").trim()).filter(Boolean);
  return {
    title,
    items: items.slice(0, limit),
    overflow: Math.max(items.length - limit, 0),
  };
}

function buildBackupImportConflictLines(conflicts = [], itemLimit = 5) {
  const limit = normalizeInteger(itemLimit, 5, 1, 20);
  const lines = (Array.isArray(conflicts) ? conflicts : [])
    .map((item) => {
      const sourceName = String(item?.sourceName || "").trim();
      const importedName = String(item?.importedName || "").trim();
      const host = String(item?.host || "").trim();
      if (!sourceName || !importedName) return "";
      return host ? `${sourceName} -> ${importedName}（${host}）` : `${sourceName} -> ${importedName}`;
    })
    .filter(Boolean);
  const visible = lines.slice(0, limit);
  const overflow = Math.max(lines.length - limit, 0);
  if (overflow > 0) visible.push(`另有 ${overflow} 台重名服务器会自动改名`);
  return visible;
}

function buildBackupHostIdentityConflicts(currentServers = {}, importedHosts = []) {
  return (Array.isArray(importedHosts) ? importedHosts : [])
    .map((item) => {
      const sourceName = String(item?.sourceName || item?.host?.name || "").trim();
      if (!sourceName) return null;
      const existing = currentServers?.[sourceName];
      if (!existing || typeof existing !== "object") return null;

      const existingEndpoint = buildBackupHostEndpoint(existing);
      const incomingEndpoint = buildBackupHostEndpoint(item?.host || {});
      if (!existingEndpoint || !incomingEndpoint || existingEndpoint === incomingEndpoint) return null;

      return {
        sourceName,
        importedName: String(item?.name || "").trim() || sourceName,
        existingEndpoint,
        incomingEndpoint,
      };
    })
    .filter(Boolean);
}

function buildBackupHostEndpoint(host = {}) {
  const address = String(host?.ip || host?.host || "").trim();
  if (!address) return "";
  const user = String(host?.user || "root").trim() || "root";
  const port = String(host?.port || "22").trim() || "22";
  return `${user}@${address}:${port}`;
}

function buildBackupImportRiskLines(preview) {
  const risks = [];
  if (Array.isArray(preview?.integrityWarnings)) {
    risks.push(...preview.integrityWarnings);
  }
  const conflictCount = Array.isArray(preview?.hostConflicts) ? preview.hostConflicts.length : 0;
  if (conflictCount) risks.push(`${conflictCount} 台重名服务器会自动改名`);
  const identityConflictCount = Array.isArray(preview?.hostIdentityConflicts) ? preview.hostIdentityConflicts.length : 0;
  if (identityConflictCount) risks.push(`${identityConflictCount} 台同名服务器连接目标不同，请确认是否为新机器或旧配置`);
  if (preview?.missingCredentialCount) risks.push(`${preview.missingCredentialCount} 台服务器导入后需要重新绑定密码/密钥`);
  if (preview?.skippedCredentialCount) risks.push(`${preview.skippedCredentialCount} 个凭据未导出，需要导入后重新绑定`);
  if (preview?.proxyJumpCount) risks.push(`${preview.proxyJumpCount} 台服务器包含 ProxyJump 配置`);
  if (preview?.identityFileCount) risks.push(`${preview.identityFileCount} 台服务器包含 IdentityFile 路径`);
  if (preview?.skippedHosts || preview?.skippedCapabilities) {
    risks.push(`已跳过 ${preview.skippedHosts || 0} 台服务器、${preview.skippedCapabilities || 0} 个 Agent 能力`);
  }
  return risks;
}

function buildBackupRestoreCheckLines({ canRestoreSecrets = false, credentialCount = 0, headerCount = 0, missingCredentialCount = 0, skippedCredentialCount = 0 } = {}) {
  const credentials = normalizeInteger(credentialCount, 0, 0, Number.MAX_SAFE_INTEGER);
  const headers = normalizeInteger(headerCount, 0, 0, Number.MAX_SAFE_INTEGER);
  const missing = normalizeInteger(missingCredentialCount, 0, 0, Number.MAX_SAFE_INTEGER);
  const skipped = normalizeInteger(skippedCredentialCount, 0, 0, Number.MAX_SAFE_INTEGER);
  const lines = [];

  if (canRestoreSecrets) {
    lines.push(`可恢复服务器凭据 ${credentials} 个，MCP Header 密钥 ${headers} 个。`);
  } else {
    lines.push("未检测到可恢复的加密敏感信息。");
  }

  if (missing > 0) {
    lines.push(`导入后仍有 ${missing} 台服务器需要重新绑定密码/密钥。`);
  }

  if (skipped > 0) {
    lines.push(`${skipped} 个凭据未导出，需要导入后重新绑定。`);
  }

  if (canRestoreSecrets) {
    lines.push("选择“同时恢复敏感信息”时需要输入备份主密码。");
  }

  return lines;
}

function buildBackupImportSummary(hostCount, capabilityCount, credentialCount, risks = {}) {
  const parts = [
    `将导入 ${hostCount} 台服务器、${capabilityCount} 个 Agent 能力，包含 ${credentialCount} 个加密凭据。`,
  ];
  if (risks.hostConflicts?.length) parts.push(`${risks.hostConflicts.length} 台重名服务器将自动改名`);
  if (risks.missingCredentialCount) parts.push(`${risks.missingCredentialCount} 台需要重新绑定凭据`);
  if (risks.skippedCredentialCount) parts.push(`${risks.skippedCredentialCount} 个凭据未导出`);
  if (risks.proxyJumpCount) parts.push(`${risks.proxyJumpCount} 台包含 ProxyJump`);
  if (risks.identityFileCount) parts.push(`${risks.identityFileCount} 台包含私钥路径`);
  return parts.join("；");
}

function buildBackupImportAssetSummary(portForwardCount = 0, commandSnippetCount = 0, modelProfileCount = 0) {
  if (!portForwardCount && !commandSnippetCount && !modelProfileCount) return "";
  const parts = [
    `${portForwardCount} 个端口转发预设`,
    `${commandSnippetCount} 个命令片段`,
  ];
  if (modelProfileCount) parts.push(`${modelProfileCount} 个模型 API 档案`);
  return `将导入 ${parts.join("、")}`;
}

function buildBackupImportDiffSummary({
  hostImport = { importedNames: [], skipped: 0 },
  capabilityImport = { importedNames: [], skipped: 0 },
  portForwardImport = { importedNames: [], skipped: 0 },
  commandSnippetImport = { importedNames: [], skipped: 0 },
  modelProfileImport = { importedNames: [], skipped: 0 },
  hostConflicts = [],
  credentialCount = 0,
  missingCredentialCount = 0,
} = {}) {
  const summary = {
    serversToAdd: Array.isArray(hostImport.importedNames) ? hostImport.importedNames.length : 0,
    serversRenamed: Array.isArray(hostConflicts) ? hostConflicts.length : 0,
    agentCapabilitiesToAdd: Array.isArray(capabilityImport.importedNames) ? capabilityImport.importedNames.length : 0,
    portForwardsToAdd: Array.isArray(portForwardImport.importedNames) ? portForwardImport.importedNames.length : 0,
    commandSnippetsToAdd: Array.isArray(commandSnippetImport.importedNames) ? commandSnippetImport.importedNames.length : 0,
    encryptedCredentialsAvailable: normalizeInteger(credentialCount, 0, 0, Number.MAX_SAFE_INTEGER),
    missingCredentialsAfterImport: normalizeInteger(missingCredentialCount, 0, 0, Number.MAX_SAFE_INTEGER),
    skippedItems:
      normalizeInteger(hostImport.skipped, 0, 0, Number.MAX_SAFE_INTEGER)
      + normalizeInteger(capabilityImport.skipped, 0, 0, Number.MAX_SAFE_INTEGER)
      + normalizeInteger(portForwardImport.skipped, 0, 0, Number.MAX_SAFE_INTEGER)
      + normalizeInteger(commandSnippetImport.skipped, 0, 0, Number.MAX_SAFE_INTEGER)
      + normalizeInteger(modelProfileImport.skipped, 0, 0, Number.MAX_SAFE_INTEGER),
  };
  const modelProfilesToAdd = Array.isArray(modelProfileImport.importedNames) ? modelProfileImport.importedNames.length : 0;
  if (modelProfilesToAdd > 0) summary.modelProfilesToAdd = modelProfilesToAdd;
  return summary;
}

function buildBackupImportDiffLines(diff = {}) {
  const summary = buildBackupImportDiffSummary({
    hostImport: { importedNames: Array(diff.serversToAdd || 0), skipped: 0 },
    capabilityImport: { importedNames: Array(diff.agentCapabilitiesToAdd || 0), skipped: 0 },
    portForwardImport: { importedNames: Array(diff.portForwardsToAdd || 0), skipped: 0 },
    commandSnippetImport: { importedNames: Array(diff.commandSnippetsToAdd || 0), skipped: 0 },
    modelProfileImport: { importedNames: Array(diff.modelProfilesToAdd || 0), skipped: 0 },
    hostConflicts: Array(diff.serversRenamed || 0),
    credentialCount: diff.encryptedCredentialsAvailable,
    missingCredentialCount: diff.missingCredentialsAfterImport,
  });
  summary.skippedItems = normalizeInteger(diff.skippedItems, 0, 0, Number.MAX_SAFE_INTEGER);

  return [
    `新增服务器 ${summary.serversToAdd} 台，重名自动改名 ${summary.serversRenamed} 台`,
    `新增 Agent 能力 ${summary.agentCapabilitiesToAdd} 个，端口转发预设 ${summary.portForwardsToAdd} 个，命令片段 ${summary.commandSnippetsToAdd} 个${summary.modelProfilesToAdd ? `，模型 API 档案 ${summary.modelProfilesToAdd} 个` : ""}`,
    `可恢复加密凭据 ${summary.encryptedCredentialsAvailable} 个，导入后仍需补凭据 ${summary.missingCredentialsAfterImport} 台`,
    summary.skippedItems ? `跳过 ${summary.skippedItems} 项无效或重复内容` : "",
  ].filter(Boolean);
}

function buildBackupIntegrityWarnings(backup, manifest, actual = {}) {
  if (!manifest) return [];
  const warnings = [];
  [
    ["hostCount", "服务器"],
    ["agentCapabilityCount", "Agent 能力"],
    ["portForwardPresetCount", "端口转发预设"],
    ["commandSnippetCount", "命令片段"],
    ["modelProfileCount", "模型 API 档案"],
    ["encryptedCredentialCount", "加密凭据"],
    ["sensitiveMcpHeaderCount", "敏感 MCP Header"],
  ].forEach(([key, label]) => {
    if (!(key in manifest)) return;
    const expected = normalizeInteger(manifest[key], 0, 0, Number.MAX_SAFE_INTEGER);
    const observed = normalizeInteger(actual[key], 0, 0, Number.MAX_SAFE_INTEGER);
    if (expected !== observed) {
      warnings.push(`备份清单的${label}数量为 ${expected}，实际内容为 ${observed}，建议确认备份文件是否完整。`);
    }
  });

  if ("includesSecrets" in manifest && manifest.includesSecrets !== actual.includesSecrets) {
    warnings.push("备份清单的加密标记与文件加密状态不一致，恢复敏感信息前请确认文件来源。");
  }

  const encryptionEnabled = Boolean(backup?.encryption?.enabled);
  if (encryptionEnabled && !manifest.includesSecrets && (actual.encryptedCredentialCount > 0 || actual.sensitiveMcpHeaderCount > 0)) {
    warnings.push("备份包含加密敏感内容，但清单未标记包含敏感信息。");
  }

  return warnings;
}

function countEncryptedMcpHeaders(backup) {
  return (Array.isArray(backup?.mcp) ? backup.mcp : []).reduce((total, capability) => {
    const headers = Array.isArray(capability?.headers) ? capability.headers : [];
    return total + headers.filter((header) => header?.sensitive && header?.secret).length;
  }, 0);
}

function countSensitiveMcpHeaders(mcpCapabilities = []) {
  return (Array.isArray(mcpCapabilities) ? mcpCapabilities : []).reduce((total, capability) => {
    const headers = Array.isArray(capability?.headers) ? capability.headers : [];
    return total + headers.filter((header) => header?.sensitive).length;
  }, 0);
}

function normalizeBackupManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return null;
  const normalized = {};
  copyManifestInteger(normalized, manifest, "schemaVersion");
  copyManifestString(normalized, manifest, "exportedAt");
  copyManifestInteger(normalized, manifest, "hostCount");
  copyManifestInteger(normalized, manifest, "sftpBookmarkCount");
  copyManifestInteger(normalized, manifest, "agentCapabilityCount");
  copyManifestInteger(normalized, manifest, "portForwardPresetCount");
  copyManifestInteger(normalized, manifest, "commandSnippetCount");
  copyManifestInteger(normalized, manifest, "modelProfileCount");
  if (manifest.capabilityCounts && typeof manifest.capabilityCounts === "object") {
    normalized.capabilityCounts = {
      skill: normalizeInteger(manifest.capabilityCounts.skill, 0, 0, Number.MAX_SAFE_INTEGER),
      mcp: normalizeInteger(manifest.capabilityCounts.mcp, 0, 0, Number.MAX_SAFE_INTEGER),
      cli: normalizeInteger(manifest.capabilityCounts.cli, 0, 0, Number.MAX_SAFE_INTEGER),
    };
  }
  copyManifestInteger(normalized, manifest, "encryptedCredentialCount");
  copyManifestInteger(normalized, manifest, "skippedCredentialCount");
  copyManifestInteger(normalized, manifest, "sensitiveMcpHeaderCount");
  if ("includesSecrets" in manifest) normalized.includesSecrets = Boolean(manifest.includesSecrets);
  return Object.keys(normalized).length ? normalized : null;
}

function copyManifestInteger(target, source, key) {
  if (!(key in source)) return;
  target[key] = normalizeInteger(source[key], 0, 0, Number.MAX_SAFE_INTEGER);
}

function copyManifestString(target, source, key) {
  const value = String(source[key] || "").trim();
  if (value) target[key] = value;
}

function buildBackupHosts(servers, includeSecrets) {
  return Object.entries(servers).map(([name, item]) => {
    const host = {
      name,
      host: item.ip || item.host,
      port: item.port || "22",
      user: item.user,
      group: item.group,
      authType: "redacted",
      cwd: item.cwd,
      policy: item.policy,
      note: item.note || "",
      timeoutSeconds: normalizeInteger(item.timeoutSeconds, 10, 3, 60),
      retryCount: normalizeInteger(item.retryCount, 0, 0, 3),
      keepaliveSeconds: normalizeInteger(item.keepaliveSeconds, 30, 0, 300),
      keepaliveCountMax: normalizeInteger(item.keepaliveCountMax, 3, 0, 10),
      tags: normalizeTags(item.tags),
      identityFile: String(item.identityFile || "").trim(),
      forwardAgent: normalizeBackupBoolean(item.forwardAgent),
      proxyJump: String(item.proxyJump || "").trim(),
      hostKeyAlias: String(item.hostKeyAlias || "").trim(),
    };
    const hostKey = normalizeHostKey(item.hostKey);
    const trustedHostKey = normalizeHostKey(item.trustedHostKey, true);
    const hostKeyTrust = normalizeHostKeyTrust(item.hostKeyTrust);
    const localForwards = normalizeBackupLocalForwards(item.localForwards);
    const remoteForwards = normalizeBackupRemoteForwards(item.remoteForwards);
    const dynamicForwards = normalizeBackupDynamicForwards(item.dynamicForwards);
    if (hostKey) host.hostKey = hostKey;
    if (trustedHostKey) host.trustedHostKey = trustedHostKey;
    if (hostKeyTrust) host.hostKeyTrust = hostKeyTrust;
    if (localForwards.length) host.localForwards = localForwards;
    if (remoteForwards.length) host.remoteForwards = remoteForwards;
    if (dynamicForwards.length) host.dynamicForwards = dynamicForwards;

    if (includeSecrets) {
      host.hasSecret = Boolean(item.credentialRef);
    }

    return host;
  });
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function sanitizeSshHostAlias(value) {
  const alias = String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return alias || "ssh-host";
}

function sshConfigValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^[A-Za-z0-9_./:@%+=,~-]+$/.test(text)) return text;
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function sanitizeSshConfigCommentValue(value) {
  return String(value || "")
    .replace(/\r?\n|\r/g, " ")
    .replace(/((?:api[-_ ]?key|access[-_ ]?key|token|password|passwd|pwd|secret)\s*[:=]\s*)[^\s,;#]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .replace(/#/g, "＃")
    .trim();
}

function normalizeInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  const nextValue = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(nextValue, minimum), maximum);
}

function normalizeTags(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[,，;；\n]/);
  const tags = [];
  const seen = new Set();
  source.forEach((item) => {
    const tag = String(item || "").trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) return;
    tags.push(tag);
    seen.add(key);
  });
  return tags;
}

function normalizeHostKey(value, includeTrustedAt = false) {
  const sha256 = String(value?.sha256 || "").trim();
  if (!sha256) return null;
  const hostKey = {
    type: String(value?.type || "unknown").trim() || "unknown",
    sha256,
  };
  const trustedAt = String(value?.trustedAt || "").trim();
  if (includeTrustedAt && trustedAt) {
    hostKey.trustedAt = trustedAt;
  }
  return hostKey;
}

function normalizeHostKeyTrust(value) {
  const status = String(value?.status || "").trim();
  const label = String(value?.label || "").trim();
  if (!status && !label) return null;
  return {
    status: status || "unknown",
    label: label || status || "未知",
  };
}

function buildSftpBookmarks(servers) {
  return Object.entries(servers).map(([name, item]) => ({
    host: name,
    paths: normalizeSftpBookmarks([
      ...(Array.isArray(item.sftpBookmarks) ? item.sftpBookmarks : []),
      ...(item.files || []).filter((file) => file.type === "folder").map((file) => file.path || file.name),
    ]),
  }));
}

function buildCapabilitiesByType(capabilities, type, includeSecrets = false) {
  return capabilities
    .filter((item) => item?.type === type)
    .map((item) => {
      const capability = {
        type,
        name: String(item.name || "").trim(),
        description: String(item.description || "").trim(),
        entry: String(item.entry || "").trim(),
        endpoint: String(item.endpoint || "").trim(),
        headers: type === "MCP" ? buildBackupMcpHeaders(item.headers, includeSecrets) : [],
        permission: String(item.permission || "").trim(),
        status: String(item.status || "").trim(),
        builtin: Boolean(item.builtin),
      };
      if (type === "Skill") {
        appendSkillMetadata(capability, item);
      }
      return capability;
    })
    .filter((item) => item.name);
}

function normalizeBackupCapability(item) {
  const type = String(item?.type || "").trim();
  const name = String(item?.name || "").trim();
  if (!["Skill", "MCP", "CLI"].includes(type) || !name) return null;
  const capability = {
    type,
    name,
    description: String(item.description || `导入的 ${type}`).trim(),
    permission: String(item.permission || (type === "CLI" ? "审批后执行" : "只读")).trim(),
    status: "待配置",
    builtin: Boolean(item.builtin),
  };
  if (type === "MCP") {
    capability.endpoint = String(item.endpoint || item.entry || name).trim();
    capability.headers = normalizeMcpHeaders(item.headers);
  } else {
    capability.entry = String(item.entry || item.endpoint || name).trim();
    if (type === "Skill") {
      appendSkillMetadata(capability, item);
    }
  }
  return capability;
}

function normalizeBackupPortForwardPreset(item) {
  try {
    const config = normalizePortForwardConfig(item);
    const serverName = String(item?.serverName || "").trim();
    const id = String(item?.id || makePortForwardPresetId(serverName, config)).trim();
    if (!id || !serverName) return null;
    return {
      id,
      serverName,
      name: String(item?.name || `${config.localPort} -> ${config.remoteHost}:${config.remotePort}`).trim(),
      localHost: config.localHost,
      localPort: config.localPort,
      remoteHost: config.remoteHost,
      remotePort: config.remotePort,
    };
  } catch {
    return null;
  }
}

function makePortForwardPresetId(serverName, config) {
  return `pfpreset-${sanitizeIdPart(serverName)}-${config.localPort}-${sanitizeIdPart(config.remoteHost)}-${config.remotePort}`;
}

function sanitizeIdPart(value) {
  return String(value || "server")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "server";
}

function appendSkillMetadata(target, source) {
  const version = String(source?.version || "").trim();
  const tags = normalizeSkillTags(source?.tags);
  const parameters = normalizeSkillParameters(source?.parameters);
  const commands = normalizeSkillCommands(source?.commands);
  const docs = String(source?.docs || "").trim();
  if (version) target.version = version;
  if (tags.length) target.tags = tags;
  if (parameters.length) target.parameters = parameters;
  if (commands.length) target.commands = commands;
  if (docs) target.docs = docs;
}

function normalizeSkillTags(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[,，;；\n]/);
  const tags = [];
  const seen = new Set();
  source.forEach((item) => {
    const tag = String(item || "").trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) return;
    tags.push(tag);
    seen.add(key);
  });
  return tags;
}

function normalizeSkillParameters(parameters = []) {
  return (Array.isArray(parameters) ? parameters : [])
    .map((item) => {
      const name = String(item?.name || "").trim();
      if (!name) return null;
      return {
        name,
        description: String(item?.description || "").trim(),
        required: Boolean(item?.required),
      };
    })
    .filter(Boolean);
}

function normalizeSkillCommands(commands = []) {
  return (Array.isArray(commands) ? commands : [])
    .map((item) => {
      const command = String(item?.command || "").trim();
      if (!command) return null;
      return {
        label: String(item?.label || command).trim() || command,
        command,
      };
    })
    .filter(Boolean);
}

function normalizeMcpHeaders(headers = []) {
  return (Array.isArray(headers) ? headers : [])
    .map(normalizeMcpHeader)
    .filter((item) => item.name);
}

function buildBackupMcpHeaders(headers = [], includeSecrets = false) {
  return normalizeMcpHeaders(headers).map((header) => {
    if (!header.sensitive) return header;
    return {
      name: header.name,
      value: "",
      enabled: header.enabled,
      sensitive: true,
      redacted: true,
      hasSecret: Boolean(header.value) || Boolean(header.hasSecret || header.secret),
    };
  });
}

function normalizeMcpHeader(item) {
  const header = {
    name: String(item?.name || "").trim(),
    value: String(item?.value || ""),
    enabled: item?.enabled !== false,
  };
  if (item?.sensitive === true || isSensitiveMcpHeaderName(header.name)) {
    header.sensitive = true;
  }
  if (item?.redacted) header.redacted = true;
  if (item?.hasSecret) header.hasSecret = true;
  if (item?.secret) header.secret = item.secret;
  return header;
}

function isSensitiveMcpHeaderName(name) {
  return /(^authorization$|api[-_]?key|token|secret|cookie)/i.test(String(name || "").trim());
}

function createServerFromBackupHost(host) {
  const name = String(host?.name || "").trim();
  const address = String(host?.host || host?.ip || "").trim();
  if (!name || !address) return null;

  const user = String(host.user || "root").trim() || "root";
  const port = String(host.port || "22").trim() || "22";
  const group = String(host.group || "导入备份").trim() || "导入备份";
  const cwd = String(host.cwd || `/home/${user}`).trim() || `/home/${user}`;
  const policy = String(host.policy || "默认确认策略").trim() || "默认确认策略";
  const trustedHostKey = normalizeHostKey(host.trustedHostKey, true);
  const hostKey = normalizeHostKey(host.hostKey);
  const hostKeyTrust = normalizeHostKeyTrust(host.hostKeyTrust);

  return {
    name,
    data: {
      ip: address,
      port,
      group,
      state: "未测试",
      tone: "amber",
      user,
      cwd,
      latency: "--",
      timeoutSeconds: normalizeInteger(host.timeoutSeconds, 10, 3, 60),
      retryCount: normalizeInteger(host.retryCount, 0, 0, 3),
      keepaliveSeconds: normalizeInteger(host.keepaliveSeconds, 30, 0, 300),
      keepaliveCountMax: normalizeInteger(host.keepaliveCountMax, 3, 0, 10),
      policy,
      authType: host.authType === "redacted" ? "未导入敏感凭据" : String(host.authType || "未导入敏感凭据"),
      credentialRef: "",
      hasCredential: false,
      note: String(host.note || "从备份导入").trim(),
      tags: normalizeTags(host.tags),
      identityFile: String(host.identityFile || "").trim(),
      forwardAgent: normalizeBackupBoolean(host.forwardAgent),
      proxyJump: String(host.proxyJump || "").trim(),
      hostKeyAlias: String(host.hostKeyAlias || "").trim(),
      localForwards: normalizeBackupLocalForwards(host.localForwards),
      remoteForwards: normalizeBackupRemoteForwards(host.remoteForwards),
      dynamicForwards: normalizeBackupDynamicForwards(host.dynamicForwards),
      ...(hostKey ? { hostKey } : {}),
      ...(trustedHostKey ? { trustedHostKey } : {}),
      ...(hostKeyTrust ? { hostKeyTrust } : {}),
      terminal: [
        `[${user}@${name} ~]# ssh ${user}@${address} -p ${port}`,
        "该服务器来自备份导入，敏感凭据不会明文恢复；请在真实凭据库中重新绑定密码或密钥。",
      ],
      files: [
        { type: "folder", name: cwd, meta: "默认目录" },
        { type: "file", name: "导入说明.txt", meta: "本地配置" },
      ],
      plan: ["测试 SSH 端口连通性", "重新绑定认证凭据", "读取系统基础信息", "生成首次巡检建议"],
      evidence: [
        { label: "host", value: `${address}:${port}` },
        { label: "source", value: "backup-import" },
      ],
    },
  };
}

function uniqueServerName(name, servers) {
  if (!servers[name]) return name;

  const importedName = `${name}-导入`;
  if (!servers[importedName]) return importedName;

  let index = 2;
  while (servers[`${importedName}-${index}`]) {
    index += 1;
  }
  return `${importedName}-${index}`;
}
