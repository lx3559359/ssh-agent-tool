export const AGENT_CAPABILITY_TYPES = ["Skill", "MCP", "CLI"];

export const DEFAULT_AGENT_CAPABILITIES = [
  {
    id: "builtin-skill-linux-health",
    type: "Skill",
    name: "Linux 健康检查",
    description: "系统负载、内存、磁盘、服务状态巡检",
    entry: "skills/linux-health.md",
    permission: "只读",
    status: "内置",
    builtin: true,
    enabled: true,
  },
  {
    id: "builtin-skill-nginx-502",
    type: "Skill",
    name: "Nginx 502 排查",
    description: "Nginx 配置、上游状态和错误日志分析",
    entry: "skills/nginx-502.md",
    permission: "只读",
    status: "内置",
    builtin: true,
    enabled: true,
  },
  {
    id: "builtin-skill-docker",
    type: "Skill",
    name: "Docker 服务异常",
    description: "容器状态、日志和资源占用检查",
    entry: "skills/docker-health.md",
    permission: "只读",
    status: "内置",
    builtin: true,
    enabled: true,
  },
  {
    id: "builtin-mcp-prometheus",
    type: "MCP",
    name: "Prometheus",
    description: "读取指标、告警和时序数据",
    endpoint: "mcp://prometheus",
    permission: "只读",
    status: "已连接",
    builtin: true,
    enabled: true,
  },
  {
    id: "builtin-mcp-cmdb",
    type: "MCP",
    name: "CMDB",
    description: "读取主机资产、负责人和部署关系",
    endpoint: "mcp://cmdb",
    permission: "只读",
    status: "已连接",
    builtin: true,
    enabled: true,
  },
  {
    id: "builtin-cli-ssh-ai",
    type: "CLI",
    name: "ssh-ai diagnose",
    description: "本地 CLI 扩展入口，通过 Agent 审批执行队列运行",
    entry: "ssh-ai diagnose",
    permission: "审批后执行",
    status: "可用",
    builtin: true,
    enabled: true,
  },
];

export function mergeAgentCapabilities(customCapabilities = []) {
  const merged = [...DEFAULT_AGENT_CAPABILITIES];
  for (const capability of Array.isArray(customCapabilities) ? customCapabilities : []) {
    try {
      addCapabilityToList(merged, capability);
    } catch {
      // Skip invalid persisted rows instead of breaking app startup.
    }
  }
  return merged;
}

export function addAgentCapability(currentCapabilities, draft) {
  const next = [...(Array.isArray(currentCapabilities) ? currentCapabilities : [])];
  addCapabilityToList(next, draft);
  return next;
}

export function buildCapabilityDraft(type, input, options = {}) {
  const normalizedType = normalizeType(type);
  const safeOptions = options && typeof options === "object" ? options : {};
  if (normalizedType === "Skill") {
    const manifestDraft = parseSkillManifestDraft(input);
    if (manifestDraft) return manifestDraft;
    const fileDraft = buildSkillFileDraft(input, safeOptions.sourceFileName);
    if (fileDraft) return fileDraft;
  }
  const name = String(input || "").trim();
  const base = {
    type: normalizedType,
    name,
    description: `自定义 ${normalizedType}`,
    permission: normalizedType === "CLI" ? "审批后执行" : "只读",
  };

  if (normalizedType === "MCP") {
    return {
      ...base,
      endpoint: String(safeOptions.endpoint || name).trim(),
      headers: parseMcpHeaderLines(safeOptions.headersText || ""),
    };
  }
  if (normalizedType === "CLI") {
    const executionTarget = safeOptions.cliTarget === "local" ? "local" : "ssh";
    const entry = executionTarget === "local" && !/^local:/i.test(name) && !/^cli:\/\/local\//i.test(name)
      ? `local:${name}`
      : name;
    return { ...base, entry, executionTarget };
  }
  return { ...base, entry: name };
}

function buildSkillFileDraft(input, sourceFileName = "") {
  const fileName = String(sourceFileName || "").trim();
  const text = String(input || "").trim();
  if (!fileName || !text) return null;
  const isSkillTextFile = /\.(skill\.)?(md|txt|json)$/i.test(fileName);
  if (!isSkillTextFile) return null;
  const name = skillNameFromFileName(fileName);
  if (!name) return null;
  return validateAgentCapability({
    type: "Skill",
    name,
    description: `自定义 Skill：${name}`,
    entry: fileName,
    permission: "只读",
    status: "可用",
    docs: text,
  });
}

function skillNameFromFileName(fileName = "") {
  const baseName = String(fileName || "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.skill\.(md|txt|json)$/i, "")
    .replace(/\.(md|txt|json)$/i, "")
    .trim();
  return baseName;
}

export function parseMcpHeaderLines(text = "") {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex <= 0) return null;
      const name = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      return name ? normalizeMcpHeader({ name, value, enabled: true }) : null;
    })
    .filter(Boolean);
}

export function normalizeMcpHeaders(headers = []) {
  return (Array.isArray(headers) ? headers : [])
    .map(normalizeMcpHeader)
    .filter((item) => item.name);
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
  return header;
}

function isSensitiveMcpHeaderName(name) {
  return /(^authorization$|api[-_]?key|token|secret|cookie)/i.test(String(name || "").trim());
}

export function validateAgentCapability(capability) {
  const type = normalizeType(capability?.type);
  const name = String(capability?.name || "").trim();
  if (!name) throw new Error("能力名称不能为空。");

  const normalized = {
    id: String(capability.id || makeCapabilityId(type, name)),
    type,
    name,
    description: String(capability.description || `自定义 ${type}`).trim(),
    permission: String(capability.permission || (type === "CLI" ? "审批后执行" : "只读")).trim(),
    status: String(capability.status || "待配置").trim(),
    builtin: Boolean(capability.builtin),
    enabled: capability.enabled !== false,
  };

  if (type === "MCP") {
    normalized.endpoint = String(capability.endpoint || capability.entry || name).trim();
    normalized.headers = normalizeMcpHeaders(capability.headers);
  } else {
    normalized.entry = String(capability.entry || capability.endpoint || name).trim();
    if (type === "CLI") {
      normalized.executionTarget = capability.executionTarget === "local" || /^local:/i.test(normalized.entry) || /^cli:\/\/local\//i.test(normalized.entry)
        ? "local"
        : "ssh";
    } else if (type === "Skill") {
      const version = String(capability.version || "").trim();
      const tags = normalizeSkillTags(capability.tags);
      const parameters = normalizeSkillParameters(capability.parameters);
      const commands = normalizeSkillCommands(capability.commands);
      const docs = String(capability.docs || "").trim();
      if (version) normalized.version = version;
      if (tags.length) normalized.tags = tags;
      if (parameters.length) normalized.parameters = parameters;
      if (commands.length) normalized.commands = commands;
      if (docs) normalized.docs = docs;
    }
  }

  return normalized;
}

function parseSkillManifestDraft(input) {
  const text = String(input || "").trim();
  if (!text.startsWith("{")) return null;
  try {
    const manifest = JSON.parse(text);
    if (!manifest || typeof manifest !== "object") return null;
    const name = String(manifest.name || "").trim();
    if (!name) return null;
    return validateAgentCapability({
      type: "Skill",
      name,
      description: String(manifest.description || `自定义 Skill`).trim(),
      entry: String(manifest.entry || manifest.path || name).trim(),
      permission: String(manifest.permission || "只读").trim(),
      status: String(manifest.status || "待配置").trim(),
      version: manifest.version,
      tags: manifest.tags,
      parameters: manifest.parameters,
      commands: manifest.commands,
      docs: manifest.docs,
      enabled: manifest.enabled !== false,
    });
  } catch {
    return null;
  }
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

export function getCustomAgentCapabilities(capabilities) {
  return (Array.isArray(capabilities) ? capabilities : [])
    .filter((item) => !item.builtin)
    .map((item) => validateAgentCapability(item));
}

export function setAgentCapabilityEnabled(capabilities, capabilityId, enabled) {
  const targetId = String(capabilityId || "").trim();
  return (Array.isArray(capabilities) ? capabilities : []).map((item) => {
    const capability = validateAgentCapability(item);
    if (capability.builtin || capability.id !== targetId) return capability;
    const nextEnabled = Boolean(enabled);
    return {
      ...capability,
      enabled: nextEnabled,
      status: nextEnabled ? "可用" : "停用",
    };
  });
}

export function removeAgentCapability(capabilities, capabilityId) {
  const targetId = String(capabilityId || "").trim();
  return (Array.isArray(capabilities) ? capabilities : [])
    .map((item) => validateAgentCapability(item))
    .filter((item) => item.builtin || item.id !== targetId);
}

function addCapabilityToList(list, draft) {
  const capability = validateAgentCapability(draft);
  const duplicate = list.some(
    (item) => item.type === capability.type && item.name.toLowerCase() === capability.name.toLowerCase(),
  );
  if (duplicate) throw new Error(`${capability.type} 能力已存在：${capability.name}`);
  list.push(capability);
  return list;
}

function normalizeType(type) {
  const normalized = String(type || "").trim();
  if (!AGENT_CAPABILITY_TYPES.includes(normalized)) {
    throw new Error(`不支持的 Agent 能力类型：${normalized || "空"}`);
  }
  return normalized;
}

function makeCapabilityId(type, name) {
  const slug = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `custom-${type.toLowerCase()}-${slug || Date.now()}`;
}
