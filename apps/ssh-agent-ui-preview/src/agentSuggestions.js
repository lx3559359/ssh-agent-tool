import { COMMAND_POLICY_ACTIONS, evaluateCommandPolicy } from "./commandPolicy.js";

const SUPPORTED_ACTION_TYPES = new Set(["Skill", "MCP", "CLI"]);

export function parseAgentActionSuggestions(text) {
  const payload = extractSuggestionPayload(text);
  const actions = Array.isArray(payload?.agentActions) ? payload.agentActions : [];

  return actions
    .map(normalizeSuggestion)
    .filter(Boolean);
}

export function buildAgentSuggestionPrompt(capabilities = []) {
  const capabilityLines = (Array.isArray(capabilities) ? capabilities : [])
    .filter((item) => item?.enabled !== false)
    .map((item) => {
      const target = item.type === "MCP" ? item.endpoint : item.entry;
      return `- ${item.type}: ${item.name}${target ? ` (${target})` : ""}`;
    })
    .join("\n");

  return [
    "你是这个 SSH 工具内置的 Agent。回答时先给出中文分析。",
    "如果需要让工具加入可审批执行的动作，请在回复末尾追加一个 JSON 代码块，格式如下：",
    "{\"agentActions\":[{\"type\":\"Skill|MCP|CLI\",\"name\":\"动作名称\",\"entry\":\"Skill 或 CLI 命令\",\"endpoint\":\"MCP endpoint\",\"reason\":\"为什么需要\"}]}",
    "只允许提出只读或低风险排查动作；不要输出删除、重启、写文件、改配置等高风险命令。",
    "当前可用能力：",
    capabilityLines || "- 暂无已启用能力",
  ].join("\n");
}

export function buildAgentTerminalContext(lines = [], options = {}) {
  const recentLines = normalizeContextLines(lines, options);
  if (recentLines.length === 0) {
    return "最近 SSH 终端输出：暂无。";
  }

  return ["最近 SSH 终端输出（可能已脱敏）：", clipContextText(recentLines.join("\n"), options)].join("\n");
}

export function buildAgentAttachmentContext(attachments = [], options = {}) {
  const items = Array.isArray(attachments) ? attachments : [];
  if (items.length === 0) {
    return "用户未上传附件。";
  }

  const sections = items.map((item, index) => {
    const name = String(item?.name || item?.type || "未命名").trim();
    const content = String(item?.content || "");
    const lines = normalizeContextLines(content.split(/\r?\n/), options);
    return [
      `附件 ${index + 1}：${name || "未命名"}`,
      clipContextText(lines.join("\n"), options) || "（空内容）",
    ].join("\n");
  });

  return [
    "用户上传或引用的附件（可能已脱敏）：",
    sections.join("\n\n"),
  ].join("\n");
}

export function buildAgentSftpPreviewContext(preview, options = {}) {
  const remotePath = String(preview?.remotePath || "").trim();
  const content = String(preview?.content || "");
  if (!remotePath || !content) {
    return "当前 SFTP 预览文件：暂无。";
  }

  const meta = [
    `路径：${remotePath}`,
    preview?.encoding ? `编码：${preview.encoding}` : "",
    Number(preview?.size || 0) > 0 ? `大小：${preview.size} B` : "",
  ].filter(Boolean).join(" / ");
  const lines = normalizeContextLines(content.split(/\r?\n/), options);

  return [
    "当前 SFTP 预览文件（可能已脱敏）：",
    meta,
    clipContextText(lines.join("\n"), options),
  ].filter(Boolean).join("\n");
}

function normalizeSuggestion(action) {
  const type = String(action?.type || "").trim();
  const name = String(action?.name || "").trim();
  if (!SUPPORTED_ACTION_TYPES.has(type) || !name) return null;

  const suggestion = {
    type,
    name,
    reason: String(action?.reason || "").trim(),
    entry: "",
    endpoint: "",
  };

  if (type === "MCP") {
    suggestion.endpoint = String(action?.endpoint || action?.entry || "").trim();
    if (!suggestion.endpoint) return null;
    return suggestion;
  }

  suggestion.entry = String(action?.entry || action?.command || "").trim();
  if (!suggestion.entry) return null;
  if (type === "CLI" && evaluateCommandPolicy(suggestion.entry).action === COMMAND_POLICY_ACTIONS.block) {
    return null;
  }
  return suggestion;
}

function extractSuggestionPayload(text) {
  const source = String(text || "").trim();
  if (!source) return {};

  for (const candidate of extractJsonCandidates(source)) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.agentActions)) {
        return parsed;
      }
    } catch {
      // Keep scanning later candidates.
    }
  }
  return {};
}

function extractJsonCandidates(source) {
  const candidates = [];
  const fencedPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match = fencedPattern.exec(source);
  while (match) {
    candidates.push(match[1].trim());
    match = fencedPattern.exec(source);
  }
  candidates.push(source);
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(source.slice(firstBrace, lastBrace + 1));
  }
  return candidates;
}

function normalizeContextLines(lines, options = {}) {
  const maxLines = Math.max(1, Number(options.maxLines || 24));
  return (Array.isArray(lines) ? lines : [])
    .map((line) => String(line || "").trimEnd())
    .filter(Boolean)
    .slice(-maxLines)
    .map(redactContextLine);
}

function clipContextText(text, options = {}) {
  const maxChars = Math.max(80, Number(options.maxChars || 1800));
  return text.length > maxChars ? `${text.slice(-maxChars)}\n...（已截取最近内容）` : text;
}

function redactContextLine(line) {
  const text = String(line || "");
  if (/(password|passwd|authorization|bearer\s+|api[-_]?key|token|secret|private key|BEGIN [A-Z ]*PRIVATE KEY)/i.test(text)) {
    return "[已脱敏]";
  }
  return text;
}
