import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  ClipboardList,
  Cloud,
  Copy,
  Database,
  Download,
  FileSearch,
  FileText,
  Folder,
  HardDrive,
  History,
  Info,
  KeyRound,
  Lock,
  Maximize2,
  MessageSquareText,
  MoreHorizontal,
  PencilLine,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Square,
  Star,
  TerminalSquare,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  addAgentCapability,
  buildCapabilityDraft,
  getCustomAgentCapabilities,
  mergeAgentCapabilities,
  removeAgentCapability,
  setAgentCapabilityEnabled,
} from "./agentCapabilities.js";
import {
  buildAgentApprovalDecision,
  buildCliRunnerPlan,
  buildMcpRunnerPlan,
  buildSkillRunnerDispatch,
  buildSkillRunnerPlan,
  formatCliRunnerResultTerminalLines,
  formatCliRunnerTerminalLines,
  formatMcpHttpResultTerminalLines,
  formatMcpRunnerTerminalLines,
  formatSkillRunnerTerminalLines,
} from "./agentExecution.js";
import { buildAgentAttachmentContext, buildAgentSftpPreviewContext, buildAgentSuggestionPrompt, buildAgentTerminalContext, parseAgentActionSuggestions } from "./agentSuggestions.js";
import {
  AGENT_TASK_STATUSES,
  addAgentReportArchiveEntry,
  approveAgentTask,
  buildAgentInspectionReport,
  buildAgentReportArchiveEntry,
  buildAgentReportArchiveExport,
  buildAgentReportFileName,
  buildAgentTask,
  buildSshDiagnosticAgentTask,
  cancelAgentTask as markAgentTaskCancelled,
  completeAgentTask,
  filterAgentReportArchives,
  filterAgentTasks,
  getPendingAgentTasks,
  queueAgentTask,
  removeAgentReportArchiveEntry,
  summarizeAgentTasks,
} from "./agentTasks.js";
import {
  buildBackupCenterModel,
  buildBackupCredentialChecklistText,
  buildBackupCredentialMatrix,
  buildBackupExportPreview,
  buildBackupHistoryEntry,
  buildBackupImportDialogModel,
  buildBackupImportPlan,
  buildBackupImportScopeSummary,
  buildBackupImportSubmitState,
  buildBackupImportPreview,
  buildBackupPayload,
  buildBackupFileName,
  buildBackupRestoreResultSummary,
  hasBackupImportTargets,
  addBackupHistoryEntry,
  clearBackupHistory,
  removeBackupHistoryEntry,
  validateBackupMasterPassword,
  buildOpenSshConfigExport,
  buildServerInventoryCsv,
  mergeBackupAgentCapabilities,
  mergeBackupCommandSnippets,
  mergeBackupHosts,
  mergeBackupModelProfiles,
  mergeBackupPortForwardPresets,
} from "./backupData.js";
import { evaluateCommandPolicy } from "./commandPolicy.js";
import { buildConnectionOverride, buildConnectionQuickFixActions, buildHostKeyEvidenceOverride, buildHostKeyTrustPrompt, buildSshConnectionDiagnostics, buildSshOpenFailureTerminalLines, extractHostKeyFromSshResult } from "./connectionState.js";
import {
  buildModelConfigForSave,
  buildModelProfile,
  buildStoredModelConfig,
  extractModelOptions,
  filterModelOptions,
  formatModelProfileTestStatus,
  formatModelHeaderLines,
  hasNewModelApiKey,
  maskModelApiKey,
  normalizeModelProfiles,
  parseModelHeaderLines,
  removeModelProfile,
  updateModelProfileTestResult,
  upsertModelProfile,
  validateModelApiDraft,
} from "./modelSettings.js";
import {
  batchUpdateCustomServers,
  buildAuthCenterModel,
  buildConnectionCheckReport,
  buildConnectionCheckRepairPlan,
  buildImportFollowupPrompt,
  buildServerContextActionModel,
  buildCustomServer,
  buildServerCopyInfo,
  buildServerCopySshCommand,
  buildServerTroubleshootingSummary,
  buildSshSessionLogContext,
  buildVisibleServerMap,
  buildServerProfileMarkdown,
  deleteCustomServer,
  filterServerGroups,
  flattenServerGroupNames,
  getServerAuthStatus,
  hasUsableServerAuth,
  normalizeServerAuthType,
  parseSshCommandToServerForm,
  revokeHostKeyTrustForServer,
  summarizeBatchServerResults,
  toggleCustomServerFavorite,
  trustHostKeyForServer,
  upsertCustomServer,
  validateServerConnectionForm,
  validateSshSessionOpenTarget,
} from "./serverManagement.js";
import { buildSshConfigImportPreview, mergeSshConfigHosts, mergeSshConfigPortForwardPresets } from "./sshConfigImport.js";
import { buildSshSmokeTestReport, buildSshSmokeTestStepRows, buildSshSmokeTestSummaryText, getSshSmokeTestOutcome, summarizeSshSmokeTestSteps } from "./sshSmokeTest.js";
import {
  buildAutoStartLocalForwardConfigs,
  buildPortForwardCommandPreview,
  buildPortForwardLocalUrl,
  getPortForwardPresetsForServer,
  normalizePortForwardConfig,
  removePortForwardPreset,
  upsertPortForwardPreset,
} from "./portForwardSettings.js";
import { buildSftpTerminalCommand, chooseSftpSelectionAfterRefresh, formatSftpPreviewMeta, getParentSftpPath, normalizeSftpPath, quoteSftpPathForShell, resolveShellWorkingDirectory, resolveSftpChildPath } from "./sftpNavigation.js";
import { addSftpBookmark, normalizeSftpBookmarks, removeSftpBookmark } from "./sftpBookmarks.js";
import { buildSftpOverwriteCancelledResult, buildSftpOverwriteConfirmMessage, isSftpOverwriteConflict } from "./sftpOverwrite.js";
import { getContextMenuPosition } from "./contextMenuPosition.js";
import { buildSftpContextActionModel, buildTerminalContextActionModel, mergeContextMenuItems } from "./contextMenuActions.js";
import { buildReleaseDiagnosticsSummary, buildReleaseFingerprintText, buildSupportTroubleshootingText, buildStartupDiagnosisText, buildUpdateCheckRequest, buildUpdateCheckStatus } from "./releaseInfo.js";
import {
  addCommandToHistory,
  addCustomCommandSnippet,
  adjustTerminalFontSize,
  applyTerminalCommandEditKey,
  buildConnectedShellInput,
  completeCommandDraft,
  buildRunningSessionControlInput,
  buildRunningSessionKeyInput,
  buildRunningSessionMetaInput,
  buildRunningSessionTextInput,
  clearCommandHistoryForServer,
  createHistoryCursor,
  DEFAULT_TERMINAL_FONT_SIZE,
  filterCommandHistory,
  formatTerminalInputForLog,
  getCommandHistoryKeyAction,
  getTerminalSearchKeyAction,
  getTerminalScrollKeyAction,
  getTerminalShortcutAction,
  isInteractiveExitInput,
  isLongRunningCommand,
  isTerminalInteractiveMode,
  mergeTerminalCommandSnippets,
  moveHistoryCursor,
  normalizeCommandHistories,
  prepareClipboardCommandPaste,
  prepareInteractiveClipboardPaste,
  removeCommandFromHistoryForServer,
  removeCustomCommandSnippet,
  searchCommandHistory,
  shouldSubmitAsSensitiveTerminalInput,
  validateCustomCommandSnippet,
  TERMINAL_COMMAND_SNIPPETS,
} from "./terminalHistory.js";
import { appendTerminalOutputState, buildTerminalCommandOutputBlock, buildTerminalExportFileName, buildTerminalExportText, buildTerminalSearchState, buildVisibleTerminalLines, extractTerminalCommandFromLine, formatInteractiveSessionLines, formatSshCommandResults, formatTerminalClipboardText, formatTerminalSelectionText, getTerminalControlModeUpdate, highlightTerminalSearchSegments, stripSubmittedCommandEcho, wrapBracketedPasteText } from "./terminalOutput.js";
import { buildTerminalSessionRecoveryActions, closeTerminalTab, closeTerminalTabModels, createDuplicateTerminalTab, getClosableTerminalTabIds, getTerminalSessionDiagnosticBadge, getTerminalSessionRecovery, getTerminalTabCloseImpact, getTerminalTabSessionState, moveTerminalTab, normalizeTerminalTabModels, openNextTerminalTab, openTerminalTab, removeServerTerminalTab, renameServerTerminalTab, renameTerminalTabTitle, selectAdjacentTerminalTab, toggleTerminalTabPinned } from "./terminalTabs.js";

const DEFAULT_MODEL = {
  provider: "OpenAI 兼容",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  apiFormat: "openai",
  apiKey: "",
  apiKeyRef: "",
  hasApiKey: false,
};

const DEFAULT_RELEASE_MANIFEST = {
  ok: false,
  appName: "SSH Agent 工具",
  version: "dev",
  generatedAt: "",
  updateChannel: "local",
  executable: "SSH-Agent-Tool.exe",
  sha256: "",
  sizeBytes: 0,
  updateCheckUrl: "",
  releaseNotesUrl: "",
  supportUrl: "",
  updatePolicy: "支持远程版本清单和应用内检查更新。",
  features: [],
  verification: [],
  message: "浏览器预览或本地开发版本，暂未读取到正式版 manifest。",
};

const DEFAULT_LAYOUT_COLUMNS = { left: 230, right: 380 };
const DEFAULT_SIDEBAR_SECTIONS = { server: 220, sftp: 260 };

const SSH_API_TIMEOUT_MS = 8000;
const AGENT_API_TIMEOUT_MS = 90000;

const MODEL_STORAGE_KEY = "sshAgentModelConfig";
const MODEL_PROFILES_STORAGE_KEY = "sshAgentModelProfiles";
const ACTIVE_MODEL_PROFILE_STORAGE_KEY = "sshAgentActiveModelProfile";
const MODEL_STATUS_STORAGE_KEY = "sshAgentModelStatuses";
const MODEL_OPTIONS_STORAGE_KEY = "sshAgentModelOptions";
const SESSION_LOG_FILTER_STORAGE_KEY = "sshAgentSessionLogFilters";
const TOOL_LOG_FILTER_STORAGE_KEY = "sshAgentToolLogFilters";
const MAX_AGENT_ATTACHMENT_BYTES = 1024 * 1024;

const PROVIDER_PRESETS = {
  "OpenAI 兼容": { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  DeepSeek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  "通义千问": { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  "智谱 GLM": { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-plus" },
  Moonshot: { baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  "Anthropic Claude": { baseUrl: "https://api.anthropic.com", model: "claude-3-5-sonnet-latest", apiFormat: "anthropic" },
  "硅基流动": { baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen3-32B" },
  OpenRouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4.1-mini",
    extraHeaders: [{ name: "X-Title", value: "SSH Agent Tool", enabled: true }],
  },
  "Ollama 本地": { baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5-coder:7b" },
  "中转站 API": { baseUrl: "https://api.your-relay.example/v1", model: "gpt-4.1-mini" },
};

const AGENT_QUICK_PROMPTS = [
  { label: "分析终端", text: "请分析当前 SSH 终端输出，指出最可能的问题、风险等级和下一步只读排查命令。" },
  { label: "解释报错", text: "请解释当前终端或 SFTP 预览里的报错，并给出排查顺序。" },
  { label: "生成命令", text: "请为当前服务器生成一组安全的只读排查命令，说明每条命令的用途。" },
  { label: "总结会话", text: "请总结当前服务器会话里已经看到的现象、证据和建议动作。" },
];

const AGENT_SLASH_COMMANDS = [
  { aliases: ["/分析", "/analyse", "/analyze"], text: AGENT_QUICK_PROMPTS[0].text },
  { aliases: ["/报错", "/error", "/explain"], text: AGENT_QUICK_PROMPTS[1].text },
  { aliases: ["/命令", "/cmd", "/command"], text: AGENT_QUICK_PROMPTS[2].text },
  { aliases: ["/总结", "/summary", "/summarize"], text: AGENT_QUICK_PROMPTS[3].text },
];

function expandAgentSlashCommand(value = "") {
  const raw = String(value || "").trim();
  const normalized = raw.replace(/\s+/g, " ").trim();
  const [command = "", ...rest] = normalized.split(" ");
  const item = AGENT_SLASH_COMMANDS.find((entry) => entry.aliases.includes(command.toLowerCase()) || entry.aliases.includes(command));
  if (!item) return raw;
  const detail = rest.join(" ").trim();
  if (!detail) return item.text;
  return `${item.text}\n\n${detail}`;
}

const TERMINAL_INTERACTIVE_CONTROL_BUTTONS = [
  { label: "Tab", text: "\t", title: "发送 Tab 补全" },
  { label: "Esc", text: "\x1b", title: "发送 Esc" },
  { label: "↑", text: "\x1b[A", title: "方向键上" },
  { label: "↓", text: "\x1b[B", title: "方向键下" },
  { label: "←", text: "\x1b[D", title: "方向键左" },
  { label: "→", text: "\x1b[C", title: "方向键右" },
  { label: "Ctrl+C", text: "\x03", title: "发送 Ctrl+C" },
  { label: "Ctrl+D", text: "\x04", title: "发送 Ctrl+D", finishInteractiveMode: true },
  { label: "Ctrl+Z", text: "\x1a", title: "发送 Ctrl+Z，挂起当前前台程序", finishInteractiveMode: true },
  { label: "Ctrl\\", text: "\x1c", title: "发送 Ctrl+\\，强制退出部分前台程序", finishInteractiveMode: true },
  { label: "Ctrl+]", text: "\x1d", title: "发送 Ctrl+]，退出部分远程交互程序" },
  { label: "Ctrl+A", text: "\x01", title: "发送 Ctrl+A，移动到行首" },
  { label: "Ctrl+B", text: "\x02", title: "发送 Ctrl+B，向左移动一个字符" },
  { label: "Ctrl+E", text: "\x05", title: "发送 Ctrl+E，移动到行尾" },
  { label: "Ctrl+F", text: "\x06", title: "发送 Ctrl+F，向右移动一个字符" },
  { label: "Ctrl+G", text: "\x07", title: "发送 Ctrl+G，取消远端搜索或编辑状态" },
  { label: "Ctrl+H", text: "\x08", title: "发送 Ctrl+H，兼容远端 Backspace" },
  { label: "Ctrl+U", text: "\x15", title: "发送 Ctrl+U，删除光标前内容" },
  { label: "Ctrl+K", text: "\x0b", title: "发送 Ctrl+K，删除光标后内容" },
  { label: "Ctrl+L", text: "\x0c", title: "发送 Ctrl+L，清屏" },
  { label: "Ctrl+W", text: "\x17", title: "发送 Ctrl+W，删除前一个单词" },
  { label: "Ctrl+Y", text: "\x19", title: "发送 Ctrl+Y，粘回刚删除的内容" },
  { label: "Ctrl+R", text: "\x12", title: "发送 Ctrl+R，触发远程 Shell 历史搜索" },
  { label: "Ctrl+P", text: "\x10", title: "发送 Ctrl+P，远程 Shell 上一条历史" },
  { label: "Ctrl+N", text: "\x0e", title: "发送 Ctrl+N，远程 Shell 下一条历史" },
  { label: "Ctrl+S", text: "\x13", title: "发送 Ctrl+S，暂停远程终端输出" },
  { label: "Ctrl+Q", text: "\x11", title: "发送 Ctrl+Q，恢复远程终端输出" },
];

function isConnectedShellFlowControlKey(event = {}) {
  const key = String(event?.key || "").toLowerCase();
  return event?.ctrlKey && !event?.shiftKey && !event?.altKey && !event?.metaKey && ["q", "s"].includes(key);
}

function isConnectedShellDirectControlKey(event = {}) {
  const key = String(event?.key || "").toLowerCase();
  return event?.ctrlKey && !event?.shiftKey && !event?.altKey && !event?.metaKey && [" ", "@", "2", "3", "4", "5", "6", "7", "8", "[", "\\", "]", "^", "_", "/", "?", "backspace", "delete", "pause", "cancel", "break", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "w", "x", "y", "z"].includes(key);
}

function isConnectedShellScreenControlKey(event = {}) {
  const key = String(event?.key || "").toLowerCase();
  return event?.ctrlKey && !event?.shiftKey && !event?.altKey && !event?.metaKey && key === "l";
}

function terminalPromptLabel(name = "") {
  return `[${name}]$`;
}

function waitForSshSmokeInterruptWindow(delayMs = 180) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function ignoreComposingEnterSubmit(event) {
  if (event.key !== "Enter") return;
  if (!event.isComposing && !event.nativeEvent?.isComposing) return;
  event.preventDefault();
  event.stopPropagation();
}

function buildTerminalHealthText(sessionState = {}, server = {}) {
  const rawKeepalive = sessionState.keepaliveSeconds ?? server.keepaliveSeconds ?? 30;
  const parsedKeepalive = Number.parseInt(String(rawKeepalive), 10);
  const keepaliveSeconds = Number.isFinite(parsedKeepalive) ? Math.min(Math.max(parsedKeepalive, 0), 300) : 30;
  const keepaliveText = keepaliveSeconds <= 0 ? "SSH 保活关闭" : `保活 ${keepaliveSeconds}s`;
  if (!sessionState?.sessionId) return keepaliveText;
  if (!sessionState?.healthCheckedAt) return `${keepaliveText} / 等待检查`;

  const checkedAt = new Date(sessionState.healthCheckedAt).getTime();
  if (!Number.isFinite(checkedAt)) return `${keepaliveText} / 最近检查`;
  const ageSeconds = Math.max(0, Math.floor((Date.now() - checkedAt) / 1000));
  const ageText = ageSeconds < 8
    ? "刚刚"
    : ageSeconds < 60
      ? `${ageSeconds}s前`
      : `${Math.floor(ageSeconds / 60)}分钟前`;
  return `${keepaliveText} / 最近检查 ${ageText}`;
}

function withSshApiTimeout(promise, message) {
  let timeoutId = 0;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), SSH_API_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function withAgentApiTimeout(promise, message) {
  let timeoutId = 0;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), AGENT_API_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function waitForMs(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const SERVER_DATA = {
  "prod-web-01": {
    ip: "10.0.1.23",
    group: "生产环境",
    state: "在线",
    tone: "green",
    user: "root",
    cwd: "/var/www/app",
    latency: "18ms",
    policy: "生产只读策略",
    terminal: [
      "[root@prod-web-01 ~]# uptime",
      "17:42:11 up 23 days,  4:12,  2 users,  load average: 0.42, 0.35, 0.28",
      "",
      "[root@prod-web-01 ~]# df -hT",
      "文件系统                    类型      容量  已用  可用  已用%  挂载点",
      "/dev/mapper/centos-root     xfs        50G   18G   32G   37%  /",
      "/dev/mapper/centos-data     xfs       200G   81G  119G   41%  /data",
      "",
      "[root@prod-web-01 ~]# systemctl --failed",
      "UNIT              LOAD   ACTIVE SUB     DESCRIPTION",
      "nginx.service     loaded active running The nginx HTTP and reverse proxy server",
      "php-fpm.service   loaded active running The PHP FastCGI Process Manager",
    ],
    files: [
      { type: "folder", name: "/var/www/app", meta: "当前目录" },
      { type: "file", name: "app.log", meta: "2.4 MB" },
      { type: "file", name: "nginx.conf", meta: "配置文件" },
      { type: "folder", name: "releases", meta: "12 项" },
    ],
    plan: ["检查系统负载和进程状态", "检查内存与 Swap 使用", "检查磁盘使用情况", "查看 Nginx 错误日志最近 200 行", "检查端口监听与连接数"],
    evidence: [
      { label: "uptime", value: "负载 0.42 / 0.35 / 0.28" },
      { label: "df -hT", value: "/data 已用 41%，无磁盘压力" },
      { label: "systemctl", value: "nginx.service 正常运行" },
      { label: "error.log", value: "未发现连续 upstream 超时" },
    ],
  },
  "prod-db-01": {
    ip: "10.0.1.31",
    group: "生产环境",
    state: "警告",
    tone: "amber",
    user: "mysql",
    cwd: "/var/lib/mysql",
    latency: "31ms",
    policy: "生产只读策略",
    terminal: [
      "[mysql@prod-db-01 ~]# uptime",
      "17:43:08 up 41 days,  3 users,  load average: 2.82, 2.31, 1.94",
      "",
      "[mysql@prod-db-01 ~]# df -hT /var/lib/mysql",
      "文件系统                    类型      容量  已用  可用  已用%  挂载点",
      "/dev/mapper/centos-data     xfs       500G  431G   69G   87%  /var/lib/mysql",
      "",
      "[mysql@prod-db-01 ~]# systemctl status mysqld --no-pager",
      "mysqld.service loaded active running MySQL Server",
    ],
    files: [
      { type: "folder", name: "/var/lib/mysql", meta: "数据目录" },
      { type: "file", name: "slow.log", meta: "18.7 MB" },
      { type: "file", name: "my.cnf", meta: "配置文件" },
      { type: "folder", name: "backup", meta: "5 项" },
    ],
    plan: ["检查磁盘水位", "查看 MySQL 连接数", "检查慢查询日志", "检查主从状态", "分析最近系统错误"],
    evidence: [
      { label: "df -hT", value: "/var/lib/mysql 已用 87%，需要关注" },
      { label: "slow.log", value: "最近 30 分钟慢查询增多" },
      { label: "systemctl", value: "mysqld 正常运行" },
    ],
  },
  "prod-nginx-02": {
    ip: "10.0.1.44",
    group: "生产环境",
    state: "在线",
    tone: "green",
    user: "root",
    cwd: "/etc/nginx",
    latency: "22ms",
    policy: "生产只读策略",
    terminal: [
      "[root@prod-nginx-02 ~]# nginx -t",
      "nginx: the configuration file /etc/nginx/nginx.conf syntax is ok",
      "nginx: configuration file /etc/nginx/nginx.conf test is successful",
      "",
      "[root@prod-nginx-02 ~]# tail -n 5 /var/log/nginx/error.log",
      "connect() failed (111: Connection refused) while connecting to upstream",
    ],
    files: [
      { type: "folder", name: "/etc/nginx", meta: "当前目录" },
      { type: "file", name: "nginx.conf", meta: "主配置" },
      { type: "folder", name: "conf.d", meta: "8 项" },
      { type: "file", name: "error.log", meta: "42.1 MB" },
    ],
    plan: ["检查 Nginx 配置", "查看 upstream 状态", "读取 error.log", "检查端口监听", "查看 Prometheus 5xx 指标"],
    evidence: [
      { label: "nginx -t", value: "配置语法正常" },
      { label: "error.log", value: "发现 upstream 连接被拒绝" },
      { label: "Prometheus", value: "5xx 在 10:28 后升高" },
    ],
  },
  "dev-docker-01": {
    ip: "10.0.2.15",
    group: "测试环境",
    state: "离线",
    tone: "gray",
    user: "devops",
    cwd: "/opt/services",
    latency: "--",
    policy: "测试只读策略",
    terminal: [
      "[devops@dev-docker-01 ~]# ssh",
      "连接不可用，主机离线或网络不通",
      "",
      "可以在右侧让 Agent 生成离线排查清单，或先测试网络连通性。",
    ],
    files: [
      { type: "folder", name: "/opt/services", meta: "离线主机" },
      { type: "file", name: "docker-compose.yml", meta: "本地记录" },
    ],
    plan: ["测试 SSH 端口连通性", "检查最近连接错误", "查看 CMDB 主机状态", "生成恢复建议"],
    evidence: [{ label: "连接状态", value: "当前无法建立 SSH 会话" }],
  },
};
function createCustomServer(form) {
  return buildCustomServer(form);
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(Number(value) || min, min), max);
}

function withoutObjectKey(source, key) {
  const next = { ...(source || {}) };
  delete next[key];
  return next;
}

function removeObjectKeys(source, keys) {
  const next = { ...(source || {}) };
  for (const key of Array.isArray(keys) ? keys : []) delete next[key];
  return next;
}

function ContextMenu({ menu, onClose }) {
  const menuRef = useRef(null);

  function getEnabledMenuButtons() {
    return Array.from(menuRef.current?.querySelectorAll?.("button:not(:disabled)") || []);
  }

  function handleMenuKeyDown(event) {
    const buttons = getEnabledMenuButtons();
    if (!buttons.length) return;
    const currentIndex = Math.max(0, buttons.indexOf(document.activeElement));
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % buttons.length;
    else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons[nextIndex]?.focus?.();
  }

  useEffect(() => {
    if (!menu?.items?.length) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") onClose?.();
    }

    function handlePointerDown(event) {
      if (!menuRef.current || menuRef.current.contains(event.target)) return;
      onClose?.();
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.requestAnimationFrame?.(() => getEnabledMenuButtons()[0]?.focus?.());
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [menu?.items?.length, onClose]);

  if (!menu?.items?.length) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: menu.x, top: menu.y, maxHeight: menu.maxHeight }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleMenuKeyDown}
    >
      {menu.title && <div className="context-menu-title">{menu.title}</div>}
      {menu.items.map((item) => (
        item.section ? (
          <div className="context-menu-section" key={item.id} role="presentation">
            {item.label}
          </div>
        ) : item.separator ? (
          <div className="context-menu-separator" key={item.id} />
        ) : (
          <button
            className={item.danger ? "danger" : ""}
            type="button"
            role="menuitem"
            key={item.id}
            title={item.title || (item.shortcut ? `${item.label} ${item.shortcut}` : item.label)}
            disabled={item.disabled}
            onClick={() => {
              onClose?.();
              item.onSelect?.();
            }}
          >
            <span className="context-menu-icon-slot" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
            {item.shortcut && <kbd className="context-menu-shortcut" aria-hidden="true">{item.shortcut}</kbd>}
          </button>
        )
      ))}
    </div>
  );
}

function RenameTerminalTabModal({ draft, onChange, onSubmit, onClose }) {
  const title = draft?.title || "";
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="重命名终端标签">
      <form className="settings-modal rename-tab-modal" onKeyDown={ignoreComposingEnterSubmit} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div className="modal-head">
          <div>
            <h2>重命名标签</h2>
            <p>{draft?.serverName ? `当前 SSH 会话：${draft.serverName}` : "为当前 SSH 终端标签设置一个更容易识别的名称。"}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <label className="field-stack">
          <span>标签名称</span>
          <input value={title} onChange={(event) => onChange({ ...draft, title: event.target.value })} autoFocus maxLength={80} />
        </label>
        <div className="modal-actions rename-tab-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button className="primary" type="submit">保存</button>
        </div>
      </form>
    </div>
  );
}

function SftpNameModal({ dialog, onChange, onSubmit, onClose }) {
  const value = dialog?.value || "";
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={dialog?.title || "SFTP 名称"}>
      <form className="settings-modal sftp-name-modal" onKeyDown={ignoreComposingEnterSubmit} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div className="modal-head">
          <div>
            <h2>{dialog?.title || "SFTP 名称"}</h2>
            <p>{dialog?.description || "请输入远程文件或目录名称。"}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <label className="field-stack">
          <span>{dialog?.label || "名称"}</span>
          <input value={value} onChange={(event) => onChange({ ...dialog, value: event.target.value })} autoFocus maxLength={160} />
        </label>
        <div className="modal-actions rename-tab-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button className="primary" type="submit">确定</button>
        </div>
      </form>
    </div>
  );
}

function SftpOverwriteConfirmModal({ dialog, onSubmit, onClose }) {
  if (!dialog) return null;
  const message = buildSftpOverwriteConfirmMessage(dialog.result, dialog.type);
  const path = dialog.result?.remotePath || dialog.result?.localPath || "";
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="确认覆盖 SFTP 文件">
      <div className="settings-modal sftp-delete-modal">
        <div className="modal-head">
          <div>
            <h2>覆盖文件</h2>
            <p>{message}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="confirm-path-box">
          <span>目标路径</span>
          <strong>{path || "-"}</strong>
        </div>
        <div className="modal-actions rename-tab-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button className="danger-button" type="button" onClick={onSubmit}>确认覆盖</button>
        </div>
      </div>
    </div>
  );
}

function SftpDeleteConfirmModal({ dialog, onSubmit, onClose }) {
  const itemType = dialog?.file?.type === "folder" ? "目录" : "文件";
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="确认删除 SFTP 项目">
      <div className="settings-modal sftp-delete-modal">
        <div className="modal-head">
          <div>
            <h2>删除{itemType}</h2>
            <p>删除后无法从本工具撤销。目录必须为空才会删除。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="confirm-path-box">
          <span>远程路径</span>
          <strong>{dialog?.remotePath || dialog?.file?.name || "-"}</strong>
        </div>
        <div className="modal-actions rename-tab-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button className="danger-button" type="button" onClick={onSubmit}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function DesktopConfirmModal({ action, onSubmit, onClose }) {
  if (!action) return null;
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={action.title || "确认操作"}>
      <div className="settings-modal desktop-confirm-modal">
        <div className="modal-head">
          <div>
            <h2>{action.title || "确认操作"}</h2>
            <p>{action.message || "请确认是否继续。"}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        {action.detail && (
          <div className="confirm-path-box">
            <span>{action.detailLabel || "详情"}</span>
            <strong>{action.detail}</strong>
          </div>
        )}
        <div className="modal-actions rename-tab-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button className={action.danger ? "danger-button" : "primary-button"} type="button" onClick={onSubmit}>
            {action.confirmLabel || "确认"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatServerKeepaliveFormValue(server) {
  return server?.keepaliveSeconds === 0 ? "0" : String(server?.keepaliveSeconds || "30");
}

function serverToHostForm(name, server) {
  const user = server?.user || "root";
  return {
    name,
    host: server?.ip || server?.host || "",
    port: String(server?.port || "22"),
    user,
    group: server?.group || "生产环境",
    authType: server?.authType || "密码",
    credentialRef: server?.credentialRef || "",
    credentialSecret: "",
    identityFile: server?.identityFile || "",
    proxyJump: server?.proxyJump || "",
    hostKeyAlias: server?.hostKeyAlias || "",
    forwardAgent: Boolean(server?.forwardAgent),
    cwd: server?.cwd || `/home/${user}`,
    timeoutSeconds: String(server?.timeoutSeconds || "10"),
    retryCount: String(server?.retryCount || "0"),
    keepaliveSeconds: formatServerKeepaliveFormValue(server),
    keepaliveCountMax: String(server?.keepaliveCountMax || "3"),
    note: server?.note || "",
    tags: Array.isArray(server?.tags) ? server.tags.join(", ") : server?.tags || "",
  };
}

function buildDuplicateServerName(name, servers = {}) {
  const baseName = `${String(name || "server").trim() || "server"}-copy`;
  if (!servers[baseName]) return baseName;

  let index = 2;
  while (servers[`${baseName}-${index}`]) index += 1;
  return `${baseName}-${index}`;
}

function buildSshCredentialMetadata(form = {}) {
  return {
    authType: normalizeServerAuthType(form.authType || "密码"),
    user: String(form.user || "root").trim() || "root",
    host: String(form.host || form.ip || "").trim(),
    identityFile: String(form.identityFile || "").trim(),
    proxyJump: String(form.proxyJump || "").trim(),
    hostKeyAlias: String(form.hostKeyAlias || "").trim(),
    forwardAgent: Boolean(form.forwardAgent),
  };
}

function StatusDot({ tone = "green" }) {
  return <span className={`status-dot ${tone}`} />;
}

function IconButton({ children, label, onClick }) {
  return (
    <button className="icon-button" type="button" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

function TerminalLine({ line, index, className = "", searchQuery = "" }) {
  const segments = highlightTerminalSearchSegments(line, searchQuery);
  return (
    <pre className={className} data-terminal-line={index}>
      {segments.map((segment, segmentIndex) => (
        segment.href ? (
          <a className={`terminal-ansi ${segment.className || ""}`.trim()} href={segment.href} key={`${index}-${segmentIndex}`} target="_blank" rel="noreferrer" style={segment.style}>
            {segment.text || " "}
          </a>
        ) : (
          <span className={`terminal-ansi ${segment.className || ""}`.trim()} key={`${index}-${segmentIndex}`} style={segment.style}>
            {segment.text || " "}
          </span>
        )
      ))}
    </pre>
  );
}

function DesktopTopBar({
  servers,
  selectedServer,
  modelConfig,
  agentCapabilities,
  visibleServerNames,
  latestConnectionCheck,
  selectedFile,
  sftpPath,
  isSftpBusy,
  recentSftpOperation,
  sessionState,
  onOpenToolSettings,
  onOpenNewHost,
  onOpenModelSettings,
  onOpenAuthCenter,
  onOpenPortForward,
  onOpenSessionLogs,
  onOpenToolLogs,
  onOpenBackup,
  onImportSshConfig,
  onImportBackup,
  onOpenReleaseInfo,
  onCheckReleaseUpdate,
  onExportDiagnosticPackage,
  onTestConnection,
  isTestingConnection,
  onRunSshSmokeTest,
  isSshSmokeTesting,
  onExportSshSmokeTestReport,
  latestSshSmokeTest,
  onReadBasicInfo,
  isReadingBasicInfo,
  onBatchOpenSessions,
  isBatchConnecting,
  onBatchCloseSessions,
  isBatchDisconnecting,
  onBatchReconnectSessions,
  isBatchReconnecting,
  onBatchTestConnections,
  isBatchTesting,
  onBatchReadBasicInfo,
  isBatchReading,
  onQueueBatchAgent,
  isBatchQueuing,
  onQueueDiagnosticSkill,
  onOpenBatchEdit,
  onExportConnectionCheckReport,
  onExportServerProfile,
  onRunConnectionQuickFix,
  onRunConnectionCheckRepair,
  onOpenSession,
  onCloseSession,
  onReconnectSession,
  onInterruptCommand,
  onCopyServerSshCommand,
  onCopyServerConnectionInfo,
  onCopyServerTroubleshootingSummary,
  onCopyCurrentWorkingDirectory,
  onOpenCurrentWorkingDirectoryInSftp,
  onCopyTerminal,
  onClearTerminal,
  onGoSftpParent,
  onRefreshSftp,
  onUploadSftp,
  onUploadSftpDirectory,
  onDownloadSftp,
  onPreviewSftpFile,
  onCreateSftpFile,
  onCreateSftpDirectory,
  onRenameSftpItem,
  onDeleteSftpItem,
  onCancelSftpOperation,
  onNotice,
}) {
  const selectedServerData = servers[selectedServer];
  const batchCount = visibleServerNames.length;
  const isSshSessionBusy = Boolean(sessionState?.busy);
  const isSshSessionConnected = Boolean(sessionState?.sessionId);
  const hasCancellableSftpTransfer = recentSftpOperation?.status === "running" && recentSftpOperation?.jobId;
  const [openTopbarMenu, setOpenTopbarMenu] = useState("");
  const topbarRef = useRef(null);
  const diagnosticSkills = agentCapabilities.filter((item) => item.type === "Skill").slice(0, 4);
  const sshQuickFixActions = buildConnectionQuickFixActions(selectedServerData?.sshDiagnostics, selectedServerData);
  const connectionCheckRepairPlan = buildConnectionCheckRepairPlan({ servers, results: latestConnectionCheck?.results || [] });
  const configTopbarActions = [
    { label: "工具设置", icon: <Settings size={15} />, onClick: onOpenToolSettings },
    { label: "模型 API", icon: <KeyRound size={15} />, onClick: onOpenModelSettings },
    { label: "密钥认证", icon: <Lock size={15} />, onClick: onOpenAuthCenter },
  ];
  const connectionTopbarActions = [
    { label: "新建连接", icon: <Plus size={15} />, onClick: onOpenNewHost },
    { label: "端口转发", icon: <Activity size={15} />, onClick: onOpenPortForward },
    { label: "导入配置", icon: <Upload size={15} />, onClick: onImportSshConfig },
  ];
  const dataTopbarActions = [
    { label: "会话日志", icon: <FileText size={15} />, onClick: onOpenSessionLogs },
    { label: "工具日志", icon: <FileSearch size={15} />, onClick: onOpenToolLogs },
    { label: "备份导出", icon: <Download size={15} />, onClick: onOpenBackup },
    { label: "导入备份", icon: <Upload size={15} />, onClick: onImportBackup },
  ];
  const helpTopbarActions = [
    { label: "导出诊断包", icon: <FileSearch size={15} />, onClick: onExportDiagnosticPackage },
    { label: "检查更新", icon: <RefreshCw size={15} />, onClick: onCheckReleaseUpdate },
    { label: "版本信息", icon: <Info size={15} />, onClick: onOpenReleaseInfo },
  ];
  const sftpTopbarActions = [
    { label: "取消 SFTP 传输", icon: <X size={15} />, onClick: () => onCancelSftpOperation?.(recentSftpOperation), disabled: !hasCancellableSftpTransfer },
    { label: "刷新目录", icon: <RefreshCw size={15} />, onClick: onRefreshSftp, disabled: isSftpBusy },
    { label: "返回上级目录", icon: <ChevronUp size={15} />, onClick: onGoSftpParent, disabled: isSftpBusy || normalizeSftpPath(sftpPath) === "/" },
    { label: "上传文件", icon: <Upload size={15} />, onClick: onUploadSftp, disabled: isSftpBusy },
    { label: "上传文件夹", icon: <Folder size={15} />, onClick: onUploadSftpDirectory, disabled: isSftpBusy },
    { label: "新建文件", icon: <FileText size={15} />, onClick: onCreateSftpFile, disabled: isSftpBusy },
    { label: "新建目录", icon: <Plus size={15} />, onClick: onCreateSftpDirectory, disabled: isSftpBusy },
    { label: "预览文件", icon: <FileSearch size={15} />, onClick: onPreviewSftpFile, disabled: isSftpBusy || !selectedFile || selectedFile?.type === "folder" },
    { label: "下载文件/目录", icon: <Download size={15} />, onClick: onDownloadSftp, disabled: isSftpBusy || !selectedFile },
    { label: "重命名", icon: <PencilLine size={15} />, onClick: onRenameSftpItem, disabled: isSftpBusy || !selectedFile },
    { label: "删除", icon: <Trash2 size={15} />, onClick: onDeleteSftpItem, disabled: isSftpBusy || !selectedFile },
  ];
  const sshTopbarActions = [
    { label: "连接 SSH 会话", icon: <TerminalSquare size={15} />, onClick: onOpenSession, disabled: isSshSessionBusy || isSshSessionConnected },
    { label: "重连 SSH 会话", icon: <RefreshCw size={15} />, onClick: onReconnectSession, disabled: isSshSessionBusy },
    { label: "中断当前命令", icon: <X size={15} />, onClick: onInterruptCommand, disabled: !isSshSessionConnected },
    { label: isSshSessionBusy ? "强制断开会话" : "断开当前会话", icon: <TerminalSquare size={15} />, onClick: onCloseSession, disabled: !isSshSessionConnected, force: isSshSessionBusy },
    { label: "复制 SSH 命令", icon: <Copy size={15} />, onClick: onCopyServerSshCommand },
    { label: "复制连接信息", icon: <FileText size={15} />, onClick: onCopyServerConnectionInfo },
    { label: "复制排障摘要", icon: <FileSearch size={15} />, onClick: onCopyServerTroubleshootingSummary },
    { label: "复制当前远程目录", icon: <Folder size={15} />, onClick: () => onCopyCurrentWorkingDirectory?.(selectedServer) },
    { label: "在 SFTP 打开当前目录", icon: <Folder size={15} />, onClick: () => onOpenCurrentWorkingDirectoryInSftp?.(selectedServer) },
    { label: "复制选中/输出", icon: <Copy size={15} />, onClick: onCopyTerminal },
    { label: "清空当前终端", icon: <Trash2 size={15} />, onClick: onClearTerminal },
    { label: isTestingConnection ? "测试中..." : "测试连接", icon: <TerminalSquare size={15} />, onClick: onTestConnection, disabled: isTestingConnection },
    { label: isSshSmokeTesting ? "自检中..." : "一键基础自检", icon: <Activity size={15} />, onClick: onRunSshSmokeTest, disabled: isSshSmokeTesting },
    { label: "导出基础自检报告", icon: <FileText size={15} />, onClick: onExportSshSmokeTestReport, disabled: !latestSshSmokeTest?.report },
    { label: isReadingBasicInfo ? "读取中..." : "读取基础信息", icon: <ClipboardCheck size={15} />, onClick: onReadBasicInfo, disabled: isReadingBasicInfo },
    { label: isBatchConnecting ? "批量连接中..." : `批量连接当前列表 (${batchCount})`, icon: <TerminalSquare size={15} />, onClick: () => onBatchOpenSessions(visibleServerNames), disabled: isBatchConnecting || batchCount === 0 },
    { label: isBatchDisconnecting ? "批量断开中..." : `批量断开当前列表 (${batchCount})`, icon: <X size={15} />, onClick: () => onBatchCloseSessions(visibleServerNames), disabled: isBatchDisconnecting || batchCount === 0 },
    { label: isBatchReconnecting ? "批量重连中..." : `批量重连当前列表 (${batchCount})`, icon: <RefreshCw size={15} />, onClick: () => onBatchReconnectSessions(visibleServerNames), disabled: isBatchReconnecting || batchCount === 0 },
    { label: isBatchTesting ? "批量测试中..." : `批量测试当前列表 (${batchCount})`, icon: <Activity size={15} />, onClick: () => onBatchTestConnections(visibleServerNames), disabled: isBatchTesting || batchCount === 0 },
    { label: isBatchReading ? "批量读取中..." : `批量读取基础信息 (${batchCount})`, icon: <ClipboardCheck size={15} />, onClick: () => onBatchReadBasicInfo(visibleServerNames), disabled: isBatchReading || batchCount === 0 },
    { label: isBatchQueuing ? "加入队列中..." : `批量加入 Agent 巡检 (${batchCount})`, icon: <Bot size={15} />, onClick: () => onQueueBatchAgent(visibleServerNames), disabled: isBatchQueuing || batchCount === 0 },
    { label: "批量编辑当前列表", icon: <Settings size={15} />, onClick: () => onOpenBatchEdit(visibleServerNames), disabled: batchCount === 0 },
    { label: "导出最近校验报告", icon: <FileText size={15} />, onClick: onExportConnectionCheckReport, disabled: !latestConnectionCheck?.results?.length },
    { label: "导出连接档案", icon: <FileText size={15} />, onClick: onExportServerProfile, disabled: batchCount === 0 },
    ...sshQuickFixActions.map((action) => ({ label: action.label, icon: <TerminalSquare size={15} />, onClick: () => onRunConnectionQuickFix(action) })),
    ...(connectionCheckRepairPlan.visible ? connectionCheckRepairPlan.primaryActions.map((action) => ({ label: `修复最近校验：${action.label}`, icon: <ShieldCheck size={15} />, onClick: () => onRunConnectionCheckRepair(connectionCheckRepairPlan.rows[0], action) })) : []),
  ];
  const diagnosticTopbarActions = diagnosticSkills.map((skill) => ({
    label: skill.name,
    icon: skill.name.includes("Nginx") ? <FileSearch size={15} /> : skill.name.includes("Docker") ? <HardDrive size={15} /> : <ClipboardCheck size={15} />,
    onClick: () => onQueueDiagnosticSkill(skill, selectedServer),
  }));

  useEffect(() => {
    if (!openTopbarMenu) return undefined;

    function handleTopbarOutsidePointerDown(event) {
      if (topbarRef.current?.contains(event.target)) return;
      setOpenTopbarMenu("");
    }

    function handleTopbarEscape(event) {
      if (event.key === "Escape") setOpenTopbarMenu("");
    }

    document.addEventListener("pointerdown", handleTopbarOutsidePointerDown);
    document.addEventListener("keydown", handleTopbarEscape);
    return () => {
      document.removeEventListener("pointerdown", handleTopbarOutsidePointerDown);
      document.removeEventListener("keydown", handleTopbarEscape);
    };
  }, [openTopbarMenu]);

  function handleTopbarMenuAction(event, item) {
    item.onClick?.();
    setOpenTopbarMenu("");
    event.currentTarget.closest("details")?.removeAttribute("open");
  }

  function handleTopbarMenuToggle(event, label) {
    if (event.currentTarget.open) setOpenTopbarMenu(label);
    else if (openTopbarMenu === label) setOpenTopbarMenu("");
  }

  function renderTopbarMenu(label, icon, items) {
    return (
      <details className="topbar-menu" open={openTopbarMenu === label} onToggle={(event) => handleTopbarMenuToggle(event, label)}>
        <summary aria-label={label} title={label}>
          {icon}
          <span>{label}</span>
          <ChevronDown size={13} />
        </summary>
        <div className="topbar-menu-panel">
          {items.map((item) => (
            <button type="button" key={item.label} onClick={(event) => handleTopbarMenuAction(event, item)} disabled={item.disabled} title={item.label}>
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </details>
    );
  }

  return (
    <header className="desktop-topbar" aria-label="全局工具栏" ref={topbarRef}>
      <div className="topbar-context">
        <strong>SSH Agent 工具</strong>
        <span><StatusDot />{selectedServer} · {modelConfig.provider}</span>
      </div>
      <div className="topbar-actions">
        {renderTopbarMenu("SSH 操作", <TerminalSquare size={15} />, sshTopbarActions)}
        {renderTopbarMenu("诊断", <FileSearch size={15} />, diagnosticTopbarActions)}
        {renderTopbarMenu("配置", <Settings size={15} />, configTopbarActions)}
        {renderTopbarMenu("连接", <Plus size={15} />, connectionTopbarActions)}
        {renderTopbarMenu("SFTP 文件", <Folder size={15} />, sftpTopbarActions)}
        {renderTopbarMenu("数据", <Download size={15} />, dataTopbarActions)}
        {renderTopbarMenu("帮助", <Info size={15} />, helpTopbarActions)}
      </div>
    </header>
  );
}

function buildModelMessages(conversation, selectedServer, server, selectedFile, capabilities, sftpPreview = null, options = {}) {
  const attachments = Array.isArray(options.attachments) ? options.attachments : [];
  const contextTerminalLines = Array.isArray(options.terminalLines) ? options.terminalLines : [];
  const attachmentContext = buildAgentAttachmentContext(attachments, { maxLines: 80, maxChars: 12000 });
  const searchContext = options.webSearchEnabled
    ? "\u7528\u6237\u5df2\u542f\u7528\u8054\u7f51\u641c\u7d22\u3002\u5f53\u524d\u7248\u672c\u4f1a\u628a\u641c\u7d22\u9700\u6c42\u4f20\u9012\u7ed9 Agent\uff1b\u5982\u679c\u6ca1\u6709\u771f\u5b9e\u641c\u7d22\u7ed3\u679c\uff0c\u8bf7\u8bf4\u660e\u9700\u8981\u63a5\u5165 MCP / CLI / \u641c\u7d22 API \u540e\u624d\u80fd\u8054\u7f51\u67e5\u8be2\u3002"
    : "\u7528\u6237\u672a\u542f\u7528\u8054\u7f51\u641c\u7d22\u3002";
  const context = [
    "\u4f60\u662f\u4e00\u4e2a\u9762\u5411 Windows SSH \u5ba2\u6237\u7aef\u7684\u8fd0\u7ef4 Agent\u3002",
    `\u5f53\u524d\u670d\u52a1\u5668\uff1a${selectedServer}`,
    `IP\uff1a${server.ip || ""}`,
    `\u7528\u6237\uff1a${server.user || ""}`,
    `\u5f53\u524d\u76ee\u5f55\uff1a${server.cwd || ""}`,
    `\u9009\u4e2d\u6587\u4ef6\uff1a${selectedFile?.name || "\u65e0"}`,
    `\u5df2\u63a5\u5165\u80fd\u529b\uff1a${capabilities.map((item) => `${item.type}:${item.name}`).join("\u3001")}`,
    "\u8bf7\u4f18\u5148\u7528\u7b80\u6d01\u4e2d\u6587\u56de\u7b54\u3002\u9700\u8981\u6267\u884c SSH \u547d\u4ee4\u65f6\uff0c\u5148\u89e3\u91ca\u76ee\u7684\u5e76\u7ed9\u51fa\u53ef\u590d\u5236\u547d\u4ee4\uff1b\u4e0d\u8981\u5047\u88c5\u5df2\u7ecf\u6267\u884c\u672a\u6267\u884c\u7684\u547d\u4ee4\u3002",
    buildAgentTerminalContext(contextTerminalLines),
    buildAgentSftpPreviewContext(sftpPreview),
    attachmentContext,
    searchContext,
    buildAgentSuggestionPrompt(capabilities),
  ].join("\\n");

  return [
    { role: "system", content: context },
    ...conversation.slice(-8).map((item) => ({
      role: item.role === "agent" ? "assistant" : "user",
      content: item.text,
    })),
  ];
}

function buildAgentSearchStatusMessage(searchResult, query) {
  const safeQuery = String(query || "").trim();
  const resultCount = Array.isArray(searchResult?.results) ? searchResult.results.length : 0;
  if (searchResult?.ok) {
    const provider = String(searchResult?.provider || "").trim();
    const providerText = provider ? `\uff0c\u6765\u6e90\uff1a${provider}` : "";
    return `\u8054\u7f51\u641c\u7d22\u5b8c\u6210\uff1a${safeQuery}${providerText}\uff0c\u5171\u627e\u5230 ${resultCount} \u6761\u7ed3\u679c\u3002\u4f60\u53ef\u4ee5\u7ed3\u5408\u8fd9\u4e9b\u7ed3\u679c\u7ee7\u7eed\u5206\u6790 SSH \u8f93\u51fa\u3002`;
  }
  const message = searchResult?.message || "\u5f53\u524d\u7248\u672c\u672a\u5b8c\u6210\u771f\u5b9e\u8054\u7f51\u641c\u7d22\u63a5\u5165\u3002";
  return `\u8054\u7f51\u641c\u7d22\u4e0d\u53ef\u7528\uff1a${message}\u3002\u4f60\u4ecd\u7136\u53ef\u4ee5\u57fa\u4e8e\u5f53\u524d SSH \u8f93\u51fa\u548c\u672c\u5730\u4e0a\u4e0b\u6587\u7ee7\u7eed\u5206\u6790\u3002`;
}

function getAgentReadiness({ modelConfig, selectedServer, server, hasModelApi }) {
  if (!server || !selectedServer) {
    return {
      ready: false,
      label: "\u8bf7\u9009\u62e9\u670d\u52a1\u5668",
      message: "\u8bf7\u9009\u62e9\u5de6\u4fa7\u670d\u52a1\u5668\uff0cAgent \u4f1a\u7ed3\u5408 SSH \u8f93\u51fa\u3001SFTP \u9884\u89c8\u548c\u5df2\u63a5\u5165\u80fd\u529b\u8fdb\u884c\u5206\u6790\u3002",
      placeholder: "\u8bf7\u9009\u62e9\u670d\u52a1\u5668\u540e\u518d\u63d0\u95ee...",
    };
  }

  if (!hasModelApi) {
    return {
      ready: false,
      label: "需要正式客户端",
      message: "当前环境没有可用的模型 API 桥接，需要运行 exe 正式客户端，并在模型 API 中配置 Base URL、API Key 和默认模型。",
      placeholder: "请先配置模型 API 后再使用 Agent...",
    };
  }

  if (!modelConfig?.baseUrl || !modelConfig?.model) {
    return {
      ready: false,
      label: "模型 API 未配置",
      message: "请先配置模型 API：填写 Base URL、默认模型，并按供应商要求填写 API Key。保存并测试通过后 Agent 才能调用模型。",
      placeholder: "请先配置模型 API...",
    };
  }

  return {
    ready: true,
    label: "\u5728\u7ebf",
    message: "",
    placeholder: "\u8f93\u5165\u4f60\u7684\u95ee\u9898\uff0c\u6216\u8ba9 Agent \u5206\u6790\u5f53\u524d SSH \u8f93\u51fa...",
  };
}
function safeFileApi() {
  return window.pywebview?.api;
}

function sanitizeFrontendRuntimeError(error) {
  let raw = "";
  if (typeof error === "string") {
    raw = error;
  } else if (error?.stack) {
    raw = String(error.stack);
  } else if (error?.message) {
    raw = String(error.message);
  } else {
    try {
      raw = JSON.stringify(error);
    } catch {
      raw = String(error || "unknown frontend error");
    }
  }
  return String(raw || "unknown frontend error")
    .replace(/\b(authorization\s*:\s*bearer\s+)["']?[^"'\s,;]+/gi, "$1[redacted]")
    .replace(/\b(authorization\s*:\s*)(?!bearer\b)["']?[^"'\s,;]+/gi, "$1[redacted]")
    .replace(/\b(cookie\s*:\s*)["']?[^"'\r\n]+/gi, "$1[redacted]")
    .replace(/((?:api[-_ ]?key|access[-_ ]?key|token|password|passwd|pwd|secret)\s*[:=]\s*)["']?[^"'\s,;]+/gi, "$1[redacted]")
    .slice(0, 4000);
}

function readStoredCommandHistories() {
  const raw = readLocalJson("sshAgentCommandHistories", {});
  const normalized = normalizeCommandHistories(raw);
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
    writeLocalJson("sshAgentCommandHistories", normalized);
  }
  return normalized;
}

function readLocalJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (error) {
    writeToolLogEvent({
      component: "frontend",
      action: "local_storage_read_failed",
      level: "warning",
      message: sanitizeFrontendRuntimeError(error),
      context: { key },
    });
    return fallback;
  }
}

function writeLocalJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    writeToolLogEvent({
      component: "frontend",
      action: "local_storage_write_failed",
      level: "warning",
      message: sanitizeFrontendRuntimeError(error),
      context: { key },
    });
  }
}

function pickTextFileFromBrowser() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ path: file.name, name: file.name, content: String(reader.result || "") });
      reader.onerror = () => resolve(null);
      reader.readAsText(file, "utf-8");
    };
    input.click();
  });
}

function saveTextFileFromBrowser(fileName, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return fileName;
}

function Sidebar({
  servers,
  selectedServer,
  selectedFile,
  sftpPreview,
  sftpPreviewDraft,
  sftpPath,
  sftpBookmarks,
  recentSftpOperation,
  onSelectServer,
  onOpenServerSession,
  onToggleServerFavorite,
  onVisibleServerNamesChange,
  onSelectFile,
  onOpenSftpFolder,
  onGoSftpParent,
  onAddSftpBookmark,
  onOpenSftpBookmark,
  onRemoveSftpBookmark,
  onOpenNewHost,
  onOpenAuthCenter,
  onRefreshSftp,
  onUploadSftp,
  onDownloadSftp,
  onPreviewSftpFile,
  onSftpPreviewDraftChange,
  onSaveSftpPreviewText,
  onCreateSftpFile,
  onCreateSftpDirectory,
  onRenameSftpItem,
  onDeleteSftpItem,
  isSftpBusy,
  onBatchTestConnections,
  isBatchTesting,
  onBatchReadBasicInfo,
  isBatchReading,
  onQueueBatchAgent,
  isBatchQueuing,
  onOpenEditHost,
  onOpenServerContextMenu,
  onOpenSftpContextMenu,
  onCopyRecentSftpOperation,
  onCancelSftpOperation,
  importFollowupPrompt,
  onClearImportFollowup,
  style,
  onSidebarSectionResize,
}) {
  const server = servers[selectedServer] || {};
  const serverSectionRef = useRef(null);
  const sftpSectionRef = useRef(null);
  const [serverSearch, setServerSearch] = useState("");
  const [serverStatusFilter, setServerStatusFilter] = useState("\u5168\u90e8");
  const [serverAuthFilter, setServerAuthFilter] = useState("\u5168\u90e8\u8ba4\u8bc1");
  const filteredServerGroups = useMemo(() => {
    const query = serverSearch.trim().toLowerCase();
    const grouped = new Map();
    Object.entries(servers).forEach(([name, item]) => {
      const state = item.state || "\u79bb\u7ebf";
      const hasCredential = Boolean(item.credentialRef || item.auth?.credentialRef || item.password || item.identityFile);
      const authLabel = hasCredential ? "\u5df2\u7ed1\u5b9a\u51ed\u636e" : "\u672a\u7ed1\u5b9a\u51ed\u636e";
      const haystack = [name, item.ip, item.user, item.group, ...(item.tags || [])].filter(Boolean).join(" ").toLowerCase();
      if (query && !haystack.includes(query)) return;
      if (serverStatusFilter !== "\u5168\u90e8" && state !== serverStatusFilter) return;
      if (serverAuthFilter !== "\u5168\u90e8\u8ba4\u8bc1" && authLabel !== serverAuthFilter) return;
      const groupName = item.group || "\u672a\u5206\u7ec4";
      if (!grouped.has(groupName)) grouped.set(groupName, []);
      grouped.get(groupName).push([name, item, authLabel]);
    });
    return Array.from(grouped.entries()).map(([group, groupServers]) => ({ group, servers: groupServers }));
  }, [servers, serverSearch, serverStatusFilter, serverAuthFilter]);
  const filteredServerNames = useMemo(() => filteredServerGroups.flatMap((group) => group.servers.map(([name]) => name)), [filteredServerGroups]);
  const followupReadyNames = useMemo(
    () => (importFollowupPrompt?.names || importFollowupPrompt?.importedNames || []).filter((name) => servers[name]),
    [importFollowupPrompt, servers],
  );

  useEffect(() => {
    onVisibleServerNamesChange(filteredServerNames);
  }, [filteredServerNames, onVisibleServerNamesChange]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !onSidebarSectionResize) return undefined;
    const observedSections = [
      ["server", serverSectionRef.current],
      ["sftp", sftpSectionRef.current],
    ].filter(([, element]) => element);
    const frameIds = new Map();
    const observers = observedSections.map(([section, element]) => {
      const observer = new ResizeObserver((entries) => {
        const height = entries[0]?.contentRect?.height;
        if (!height) return;
        if (frameIds.has(section)) cancelAnimationFrame(frameIds.get(section));
        const frameId = requestAnimationFrame(() => onSidebarSectionResize(section, height));
        frameIds.set(section, frameId);
      });
      observer.observe(element);
      return observer;
    });
    return () => {
      observers.forEach((observer) => observer.disconnect());
      frameIds.forEach((frameId) => cancelAnimationFrame(frameId));
    };
  }, [onSidebarSectionResize]);

  function handleSftpFileKeyDown(event, item) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    item.type === "folder" ? onOpenSftpFolder?.(item) : onPreviewSftpFile?.(item);
  }

  return (
    <aside className="sidebar" style={style}>
      <section className="panel sidebar-section server-section" ref={serverSectionRef}>
        <div className="section-title">
          <span>\u670d\u52a1\u5668</span>
          <button className="mini-action" type="button" aria-label="\u65b0\u5efa\u8fde\u63a5" title="\u65b0\u5efa\u8fde\u63a5" onClick={onOpenNewHost}>
            <Plus size={15} />
          </button>
        </div>
        <div className="server-filter-bar">
          <label className="server-search">
            <Search size={13} />
            <input value={serverSearch} onChange={(event) => setServerSearch(event.target.value)} placeholder="\u641c\u7d22\u670d\u52a1\u5668\u3001IP\u3001\u6807\u7b7e" />
          </label>
          <select className="server-status-filter" value={serverStatusFilter} onChange={(event) => setServerStatusFilter(event.target.value)}>
            {["\u5168\u90e8", "\u5728\u7ebf", "\u8b66\u544a", "\u79bb\u7ebf", "\u672a\u8fde\u63a5"].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
          <select className="server-auth-filter" value={serverAuthFilter} onChange={(event) => setServerAuthFilter(event.target.value)}>
            {["\u5168\u90e8\u8ba4\u8bc1", "\u5df2\u7ed1\u5b9a\u51ed\u636e", "\u672a\u7ed1\u5b9a\u51ed\u636e"].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </div>
        {importFollowupPrompt?.visible && (
          <div className="import-followup">
            <div className="import-followup-head">
              <strong>{importFollowupPrompt.title}</strong>
              <button type="button" onClick={onClearImportFollowup} aria-label="\u5173\u95ed\u63d0\u793a" title="\u5173\u95ed\u63d0\u793a">
                <X size={13} />
              </button>
            </div>
            <p>{importFollowupPrompt.message}</p>
            <div className="import-followup-actions">
              <button type="button" onClick={() => onBatchTestConnections(followupReadyNames)} disabled={isBatchTesting || followupReadyNames.length === 0}>{"测试连接"}</button>
              <button type="button" onClick={() => onBatchReadBasicInfo(followupReadyNames)} disabled={isBatchReading || followupReadyNames.length === 0}>{"读取基础信息"}</button>
              <button type="button" onClick={() => onQueueBatchAgent(followupReadyNames)} disabled={isBatchQueuing || followupReadyNames.length === 0}>{"交给 Agent 巡检"}</button>
              <button type="button" onClick={() => onOpenAuthCenter()}>{"补录凭据 / 认证中心"}</button>
            </div>
            {importFollowupPrompt.restoreSummary?.visible && (
              <div className="import-followup-summary">
                <strong>{importFollowupPrompt.restoreSummary.message}</strong>
                {importFollowupPrompt.restoreSummary.rows?.slice(0, 4).map((row) => (
                  <span key={row.name}>{row.name}：{row.status}</span>
                ))}
              </div>
            )}
          </div>
        )}
        {filteredServerGroups.length === 0 && <div className="empty-state compact">\u6ca1\u6709\u5339\u914d\u7684\u670d\u52a1\u5668</div>}
        {filteredServerGroups.map(({ group, servers: groupServers }) => (
          <div key={group}>
            <div className="group-title">
              <ChevronDown size={14} />
              {group}
              <small>{groupServers.length}</small>
            </div>
            <div className="server-list">
              {groupServers.map(([name, item, authLabel]) => (
                <div className={`server-row ${selectedServer === name ? "selected" : ""}`} key={name} onContextMenu={(event) => onOpenServerContextMenu(event, name)}>
                  <button className="server-row-main" type="button" onClick={() => onSelectServer(name)} onDoubleClick={() => onOpenServerSession(name)}>
                    <StatusDot tone={item.tone} />
                    <span className="server-main">
                      <strong>{name}</strong>
                      <small>{item.ip}</small>
                      {Array.isArray(item.tags) && item.tags.length > 0 && (
                        <span className="server-tags">
                          {item.tags.slice(0, 2).map((tag) => (
                            <em key={tag}>{tag}</em>
                          ))}
                        </span>
                      )}
                      <span className={`server-auth ${authLabel.includes("\u672a") ? "warning" : "ready"}`}>{authLabel}</span>
                    </span>
                    <span className={`server-state ${item.tone}`}>{item.state}</span>
                  </button>
                  <button className={`server-favorite ${item.isFavorite ? "active" : ""}`} type="button" aria-label={item.isFavorite ? `\u53d6\u6d88\u6536\u85cf ${name}` : `\u6536\u85cf ${name}`} title={item.isFavorite ? "\u53d6\u6d88\u6536\u85cf" : "\u6536\u85cf"} onClick={() => onToggleServerFavorite(name, !item.isFavorite)}>
                    <Star size={13} fill={item.isFavorite ? "currentColor" : "none"} />
                  </button>
                  <button
                    className="server-row-menu"
                    type="button"
                    aria-label={`${name} \u64cd\u4f5c`}
                    title="\u670d\u52a1\u5668\u64cd\u4f5c"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenServerContextMenu(event, name);
                    }}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="panel sidebar-section sftp-section" ref={sftpSectionRef} onContextMenu={(event) => onOpenSftpContextMenu(event, null)}>
        <div className="section-title">
          <span>SFTP \u6587\u4ef6</span>
          <div className="section-tools">
            <button className="mini-action" type="button" aria-label="\u5237\u65b0\u76ee\u5f55" title="\u5237\u65b0\u76ee\u5f55" onClick={onRefreshSftp} disabled={isSftpBusy}>
              <RefreshCw size={14} />
            </button>
            <button className="mini-action" type="button" aria-label="\u4e0a\u4f20\u6587\u4ef6" title="\u4e0a\u4f20\u6587\u4ef6" onClick={onUploadSftp} disabled={isSftpBusy}>
              <Upload size={14} />
            </button>
            <button className="mini-action" type="button" aria-label="\u65b0\u5efa\u6587\u4ef6" title="\u65b0\u5efa\u6587\u4ef6" onClick={onCreateSftpFile} disabled={isSftpBusy}>
              <FileText size={14} />
            </button>
            <button className="mini-action" type="button" aria-label="\u65b0\u5efa\u76ee\u5f55" title="\u65b0\u5efa\u76ee\u5f55" onClick={onCreateSftpDirectory} disabled={isSftpBusy}>
              <Plus size={14} />
            </button>
            <button className="mini-action" type="button" aria-label="\u4e0b\u8f7d\u6587\u4ef6\u6216\u76ee\u5f55" title="\u4e0b\u8f7d\u6587\u4ef6\u6216\u76ee\u5f55" onClick={onDownloadSftp} disabled={isSftpBusy || !selectedFile}>
              <Download size={14} />
            </button>
          </div>
        </div>
        <div className="sftp-path-row">
          <Folder size={13} />
          <span>{sftpPath}</span>
          <button type="button" aria-label="收藏当前目录" title="收藏当前目录" onClick={onAddSftpBookmark} disabled={isSftpBusy || !sftpPath}>
            <Star size={14} />
          </button>
          <button type="button" aria-label="\u8fd4\u56de\u4e0a\u7ea7" title="\u8fd4\u56de\u4e0a\u7ea7" onClick={onGoSftpParent} disabled={isSftpBusy || normalizeSftpPath(sftpPath) === "/"}>
            <ChevronUp size={14} />
          </button>
        </div>
        {Array.isArray(sftpBookmarks) && sftpBookmarks.length > 0 && (
          <div className="sftp-bookmarks">
            <div className="sftp-bookmarks-title">
              <span>常用目录</span>
              <small>{sftpBookmarks.length}</small>
            </div>
            <div className="sftp-bookmark-list">
              {sftpBookmarks.map((path) => (
                <div className="sftp-bookmark-row" key={path}>
                  <button type="button" title={path} onClick={() => onOpenSftpBookmark?.(path)} disabled={isSftpBusy}>
                    <Folder size={13} />
                    <span>{path}</span>
                  </button>
                  <button type="button" aria-label={`移除书签 ${path}`} title="移除书签" onClick={() => onRemoveSftpBookmark?.(path)} disabled={isSftpBusy}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {recentSftpOperation && (
          <div className={`sftp-operation-status ${recentSftpOperation.status}`}>
            <div className="sftp-operation-head">
              <span>\u6700\u8fd1\u64cd\u4f5c</span>
              <span className="sftp-operation-actions">
                {recentSftpOperation.status === "running" && recentSftpOperation.jobId && (
                  <button className="sftp-operation-cancel" type="button" aria-label="取消 SFTP 传输" title="取消传输" onClick={() => onCancelSftpOperation?.(recentSftpOperation)}>
                    取消传输
                  </button>
                )}
                <button className="sftp-operation-copy" type="button" aria-label="\u590d\u5236 SFTP \u64cd\u4f5c" title="\u590d\u5236\u64cd\u4f5c" onClick={() => onCopyRecentSftpOperation?.(recentSftpOperation)}>
                  \u590d\u5236
                </button>
              </span>
            </div>
            <strong>{recentSftpOperation.label}</strong>
            <small title={recentSftpOperation.remotePath || recentSftpOperation.localPath}>{recentSftpOperation.remotePath || recentSftpOperation.localPath}</small>
            <small>{recentSftpOperation.message}</small>
          </div>
        )}
        {selectedFile && (
          <div className="sftp-selection-actions">
            <span title={selectedFile.path || selectedFile.name}>{selectedFile.name}</span>
            <button type="button" aria-label="\u9884\u89c8\u6587\u4ef6" title="\u9884\u89c8\u6587\u4ef6" onClick={onPreviewSftpFile} disabled={isSftpBusy || selectedFile.type === "folder"}>
              <FileSearch size={14} />
            </button>
            <button type="button" aria-label="\u91cd\u547d\u540d" title="\u91cd\u547d\u540d" onClick={onRenameSftpItem} disabled={isSftpBusy}>
              <PencilLine size={14} />
            </button>
            <button type="button" aria-label="\u5220\u9664" title="\u5220\u9664" onClick={onDeleteSftpItem} disabled={isSftpBusy}>
              <Trash2 size={14} />
            </button>
          </div>
        )}
        {sftpPreview && (
          <div className="sftp-preview">
            <div className="sftp-preview-title">
              <FileText size={13} />
              <span>{formatSftpPreviewMeta(sftpPreview)}</span>
              <span className="sftp-preview-edit-state">\u53ef\u7f16\u8f91</span>
            </div>
            <textarea aria-label="\u7f16\u8f91 SFTP \u9884\u89c8\u5185\u5bb9" value={sftpPreviewDraft ?? sftpPreview.content ?? ""} onChange={(event) => onSftpPreviewDraftChange?.(event.target.value)} spellCheck={false} />
            <div className="sftp-preview-actions">
              <button type="button" onClick={onSaveSftpPreviewText} disabled={isSftpBusy}>
                \u4fdd\u5b58\u6587\u4ef6
              </button>
            </div>
            <pre>{sftpPreview.content || "\u6587\u4ef6\u65e0\u5185\u5bb9"}</pre>
          </div>
        )}
        {(server.files || []).map((item) => {
          const ItemIcon = item.type === "folder" ? Folder : FileText;
          return (
            <button className={`file-row ${selectedFile?.name === item.name ? "selected" : ""}`} type="button" key={item.name} onClick={() => (item.type === "folder" ? onOpenSftpFolder(item) : onSelectFile(item))} onDoubleClick={() => (item.type === "folder" ? onOpenSftpFolder(item) : onPreviewSftpFile(item))} onKeyDown={(event) => handleSftpFileKeyDown(event, item)} onContextMenu={(event) => onOpenSftpContextMenu(event, item)}>
              <ItemIcon size={15} />
              <span>
                <strong>{item.name}</strong>
                <small>{item.meta}</small>
              </span>
            </button>
          );
        })}
      </section>

      <div className="sidebar-footer">
        <span>
          <StatusDot tone={server.tone} />
          SSH {server.state || "\u672a\u8fde\u63a5"}
        </span>
        <IconButton label="\u7f16\u8f91\u670d\u52a1\u5668" onClick={onOpenEditHost}>
          <Settings size={17} />
        </IconButton>
      </div>
    </aside>
  );
}
function TerminalWorkspace({
  servers,
  selectedServer,
  selectedTerminalTabId,
  terminalTabs,
  terminalLines,
  modelConfig,
  terminalFontSize,
  terminalFocusMode,
  terminalSearchFocusRequest = { tick: 0, query: "" },
  terminalScrollLocked,
  onTerminalScrollLockChange = () => {},
  onToggleTerminalFocusMode,
  onOpenModelSettings,
  sessionState,
  sshSessions,
  commandValue,
  commandHistory,
  commandSnippets,
  onCommandChange,
  onCommandKeyDown,
  onUseSnippet,
  onCopySnippet,
  onSaveHistoryCommandSnippet,
  onRemoveHistoryCommand,
  onUseHistoryCommand,
  onSelectTerminalTab,
  onRenameTerminalTab,
  onCloseTerminalTab,
  onOpenTerminalTab,
  onCopyTerminal,
  onPasteTerminal,
  onExportTerminal,
  onCopySshCommand,
  onClearTerminal,
  onSaveSnippet,
  onRemoveSnippet,
  onOpenSession,
  onCloseSession,
  onCheckSessionHealth,
  onRunSessionRecoveryAction,
  onRunConnectionQuickFix,
  onOpenTerminalContextMenu,
  onOpenTerminalTabContextMenu,
  onTerminalShortcutKeyDown,
  onSendCommand,
  onSendInteractiveInput,
  onStopCommand,
  onFinishInteractiveMode,
  onResizeSession,
  onTerminalSizeChange,
  onTerminalZoom,
}) {
  const server = servers[selectedServer] || {};
  const isConnected = Boolean(sessionState?.sessionId);
  const isBusy = Boolean(sessionState?.busy);
  const isInteractive = isTerminalInteractiveMode(sessionState);
  const isRunningInteractiveCommand = isTerminalInteractiveMode(sessionState);
  const isSessionOpening = isBusy && !isConnected;
  const isDisconnectedRecoverable = !isConnected && Boolean(sessionState?.lastError || sessionState?.disconnectedAt);
  const terminalLinesRef = useRef(null);
  const commandInputRef = useRef(null);
  const terminalSearchInputRef = useRef(null);
  const historySearchInputRef = useRef(null);
  const lastPtySizeRef = useRef("");
  const [terminalSearchQuery, setTerminalSearchQuery] = useState("");
  const [terminalSearchCursor, setTerminalSearchCursor] = useState(0);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("");
  const [historySelectionIndex, setHistorySelectionIndex] = useState(0);
  const [commandKillBuffer, setCommandKillBuffer] = useState("");
  const terminalSearchState = useMemo(() => buildTerminalSearchState(terminalLines, terminalSearchQuery, terminalSearchCursor), [terminalLines, terminalSearchCursor, terminalSearchQuery]);
  const filteredCommandHistory = useMemo(() => filterCommandHistory(commandHistory || [], historyFilter, 12), [commandHistory, historyFilter]);
  const visibleSnippets = Array.isArray(commandSnippets) ? commandSnippets.slice(0, 8) : [];
  const sessionRecovery = getTerminalSessionRecovery(sessionState);
  const sessionRecoveryActions = buildTerminalSessionRecoveryActions(sessionState);
  const primaryRecoveryActions = sessionRecoveryActions.filter((action) => action.tone === "primary");
  const secondaryRecoveryActions = sessionRecoveryActions.filter((action) => action.tone !== "primary");
  const sessionDiagnosticBadge = getTerminalSessionDiagnosticBadge(sessionState);
  const terminalHealthText = buildTerminalHealthText(sessionState, server);
  const terminalConnectionQuickFixActions = buildConnectionQuickFixActions(server?.sshDiagnostics, server);
  const terminalCommandInputRows = Math.min(5, Math.max(1, String(commandValue || "").split("\n").length));

  useEffect(() => {
    const target = terminalLinesRef.current;
    if (!target) return;
    if (terminalSearchState.currentLineIndex >= 0) {
      const match = target.querySelector(`[data-terminal-line="${terminalSearchState.currentLineIndex}"]`);
      if (match) {
        match.scrollIntoView({ block: "center" });
        return;
      }
    }
    if (!terminalScrollLocked) target.scrollTop = target.scrollHeight;
  }, [selectedServer, terminalLines.length, terminalScrollLocked, terminalSearchState.currentLineIndex]);

  function focusTerminalCommandInput() {
    return window.requestAnimationFrame?.(() => commandInputRef.current?.focus?.());
  }

  useEffect(() => {
    const frameId = focusTerminalCommandInput();
    return () => {
      if (frameId) window.cancelAnimationFrame?.(frameId);
    };
  }, [selectedTerminalTabId, selectedServer]);

  useEffect(() => {
    setTerminalSearchCursor(0);
  }, [selectedServer, terminalSearchQuery]);

  useEffect(() => {
    if (!terminalSearchFocusRequest?.tick) return undefined;
    const requestedSearchQuery = String(terminalSearchFocusRequest?.query || "");
    setTerminalSearchQuery(requestedSearchQuery);
    setTerminalSearchCursor(0);
    const frameId = window.requestAnimationFrame?.(() => {
      terminalSearchInputRef.current?.focus?.();
      terminalSearchInputRef.current?.select?.();
    });
    return () => {
      if (frameId) window.cancelAnimationFrame?.(frameId);
    };
  }, [terminalSearchFocusRequest?.tick]);

  useEffect(() => {
    setHistorySelectionIndex(0);
  }, [selectedServer, historyFilter, historyPanelOpen]);

  useEffect(() => {
    const target = terminalLinesRef.current;
    if (!target || typeof ResizeObserver === "undefined") return undefined;
    lastPtySizeRef.current = "";
    let frameId = 0;
    function syncPtySize() {
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const styles = window.getComputedStyle(target);
        const fontSize = Number.parseFloat(styles.fontSize) || 14;
        const lineHeight = Number.parseFloat(styles.lineHeight) || fontSize * 1.45;
        const charWidth = Math.max(fontSize * 0.62, 8);
        const cols = Math.min(Math.max(Math.floor(target.clientWidth / charWidth), 40), 500);
        const rows = Math.min(Math.max(Math.floor(target.clientHeight / lineHeight), 10), 200);
        const nextSize = `${cols}x${rows}`;
        if (lastPtySizeRef.current === nextSize) return;
        lastPtySizeRef.current = nextSize;
        onTerminalSizeChange?.(selectedTerminalTabId, cols, rows);
        if (isConnected && sessionState?.sessionId) onResizeSession?.(cols, rows);
      });
    }
    const observer = new ResizeObserver(syncPtySize);
    observer.observe(target);
    syncPtySize();
    return () => {
      observer.disconnect();
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, [isConnected, onResizeSession, onTerminalSizeChange, selectedTerminalTabId, sessionState?.sessionId, terminalFontSize]);

  function handleOutputScroll() {
    const target = terminalLinesRef.current;
    if (!target) return;
    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight <= 12;
    onTerminalScrollLockChange(!isAtBottom);
  }

  function handleTerminalOutputWheel(event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    onTerminalZoom?.(event.deltaY < 0 ? "zoom-in" : "zoom-out");
  }

  function jumpSearch(delta) {
    if (terminalSearchState.total === 0) return;
    setTerminalSearchCursor((current) => current + delta);
  }

  function isTerminalInputEventTarget(event) {
    const tagName = String(event?.target?.tagName || "").toLowerCase();
    return ["input", "textarea", "select", "button"].includes(tagName) || Boolean(event?.target?.isContentEditable);
  }

  function focusTerminalSearchShortcut(event) {
    const action = getTerminalShortcutAction(event, commandValue || "");
    if (action !== "focus-search") return false;
    event.preventDefault();
    terminalSearchInputRef.current?.focus();
    terminalSearchInputRef.current?.select?.();
    return true;
  }

  function pasteTerminalShortcut(event) {
    const action = getTerminalShortcutAction(event, commandValue || "");
    if (action !== "paste-command") return false;
    const handled = Boolean(onTerminalShortcutKeyDown?.(event));
    if (!handled) return false;
    window.requestAnimationFrame?.(() => commandInputRef.current?.focus?.());
    return true;
  }

  function toggleFocusModeShortcut(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.key !== "Enter") return false;
    event.preventDefault();
    event.stopPropagation?.();
    onToggleTerminalFocusMode?.();
    return true;
  }

  function focusCommandHistorySearchShortcut(event) {
    if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || String(event.key || "").toLowerCase() !== "r") return false;
    event.preventDefault();
    setHistoryPanelOpen(true);
    window.requestAnimationFrame(() => {
      historySearchInputRef.current?.focus();
      historySearchInputRef.current?.select?.();
    });
    return true;
  }

  function sendConnectedShellSurfaceDirectControlInput(event) {
    const controlInput = isConnectedShellDirectControlKey(event) ? buildRunningSessionControlInput(event, "") : null;
    const connectedShellControlInput = controlInput?.action === "interrupt" ? { text: "\x03", submit: false } : controlInput;
    if (!isConnected || isRunningInteractiveCommand || !connectedShellControlInput) return false;
    event.preventDefault();
    onSendInteractiveInput(event, { ...connectedShellControlInput, clearInput: connectedShellControlInput.text === "\x03" });
    return true;
  }

  function focusCommandInputFromTerminalSurface(event) {
    if (event.button !== 0) return;
    if (isTerminalInputEventTarget(event)) return;
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed && String(selection.toString?.() || "").trim()) return;
    window.requestAnimationFrame?.(() => commandInputRef.current?.focus?.());
  }

  function sendConnectedShellSurfaceInput(event) {
    const connectedShellInput = buildConnectedShellInput(event, commandValue || "", { connected: isConnected, interactive: isRunningInteractiveCommand, allowScrollKeys: false });
    if (!connectedShellInput) return false;
    event.preventDefault();
    onSendInteractiveInput(event, { ...connectedShellInput, clearInput: false });
    return true;
  }

  function scrollTerminalOutputByKey(event) {
    const action = getTerminalScrollKeyAction(event);
    if (!action || !terminalLinesRef.current) return false;
    event.preventDefault();
    onTerminalScrollLockChange(true);
    if (action === "page-up") terminalLinesRef.current.scrollTop -= terminalLinesRef.current.clientHeight * 0.85;
    if (action === "page-down") terminalLinesRef.current.scrollTop += terminalLinesRef.current.clientHeight * 0.85;
    if (action === "top") terminalLinesRef.current.scrollTop = 0;
    if (action === "bottom") {
      terminalLinesRef.current.scrollTop = terminalLinesRef.current.scrollHeight;
      onTerminalScrollLockChange(false);
    }
    return true;
  }

  function draftTerminalSurfaceInput(event) {
    if (isTerminalInputEventTarget(event)) return false;
    if (isRunningInteractiveCommand) {
      onCommandKeyDown(event);
      return true;
    }
    const key = String(event.key || "");
    if (key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      onCommandChange(`${commandValue}${key}`);
      commandInputRef.current?.focus();
      return true;
    }
    if (key === "Backspace") {
      event.preventDefault();
      onCommandChange(commandValue.slice(0, -1));
      commandInputRef.current?.focus();
      return true;
    }
    return false;
  }

  function handleCommandInputKeyDown(event) {
    if (event.isComposing || event.nativeEvent?.isComposing) return;
    if (isRunningInteractiveCommand) {
      onCommandKeyDown(event);
      return;
    }
    if (focusTerminalSearchShortcut(event)) return;
    if (pasteTerminalShortcut(event)) return;
    if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      if (isConnected && !isRunningInteractiveCommand) {
        onSendInteractiveInput?.(event, { text: "\x03", submit: false, clearInput: true });
        return;
      }
      onCommandChange?.("");
      onStopCommand?.(selectedServer);
      return;
    }
    if (insertCommandInputNewline(event)) return;
    const connectedShellInput = buildConnectedShellInput(event, commandValue || "", { connected: isConnected, interactive: isRunningInteractiveCommand, allowScrollKeys: false, forwardReviewKeys: true });
    if (connectedShellInput) {
      event.preventDefault();
      onSendInteractiveInput(event, { ...connectedShellInput, clearInput: false });
      return;
    }
    if (applyCommandEditShortcut(event)) return;
    if (focusCommandHistorySearchShortcut(event)) return;
    if (onTerminalShortcutKeyDown?.(event)) return;
    if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "l") {
      event.preventDefault();
      onClearTerminal?.();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (isInteractive) {
        onSendInteractiveInput?.(event);
      } else {
        onSendCommand?.(event);
      }
      return;
    }
    onCommandKeyDown?.(event);
  }

  function insertCommandInputNewline(event) {
    if (event.key !== "Enter" || !(event.shiftKey || event.altKey) || event.ctrlKey || event.metaKey) return false;
    event.preventDefault();
    const target = event?.currentTarget || commandInputRef.current;
    const text = String(commandValue || "");
    const selectionStart = Math.max(0, Math.min(target?.selectionStart ?? text.length, text.length));
    const selectionEnd = Math.max(0, Math.min(target?.selectionEnd ?? selectionStart, text.length));
    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);
    const nextValue = `${text.slice(0, start)}\n${text.slice(end)}`;
    const cursor = start + 1;
    onCommandChange?.(nextValue);
    window.requestAnimationFrame?.(() => {
      commandInputRef.current?.focus?.();
      commandInputRef.current?.setSelectionRange?.(cursor, cursor);
    });
    return true;
  }

  function applyCommandEditShortcut(event) {
    const target = event?.currentTarget || commandInputRef.current;
    const edit = applyTerminalCommandEditKey(
      event,
      commandValue,
      target?.selectionStart ?? String(commandValue || "").length,
      target?.selectionEnd ?? String(commandValue || "").length,
      { trackKillBuffer: true, killBuffer: commandKillBuffer },
    );
    if (!edit.handled) return false;
    event.preventDefault();
    onCommandChange(edit.value);
    if (Object.prototype.hasOwnProperty.call(edit, "killBuffer")) setCommandKillBuffer(edit.killBuffer);
    window.requestAnimationFrame?.(() => {
      commandInputRef.current?.focus?.();
      commandInputRef.current?.setSelectionRange?.(edit.selectionStart, edit.selectionEnd);
    });
    return true;
  }

  function handleTerminalCtrlCButtonClick(event) {
    event?.preventDefault?.();
    if (isConnected && !isRunningInteractiveCommand) {
      onSendInteractiveInput?.(event, { text: "\x03", submit: false, clearInput: true });
      return;
    }
    onCommandChange?.("");
    onStopCommand?.(selectedServer);
  }

  function handleTerminalControlButtonClick(control, event) {
    event?.preventDefault?.();
    if (!control?.text || !isConnected) return;
    onSendInteractiveInput?.(event, {
      text: control.text,
      submit: false,
      clearInput: false,
      finishInteractiveMode: control.finishInteractiveMode,
    });
  }

  function handleCommandHistorySearchKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!filteredCommandHistory.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHistorySelectionIndex((current) => (current + step + filteredCommandHistory.length) % filteredCommandHistory.length);
      return;
    }
    if (event.key === "Enter") {
      if (!filteredCommandHistory[historySelectionIndex] && !filteredCommandHistory[0]) return;
      event.preventDefault();
      handleHistoryUse(filteredCommandHistory[historySelectionIndex] || filteredCommandHistory[0]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setHistoryPanelOpen(false);
      setHistoryFilter("");
      commandInputRef.current?.focus();
    }
  }

  function handleTerminalSearchKeyDown(event) {
    const action = getTerminalSearchKeyAction(event);
    if (!action) return;
    event.preventDefault();
    if (action === "next-match") jumpTerminalSearch(1);
    if (action === "previous-match") jumpTerminalSearch(-1);
    if (action === "blur-search") {
      terminalSearchInputRef.current?.blur();
      setTerminalSearchQuery("");
      commandInputRef.current?.focus();
    }
  }

  function jumpTerminalSearch(delta) {
    jumpSearch(delta);
  }

  function handleTerminalShellKeyDown(event) {
    if (isRunningInteractiveCommand) {
      onCommandKeyDown(event);
      return;
    }
    if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      if (isConnected && !isRunningInteractiveCommand) {
        onSendInteractiveInput?.(event, { text: "\x03", submit: false, clearInput: true });
        return;
      }
      onCommandChange?.("");
      onStopCommand?.(selectedServer);
      return;
    }
    if (pasteTerminalShortcut(event)) return;
    if (focusTerminalSearchShortcut(event)) return;
    if (scrollTerminalOutputByKey(event)) return;
    if (toggleFocusModeShortcut(event)) return;
    if (sendConnectedShellSurfaceDirectControlInput(event)) return;
    if (sendConnectedShellSurfaceInput(event)) return;
    if (onTerminalShortcutKeyDown(event)) return;
    if (draftTerminalSurfaceInput(event)) return;
  }

  function handleHistoryUse(item) {
    const command = typeof item === "string" ? item : item.command;
    if (!command) return;
    onUseHistoryCommand?.(item);
    onCommandChange?.(command);
    commandInputRef.current?.focus();
  }

  return (
    <section className={`workspace-panel ${terminalFocusMode ? "focus-mode" : ""}`}>
      <div className="terminal-tabs">
        {(terminalTabs || []).map((tab) => {
          const name = tab.serverName || tab;
          const tabId = tab.id || name;
          const tabTitle = tab.title || name;
          const tabSession = sshSessions?.[tabId] || sshSessions?.[name] || {};
          const tabConnected = Boolean(tabSession.sessionId);
          const tabBusy = Boolean(tabSession.busy);
          const tabTone = tabConnected ? "green" : tabBusy ? "amber" : servers[name]?.tone || "gray";
          const tabLabel = tabConnected ? "\u5df2\u8fde\u63a5" : tabBusy ? "\u8fde\u63a5\u4e2d" : "\u672a\u8fde\u63a5";
          return (
            <div className={`terminal-tab ${selectedTerminalTabId === tabId ? "active" : ""}`} key={tabId} onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onCloseTerminalTab?.(tabId); } }} onContextMenu={(event) => onOpenTerminalTabContextMenu?.(event, tabId)}>
              <button className="terminal-tab-main" type="button" onClick={() => onSelectTerminalTab?.(tabId)} onDoubleClick={() => onRenameTerminalTab?.(tabId)} title={`${tabTitle} - ${tabLabel}`}>
                <StatusDot tone={tabTone} />
                {tab.pinned ? <Pin className="terminal-tab-pin" size={12} /> : null}
                <span className="terminal-tab-name">{tabTitle}</span>
                <span className={`terminal-tab-state ${tabTone}`}>{tabLabel}</span>
              </button>
              <button className="terminal-tab-close" type="button" onClick={() => onCloseTerminalTab?.(tabId)} aria-label={`\u5173\u95ed ${tabTitle}`} title={tab.pinned ? "\u5df2\u56fa\u5b9a\u7684\u6807\u7b7e\u9700\u5148\u53d6\u6d88\u56fa\u5b9a" : "\u5173\u95ed\u6807\u7b7e"} disabled={Boolean(tab.pinned)}>
                <X size={14} />
              </button>
            </div>
          );
        })}
        <button className="tab-add" type="button" aria-label="\u65b0\u5efa\u7ec8\u7aef\u6807\u7b7e" title="\u65b0\u5efa\u7ec8\u7aef\u6807\u7b7e" onClick={onOpenTerminalTab}>
          <Plus size={18} />
        </button>
      </div>

      <div className="context-strip">
        <span><Folder size={15} />{server.cwd || "/"}</span>
        <button type="button" className="pill-button" onClick={() => onOpenSession?.(selectedServer)} disabled={isSessionOpening || isConnected}>
          <TerminalSquare size={14} />
          {isBusy && !isConnected ? "\u8fde\u63a5\u4e2d" : isDisconnectedRecoverable ? "重连会话" : "\u8fde\u63a5\u4f1a\u8bdd"}
        </button>
        <button type="button" className="pill-button" onClick={() => onCloseSession?.(selectedServer)} disabled={!isConnected}>
          <X size={14} />\u65ad\u5f00
        </button>
        <button type="button" className="pill-button" onClick={handleTerminalCtrlCButtonClick} disabled={!isConnected}>
          <Square size={14} />Ctrl+C
        </button>
        <span className="terminal-health-group">
          <span className="terminal-health-pill" title={sessionState?.healthMessage || terminalHealthText}>
            {terminalHealthText}
          </span>
          <button
            type="button"
            className="terminal-health-check-button"
            aria-label="立即检查 SSH 会话状态"
            title="立即检查 SSH 会话状态"
            onClick={onCheckSessionHealth}
            disabled={!isConnected || Boolean(sessionState?.healthChecking)}
          >
            <RefreshCw size={13} />
          </button>
        </span>
        {sessionDiagnosticBadge?.visible && (
          <button
            type="button"
            className={`terminal-diagnostic-badge ${sessionDiagnosticBadge.tone || "gray"}`}
            title={sessionDiagnosticBadge.title}
            aria-label="查看 SSH 会话诊断日志"
            onClick={() => onRunSessionRecoveryAction?.({ id: "diagnostic-session-logs", target: "session-logs", label: "查看会话日志" })}
          >
            {sessionDiagnosticBadge.label}
          </button>
        )}
        <label className="terminal-search">
          <Search size={14} />
          <input ref={terminalSearchInputRef} value={terminalSearchQuery} onChange={(event) => setTerminalSearchQuery(event.target.value)} onKeyDown={handleTerminalSearchKeyDown} placeholder="\u641c\u7d22\u8f93\u51fa" />
        </label>
        <span className="terminal-search-count">{terminalSearchState.total ? `${terminalSearchState.index + 1}/${terminalSearchState.total}` : "0/0"}</span>
        <button type="button" className="icon-button" aria-label="\u4e0a\u4e00\u4e2a\u5339\u914d" title="\u4e0a\u4e00\u4e2a\u5339\u914d" onClick={() => jumpSearch(-1)}><ChevronUp size={15} /></button>
        <button type="button" className="icon-button" aria-label="\u4e0b\u4e00\u4e2a\u5339\u914d" title="\u4e0b\u4e00\u4e2a\u5339\u914d" onClick={() => jumpSearch(1)}><ChevronDown size={15} /></button>
        <button type="button" className="icon-button" aria-label="复制选中/输出" title="复制选中/输出 Ctrl+Shift+C / Ctrl+Insert" onClick={onCopyTerminal}><Copy size={15} /></button>
        <button type="button" className="icon-button" aria-label="粘贴到终端" title="粘贴 Ctrl+V / Ctrl+Shift+V / Shift+Insert" onClick={onPasteTerminal}><ClipboardList size={15} /></button>
        <button type="button" className="icon-button" aria-label="导出终端记录" title="导出终端记录 Ctrl+Shift+S" onClick={onExportTerminal}><Download size={15} /></button>
        <button type="button" className="icon-button" aria-label="复制 SSH 命令" title="复制 SSH 命令 Ctrl+Shift+Y" onClick={() => onCopySshCommand?.(selectedServer)}><TerminalSquare size={15} /></button>
        <button type="button" className="icon-button" aria-label="清空终端显示" title="清空终端显示 Ctrl+Shift+L" onClick={() => onClearTerminal?.(selectedServer)}><Trash2 size={15} /></button>
        <button type="button" className="icon-button" aria-label="\u4e13\u6ce8\u6a21\u5f0f" title="\u4e13\u6ce8\u6a21\u5f0f F11 / Alt+Enter" onClick={onToggleTerminalFocusMode}><Maximize2 size={15} /></button>
        <button type="button" className="model-pill" onClick={onOpenModelSettings}>
          <Cloud size={14} />{modelConfig?.provider || "Model"}
        </button>
      </div>

      {terminalConnectionQuickFixActions.length > 0 && (
        <div className="terminal-connection-repair">
          {terminalConnectionQuickFixActions.map((action) => (
            <button type="button" key={action.id || action.target || action.label} onClick={() => onRunConnectionQuickFix(action)}>
              {action.label}
            </button>
          ))}
        </div>
      )}

      <div className="terminal-shell" onContextMenu={onOpenTerminalContextMenu} onKeyDown={handleTerminalShellKeyDown} onMouseUp={focusCommandInputFromTerminalSurface} tabIndex={0}>
        {sessionRecovery?.visible && (
          <div className={`terminal-recovery-card ${sessionRecovery.tone || "gray"}`}>
            <div>
              <strong>{sessionRecovery.title || "\u7ec8\u7aef\u4f1a\u8bdd\u9700\u8981\u5904\u7406"}</strong>
              <pre className="terminal-recovery-detail">{sessionRecovery.detail || "可以使用下方操作恢复当前 SSH 会话。"}</pre>
              {sessionRecovery.suggestions?.length ? (
                <ul className="terminal-recovery-suggestions">
                  {sessionRecovery.suggestions.map((suggestion, index) => (
                    <li key={`${index}-${suggestion}`}>{suggestion}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="terminal-recovery-actions">
              <div className="terminal-recovery-primary-actions">
                {primaryRecoveryActions.map((action) => (
                  <button
                    type="button"
                    className={`recovery-action ${action.tone || "primary"}`}
                    key={action.id || action.target || action.type || action.label}
                    onClick={() => onRunSessionRecoveryAction(action)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
              {secondaryRecoveryActions.length ? (
                <div className="terminal-recovery-secondary">
                  <span>更多处理</span>
                  <div>
                    {secondaryRecoveryActions.map((action) => (
                      <button
                        type="button"
                        className={`recovery-action ${action.tone || "secondary"}`}
                        key={action.id || action.target || action.type || action.label}
                        onClick={() => onRunSessionRecoveryAction(action)}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
        <div className="terminal-output" ref={terminalLinesRef} onScroll={handleOutputScroll} onWheel={handleTerminalOutputWheel} style={{ fontSize: `${terminalFontSize || 14}px` }}>
          {(terminalLines || []).length > 0 ? terminalLines.map((line, index) => (
            <TerminalLine key={`${selectedTerminalTabId}-${index}`} line={line} index={index} searchQuery={terminalSearchQuery} />
          )) : (
            <pre className="terminal-empty">\u8fde\u63a5 SSH \u4f1a\u8bdd\u540e\u5373\u53ef\u50cf\u5e38\u89c4\u7ec8\u7aef\u4e00\u6837\u8f93\u5165\u547d\u4ee4\uff0cEnter \u76f4\u63a5\u53d1\u9001\uff0cCtrl+C \u4e2d\u65ad\u3002</pre>
          )}
        </div>

        <form className="terminal-command-bar" onSubmit={(event) => { event.preventDefault(); isInteractive ? onSendInteractiveInput?.(event) : onSendCommand?.(event); }}>
          <button className="command-icon" type="button" onClick={() => onOpenSession?.(selectedServer)} disabled={isConnected || isBusy} title="\u8fde\u63a5 SSH">
            <TerminalSquare size={16} />
          </button>
          <textarea
            ref={commandInputRef}
            value={commandValue || ""}
            onChange={(event) => onCommandChange?.(event.target.value)}
            onKeyDown={handleCommandInputKeyDown}
            rows={terminalCommandInputRows}
            spellCheck={false}
            placeholder={isConnected ? "输入 SSH 命令，Enter 发送" : "输入 SSH 命令，Enter 自动连接并发送"}
          />
          <button className="command-history-toggle" type="button" onClick={() => setHistoryPanelOpen((value) => !value)} title="命令历史 Ctrl+R">
            <History size={16} />
          </button>
          <button className="send-command" type="submit" disabled={isSessionOpening}>
            <Send size={18} />
          </button>
        </form>
        {isConnected && (
          <div className="terminal-interactive-controls" aria-label="SSH 控制键">
            {TERMINAL_INTERACTIVE_CONTROL_BUTTONS.map((control) => (
              <button
                type="button"
                className="terminal-interactive-control-button"
                key={control.label}
                title={control.title}
                disabled={!isConnected}
                onClick={(event) => handleTerminalControlButtonClick(control, event)}
              >
                {control.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {(visibleSnippets.length > 0 || historyPanelOpen) && (
        <div className="terminal-helper-panel">
          {visibleSnippets.length > 0 && (
            <div className="terminal-snippets">
              {visibleSnippets.map((item) => (
                <span className={`terminal-snippet-item ${item.custom ? "custom" : ""}`} key={item.id || item.command || item.label}>
                  <button type="button" className="terminal-snippet-command" onClick={() => onUseSnippet?.(item)} title={item.command}>
                    {item.label || item.command}
                  </button>
                  <button type="button" className="terminal-snippet-copy" onClick={() => onCopySnippet?.(item.command)} aria-label={`复制命令片段 ${item.label || item.command}`} title="复制命令片段">
                    <Copy size={12} />
                  </button>
                  {item.custom && (
                    <button type="button" className="terminal-snippet-remove" onClick={() => onRemoveSnippet?.(item.command)} aria-label={`删除命令片段 ${item.label || item.command}`} title="删除命令片段">
                      <X size={12} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {historyPanelOpen && (
            <div className="terminal-history-panel">
              <input ref={historySearchInputRef} value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)} onKeyDown={handleCommandHistorySearchKeyDown} placeholder="\u641c\u7d22\u547d\u4ee4\u5386\u53f2" />
              <div>
                {filteredCommandHistory.length === 0 && <span className="terminal-history-empty">没有匹配的历史命令</span>}
                {filteredCommandHistory.map((item, index) => {
                  const command = typeof item === "string" ? item : item.command;
                  return (
                    <span className="terminal-history-row" key={`${command}-${index}`}>
                      <button type="button" className={`terminal-history-item history-command ${index === historySelectionIndex ? "active" : ""}`} onClick={() => handleHistoryUse(item)}>
                        {command}
                      </button>
                      <button type="button" className="terminal-history-save" onClick={() => onSaveHistoryCommandSnippet?.(command)} aria-label={`保存历史命令为片段 ${command}`} title="保存为命令片段">
                        <Star size={12} />
                      </button>
                      <button type="button" className="terminal-history-remove" onClick={() => onRemoveHistoryCommand?.(command)} aria-label={`删除历史命令 ${command}`} title="删除历史命令">
                        <X size={12} />
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function LegacyAgentPanel(props) {
  return <AgentPanel {...props} />;
}

function AgentPanel({
  servers,
  selectedServer,
  selectedFile,
  sftpPreview,
  terminalLines,
  modelConfig,
  agentDraftRequest,
  agentTaskNotice,
  capabilities,
  taskQueue,
  onTaskQueueChange,
  onApproveTask,
  onCancelTask,
  runningAgentTasks,
  onCancelRunningTask,
  onOpenModelSettings,
  onOpenReleaseInfo,
  onTrustHostKey,
  onRevokeHostKeyTrust,
  onNotice,
}) {
  const server = servers[selectedServer] || {};
  const [message, setMessage] = useState("");
  const [agentThinking, setAgentThinking] = useState(false);
  const [conversation, setConversation] = useState([]);
  const [agentAttachments, setAgentAttachments] = useState([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const agentInputRef = useRef(null);
  const agentConversationRef = useRef(null);
  const agentFileInputRef = useRef(null);
  const agentRequestRef = useRef(0);
  const attachmentSequenceRef = useRef(0);
  const processedAgentTaskNoticeRef = useRef("");
  const api = safeFileApi();
  const pendingTasks = getPendingAgentTasks(taskQueue || []);
  const runningTasks = Object.values(runningAgentTasks || {});
  const firstPendingTask = pendingTasks[0];
  const firstRunningTask = runningTasks[0];
  const agentReadiness = getAgentReadiness({
    modelConfig,
    selectedServer,
    server,
    hasModelApi: Boolean(api?.chat_with_model),
  });

  function buildAgentWelcomeMessage(serverName) {
    return {
      role: "agent",
      text: `\u5df2\u8fde\u63a5\u5230 ${serverName} \u7684\u4e0a\u4e0b\u6587\u3002\u4f60\u53ef\u4ee5\u76f4\u63a5\u63cf\u8ff0\u95ee\u9898\uff0c\u6211\u4f1a\u7ed3\u5408\u5f53\u524d SSH \u8f93\u51fa\u3001SFTP \u9884\u89c8\u548c\u5df2\u63a5\u5165\u7684 Skill / MCP / CLI \u80fd\u529b\u7ed9\u51fa\u5efa\u8bae\u3002`,
    };
  }

  useEffect(() => {
    setConversation([buildAgentWelcomeMessage(selectedServer)]);
    setMessage("");
    setAgentAttachments([]);
  }, [selectedServer]);

  useEffect(() => {
    if (!agentDraftRequest?.text) return;
    const draftText = agentDraftRequest.text || "";
    setMessage((current) => (current.trim() ? `${current.trimEnd()}\n\n---\n\n${draftText}` : draftText));
    window.requestAnimationFrame(() => agentInputRef.current?.focus());
  }, [agentDraftRequest]);

  useEffect(() => {
    if (!agentTaskNotice?.id || processedAgentTaskNoticeRef.current === agentTaskNotice.id) return;
    if (agentTaskNotice.targetServer && agentTaskNotice.targetServer !== selectedServer) return;
    processedAgentTaskNoticeRef.current = agentTaskNotice.id;
    setConversation((current) => [...current, { role: "agent", text: agentTaskNotice.text }]);
  }, [agentTaskNotice, selectedServer]);

  useEffect(() => {
    const target = agentConversationRef.current;
    if (!target) return;
    target.scrollTop = target.scrollHeight;
  }, [conversation, agentThinking]);

  function focusAgentInput() {
    window.requestAnimationFrame(() => agentInputRef.current?.focus());
  }

  function openAgentReadinessAction() {
    if (agentReadiness.ready) return;
    onOpenModelSettings?.();
  }

  function nextAgentAttachmentId(type) {
    attachmentSequenceRef.current += 1;
    return `${type}-${Date.now()}-${attachmentSequenceRef.current}`;
  }

  function addPrompt(prompt) {
    const promptText = typeof prompt === "string" ? prompt : prompt?.text || "";
    if (!promptText.trim()) return;
    setMessage((current) => (current.trim() ? `${current.trimEnd()}\n${promptText}` : promptText));
    focusAgentInput();
  }

  function addContextAttachment(type, name, content) {
    const textContent = String(content || "").trim();
    if (!textContent) {
      onNotice?.("\u5f53\u524d\u6ca1\u6709\u53ef\u5f15\u7528\u7684\u5185\u5bb9");
      return;
    }
    setAgentAttachments((current) => [...current, { id: nextAgentAttachmentId(type), type, name, content: textContent.slice(0, 20000) }]);
    focusAgentInput();
  }

  function attachTerminalOutput() {
    const terminalText = (terminalLines || []).slice(-120).join("\n");
    addContextAttachment("terminal", "\u5f53\u524d SSH \u8f93\u51fa", terminalText);
  }

  function attachSftpPreview() {
    addContextAttachment("sftp", sftpPreview?.name || selectedFile?.name || "SFTP", sftpPreview?.content || "");
  }

  function openAttachmentPicker() {
    agentFileInputRef.current?.click();
  }

  function handleAttachmentFileChange(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    files.forEach((file) => {
      if (file.size > MAX_AGENT_ATTACHMENT_BYTES) {
        onNotice?.(`附件过大：${file.name}，请控制在 1MB 以内后再上传。`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        addContextAttachment("file", file.name, String(reader.result || ""));
      };
      reader.onerror = () => onNotice?.(`\u9644\u4ef6\u8bfb\u53d6\u5931\u8d25\uff1a${file.name}`);
      reader.readAsText(file, "utf-8");
    });
  }

  function removeAttachment(id) {
    setAgentAttachments((current) => current.filter((item) => item.id !== id));
  }

  function buildSentAttachmentSummary(attachments = []) {
    const names = (Array.isArray(attachments) ? attachments : [])
      .map((item) => String(item?.name || item?.type || "").trim())
      .filter(Boolean);
    if (!names.length) return "";
    const visibleNames = names.slice(0, 4).join("、");
    const hiddenCount = Math.max(0, names.length - 4);
    return `已附加上下文：${visibleNames}${hiddenCount ? `，另有 ${hiddenCount} 项` : ""}`;
  }

  function queueSuggestedAgentActions(reply = "") {
    const suggestions = parseAgentActionSuggestions(reply);
    if (!suggestions.length || !selectedServer) return;
    const tasks = suggestions
      .map((suggestion) => {
        try {
          return buildAgentTask(suggestion, {
            serverName: selectedServer,
            fileName: selectedFile?.name || "",
          });
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (!tasks.length) return;
    onTaskQueueChange?.((current) => tasks.reduce((queue, task) => queueAgentTask(queue, task), current || taskQueue || []));
    onNotice?.(`Agent 已加入 ${tasks.length} 个待审批动作。`);
  }

  function buildAgentFailureDiagnosticText(errorText = "", options = {}) {
    const safeModel = {
      provider: String(modelConfig?.provider || "").trim() || "--",
      model: String(modelConfig?.model || "").trim() || "--",
      baseUrl: String(modelConfig?.baseUrl || "").trim() || "--",
      hasApiKey: Boolean(modelConfig?.hasApiKey || modelConfig?.apiKeyRef),
    };
    const detail = String(errorText || "\u672a\u77e5\u9519\u8bef").trim() || "\u672a\u77e5\u9519\u8bef";
    return [
      "Agent \u6392\u969c\u4fe1\u606f",
      `\u65f6\u95f4\uff1a${new Date().toLocaleString("zh-CN")}`,
      `\u670d\u52a1\u5668\uff1a${selectedServer || "--"}`,
      `\u6a21\u578b\u4f9b\u5e94\u5546\uff1a${safeModel.provider}`,
      `\u6a21\u578b\uff1a${safeModel.model}`,
      `Base URL\uff1a${safeModel.baseUrl}`,
      `API Key\uff1a${safeModel.hasApiKey ? "\u5df2\u914d\u7f6e" : "\u672a\u914d\u7f6e"}`,
      `\u684c\u9762 API\uff1a${api?.chat_with_model ? "\u53ef\u7528" : "\u4e0d\u53ef\u7528"}`,
      `\u9519\u8bef\uff1a${detail}`,
      options?.hint ? `\u5efa\u8bae\uff1a${options.hint}` : "",
    ].filter(Boolean).join("\n");
  }

  function buildAgentFailureMessage(errorText = "", options = {}) {
    const detail = String(errorText || "\u6a21\u578b API \u8c03\u7528\u5931\u8d25").trim() || "\u6a21\u578b API \u8c03\u7528\u5931\u8d25";
    const prefix = options?.prefix || "Agent \u8c03\u7528\u5931\u8d25";
    return {
      role: "agent",
      text: `${prefix}\uff1a${detail}`,
      diagnosticText: buildAgentFailureDiagnosticText(detail, options),
    };
  }

  async function sendMessage(event) {
    event.preventDefault();
    const rawText = message.trim();
    const text = expandAgentSlashCommand(rawText);
    if (!rawText || agentThinking) return;
    const sentAttachmentSummary = agentReadiness.ready ? buildSentAttachmentSummary(agentAttachments) : "";
    const nextConversation = [...conversation, { role: "user", text, attachmentSummary: sentAttachmentSummary }];
    setConversation(nextConversation);
    setMessage("");

    if (!agentReadiness.ready) {
      setConversation((current) => [...current, { role: "agent", text: agentReadiness.message }]);
      onNotice?.(agentReadiness.message);
      focusAgentInput();
      return;
    }

    setAgentThinking(true);
    const requestId = agentRequestRef.current + 1;
    agentRequestRef.current = requestId;
    try {
      let requestAttachments = agentAttachments;
      let requestWebSearchEnabled = webSearchEnabled;
      setAgentAttachments([]);
      if (webSearchEnabled && !api?.search_web) {
        requestWebSearchEnabled = false;
        setConversation((current) => [...current, { role: "agent", text: buildAgentSearchStatusMessage({ ok: false, message: "\u5f53\u524d\u8fd0\u884c\u73af\u5883\u6ca1\u6709\u8054\u7f51\u641c\u7d22\u6865\u63a5\u3002" }, text) }]);
        onNotice?.("\u5f53\u524d\u8fd0\u884c\u73af\u5883\u6ca1\u6709\u8054\u7f51\u641c\u7d22\u6865\u63a5\u3002");
      } else if (webSearchEnabled && api?.search_web) {
        const searchResult = await withAgentApiTimeout(
          api.search_web(text),
          "Agent 联网搜索响应超时，请稍后重试或关闭联网搜索。",
        );
        if (agentRequestRef.current !== requestId) return;
        setConversation((current) => [...current, { role: "agent", text: buildAgentSearchStatusMessage(searchResult, text) }]);
        if (searchResult?.ok) {
          requestAttachments = [...requestAttachments, { id: nextAgentAttachmentId("web"), type: "web", name: "\u8054\u7f51\u641c\u7d22\u7ed3\u679c", content: JSON.stringify(searchResult.results || [], null, 2) }];
        } else if (!searchResult?.ok) {
          onNotice?.(searchResult?.message || "\u8054\u7f51\u641c\u7d22\u672a\u8fd4\u56de\u53ef\u7528\u7ed3\u679c\u3002");
        }
      }
      const result = await withAgentApiTimeout(
        api.chat_with_model(modelConfig, buildModelMessages(nextConversation, selectedServer, server, selectedFile, capabilities, sftpPreview, {
          attachments: requestAttachments,
          terminalLines,
          webSearchEnabled: requestWebSearchEnabled,
        })),
        "Agent 模型响应超时，请检查模型 API、中转站或网络后重试。",
      );
      if (agentRequestRef.current !== requestId) return;
      const reply = result?.ok ? result.content : result?.message || "\u6a21\u578b API \u8c03\u7528\u5931\u8d25";
      if (result?.ok) {
        setConversation((current) => [...current, { role: "agent", text: reply }]);
        queueSuggestedAgentActions(reply);
      } else {
        setConversation((current) => [...current, buildAgentFailureMessage(reply, {
          prefix: "\u6a21\u578b API \u8c03\u7528\u5931\u8d25",
          hint: "\u8bf7\u68c0\u67e5\u6a21\u578b API \u914d\u7f6e\u3001Base URL\u3001Key \u548c\u6a21\u578b\u540d\u79f0\u3002",
        })]);
      }
    } catch (error) {
      const messageText = sanitizeFrontendRuntimeError(error) || String(error?.message || error);
      setConversation((current) => [...current, buildAgentFailureMessage(messageText, {
        prefix: "Agent \u8c03\u7528\u5931\u8d25",
        hint: "\u8bf7\u6253\u5f00\u6a21\u578b API \u8bbe\u7f6e\u6d4b\u8bd5\u8fde\u63a5\uff0c\u5fc5\u8981\u65f6\u590d\u5236\u8fd9\u4efd\u6392\u969c\u4fe1\u606f\u3002",
      })]);
      onNotice?.(messageText);
    } finally {
      if (agentRequestRef.current === requestId) setAgentThinking(false);
      focusAgentInput();
    }
  }

  function cancelAgentResponse() {
    agentRequestRef.current += 1;
    setAgentThinking(false);
    setConversation((current) => [...current, { role: "agent", text: "\u5df2\u505c\u6b62\u672c\u6b21 Agent \u56de\u590d\u3002" }]);
    onNotice?.("\u5df2\u505c\u6b62\u7b49\u5f85\u6a21\u578b\u56de\u590d");
  }

  function clearAgentConversation() {
    agentRequestRef.current += 1;
    setAgentThinking(false);
    setMessage("");
    setAgentAttachments([]);
    setConversation([buildAgentWelcomeMessage(selectedServer)]);
    onNotice?.("AI \u5bf9\u8bdd\u5df2\u6e05\u7a7a");
    focusAgentInput();
  }

  function handleMessageKeyDown(event) {
    if (event.isComposing || event.nativeEvent?.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage(event);
    }
  }

  function parseChatMessageBlocks(text = "") {
    const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const blocks = [];
    let paragraph = [];
    let code = [];
    let inCode = false;
    let language = "";

    function flushParagraph() {
      const value = paragraph.join("\n").trim();
      if (value) blocks.push({ type: "text", text: value });
      paragraph = [];
    }

    function flushCode() {
      blocks.push({ type: "code", language, text: code.join("\n") });
      code = [];
      language = "";
    }

    lines.forEach((line) => {
      if (line.trim().startsWith("```")) {
        if (inCode) {
          flushCode();
          inCode = false;
        } else {
          flushParagraph();
          language = line.trim().slice(3).trim().slice(0, 32);
          inCode = true;
        }
        return;
      }
      if (inCode) {
        code.push(line);
        return;
      }
      if (!line.trim()) {
        flushParagraph();
        return;
      }
      paragraph.push(line);
    });

    if (inCode) flushCode();
    flushParagraph();
    return blocks.length ? blocks : [{ type: "text", text: "" }];
  }

  async function copyChatCodeBlock(code = "") {
    await navigator.clipboard?.writeText?.(String(code || ""));
    onNotice?.("\u4ee3\u7801\u5757\u5df2\u590d\u5236");
  }

  async function copyAgentFailureDiagnostic(text = "") {
    await navigator.clipboard?.writeText?.(String(text || ""));
    onNotice?.("Agent \u6392\u969c\u4fe1\u606f\u5df2\u590d\u5236");
  }

  function ChatMessageContent({ text }) {
    return (
      <div className="chat-message-content">
        {parseChatMessageBlocks(text).map((block, index) => (
          block.type === "code"
            ? (
              <div className="chat-code-shell" key={`code-${index}`}>
                <div className="chat-code-head">
                  <span>{block.language || "\u4ee3\u7801"}</span>
                  <button type="button" aria-label="\u590d\u5236\u4ee3\u7801\u5757" onClick={() => copyChatCodeBlock(block.text)}>
                    <Copy size={12} />
                    {"\u590d\u5236"}
                  </button>
                </div>
                <pre className="chat-code-block"><code>{block.text}</code></pre>
              </div>
            )
            : <p key={`text-${index}`}>{block.text}</p>
        ))}
      </div>
    );
  }

  return (
    <aside className="agent-panel">
      <div className="agent-header">
        <div>
          <h2>Agent</h2>
          <p>{selectedServer} · {modelConfig.provider} / {modelConfig.model}</p>
        </div>
        <div className="agent-header-actions">
          {(pendingTasks.length > 0 || runningTasks.length > 0) && (
            <button
              className="agent-header-task-status"
              type="button"
              title={runningTasks.length > 0 ? "\u53d6\u6d88\u6b63\u5728\u8fd0\u884c\u7684 Agent \u4efb\u52a1" : "\u5df2\u52a0\u5165 Agent \u5ba1\u6279\u961f\u5217"}
              onClick={() => {
                if (runningTasks.length > 0) onCancelRunningTask?.(runningTasks[0]);
                else onNotice?.(`\u5df2\u6709 ${pendingTasks.length} \u4e2a Agent \u4efb\u52a1\u5728\u5ba1\u6279\u961f\u5217\u4e2d\u7b49\u5f85\u5904\u7406\u3002`);
              }}
            >
              <Bot size={14} />
              <span>{pendingTasks.length + runningTasks.length}</span>
            </button>
          )}
          {server?.trustedHostKey?.sha256 ? (
            <button className="icon-button" type="button" aria-label="取消信任主机密钥" title="取消信任主机密钥" onClick={() => onRevokeHostKeyTrust?.(selectedServer)}>
              <ShieldCheck size={16} />
            </button>
          ) : server?.hostKey?.sha256 ? (
            <button className="icon-button" type="button" aria-label="信任主机密钥" title="信任主机密钥" onClick={() => onTrustHostKey?.(selectedServer)}>
              <ShieldCheck size={16} />
            </button>
          ) : null}
          <button
            className={`agent-status-pill ${agentReadiness.ready ? "ready" : "blocked"}`}
            type="button"
            aria-label={agentReadiness.ready ? "Agent 状态" : "打开模型 API 配置"}
            title={agentReadiness.message || "Agent 已连接模型 API"}
            onClick={openAgentReadinessAction}
          >
            <StatusDot tone={agentReadiness.ready ? "green" : "amber"} />{agentReadiness.label}
          </button>
          <button className="icon-button" type="button" aria-label="\u6e05\u7a7a\u5bf9\u8bdd" title="\u6e05\u7a7a\u5bf9\u8bdd" onClick={clearAgentConversation}><Trash2 size={16} /></button>
          <button className="icon-button" type="button" aria-label="模型 API" title="模型 API" onClick={onOpenModelSettings}><KeyRound size={16} /></button>
          <button className="icon-button" type="button" aria-label="版本信息" title="版本信息" onClick={onOpenReleaseInfo}><Info size={16} /></button>
        </div>
      </div>

      {firstPendingTask && (
        <div className="agent-task-dock" aria-label="Agent 待审批动作">
          <div className="agent-task-dock-main">
            <strong>Agent 待审批动作</strong>
            <span>{firstPendingTask.title || firstPendingTask.capabilityName}</span>
          </div>
          <div className="agent-task-dock-meta">
            <span>{firstPendingTask.capabilityType}</span>
            <span>{firstPendingTask.targetServer}</span>
            {pendingTasks.length > 1 && <span>{`另有 ${pendingTasks.length - 1} 个`}</span>}
          </div>
          <div className="agent-task-dock-actions">
            <button type="button" onClick={() => onApproveTask?.(firstPendingTask)}>批准</button>
            <button type="button" onClick={() => onCancelTask?.(firstPendingTask)}>取消</button>
          </div>
        </div>
      )}

      {firstRunningTask && (
        <div className="agent-task-dock running" aria-label="Agent 正在执行">
          <div className="agent-task-dock-main">
            <strong>Agent 正在执行</strong>
            <span>{firstRunningTask.title || firstRunningTask.capabilityName}</span>
          </div>
          <div className="agent-task-dock-meta">
            <span>{firstRunningTask.capabilityType}</span>
            <span>{firstRunningTask.targetServer}</span>
            {runningTasks.length > 1 && <span>{`另有 ${runningTasks.length - 1} 个`}</span>}
          </div>
          <div className="agent-task-dock-actions">
            <button type="button" onClick={() => onCancelRunningTask?.(firstRunningTask)}>停止</button>
          </div>
        </div>
      )}

      <div className="agent-conversation" aria-label="Agent \u5bf9\u8bdd" ref={agentConversationRef}>
        {conversation.map((item, index) => (
          <article className={`chat-message ${item.role === "user" ? "user" : "agent"}`} key={`${item.role}-${index}`}>
            <div className="chat-avatar">{item.role === "user" ? "\u6211" : <Bot size={15} />}</div>
            <div className="chat-bubble">
              <strong>{item.role === "user" ? "\u6211" : "Agent"}</strong>
              <ChatMessageContent text={item.text} />
              {item.attachmentSummary && <p className="chat-attachment-summary">{item.attachmentSummary}</p>}
              {item.diagnosticText && (
                <button className="chat-diagnostic-copy" type="button" aria-label="\u590d\u5236 Agent \u6392\u969c\u4fe1\u606f" onClick={() => copyAgentFailureDiagnostic(item.diagnosticText)}>
                  <Copy size={12} />
                  {"\u590d\u5236\u6392\u969c"}
                </button>
              )}
            </div>
          </article>
        ))}
        {agentThinking && (
          <article className="chat-message agent">
            <div className="chat-avatar"><Bot size={15} /></div>
            <div className="chat-bubble"><strong>Agent</strong><p>{"\u6b63\u5728\u601d\u8003..."}</p></div>
          </article>
        )}
      </div>

      <form className="agent-input-card" onSubmit={sendMessage}>
        <div className="agent-quick-prompts">
          {AGENT_QUICK_PROMPTS.map((item) => (
            <button type="button" key={item.label || item.text} onClick={() => addPrompt(item)}>{item.label || item.text}</button>
          ))}
        </div>
        {agentAttachments.length > 0 && (
          <div className="agent-attachments">
            {agentAttachments.map((item) => (
              <button type="button" key={item.id} onClick={() => removeAttachment(item.id)} title="\u70b9\u51fb\u79fb\u9664\u9644\u4ef6">
                <FileText size={13} />{item.name}<X size={12} />
              </button>
            ))}
          </div>
        )}
        <div className="agent-tool-row">
          <button type="button" onClick={openAttachmentPicker}><Upload size={14} />{"\u4e0a\u4f20\u6587\u4ef6"}</button>
          <button type="button" onClick={attachTerminalOutput}><TerminalSquare size={14} />{"\u5f15\u7528\u7ec8\u7aef"}</button>
          <button type="button" onClick={attachSftpPreview}><Folder size={14} />{"\u5f15\u7528 SFTP"}</button>
          <button type="button" className={webSearchEnabled ? "active" : ""} onClick={() => setWebSearchEnabled((value) => !value)}><Search size={14} />{"\u8054\u7f51\u641c\u7d22"}</button>
        </div>
        <input ref={agentFileInputRef} type="file" multiple accept=".txt,.log,.conf,.json,.yaml,.yml,.md,.ini,.env" onChange={handleAttachmentFileChange} hidden />
        <div className="agent-compose-row">
          <textarea ref={agentInputRef} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={handleMessageKeyDown} placeholder={agentReadiness.placeholder} rows={3} />
          {agentThinking ? (
            <button className="send-command" type="button" onClick={cancelAgentResponse} aria-label="\u505c\u6b62 Agent \u56de\u590d" title="\u505c\u6b62"><X size={18} /></button>
          ) : (
            <button className="send-command" type="submit" disabled={!message.trim()} title="\u53d1\u9001"><Send size={18} /></button>
          )}
        </div>
        <small>{"Enter \u53d1\u9001\uff0cShift+Enter \u6362\u884c"}</small>
      </form>
    </aside>
  );
}
function PlanCard({ steps = [], approved, onApprove }) {
  return (
    <section className="plan-card">
      <div className="plan-card-head">
        <span>{`计划 ${steps.length} 步`}</span>
        <strong>{approved ? "已批准" : "待确认"}</strong>
      </div>
      <div className="plan-list">
        {steps.map((step, index) => (
          <div className="plan-row" key={`${step}-${index}`}>
            <span>{index + 1}</span>
            <p>{step}</p>
            <small>只读</small>
          </div>
        ))}
      </div>
      <div className="plan-actions">
        <button className="primary-button" type="button" onClick={onApprove} disabled={approved}>
          {approved ? "已批准" : "批准执行"}
        </button>
      </div>
    </section>
  );
}
function ToolSettingsModal({
  terminalFontSize,
  terminalScrollLocked,
  capabilities = [],
  selectedServer = "",
  hiddenBuiltinServerCount = 0,
  onTerminalZoom,
  onToggleTerminalScrollLock,
  onResetLayout,
  onRestoreHiddenBuiltinServers,
  onCapabilitiesChange,
  onQueueCapability,
  onOpenSessionLogs,
  onOpenToolLogs,
  onExportDiagnosticPackage,
  onOpenReleaseInfo,
  onCreateDesktopShortcut,
  onCreateStartMenuShortcut,
  onOpenInstallDirectory,
  onOpenAppDataDirectory,
  onNotice,
  onClose,
}) {
  const fontSize = Number(terminalFontSize || DEFAULT_TERMINAL_FONT_SIZE);
  const scrollStatus = terminalScrollLocked ? "滚动已锁定" : "自动跟随输出";
  const [capabilityType, setCapabilityType] = useState("Skill");
  const [capabilityName, setCapabilityName] = useState("");
  const [capabilityEndpoint, setCapabilityEndpoint] = useState("");
  const [capabilityHeaders, setCapabilityHeaders] = useState("");
  const [capabilityCliTarget, setCapabilityCliTarget] = useState("ssh");
  const capabilityFileInputRef = useRef(null);
  const customCapabilityCount = (capabilities || []).filter((item) => !item.builtin).length;

  function closeThen(action) {
    onClose?.();
    action?.();
  }

  function openSessionLogsFromSettings() {
    onClose?.();
    onOpenSessionLogs?.();
  }

  function openToolLogsFromSettings() {
    onClose?.();
    onOpenToolLogs?.();
  }

  function exportDiagnosticPackageFromSettings() {
    onClose?.();
    onExportDiagnosticPackage?.();
  }

  function resetCapabilityDraft() {
    setCapabilityName("");
    setCapabilityEndpoint("");
    setCapabilityHeaders("");
    setCapabilityCliTarget("ssh");
  }

  function addCustomAgentCapability(event) {
    event?.preventDefault?.();
    try {
      const draft = buildCapabilityDraft(capabilityType, capabilityName, {
        endpoint: capabilityEndpoint,
        headersText: capabilityHeaders,
        cliTarget: capabilityCliTarget,
      });
      const nextCapabilities = addAgentCapability(capabilities, draft);
      onCapabilitiesChange?.(nextCapabilities);
      resetCapabilityDraft();
      onNotice?.(`${draft.type} 能力已新增：${draft.name}`);
    } catch (error) {
      onNotice?.(`新增 Agent 能力失败：${error.message || error}`);
    }
  }

  function importSkillCapabilityFile(event) {
    const file = event?.target?.files?.[0];
    if (event?.target) event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const draft = buildCapabilityDraft("Skill", String(reader.result || ""), { sourceFileName: file.name });
        const nextCapabilities = addAgentCapability(capabilities, draft);
        onCapabilitiesChange?.(nextCapabilities);
        onNotice?.(`Skill 文件已导入：${draft.name}`);
      } catch (error) {
        onNotice?.(`导入 Skill 文件失败：${error.message || error}`);
      }
    };
    reader.onerror = () => onNotice?.(`导入 Skill 文件失败：${file.name}`);
    reader.readAsText(file, "utf-8");
  }

  function toggleCustomCapability(capability) {
    if (capability?.builtin) return;
    const nextCapabilities = setAgentCapabilityEnabled(capabilities, capability.id, !capability.enabled);
    onCapabilitiesChange?.(nextCapabilities);
    onNotice?.(`${capability.name} 已${capability.enabled ? "停用" : "启用"}`);
  }

  function deleteCustomCapability(capability) {
    if (capability?.builtin) return;
    const nextCapabilities = removeAgentCapability(capabilities, capability.id);
    onCapabilitiesChange?.(nextCapabilities);
    onNotice?.(`已删除 Agent 能力：${capability.name}`);
  }

  function queueCapabilityForSelectedServer(capability) {
    onQueueCapability?.(capability);
  }

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="工具设置">
      <div className="settings-modal tool-settings-modal">
        <div className="modal-head">
          <div>
            <h2>{"工具设置"}</h2>
            <p>{"调整终端显示、布局、日志和 Windows 客户端快捷入口。"}</p>
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>

        <section className="tool-settings-section">
          <div>
            <h3>{"终端显示"}</h3>
            <p>{`当前字号：${fontSize}px`}</p>
          </div>
          <div className="tool-settings-actions">
            <button type="button" onClick={() => onTerminalZoom("zoom-out")}>{"缩小"}</button>
            <button type="button" onClick={() => onTerminalZoom("zoom-reset")}>{"重置"}</button>
            <button type="button" onClick={() => onTerminalZoom("zoom-in")}>{"放大"}</button>
          </div>
        </section>

        <section className="tool-settings-section">
          <div>
            <h3>{"终端滚动"}</h3>
            <p>{scrollStatus}</p>
          </div>
          <div className="tool-settings-actions">
            <button type="button" onClick={onToggleTerminalScrollLock}>
              {terminalScrollLocked ? "解锁滚动" : "锁定滚动"}
            </button>
          </div>
        </section>

        <section className="tool-settings-section">
          <div>
            <h3>{"界面布局"}</h3>
            <p>{"恢复默认三列布局：左侧服务器和 SFTP，中间 SSH 终端，右侧 Agent 对话。"}</p>
          </div>
          <div className="tool-settings-actions">
            <button type="button" onClick={onResetLayout}>{"恢复默认三栏宽度"}</button>
          </div>
        </section>

        <section className="tool-settings-section">
          <div>
            <h3>{"服务器列表"}</h3>
            <p>{`隐藏的内置服务器：${hiddenBuiltinServerCount} 台。误隐藏后可一键恢复到左侧服务器列表。`}</p>
          </div>
          <div className="tool-settings-actions">
            <button type="button" onClick={onRestoreHiddenBuiltinServers} disabled={hiddenBuiltinServerCount === 0}>{"恢复隐藏服务器"}</button>
          </div>
        </section>

        <section className="tool-settings-section">
          <div>
            <h3>{"自定义 Agent 能力"}</h3>
            <p>{`可新增 Skill、MCP 或 CLI 扩展，当前自定义 ${customCapabilityCount} 个。`}</p>
          </div>
          <div className="capability-panel">
            <form className="capability-input" onSubmit={addCustomAgentCapability}>
              <select value={capabilityType} onChange={(event) => setCapabilityType(event.target.value)}>
                <option value="Skill">Skill</option>
                <option value="MCP">MCP</option>
                <option value="CLI">CLI</option>
              </select>
              <input value={capabilityName} onChange={(event) => setCapabilityName(event.target.value)} placeholder="能力名称，或粘贴 Skill JSON" />
              {capabilityType === "MCP" && (
                <>
                  <input value={capabilityEndpoint} onChange={(event) => setCapabilityEndpoint(event.target.value)} placeholder="MCP Endpoint，例如 https://mcp.example.com/rpc" />
                  <textarea value={capabilityHeaders} onChange={(event) => setCapabilityHeaders(event.target.value)} placeholder={"MCP Header，每行一个，例如：\nAuthorization: Bearer token\nX-Team: ops"} />
                </>
              )}
              {capabilityType === "CLI" && (
                <select value={capabilityCliTarget} onChange={(event) => setCapabilityCliTarget(event.target.value)}>
                  <option value="ssh">在当前 SSH 会话执行</option>
                  <option value="local">在本机执行</option>
                </select>
              )}
              <button type="submit">{"新增能力"}</button>
              <button type="button" onClick={() => capabilityFileInputRef.current?.click()}>{"导入 Skill 文件"}</button>
              <input ref={capabilityFileInputRef} type="file" accept=".json,.skill,.md,.txt" onChange={importSkillCapabilityFile} hidden />
            </form>
            <div className="capability-list" aria-label="Agent 能力列表">
              {(capabilities || []).map((capability) => (
                <div className={`capability-row ${capability.enabled === false ? "disabled" : ""}`} key={capability.id}>
                  <strong>{capability.type}</strong>
                  <span>
                    {capability.name}
                    <small>{capability.description || capability.entry || capability.endpoint}</small>
                  </span>
                  <small>{capability.builtin ? "内置" : capability.enabled === false ? "停用" : "启用"}</small>
                  <button type="button" onClick={() => queueCapabilityForSelectedServer(capability)} disabled={!selectedServer || capability.enabled === false}>
                    {"加入队列"}
                  </button>
                  <button type="button" onClick={() => toggleCustomCapability(capability)} disabled={capability.builtin}>
                    {capability.enabled === false ? "启用" : "停用"}
                  </button>
                  <button type="button" onClick={() => deleteCustomCapability(capability)} disabled={capability.builtin}>
                    {"删除"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="tool-settings-section">
          <div>
            <h3>{"日志与诊断"}</h3>
            <p>{"用于排查工具本身的问题，包括 SSH、SFTP、API 和 EXE 启动日志。"}</p>
          </div>
          <div className="tool-settings-actions">
            <button type="button" onClick={openSessionLogsFromSettings}>{"会话日志"}</button>
            <button type="button" onClick={openToolLogsFromSettings}>{"运行日志"}</button>
            <button type="button" onClick={exportDiagnosticPackageFromSettings}>{"导出诊断包"}</button>
          </div>
        </section>

        <section className="tool-settings-section">
          <div>
            <h3>{"在线更新"}</h3>
            <p>{"配置 latest.json 更新源、检查新版本、下载校验更新包，并从工具内启动后台更新器。"}</p>
          </div>
          <div className="tool-settings-actions">
            <button type="button" onClick={() => closeThen(onOpenReleaseInfo)}>{"打开在线更新"}</button>
          </div>
        </section>

        <section className="tool-settings-section">
          <div>
            <h3>{"本机客户端入口"}</h3>
            <p>{"创建桌面和开始菜单快捷方式，或打开安装目录与数据目录。"}</p>
          </div>
          <div className="tool-settings-actions">
            <button type="button" onClick={() => closeThen(onCreateDesktopShortcut)}>{"创建桌面快捷方式"}</button>
            <button type="button" onClick={() => closeThen(onCreateStartMenuShortcut)}>{"创建开始菜单快捷方式"}</button>
            <button type="button" onClick={() => closeThen(onOpenInstallDirectory)}>{"打开安装目录"}</button>
            <button type="button" onClick={() => closeThen(onOpenAppDataDirectory)}>{"打开数据目录"}</button>
          </div>
        </section>

        <div className="settings-status">
          <TerminalSquare size={15} />
          <span>{"正式 Windows 客户端将以 GUI 子系统启动，不需要 BAT 或命令行窗口。"}</span>
        </div>
      </div>
    </div>
  );
}
function ModelSettingsModal({
  initialConfig,
  profileOptions = [],
  activeProfileId = "",
  onSave,
  onSaveProfile,
  onCreateProfile,
  onSelectProfile,
  onDeleteProfile,
  onTestConnection,
  onListModels,
  onCacheModelOptions,
  onOpenModelLogs,
  onClose,
}) {
  const activeProfile = profileOptions.find((profile) => profile.id === activeProfileId);
  const [config, setConfig] = useState(() => ({ ...initialConfig, apiKey: initialConfig.apiKey || maskModelApiKey(initialConfig) }));
  const [draftProfileId, setDraftProfileId] = useState(activeProfileId);
  const [profileName, setProfileName] = useState(activeProfile?.name || initialConfig.provider || "OpenAI \u517c\u5bb9");
  const [headersText, setHeadersText] = useState(() => formatModelHeaderLines(initialConfig.extraHeaders));
  const [status, setStatus] = useState("\u5c1a\u672a\u6d4b\u8bd5");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelOptions, setModelOptions] = useState(() => filterModelOptions(activeProfile?.config?.modelOptions || initialConfig.modelOptions || []));
  const [modelFilter, setModelFilter] = useState("");
  const [modelListFetched, setModelListFetched] = useState(false);
  const [modelListFetchedAt, setModelListFetchedAt] = useState("");
  const [modelListDiagnostics, setModelListDiagnostics] = useState(null);
  const [statusCopied, setStatusCopied] = useState(false);
  const filteredModelOptions = filterModelOptions(modelOptions, modelFilter);
  const hasModelApiSecret = Boolean(hasNewModelApiKey(config.apiKey) || config.hasApiKey || config.apiKeyRef);
  const testStatus = status;
  const setTestStatus = setStatus;

  useEffect(() => {
    setConfig({ ...initialConfig, apiKey: initialConfig.apiKey || maskModelApiKey(initialConfig) });
    setDraftProfileId(activeProfileId);
    setProfileName(activeProfile?.name || initialConfig.provider || "OpenAI \u517c\u5bb9");
    setHeadersText(formatModelHeaderLines(initialConfig.extraHeaders));
    setModelOptions(filterModelOptions(activeProfile?.config?.modelOptions || initialConfig.modelOptions || []));
    setModelFilter("");
    setModelListFetched(false);
    setModelListFetchedAt("");
    setModelListDiagnostics(null);
    setStatus("\u5c1a\u672a\u6d4b\u8bd5");
  }, [initialConfig, activeProfile?.name, activeProfileId]);

  function buildSubmitConfig() {
    return {
      ...config,
      provider: config.provider || "OpenAI \u517c\u5bb9",
      extraHeaders: parseModelHeaderLines(headersText),
      modelOptions,
    };
  }

  function resetModelListState() {
    setModelOptions([]);
    setModelFilter("");
    setModelListFetched(false);
    setModelListFetchedAt("");
    setModelListDiagnostics(null);
  }

  function markModelListFetched() {
    setModelListFetchedAt(new Date().toLocaleString("zh-CN"));
  }

  function buildSavedModelStatus(savedConfig = config) {
    return [
      "模型 API 配置已保存",
      `档案：${profileName || savedConfig.provider || "默认档案"}`,
      `模型：${savedConfig.model || "未填写"}`,
      "测试失败也可以先保存配置，随后再获取模型列表或查看 API 日志。",
    ].join("\n");
  }

  function validateModelDraft(options = {}) {
    const validation = validateModelApiDraft(buildSubmitConfig(), options);
    if (!validation.ok) setStatus(validation.message);
    return validation.ok;
  }

  function updateField(field, value) {
    const modelListInvalidatingFields = new Set(["baseUrl", "apiKey", "provider"]);
    setConfig((current) => ({ ...current, [field]: value }));
    if (modelListInvalidatingFields.has(field)) resetModelListState();
    setStatus("\u5c1a\u672a\u6d4b\u8bd5");
  }

  function selectFetchedModel(modelName) {
    const selectedModel = String(modelName || "").trim();
    if (!selectedModel) return;
    setConfig((current) => ({ ...current, model: selectedModel }));
    setStatus(`已选择模型：${selectedModel}`);
  }

  function selectProvider(provider) {
    const preset = PROVIDER_PRESETS[provider] || {};
    setConfig((current) => ({
      ...current,
      provider,
      baseUrl: preset.baseUrl || current.baseUrl || "",
      model: preset.model || current.model || "",
      apiFormat: preset.apiFormat || current.apiFormat || "openai",
      extraHeaders: preset.extraHeaders || [],
      apiKey: "",
      apiKeyRef: "",
      hasApiKey: false,
    }));
    setHeadersText(formatModelHeaderLines(preset.extraHeaders || []));
    resetModelListState();
    setStatus("\u5df2\u5207\u6362\u4f9b\u5e94\u5546\uff0c\u8bf7\u586b\u5199 API Key \u540e\u4fdd\u5b58\u3002");
  }

  function clearSavedModelApiKey() {
    setConfig((current) => ({ ...current, apiKey: "", apiKeyRef: "", hasApiKey: false }));
    resetModelListState();
    setStatus("已清除已保存的模型 API Key，保存配置后生效。");
  }

  function buildNewModelProfileName() {
    const baseName = "新模型 API";
    const existingNames = new Set(profileOptions.map((profile) => String(profile.name || "").trim()).filter(Boolean));
    if (!existingNames.has(baseName)) return baseName;
    for (let index = 2; index < 100; index += 1) {
      const candidate = `${baseName} ${index}`;
      if (!existingNames.has(candidate)) return candidate;
    }
    return `${baseName} ${Date.now()}`;
  }

  function prepareNewModelProfileDraft() {
    const provider = "OpenAI \u517c\u5bb9";
    const preset = PROVIDER_PRESETS[provider] || {};
    const nextConfig = {
      provider,
      baseUrl: preset.baseUrl || "",
      model: preset.model || "",
      apiFormat: preset.apiFormat || "openai",
      extraHeaders: preset.extraHeaders || [],
      apiKey: "",
      apiKeyRef: "",
      hasApiKey: false,
      modelOptions: [],
    };
    setDraftProfileId("");
    setConfig(nextConfig);
    setProfileName(buildNewModelProfileName());
    setHeadersText(formatModelHeaderLines(nextConfig.extraHeaders));
    resetModelListState();
    setStatus("已准备新增 API 档案，请填写 API Key 后保存。");
  }

  function selectProfile(profileId) {
    const profile = profileOptions.find((item) => item.id === profileId);
    if (!profile) return;
    setDraftProfileId(profileId);
    setConfig({ ...profile.config, apiKey: maskModelApiKey(profile.config) });
    setProfileName(profile.name);
    setHeadersText(formatModelHeaderLines(profile.config.extraHeaders));
    setModelOptions(filterModelOptions(profile.config.modelOptions || []));
    setModelListFetched(false);
    setModelListFetchedAt("");
    setModelListDiagnostics(null);
    setStatus("\u5df2\u5207\u6362 API \u914d\u7f6e");
    onSelectProfile?.(profileId);
  }

  async function saveConfig() {
    setBusy(true);
    try {
      const nextConfig = buildModelConfigForSave(config, modelOptions);
      const saved = await onSave({ ...nextConfig, extraHeaders: parseModelHeaderLines(headersText) });
      setTestStatus(buildSavedModelStatus(nextConfig));
      if (saved === false) {
        setStatus("保存失败，请检查 API Key、Base URL 或工具日志。");
        return;
      }
    } catch (error) {
      setStatus(sanitizeFrontendRuntimeError(error) || "\u4fdd\u5b58\u5931\u8d25");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    setBusy(true);
    try {
      const saved = await onSaveProfile?.({ id: draftProfileId, name: profileName, config: buildSubmitConfig() });
      if (saved === false) {
        setStatus("保存失败，请检查 API Key、Base URL 或工具日志。");
        return;
      }
      if (saved?.id) setDraftProfileId(saved.id);
      setStatus("API \u914d\u7f6e\u5df2\u66f4\u65b0");
    } finally {
      setBusy(false);
    }
  }

  async function createProfile() {
    setBusy(true);
    try {
      const created = await onCreateProfile?.({ name: profileName, config: buildSubmitConfig() });
      if (created === false) {
        setStatus("新建失败，请检查 API Key、Base URL 或工具日志。");
        return;
      }
      if (created?.id) setDraftProfileId(created.id);
      setStatus("API \u914d\u7f6e\u5df2\u65b0\u5efa");
    } finally {
      setBusy(false);
    }
  }

  async function deleteProfile() {
    if (!draftProfileId) return;
    setBusy(true);
    try {
      await onDeleteProfile?.(draftProfileId);
      setStatus("API \u914d\u7f6e\u5df2\u5220\u9664");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(nextConfig = null) {
    const validation = validateModelApiDraft(nextConfig ? { ...nextConfig, extraHeaders: parseModelHeaderLines(headersText) } : buildSubmitConfig(), { requireModel: true });
    if (!validation.ok) {
      setStatus(validation.message);
      return;
    }
    setTesting(true);
    try {
      const result = await onTestConnection?.(nextConfig ? { ...nextConfig, extraHeaders: parseModelHeaderLines(headersText) } : buildSubmitConfig());
      setStatus(result?.ok ? "\u6a21\u578b API \u8fde\u63a5\u6210\u529f" : result?.message || "\u6a21\u578b API \u6d4b\u8bd5\u5931\u8d25");
    } catch (error) {
      setStatus(sanitizeFrontendRuntimeError(error) || "\u6a21\u578b API \u6d4b\u8bd5\u5931\u8d25");
    } finally {
      setTesting(false);
    }
  }

  async function fetchModelOptions() {
    if (!validateModelDraft({ requireModel: false })) return;
    setFetchingModels(true);
    try {
      const result = await onListModels?.(buildSubmitConfig());
      const nextModels = extractModelOptions(result);
      setModelOptions(nextModels);
      setModelListFetched(true);
      markModelListFetched();
      setModelListDiagnostics(result?.ok === false ? {
        attemptedEndpoints: result?.attemptedEndpoints,
        lastError: result?.lastError || result?.message || "",
      } : null);
      const shouldPickFirstModel = nextModels.length > 0 && !nextModels.includes(config.model);
      const selectedModel = shouldPickFirstModel ? nextModels[0] : config.model;
      if (shouldPickFirstModel) {
        updateField("model", selectedModel);
      }
      await onCacheModelOptions?.({ ...buildSubmitConfig(), model: selectedModel }, nextModels);
      setStatus(result?.ok === false ? result?.message || "\u83b7\u53d6\u6a21\u578b\u5217\u8868\u5931\u8d25" : `\u5df2\u83b7\u53d6 ${nextModels.length} \u4e2a\u6a21\u578b`);
    } catch (error) {
      setModelListFetched(true);
      markModelListFetched();
      setModelListDiagnostics({ attemptedEndpoints: [], lastError: sanitizeFrontendRuntimeError(error) || String(error?.message || error) });
      setStatus(sanitizeFrontendRuntimeError(error) || "\u83b7\u53d6\u6a21\u578b\u5217\u8868\u5931\u8d25");
    } finally {
      setFetchingModels(false);
    }
  }

  async function saveAndFetchModels() {
    if (!validateModelDraft({ requireModel: false })) return;
    setBusy(true);
    setFetchingModels(true);
    const draft = buildSubmitConfig();
    try {
      const savedProfile = await onSaveProfile?.({ id: draftProfileId, name: profileName, config: draft });
      if (savedProfile === false) {
        setStatus("保存失败，请检查 API Key、Base URL 或工具日志。");
        return;
      }
      if (savedProfile?.id) setDraftProfileId(savedProfile.id);
      const result = await onListModels?.(draft);
      const models = extractModelOptions(result);
      const shouldPickFirstModel = models.length > 0 && !models.includes(config.model);
      const selectedModel = shouldPickFirstModel ? models[0] : config.model;
      setModelOptions(models);
      setModelListFetched(true);
      markModelListFetched();
      setModelListDiagnostics(result?.ok === false ? {
        attemptedEndpoints: result?.attemptedEndpoints,
        lastError: result?.lastError || result?.message || "",
      } : null);
      setModelFilter("");
      if (shouldPickFirstModel) {
        setConfig((current) => ({ ...current, model: selectedModel }));
      }
      const cacheProfile = {
        id: savedProfile?.id || draftProfileId,
        name: savedProfile?.name || profileName,
        config: { ...(savedProfile?.config || draft), model: selectedModel },
      };
      await onCacheModelOptions?.(cacheProfile, models);
      setStatus(result?.ok === false ? result?.message || "获取模型列表失败" : `配置已保存，已获取 ${models.length} 个模型`);
    } catch (error) {
      const errorText = sanitizeFrontendRuntimeError(error) || String(error?.message || error);
      setModelListFetched(true);
      markModelListFetched();
      setModelListDiagnostics({ attemptedEndpoints: [], lastError: errorText });
      setStatus(errorText || "保存并获取模型失败");
    } finally {
      setBusy(false);
      setFetchingModels(false);
    }
  }

  async function saveAndTestConfig() {
    if (!validateModelDraft({ requireModel: true })) return;
    setBusy(true);
    try {
      const nextConfig = buildModelConfigForSave(config, modelOptions);
      const saved = await onSave({ ...nextConfig, extraHeaders: parseModelHeaderLines(headersText) });
      if (saved === false) {
        setStatus("保存失败，请检查 API Key、Base URL 或工具日志。");
        return;
      }
      setTestStatus(buildSavedModelStatus(nextConfig));
      await testConnection(nextConfig);
    } catch (error) {
      setStatus(sanitizeFrontendRuntimeError(error) || "保存并测试失败");
    } finally {
      setBusy(false);
    }
  }

  async function clearModelOptions() {
    setModelOptions([]);
    setModelFilter("");
    setModelListFetched(true);
    setModelListFetchedAt("");
    setModelListDiagnostics(null);
    await onCacheModelOptions?.({ id: draftProfileId, name: profileName, config: { ...buildSubmitConfig(), modelOptions: [] } }, []);
  }

  async function copyModelStatus() {
    const text = testStatus || "--";
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error("clipboard unavailable");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setStatusCopied(true);
    window.setTimeout?.(() => setStatusCopied(false), 1200);
  }

  async function copyModelDiagnosticInfo() {
    const diagnostic = [
      "模型 API 排障信息",
      `供应商：${config.provider || "--"}`,
      `Base URL：${config.baseUrl || "--"}`,
      `默认模型：${config.model || "--"}`,
      `API Key：${hasModelApiSecret ? "已配置或已加密保存" : "未配置"}`,
      `当前状态：${testStatus || "--"}`,
      `模型列表尝试接口：${modelListDiagnostics?.attemptedEndpoints?.join?.(", ") || "--"}`,
      `模型列表最后错误：${modelListDiagnostics?.lastError || "--"}`,
    ].join("\n");
    await navigator.clipboard.writeText(diagnostic);
    setStatus("模型 API 排障信息已复制，不包含 API Key。");
  }

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="\u6a21\u578b API \u914d\u7f6e">
      <div className="settings-modal model-settings-modal">
        <div className="modal-head">
          <div>
            <h2>{"\u6a21\u578b API \u914d\u7f6e"}</h2>
            <p>{"支持 OpenAI 兼容接口、国内大模型、中转站 API 和本地 Ollama。"}</p>
          </div>
          <IconButton label="\u5173\u95ed" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>

        {profileOptions.length > 0 && (
          <>
            <div className="model-profile-row">
              <select value={draftProfileId || "__new__"} onChange={(event) => event.target.value !== "__new__" && selectProfile(event.target.value)}>
                {!draftProfileId && <option value="__new__">新 API 档案（未保存）</option>}
                {profileOptions.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </select>
              <input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="API \u914d\u7f6e\u540d\u79f0" />
              <button className="model-profile-new" type="button" onClick={prepareNewModelProfileDraft}>准备新增</button>
            </div>
            <div className="model-profile-tabs" aria-label="模型 API 档案状态">
              {profileOptions.map((profile) => (
                <button
                  className={profile.id === draftProfileId ? "active" : ""}
                  type="button"
                  key={profile.id}
                  onClick={() => selectProfile(profile.id)}
                >
                  <Cloud size={14} />
                  <span className="model-profile-label">
                    <span className="model-profile-name">{profile.name}</span>
                    <span className="model-profile-status">{formatModelProfileTestStatus(profile)}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="provider-grid">
          {Object.keys(PROVIDER_PRESETS).map((provider) => (
            <button className={config.provider === provider ? "active" : ""} type="button" key={provider} onClick={() => selectProvider(provider)}>
              <Cloud size={15} />{provider}
            </button>
          ))}
        </div>

        <div className="settings-grid two">
          <label>
            <span>{"\u4f9b\u5e94\u5546"}</span>
            <input value={config.provider || ""} onChange={(event) => updateField("provider", event.target.value)} />
          </label>
          <label>
            <span>Base URL</span>
            <input value={config.baseUrl || ""} onChange={(event) => updateField("baseUrl", event.target.value)} placeholder="https://api.example.com/v1" />
          </label>
          <label>
            <span>API Key</span>
            <input type="password" value={config.apiKey || ""} onChange={(event) => updateField("apiKey", event.target.value)} placeholder="sk-..." />
          </label>
          <label className="model-field-row">
            <span>默认模型</span>
            <div className="model-field-input">
              <input value={config.model || ""} onChange={(event) => updateField("model", event.target.value)} list="model-options" placeholder="gpt-4.1-mini" />
              <div className="model-field-actions">
                <button type="button" onClick={fetchModelOptions} disabled={fetchingModels}>{fetchingModels ? "获取中..." : "获取模型"}</button>
                {filteredModelOptions.length > 0 && (
                  <select className="model-inline-select" value={config.model || ""} onChange={(event) => selectFetchedModel(event.target.value)}>
                    {filteredModelOptions.map((model) => {
                      const modelName = model.id || model.name || model;
                      return <option key={modelName} value={modelName}>{modelName}</option>;
                    })}
                  </select>
                )}
              </div>
            </div>
          </label>
        </div>

        <div className={`model-list-panel ${modelListFetched && modelOptions.length === 0 ? "empty" : ""}`}>
          <div className="model-list-head">
            <strong>{"模型列表"}</strong>
            <button className="model-list-clear" type="button" onClick={clearModelOptions} disabled={fetchingModels}>清空列表</button>
          </div>
          <div className="model-list-meta">
            <span>{`模型数量：${modelOptions.length}`}</span>
            <span>{`最近获取：${modelListFetchedAt || "尚未获取"}`}</span>
          </div>
          <div className="model-filter-row">
            <input className="model-filter-input" value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} placeholder="\u641c\u7d22\u6a21\u578b\u5217\u8868" />
            {modelFilter && (
              <button className="model-filter-clear" type="button" onClick={() => setModelFilter("")}>清空</button>
            )}
            <button type="button" onClick={fetchModelOptions} disabled={fetchingModels}>{fetchingModels ? "\u83b7\u53d6\u4e2d..." : "\u83b7\u53d6\u6a21\u578b\u5217\u8868"}</button>
          </div>
          {filteredModelOptions.length > 0 ? (
            <select value={config.model || ""} onChange={(event) => selectFetchedModel(event.target.value)}>
              {filteredModelOptions.map((model) => {
                const modelName = model.id || model.name || model;
                return <option key={modelName} value={modelName}>{modelName}</option>;
              })}
            </select>
          ) : (
            <p>{modelListFetched ? "未获取到模型，可以继续手动填写默认模型。" : "获取模型列表后可以选择模型，也可以继续手动填写默认模型。"}</p>
          )}
        </div>
        <datalist id="model-options">
          {filteredModelOptions.map((model) => (
            <option key={model.id || model.name || model} value={model.id || model.name || model} />
          ))}
        </datalist>
        {filteredModelOptions.length > 0 && (
          <div className="model-options-list">
            {filteredModelOptions.slice(0, 18).map((model) => {
              const modelName = model.id || model.name || model;
              return <button type="button" key={modelName} onClick={() => selectFetchedModel(modelName)}>{modelName}</button>;
            })}
          </div>
        )}

        {modelListDiagnostics && (
          <div className="model-diagnostics-panel">
            <div className="model-diagnostics-head">
              <strong>{"模型接口诊断"}</strong>
              <button type="button" onClick={copyModelDiagnosticInfo}>复制诊断</button>
            </div>
            <p>{`尝试接口：${modelListDiagnostics?.attemptedEndpoints?.join?.(", ") || "--"}`}</p>
            <p>{`最后错误：${modelListDiagnostics?.lastError || "--"}`}</p>
          </div>
        )}

        <label className="settings-textarea">
          <span>{"\u81ea\u5b9a\u4e49 Header"}</span>
          <textarea value={headersText} onChange={(event) => { setHeadersText(event.target.value); resetModelListState(); }} placeholder={"每行一个，例如：\nHTTP-Referer: https://ops.example.com\nX-Title: SSH Agent Tool"} />
        </label>

        <div className="settings-status">
          <Cloud size={15} />
          <span className="settings-status-text">{status}</span>
          <button className="settings-status-copy" type="button" onClick={copyModelStatus}>{statusCopied ? "已复制" : "复制状态"}</button>
          <button className="settings-status-log" type="button" onClick={onOpenModelLogs}>{"API 日志"}</button>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={clearSavedModelApiKey}>清除 Key</button>
          <button type="button" onClick={copyModelDiagnosticInfo}>复制排障信息</button>
          <button type="button" onClick={testConnection} disabled={testing}>{testing ? "\u6d4b\u8bd5\u4e2d..." : "\u6d4b\u8bd5\u8fde\u63a5"}</button>
          <button type="button" onClick={saveAndTestConfig} disabled={busy || testing}>保存并测试</button>
          <button type="button" onClick={saveAndFetchModels} disabled={busy || fetchingModels || !profileName.trim()}>{"保存并获取模型"}</button>
          <button type="button" onClick={saveProfile} disabled={busy || !profileName.trim()}>{"保存为档案"}</button>
          <button type="button" onClick={createProfile} disabled={busy || !profileName.trim()}>{"\u65b0\u5efa\u914d\u7f6e"}</button>
          <button type="button" onClick={deleteProfile} disabled={busy || !draftProfileId}>{"\u5220\u9664\u914d\u7f6e"}</button>
          <button className="primary-button" type="button" onClick={saveConfig} disabled={busy}>{busy ? "\u4fdd\u5b58\u4e2d..." : "\u4fdd\u5b58\u914d\u7f6e"}</button>
        </div>
      </div>
    </div>
  );
}
function formatDiagnosticPackageNotice(result, options = {}) {
  if (result?.ok === false && result?.message) return result.message;
  const exportedText = result?.path ? `诊断包已导出：${result.path}` : result?.message || "诊断包已导出。";
  const fileCountText = Array.isArray(result?.files) ? `共 ${result.files.length} 个文件。` : "";
  const copiedPathText = options.copiedPath ? "路径已复制，可直接粘贴发送。" : "";
  return [
    exportedText,
    copiedPathText,
    fileCountText,
    "请优先查看压缩包内的 问题反馈模板.txt 和 支持排查说明.md，并把整个诊断包发送给开发者。",
  ].filter(Boolean).join("\n");
}

function ReleaseInfoModal({ manifest = DEFAULT_RELEASE_MANIFEST, runtimeDiagnostics = null, autoCheckNonce = 0, onClose }) {
  const runtime = runtimeDiagnostics || {};
  const lastAutoCheckNonceRef = useRef(0);
  const [manualUpdateStatus, setManualUpdateStatus] = useState("");
  const [latestUpdateStatus, setLatestUpdateStatus] = useState(null);
  const [releaseUpdateStatus, setReleaseUpdateStatus] = useState(null);
  const [updateSourceDraft, setUpdateSourceDraft] = useState(manifest.updateCheckUrl || "");
  const [autoCheckOnStartup, setAutoCheckOnStartup] = useState(false);
  const [busy, setBusy] = useState(false);
  const generatedAt = manifest.generatedAt ? new Date(manifest.generatedAt).toLocaleString() : "--";
  const webView2Runtime = runtime.webView2Runtime || {};
  const startupFailureLog = runtime.startupFailureLog || {};
  const startupIdentity = runtime.startupIdentity || {};
  const clientEntry = runtime.clientEntry || {};
  const webView2Text = webView2Runtime.available === true ? `已安装${webView2Runtime.version ? ` / ${webView2Runtime.version}` : ""}` : webView2Runtime.available === false ? "未检测到" : "--";
  const startupFailureText = startupFailureLog.exists
    ? `已有记录${startupFailureLog.updatedAt ? ` / ${startupFailureLog.updatedAt}` : ""}`
    : "暂无启动失败记录";
  const clientEntryText = clientEntry.message || clientEntry.recommendedEntry || "--";
  const startupIdentityText = startupIdentity.ok === true ? "通过" : startupIdentity.ok === false ? "需要检查" : "--";
  const startupDiagnosisText = buildStartupDiagnosisText(runtime);
  const startupFrontendText = startupIdentity.runtimeScript || runtime.frontendAssets?.script || "--";
  const startupFrontendShaText = startupIdentity.runtimeScriptSha256 || runtime.frontendAssets?.scriptSha256 || "--";
  const manifestFrontendText = manifest.frontendAssets?.script || "--";
  const manifestFrontendShaText = manifest.frontendAssets?.scriptSha256 || "--";
  const inferredFrontendMatch = startupFrontendText !== "--" && manifestFrontendText !== "--"
    ? startupFrontendText === manifestFrontendText
    : null;
  const frontendAssetsMatch = startupIdentity.frontendMatchesManifest ?? inferredFrontendMatch;
  const startupAssetMatchText = frontendAssetsMatch === true
    ? "资源一致"
    : frontendAssetsMatch === false
      ? "资源不一致"
      : "--";
  const releaseAssetWarning = frontendAssetsMatch === false;
  const executableMode = runtime.executableMode || {};
  const executableDirectoryText = runtime.executableDirectory || "--";
  const clientModeText = executableMode.label || (runtime.frozen ? "正式 EXE 运行中" : "开发预览环境");
  const consoleModeText = executableMode.consoleWindow === false
    ? "普通图形客户端"
    : executableMode.consoleWindow === true
      ? "异常：控制台模式"
      : executableMode.message || "--";
  const commandLineLaunchers = runtime.commandLineLaunchers || {};
  const launcherStatusText = commandLineLaunchers.count > 0
    ? `发现 ${commandLineLaunchers.count} 个命令行脚本：${(commandLineLaunchers.files || []).join("、")}`
    : commandLineLaunchers.message || "未发现 BAT/CMD/PowerShell 启动脚本";
  const recommendedClientEntry = manifest.executable || "SSH-Agent-Tool.exe";
  const recommendedClientText = `双击 ${recommendedClientEntry}`;
  const updateUrl = updateSourceDraft || manifest.updateCheckUrl || manifest.latestManifestUrl || manifest.currentPackageUrl || "";
  const packageShaText = manifest.packageSha256 || "--";
  const statusText = manualUpdateStatus || latestUpdateStatus?.message || releaseUpdateStatus?.message || "";
  const statusIsError = latestUpdateStatus?.ok === false || releaseUpdateStatus?.ok === false;
  const releaseUpdaterLogPath = releaseUpdateStatus?.logPath || releaseUpdateStatus?.statusPath || "";
  const downloadedUpdatePackagePath = latestUpdateStatus?.localPath || releaseUpdateStatus?.localPath || releaseUpdateStatus?.packageZip || "";
  const downloadedUpdatePackageDir = downloadedUpdatePackagePath.replace(/[\\/][^\\/]*$/, "");
  const runtimeHealthItems = buildRuntimeHealthItems();

  useEffect(() => {
    let mounted = true;
    async function loadReleaseUpdateSettings() {
      const api = safeFileApi();
      if (!api?.read_release_update_settings) return;
      try {
        const settings = await api.read_release_update_settings();
        if (!mounted) return;
        setUpdateSourceDraft(settings?.updateCheckUrl || manifest.updateCheckUrl || "");
        setAutoCheckOnStartup(Boolean(settings?.autoCheckOnStartup));
      } catch (error) {
        if (mounted) setManualUpdateStatus(`读取更新设置失败：${error.message || error}`);
      }
    }
    loadReleaseUpdateSettings();
    loadReleaseUpdateStatus();
    return () => {
      mounted = false;
    };
  }, [manifest.updateCheckUrl]);

  useEffect(() => {
    if (!autoCheckNonce || lastAutoCheckNonceRef.current === autoCheckNonce) return;
    lastAutoCheckNonceRef.current = autoCheckNonce;
    checkUpdateStatus();
  }, [autoCheckNonce]);

  async function callReleaseApi(method, pendingText, payload) {
    const api = safeFileApi();
    if (!api?.[method]) {
      const result = { ok: false, message: "当前环境不支持此更新操作，请使用正式 Windows 客户端。" };
      setLatestUpdateStatus(result);
      setManualUpdateStatus(result.message);
      return result;
    }

    setBusy(true);
    setManualUpdateStatus(pendingText);
    try {
      const result = payload === undefined ? await api[method]() : await api[method](payload);
      const finalResult = result || { ok: true, message: "操作已完成" };
      setLatestUpdateStatus(finalResult);
      setManualUpdateStatus(finalResult.message || "操作已完成");
      return finalResult;
    } catch (error) {
      const result = { ok: false, message: sanitizeFrontendRuntimeError(error) || String(error?.message || error) };
      setLatestUpdateStatus(result);
      setManualUpdateStatus(result.message);
      return result;
    } finally {
      setBusy(false);
    }
  }

  async function loadReleaseUpdateStatus() {
    const api = safeFileApi();
    if (!api?.read_release_update_status) return null;
    try {
      const result = await api.read_release_update_status();
      setReleaseUpdateStatus(result || null);
      return result;
    } catch (error) {
      const result = { ok: false, message: `读取更新日志失败：${error.message || error}` };
      setReleaseUpdateStatus(result);
      return result;
    }
  }

  async function saveUpdateSourceSettings() {
    const api = safeFileApi();
    if (!api?.save_release_update_settings) {
      setManualUpdateStatus("当前环境不支持保存更新源，请使用正式 Windows 客户端。");
      return;
    }
    setBusy(true);
    try {
      const result = await api.save_release_update_settings({
        updateCheckUrl: updateSourceDraft,
        autoCheckOnStartup: autoCheckOnStartup,
      });
      setManualUpdateStatus(result?.message || "更新源设置已保存。");
    } catch (error) {
      setManualUpdateStatus(`保存更新源失败：${error.message || error}`);
    } finally {
      setBusy(false);
    }
  }

  async function checkUpdateStatus() {
    const api = safeFileApi();
    setBusy(true);
    setManualUpdateStatus("正在检查更新...");
    try {
      if (api?.check_release_update) {
        if (api?.save_release_update_settings) {
          await api.save_release_update_settings({
            updateCheckUrl: updateSourceDraft,
            autoCheckOnStartup: autoCheckOnStartup,
          });
        }
        const status = await api.check_release_update();
        setLatestUpdateStatus(status);
        setManualUpdateStatus(status?.message || "检查更新完成。");
        await loadReleaseUpdateStatus();
        return;
      }

      const request = buildUpdateCheckRequest({ ...manifest, updateCheckUrl: updateUrl });
      if (!request.ok) {
        setLatestUpdateStatus(request);
        setManualUpdateStatus(request.message);
        return;
      }
      const response = await fetch(request.url, { cache: "no-store" });
      const latestManifest = await response.json();
      const status = buildUpdateCheckStatus({ ...manifest, updateCheckUrl: request.url }, latestManifest);
      setLatestUpdateStatus(status);
      setManualUpdateStatus(status.message);
    } catch (error) {
      const result = { ok: false, message: `检查更新失败：${error.message || error}` };
      setLatestUpdateStatus(result);
      setManualUpdateStatus(result.message);
    } finally {
      setBusy(false);
    }
  }

  function buildRuntimeHealthItems() {
    const logPath = runtime.toolLogDir || runtime.appDataRoot || "";
    const updateState = releaseUpdateStatus?.state || latestUpdateStatus?.state || "";
    const updateText = latestUpdateStatus?.state === "available"
      ? `发现新版本 ${latestUpdateStatus.latestVersion || ""}`.trim()
      : releaseUpdateStatus?.ok === false || latestUpdateStatus?.ok === false
        ? "更新检查异常"
        : updateState
          ? "更新状态已记录"
          : "尚未检查更新";
    return [
      { label: "客户端", value: clientModeText },
      { label: "窗口模式", value: consoleModeText },
      { label: "程序目录", value: executableDirectoryText },
      { label: "客户端入口", value: clientEntryText },
      { label: "脚本入口", value: launcherStatusText },
      { label: "启动诊断", value: startupDiagnosisText },
      { label: "WebView2", value: webView2Text },
      { label: "启动失败日志", value: startupFailureText },
      { label: "工具日志", value: logPath ? "目录可用" : "未检测到日志目录" },
      { label: "在线更新", value: updateText },
    ];
  }

  async function openRuntimeLogDirectory() {
    const api = safeFileApi();
    try {
      const path = api?.get_tool_log_dir ? await api.get_tool_log_dir() : runtime.toolLogDir || runtime.appDataRoot || "";
      if (!path) {
        setManualUpdateStatus("暂无可打开的日志目录。");
        return;
      }
      if (api?.open_path) {
        const result = await api.open_path(path);
        setManualUpdateStatus(result?.message || `日志目录已打开：${path}`);
        return;
      }
      setManualUpdateStatus(`日志目录：${path}`);
    } catch (error) {
      setManualUpdateStatus(`打开日志目录失败：${error.message || error}`);
    }
  }

  async function openStartupFailureLog() {
    const api = safeFileApi();
    if (!startupFailureLog.exists || !startupFailureLog.path) {
      setManualUpdateStatus("暂无启动失败日志。");
      return;
    }
    try {
      if (api?.open_path) {
        const result = await api?.open_path(startupFailureLog.path);
        setManualUpdateStatus(result?.message || `启动失败日志已打开：${startupFailureLog.path}`);
        return;
      }
      setManualUpdateStatus(`启动失败日志：${startupFailureLog.path}`);
    } catch (error) {
      setManualUpdateStatus(`打开启动失败日志失败：${error.message || error}`);
    }
  }

  async function openReleaseUpdaterLog() {
    const api = safeFileApi();
    if (!releaseUpdaterLogPath) {
      setManualUpdateStatus("暂无可打开的更新日志。");
      return;
    }
    try {
      if (api?.open_path) {
        const result = await api.open_path(releaseUpdaterLogPath);
        setManualUpdateStatus(result?.message || `更新日志已打开：${releaseUpdaterLogPath}`);
        return;
      }
      setManualUpdateStatus(`更新日志：${releaseUpdaterLogPath}`);
    } catch (error) {
      setManualUpdateStatus(`打开更新日志失败：${error.message || error}`);
    }
  }

  async function openDownloadedUpdatePackageDirectory() {
    const api = safeFileApi();
    if (!downloadedUpdatePackageDir) {
      setManualUpdateStatus("暂无可打开的更新包目录。");
      return;
    }
    try {
      if (api?.open_path) {
        const result = await api.open_path(downloadedUpdatePackageDir);
        setManualUpdateStatus(result?.message || `更新包目录已打开：${downloadedUpdatePackageDir}`);
        return;
      }
      setManualUpdateStatus(`更新包目录：${downloadedUpdatePackageDir}`);
    } catch (error) {
      setManualUpdateStatus(`打开更新包目录失败：${error.message || error}`);
    }
  }

  async function openDiagnosticPackageDirectory() {
    const result = await callReleaseApi("open_diagnostic_package_directory", "正在打开诊断包目录...");
    setManualUpdateStatus(result?.message || "诊断包目录已打开。");
  }

  async function exportRuntimeDiagnosticPackage() {
    const result = await callReleaseApi("export_diagnostic_package", "正在导出诊断包...");
    setManualUpdateStatus(formatDiagnosticPackageNotice(result));
  }

  async function copyReleaseInfo() {
    const text = buildReleaseDiagnosticsSummary(manifest, runtime, {
      recommendedClientText,
      clientModeText,
      consoleModeText,
      launcherStatusText,
      webView2Text,
    });
    try {
      await navigator.clipboard.writeText(text);
      setManualUpdateStatus("版本信息已复制。");
    } catch (error) {
      setManualUpdateStatus(`版本信息复制失败：${error.message || error}。请检查剪贴板权限，或改用“导出诊断包”。`);
    }
  }

  async function copyReleaseFingerprint() {
    const text = buildReleaseFingerprintText(manifest, runtime);
    try {
      await navigator.clipboard.writeText(text);
      setManualUpdateStatus("版本指纹已复制。");
    } catch (error) {
      setManualUpdateStatus(`版本指纹复制失败：${error.message || error}。请检查剪贴板权限，或改用“复制版本信息”。`);
    }
  }

  async function copyTroubleshootingInfo() {
    const text = buildSupportTroubleshootingText(manifest, runtime);
    try {
      await navigator.clipboard.writeText(text);
      setManualUpdateStatus("排查说明已复制。");
    } catch (error) {
      setManualUpdateStatus(`排查说明复制失败：${error.message || error}。请检查剪贴板权限，或改用“打开日志目录”。`);
    }
  }

  function openLatestPackageUrl() {
    if (!latestUpdateStatus?.packageUrl) {
      setManualUpdateStatus("暂无可打开的更新包下载地址。");
      return;
    }
    window.open(latestUpdateStatus.packageUrl, "_blank", "noopener,noreferrer");
  }

  async function copyLatestPackageUrl() {
    if (!latestUpdateStatus?.packageUrl) {
      setManualUpdateStatus("暂无可复制的更新包下载地址。");
      return;
    }
    await navigator.clipboard.writeText(latestUpdateStatus.packageUrl);
    setManualUpdateStatus("更新包下载地址已复制。");
  }

  async function copyReleaseUpdateStatus() {
    const text = [
      "SSH Agent 工具在线更新状态",
      `当前版本：${manifest.version || "dev"}`,
      `更新源：${updateUrl || "--"}`,
      `检查状态：${latestUpdateStatus?.state || "--"}`,
      `检查结果：${latestUpdateStatus?.message || "--"}`,
      `最新版本：${latestUpdateStatus?.latestVersion || "--"}`,
      `更新包：${latestUpdateStatus?.packageUrl || "--"}`,
      `本地更新包：${downloadedUpdatePackagePath || "--"}`,
      `期望 SHA256：${latestUpdateStatus?.expectedSha256 || latestUpdateStatus?.sha256 || latestUpdateStatus?.packageSha256 || "--"}`,
      `更新器状态：${releaseUpdateStatus?.state || "--"}`,
      `更新器消息：${releaseUpdateStatus?.message || "--"}`,
      `更新日志：${releaseUpdateStatus?.logPath || "--"}`,
      `更新状态文件：${releaseUpdateStatus?.statusPath || "--"}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setManualUpdateStatus("更新状态已复制。");
    } catch (error) {
      setManualUpdateStatus(`更新状态复制失败：${error.message || error}。请改用“复制版本信息”或“导出诊断包”。`);
    }
  }

  async function downloadLatestPackage() {
    const result = await callReleaseApi("download_release_update", "正在下载并校验更新包...");
    if (result?.localPath) {
      setLatestUpdateStatus(result);
      setManualUpdateStatus(result.nextActionLabel || result.message || "更新包已下载并校验。");
    }
    await loadReleaseUpdateStatus();
  }

  async function startDownloadedUpdateInstall() {
    const result = await callReleaseApi("start_release_update_install", "正在启动后台更新器...", {
      localPath: latestUpdateStatus?.localPath,
      expectedSha256: latestUpdateStatus?.expectedSha256 || latestUpdateStatus?.sha256 || latestUpdateStatus?.packageSha256,
      shutdownAfterStart: true,
    });
    setManualUpdateStatus(result?.message || "后台更新器已启动。当前工具会自动关闭，更新器会在后台运行并启动新版本。");
    await loadReleaseUpdateStatus();
  }

  async function createDesktopShortcut() {
    const result = await callReleaseApi("create_desktop_shortcut", "正在创建桌面快捷方式...");
    setManualUpdateStatus(result?.message || "桌面快捷方式已创建。");
  }

  async function createStartMenuShortcut() {
    const result = await callReleaseApi("create_start_menu_shortcut", "正在创建开始菜单快捷方式...");
    setManualUpdateStatus(result?.message || "开始菜单快捷方式已创建。");
  }

  async function openInstallDirectory() {
    const result = await callReleaseApi("open_install_directory", "正在打开安装目录...");
    setManualUpdateStatus(result?.message || "安装目录已打开。");
  }

  async function openCurrentExecutableDirectory() {
    const result = await callReleaseApi("open_current_executable_directory", "正在打开当前程序目录...");
    setManualUpdateStatus(result?.message || "当前程序目录已打开。");
  }

  async function copyCurrentExecutablePath() {
    if (!runtime.executable) {
      setManualUpdateStatus("暂无可复制的当前程序路径。");
      return;
    }
    await navigator.clipboard.writeText(runtime.executable);
    setManualUpdateStatus("当前程序路径已复制。");
  }

  async function openAppDataDirectory() {
    const result = await callReleaseApi("open_app_data_directory", "正在打开数据目录...");
    setManualUpdateStatus(result?.message || "数据目录已打开。");
  }

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="版本信息">
      <div className="settings-modal release-info-modal">
        <div className="modal-head">
          <div>
            <h2>{"版本信息"}</h2>
            <p>{"正式 Windows 客户端、在线更新和本机运行环境。"}</p>
          </div>
          <IconButton label="关闭" onClick={onClose}><X size={20} /></IconButton>
        </div>
        {releaseAssetWarning && (
          <div className="release-warning-panel" role="alert">
            <strong>{"检测到前端资源与版本清单不一致"}</strong>
            <p>{`当前可能正在运行旧解压目录或旧桌面快捷方式。请删除旧解压目录和旧桌面快捷方式，重新解压最新版 ZIP 后双击 ${recommendedClientEntry}。`}</p>
          </div>
        )}
        <div className="release-info-grid">
          <div><span>{"应用"}</span><strong>{manifest.appName || DEFAULT_RELEASE_MANIFEST.appName}</strong></div>
          <div><span>{"当前版本"}</span><strong>{manifest.version || "dev"}</strong></div>
          <div><span>{"发布包"}</span><strong>{manifest.packageName || "--"}</strong></div>
          <div><span>{"ZIP 文件"}</span><strong>{manifest.packageFile || "--"}</strong></div>
          <div><span>{"ZIP SHA256"}</span><strong>{packageShaText}</strong></div>
          <div><span>{"包地址"}</span><strong>{manifest.currentPackageUrl || "--"}</strong></div>
          <div><span>{"运行环境"}</span><strong>{runtime.executable || "--"}</strong></div>
          <div><span>{"程序目录"}</span><strong>{executableDirectoryText}</strong></div>
          <div><span>{"客户端模式"}</span><strong>{clientModeText}</strong></div>
          <div><span>{"窗口模式"}</span><strong>{consoleModeText}</strong></div>
          <div><span>{"启动身份"}</span><strong>{startupIdentityText}</strong></div>
          <div><span>{"运行前端资源"}</span><strong>{startupFrontendText}</strong></div>
          <div><span>{"运行前端资源 SHA"}</span><strong>{startupFrontendShaText}</strong></div>
          <div><span>{"清单前端资源"}</span><strong>{manifestFrontendText}</strong></div>
          <div><span>{"清单前端资源 SHA"}</span><strong>{manifestFrontendShaText}</strong></div>
          <div><span>{"资源一致"}</span><strong>{startupAssetMatchText}</strong></div>
          <div><span>{"日志目录"}</span><strong>{runtime.toolLogDir || runtime.appDataRoot || "--"}</strong></div>
          <div><span>{"启动失败日志"}</span><strong>{startupFailureLog.path || "--"}</strong></div>
          <div><span>WebView2</span><strong>{webView2Text}</strong></div>
          <div><span>{"更新源"}</span><strong>{updateUrl || "--"}</strong></div>
        </div>

        <div className="release-feature-list runtime-health-panel">
          <h3>{"正式客户端入口"}</h3>
          <ul>
            <li>{`推荐入口：${recommendedClientText}`}</li>
            <li>{`窗口模式：${consoleModeText}`}</li>
            <li>{`脚本入口：${launcherStatusText}`}</li>
          </ul>
        </div>

        <div className="release-feature-list runtime-health-panel">
          <h3>{"运行健康摘要"}</h3>
          <ul>
            {runtimeHealthItems.map((item) => <li key={item.label}>{`${item.label}：${item.value || "--"}`}</li>)}
          </ul>
          <div className="release-update-actions compact">
            <button type="button" onClick={openRuntimeLogDirectory} disabled={busy}>{"打开日志目录"}</button>
            <button type="button" onClick={openStartupFailureLog} disabled={busy || !startupFailureLog.exists}>{"打开启动失败日志"}</button>
            <button type="button" onClick={openDiagnosticPackageDirectory} disabled={busy}>{"打开诊断包目录"}</button>
            <button type="button" onClick={exportRuntimeDiagnosticPackage} disabled={busy}>{"导出诊断包"}</button>
          </div>
        </div>

        <div className="release-update-source">
          <label htmlFor="release-update-source">{"更新源"}</label>
          <input
            id="release-update-source"
            value={updateSourceDraft}
            onChange={(event) => setUpdateSourceDraft(event.target.value)}
            placeholder="https://updates.example.com/ssh-agent/latest.json"
          />
          <label className="release-update-toggle">
            <input type="checkbox" checked={autoCheckOnStartup} onChange={(event) => setAutoCheckOnStartup(event.target.checked)} />
            <span>{"启动时检查"}</span>
          </label>
          <button type="button" onClick={saveUpdateSourceSettings} disabled={busy}>{"保存更新源"}</button>
        </div>

        {statusText && (
          <div className={`settings-status release-update-status ${statusIsError ? "error" : ""}`}>
            <Info size={15} />
            <span>{statusText}</span>
          </div>
        )}

        <div className="release-update-actions">
          <button type="button" onClick={checkUpdateStatus} disabled={busy}>{"检查更新"}</button>
          <button type="button" onClick={openLatestPackageUrl} disabled={!latestUpdateStatus?.packageUrl}>{"下载更新包"}</button>
          <button type="button" onClick={copyLatestPackageUrl} disabled={!latestUpdateStatus?.packageUrl}>{"复制下载地址"}</button>
          <button type="button" onClick={downloadLatestPackage} disabled={busy}>{"下载并校验更新包"}</button>
          <button className="primary" type="button" onClick={startDownloadedUpdateInstall} disabled={busy || !latestUpdateStatus?.localPath}>{"安装并重启"}</button>
          <button type="button" onClick={copyReleaseInfo}>{"复制版本信息"}</button>
          <button type="button" onClick={copyReleaseFingerprint}>{"复制版本指纹"}</button>
          <button type="button" onClick={copyTroubleshootingInfo}>{"复制排查说明"}</button>
          <button type="button" onClick={createDesktopShortcut} disabled={busy}>{"创建桌面快捷方式"}</button>
          <button type="button" onClick={createStartMenuShortcut} disabled={busy}>{"创建开始菜单快捷方式"}</button>
          <button type="button" onClick={copyCurrentExecutablePath}>{"复制当前程序路径"}</button>
          <button type="button" onClick={openCurrentExecutableDirectory} disabled={busy}>{"打开当前程序目录"}</button>
          <button type="button" onClick={openInstallDirectory} disabled={busy}>{"打开安装目录"}</button>
          <button type="button" onClick={openAppDataDirectory} disabled={busy}>{"打开数据目录"}</button>
          <button type="button" onClick={openDownloadedUpdatePackageDirectory} disabled={busy || !downloadedUpdatePackageDir}>{"打开更新包目录"}</button>
          <button type="button" onClick={openReleaseUpdaterLog} disabled={busy || !releaseUpdaterLogPath}>{"打开更新日志"}</button>
        </div>

        {(latestUpdateStatus?.packageUrl || latestUpdateStatus?.releaseNotesUrl || releaseUpdateStatus?.statusPath || releaseUpdateStatus?.logPath) && (
          <div className="release-feature-list">
            <div className="release-feature-head">
              <h3>{"更新状态"}</h3>
              <button type="button" onClick={copyReleaseUpdateStatus}>{"复制更新状态"}</button>
            </div>
            <ul>
              {latestUpdateStatus?.packageUrl && <li>{`更新包：${latestUpdateStatus.packageUrl}`}</li>}
              {downloadedUpdatePackagePath && <li>{`本地更新包：${downloadedUpdatePackagePath}`}</li>}
              {latestUpdateStatus?.releaseNotesUrl && <li>{`更新说明：${latestUpdateStatus.releaseNotesUrl}`}</li>}
              {releaseUpdateStatus?.updatedAt && <li>{`最近更新器状态：${releaseUpdateStatus.updatedAt}`}</li>}
              {releaseUpdateStatus?.logPath && <li>{`更新日志：${releaseUpdateStatus.logPath}`}</li>}
              {releaseUpdateStatus?.statusPath && <li>{`更新状态文件：${releaseUpdateStatus.statusPath}`}</li>}
            </ul>
          </div>
        )}

        <div className="release-feature-list">
          <h3>{"常用快捷键"}</h3>
          <ul>
            <li>{"Ctrl+C 中断远程命令，Ctrl+D 发送 EOF，Ctrl+L 清屏。"}</li>
            <li>{"Ctrl+B / Ctrl+F 左右移动一个字符，Ctrl+U 删除光标前内容，Ctrl+K 删除光标后内容，Ctrl+W 删除前一个单词，Ctrl+Y 粘回刚删除的内容，Ctrl+G 取消远端搜索或编辑状态，Ctrl+Backspace / Ctrl+Delete 直通远端词删除。"}</li>
            <li>{"Ctrl+Z 挂起前台程序，Ctrl+\\ 强制退出部分前台程序；这些按键会直通当前 SSH 会话。"}</li>
            <li>{"Ctrl+S 暂停远程终端输出，Ctrl+Q 恢复远程终端输出；误按 Ctrl+S 后可用 Ctrl+Q 恢复。"}</li>
            <li>{"Alt+Left / Alt+Right、Ctrl+Left / Ctrl+Right 会直通远端 SSH，用于 Shell 或 TUI 程序内按单词移动。"}</li>
            <li>{"Ctrl+Shift+B 打开/关闭左侧栏，Ctrl+Shift+G 打开工具日志。"}</li>
            <li>{"终端、服务器和 SFTP 均提供右键菜单。"}</li>
            <li>{"当前工具会自动关闭，更新器会在后台运行并启动新版本。"}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
function BackupExportModal({ servers, scopeLabel = "", agentCapabilities, portForwardPresets, commandSnippets, modelConfig, modelProfiles, backupHistory, onBackupExported, onRemoveBackupHistory, onClearBackupHistory, onClose, onNotice }) {
  const [masterPassword, setMasterPassword] = useState("");
  const [masterPasswordConfirm, setMasterPasswordConfirm] = useState("");
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const scope = { hosts: true, sftp: true, skills: true, mcp: true, cli: true, secrets: includeSecrets, modelProfiles: true, commandSnippets: true, portForwards: true };
  const preview = buildBackupExportPreview({ servers, scope, agentCapabilities, portForwardPresets, commandSnippets, modelConfig, modelProfiles });
  const centerModel = buildBackupCenterModel(preview, { historyCount: Array.isArray(backupHistory) ? backupHistory.length : 0 });
  const credentialMatrix = buildBackupCredentialMatrix(servers, { includeSecrets });

  async function exportBackup() {
    const api = safeFileApi();
    try {
      const passwordCheck = validateBackupMasterPassword(masterPassword, masterPasswordConfirm, includeSecrets);
      if (!passwordCheck.valid) {
        onNotice?.(passwordCheck.message);
        return;
      }
      const exportedPayload = buildBackupPayload({
        servers,
        scope,
        agentCapabilities,
        portForwardPresets,
        commandSnippets,
        modelConfig,
        modelProfiles,
        exportedAt: new Date().toISOString(),
      });
      const fileName = buildBackupFileName(exportedPayload);
      let targetPath = "";
      let exportResult = null;
      if (api?.export_backup_file) {
        targetPath = api.pick_download_target ? await api.pick_download_target(fileName) : "";
        if (!targetPath) return;
        exportResult = await api.export_backup_file(servers, scope, masterPassword, targetPath, agentCapabilities, portForwardPresets, commandSnippets, modelConfig, modelProfiles);
      } else if (api?.save_text_file) {
        targetPath = await api.save_text_file(fileName, JSON.stringify(exportedPayload, null, 2));
      } else {
        targetPath = saveTextFileFromBrowser(fileName, JSON.stringify(exportedPayload, null, 2), "application/json;charset=utf-8");
      }
      const historyEntry = buildBackupHistoryEntry({ payload: exportedPayload, target: targetPath || fileName, scope, exportResult });
      const hashText = historyEntry.sha256 ? `（SHA256：${historyEntry.sha256.slice(0, 12)}...）` : "";
      onBackupExported?.(historyEntry);
      onNotice?.(targetPath ? `备份已导出：${targetPath}${hashText}` : `备份已导出${hashText}`);
    } catch (error) {
      onNotice?.(sanitizeFrontendRuntimeError(error) || String(error?.message || error));
    }
  }

  async function exportInventoryCsv() {
    const content = buildServerInventoryCsv(servers, { exportedAt: new Date().toISOString() });
    const fileName = "ssh-agent-server-inventory.csv";
    const api = safeFileApi();
    const target = api?.save_text_file
      ? await api.save_text_file(fileName, content)
      : saveTextFileFromBrowser(fileName, content, "text/csv;charset=utf-8");
    onNotice?.(target ? `服务器清单已导出：${target}` : "服务器清单已导出");
  }

  async function exportOpenSshConfig() {
    const content = buildOpenSshConfigExport(servers, { exportedAt: new Date().toISOString() });
    const fileName = "ssh-agent-openssh-config.txt";
    const api = safeFileApi();
    const target = api?.save_text_file
      ? await api.save_text_file(fileName, content)
      : saveTextFileFromBrowser(fileName, content);
    onNotice?.(target ? `OpenSSH Config 已导出：${target}` : "OpenSSH Config 已导出");
  }

  async function copyCredentialChecklist() {
    const content = buildBackupCredentialChecklistText(servers, { includeSecrets, matrix: credentialMatrix, exportedAt: new Date().toISOString() });
    try {
      await navigator.clipboard?.writeText?.(content);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = content;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    onNotice?.("凭据迁移清单已复制");
  }

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="\u5907\u4efd\u5bfc\u51fa">
      <div className="settings-modal backup-center-modal">
        <div className="modal-head"><div><h2>{scopeLabel ? `备份导出 - ${scopeLabel}` : "备份导出"}</h2><p>{centerModel.summary}</p></div><IconButton label="关闭" onClick={onClose}><X size={20} /></IconButton></div>
        <label className="settings-check"><input type="checkbox" checked={includeSecrets} onChange={(event) => setIncludeSecrets(event.target.checked)} />{"加密导出密码、私钥和敏感 Header"}</label>
        {includeSecrets && (
          <div className="settings-grid two">
            <label><span>{"备份主密码"}</span><input value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} type="password" placeholder="备份主密码" /></label>
            <label><span>{"确认主密码"}</span><input value={masterPasswordConfirm} onChange={(event) => setMasterPasswordConfirm(event.target.value)} type="password" placeholder="确认备份主密码" /></label>
          </div>
        )}
        <div className="release-grid">
          {(preview.stats || []).map((item) => <><span key={`${item.label}-label`}>{item.label}</span><strong key={item.label}>{item.value}</strong></>)}
        </div>
        <div className="backup-credential-matrix">
          <div className="backup-credential-head">
            <div>
              <strong>{"凭据覆盖"}</strong>
              <p>{credentialMatrix.note}</p>
            </div>
            <button type="button" onClick={copyCredentialChecklist}>{"复制凭据清单"}</button>
          </div>
          <div className="backup-credential-summary">
            <span>{"总数"}<strong>{credentialMatrix.summary.total}</strong></span>
            <span>{"可加密恢复"}<strong>{credentialMatrix.summary.encryptedReady}</strong></span>
            <span>{"私钥路径"}<strong>{credentialMatrix.summary.pathOnly}</strong></span>
            <span>{"SSH Agent"}<strong>{credentialMatrix.summary.sshAgent}</strong></span>
            <span>{"需补录"}<strong>{credentialMatrix.summary.missing}</strong></span>
          </div>
          <div className="backup-credential-table">
            {credentialMatrix.rows.slice(0, 6).map((row) => (
              <div className="backup-credential-row" key={row.name}>
                <span>
                  <strong>{row.name}</strong>
                  <small>{row.address || "--"}</small>
                </span>
                <em className={row.tone}>{row.restoreMode}</em>
                <p>{row.manualAction}</p>
              </div>
            ))}
          </div>
          {credentialMatrix.rows.length > 6 && <p className="backup-credential-more">{`另有 ${credentialMatrix.rows.length - 6} 台服务器，导出清单 CSV 可查看完整覆盖情况。`}</p>}
        </div>
        <div className="backup-export-card-grid">
          {centerModel.exportCards.map((card) => (
            <button className={card.primary ? "backup-export-card primary" : "backup-export-card"} type="button" key={card.id} onClick={card.id === "backup-json" ? exportBackup : card.id === "inventory-csv" ? exportInventoryCsv : exportOpenSshConfig}>
              <strong>{card.title}</strong>
              <span>{card.description}</span>
              <em>{card.actionLabel}</em>
            </button>
          ))}
        </div>
        {Array.isArray(backupHistory) && backupHistory.length > 0 && (
          <div className="simple-list compact">
            <strong>{"最近备份"}</strong>
            {backupHistory.slice(0, 4).map((item) => (
              <div key={item.id}>
                <span>{item.fileName || item.target || item.exportedAt}{item.sha256 ? <small>{`SHA256 ${item.sha256.slice(0, 12)}...`}</small> : null}</span>
                <button type="button" onClick={() => onRemoveBackupHistory?.(item.id)}>{"移除"}</button>
              </div>
            ))}
            <button type="button" onClick={onClearBackupHistory}>{"清空历史"}</button>
          </div>
        )}
        <div className="modal-actions"><button type="button" onClick={onClose}>{"关闭"}</button></div>
      </div>
    </div>
  );
}

function BackupImportModal({ preview, onClose, onConfirm }) {
  const [restoreSecrets, setRestoreSecrets] = useState(false);
  const [masterPassword, setMasterPassword] = useState("");
  const summary = preview?.summary || preview || {};
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="\u5bfc\u5165\u5907\u4efd">
      <div className="settings-modal">
        <div className="modal-head"><div><h2>{"\u5bfc\u5165\u5907\u4efd"}</h2><p>{"\u9884\u89c8\u5907\u4efd\u5185\u5bb9\uff0c\u786e\u8ba4\u540e\u5c06\u5408\u5e76\u5230\u5f53\u524d\u914d\u7f6e\u3002"}</p></div><IconButton label="\u5173\u95ed" onClick={onClose}><X size={20} /></IconButton></div>
        <div className="release-grid"><span>{"\u670d\u52a1\u5668"}</span><strong>{summary.hosts || summary.serverCount || 0}</strong><span>{"Agent \u80fd\u529b"}</span><strong>{summary.agentCapabilities || 0}</strong><span>{"\u6a21\u578b API"}</span><strong>{summary.modelProfiles || 0}</strong></div>
        <label className="settings-check"><input type="checkbox" checked={restoreSecrets} onChange={(event) => setRestoreSecrets(event.target.checked)} />{"\u540c\u65f6\u6062\u590d\u52a0\u5bc6\u51ed\u636e"}</label>
        {restoreSecrets && <input value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} type="password" placeholder="\u5907\u4efd\u4e3b\u5bc6\u7801" />}
        <div className="modal-actions"><button type="button" onClick={onClose}>{"\u53d6\u6d88"}</button><button className="primary-button" type="button" onClick={() => onConfirm?.({ restoreSecrets, masterPassword, importScope: "merge" })}>{"\u786e\u8ba4\u5bfc\u5165"}</button></div>
      </div>
    </div>
  );
}

function PortForwardModal({ serverName, server, forwards, presets, busy, operationStatus, onStart, onStop, onRefresh, onSavePreset, onDeletePreset, onCopyLocalUrl, onClose }) {
  const [localPort, setLocalPort] = useState("8080");
  const [remoteHost, setRemoteHost] = useState("127.0.0.1");
  const [remotePort, setRemotePort] = useState("80");
  const config = { serverName, localPort: Number(localPort), remoteHost, remotePort: Number(remotePort) };
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="\u7aef\u53e3\u8f6c\u53d1">
      <div className="settings-modal">
        <div className="modal-head"><div><h2>{"\u7aef\u53e3\u8f6c\u53d1"}</h2><p>{serverName}</p></div><IconButton label="\u5173\u95ed" onClick={onClose}><X size={20} /></IconButton></div>
        <div className="settings-grid three"><label><span>{"\u672c\u5730\u7aef\u53e3"}</span><input value={localPort} onChange={(event) => setLocalPort(event.target.value)} /></label><label><span>{"\u8fdc\u7a0b\u5730\u5740"}</span><input value={remoteHost} onChange={(event) => setRemoteHost(event.target.value)} /></label><label><span>{"\u8fdc\u7a0b\u7aef\u53e3"}</span><input value={remotePort} onChange={(event) => setRemotePort(event.target.value)} /></label></div>
        <div className="modal-actions"><button type="button" onClick={onRefresh} disabled={busy}>{"\u5237\u65b0"}</button><button type="button" onClick={() => onSavePreset?.(config)}>{"\u4fdd\u5b58\u9884\u8bbe"}</button><button className="primary-button" type="button" onClick={() => onStart?.(config)} disabled={busy}>{"\u542f\u52a8\u8f6c\u53d1"}</button></div>
        {operationStatus && <div className="settings-status"><Info size={15} /><span>{operationStatus.message || operationStatus}</span></div>}
        <div className="simple-list">{(forwards || []).map((item) => <div key={item.id || item.localPort}><span>{buildPortForwardLocalUrl(item)}</span><button type="button" onClick={() => onCopyLocalUrl?.(item)}>{"\u590d\u5236"}</button><button type="button" onClick={() => onStop?.(item.id || item)}>{"\u505c\u6b62"}</button></div>)}</div>
      </div>
    </div>
  );
}

function SessionLogModal({ servers, filters, entries, total, root, busy, onFiltersChange, onRefresh, onExport, onOpenDir, onDeleteOldLogs, onClose }) {
  const serverNames = Object.keys(servers || {});
  const failureKinds = ["transport", "auth", "network", "timeout", "host-key", "key-file", "agent-auth", "config", "environment", "input", "unknown"];
  const filterBar = (
    <div className="settings-grid log-filter-grid">
      <label><span>{"\u670d\u52a1\u5668"}</span><select value={filters.server || ""} onChange={(event) => onFiltersChange({ ...filters, server: event.target.value })}><option value="">{"\u5168\u90e8\u670d\u52a1\u5668"}</option>{serverNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label><span>{"\u7c7b\u578b"}</span><select value={filters.type || ""} onChange={(event) => onFiltersChange({ ...filters, type: event.target.value })}><option value="">{"\u5168\u90e8\u7c7b\u578b"}</option><option value="command">command</option><option value="command_failed">command_failed</option><option value="output">output</option><option value="output_failed">output_failed</option><option value="session_open">session_open</option><option value="session_open_failed">session_open_failed</option><option value="session_close">session_close</option></select></label>
      <label><span>{"\u72b6\u6001"}</span><select value={filters.status || ""} onChange={(event) => onFiltersChange({ ...filters, status: event.target.value })}><option value="">{"\u5168\u90e8\u72b6\u6001"}</option><option value="ok">ok</option><option value="failed">failed</option><option value="sent">sent</option><option value="blocked">blocked</option></select></label>
      <label><span>{"\u5931\u8d25\u7c7b\u578b"}</span><select value={filters.failureKind || ""} onChange={(event) => onFiltersChange({ ...filters, failureKind: event.target.value })}><option value="">{"\u5168\u90e8\u5931\u8d25\u7c7b\u578b"}</option>{failureKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
      <label><span>{"\u5173\u952e\u5b57"}</span><input value={filters.query || ""} onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })} placeholder="\u641c\u7d22\u547d\u4ee4\u3001\u8f93\u51fa\u6216\u5931\u8d25\u7c7b\u578b" /></label>
    </div>
  );
  return <LogListModal title="\u4f1a\u8bdd\u65e5\u5fd7" entries={entries} total={total} root={root} busy={busy} onRefresh={() => onRefresh(filters)} onExport={onExport} onOpenDir={onOpenDir} onDeleteOldLogs={onDeleteOldLogs} onClose={onClose} filterBar={filterBar} />;
}

function ToolLogModal({ filters, entries, total, root, busy, onFiltersChange, onRefresh, onExport, onOpenDir, onDeleteOldLogs, onClose }) {
  return <LogListModal title="\u5de5\u5177\u65e5\u5fd7" entries={entries} total={total} root={root} busy={busy} onRefresh={onRefresh} onExport={onExport} onOpenDir={onOpenDir} onDeleteOldLogs={onDeleteOldLogs} onClose={onClose} />;
}

function formatLogEntryPreview(entry) {
  const item = entry && typeof entry === "object" ? entry : {};
  const failureKindLabel = "\u5931\u8d25\u7c7b\u578b";
  const failureKind = entry?.failureKind || item.failureKind;
  const meta = [
    item.createdAt,
    item.server,
    item.type,
    item.status,
    failureKind ? `${failureKindLabel}: ${failureKind}` : "",
    item.sessionId,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const body = String(item.message || item.text || item.command || item.output || "").trim();
  const fallback = Object.keys(item).length ? JSON.stringify(item) : "";
  return [meta.join(" / "), body || fallback].filter(Boolean).join("\n");
}

function LogListModal({ title, entries = [], total = 0, root = "", busy, onRefresh, onExport, onOpenDir, onDeleteOldLogs, onClose, filterBar = null }) {
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="settings-modal log-modal">
        <div className="modal-head"><div><h2>{title}</h2><p>{root || "--"}</p></div><IconButton label="\u5173\u95ed" onClick={onClose}><X size={20} /></IconButton></div>
        <div className="modal-actions"><button type="button" onClick={onRefresh} disabled={busy}>{"\u5237\u65b0"}</button><button type="button" onClick={onExport}>{"\u5bfc\u51fa"}</button><button type="button" onClick={onOpenDir}>{"\u6253\u5f00\u76ee\u5f55"}</button><button type="button" onClick={onDeleteOldLogs}>{"\u6e05\u7406\u65e7\u65e5\u5fd7"}</button></div>
        {filterBar}
        <div className="simple-list"><strong>{`\u5171 ${total || entries.length} \u6761`}</strong>{entries.slice(0, 80).map((entry, index) => <pre key={entry.id || index}>{formatLogEntryPreview(entry)}</pre>)}</div>
      </div>
    </div>
  );
}

function BatchEditServersModal({ targetNames, customServers, onSave, onClose }) {
  const [group, setGroup] = useState("");
  const [tags, setTags] = useState("");
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="\u6279\u91cf\u7f16\u8f91">
      <div className="settings-modal"><div className="modal-head"><div><h2>{"\u6279\u91cf\u7f16\u8f91"}</h2><p>{`${(targetNames || []).length} \u53f0\u670d\u52a1\u5668`}</p></div><IconButton label="\u5173\u95ed" onClick={onClose}><X size={20} /></IconButton></div><div className="settings-grid two"><label><span>{"\u5206\u7ec4"}</span><input value={group} onChange={(event) => setGroup(event.target.value)} /></label><label><span>{"\u6807\u7b7e"}</span><input value={tags} onChange={(event) => setTags(event.target.value)} /></label></div><div className="modal-actions"><button type="button" onClick={onClose}>{"\u53d6\u6d88"}</button><button className="primary-button" type="button" onClick={() => onSave?.({ group, tags: tags.split(/[?,]/).map((item) => item.trim()).filter(Boolean) })}>{"\u4fdd\u5b58"}</button></div></div>
    </div>
  );
}

function AuthCenterModal({ serverName, server, onEdit, onTestConnection, onRemoveCredential, isTesting, onClose }) {
  const authModel = buildAuthCenterModel(serverName, server || {});
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={authModel.title}>
      <div className="settings-modal auth-center-modal">
        <div className="modal-head"><div><h2>{authModel.title}</h2><p>{"\u8865\u5f55\u6216\u66f4\u6362\u5bc6\u7801\u3001\u79c1\u94a5\u3001SSH Agent \u548c ProxyJump \u914d\u7f6e\u3002"}</p></div><IconButton label="\u5173\u95ed" onClick={onClose}><X size={20} /></IconButton></div>
        <div className={`auth-status-card ${authModel.status?.tone || "amber"}`}><ShieldCheck size={18} /><div><strong>{authModel.status?.label || "--"}</strong><span>{authModel.ready ? "\u5df2\u5177\u5907 SSH \u8fde\u63a5\u6240\u9700\u8ba4\u8bc1" : "\u9700\u5148\u8865\u5168\u8ba4\u8bc1\u540e\u518d\u8fde\u63a5"}</span></div></div>
        <div className="auth-summary-grid">
          {authModel.summaryItems.map((item) => (
            <div className="auth-summary-item" key={item.label}>
              <span>{item.label}</span>
              <strong className={`auth-summary-value ${item.tone || ""}`}>{item.value || "--"}</strong>
            </div>
          ))}
        </div>
        <div className="auth-guidance">
          <strong>{"\u8ba4\u8bc1\u4fee\u590d\u5efa\u8bae"}</strong>
          <ul>
            {authModel.guidance.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="modal-actions auth-center-actions"><button className="primary-button" type="button" onClick={onEdit}>{authModel.primaryAction.label}</button><button type="button" onClick={onTestConnection} disabled={isTesting}>{isTesting ? "\u6d4b\u8bd5\u4e2d..." : authModel.secondaryAction.label}</button><button type="button" onClick={onRemoveCredential}>{"\u79fb\u9664\u672c\u673a\u51ed\u636e"}</button></div>
      </div>
    </div>
  );
}

function NewHostModal({ existingNames, onSave, onClose, initialForm = null, mode = "create", onDelete, onTestConnection }) {
  const [form, setForm] = useState(() => {
    const draft = { name: "", group: "\u751f\u4ea7\u73af\u5883", host: "", ip: "", port: 22, user: "root", authType: "密码", password: "", identityFile: "", proxyJump: "", hostKeyAlias: "", forwardAgent: false, timeoutSeconds: "10", retryCount: "0", keepaliveSeconds: "30", keepaliveCountMax: "3", cwd: "", note: "", tags: "", ...(initialForm || {}) };
    return { ...draft, authType: normalizeServerAuthType(draft.authType) };
  });
  const [testingHostConnection, setTestingHostConnection] = useState(false);
  const [hostTestStatus, setHostTestStatus] = useState(null);
  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setHostTestStatus(null);
  }
  function validateHostDraft() {
    return validateServerConnectionForm(form, existingNames || [], initialForm?.name || "");
  }
  async function testHostBeforeSave() {
    const validation = validateHostDraft();
    if (!validation.ok) {
      setHostTestStatus({ ok: false, message: validation.message || "服务器配置不完整" });
      return;
    }
    setTestingHostConnection(true);
    setHostTestStatus({ ok: null, message: "正在测试连接..." });
    try {
      const result = await onTestConnection?.(form);
      const ok = Boolean(result?.ok);
      setHostTestStatus({
        ok,
        message: `${ok ? "连接测试通过" : "连接测试失败"}：${result?.message || (ok ? "SSH 登录验证成功。" : "未返回具体失败原因。")}`,
      });
    } catch (error) {
      setHostTestStatus({ ok: false, message: `连接测试失败：${error.message || error}` });
    } finally {
      setTestingHostConnection(false);
    }
  }
  function save() {
    const validation = validateHostDraft();
    if (!validation.ok) {
      setHostTestStatus({ ok: false, message: validation.message || "服务器配置不完整" });
      return;
    }
    onSave?.({ ...form, port: Number(form.port || 22), tags: Array.isArray(form.tags) ? form.tags : String(form.tags || "").split(/[?,]/).map((item) => item.trim()).filter(Boolean) });
  }
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={mode === "edit" ? "\u7f16\u8f91\u8fde\u63a5" : "\u65b0\u5efa\u8fde\u63a5"}>
      <div className="settings-modal host-modal">
        <div className="modal-head"><div><h2>{mode === "edit" ? "\u7f16\u8f91\u8fde\u63a5" : "\u65b0\u5efa\u8fde\u63a5"}</h2><p>{"\u586b\u5199 SSH \u8fde\u63a5\u4fe1\u606f\uff0c\u4fdd\u5b58\u540e\u53ef\u76f4\u63a5\u6253\u5f00\u7ec8\u7aef\u3002"}</p></div><IconButton label="\u5173\u95ed" onClick={onClose}><X size={20} /></IconButton></div>
        <div className="settings-grid two"><label><span>{"\u540d\u79f0"}</span><input value={form.name} onChange={(event) => update("name", event.target.value)} /></label><label><span>{"\u5206\u7ec4"}</span><input value={form.group} onChange={(event) => update("group", event.target.value)} /></label><label><span>Host / IP</span><input value={form.host || form.ip} onChange={(event) => { update("host", event.target.value); update("ip", event.target.value); }} /></label><label><span>{"\u7aef\u53e3"}</span><input value={form.port} onChange={(event) => update("port", event.target.value)} /></label><label><span>{"\u7528\u6237"}</span><input value={form.user} onChange={(event) => update("user", event.target.value)} /></label><label><span>{"\u6807\u7b7e"}</span><input value={Array.isArray(form.tags) ? form.tags.join(",") : form.tags} onChange={(event) => update("tags", event.target.value)} /></label></div>
        <div className="settings-grid two"><label><span>{"\u9ed8\u8ba4\u76ee\u5f55"}</span><input value={form.cwd || ""} onChange={(event) => update("cwd", event.target.value)} placeholder="/home/root" /></label><label><span>{"\u5907\u6ce8"}</span><input value={form.note || ""} onChange={(event) => update("note", event.target.value)} placeholder="\u7528\u9014\u3001\u4e1a\u52a1\u6216\u8fd0\u7ef4\u63d0\u793a" /></label></div>
        <div className="settings-grid two"><label><span>{"\u8ba4\u8bc1\u65b9\u5f0f"}</span><select value={form.authType} onChange={(event) => update("authType", normalizeServerAuthType(event.target.value))}><option value="密码">密码</option><option value="私钥">私钥</option><option value="SSH Agent">SSH Agent</option></select></label>{form.authType === "私钥" ? <label><span>{"\u79c1\u94a5\u8def\u5f84"}</span><input value={form.identityFile || ""} onChange={(event) => update("identityFile", event.target.value)} /></label> : form.authType === "SSH Agent" ? <label><span>{"\u8ba4\u8bc1\u8bf4\u660e"}</span><input value="使用本机 OpenSSH Agent 中已加载的私钥" readOnly /></label> : <label><span>{"\u5bc6\u7801"}</span><input type="password" value={form.password || ""} onChange={(event) => update("password", event.target.value)} /></label>}</div>
        <div className="settings-grid two"><label><span>ProxyJump</span><input value={form.proxyJump || ""} onChange={(event) => update("proxyJump", event.target.value)} placeholder="user@jump-host:22" /></label><label><span>HostKeyAlias</span><input value={form.hostKeyAlias || ""} onChange={(event) => update("hostKeyAlias", event.target.value)} placeholder="known_hosts alias" /></label><label><span>ForwardAgent</span><input type="checkbox" checked={!!form.forwardAgent} onChange={(event) => update("forwardAgent", event.target.checked)} /></label></div>
        <div className="settings-grid two"><label><span>{"\u8fde\u63a5\u8d85\u65f6(\u79d2)"}</span><input value={form.timeoutSeconds || "10"} onChange={(event) => update("timeoutSeconds", event.target.value)} /></label><label><span>{"\u91cd\u8bd5\u6b21\u6570"}</span><input value={form.retryCount || "0"} onChange={(event) => update("retryCount", event.target.value)} /></label><label><span>{"\u4fdd\u6d3b\u95f4\u9694(\u79d2)"}</span><input value={form.keepaliveSeconds || "30"} onChange={(event) => update("keepaliveSeconds", event.target.value)} /></label><label><span>ServerAliveCountMax</span><input value={form.keepaliveCountMax || "3"} onChange={(event) => update("keepaliveCountMax", event.target.value)} /></label></div>
        {hostTestStatus && <div className={`settings-status host-test-status ${hostTestStatus.ok === false ? "error" : ""}`}><Info size={15} /><span>{hostTestStatus.message}</span></div>}
        <div className="modal-actions">{mode === "edit" && <button type="button" onClick={onDelete}>{"\u5220\u9664"}</button>}<button type="button" onClick={testHostBeforeSave} disabled={testingHostConnection}>{testingHostConnection ? "\u6d4b\u8bd5\u4e2d..." : "\u4fdd\u5b58\u524d\u6d4b\u8bd5"}</button><button type="button" onClick={onClose}>{"\u53d6\u6d88"}</button><button className="primary-button" type="button" onClick={save}>{"\u4fdd\u5b58"}</button></div>
      </div>
    </div>
  );
}
export function App() {
  const [selectedServer, setSelectedServer] = useState("prod-web-01");
  const [selectedTerminalTabId, setSelectedTerminalTabId] = useState("prod-web-01");
  const [terminalTabs, setTerminalTabs] = useState(() => readLocalJson("sshAgentTerminalTabs", ["prod-web-01"]));
  const [recentlyClosedTerminalTabs, setRecentlyClosedTerminalTabs] = useState([]);
  const [terminalSearchFocusRequest, setTerminalSearchFocusRequest] = useState({ tick: 0, query: "" });
  const [selectedFile, setSelectedFile] = useState(SERVER_DATA["prod-web-01"].files[0]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolSettingsOpen, setToolSettingsOpen] = useState(false);
  const [releaseInfoOpen, setReleaseInfoOpen] = useState(false);
  const [releaseInfoAutoCheckNonce, setReleaseInfoAutoCheckNonce] = useState(0);
  const [releaseManifest, setReleaseManifest] = useState(DEFAULT_RELEASE_MANIFEST);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState(null);
  const [newHostOpen, setNewHostOpen] = useState(false);
  const [newHostInitialForm, setNewHostInitialForm] = useState(null);
  const [editHostOpen, setEditHostOpen] = useState(false);
  const [authCenterOpen, setAuthCenterOpen] = useState(false);
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [batchEditNames, setBatchEditNames] = useState([]);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupServerName, setBackupServerName] = useState("");
  const [backupHistory, setBackupHistory] = useState(() => readLocalJson("sshAgentBackupHistory", []));
  const [backupImportDraft, setBackupImportDraft] = useState(null);
  const [importFollowup, setImportFollowup] = useState(null);
  const [portForwardOpen, setPortForwardOpen] = useState(false);
  const [portForwardBusy, setPortForwardBusy] = useState(false);
  const [portForwards, setPortForwards] = useState([]);
  const [portForwardOperation, setPortForwardOperation] = useState(null);
  const [portForwardPresets, setPortForwardPresets] = useState(() => readLocalJson("sshAgentPortForwardPresets", []));
  const [sessionLogsOpen, setSessionLogsOpen] = useState(false);
  const [sessionLogsBusy, setSessionLogsBusy] = useState(false);
  const [sessionLogFilters, setSessionLogFilters] = useState({ server: "", query: "", type: "", status: "", failureKind: "" });
  const [sessionLogEntries, setSessionLogEntries] = useState([]);
  const [sessionLogTotal, setSessionLogTotal] = useState(0);
  const [sessionLogRoot, setSessionLogRoot] = useState("");
  const [toolLogsOpen, setToolLogsOpen] = useState(false);
  const [toolLogsBusy, setToolLogsBusy] = useState(false);
  const [toolLogFilters, setToolLogFilters] = useState({ component: "", level: "", query: "" });
  const [toolLogEntries, setToolLogEntries] = useState([]);
  const [toolLogTotal, setToolLogTotal] = useState(0);
  const [toolLogRoot, setToolLogRoot] = useState("");
  const [notice, setNotice] = useState("");
  const [connectionOverrides, setConnectionOverrides] = useState({});
  const [testingConnections, setTestingConnections] = useState({});
  const [readingBasicInfo, setReadingBasicInfo] = useState({});
  const [sshSmokeTesting, setSshSmokeTesting] = useState({});
  const [latestSshSmokeTest, setLatestSshSmokeTest] = useState(null);
  const [batchBusy, setBatchBusy] = useState({ connect: false, disconnect: false, reconnect: false, test: false, basic: false, agent: false });
  const [latestConnectionCheck, setLatestConnectionCheck] = useState(null);
  const [sftpBusy, setSftpBusy] = useState({});
  const [sftpOverrides, setSftpOverrides] = useState({});
  const [sftpPaths, setSftpPaths] = useState({});
  const [sftpPreview, setSftpPreview] = useState(null);
  const [sftpPreviewDraft, setSftpPreviewDraft] = useState("");
  const [recentSftpOperations, setRecentSftpOperations] = useState({});
  const autoSftpRefreshRef = useRef(new Set());
  const startupUpdateCheckRef = useRef(false);
  const [terminalAppends, setTerminalAppends] = useState({});
  const terminalOpenLineRef = useRef({});
  const [terminalClearMarkers, setTerminalClearMarkers] = useState({});
  const [sshSessions, setSshSessions] = useState({});
  const [sessionWorkingDirectories, setSessionWorkingDirectories] = useState({});
  const [commandInputs, setCommandInputs] = useState({});
  const [commandKillBuffers, setCommandKillBuffers] = useState({});
  const [commandHistories, setCommandHistories] = useState(() => readStoredCommandHistories());
  const [customCommandSnippets, setCustomCommandSnippets] = useState(() => readLocalJson("sshAgentCustomCommandSnippets", []));
  const [historyCursors, setHistoryCursors] = useState({});
  const [terminalFontSize, setTerminalFontSize] = useState(() => adjustTerminalFontSize(readLocalJson("sshAgentTerminalFontSize", DEFAULT_TERMINAL_FONT_SIZE), ""));
  const [terminalFocusMode, setTerminalFocusMode] = useState(false);
  const [terminalScrollLocked, setTerminalScrollLocked] = useState(() => Boolean(readLocalJson("sshAgentTerminalScrollLocked", false)));
  const terminalCommandRequestRef = useRef({});
  const terminalInputRequestRef = useRef({});
  const sshOpenRequestRef = useRef({});
  const terminalControlModesRef = useRef({});
  const terminalPtySizesRef = useRef({});
  const sshOutputPollingSessionsRef = useRef(new Set());
  const sshHealthPollingSessionsRef = useRef(new Set());
  const [sshOutputPollTick, setSshOutputPollTick] = useState(0);
  const [agentDraftRequest, setAgentDraftRequest] = useState(null);
  const [agentTaskNotice, setAgentTaskNotice] = useState(null);
  const [agentTasks, setAgentTasks] = useState([]);
  const [runningAgentTasks, setRunningAgentTasks] = useState({});
  const [contextMenu, setContextMenu] = useState(null);
  const [renameTabDraft, setRenameTabDraft] = useState(null);
  const [sftpNameDialog, setSftpNameDialog] = useState(null);
  const [sftpOverwriteDialog, setSftpOverwriteDialog] = useState(null);
  const [sftpDeleteDialog, setSftpDeleteDialog] = useState(null);
  const [pendingConfirmAction, setPendingConfirmAction] = useState(null);
  const [layoutColumns, setLayoutColumns] = useState(() => readLocalJson("sshAgentLayoutColumns", DEFAULT_LAYOUT_COLUMNS));
  const [sidebarSections, setSidebarSections] = useState(() => readLocalJson("sshAgentSidebarSections", DEFAULT_SIDEBAR_SECTIONS));
  const [customServers, setCustomServers] = useState(() => readLocalJson("sshAgentCustomServers", {}));
  const [hiddenBuiltinServers, setHiddenBuiltinServers] = useState(() => readLocalJson("sshAgentHiddenBuiltinServers", []));
  const [customAgentCapabilities, setCustomAgentCapabilities] = useState(() => readLocalJson("sshAgentCustomCapabilities", []));
  const servers = useMemo(() => {
    const baseServers = buildVisibleServerMap(SERVER_DATA, customServers, hiddenBuiltinServers);
    return Object.fromEntries(
      Object.entries(baseServers).map(([name, server]) => {
        const merged = connectionOverrides[name] ? { ...server, ...connectionOverrides[name] } : server;
        const withSftp = sftpOverrides[name] ? { ...merged, files: sftpOverrides[name] } : merged;
        return [
          name,
          { ...withSftp, terminal: withSftp.terminal || [] },
        ];
      }),
    );
  }, [connectionOverrides, customServers, hiddenBuiltinServers, sftpOverrides]);
  const importFollowupPrompt = useMemo(
    () => ({
      ...buildImportFollowupPrompt({ source: importFollowup?.source, importedNames: importFollowup?.names || [], servers }),
      names: importFollowup?.names || [],
      restoreSummary: importFollowup?.restoreSummary || null,
    }),
    [importFollowup, servers],
  );
  const serverNames = useMemo(() => Object.keys(servers), [servers]);
  const [visibleServerNames, setVisibleServerNames] = useState([]);
  const topbarVisibleServerNames = useMemo(
    () => visibleServerNames.filter((name) => servers[name]),
    [servers, visibleServerNames],
  );
  const effectiveVisibleServerNames = topbarVisibleServerNames.length ? topbarVisibleServerNames : serverNames;
  const visibleTerminalTabs = useMemo(
    () => normalizeTerminalTabModels(terminalTabs, serverNames),
    [terminalTabs, serverNames],
  );
  const selectedTerminalTab = useMemo(
    () => visibleTerminalTabs.find((tab) => tab.id === selectedTerminalTabId) || visibleTerminalTabs.find((tab) => tab.serverName === selectedServer) || visibleTerminalTabs[0] || null,
    [selectedServer, selectedTerminalTabId, visibleTerminalTabs],
  );
  const selectedTerminalSessionKey = selectedTerminalTab?.id || selectedServer;
  const selectedCommandInputKey = selectedTerminalSessionKey;
  const selectedTerminalLines = useMemo(
    () => buildVisibleTerminalLines({
      baseLines: servers[selectedServer]?.terminal || [],
      appendedLines: terminalAppends[selectedTerminalSessionKey] ? ["", ...terminalAppends[selectedTerminalSessionKey]] : [],
      clearIndex: terminalClearMarkers[selectedTerminalSessionKey] ?? null,
    }),
    [selectedServer, selectedTerminalSessionKey, servers, terminalAppends, terminalClearMarkers],
  );
  const agentCapabilities = useMemo(() => mergeAgentCapabilities(customAgentCapabilities), [customAgentCapabilities]);
  const commandSnippets = useMemo(
    () => mergeTerminalCommandSnippets(TERMINAL_COMMAND_SNIPPETS, customCommandSnippets),
    [customCommandSnippets],
  );
  const [modelConfig, setModelConfig] = useState(() => buildStoredModelConfig({ ...DEFAULT_MODEL, ...readLocalJson("sshAgentModelConfig", {}) }));
  const [modelProfiles, setModelProfiles] = useState(() => normalizeModelProfiles(
    readLocalJson("sshAgentModelProfiles", []),
    buildStoredModelConfig({ ...DEFAULT_MODEL, ...readLocalJson("sshAgentModelConfig", {}) }),
  ));
  const [activeModelProfileId, setActiveModelProfileId] = useState(() => String(readLocalJson("sshAgentActiveModelProfileId", "default") || "default"));

  useEffect(() => {
    function handleFrontendError(event) {
      void writeToolLogEvent({
        level: "error",
        component: "frontend",
        action: "runtime_error",
        message: sanitizeFrontendRuntimeError(event?.error || event?.message),
        context: {
          filename: String(event?.filename || ""),
          line: Number(event?.lineno || 0),
          column: Number(event?.colno || 0),
        },
      });
    }

    function handleUnhandledRejection(event) {
      void writeToolLogEvent({
        level: "error",
        component: "frontend",
        action: "unhandled_rejection",
        message: sanitizeFrontendRuntimeError(event?.reason),
        context: {
          reasonType: typeof event?.reason,
        },
      });
    }

    window.addEventListener("error", handleFrontendError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleFrontendError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    setSelectedFile(servers[selectedServer]?.files[0]);
    setSftpPreview(null);
  }, [selectedServer, servers]);

  useEffect(() => {
    autoRefreshSftpForServer(selectedServer);
  }, [selectedServer, servers, sftpOverrides]);

  function autoRefreshSftpForServer(serverName, options = {}) {
    const server = servers[serverName];
    if (!server) return;
    const force = Boolean(options.force);
    if (!force && sftpOverrides[serverName]) return;
    if (!force && autoSftpRefreshRef.current.has(serverName)) return;
    if (!hasUsableServerAuth(server)) return;

    const api = safeFileApi();
    if (!api?.list_sftp_directory) return;

    autoSftpRefreshRef.current.add(serverName);
    void refreshSelectedSftp(currentSftpPath(serverName), "", serverName);
  }

  useEffect(() => {
    if (servers[selectedServer] || serverNames.length === 0) return;
    setSelectedServer(serverNames[0]);
  }, [selectedServer, serverNames, servers]);

  useEffect(() => {
    let mounted = true;

    async function loadDesktopConfig() {
      const api = safeFileApi();
      if (!api?.read_app_config) return;

      try {
        const config = await api.read_app_config();
        if (!mounted || !config) return;
        if (config.customServers && typeof config.customServers === "object") {
          setCustomServers(config.customServers);
          writeLocalJson("sshAgentCustomServers", config.customServers);
        }
        if (Array.isArray(config.hiddenBuiltinServers)) {
          setHiddenBuiltinServers(config.hiddenBuiltinServers);
          writeLocalJson("sshAgentHiddenBuiltinServers", config.hiddenBuiltinServers);
        }
        if (config.modelConfig && typeof config.modelConfig === "object") {
          const nextModelConfig = buildStoredModelConfig({ ...DEFAULT_MODEL, ...config.modelConfig });
          setModelConfig(nextModelConfig);
          writeLocalJson("sshAgentModelConfig", nextModelConfig);
        }
        if (Array.isArray(config.modelProfiles)) {
          const nextModelProfiles = normalizeModelProfiles(config.modelProfiles, config.modelConfig || modelConfig);
          setModelProfiles(nextModelProfiles);
          writeLocalJson("sshAgentModelProfiles", nextModelProfiles);
          const nextActiveProfileId = config.activeModelProfileId || nextModelProfiles[0]?.id || "default";
          setActiveModelProfileId(nextActiveProfileId);
          writeLocalJson("sshAgentActiveModelProfileId", nextActiveProfileId);
          const activeProfile = nextModelProfiles.find((profile) => profile.id === nextActiveProfileId) || nextModelProfiles[0];
          if (activeProfile?.config) {
            setModelConfig(activeProfile.config);
            writeLocalJson("sshAgentModelConfig", activeProfile.config);
          }
        }
        if (Array.isArray(config.customAgentCapabilities)) {
          setCustomAgentCapabilities(config.customAgentCapabilities);
          writeLocalJson("sshAgentCustomCapabilities", config.customAgentCapabilities);
        }
        if (Array.isArray(config.portForwardPresets)) {
          setPortForwardPresets(config.portForwardPresets);
          writeLocalJson("sshAgentPortForwardPresets", config.portForwardPresets);
        }
        if (Array.isArray(config.customCommandSnippets)) {
          setCustomCommandSnippets(config.customCommandSnippets);
          writeLocalJson("sshAgentCustomCommandSnippets", config.customCommandSnippets);
        }
      } catch (error) {
        showNotice(`读取本地配置失败：${error.message || error}`);
      }
    }

    loadDesktopConfig();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadReleaseManifest() {
      const api = safeFileApi();
      if (!api?.read_release_manifest) return;

      try {
        const manifest = await api.read_release_manifest();
        if (mounted && manifest) setReleaseManifest({ ...DEFAULT_RELEASE_MANIFEST, ...manifest });
      } catch (error) {
        if (mounted) {
          setReleaseManifest({
            ...DEFAULT_RELEASE_MANIFEST,
            ok: false,
            message: `读取版本信息失败：${error.message || error}`,
          });
        }
      }
    }

    async function loadRuntimeDiagnostics() {
      const api = safeFileApi();
      if (!api?.read_runtime_diagnostics) return;

      try {
        const diagnostics = await api.read_runtime_diagnostics();
        if (mounted && diagnostics) setRuntimeDiagnostics(diagnostics);
      } catch (error) {
        if (mounted) setRuntimeDiagnostics({ ok: false, message: error.message || String(error) });
      }
    }

    loadReleaseManifest();
    loadRuntimeDiagnostics();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function checkStartupReleaseUpdate() {
      const api = safeFileApi();
      if (!api?.read_release_update_settings || !api?.check_release_update) return;
      if (startupUpdateCheckRef.current) return;

      try {
        const settings = await api.read_release_update_settings();
        if (!mounted || !settings?.autoCheckOnStartup) return;
        startupUpdateCheckRef.current = true;
        const status = await api.check_release_update();
        await writeToolLogEvent({
          level: status?.ok ? "info" : "warn",
          component: "release-update",
          action: "auto_startup_check",
          message: status?.message || "启动时检查更新完成",
          context: {
            state: status?.state || "",
            currentVersion: status?.currentVersion || "",
            latestVersion: status?.latestVersion || "",
          },
        });
        if (!mounted) return;
        if (status?.state === "available") {
          showNotice(status.message || "发现新版本，请打开版本信息查看。");
        } else if (status?.ok === false && status?.state !== "not_configured") {
          showNotice(status.message || "检查更新失败。");
        }
      } catch (error) {
        await writeToolLogEvent({
          level: "warn",
          component: "release-update",
          action: "auto_startup_check",
          message: `启动时检查更新失败：${error.message || error}`,
        });
        if (mounted) showNotice(`启动时检查更新失败：${error.message || error}`);
      }
    }

    checkStartupReleaseUpdate();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const activeSessions = Object.entries(sshSessions).filter(([, session]) => session?.sessionId);
    if (activeSessions.length === 0) return undefined;

    async function pollActiveSshSessionOutput() {
      const api = safeFileApi();
      if (!api?.read_ssh_session_output) return;

      await Promise.all(
        activeSessions.map(async ([sessionKey, session]) => {
          const name = session.serverName || sessionKey;
          const outputLogContext = { ...buildSshSessionLogContext(name, servers[name] || {}), sessionKey };
          if (sshOutputPollingSessionsRef.current.has(session.sessionId)) return;
          sshOutputPollingSessionsRef.current.add(session.sessionId);
          try {
            let readMoreOutput = true;
            let readMoreGuard = 0;
            while (readMoreOutput && readMoreGuard < 4) {
              readMoreGuard += 1;
              const result = await api.read_ssh_session_output(session.sessionId);
              if (result?.output) {
                appendTerminalLines(name, formatInteractiveSessionLines(name, "", result.output).slice(1), { terminalKey: sessionKey, rawOutput: result.output });
                writeAuditEvent({ type: "output", server: name, sessionId: session.sessionId, actor: "server", output: result.output, status: "ok" });
                writeSessionLogEvent({ type: "output", server: name, sessionId: session.sessionId, actor: "server", output: result.output, status: "ok", context: outputLogContext });
              }
              if (result && result.ok === false) {
                const message = result.message || "未知错误";
                setSshSessions((current) => {
                  const currentSession = current[sessionKey] || {};
                  if (currentSession.sessionId !== session.sessionId) return current;
                  return {
                    ...current,
                    [sessionKey]: {
                      ...currentSession,
                      serverName: name,
                      sessionId: "",
                      busy: false,
                      lastError: message,
                      failureKind: result?.failureKind || result?.sshFailure?.kind || "",
                      sshFailure: result?.sshFailure || null,
                      disconnectedAt: new Date().toISOString(),
                    },
                  };
                });
                appendTerminalLines(name, [`[${name}]$ # SSH 输出读取失败`, message, "会话已断开，可点击“重连会话”重新连接。"], { terminalKey: sessionKey });
                writeAuditEvent({ type: "output_failed", server: name, sessionId: session.sessionId, actor: "system", message, status: "failed" });
                writeSessionLogEvent({ type: "output_failed", server: name, sessionId: session.sessionId, actor: "system", message, status: "failed", context: outputLogContext });
              }
              readMoreOutput = Boolean(result?.hasMore && result?.ok !== false);
            }
          } catch (error) {
            const message = String(error.message || error);
            setSshSessions((current) => {
              const currentSession = current[sessionKey] || {};
              if (currentSession.sessionId !== session.sessionId) return current;
              return {
                ...current,
                [sessionKey]: {
                  ...currentSession,
                  serverName: name,
                  sessionId: "",
                  busy: false,
                  lastError: message,
                  failureKind: "",
                  sshFailure: null,
                  disconnectedAt: new Date().toISOString(),
                },
              };
            });
            appendTerminalLines(name, [`[${name}]$ # SSH 输出读取失败`, message, "会话已断开，可点击“重连会话”重新连接。"], { terminalKey: sessionKey });
            writeAuditEvent({ type: "output_failed", server: name, sessionId: session.sessionId, actor: "system", message, status: "failed" });
            writeSessionLogEvent({ type: "output_failed", server: name, sessionId: session.sessionId, actor: "system", message, status: "failed", context: outputLogContext });
          } finally {
            sshOutputPollingSessionsRef.current.delete(session.sessionId);
          }
        }),
      );
    }

    pollActiveSshSessionOutput();
    const intervalId = window.setInterval(pollActiveSshSessionOutput, 1200);

    return () => window.clearInterval(intervalId);
  }, [sshSessions, sshOutputPollTick]);

  useEffect(() => {
    const activeSessions = Object.entries(sshSessions).filter(([, session]) => session?.sessionId);
    if (activeSessions.length === 0) return undefined;

    const intervalId = window.setInterval(async () => {
      const api = safeFileApi();
      if (!api?.check_ssh_session_health) return;

      await Promise.all(
        activeSessions.map(async ([sessionKey, session]) => {
          const name = session.serverName || sessionKey;
          const healthLogContext = { ...buildSshSessionLogContext(name, servers[name] || {}), sessionKey };
          if (sshHealthPollingSessionsRef.current.has(session.sessionId)) return;
          sshHealthPollingSessionsRef.current.add(session.sessionId);
          try {
            const result = await api.check_ssh_session_health(session.sessionId);
            if (result?.active) {
              setSshSessions((current) => {
                const currentSession = current[sessionKey] || {};
                if (currentSession.sessionId !== session.sessionId) return current;
                return {
                  ...current,
                  [sessionKey]: {
                    ...currentSession,
                    serverName: name,
                    healthCheckedAt: new Date().toISOString(),
                    healthMessage: result?.message || "SSH 会话正常。",
                    keepaliveSeconds: result?.keepaliveSeconds ?? servers[name]?.keepaliveSeconds ?? 30,
                  },
                };
              });
              return;
            }
            if (!result) return;
            const message = result.message || "SSH 会话已断开，请重新连接。";
            setSshSessions((current) => {
              const currentSession = current[sessionKey] || {};
              if (currentSession.sessionId !== session.sessionId) return current;
              return {
                ...current,
                [sessionKey]: {
                  ...currentSession,
                  serverName: name,
                  sessionId: "",
                  busy: false,
                  lastError: message,
                  failureKind: result?.failureKind || result?.sshFailure?.kind || "",
                  sshFailure: result?.sshFailure || null,
                  disconnectedAt: new Date().toISOString(),
                },
              };
            });
            appendTerminalLines(name, [`[${name}]$ # SSH 会话断开`, message, "会话已断开，可点击“重连会话”重新连接。"], { terminalKey: sessionKey });
            writeAuditEvent({ type: "session_health_failed", server: name, sessionId: session.sessionId, actor: "system", message, status: "failed" });
            writeSessionLogEvent({ type: "session_health_failed", server: name, sessionId: session.sessionId, actor: "system", message, status: "failed", context: healthLogContext });
          } catch (error) {
            const message = String(error.message || error);
            setSshSessions((current) => {
              const currentSession = current[sessionKey] || {};
              if (currentSession.sessionId !== session.sessionId) return current;
              return {
                ...current,
                [sessionKey]: {
                  ...currentSession,
                  serverName: name,
                  sessionId: "",
                  busy: false,
                  lastError: message,
                  failureKind: "",
                  sshFailure: null,
                  disconnectedAt: new Date().toISOString(),
                },
              };
            });
            appendTerminalLines(name, [`[${name}]$ # SSH 健康检查失败`, message, "会话已断开，可点击“重连会话”重新连接。"], { terminalKey: sessionKey });
            writeAuditEvent({ type: "session_health_failed", server: name, sessionId: session.sessionId, actor: "system", message, status: "failed" });
            writeSessionLogEvent({ type: "session_health_failed", server: name, sessionId: session.sessionId, actor: "system", message, status: "failed", context: healthLogContext });
          } finally {
            sshHealthPollingSessionsRef.current.delete(session.sessionId);
          }
        }),
      );
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [sshSessions]);

  function showNotice(text) {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 3200);
  }

  function appendTerminalLines(name, lines = [], options = {}) {
    const terminalKey = options.terminalKey || resolveTerminalSessionKey(name);
    const incomingLines = Array.isArray(lines) ? lines : [String(lines || "")];
    if (!terminalKey || incomingLines.length === 0) return;

    if (options.rawOutput) {
      const modeUpdate = getTerminalControlModeUpdate(options.rawOutput);
      const currentMode = terminalControlModesRef.current[terminalKey] || {};
      terminalControlModesRef.current[terminalKey] = {
        ...currentMode,
        ...(modeUpdate.bracketedPaste !== null ? { bracketedPaste: modeUpdate.bracketedPaste } : {}),
        ...(modeUpdate.title ? { title: modeUpdate.title } : {}),
        ...(modeUpdate.cwd ? { cwd: modeUpdate.cwd } : {}),
      };
    }

    setTerminalAppends((current) => {
      const currentState = {
        lines: current[terminalKey] || [],
        openLine: terminalOpenLineRef.current[terminalKey],
      };
      const nextState = appendTerminalOutputState(currentState, incomingLines);
      terminalOpenLineRef.current[terminalKey] = nextState.openLine;
      return { ...current, [terminalKey]: nextState.lines };
    });
  }

  function nextTerminalCommandRequestId(sessionKey) {
    const key = String(sessionKey || "default");
    const nextId = (terminalCommandRequestRef.current[key] || 0) + 1;
    terminalCommandRequestRef.current[key] = nextId;
    return nextId;
  }

  function isCurrentTerminalCommandRequest(sessionKey, requestId) {
    const key = String(sessionKey || "default");
    return terminalCommandRequestRef.current[key] === requestId;
  }

  function invalidateTerminalCommandRequest(sessionKey) {
    nextTerminalCommandRequestId(sessionKey);
  }

  function nextTerminalInputRequestId(sessionKey) {
    const key = String(sessionKey || "default");
    const nextId = (terminalInputRequestRef.current[key] || 0) + 1;
    terminalInputRequestRef.current[key] = nextId;
    return nextId;
  }

  function isCurrentTerminalInputRequest(sessionKey, requestId) {
    const key = String(sessionKey || "default");
    return terminalInputRequestRef.current[key] === requestId;
  }

  function invalidateTerminalInputRequest(sessionKey) {
    nextTerminalInputRequestId(sessionKey);
  }

  function nextSshOpenRequestId(sessionKey) {
    const key = String(sessionKey || "default");
    const nextId = (sshOpenRequestRef.current[key] || 0) + 1;
    sshOpenRequestRef.current[key] = nextId;
    return nextId;
  }

  function isCurrentSshOpenRequest(sessionKey, requestId) {
    const key = String(sessionKey || "default");
    return sshOpenRequestRef.current[key] === requestId;
  }

  function invalidateSshOpenRequest(sessionKey) {
    nextSshOpenRequestId(sessionKey);
  }

  async function submitPendingConfirmAction() {
    const action = pendingConfirmAction;
    if (!action) return;
    setPendingConfirmAction(null);
    await action.onConfirm?.();
  }

  async function persistAppConfig(
    nextCustomServers = customServers,
    nextModelConfig = modelConfig,
    nextCustomAgentCapabilities = customAgentCapabilities,
    nextModelProfiles = modelProfiles,
    nextActiveModelProfileId = activeModelProfileId,
    nextHiddenBuiltinServers = hiddenBuiltinServers,
    nextPortForwardPresets = portForwardPresets,
    nextCustomCommandSnippets = customCommandSnippets,
  ) {
    writeLocalJson("sshAgentCustomServers", nextCustomServers);
    writeLocalJson("sshAgentHiddenBuiltinServers", nextHiddenBuiltinServers);
    writeLocalJson("sshAgentModelConfig", nextModelConfig);
    writeLocalJson("sshAgentModelProfiles", nextModelProfiles);
    writeLocalJson("sshAgentActiveModelProfileId", nextActiveModelProfileId);
    writeLocalJson("sshAgentCustomCapabilities", nextCustomAgentCapabilities);
    writeLocalJson("sshAgentPortForwardPresets", nextPortForwardPresets);
    writeLocalJson("sshAgentCustomCommandSnippets", nextCustomCommandSnippets);

    const api = safeFileApi();
    if (!api?.write_app_config) return;

    try {
      await api.write_app_config({
        customServers: nextCustomServers,
        hiddenBuiltinServers: nextHiddenBuiltinServers,
        modelConfig: nextModelConfig,
        modelProfiles: nextModelProfiles,
        activeModelProfileId: nextActiveModelProfileId,
        customAgentCapabilities: nextCustomAgentCapabilities,
        portForwardPresets: nextPortForwardPresets,
        customCommandSnippets: nextCustomCommandSnippets,
      });
    } catch (error) {
      showNotice(`写入本地配置失败：${error.message || error}`);
    }
  }

  function currentSftpPath(serverName = selectedServer) {
    const server = servers[serverName] || {};
    return normalizeSftpPath(sftpPaths[serverName] || server.cwd || "/");
  }

  async function copyTextToClipboard(text, successMessage = "已复制") {
    const value = String(text || "");
    if (!value.trim()) {
      showNotice("没有可复制的内容");
      return false;
    }
    try {
      await navigator.clipboard?.writeText?.(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    showNotice(successMessage);
    return true;
  }

  function openNewHost(initialForm = null) {
    setNewHostInitialForm(initialForm);
    setNewHostOpen(true);
  }

  function openEditHost(targetName = selectedServer) {
    const name = targetName || selectedServer;
    if (name && servers[name]) {
      setSelectedServer(name);
      selectServerTab(name);
    }
    setEditHostOpen(true);
  }

  function openAuthCenter(targetName = selectedServer) {
    const name = targetName || selectedServer;
    if (name && servers[name]) {
      setSelectedServer(name);
      selectServerTab(name);
    }
    setAuthCenterOpen(true);
  }

  async function writeServerManagementLog(action, serverName, server, extra = {}) {
    await writeToolLogEvent({
      level: "info",
      component: "server-management",
      action,
      message: "服务器配置已更新",
      context: {
        serverName,
        host: server?.ip || server?.host || "",
        port: server?.port || "22",
        user: server?.user || "",
        authType: server?.authType || "",
        group: server?.group || "",
        ...extra,
      },
    });
  }

  async function saveNewHost(form) {
    const validation = validateServerConnectionForm(form, Object.keys(servers), "");
    if (!validation.ok) {
      showNotice(validation.message || "服务器配置不完整");
      return;
    }
    const result = upsertCustomServer(customServers, "", form);
    setCustomServers(result.servers);
    await persistAppConfig(result.servers, modelConfig);
    setNewHostOpen(false);
    setNewHostInitialForm(null);
    openSavedServerTab(result.name, result.servers);
    await writeServerManagementLog("create_server", result.name, result.servers[result.name]);
    await autoTestSavedHostConnection(result.name, form, result.servers[result.name]?.credentialRef || "");
    showNotice(`已保存服务器：${result.name}`);
  }

  async function saveEditedHost(form) {
    const oldName = selectedServer;
    const sourceServer = servers[oldName];
    const editableForm = customServers[oldName] ? form : { ...serverToHostForm(oldName, sourceServer), ...form };
    const validation = validateServerConnectionForm(editableForm, Object.keys(servers), oldName);
    if (!validation.ok) {
      showNotice(validation.message || "服务器配置不完整");
      return;
    }
    const shouldResetRuntimeState = shouldResetEditedServerSession(oldName, editableForm, customServers[oldName] || sourceServer, editableForm.credentialSecret);
    if (shouldResetRuntimeState) {
      await closeEditedServerSession(oldName, editableForm, customServers[oldName] || sourceServer, editableForm.credentialSecret);
    }
    const result = upsertCustomServer(customServers, oldName, editableForm);
    setCustomServers(result.servers);
    await persistAppConfig(result.servers, modelConfig);
    setEditHostOpen(false);
    if (result.name !== oldName) renameEditedServerTab(oldName, result.name, result.servers);
    if (shouldResetRuntimeState) clearRemovedServerState(oldName);
    openSavedServerTab(result.name, result.servers);
    await writeServerManagementLog("edit_server", result.name, result.servers[result.name], {
      oldName,
      renamed: result.name !== oldName,
      resetSession: shouldResetRuntimeState,
    });
    await autoTestSavedHostConnection(result.name, editableForm, result.servers[result.name]?.credentialRef || "");
    showNotice(`已保存服务器：${result.name}`);
  }

  async function autoTestSavedHostConnection(name, form, credentialRef = "") {
    try {
      const result = await testHostFormConnection({ ...form, name, credentialRef, credentialSecret: "" });
      await writeToolLogEvent({
        level: result?.ok ? "info" : "warn",
        component: "ssh",
        action: "auto_test_saved_connection",
        message: result?.message || (result?.ok ? "连接测试通过" : "连接测试失败"),
        context: { serverName: name, host: form?.host || form?.ip || "", port: form?.port || "22", user: form?.user || "root" },
      });
      return result;
    } catch (error) {
      const message = "保存后自动测试连接失败：" + (error.message || error);
      await writeToolLogEvent({ level: "warn", component: "ssh", action: "auto_test_saved_connection", message, context: { serverName: name } });
      return { ok: false, message };
    }
  }

  function shouldResetEditedServerSession(oldName, form, existingServer, credentialSecret) {
    const nextHost = String(form?.host || form?.ip || "").trim();
    const currentHost = String(existingServer?.ip || existingServer?.host || "").trim();
    const fieldsChanged = [
      oldName !== String(form?.name || oldName).trim(),
      nextHost !== currentHost,
      String(form?.port || "22").trim() !== String(existingServer?.port || "22").trim(),
      String(form?.user || "root").trim() !== String(existingServer?.user || "root").trim(),
      String(form?.authType || "").trim() !== String(existingServer?.authType || "").trim(),
      String(form?.identityFile || "").trim() !== String(existingServer?.identityFile || "").trim(),
      String(form?.proxyJump || "").trim() !== String(existingServer?.proxyJump || "").trim(),
      String(form?.hostKeyAlias || "").trim() !== String(existingServer?.hostKeyAlias || "").trim(),
      Boolean(form?.forwardAgent) !== Boolean(existingServer?.forwardAgent),
      String(form?.timeoutSeconds || "10").trim() !== String(existingServer?.timeoutSeconds || "10").trim(),
      String(form?.retryCount || "0").trim() !== String(existingServer?.retryCount || "0").trim(),
      String(form?.keepaliveSeconds || "30").trim() !== String(existingServer?.keepaliveSeconds || "30").trim(),
      String(form?.keepaliveCountMax || "3").trim() !== String(existingServer?.keepaliveCountMax || "3").trim(),
      String(form?.cwd || "").trim() !== String(existingServer?.cwd || "").trim(),
      String(form?.credentialRef || "").trim() !== String(existingServer?.credentialRef || "").trim(),
      Boolean(credentialSecret),
    ];
    return fieldsChanged.some(Boolean);
  }

  async function closeEditedServerSession(oldName, form, existingServer, credentialSecret) {
    if (!shouldResetEditedServerSession(oldName, form, existingServer, credentialSecret)) return;
    for (const sessionKey of getSessionKeysForServer(oldName)) {
      await closeSessionByName(oldName, "编辑连接后断开旧 SSH 会话。", { sessionKey });
    }
  }

  function deleteSelectedHost(name = selectedServer) {
    const targetName = name || selectedServer;
    if (!customServers[targetName]) {
      showNotice("内置服务器不能删除，可复制为自定义服务器后编辑。");
      return;
    }
    setPendingConfirmAction({
      title: "删除服务器",
      message: `确定要删除 ${targetName} 吗？已保存的连接信息会从本机配置中移除。`,
      detailLabel: "服务器",
      detail: targetName,
      confirmLabel: "删除",
      danger: true,
      onConfirm: () => confirmDeleteSelectedHost(targetName),
    });
  }

  async function confirmDeleteSelectedHost(name) {
    const deletedServer = customServers[name];
    const result = deleteCustomServer(customServers, name);
    if (!result.deleted) {
      showNotice("未找到可删除的自定义服务器");
      return;
    }
    await closeRemovedServerSession(name, "服务器已删除");
    setCustomServers(result.servers);
    await persistAppConfig(result.servers, modelConfig);
    setEditHostOpen(false);
    const remainingServerNames = Object.keys(buildVisibleServerMap(SERVER_DATA, result.servers, hiddenBuiltinServers));
    removeClosedServerTab(name, remainingServerNames);
    clearRemovedServerState(name);
    await writeServerManagementLog("delete_server", name, deletedServer);
    showNotice(`已删除服务器：${name}`);
  }

  async function closeRemovedServerSession(name, reason = "服务器已移除") {
    for (const sessionKey of getSessionKeysForServer(name)) {
      await closeSessionByName(name, reason, { sessionKey });
    }
  }

  function getSessionKeysForServer(name) {
    const keys = new Set([name]);
    for (const tab of visibleTerminalTabs) {
      if (tab?.serverName === name) keys.add(tab.id || name);
    }
    for (const [sessionKey, session] of Object.entries(sshSessions)) {
      if (session?.serverName === name) keys.add(sessionKey);
    }
    return [...keys].filter(Boolean);
  }

  function clearRemovedServerState(name) {
    const keys = getSessionKeysForServer(name);
    setSshSessions((current) => removeObjectKeys(current, keys));
    setTerminalAppends((current) => removeObjectKeys(current, keys));
    setTerminalClearMarkers((current) => removeObjectKeys(current, keys));
    setCommandInputs((current) => removeObjectKeys(current, keys));
    setHistoryCursors((current) => removeObjectKeys(current, keys));
    for (const key of keys) {
      delete terminalOpenLineRef.current[key];
      delete terminalControlModesRef.current[key];
    }
  }

  function removeClosedServerTab(name, remainingServerNames) {
    const terminalState = removeServerTerminalTab(visibleTerminalTabs, name, selectedServer, remainingServerNames);
    saveTerminalTabs(terminalState.tabs);
    setSelectedTerminalTabId(terminalState.selectedTabId || terminalState.tabs[0]?.id || "");
    setSelectedServer(terminalState.selectedServer || remainingServerNames[0] || "");
  }

  function renameEditedServerTab(oldName, newName, nextServers) {
    const nextServerNames = Object.keys(buildVisibleServerMap(SERVER_DATA, nextServers, hiddenBuiltinServers));
    const terminalState = renameServerTerminalTab(visibleTerminalTabs, oldName, newName, selectedServer, nextServerNames);
    const renamedTabs = visibleTerminalTabs.map((tab) => {
      if (tab.serverName !== oldName) return tab;
      const suffix = String(tab.id || "").startsWith(oldName) ? String(tab.id).slice(oldName.length) : "";
      return {
        ...tab,
        id: suffix ? `${newName}${suffix}` : newName,
        serverName: newName,
        title: String(tab.title || "").startsWith(oldName) ? `${newName}${String(tab.title).slice(oldName.length)}` : newName,
      };
    });
    const nextTabs = normalizeTerminalTabModels(renamedTabs.length ? renamedTabs : terminalState.tabs, nextServerNames);
    saveTerminalTabs(nextTabs);
    setSelectedTerminalTabId((current) => {
      const selectedTab = nextTabs.find((tab) => tab.id === current)
        || nextTabs.find((tab) => tab.serverName === terminalState.selectedServer)
        || nextTabs[0];
      return selectedTab?.id || "";
    });
    setSelectedServer(terminalState.selectedServer);
  }

  async function removeSelectedCredential(name = selectedServer) {
    const targetName = name || selectedServer;
    const server = servers[targetName];
    if (!server) return;
    const result = upsertCustomServer(customServers, targetName, {
      ...serverToHostForm(targetName, server),
      credentialRef: "",
      credentialSecret: "",
      password: "",
      identityFile: server.authType === "私钥" ? "" : server.identityFile || "",
    });
    setCustomServers(result.servers);
    await persistAppConfig(result.servers, modelConfig);
    showNotice(`已移除 ${targetName} 的本机认证绑定`);
  }

  async function runConnectionCheckRepair(row, action) {
    action = action || row;
    if (row?.name) selectServerTab(row?.name);
    runConnectionQuickFix(action, row?.name);
  }

  function runConnectionQuickFix(action, targetName = action?.serverName || selectedServer) {
    const name = targetName || action?.serverName || selectedServer;
    if (action?.command) updateCommandInput(selectedCommandInputKey, action.command);
    switch (action?.target || action?.id) {
      case "auth-center":
        setSelectedServer(name);
        setAuthCenterOpen(true);
        break;
      case "server-editor":
        openEditHost(name);
        break;
      case "host-key-trust":
        trustSelectedHostKey(name);
        break;
      case "connection-test":
        testSelectedConnection(name);
        break;
      case "agent-diagnostic":
        queueSelectedSshDiagnostic(name);
        break;
      case "tool-logs":
        openToolLogs();
        break;
      case "diagnostic-package":
        exportDiagnosticPackage();
        break;
      default:
        break;
    }
    if (action?.message) showNotice(action.message);
  }

  function recordSingleConnectionCheck(name, result, override = null) {
    const targetName = String(name || selectedServer || "临时连接").trim() || "临时连接";
    setLatestConnectionCheck({
      generatedAt: new Date().toISOString(),
      results: [{ name: targetName, ...(result || {}), ...(override ? { override } : {}) }],
    });
  }

  async function testSelectedConnection(name = selectedServer) {
    const targetName = name || selectedServer;
    const server = servers[targetName];
    if (!server) return null;
    const api = safeFileApi();
    if (!api?.test_ssh_login && !api?.test_ssh_connection) {
      showNotice("当前环境不支持 SSH 登录测试，请使用正式 EXE");
      return null;
    }
    setTestingConnections((current) => ({ ...current, [targetName]: true }));
    try {
      const result = hasUsableServerAuth(server) && api?.test_ssh_login
        ? await api.test_ssh_login(server, server.credentialRef || "")
        : await api.test_ssh_connection(server.ip || server.host, server.port || "22");
      const hostKey = extractHostKeyFromSshResult(result);
      const override = {
        ...buildConnectionOverride(result || {}, server),
        ...buildHostKeyEvidenceOverride((connectionOverrides[targetName] || server).evidence, hostKey, server.trustedHostKey),
      };
      setConnectionOverrides((current) => ({
        ...current,
        [targetName]: { ...(current[targetName] || {}), ...override },
      }));
      recordSingleConnectionCheck(targetName, result, override);
      showNotice(result?.message || (result?.ok ? "SSH 连接测试通过" : "SSH 连接测试失败"));
      return result;
    } catch (error) {
      const result = { ok: false, message: `SSH 连接测试失败：${error.message || error}` };
      const override = buildConnectionOverride(result, server);
      setConnectionOverrides((current) => ({
        ...current,
        [targetName]: { ...(current[targetName] || {}), ...override },
      }));
      recordSingleConnectionCheck(targetName, result, override);
      showNotice(result.message);
      return result;
    } finally {
      setTestingConnections((current) => ({ ...current, [targetName]: false }));
    }
  }

  async function testHostFormConnection(form) {
    const draftName = String(form.name || form.host || "").trim();
    const formWithName = { ...form, name: form.name || form.host || "临时连接" };
    const validation = validateServerConnectionForm(formWithName, [], "");
    if (!validation.ok) return { ok: false, message: validation.message || "服务器配置不完整" };
    const built = buildCustomServer(formWithName);
    const [, server] = Object.entries(built)[0] || [];
    const api = safeFileApi();
    if (!api?.test_ssh_login || !server) return { ok: false, message: "当前环境不支持 SSH 登录测试，请使用正式 EXE" };
    const result = await api.test_ssh_login(server, server.credentialRef, form.credentialSecret || form.password || "", buildSshCredentialMetadata(formWithName));
    const serverDraft = { ...server, name: draftName || server.name || formWithName.name };
    const override = buildConnectionOverride(result, serverDraft);
    setConnectionOverrides((current) => ({ ...current, [draftName || formWithName.name]: override }));
    recordSingleConnectionCheck(draftName || formWithName.name, result, override);
    return result;
  }

  async function copyServerSshCommand(name = selectedServer) {
    const server = servers[name];
    if (!server) return false;
    return copyTextToClipboard(buildServerCopySshCommand(name, server), "SSH 命令已复制");
  }

  async function copyServerConnectionInfo(name = selectedServer) {
    const server = servers[name];
    if (!server) return false;
    return copyTextToClipboard(buildServerCopyInfo(name, server), "服务器连接信息已复制");
  }

  async function copyServerTroubleshootingSummary(name = selectedServer) {
    const server = servers[name];
    if (!server) return false;
    return copyTextToClipboard(buildServerTroubleshootingSummary(name, server), "排障摘要已复制");
  }

  async function copyServerOpenSshConfig(name = selectedServer) {
    const server = servers[name];
    if (!server) return false;
    return copyTextToClipboard(buildOpenSshConfigExport({ [name]: server }, { exportedAt: new Date().toISOString() }), "OpenSSH Config 已复制");
  }

  async function exportConnectionCheckReport() {
    const results = Array.isArray(latestConnectionCheck?.results) ? latestConnectionCheck.results : [];
    if (!results.length) {
      showNotice("暂无可导出的连接校验报告，请先执行批量连接校验。");
      return null;
    }
    const generatedAt = latestConnectionCheck?.generatedAt || new Date().toISOString();
    const content = buildConnectionCheckReport({
      title: "批量连接校验报告",
      generatedAt,
      servers,
      results,
    });
    const stamp = String(generatedAt).replace(/[^\d]/g, "").slice(0, 14) || "latest";
    const fileName = `ssh-connection-check-report-${stamp}.md`;
    const api = safeFileApi();
    if (api?.save_text_file) {
      const target = await api.save_text_file(fileName, content);
      showNotice(target ? `连接校验报告已导出：${target}` : "已取消导出连接校验报告");
      return target;
    }
    const target = saveTextFileFromBrowser(fileName, content);
    showNotice(`连接校验报告已导出：${target}`);
    return target;
  }

  async function exportServerProfile(targetName = "") {
    const name = targetName || selectedServer;
    const profileServers = targetName ? { [name]: servers[name] } : servers;
    if (!Object.keys(profileServers).length) return;
    const content = buildServerProfileMarkdown({
      generatedAt: new Date().toISOString(),
      servers: profileServers,
      latestConnectionCheck,
    });
    const fileName = targetName ? `ssh-server-${name}-profile.md` : "ssh-server-profile.md";
    const api = safeFileApi();
    if (api?.save_text_file) {
      const target = await api.save_text_file(fileName, content);
      if (target) showNotice(`连接档案已导出：${target}`);
      return;
    }
    await copyTextToClipboard(content, "连接档案已复制");
  }

  function recordBackupExport(entry) {
    const nextHistory = addBackupHistoryEntry(backupHistory, entry);
    setBackupHistory(nextHistory);
    writeLocalJson("sshAgentBackupHistory", nextHistory);
  }

  function removeBackupHistoryItem(entryId) {
    const nextHistory = removeBackupHistoryEntry(backupHistory, entryId);
    setBackupHistory(nextHistory);
    writeLocalJson("sshAgentBackupHistory", nextHistory);
  }

  function clearBackupHistoryItems() {
    const nextHistory = clearBackupHistory();
    setBackupHistory(nextHistory);
    writeLocalJson("sshAgentBackupHistory", nextHistory);
  }

  async function importBackup() {
    const api = safeFileApi();
    const emptyMessage = "备份中没有可导入的服务器、Agent 能力、端口转发预设、命令片段或模型 API 档案。";
    try {
      let backup = null;
      let sourcePath = "";
      let sourceName = "";

      if (api?.pick_backup_file && api?.open_backup_file) {
        const pickedPath = await api.pick_backup_file();
        if (!pickedPath) return;
        sourcePath = pickedPath;
        const result = await api.open_backup_file(pickedPath);
        if (!result?.ok) {
          showNotice(result?.message || "备份文件读取失败。");
          return;
        }
        backup = result.backup;
        sourceName = result.fileName || pickedPath;
      } else {
        const picked = await pickTextFileFromBrowser();
        if (!picked) return;
        sourcePath = picked.path || picked.name || "";
        sourceName = picked.name || sourcePath;
        backup = JSON.parse(picked.content || "{}");
      }

      const preview = buildBackupImportPreview(servers, agentCapabilities, backup, { sourceName });
      if (!preview.valid) {
        showNotice(preview.summary || "备份文件格式不支持。");
        return;
      }
      if (!hasBackupImportTargets(preview)) {
        showNotice(emptyMessage);
        return;
      }
      setBackupImportDraft({ backup, preview, sourcePath, sourceName });
    } catch (error) {
      showNotice("导入备份失败：" + (sanitizeFrontendRuntimeError(error) || String(error?.message || error)));
    }
  }

  async function applyBackupImport(backup, options = {}) {
    const emptyMessage = "备份中没有可导入的服务器、Agent 能力、端口转发预设、命令片段或模型 API 档案。";
    const plan = buildBackupImportPlan(backup, {
      servers: true,
      sftp: true,
      agentCapabilities: true,
      portForwards: true,
      commandSnippets: true,
      modelProfiles: true,
      restoreSecrets: Boolean(options.restoreSecrets),
    });
    const hostImport = mergeBackupHosts(servers, plan.backup);
    const capabilityImport = mergeBackupAgentCapabilities(agentCapabilities, plan.backup);
    const portForwardImport = mergeBackupPortForwardPresets(portForwardPresets, plan.backup);
    const commandSnippetImport = mergeBackupCommandSnippets(customCommandSnippets, plan.backup);
    const modelProfileImport = mergeBackupModelProfiles(modelProfiles, plan.backup);
    const hasTarget = Boolean(
      hostImport.importedNames.length
      || capabilityImport.importedNames.length
      || portForwardImport.importedNames.length
      || commandSnippetImport.importedNames.length
      || modelProfileImport.importedNames.length
    );
    if (!hasTarget) {
      showNotice(emptyMessage);
      return null;
    }

    let nextServers = hostImport.servers;
    let credentialRestore = null;
    const api = safeFileApi();
    if (plan.restoreServerCredentials && api?.restore_backup_credentials) {
      credentialRestore = await api.restore_backup_credentials(hostImport.importedHosts, options.masterPassword || "");
      const restoredRefs = new Map(
        (Array.isArray(credentialRestore?.credentials) ? credentialRestore.credentials : [])
          .map((item) => [String(item?.name || "").trim(), item])
          .filter(([name]) => name),
      );
      hostImport.importedHosts.forEach((item) => {
        const restored = restoredRefs.get(item.name) || restoredRefs.get(item.sourceName);
        if (!restored?.credentialRef || !nextServers[item.name]) return;
        nextServers = {
          ...nextServers,
          [item.name]: {
            ...nextServers[item.name],
            credentialRef: restored.credentialRef,
            hasCredential: true,
          },
        };
      });
    }

    setCustomServers(nextServers);
    setCustomAgentCapabilities(capabilityImport.capabilities);
    setPortForwardPresets(portForwardImport.presets);
    setCustomCommandSnippets(commandSnippetImport.snippets);
    setModelProfiles(modelProfileImport.profiles);
    await persistAppConfig(
      nextServers,
      modelConfig,
      capabilityImport.capabilities,
      modelProfileImport.profiles,
      activeModelProfileId,
      hiddenBuiltinServers,
      portForwardImport.presets,
      commandSnippetImport.snippets,
    );

    const restoreSummary = buildBackupRestoreResultSummary({
      importedNames: hostImport.importedNames,
      importedHosts: hostImport.importedHosts,
      credentialRestore,
      restoreSecrets: Boolean(options.restoreSecrets),
    });
    setImportFollowup({
      source: backupImportDraft?.sourceName || "backup",
      names: hostImport.importedNames,
      restoreSummary,
    });
    if (hostImport.importedNames[0]) selectServerTab(hostImport.importedNames[0]);
    showNotice(`备份导入完成：新增服务器 ${hostImport.importedNames.length} 台，Agent 能力 ${capabilityImport.importedNames.length} 个，模型 API 档案 ${modelProfileImport.importedNames.length} 个。`);
    return { hostImport, capabilityImport, portForwardImport, commandSnippetImport, modelProfileImport, credentialRestore };
  }

  async function confirmBackupImport(options = {}) {
    const emptyMessage = "备份中没有可导入的服务器、Agent 能力、端口转发预设、命令片段或模型 API 档案。";
    if (!backupImportDraft?.backup) {
      showNotice(emptyMessage);
      return;
    }
    try {
      await applyBackupImport(backupImportDraft.backup, options);
      setBackupImportDraft(null);
    } catch (error) {
      showNotice("确认导入失败：" + (sanitizeFrontendRuntimeError(error) || String(error?.message || error)));
    }
  }

  function handleSshConfigImportPreviewConfirm() {
    showNotice("SSH Config 导入预览已确认。");
  }

  async function importSshConfig() {
    const api = safeFileApi();
    if (!api?.open_ssh_config_file) {
      showNotice("当前环境不支持读取 SSH Config，请使用正式 exe。");
      return;
    }
    try {
      const result = await api.open_ssh_config_file();
      const importedHosts = Array.isArray(result?.hosts) ? result.hosts : [];
      const preview = buildSshConfigImportPreview(customServers, importedHosts, servers, result);
      if (!preview.importableCount) {
        showNotice(result?.message || "没有可导入的 SSH Config 主机。");
        return;
      }
      const hostImport = mergeSshConfigHosts(customServers, importedHosts, servers);
      const portForwardImport = mergeSshConfigPortForwardPresets(portForwardPresets, hostImport.importedNames, hostImport.servers);
      setCustomServers(hostImport.servers);
      setPortForwardPresets(portForwardImport.presets);
      await persistAppConfig(hostImport.servers, modelConfig, customAgentCapabilities, modelProfiles, activeModelProfileId, hiddenBuiltinServers, portForwardImport.presets, customCommandSnippets);
      setImportFollowup({ source: result?.name || "ssh-config", names: hostImport.importedNames, restoreSummary: null });
      if (hostImport.importedNames[0]) selectServerTab(hostImport.importedNames[0]);
      handleSshConfigImportPreviewConfirm();
      showNotice(`SSH Config 已导入：${hostImport.importedNames.length} 台服务器，${portForwardImport.importedNames.length} 个端口转发预设。`);
    } catch (error) {
      showNotice("导入 SSH Config 失败：" + (sanitizeFrontendRuntimeError(error) || String(error?.message || error)));
    }
  }

  async function readSelectedBasicInfo(name = selectedServer) {
    const targetName = name || selectedServer;
    const server = servers[targetName];
    const api = safeFileApi();
    if (!server || !api?.read_ssh_basic_info) {
      showNotice("当前环境不支持读取基础信息，请使用正式 EXE");
      return null;
    }
    setReadingBasicInfo((current) => ({ ...current, [targetName]: true }));
    try {
      const result = await api.read_ssh_basic_info(server, server.credentialRef);
      const output = Array.isArray(result?.results)
        ? result.results.map((item) => [`$ ${item.command || ""}`, item.output || item.message || ""].filter(Boolean).join("\n")).join("\n\n")
        : result?.output || result?.message || "";
      if (output) appendTerminalLines(targetName, formatInteractiveSessionLines(targetName, "basic-info", output), { terminalKey: resolveTerminalSessionKey(targetName) });
      showNotice(result?.message || (result?.ok ? "基础信息读取完成" : "基础信息读取失败"));
      return result;
    } catch (error) {
      showNotice(`基础信息读取失败：${error.message || error}`);
      return null;
    } finally {
      setReadingBasicInfo((current) => ({ ...current, [targetName]: false }));
    }
  }

  async function runSelectedSshSmokeTest(name = selectedServer) {
    const targetName = name || selectedServer;
    const server = servers[targetName];
    const api = safeFileApi();
    const terminalKey = resolveTerminalSessionKey(targetName);
    const startedAt = new Date().toISOString();
    const steps = [];
    let sessionId = "";

    function appendStep(step) {
      steps.push(step);
      const row = buildSshSmokeTestStepRows({ serverName: targetName, steps: [step], startedAt })[1];
      if (row) appendTerminalLines(targetName, [row], { terminalKey });
    }

    if (!server) {
      showNotice("请选择要自检的 SSH 服务器。");
      return null;
    }
    selectServerTab(targetName, { sessionKey: terminalKey });
    appendTerminalLines(targetName, buildSshSmokeTestStepRows({ serverName: targetName, steps: [], startedAt }).slice(0, 1), { terminalKey });
    setSshSmokeTesting((current) => ({ ...current, [targetName]: true }));
    try {
      if (!api?.open_ssh_session || !api?.send_ssh_session_input || !api?.close_ssh_session) {
        appendStep({ label: "正式 EXE 桥接", status: "failed", message: "当前环境不支持基础自检，请使用正式 Windows 客户端。" });
        return { ok: false, steps };
      }
      const validation = validateSshSessionOpenTarget(server);
      if (!validation.ok && validation.field !== "auth") {
        appendStep({ label: "连接配置检查", status: "failed", message: validation.message || "服务器配置不完整。" });
        return { ok: false, steps };
      }
      if (!hasUsableServerAuth(server)) {
        appendStep({ label: "认证检查", status: "failed", message: "请先在认证中心绑定或填写 SSH 凭据。" });
        return { ok: false, steps };
      }

      const size = getRememberedTerminalPtySize(terminalKey);
      const opened = await api.open_ssh_session(server, server.credentialRef, { cols: size.cols, rows: size.rows });
      if (!opened?.ok || !opened.sessionId) {
        appendStep({ label: "连接 SSH 会话", status: "failed", message: opened?.message || "SSH 会话连接失败。" });
        return { ok: false, steps };
      }
      sessionId = opened.sessionId;
      appendStep({ label: "连接 SSH 会话", status: "ok", message: opened.message || "临时 SSH 会话已建立。" });

      if (api?.check_ssh_session_health) {
        const health = await api.check_ssh_session_health(sessionId);
        appendStep({ label: "会话健康检查", status: health?.ok ? "ok" : "failed", message: health?.message || (health?.ok ? "会话可用。" : "会话状态异常。") });
      }

      const echoCommand = "echo ssh-agent-smoke-ok";
      const echoed = await api.send_ssh_session_input(sessionId, echoCommand, true);
      if (echoed?.output) appendTerminalLines(targetName, formatInteractiveSessionLines(targetName, echoCommand, echoed.output).slice(1), { terminalKey, rawOutput: echoed.output });
      appendStep({ label: "回车执行命令", status: echoed?.ok ? "ok" : "failed", message: echoed?.message || (echoed?.ok ? "命令已发送并返回。" : "命令发送失败。") });

      const sleepCommand = "sleep 30";
      const sleepTyped = await api.send_ssh_session_input(sessionId, sleepCommand, false);
      const sleepStarted = sleepTyped?.ok ? await api.send_ssh_session_input(sessionId, "\r", false) : sleepTyped;
      await waitForSshSmokeInterruptWindow();
      const interrupted = api?.interrupt_ssh_session_command ? await api.interrupt_ssh_session_command(sessionId) : null;
      appendStep({
        label: "Ctrl+C 中断",
        status: interrupted?.ok ? "ok" : "failed",
        message: interrupted?.message || (sleepStarted?.ok ? "长命令已启动，并已向临时会话发送中断信号。" : "长命令未能启动或中断接口不可用。"),
      });
      if (api?.read_ssh_session_output) {
        const output = await api.read_ssh_session_output(sessionId);
        if (output?.output) appendTerminalLines(targetName, formatInteractiveSessionLines(targetName, "smoke-output", output.output).slice(1), { terminalKey, rawOutput: output.output });
      }
      const interruptRecoveryCommand = "echo ssh-agent-interrupt-ok";
      const interruptRecovery = await api.send_ssh_session_input(sessionId, interruptRecoveryCommand, true);
      if (interruptRecovery?.output) appendTerminalLines(targetName, formatInteractiveSessionLines(targetName, interruptRecoveryCommand, interruptRecovery.output).slice(1), { terminalKey, rawOutput: interruptRecovery.output });
      const interruptRecovered = Boolean(interruptRecovery?.ok && String(interruptRecovery?.output || "").includes("ssh-agent-interrupt-ok"));
      appendStep({
        label: "中断后会话恢复",
        status: interruptRecovered ? "ok" : "failed",
        message: interruptRecovered ? "Ctrl+C 后 SSH 会话仍可继续执行命令。" : interruptRecovery?.message || "Ctrl+C 后会话未返回预期输出，请检查会话日志。",
      });

      const sftpBasePath = normalizeSftpPath(server.cwd || currentSftpPath() || "/");
      if (api?.list_sftp_directory) {
        const sftpResult = await api.list_sftp_directory(server, server.credentialRef, sftpBasePath);
        const itemCount = Array.isArray(sftpResult?.files) ? sftpResult.files.length : Array.isArray(sftpResult?.items) ? sftpResult.items.length : 0;
        appendStep({
          label: "SFTP 列目录",
          status: sftpResult?.ok ? "ok" : "failed",
          message: sftpResult?.message || (sftpResult?.ok ? `${sftpBasePath} 可读取，${itemCount} 项。` : "SFTP 目录读取失败。"),
        });
      } else {
        appendStep({ label: "SFTP 列目录", status: "skipped", message: "当前环境没有 SFTP 桥接接口。" });
      }

      if (api?.create_sftp_file && api?.write_sftp_text_file && api?.preview_sftp_file && api?.delete_sftp_item) {
        const smokeContent = `ssh-agent-smoke-ok ${startedAt}`;
        const sftpSmokeBasePaths = Array.from(new Set([sftpBasePath, "/tmp"].map((path) => normalizeSftpPath(path)).filter(Boolean)));
        let smokeFilePath = "";
        let created = false;
        let lastSftpSmokeError = "";
        try {
          for (const smokeBasePath of sftpSmokeBasePaths) {
            smokeFilePath = resolveSftpChildPath(smokeBasePath, `.ssh-agent-smoke-${Date.now()}.txt`);
            created = false;
            try {
              const createResult = await api.create_sftp_file(server, server.credentialRef, smokeFilePath);
              if (!createResult?.ok) throw new Error(createResult?.message || "临时文件创建失败。");
              created = true;
              const writeResult = await api.write_sftp_text_file(server, server.credentialRef, smokeFilePath, smokeContent, "utf-8");
              if (!writeResult?.ok) throw new Error(writeResult?.message || "临时文件写入失败。");
              const previewResult = await api.preview_sftp_file(server, server.credentialRef, smokeFilePath);
              const readContent = String(previewResult?.content ?? "");
              const readOk = Boolean(previewResult?.ok && readContent.includes(smokeContent));
              if (!readOk) throw new Error(previewResult?.message || "临时文件读取内容不匹配。");
              appendStep({
                label: "SFTP 临时文件读写",
                status: "ok",
                message: smokeBasePath === sftpBasePath ? "临时文件已创建、写入并读回校验。" : `当前目录不可写，已通过兜底目录 ${smokeBasePath} 完成读写校验。`,
              });
              lastSftpSmokeError = "";
              break;
            } catch (error) {
              lastSftpSmokeError = sanitizeFrontendRuntimeError(error) || String(error?.message || error);
              if (created) {
                try {
                  await api.delete_sftp_item(server, server.credentialRef, smokeFilePath, false);
                } catch {
                  // The final cleanup step below will report cleanup for the successful candidate.
                }
                created = false;
              }
            }
          }
          if (lastSftpSmokeError) throw new Error(lastSftpSmokeError);
        } catch (error) {
          appendStep({ label: "SFTP 临时文件读写", status: "failed", message: sanitizeFrontendRuntimeError(error) || String(error?.message || error) });
        } finally {
          if (created) {
            try {
              const deleteResult = await api.delete_sftp_item(server, server.credentialRef, smokeFilePath, false);
              appendStep({
                label: "SFTP 临时文件清理",
                status: deleteResult?.ok === false ? "failed" : "ok",
                message: deleteResult?.message || "临时自检文件已删除。",
              });
            } catch (error) {
              appendStep({ label: "SFTP 临时文件清理", status: "failed", message: sanitizeFrontendRuntimeError(error) || String(error?.message || error) });
            }
          }
        }
      } else {
        appendStep({ label: "SFTP 临时文件读写", status: "skipped", message: "当前环境没有完整的 SFTP 读写桥接接口。" });
      }

      return { ok: summarizeSshSmokeTestSteps(steps).failed === 0, steps };
    } catch (error) {
      appendStep({ label: "自检异常", status: "failed", message: sanitizeFrontendRuntimeError(error) || String(error?.message || error) });
      return { ok: false, steps };
    } finally {
      if (sessionId && api?.close_ssh_session) {
        try {
          const closed = await api.close_ssh_session(sessionId);
          appendStep({ label: "断开临时会话", status: closed?.ok === false ? "failed" : "ok", message: closed?.message || "临时 SSH 会话已关闭。" });
        } catch (error) {
          appendStep({ label: "断开临时会话", status: "failed", message: String(error?.message || error) });
        }
      }
      const finishedAt = new Date().toISOString();
      const summary = summarizeSshSmokeTestSteps(steps);
      const summaryText = buildSshSmokeTestSummaryText(summary);
      const outcome = getSshSmokeTestOutcome(summary);
      const report = buildSshSmokeTestReport({ serverName: targetName, server, steps, startedAt, finishedAt });
      setLatestSshSmokeTest({ serverName: targetName, generatedAt: finishedAt, report, steps: [...steps], summary });
      appendTerminalLines(targetName, buildSshSmokeTestStepRows({ serverName: targetName, steps, startedAt, finishedAt }).slice(-1), { terminalKey });
      setLatestConnectionCheck({
        generatedAt: finishedAt,
        results: [{
          name: targetName,
          ok: outcome.ok,
          status: outcome.status,
          latency: "--",
          message: summaryText,
        }],
      });
      await writeToolLogEvent({
        level: outcome.level,
        component: "ssh",
        action: "smoke_test",
        message: summaryText,
        context: { serverName: targetName, stepCount: summary.total, reportLength: report.length },
      });
      showNotice(summaryText);
      setSshSmokeTesting((current) => ({ ...current, [targetName]: false }));
    }
  }

  async function exportSshSmokeTestReport() {
    const report = String(latestSshSmokeTest?.report || "");
    if (!report) {
      showNotice("暂无基础自检报告，请先执行一键基础自检。");
      return null;
    }
    const generatedAt = latestSshSmokeTest?.generatedAt || new Date().toISOString();
    const illegalFileNameChars = new Set(["\\", "/", ":", "*", "?", "\"", "<", ">", "|"]);
    const safeServerName = [...String(latestSshSmokeTest?.serverName || selectedServer || "server")]
      .map((char) => (illegalFileNameChars.has(char) || /\s/.test(char) ? "-" : char))
      .join("")
      .replace(/^-+|-+$/g, "") || "server";
    const stamp = String(generatedAt).replace(/[^\d]/g, "").slice(0, 14) || "latest";
    const fileName = `basic-smoke-test-${safeServerName}-${stamp}.md`;
    const api = safeFileApi();
    if (api?.save_text_file) {
      const target = await api.save_text_file(fileName, report);
      showNotice(target ? `基础自检报告已导出：${target}` : "已取消导出基础自检报告");
      return target;
    }
    const target = saveTextFileFromBrowser(fileName, report);
    showNotice(`基础自检报告已导出：${target}`);
    return target;
  }

  async function batchOpenSshSessions(names = effectiveVisibleServerNames) {
    setBatchBusy((current) => ({ ...current, connect: true }));
    try {
      for (const name of names || []) await openSelectedSession(name);
      showNotice("批量连接已执行");
    } finally {
      setBatchBusy((current) => ({ ...current, connect: false }));
    }
  }

  async function batchCloseSshSessions(names = effectiveVisibleServerNames) {
    setBatchBusy((current) => ({ ...current, disconnect: true }));
    try {
      for (const name of names || []) await closeSessionByName(name, "批量断开 SSH 会话", { actor: "user" });
      showNotice("批量断开已执行");
    } finally {
      setBatchBusy((current) => ({ ...current, disconnect: false }));
    }
  }

  async function batchReconnectSshSessions(names = effectiveVisibleServerNames) {
    setBatchBusy((current) => ({ ...current, reconnect: true }));
    try {
      for (const name of names || []) await reconnectSelectedSession(name);
      showNotice("批量重连已执行");
    } finally {
      setBatchBusy((current) => ({ ...current, reconnect: false }));
    }
  }

  async function batchTestConnections(names = effectiveVisibleServerNames) {
    setBatchBusy((current) => ({ ...current, test: true }));
    const results = [];
    try {
      for (const name of names || []) {
        const result = await testSelectedConnection(name);
        if (result) results.push({ name, ...result });
      }
      setLatestConnectionCheck({ generatedAt: new Date().toISOString(), results });
      showNotice(`批量测试完成：${results.filter((item) => item.ok).length}/${results.length} 通过`);
    } finally {
      setBatchBusy((current) => ({ ...current, test: false }));
    }
  }

  async function batchReadBasicInfo(names = effectiveVisibleServerNames) {
    setBatchBusy((current) => ({ ...current, basic: true }));
    try {
      for (const name of names || []) await readSelectedBasicInfo(name);
      showNotice("批量读取基础信息已执行");
    } finally {
      setBatchBusy((current) => ({ ...current, basic: false }));
    }
  }

  async function queueBatchAgentInspection(names = effectiveVisibleServerNames) {
    setBatchBusy((current) => ({ ...current, agent: true }));
    try {
      for (const name of names || []) queueDiagnosticSkill(null, name);
      showNotice(`已加入 Agent 巡检队列：${(names || []).length} 台`);
    } finally {
      setBatchBusy((current) => ({ ...current, agent: false }));
    }
  }

  function openBatchEditServers(names = effectiveVisibleServerNames) {
    setBatchEditNames((names || []).filter((name) => servers[name]));
    setBatchEditOpen(true);
  }

  async function saveBatchEditedServers(patch) {
    let nextServers = { ...customServers };
    for (const name of batchEditNames) {
      if (!nextServers[name] && servers[name]) {
        nextServers = upsertCustomServer(nextServers, "", serverToHostForm(name, servers[name])).servers;
      }
    }
    const result = batchUpdateCustomServers(nextServers, batchEditNames, patch);
    setCustomServers(result.servers);
    await persistAppConfig(result.servers, modelConfig);
    setBatchEditOpen(false);
    showNotice(`批量编辑完成：${result.updated} 台`);
  }

  async function hideBuiltinServer(name) {
    if (!servers[name] || customServers[name]) return;
    const nextHidden = [...new Set([...(hiddenBuiltinServers || []), name])];
    setHiddenBuiltinServers(nextHidden);
    await persistAppConfig(customServers, modelConfig, customAgentCapabilities, modelProfiles, activeModelProfileId, nextHidden);
    await closeRemovedServerSession(name, "服务器已从列表隐藏");
    const remainingServerNames = Object.keys(buildVisibleServerMap(SERVER_DATA, customServers, nextHidden));
    removeClosedServerTab(name, remainingServerNames);
    clearRemovedServerState(name);
    await writeServerManagementLog("hide_builtin_server", name, servers[name]);
    showNotice(`已从列表隐藏：${name}`);
  }

  async function restoreHiddenBuiltinServers() {
    const restoredCount = (hiddenBuiltinServers || []).length;
    if (restoredCount === 0) {
      showNotice("当前没有隐藏的内置服务器。");
      return;
    }
    setHiddenBuiltinServers([]);
    await persistAppConfig(customServers, modelConfig, customAgentCapabilities, modelProfiles, activeModelProfileId, []);
    await writeServerManagementLog("restore_hidden_builtin_servers", "内置服务器", {}, { restoredCount });
    showNotice(`已恢复隐藏服务器：${restoredCount} 台`);
  }

  function openServerBackup(name = selectedServer) {
    const targetName = name || selectedServer;
    if (!servers[targetName]) {
      showNotice("请选择要备份的服务器。");
      return;
    }
    setBackupServerName(targetName);
    setBackupOpen(true);
  }

  async function toggleServerFavorite(name, isFavorite) {
    let nextServers = customServers;
    if (!nextServers[name] && servers[name]) {
      nextServers = upsertCustomServer(nextServers, "", serverToHostForm(name, servers[name])).servers;
    }
    const result = toggleCustomServerFavorite(nextServers, name, isFavorite);
    setCustomServers(result.servers);
    await persistAppConfig(result.servers, modelConfig);
    showNotice(isFavorite ? `已固定服务器：${name}` : `已取消固定：${name}`);
  }

  async function saveServerSftpBookmarks(serverName, nextBookmarks) {
    const name = serverName || selectedServer;
    if (!servers[name]) return [];
    let nextServers = customServers;
    if (!nextServers[name]) {
      nextServers = upsertCustomServer(nextServers, "", serverToHostForm(name, servers[name])).servers;
    }
    const bookmarks = normalizeSftpBookmarks(nextBookmarks);
    const updatedServers = {
      ...nextServers,
      [name]: {
        ...(nextServers[name] || {}),
        sftpBookmarks: bookmarks,
      },
    };
    setCustomServers(updatedServers);
    await persistAppConfig(updatedServers, modelConfig);
    return bookmarks;
  }

  async function addCurrentSftpBookmark(serverName = selectedServer) {
    const name = serverName || selectedServer;
    const path = currentSftpPath(name);
    const bookmarks = addSftpBookmark(servers[name]?.sftpBookmarks || [], path);
    await saveServerSftpBookmarks(name, bookmarks);
    showNotice(`已收藏目录：${path}`);
  }

  async function removeCurrentSftpBookmark(path, serverName = selectedServer) {
    const name = serverName || selectedServer;
    const bookmarks = removeSftpBookmark(servers[name]?.sftpBookmarks || [], path);
    await saveServerSftpBookmarks(name, bookmarks);
    showNotice(`已移除目录书签：${normalizeSftpPath(path)}`);
  }

  async function openSftpBookmark(path, serverName = selectedServer) {
    const name = serverName || selectedServer;
    if (!servers[name]) return;
    if (name !== selectedServer) selectServerTab(name);
    await refreshSelectedSftp(path, "", serverName);
  }

  async function trustSelectedHostKey(targetName = selectedServer) {
    const name = targetName || selectedServer;
    const server = servers[name];
    const hostKey = server?.hostKey;
    if (!hostKey?.sha256) {
      showNotice("当前服务器还没有可信任的 SSH 主机密钥，请先测试连接或连接一次后再信任。");
      return;
    }
    const trustPrompt = buildHostKeyTrustPrompt(name, hostKey, server.trustedHostKey);
    if (!trustPrompt.canTrust) {
      showNotice(trustPrompt.message);
      return;
    }
    setPendingConfirmAction({
      title: "信任 SSH 主机密钥",
      message: trustPrompt.message,
      detailLabel: "SSH 主机",
      detail: name,
      confirmLabel: "确认",
      danger: Boolean(server.trustedHostKey && server.trustedHostKey.sha256 && server.trustedHostKey.sha256 !== hostKey.sha256),
      onConfirm: () => confirmTrustSelectedHostKey(name, hostKey),
    });
  }

  async function confirmTrustSelectedHostKey(name, hostKey) {
    const server = servers[name];
    if (!hostKey?.sha256 || !server) return;
    const result = trustHostKeyForServer(customServers, name, hostKey);
    if (!result.trusted) {
      showNotice("未能保存 SSH 主机密钥信任状态，请检查服务器配置。");
      return;
    }
    setCustomServers(result.servers);
    await persistAppConfig(result.servers, modelConfig);
    setConnectionOverrides((current) => ({
      ...current,
      [name]: {
        ...(current[name] || {}),
        ...buildHostKeyEvidenceOverride((current[name] || server).evidence, hostKey, hostKey),
      },
    }));
    showNotice(`${name} 的 SSH 主机密钥已信任`);
  }

  async function revokeSelectedHostKeyTrust(targetName = selectedServer) {
    const name = targetName || selectedServer;
    const server = servers[name];
    if (!server?.trustedHostKey?.sha256) {
      showNotice("当前服务器没有已信任的 SSH 主机密钥。");
      return;
    }
    const trustedLine = `${server.trustedHostKey.type || "unknown"} ${server.trustedHostKey.sha256}`.trim();
    setPendingConfirmAction({
      title: "取消信任主机密钥",
      message: [`确定取消 ${name} 的 SSH 主机密钥信任吗？`, "", `已信任：${trustedLine}`, "", "下次连接会重新校验并提示信任。"].join("\\n"),
      detailLabel: "SSH 主机",
      detail: name,
      confirmLabel: "取消信任",
      danger: true,
      onConfirm: () => confirmRevokeSelectedHostKeyTrust(name),
    });
  }

  async function confirmRevokeSelectedHostKeyTrust(name) {
    const result = revokeHostKeyTrustForServer(customServers, name);
    if (!result.revoked) {
      showNotice("未能取消 SSH 主机密钥信任状态，请检查服务器配置。");
      return;
    }
    const nextServer = result.servers[name] || {};
    setCustomServers(result.servers);
    await persistAppConfig(result.servers, modelConfig);
    setConnectionOverrides((current) => ({
      ...current,
      [name]: {
        ...(current[name] || {}),
        trustedHostKey: undefined,
        hostKeyTrust: nextServer.hostKeyTrust,
        evidence: nextServer.evidence,
      },
    }));
    showNotice(`${name} 的 SSH 主机密钥信任已取消`);
  }
  async function testModelConnection(config) {
    const api = safeFileApi();
    const startedAt = performance.now();
    let result;
    if (!api?.test_model_connection && !api?.chat_with_model) {
      result = { ok: false, message: "\u5f53\u524d\u73af\u5883\u4e0d\u652f\u6301\u6a21\u578b API \u6d4b\u8bd5\uff0c\u8bf7\u4f7f\u7528\u6b63\u5f0f exe\u3002" };
    } else {
      const testConfig = hasNewModelApiKey(config.apiKey) ? { ...buildStoredModelConfig(config), apiKey: config.apiKey } : buildStoredModelConfig(config);
      result = api?.test_model_connection
        ? await api.test_model_connection(testConfig)
        : await api.chat_with_model(testConfig, [{ role: "user", content: "\u8bf7\u56de\u590d ok\uff0c\u7528\u4e8e\u6d4b\u8bd5\u6a21\u578b API \u8fde\u63a5\u3002" }]);
    }
    const nextProfiles = updateModelProfileTestResult(modelProfiles, activeModelProfileId, result, { latencyMs: Math.max(1, Math.round(performance.now() - startedAt)) });
    setModelProfiles(nextProfiles);
    await persistAppConfig(customServers, modelConfig, customAgentCapabilities, nextProfiles, activeModelProfileId);
    return result;
  }

  async function listModelOptions(config) {
    const api = safeFileApi();
    if (!api?.list_model_options) {
      const result = { ok: false, models: [], message: "\u5f53\u524d\u73af\u5883\u4e0d\u652f\u6301\u83b7\u53d6\u6a21\u578b\u5217\u8868\uff0c\u8bf7\u4f7f\u7528\u6b63\u5f0f exe\u3002" };
      await writeToolLogEvent({ level: "warn", component: "model-api", action: "list_models_failed", message: result.message, context: { provider: config.provider, baseUrl: config.baseUrl } });
      return result;
    }
    const listConfig = hasNewModelApiKey(config.apiKey) ? { ...buildStoredModelConfig(config), apiKey: config.apiKey } : buildStoredModelConfig(config);
    try {
      const result = await api.list_model_options(listConfig);
      if (!result?.ok) await writeToolLogEvent({ level: "warn", component: "model-api", action: "list_models_failed", message: result?.message || "\u83b7\u53d6\u6a21\u578b\u5217\u8868\u5931\u8d25", context: { provider: config.provider, baseUrl: config.baseUrl } });
      return result;
    } catch (error) {
      const message = `\u83b7\u53d6\u6a21\u578b\u5217\u8868\u5931\u8d25\uff1a${error.message || error}`;
      await writeToolLogEvent({ level: "error", component: "model-api", action: "list_models_error", message, context: { provider: config.provider, baseUrl: config.baseUrl } });
      return { ok: false, models: [], message };
    }
  }

  async function cacheModelOptions(profileDraft, models = []) {
    const storedConfig = buildStoredModelConfig({ ...(profileDraft.config || profileDraft), modelOptions: models });
    const nextProfile = buildModelProfile(storedConfig, { id: profileDraft.id || activeModelProfileId, name: profileDraft.name });
    const nextProfiles = upsertModelProfile(modelProfiles, nextProfile);
    setModelProfiles(nextProfiles);
    setActiveModelProfileId(nextProfile.id);
    setModelConfig(storedConfig);
    await persistAppConfig(customServers, storedConfig, customAgentCapabilities, nextProfiles, nextProfile.id);
  }

  async function prepareStoredModelConfig(nextConfig) {
    let storedConfig = buildStoredModelConfig(nextConfig);
    const newApiKey = hasNewModelApiKey(nextConfig.apiKey) ? nextConfig.apiKey : "";
    if (newApiKey) {
      const api = safeFileApi();
      if (!api?.save_model_api_key) {
        showNotice("\u6b63\u5f0f exe \u624d\u80fd\u5b89\u5168\u4fdd\u5b58 API Key\u3002");
        return null;
      }
      try {
        const result = await api.save_model_api_key(storedConfig, newApiKey);
        if (!result?.ok) {
          showNotice(result?.message || "API Key \u4fdd\u5b58\u5931\u8d25\u3002");
          return null;
        }
        storedConfig = buildStoredModelConfig(result.config);
      } catch (error) {
        showNotice(`API Key \u4fdd\u5b58\u5931\u8d25\uff1a${error.message || error}`);
        return null;
      }
    }
    return storedConfig;
  }

  async function selectModelProfile(profileId) {
    const profile = modelProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    setActiveModelProfileId(profile.id);
    setModelConfig(profile.config);
    await persistAppConfig(customServers, profile.config, customAgentCapabilities, modelProfiles, profile.id);
    showNotice(`\u5df2\u5207\u6362 API \u914d\u7f6e\uff1a${profile.name}`);
  }

  async function saveModelProfile(profileDraft) {
    const storedConfig = await prepareStoredModelConfig(profileDraft.config || profileDraft);
    if (!storedConfig) return false;
    const targetProfileId = profileDraft.id === "" ? "" : profileDraft.id || activeModelProfileId;
    const nextProfile = buildModelProfile(storedConfig, { id: targetProfileId, name: profileDraft.name });
    const nextProfiles = upsertModelProfile(modelProfiles, nextProfile);
    setModelProfiles(nextProfiles);
    setActiveModelProfileId(nextProfile.id);
    setModelConfig(storedConfig);
    await persistAppConfig(customServers, storedConfig, customAgentCapabilities, nextProfiles, nextProfile.id);
    showNotice(`API \u914d\u7f6e\u5df2\u4fdd\u5b58\uff1a${nextProfile.name}`);
    return nextProfile;
  }

  async function createModelProfile(profileDraft) {
    const storedConfig = await prepareStoredModelConfig(profileDraft.config || profileDraft);
    if (!storedConfig) return false;
    const nextProfile = buildModelProfile(storedConfig, { name: profileDraft.name });
    const nextProfiles = upsertModelProfile(modelProfiles, nextProfile);
    setModelProfiles(nextProfiles);
    setActiveModelProfileId(nextProfile.id);
    setModelConfig(storedConfig);
    await persistAppConfig(customServers, storedConfig, customAgentCapabilities, nextProfiles, nextProfile.id);
    showNotice(`API \u914d\u7f6e\u5df2\u65b0\u5efa\uff1a${nextProfile.name}`);
    return true;
  }

  async function deleteModelProfile(profileId) {
    const nextProfiles = removeModelProfile(modelProfiles, profileId, modelConfig);
    const nextActiveProfile = nextProfiles[0];
    setModelProfiles(nextProfiles);
    setActiveModelProfileId(nextActiveProfile.id);
    setModelConfig(nextActiveProfile.config);
    await persistAppConfig(customServers, nextActiveProfile.config, customAgentCapabilities, nextProfiles, nextActiveProfile.id);
    showNotice("API \u914d\u7f6e\u5df2\u5220\u9664\u3002");
  }

  async function saveModelConfig(nextConfig) {
    const storedConfig = await prepareStoredModelConfig(nextConfig);
    if (!storedConfig) return false;
    const activeProfile = modelProfiles.find((profile) => profile.id === activeModelProfileId);
    const nextProfile = buildModelProfile(storedConfig, { id: activeModelProfileId || activeProfile?.id || "default", name: activeProfile?.name || storedConfig.provider || "OpenAI \u517c\u5bb9" });
    const nextProfiles = upsertModelProfile(modelProfiles, nextProfile);
    setModelConfig(storedConfig);
    setModelProfiles(nextProfiles);
    setActiveModelProfileId(nextProfile.id);
    await persistAppConfig(customServers, storedConfig, customAgentCapabilities, nextProfiles, nextProfile.id);
    setSettingsOpen(false);
    showNotice(`\u6a21\u578b API \u914d\u7f6e\u5df2\u4fdd\u5b58\uff1a${storedConfig.provider} / ${storedConfig.model}`);
    return true;
  }
  function saveAgentCapabilities(nextCapabilities) {
    const nextCustomAgentCapabilities = getCustomAgentCapabilities(nextCapabilities);
    setCustomAgentCapabilities(nextCustomAgentCapabilities);
    persistAppConfig(customServers, modelConfig, nextCustomAgentCapabilities);
  }

  function saveTerminalTabs(nextTabs) {
    setTerminalTabs(nextTabs);
    writeLocalJson("sshAgentTerminalTabs", nextTabs);
  }

  function findVisibleTerminalTab(target = selectedTerminalTabId) {
    return visibleTerminalTabs.find((tab) => tab.id === target || tab.serverName === target) || visibleTerminalTabs[0] || null;
  }

  function resolveTerminalSessionKey(targetName = selectedServer, options = {}) {
    if (options.sessionKey) return options.sessionKey;
    const name = targetName || selectedServer;
    if (name === selectedServer) return selectedTerminalSessionKey;
    const tab = visibleTerminalTabs.find((item) => item.serverName === name);
    return tab?.id || name;
  }

  function resolveCommandInputKey(targetName = selectedServer, options = {}) {
    if (options.commandInputKey) return options.commandInputKey;
    return resolveTerminalSessionKey(targetName, options);
  }

  function selectTerminalTab(target) {
    const tab = findVisibleTerminalTab(target);
    if (!tab?.serverName) return;
    setSelectedTerminalTabId(tab.id);
    setSelectedServer(tab.serverName);
  }

  function selectServerTab(name, options = {}) {
    const sessionTab = options.sessionKey
      ? visibleTerminalTabs.find((tab) => tab.id === options.sessionKey)
      : null;
    const existingTab = sessionTab || visibleTerminalTabs.find((tab) => tab.serverName === name);
    if (existingTab) {
      setSelectedTerminalTabId(existingTab.id);
      setSelectedServer(name);
      return;
    }
    const nextTabs = [...visibleTerminalTabs, { id: name, serverName: name, title: name }].slice(-8);
    saveTerminalTabs(nextTabs);
    setSelectedTerminalTabId(name);
    setSelectedServer(name);
  }

  function openSavedServerTab(name, nextServers) {
    const nextServerNames = Object.keys(buildVisibleServerMap(SERVER_DATA, nextServers, hiddenBuiltinServers));
    const nextTabs = normalizeTerminalTabModels([...visibleTerminalTabs, { id: name, serverName: name, title: name }], nextServerNames);
    saveTerminalTabs(nextTabs);
    setSelectedTerminalTabId(name);
    setSelectedServer(name);
  }

  async function closeServerTab(target = selectedTerminalTabId) {
    const tab = findVisibleTerminalTab(target);
    if (!tab) return;
    const name = tab.serverName;
    const sessionKey = tab.id || name;
    const impact = getTerminalTabCloseImpact(sessionKey, sshSessions, name, tab);
    if (impact.blocked) {
      showNotice(impact.confirmMessage);
      return;
    }
    if (impact.hasActiveSession) {
      setPendingConfirmAction({
        title: "关闭 SSH 标签",
        message: impact.confirmMessage || "该标签仍有 SSH 会话，关闭前会先断开连接。",
        detailLabel: "SSH 主机",
        detail: name,
        confirmLabel: "关闭标签",
        danger: true,
        onConfirm: () => confirmCloseServerTab(tab.id),
      });
      return;
    }
    finalizeClosedServerTab(tab);
  }

  async function confirmCloseServerTab(target) {
    const tab = findVisibleTerminalTab(target);
    if (!tab) return;
    const name = tab.serverName;
    const sessionKey = tab.id || name;
    await closeSessionByName(name, "关闭 SSH 标签", { sessionKey, actor: "user" });
    finalizeClosedServerTab(tab);
  }
  function finalizeClosedServerTab(tab) {
    if (!tab) return;
    const sessionKey = tab.id || tab.serverName;
    const closedIndex = Math.max(0, visibleTerminalTabs.findIndex((item) => item.id === tab.id));
    const remainingTabs = visibleTerminalTabs.filter((item) => item.id !== tab.id);
    const fallbackTab = remainingTabs[Math.min(closedIndex, remainingTabs.length - 1)] || remainingTabs[0] || visibleTerminalTabs.find((item) => item.id !== tab.id) || visibleTerminalTabs[0];
    const nextTabs = remainingTabs.length ? remainingTabs : normalizeTerminalTabModels([serverNames[0]].filter(Boolean), serverNames);
    const nextSelectedTab = nextTabs.find((item) => item.id === selectedTerminalTabId) || fallbackTab || nextTabs[0];
    setTerminalAppends((current) => withoutObjectKey(current, sessionKey));
    delete terminalOpenLineRef.current[sessionKey];
    delete terminalControlModesRef.current[sessionKey];
    setTerminalClearMarkers((current) => withoutObjectKey(current, sessionKey));
    setCommandInputs((current) => withoutObjectKey(current, sessionKey));
    setHistoryCursors((current) => withoutObjectKey(current, sessionKey));
    setRecentlyClosedTerminalTabs((current) => [tab, ...current.filter((item) => item.id !== tab.id)].slice(0, 5));
    saveTerminalTabs(nextTabs);
    setSelectedTerminalTabId(nextSelectedTab?.id || "");
    setSelectedServer(nextSelectedTab?.serverName || serverNames[0] || "");
  }

  function reopenLastClosedServerTab() {
    const tab = recentlyClosedTerminalTabs.find((tab) => servers[tab.serverName]);
    if (!tab) {
      showNotice("\u6ca1\u6709\u53ef\u6062\u590d\u7684 SSH \u6807\u7b7e\u9875\u3002");
      return;
    }
    const nextTabs = normalizeTerminalTabModels([...visibleTerminalTabs, tab], serverNames);
    saveTerminalTabs(nextTabs);
    setSelectedTerminalTabId(tab.id);
    setSelectedServer(tab.serverName);
    setRecentlyClosedTerminalTabs((current) => current.filter((item) => item.id !== tab.id));
  }

  function openDuplicateSelectedTerminalTab(targetName = selectedServer) {
    const name = targetName || selectedServer;
    const result = createDuplicateTerminalTab(visibleTerminalTabs, name, serverNames, 8);
    saveTerminalTabs(normalizeTerminalTabModels(result.tabs, serverNames));
    setSelectedTerminalTabId(result.selectedTabId);
    setSelectedServer(name);
  }

  function renameSelectedTerminalTabTitle(targetTabId = selectedTerminalTabId) {
    const tab = findVisibleTerminalTab(targetTabId);
    if (!tab) return;
    setRenameTabDraft({ id: tab.id, serverName: tab.serverName, title: tab.title || tab.serverName });
  }

  function submitRenameTerminalTabTitle() {
    const draft = renameTabDraft;
    if (!draft?.id || !String(draft.title || "").trim()) return;
    const nextTabs = renameTerminalTabTitle(visibleTerminalTabs, draft.id, draft.title);
    saveTerminalTabs(normalizeTerminalTabModels(nextTabs, serverNames));
    setRenameTabDraft(null);
  }

  function toggleSelectedTerminalTabPinned(tabId = selectedTerminalTabId) {
    const nextTabs = toggleTerminalTabPinned(visibleTerminalTabs, tabId);
    saveTerminalTabs(normalizeTerminalTabModels(nextTabs, serverNames));
  }

  function moveSelectedTerminalTab(direction, targetTabId = selectedTerminalTabId) {
    const nextTabs = normalizeTerminalTabModels(moveTerminalTab(visibleTerminalTabs, targetTabId, direction), serverNames);
    saveTerminalTabs(nextTabs);
  }

  function requestCloseTerminalTabGroup(scope, anchorTabId = selectedTerminalTabId) {
    const closableTabIds = getClosableTerminalTabIds(visibleTerminalTabs, anchorTabId, scope);
    if (!closableTabIds.length) {
      showNotice("没有可关闭的标签页");
      return;
    }
    setPendingConfirmAction({
      title: "关闭 SSH 标签",
      message: `确定要关闭 ${closableTabIds.length} 个 SSH 标签页吗？相关 SSH 会话会一并断开。`,
      detailLabel: "标签页数量",
      detail: String(closableTabIds.length),
      confirmLabel: "关闭",
      danger: true,
      onConfirm: () => confirmCloseTerminalTabGroup(scope, closableTabIds),
    });
  }

  async function confirmCloseTerminalTabGroup(scope, closableTabIds) {
    const approvedTabIds = [];
    for (const tabId of closableTabIds || []) approvedTabIds.push(tabId);
    const closeState = closeTerminalTabModels(visibleTerminalTabs, approvedTabIds, selectedTerminalTabId, serverNames);
    for (const tab of closeState.closedTabs || []) {
      const sessionKey = tab.id || tab.serverName;
      if (sshSessions[sessionKey]?.sessionId) {
        await closeSessionByName(tab.serverName, "关闭 SSH 标签", { sessionKey, actor: "user" });
      }
    }
    const closedKeys = (closeState.closedTabs || []).map((tab) => tab.id || tab.serverName);
    saveTerminalTabs(closeState.tabs);
    setSelectedTerminalTabId(closeState.selectedTabId);
    setSelectedServer(closeState.selectedServer);
    setTerminalAppends((current) => removeObjectKeys(current, closedKeys));
    setTerminalClearMarkers((current) => removeObjectKeys(current, closedKeys));
    setCommandInputs((current) => removeObjectKeys(current, closedKeys));
    setHistoryCursors((current) => removeObjectKeys(current, closedKeys));
    closedKeys.forEach((key) => {
      delete terminalOpenLineRef.current[key];
      delete terminalControlModesRef.current[key];
    });
    setRecentlyClosedTerminalTabs((current) => [...(closeState.closedTabs || []), ...current.filter((item) => !closedKeys.includes(item.id))].slice(0, 5));
    showNotice(scope === "right" ? "已关闭右侧未固定标签。" : "已关闭其他未固定标签。");
  }

  function openNextServerTab() {
    const result = openNextTerminalTab(visibleTerminalTabs, serverNames, selectedServer);
    saveTerminalTabs(normalizeTerminalTabModels(result.tabs, serverNames));
    selectServerTab(result.selectedServer);
  }

  function selectAdjacentServerTab(direction) {
    if (!visibleTerminalTabs.length) return;
    const currentIndex = Math.max(0, visibleTerminalTabs.findIndex((tab) => tab.id === selectedTerminalTabId));
    const step = Number(direction) < 0 ? -1 : 1;
    const nextIndex = (currentIndex + step + visibleTerminalTabs.length) % visibleTerminalTabs.length;
    selectTerminalTab(visibleTerminalTabs[nextIndex]?.id);
  }

  function selectServerTabAtIndex(position) {
    const targetIndex = Number(position) - 1;
    if (targetIndex < 0 || targetIndex >= visibleTerminalTabs.length) return;
    selectTerminalTab(visibleTerminalTabs[targetIndex]?.id);
  }

  function applyTerminalZoom(action) {
    setTerminalFontSize((currentSize) => {
      const nextSize = adjustTerminalFontSize(currentSize, action);
      writeLocalJson("sshAgentTerminalFontSize", nextSize);
      showNotice(`终端字体大小：${nextSize}px`);
      return nextSize;
    });
  }

  function updateCommandInput(serverName, value) {
    setCommandInputs((current) => ({ ...current, [serverName]: value }));
    setHistoryCursors((current) => ({ ...current, [serverName]: createHistoryCursor(value) }));
  }

  function triggerSshOutputPoll() {
    setSshOutputPollTick((current) => current + 1);
  }

  function runTerminalShortcutAction(event) {
    const action = getTerminalShortcutAction(event, commandInputs[selectedCommandInputKey] || "");
    if (!action) return false;

    event.preventDefault();
    event.stopPropagation?.();

    if (action === "copy-output") {
      copySelectedTerminalTextOrOutput();
      return true;
    }
    if (action === "select-all-output") {
      selectCurrentTerminalOutput();
      return true;
    }
    if (action === "paste-command") {
      pasteClipboardToCommandInput({ sendToConnectedSession: true });
      return true;
    }
    if (action === "interrupt-session") {
      if (!sshSessions[selectedTerminalSessionKey]?.sessionId) return false;
      stopSelectedCommand();
      return true;
    }
    if (["zoom-in", "zoom-out", "zoom-reset"].includes(action)) {
      applyTerminalZoom(action);
      return true;
    }
    if (action === "toggle-terminal-focus") {
      setTerminalFocusMode((current) => !current);
      return true;
    }
    if (action === "clear-output") {
      clearSelectedTerminalOutput();
      return true;
    }
    if (action === "export-terminal-output") {
      exportSelectedTerminalOutput();
      return true;
    }
    if (action === "copy-ssh-command") {
      copyServerSshCommand(selectedServer);
      return true;
    }
    if (action === "clear-input") {
      updateCommandInput(selectedCommandInputKey, "");
      return true;
    }
    if (action === "disconnect-session") {
      closeSelectedSession();
      return true;
    }
    if (action === "reconnect-session") {
      if (sshSessions[selectedTerminalSessionKey]?.busy) {
        showNotice("\u5f53\u524d SSH \u4f1a\u8bdd\u6b63\u5728\u5904\u7406\u4efb\u52a1\uff0c\u8bf7\u7a0d\u540e\u518d\u91cd\u8fde\u3002");
        return true;
      }
      reconnectSelectedSession();
      return true;
    }
    if (action === "previous-tab") {
      selectAdjacentServerTab(-1);
      return true;
    }
    if (action === "next-tab") {
      selectAdjacentServerTab(1);
      return true;
    }
    const selectTabMatch = action.match(/^select-tab-(\d+)$/);
    if (selectTabMatch) {
      selectServerTabAtIndex(selectTabMatch[1]);
      return true;
    }
    if (action === "close-tab") {
      closeServerTab(selectedTerminalTabId);
      return true;
    }
    if (action === "duplicate-tab") {
      openDuplicateSelectedTerminalTab();
      return true;
    }
    if (action === "new-connection") {
      openNewHost();
      return true;
    }
    if (action === "open-backup-center") {
      setBackupOpen(true);
      return true;
    }
    if (action === "open-tool-logs") {
      openToolLogs();
      return true;
    }
    if (action === "rename-tab") {
      renameSelectedTerminalTabTitle();
      return true;
    }
    if (action === "edit-current-connection") {
      openEditHost(selectedServer);
      return true;
    }
    if (action === "open-auth-center") {
      openAuthCenter(selectedServer);
      return true;
    }
    if (action === "open-session-logs") {
      openSessionLogs({ server: selectedServer });
      return true;
    }
    if (action === "open-cwd-in-sftp") {
      openCurrentWorkingDirectoryInSftp();
      return true;
    }
    if (action === "toggle-pin-tab") {
      toggleSelectedTerminalTabPinned();
      return true;
    }
    if (action === "reopen-closed-tab") {
      reopenLastClosedServerTab();
      return true;
    }

    return false;
  }

  function handleTerminalShortcutKeyDown(event) {
    return runTerminalShortcutAction(event);
  }

  function handleCommandHistoryKeyDown(event) {
    const inputKey = selectedCommandInputKey;
    const isConnectedSession = Boolean(sshSessions[selectedTerminalSessionKey]?.sessionId);
    const isRunningSession = isTerminalInteractiveMode(sshSessions[selectedTerminalSessionKey]);

    const runningSessionControlInput = buildRunningSessionControlInput(event, commandInputs[inputKey] || "");
    if (runningSessionControlInput?.action === "interrupt" && isRunningSession) {
      event.preventDefault();
      stopSelectedCommand();
      return;
    }
    if (runningSessionControlInput?.action === "interrupt" && isConnectedSession && !isRunningSession) {
      event.preventDefault();
      sendSelectedSessionInput(event, { text: "\x03", submit: false, clearInput: true });
      return;
    }
    if (isRunningSession && runningSessionControlInput) {
      event.preventDefault();
      sendSelectedSessionInput(event, { ...runningSessionControlInput, clearInput: false });
      return;
    }

    const connectedShellFlowControlInput = isConnectedShellFlowControlKey(event) ? buildRunningSessionControlInput(event, "") : null;
    if (isConnectedSession && !isRunningSession && connectedShellFlowControlInput) {
      event.preventDefault();
      sendSelectedSessionInput(event, { ...connectedShellFlowControlInput, clearInput: false });
      return;
    }

    const connectedShellDirectControlInput = isConnectedShellDirectControlKey(event) ? runningSessionControlInput : null;
    if (isConnectedSession && !isRunningSession && connectedShellDirectControlInput) {
      event.preventDefault();
      sendSelectedSessionInput(event, { ...connectedShellDirectControlInput, clearInput: false });
      return;
    }

    const connectedShellScreenControlInput = isConnectedShellScreenControlKey(event) ? buildRunningSessionControlInput(event, "") : null;
    if (isConnectedSession && !isRunningSession && connectedShellScreenControlInput) {
      event.preventDefault();
      sendSelectedSessionInput(event, { ...connectedShellScreenControlInput, clearInput: false });
      return;
    }

    if (runTerminalShortcutAction(event)) return;

    if (event.key === "Enter" && !event.isComposing) {
      if (isRunningSession) {
        event.preventDefault();
        sendSelectedSessionInput(event, { submit: !event.ctrlKey });
        return;
      }
      if (isConnectedSession && !isRunningSession && !String(commandInputs[inputKey] || "").trim()) {
        event.preventDefault();
        sendSelectedSessionInput(event, { text: "", submit: true, clearInput: false });
        return;
      }
      if (!event.shiftKey) {
        event.preventDefault();
        sendSelectedCommand(event);
        return;
      }
    }

    const commandValue = commandInputs[inputKey] || "";
    if (!isRunningSession && event.key === "Tab" && String(commandValue || "").trim()) {
      event.preventDefault();
      const completion = completeCommandDraft(commandValue, commandHistories[selectedServer] || [], commandSnippets);
      if (!completion.completed) {
        if (completion.source === "multiple" && completion.candidates?.length) {
          showNotice(`命令补全候选：${completion.candidates.slice(0, 6).join("、")}`);
          return;
        }
        showNotice("没有匹配的命令补全。");
        return;
      }
      setCommandInputs((current) => ({ ...current, [inputKey]: completion.value }));
      setHistoryCursors((current) => ({ ...current, [inputKey]: createHistoryCursor(completion.value) }));
      window.requestAnimationFrame?.(() => {
        commandInputRef.current?.focus?.();
        commandInputRef.current?.setSelectionRange?.(completion.value.length, completion.value.length);
      });
      return;
    }

    const connectedShellMetaInput = buildRunningSessionMetaInput(event, commandValue);
    if (isConnectedSession && !isRunningSession && connectedShellMetaInput) {
      event.preventDefault();
      sendSelectedSessionInput(event, { ...connectedShellMetaInput, clearInput: false });
      return;
    }

    const connectedShellKeyInput = buildRunningSessionKeyInput(event.key, commandValue, event);
    if (isConnectedSession && !isRunningSession && connectedShellKeyInput) {
      event.preventDefault();
      sendSelectedSessionInput(event, { ...connectedShellKeyInput, clearInput: false });
      return;
    }

    const edit = applyTerminalCommandEditKey(
      event,
      commandValue,
      event.currentTarget?.selectionStart ?? commandValue.length,
      event.currentTarget?.selectionEnd ?? commandValue.length,
      { trackKillBuffer: true, killBuffer: commandKillBuffers[inputKey] || "" },
    );
    if (!isRunningSession && edit.handled) {
      event.preventDefault();
      setCommandInputs((current) => ({ ...current, [inputKey]: edit.value }));
      if (Object.prototype.hasOwnProperty.call(edit, "killBuffer")) {
        setCommandKillBuffers((current) => ({ ...current, [inputKey]: edit.killBuffer }));
      }
      setHistoryCursors((current) => ({ ...current, [inputKey]: createHistoryCursor(edit.value) }));
      window.requestAnimationFrame?.(() => {
        commandInputRef.current?.focus?.();
        commandInputRef.current?.setSelectionRange?.(edit.selectionStart, edit.selectionEnd);
      });
      return;
    }

    const runningSessionMetaInput = buildRunningSessionMetaInput(event, commandInputs[inputKey] || "");
    if (isRunningSession && runningSessionMetaInput) {
      event.preventDefault();
      sendSelectedSessionInput(event, { ...runningSessionMetaInput, clearInput: false });
      return;
    }

    const runningSessionKeyInput = buildRunningSessionKeyInput(event.key, commandInputs[inputKey] || "", event);
    if (isRunningSession && runningSessionKeyInput) {
      event.preventDefault();
      sendSelectedSessionInput(event, { ...runningSessionKeyInput, clearInput: false });
      return;
    }

    const runningSessionTextInput = buildRunningSessionTextInput(event, commandInputs[inputKey] || "");
    if (isRunningSession && runningSessionTextInput) {
      event.preventDefault();
      sendSelectedSessionInput(event, { ...runningSessionTextInput, clearInput: false });
      return;
    }

    const name = selectedServer;
    const history = commandHistories[name] || [];
    if (!isRunningSession && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "r") {
      event.preventDefault();
      const searchResult = searchCommandHistory(history, commandInputs[inputKey] || "");
      if (!searchResult.found) {
        showNotice(history.length ? "\u6ca1\u6709\u5339\u914d\u7684\u547d\u4ee4\u5386\u53f2\u3002" : "\u5f53\u524d\u670d\u52a1\u5668\u8fd8\u6ca1\u6709\u547d\u4ee4\u5386\u53f2\u3002");
        return;
      }
      setCommandInputs((current) => ({ ...current, [inputKey]: searchResult.value }));
      setHistoryCursors((current) => ({
        ...current,
        [inputKey]: { index: -1, draft: commandInputs[inputKey] || "", value: searchResult.value },
      }));
      showNotice(`\u5df2\u627e\u5230\u547d\u4ee4\u5386\u53f2\uff1a${searchResult.value}`);
      return;
    }

    const historyKeyAction = getCommandHistoryKeyAction(event);
    if (!historyKeyAction) return;

    if (historyKeyAction === "restore") {
      event.preventDefault();
      const draft = historyCursors[inputKey]?.draft ?? "";
      setCommandInputs((current) => ({ ...current, [inputKey]: draft }));
      setHistoryCursors((current) => ({ ...current, [inputKey]: createHistoryCursor(draft) }));
      return;
    }

    if (history.length === 0) return;

    event.preventDefault();
    const cursor = historyCursors[inputKey] || createHistoryCursor(commandInputs[inputKey] || "");
    const nextCursor = moveHistoryCursor(cursor, history, historyKeyAction);
    setCommandInputs((current) => ({ ...current, [inputKey]: nextCursor.value }));
    setHistoryCursors((current) => ({ ...current, [inputKey]: nextCursor }));
  }

  async function copyCommandSnippet(command) {
    const text = String(command || "").trim();
    if (!text) {
      showNotice("没有可复制的内容。");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    showNotice(`已复制：${text}`);
  }

  function useCommandSnippet(command) {
    updateCommandInput(selectedCommandInputKey, command);
    showNotice(`已填入命令：${command}`);
  }

  function useCommandHistoryItem(command) {
    const nextCommand = String(command || "");
    updateCommandInput(selectedCommandInputKey, nextCommand);
    setHistoryCursors((current) => ({ ...current, [selectedCommandInputKey]: createHistoryCursor(nextCommand) }));
    showNotice(`已从历史填入：${nextCommand}`);
  }

  function saveCommandSnippetFromText(commandText) {
    const command = String(commandText || "").trim();
    const validation = validateCustomCommandSnippet(command);
    if (!validation.ok) {
      showNotice(validation.message);
      return;
    }
    const nextSnippets = addCustomCommandSnippet(customCommandSnippets, command);
    if (nextSnippets.length === customCommandSnippets.length) {
      showNotice("没有可保存的命令。");
      return;
    }
    setCustomCommandSnippets(nextSnippets);
    writeLocalJson("sshAgentCustomCommandSnippets", nextSnippets);
    void persistAppConfig(customServers, modelConfig, customAgentCapabilities, modelProfiles, activeModelProfileId, hiddenBuiltinServers, portForwardPresets, nextSnippets);
    showNotice(`已保存命令：${command}`);
  }

  function saveCurrentCommandSnippet(inputKey = selectedCommandInputKey) {
    saveCommandSnippetFromText(commandInputs[inputKey] || "");
  }

  function removeSavedCommandSnippet(command) {
    const nextSnippets = removeCustomCommandSnippet(customCommandSnippets, command);
    setCustomCommandSnippets(nextSnippets);
    writeLocalJson("sshAgentCustomCommandSnippets", nextSnippets);
    void persistAppConfig(customServers, modelConfig, customAgentCapabilities, modelProfiles, activeModelProfileId, hiddenBuiltinServers, portForwardPresets, nextSnippets);
    showNotice(`已移除命令：${command}`);
  }
  function setTerminalScrollLockedFromWorkspace(nextLocked) {
    const locked = Boolean(nextLocked);
    setTerminalScrollLocked(locked);
    writeLocalJson("sshAgentTerminalScrollLocked", locked);
  }

  function toggleTerminalScrollLock() {
    setTerminalScrollLocked((current) => {
      const next = !current;
      writeLocalJson("sshAgentTerminalScrollLocked", next);
      return next;
    });
  }

  function clearSelectedCommandHistory(targetName = selectedServer, options = {}) {
    const name = targetName || selectedServer;
    const inputKey = resolveCommandInputKey(name, options);
    const history = commandHistories[name] || [];
    if (!history.length) {
      showNotice("当前服务器没有命令历史。");
      return;
    }
    setPendingConfirmAction({
      title: "清空命令历史",
      message: `确定要清空 ${name} 的命令历史吗？该操作不会影响 SSH 会话和服务器配置。`,
      detailLabel: "SSH 主机",
      detail: name,
      confirmLabel: "清空历史",
      danger: true,
      onConfirm: () => confirmClearSelectedCommandHistory(name, inputKey),
    });
  }

  function confirmClearSelectedCommandHistory(name, inputKey) {
    const nextHistories = clearCommandHistoryForServer(commandHistories, name);
    setCommandHistories(nextHistories);
    writeLocalJson("sshAgentCommandHistories", nextHistories);
    setHistoryCursors((current) => ({ ...current, [inputKey]: createHistoryCursor(commandInputs[inputKey] || "") }));
    showNotice(`${name} 的命令历史已清空。`);
  }

  function removeSelectedCommandHistoryItem(command) {
    const nextHistories = removeCommandFromHistoryForServer(commandHistories, selectedServer, command);
    if (nextHistories === commandHistories) {
      showNotice("没有找到要删除的历史命令。");
      return;
    }
    setCommandHistories(nextHistories);
    writeLocalJson("sshAgentCommandHistories", nextHistories);
    setHistoryCursors((current) => ({ ...current, [selectedCommandInputKey]: createHistoryCursor(commandInputs[selectedCommandInputKey] || "") }));
    showNotice(`已删除历史命令：${command}`);
  }

  function getTerminalLinesForSession(targetName = selectedServer, options = {}) {
    const name = targetName || selectedServer;
    const sessionKey = options.sessionKey || resolveTerminalSessionKey(name);
    return buildVisibleTerminalLines({
      baseLines: servers[name]?.terminal || [],
      appendedLines: terminalAppends[sessionKey] ? ["", ...terminalAppends[sessionKey]] : [],
      clearIndex: terminalClearMarkers[sessionKey] ?? null,
    });
  }

  async function copySelectedTerminalOutput(limit = null, targetName = selectedServer, options = {}) {
    const terminalLines = getTerminalLinesForSession(targetName, options);
    const text = formatTerminalClipboardText(terminalLines, limit);
    await copyTextToClipboard(text, limit ? "最近终端输出已复制" : "终端输出已复制");
  }

  async function copyRecentTerminalOutput(targetName = selectedServer, options = {}) {
    await copySelectedTerminalOutput(80, targetName, options);
  }

  function focusTerminalSearch(query = "") {
    const searchQuery = String(query || "").trim().slice(0, 160);
    setTerminalSearchFocusRequest((current) => ({ tick: current.tick + 1, query: searchQuery }));
  }

  async function copyCurrentCommandInput(inputKey = selectedCommandInputKey) {
    const command = commandInputs[inputKey] || "";
    await copyTextToClipboard(command, "当前命令已复制");
  }

  async function rerunLastCommandFromHistory(targetName = selectedServer, options = {}) {
    const name = targetName || selectedServer;
    const lastCommand = (commandHistories[name] || [])[0] || "";
    if (!lastCommand.trim()) {
      showNotice("当前服务器没有可重新执行的命令。");
      return null;
    }
    return await sendSelectedCommand(null, { ...options, targetName: name, command: lastCommand });
  }

  function scrollCurrentTerminalOutput(position) {
    const target = document.querySelector(".terminal-shell .terminal-output");
    if (!target) return;
    if (position === "top") {
      target.scrollTop = 0;
      setTerminalScrollLocked(true);
      return;
    }
    target.scrollTop = target.scrollHeight;
    setTerminalScrollLocked(false);
  }

  function selectCurrentTerminalOutput() {
    const target = document.querySelector(".terminal-shell .terminal-output");
    const selection = window.getSelection?.();
    if (!target || !selection || !document.createRange) return;
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
    showNotice("已全选终端输出");
  }

  function readSelectedTerminalText() {
    const selection = window.getSelection?.();
    const text = selection?.toString?.() || "";
    if (!text.trim()) return "";
    const terminalOutput = document.querySelector(".terminal-output");
    if (!terminalOutput || !selection?.rangeCount) return "";
    const range = selection.getRangeAt(0);
    const startNode = range.startContainer;
    const endNode = range.endContainer;
    if (!terminalOutput.contains(startNode) || !terminalOutput.contains(endNode)) return "";
    return formatTerminalSelectionText(text);
  }

  function hasSelectedTerminalText() {
    return Boolean(readSelectedTerminalText().trim());
  }

  async function copySelectedTerminalTextOnly() {
    const content = readSelectedTerminalText();
    if (!content.trim()) {
      showNotice("没有选中的终端内容。");
      return false;
    }
    await copyTextToClipboard(content, "选中的终端内容已复制");
    return true;
  }

  async function copySelectedTerminalTextOrOutput(targetName = selectedServer, options = {}) {
    if (hasSelectedTerminalText()) {
      await copySelectedTerminalTextOnly();
      return;
    }
    await copySelectedTerminalOutput(null, targetName, options);
  }

  async function copyTerminalLineOutput(lineIndex, targetName = selectedServer, options = {}) {
    const terminalLines = getTerminalLinesForSession(targetName, options);
    const line = terminalLines[Number(lineIndex)] || "";
    const content = formatTerminalClipboardText([line]);
    if (!content.trim()) {
      showNotice("请选择一行终端输出。");
      return;
    }
    await copyTextToClipboard(content, "当前行已复制");
  }

  function useTerminalLineCommand(lineIndex, targetName = selectedServer, options = {}) {
    const terminalLines = getTerminalLinesForSession(targetName, options);
    const command = extractTerminalCommandFromLine(terminalLines[Number(lineIndex)] || "");
    if (!command) {
      showNotice("当前行不是可复用的命令。");
      return;
    }
    const inputKey = options.commandInputKey || resolveCommandInputKey(targetName, { sessionKey: options.sessionKey });
    updateCommandInput(inputKey, command);
    showNotice("已填入当前命令");
  }

  async function copyTerminalLineCommandOutputBlock(lineIndex, targetName = selectedServer, options = {}) {
    const terminalLines = getTerminalLinesForSession(targetName, options);
    const block = buildTerminalCommandOutputBlock(terminalLines, Number(lineIndex));
    const content = formatTerminalClipboardText(block);
    if (!content.trim()) {
      showNotice("当前没有可复制的命令块。");
      return;
    }
    await copyTextToClipboard(content, "当前命令块已复制");
  }

  async function exportSelectedTerminalOutput(targetName = selectedServer, options = {}) {
    const name = targetName || selectedServer;
    const terminalLines = getTerminalLinesForSession(targetName, options);
    const content = buildTerminalExportText(name, terminalLines);
    if (!formatTerminalClipboardText(terminalLines).trim()) {
      showNotice("没有可用的终端内容。");
      return;
    }
    const fileName = buildTerminalExportFileName(name);
    const api = safeFileApi();
    if (api?.save_text_file) {
      const target = await api.save_text_file(fileName, content);
      if (target) showNotice(`已导出：${target}`);
      return;
    }
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    showNotice("操作已完成");
  }

  async function exportTerminalLineCommandOutputBlock(lineIndex, targetName = selectedServer, options = {}) {
    const name = targetName || selectedServer;
    const terminalLines = getTerminalLinesForSession(targetName, options);
    const block = buildTerminalCommandOutputBlock(terminalLines, Number(lineIndex));
    if (!formatTerminalClipboardText(block).trim()) {
      showNotice("当前没有可引用的终端输出。");
      return;
    }
    const content = buildTerminalExportText(name, block);
    const fileName = buildTerminalExportFileName(name);
    const api = safeFileApi();
    if (api?.save_text_file) {
      const target = await api.save_text_file(fileName, content);
      if (target) showNotice(`已导出：${target}`);
      return;
    }
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    showNotice("操作已完成");
  }

  function draftAgentTerminalAnalysis(targetName = selectedServer, options = {}) {
    const terminalLines = getTerminalLinesForSession(targetName, options);
    const recentOutput = formatTerminalClipboardText(terminalLines, 80);
    if (!recentOutput.trim()) {
      showNotice("没有可发送给 Agent 分析的终端内容。");
      return;
    }
    setAgentDraftRequest({
      text: `请分析这段 SSH 终端输出，并给出排障建议。\n\n${recentOutput}`,
      nonce: Date.now(),
    });
  }

  function draftAgentTerminalLineAnalysis(lineIndex, targetName = selectedServer, options = {}) {
    const terminalLines = getTerminalLinesForSession(targetName, options);
    const line = terminalLines[Number(lineIndex)] || "";
    if (!line.trim()) {
      showNotice("请选择一行终端输出。");
      return;
    }
    setAgentDraftRequest({ text: `请解释这行 SSH 输出：\n\n${line}`, nonce: Date.now() });
  }

  function draftAgentTerminalCommandOutputAnalysis(lineIndex, targetName = selectedServer, options = {}) {
    const terminalLines = getTerminalLinesForSession(targetName, options);
    const block = buildTerminalCommandOutputBlock(terminalLines, Number(lineIndex));
    const text = formatTerminalClipboardText(block);
    if (!text.trim()) {
      showNotice("没有可用的终端内容。");
      return;
    }
    setAgentDraftRequest({ text: `请解释这段 SSH 输出：\n\n${text}`, nonce: Date.now() });
  }

  function draftAgentSftpPreviewAnalysis(file = null) {
    const content = sftpPreview?.content || "";
    if (!content.trim()) {
      showNotice("请先预览 SFTP 文件，再引用给 Agent。");
      return;
    }
    const name = file?.name || sftpPreview?.name || selectedFile?.name || "SFTP 文件";
    setAgentDraftRequest({ text: `请分析 SFTP 文件 ${name} 的内容，并给出建议。\n\n${content}`, nonce: Date.now() });
  }
  async function pasteClipboardToCommandInput(options = {}) {
    if (!navigator.clipboard?.readText) {
      showNotice("当前环境不支持读取剪贴板。");
      return;
    }
    try {
      const targetName = options.targetName || selectedServer;
      const sessionKey = options.sessionKey || resolveTerminalSessionKey(targetName);
      const inputKey = options.commandInputKey || resolveCommandInputKey(targetName, { sessionKey });
      const text = await navigator.clipboard.readText();
      if (!text) {
        showNotice("剪贴板为空");
        return;
      }
      const runningSession = sshSessions[sessionKey];
      const shouldPasteIntoConnectedSession = Boolean(options?.sendToConnectedSession && runningSession?.sessionId && !(commandInputs[inputKey] || "").trim());
      if (shouldPasteIntoConnectedSession || (runningSession?.busy && runningSession?.sessionId)) {
        let interactivePastePlan = prepareInteractiveClipboardPaste(text);
        if (interactivePastePlan.requiresConfirmation) {
          setPendingConfirmAction({
            title: "确认粘贴到 SSH 程序",
            message: `${interactivePastePlan.message}\n\n确认后会把内容发送到当前 SSH 会话。`,
            detailLabel: "SSH 主机",
            detail: targetName,
            confirmLabel: "确认",
            danger: true,
            onConfirm: () => confirmInteractiveClipboardPaste(text, sessionKey, targetName),
          });
          return;
        }
        const bracketedPasteEnabled = Boolean(terminalControlModesRef.current[sessionKey]?.bracketedPaste);
        const pasteText = wrapBracketedPasteText(interactivePastePlan.text, bracketedPasteEnabled);
        await sendSelectedSessionInput(null, { text: pasteText, submit: false, clearInput: false, sessionKey, targetName });
        showNotice("已粘贴到当前 SSH 程序。");
        return;
      }
      const existing = commandInputs[inputKey] || "";
      const pastePlan = prepareClipboardCommandPaste(text, existing);
      if (pastePlan.requiresConfirmation) {
        setPendingConfirmAction({
          title: "确认多行粘贴",
          message: pastePlan.message,
          detailLabel: "操作详情",
          detail: targetName,
          confirmLabel: "确认",
          danger: true,
          onConfirm: () => confirmClipboardCommandPaste(text, existing, inputKey),
        });
        return;
      }
      updateCommandInput(inputKey, pastePlan.nextCommand);
    } catch (error) {
      showNotice(`操作失败：${error.message || error}`);
    }
  }

  function confirmInteractiveClipboardPaste(text, sessionKey, targetName) {
    const interactivePastePlan = prepareInteractiveClipboardPaste(text, { allowRiskyPaste: true });
    const bracketedPasteEnabled = Boolean(terminalControlModesRef.current[sessionKey]?.bracketedPaste);
    const pasteText = wrapBracketedPasteText(interactivePastePlan.text, bracketedPasteEnabled);
    void sendSelectedSessionInput(null, { text: pasteText, submit: false, clearInput: false, sessionKey, targetName });
  }

  function confirmClipboardCommandPaste(text, existing, inputKey) {
    const plan = prepareClipboardCommandPaste(text, existing, { allowMultiline: true });
    updateCommandInput(inputKey, plan.nextCommand);
  }
  function getSftpRemotePath(file = null) {
    const item = file || selectedFile;
    if (!item) return currentSftpPath();
    return item.path || resolveSftpChildPath(currentSftpPath(), item.name);
  }

  function getSftpTerminalCommandPath(action, file = null) {
    const remotePath = getSftpRemotePath(file);
    if (action === "cd" && file && file.type !== "folder") return getParentSftpPath(remotePath);
    return remotePath;
  }

  async function copySftpRemotePath(file = null) {
    const remotePath = getSftpRemotePath(file);
    await copyTextToClipboard(remotePath, `SFTP 路径已复制：${remotePath}`);
  }

  async function copySftpItemName(file = null) {
    const item = file || selectedFile;
    if (!item?.name) return;
    await copyTextToClipboard(item.name, `已复制文件名：${item.name}`);
  }

  async function copySftpTerminalCommand(action, file = null) {
    const remotePath = getSftpTerminalCommandPath(action, file);
    const command = buildSftpTerminalCommand(action, remotePath);
    await copyTextToClipboard(command, `SSH 命令已复制：${command}`);
  }

  function insertSftpPathToCommandInput(file = null) {
    updateCommandInput(selectedCommandInputKey, quoteSftpPathForShell(getSftpRemotePath(file)));
    showNotice("SFTP 路径已填入命令框。");
  }

  function insertSftpCommandToCommandInput(action, file = null) {
    const command = buildSftpTerminalCommand(action, getSftpTerminalCommandPath(action, file));
    updateCommandInput(selectedCommandInputKey, command);
    showNotice("SSH 命令已填入：" + command);
  }

  async function executeSftpCommandInTerminal(action, file = null) {
    const command = buildSftpTerminalCommand(action, getSftpTerminalCommandPath(action, file));
    await sendSelectedCommand(null, { command, targetName: selectedServer });
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  function placeContextMenu(event, model, items) {
    event?.preventDefault?.();
    const position = getContextMenuPosition({
      clientX: event?.clientX ?? 0,
      clientY: event?.clientY ?? 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setContextMenu({ title: model?.title || "", ...position, items: mergeContextMenuItems(items) });
  }

  function openTerminalContextMenu(event, tabId = selectedTerminalTabId) {
    const contextTab = findVisibleTerminalTab(tabId) || selectedTerminalTab;
    const contextServer = contextTab?.serverName || selectedServer;
    const contextSessionKey = contextTab?.id || resolveTerminalSessionKey(contextServer);
    if (contextTab?.id) {
      setSelectedTerminalTabId(contextTab.id);
      setSelectedServer(contextServer);
    }
    const contextSession = sshSessions[contextSessionKey] || {};
    const terminalSession = contextSession;
    const terminalSessionReconnectable = Boolean(terminalSession.lastError || terminalSession.disconnectedAt);
    const terminalSessionShouldReconnect = Boolean(terminalSession.sessionId || terminalSessionReconnectable);
    const tabIndex = visibleTerminalTabs.findIndex((tab) => tab.id === contextSessionKey);
    const contextTerminalLines = getTerminalLinesForSession(contextServer, { sessionKey: contextSessionKey });
    const outputLineElement = event.target?.closest?.("[data-terminal-line]");
    const clickedOutputLineIndex = outputLineElement ? Number.parseInt(outputLineElement.dataset.terminalLine, 10) : NaN;
    const contextOutputLineIndex = Number.isInteger(clickedOutputLineIndex) ? clickedOutputLineIndex : Math.max(0, contextTerminalLines.length - 1);
    const contextOutputCommand = extractTerminalCommandFromLine(contextTerminalLines[contextOutputLineIndex] || "");
    const selectedTerminalText = String(window.getSelection?.()?.toString?.() || "").trim();
    const commandInputKey = resolveCommandInputKey(contextServer, { sessionKey: contextSessionKey });
    const hasCommandDraft = Boolean(commandInputs[commandInputKey]);
    const terminalModel = buildTerminalContextActionModel({
      serverName: contextServer,
      session: contextSession,
      tab: contextTab,
      tabIndex,
      tabCount: visibleTerminalTabs.length,
      hasTerminalOutput: contextTerminalLines.length > 0,
      hasTerminalTextSelection: Boolean(selectedTerminalText),
      hasCurrentTerminalLine: Number.isInteger(clickedOutputLineIndex),
      hasCurrentTerminalCommand: Boolean(contextOutputCommand),
      hasCommandDraft,
      hasSelectedCommandBlock: contextTerminalLines.length > 0,
      hasClosedTabs: recentlyClosedTerminalTabs.length > 0,
      isCustomServer: Boolean(customServers[contextServer]),
    });
    const terminalModelActions = {
      "copy-selection-or-output": () => copySelectedTerminalTextOrOutput(contextServer, { sessionKey: contextSessionKey }),
      "select-all-output": () => selectCurrentTerminalOutput(),
      "copy-current-line": () => copyTerminalLineOutput(contextOutputLineIndex, contextServer, { sessionKey: contextSessionKey }),
      "use-current-line-command": () => useTerminalLineCommand(contextOutputLineIndex, contextServer, { sessionKey: contextSessionKey, commandInputKey }),
      "copy-command-block": () => copyTerminalLineCommandOutputBlock(contextOutputLineIndex, contextServer, { sessionKey: contextSessionKey }),
      "save-command-snippet": () => saveCurrentCommandSnippet(commandInputKey),
      "paste-to-terminal": () => pasteClipboardToCommandInput({ sendToConnectedSession: true, targetName: contextServer, sessionKey: contextSessionKey }),
      "search-terminal-output": () => focusTerminalSearch(selectedTerminalText),
      "clear-terminal-output": () => clearSelectedTerminalOutput(contextServer, { sessionKey: contextSessionKey }),
      "interrupt-terminal-command": () => sendTerminalControlSignal("interrupt", contextServer, { sessionKey: contextSessionKey }),
      "send-alt-left": () => sendTerminalControlSignal("alt-left", contextServer, { sessionKey: contextSessionKey }),
      "send-alt-right": () => sendTerminalControlSignal("alt-right", contextServer, { sessionKey: contextSessionKey }),
      "send-ctrl-left": () => sendTerminalControlSignal("ctrl-left", contextServer, { sessionKey: contextSessionKey }),
      "send-ctrl-right": () => sendTerminalControlSignal("ctrl-right", contextServer, { sessionKey: contextSessionKey }),
      "send-alt-backspace": () => sendTerminalControlSignal("alt-backspace", contextServer, { sessionKey: contextSessionKey }),
      "send-alt-b": () => sendTerminalControlSignal("alt-b", contextServer, { sessionKey: contextSessionKey }),
      "send-alt-f": () => sendTerminalControlSignal("alt-f", contextServer, { sessionKey: contextSessionKey }),
      "send-alt-d": () => sendTerminalControlSignal("alt-d", contextServer, { sessionKey: contextSessionKey }),
      "send-ctrl-y": () => sendTerminalControlSignal("yank-kill-buffer", contextServer, { sessionKey: contextSessionKey }),
      "check-terminal-session-health": () => checkSelectedSessionHealth(contextServer, { sessionKey: contextSessionKey }),
      "reconnect-terminal-session": () => terminalSessionShouldReconnect ? reconnectSelectedSession(contextServer, { sessionKey: contextSessionKey }) : openSelectedSession(contextServer, { sessionKey: contextSessionKey }),
      "reconnect-and-clear-session": () => reconnectAndClearSelectedSession(contextServer, { sessionKey: contextSessionKey }),
      "disconnect-terminal-session": () => closeSelectedSession(contextServer, { sessionKey: contextSessionKey }),
      "duplicate-terminal-tab": () => openDuplicateSelectedTerminalTab(contextServer),
      "rename-terminal-tab": () => renameSelectedTerminalTabTitle(contextSessionKey),
      "toggle-pin-terminal-tab": () => toggleSelectedTerminalTabPinned(contextSessionKey),
      "move-terminal-tab-left": () => moveSelectedTerminalTab(-1, contextSessionKey),
      "move-terminal-tab-right": () => moveSelectedTerminalTab(1, contextSessionKey),
      "close-current-terminal-tab": () => closeServerTab(contextSessionKey),
      "reopen-closed-terminal-tab": () => reopenLastClosedServerTab(),
      "close-other-terminal-tabs": () => requestCloseTerminalTabGroup("others", contextSessionKey),
      "close-right-terminal-tabs": () => requestCloseTerminalTabGroup("right", contextSessionKey),
      "send-command-to-agent": () => draftAgentTerminalAnalysis(contextServer, { sessionKey: contextSessionKey }),
      "export-terminal-output": () => exportSelectedTerminalOutput(contextServer, { sessionKey: contextSessionKey }),
      "open-session-logs": () => openSessionLogs({ server: contextServer }),
      "edit-terminal-connection": () => openEditHost(contextServer),
      "delete-terminal-server": () => customServers[contextServer] ? deleteSelectedHost(contextServer) : hideBuiltinServer(contextServer),
    };
    const extraItems = [
      { id: "run-command", label: "执行当前命令", disabled: terminalSession.busy || !hasCommandDraft, onSelect: () => sendSelectedCommand(null, { targetName: contextServer, sessionKey: contextSessionKey, commandInputKey }) },
      { id: "rerun-last-command", label: "重新执行上一条命令", disabled: terminalSession.busy || !(commandHistories[contextServer] || [])[0], onSelect: () => rerunLastCommandFromHistory(contextServer, { sessionKey: contextSessionKey, commandInputKey }) },
      { id: "copy-command-input", label: "复制当前命令", disabled: !hasCommandDraft, onSelect: () => copyCurrentCommandInput(commandInputKey) },
      { id: "clear-command-input", label: "清空命令输入", disabled: !hasCommandDraft, onSelect: () => updateCommandInput(commandInputKey, "") },
      { id: "clear-command-history", label: "清空命令历史", disabled: !(commandHistories[contextServer] || []).length, onSelect: () => clearSelectedCommandHistory(contextServer, { commandInputKey }) },
      { id: "test-current-connection", label: "测试连接", disabled: Boolean(testingConnections[contextServer]), onSelect: () => testSelectedConnection(contextServer) },
      { id: "disconnect-session", label: terminalSession.busy ? "强制断开会话" : "断开当前会话", disabled: !terminalSession.sessionId, onSelect: () => closeSelectedSession(contextServer, { sessionKey: contextSessionKey }) },
      { id: "copy-terminal-cwd", label: "复制当前远程目录", onSelect: () => copyCurrentWorkingDirectory(contextServer, { sessionKey: contextSessionKey }) },
      { id: "open-terminal-cwd-in-sftp", label: "在 SFTP 打开当前目录", shortcut: "Ctrl+Shift+O", onSelect: () => openCurrentWorkingDirectoryInSftp(contextServer, { sessionKey: contextSessionKey }) },
      { id: "copy-terminal-ssh-command", label: "复制 SSH 命令", onSelect: () => copyServerSshCommand(contextServer) },
      { id: "copy-terminal-server-info", label: "复制连接信息", onSelect: () => copyServerConnectionInfo(contextServer) },
      { id: "copy-terminal-openssh-config", label: "复制 OpenSSH Config", onSelect: () => copyServerOpenSshConfig(contextServer) },
    ];
    extraItems.push(
      { id: "explain-current-line", label: "解释当前行", disabled: !Number.isInteger(clickedOutputLineIndex), onSelect: () => draftAgentTerminalLineAnalysis(contextOutputLineIndex, contextServer, { sessionKey: contextSessionKey }) },
      { id: "explain-command-block", label: "解释当前命令块", disabled: contextTerminalLines.length === 0, onSelect: () => draftAgentTerminalCommandOutputAnalysis(contextOutputLineIndex, contextServer, { sessionKey: contextSessionKey }) },
      { id: "copy-recent-output", label: "复制最近输出", disabled: contextTerminalLines.length === 0, onSelect: () => copyRecentTerminalOutput(contextServer, { sessionKey: contextSessionKey }) },
      { id: "scroll-output-top", label: "滚动到顶部", disabled: contextTerminalLines.length === 0, onSelect: () => scrollCurrentTerminalOutput("top") },
      { id: "scroll-output-bottom", label: "滚动到底部", disabled: contextTerminalLines.length === 0, onSelect: () => scrollCurrentTerminalOutput("bottom") },
      { id: "copy-terminal-error-detail", label: "复制 SSH 错误详情", disabled: !terminalSessionReconnectable, onSelect: () => copySelectedSessionErrorDetail(contextServer, contextSessionKey) },
      { id: "copy-terminal-diagnostic-summary", label: "复制 SSH 诊断摘要", onSelect: () => copySelectedSessionDiagnosticSummary(contextServer, contextSessionKey) },
      { id: "copy-terminal-troubleshooting-summary", label: "复制排障摘要", onSelect: () => copyServerTroubleshootingSummary(contextServer) },
      { id: "edit-terminal-connection", label: "编辑当前连接", onSelect: () => openEditHost(contextServer) },
      { id: "terminal-auth-center", label: "认证中心", shortcut: "Ctrl+Shift+K", onSelect: () => openAuthCenter(contextServer) },
      { id: "terminal-session-logs", label: "查看会话日志", onSelect: () => openSessionLogs({ server: contextServer }) },
      { id: "terminal-tool-logs", label: "查看工具日志", shortcut: "Ctrl+Shift+G", onSelect: () => openToolLogs({ query: contextServer }) },
      { id: "export-terminal-server-profile", label: "导出连接档案", onSelect: () => exportServerProfile(contextServer) },
      { id: "export-diagnostic-package", label: "导出诊断包", onSelect: exportDiagnosticPackage },
    );
    if (terminalSession.sessionId) {
      extraItems.push(
        { id: "section-send-keys", section: true, label: "发送按键" },
        { id: "send-enter", label: "发送 Enter", onSelect: () => sendTerminalControlSignal("enter", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-tab", label: "发送 Tab", onSelect: () => sendTerminalControlSignal("tab", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-escape", label: "发送 Esc", onSelect: () => sendTerminalControlSignal("escape", contextServer, { sessionKey: contextSessionKey }) },
        { id: "section-navigation-controls", section: true, label: "导航键" },
        { id: "send-page-up", label: "发送 PageUp", onSelect: () => sendTerminalControlSignal("page-up", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-page-down", label: "发送 PageDown", onSelect: () => sendTerminalControlSignal("page-down", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-home", label: "发送 Home", onSelect: () => sendTerminalControlSignal("home", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-end", label: "发送 End", onSelect: () => sendTerminalControlSignal("end", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-delete", label: "发送 Delete", onSelect: () => sendTerminalControlSignal("delete", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-insert", label: "发送 Insert", onSelect: () => sendTerminalControlSignal("insert", contextServer, { sessionKey: contextSessionKey }) },
        { id: "section-function-keys", section: true, label: "功能键" },
        { id: "send-f1", label: "发送 F1", onSelect: () => sendTerminalControlSignal("f1", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-f2", label: "发送 F2", onSelect: () => sendTerminalControlSignal("f2", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-f3", label: "发送 F3", onSelect: () => sendTerminalControlSignal("f3", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-f4", label: "发送 F4", onSelect: () => sendTerminalControlSignal("f4", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-f5", label: "发送 F5", onSelect: () => sendTerminalControlSignal("f5", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-f6", label: "发送 F6", onSelect: () => sendTerminalControlSignal("f6", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-f7", label: "发送 F7", onSelect: () => sendTerminalControlSignal("f7", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-f8", label: "发送 F8", onSelect: () => sendTerminalControlSignal("f8", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-f9", label: "发送 F9", onSelect: () => sendTerminalControlSignal("f9", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-f10", label: "发送 F10", onSelect: () => sendTerminalControlSignal("f10", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-f11", label: "发送 F11", onSelect: () => sendTerminalControlSignal("f11", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-f12", label: "发送 F12", onSelect: () => sendTerminalControlSignal("f12", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-d", label: "发送 Ctrl+D", onSelect: () => sendTerminalControlSignal("eof", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-z", label: "发送 Ctrl+Z", onSelect: () => sendTerminalControlSignal("suspend", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-backslash", label: "发送 Ctrl\\", onSelect: () => sendTerminalControlSignal("quit", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-right-bracket", label: "发送 Ctrl+]", onSelect: () => sendTerminalControlSignal("escape-control", contextServer, { sessionKey: contextSessionKey }) },
        { id: "section-edit-controls", section: true, label: "编辑控制" },
        { id: "send-ctrl-a", label: "发送 Ctrl+A", onSelect: () => sendTerminalControlSignal("line-start", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-b", label: "发送 Ctrl+B", onSelect: () => sendTerminalControlSignal("cursor-left-char", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-e", label: "发送 Ctrl+E", onSelect: () => sendTerminalControlSignal("line-end", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-f", label: "发送 Ctrl+F", onSelect: () => sendTerminalControlSignal("cursor-right-char", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-g", label: "发送 Ctrl+G", onSelect: () => sendTerminalControlSignal("cancel-readline", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-h", label: "发送 Ctrl+H", onSelect: () => sendTerminalControlSignal("backspace-control", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-u", label: "发送 Ctrl+U", onSelect: () => sendTerminalControlSignal("clear-before-cursor", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-k", label: "发送 Ctrl+K", onSelect: () => sendTerminalControlSignal("clear-after-cursor", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-w", label: "发送 Ctrl+W", onSelect: () => sendTerminalControlSignal("delete-previous-word", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-y", label: "发送 Ctrl+Y", onSelect: () => sendTerminalControlSignal("yank-kill-buffer", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-alt-backspace", label: "发送 Alt+Backspace", onSelect: () => sendTerminalControlSignal("alt-backspace", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-alt-b", label: "发送 Alt+B", onSelect: () => sendTerminalControlSignal("alt-b", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-alt-f", label: "发送 Alt+F", onSelect: () => sendTerminalControlSignal("alt-f", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-alt-d", label: "发送 Alt+D", onSelect: () => sendTerminalControlSignal("alt-d", contextServer, { sessionKey: contextSessionKey }) },
        { id: "section-history-screen", section: true, label: "历史与屏幕" },
        { id: "send-ctrl-r", label: "发送 Ctrl+R", onSelect: () => sendTerminalControlSignal("history-search", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-p", label: "发送 Ctrl+P", onSelect: () => sendTerminalControlSignal("history-previous", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-n", label: "发送 Ctrl+N", onSelect: () => sendTerminalControlSignal("history-next", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-l", label: "发送 Ctrl+L", onSelect: () => sendTerminalControlSignal("clear-remote-screen", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-s", label: "发送 Ctrl+S", onSelect: () => sendTerminalControlSignal("pause-output", contextServer, { sessionKey: contextSessionKey }) },
        { id: "send-ctrl-q", label: "发送 Ctrl+Q", onSelect: () => sendTerminalControlSignal("resume-output", contextServer, { sessionKey: contextSessionKey }) },
        { id: "finish-interactive-mode", label: "退出交互模式", disabled: !(terminalSession.busy && terminalSession.sessionId), onSelect: () => finishSelectedInteractiveMode(contextServer, { sessionKey: contextSessionKey }) },
      );
    }
    placeContextMenu(
      event,
      terminalModel,
      [
        ...terminalModel.items.map((item) => item.separator || item.section ? item : { ...item, onSelect: terminalModelActions[item.id] }),
        ...extraItems,
      ],
    );
  }

  function openTerminalTabContextMenu(event, tabId) {
    openTerminalContextMenu(event, tabId);
  }

  function openServerContextMenu(event, name = selectedServer) {
    const targetName = name || selectedServer;
    const server = servers[targetName];
    if (!server) return;
    const sessionKey = resolveTerminalSessionKey(targetName);
    const model = buildServerContextActionModel(targetName, {
      server,
      session: sshSessions[sessionKey] || {},
      isCustomServer: Boolean(customServers[targetName]),
      sftpBusy: Boolean(sftpBusy[targetName]),
    });
    const actions = {
      connect: () => {
        setSelectedServer(targetName);
        return openSelectedSession(targetName);
      },
      "open-server-new-terminal-tab": () => openDuplicateSelectedTerminalTab(targetName),
      "connect-server-new-terminal-tab": () => openAndConnectServerInNewTerminalTab(targetName),
      "interrupt-server-command": () => {
        setSelectedServer(targetName);
        return sendTerminalControlSignal("interrupt", targetName);
      },
      "reconnect-server-session": () => {
        setSelectedServer(targetName);
        return reconnectSelectedSession(targetName);
      },
      "disconnect-server-session": () => {
        setSelectedServer(targetName);
        return closeSelectedSession(targetName);
      },
      "open-sftp": () => {
        setSelectedServer(targetName);
        return refreshSelectedSftp(currentSftpPath(targetName), "", targetName);
      },
      "refresh-sftp": () => {
        setSelectedServer(targetName);
        return refreshSelectedSftp(currentSftpPath(targetName), "", targetName);
      },
      "upload-sftp": () => {
        setSelectedServer(targetName);
        return uploadSelectedSftp(targetName);
      },
      test: () => {
        setSelectedServer(targetName);
        return testSelectedConnection(targetName);
      },
      basic: () => {
        setSelectedServer(targetName);
        return readSelectedBasicInfo(targetName);
      },
      "server-session-logs": () => {
        setSelectedServer(targetName);
        return openSessionLogs({ server: targetName });
      },
      "server-tool-logs": () => {
        setSelectedServer(targetName);
        return openToolLogs({ query: targetName });
      },
      "server-diagnostic-package": () => {
        setSelectedServer(targetName);
        return exportDiagnosticPackage();
      },
      "server-auth-center": () => {
        setSelectedServer(targetName);
        return openAuthCenter(targetName);
      },
      "copy-ssh-command": () => copyServerSshCommand(targetName),
      "copy-server-info": () => copyServerConnectionInfo(targetName),
      "copy-openssh-config": () => copyServerOpenSshConfig(targetName),
      "copy-troubleshooting-summary": () => copyServerTroubleshootingSummary(targetName),
      "edit": () => {
        setSelectedServer(targetName);
        return openEditHost(targetName);
      },
      "duplicate-server-as-new-host": () => {
        setSelectedServer(targetName);
        return openNewHost({ ...serverToHostForm(targetName, server), name: buildDuplicateServerName(targetName, servers) });
      },
      "export": () => {
        setSelectedServer(targetName);
        return exportServerProfile(targetName);
      },
      "backup-server": () => {
        setSelectedServer(targetName);
        return openServerBackup(targetName);
      },
      "toggle-server-favorite": () => {
        setSelectedServer(targetName);
        return toggleServerFavorite(targetName, !Boolean(servers[targetName]?.isFavorite));
      },
      "delete": () => {
        setSelectedServer(targetName);
        return customServers[targetName] ? deleteSelectedHost(targetName) : hideBuiltinServer(targetName);
      },
    };
    placeContextMenu(event, model, model.items.map((item) => item.separator ? item : { ...item, onSelect: actions[item.id] }));
  }

  function openSftpContextMenu(event, file = selectedFile) {
    const selectedSshSession = sshSessions[selectedTerminalSessionKey] || {};
    const disableSftpTerminalExecute = Boolean(selectedSshSession.busy);
    const model = buildSftpContextActionModel({
      file,
      path: currentSftpPath(),
      busy: Boolean(sftpBusy[selectedServer]),
      hasAuth: hasUsableServerAuth(servers[selectedServer]),
      hasPreview: Boolean(sftpPreview?.content),
    });
    const actions = {
      "open-folder": () => openSelectedSftpFolder(file),
      preview: () => previewSelectedSftpFile(file),
      download: () => downloadSelectedSftp(file),
      "copy-sftp-path": () => copySftpRemotePath(file),
      "agent-analyze-sftp-preview": () => draftAgentSftpPreviewAnalysis(file),
      "open-containing-folder": () => refreshSelectedSftp(getParentSftpPath(getSftpRemotePath(file)), getSftpRemotePath(file), selectedServer),
      parent: () => goSelectedSftpParent(),
      refresh: () => refreshSelectedSftp(),
      upload: () => uploadSelectedSftp(),
      "create-file": () => createSelectedSftpFile(),
      mkdir: () => createSelectedSftpDirectory(),
      rename: () => renameSelectedSftpItem(file),
      delete: () => deleteSelectedSftpItem(file),
    };
    const advancedItems = [
      { id: "copy-sftp-name", label: "复制名称", disabled: !file, onSelect: () => copySftpItemName(file) },
      { id: "insert-sftp-path", label: "插入到命令行", disabled: !file, onSelect: () => insertSftpPathToCommandInput(file) },
      { id: "copy-list-command", label: "复制 ls -lah", onSelect: () => copySftpTerminalCommand("list", file) },
      { id: "copy-cd-command", label: "复制 cd 命令", onSelect: () => copySftpTerminalCommand("cd", file) },
      { id: "copy-tail-command", label: "复制 tail -n 200", disabled: file?.type === "folder", onSelect: () => copySftpTerminalCommand("tail", file) },
      { id: "copy-cat-command", label: "复制 cat 命令", disabled: file?.type === "folder", onSelect: () => copySftpTerminalCommand("cat", file) },
      { id: "insert-list-command", label: "插入 ls -lah", onSelect: () => insertSftpCommandToCommandInput("list", file) },
      { id: "insert-tail-command", label: "插入 tail -n 200", disabled: file?.type === "folder", onSelect: () => insertSftpCommandToCommandInput("tail", file) },
      { id: "execute-list-command", label: "执行 ls -lah", disabled: disableSftpTerminalExecute, onSelect: () => executeSftpCommandInTerminal("list", file) },
      { id: "execute-cd-command", label: "执行 cd 命令", disabled: disableSftpTerminalExecute, onSelect: () => executeSftpCommandInTerminal("cd", file) },
      { id: "execute-tail-command", label: "执行 tail -n 200", disabled: disableSftpTerminalExecute || file?.type === "folder", onSelect: () => executeSftpCommandInTerminal("tail", file) },
      { id: "execute-cat-command", label: "执行 cat 命令", disabled: disableSftpTerminalExecute || file?.type === "folder", onSelect: () => executeSftpCommandInTerminal("cat", file) },
    ];
    placeContextMenu(event, model, mergeContextMenuItems(
      model.items.map((item) => item.separator ? item : { ...item, onSelect: actions[item.id] }),
      advancedItems,
    ));
  }

  function recordTerminalControlSignalResult(result, signal, targetName, sessionId, controlLogContext) {
    const ok = Boolean(result?.ok);
    const event = {
      type: ok ? "session_control_signal_sent" : "session_control_signal_failed",
      server: targetName,
      sessionId,
      actor: "user",
      command: `control:${signal}`,
      status: ok ? "ok" : "failed",
      ...(ok ? {} : { message: result?.message || "SSH 控制信号发送失败" }),
    };
    writeAuditEvent(event);
    writeSessionLogEvent({ ...event, context: controlLogContext });
  }

  async function sendTerminalControlSignal(signal, targetName = selectedServer, options = {}) {
    const sessionKey = options.sessionKey || resolveTerminalSessionKey(targetName);
    const session = sshSessions[sessionKey] || {};
    if (!session.sessionId) {
      showNotice("当前没有可控制的 SSH 会话");
      return;
    }
    if (signal === "interrupt") {
      if (isTerminalInteractiveMode(session)) {
        await stopSelectedCommand(targetName, { sessionKey });
        return;
      }
      const controlLogContext = { ...buildSshSessionLogContext(targetName, servers[targetName] || {}), sessionKey, signal };
      const result = await sendSelectedSessionInput(null, { text: "\x03", submit: false, clearInput: true, targetName, sessionKey });
      recordTerminalControlSignalResult(result, signal, targetName, session.sessionId, controlLogContext);
      return;
    }
    const controlInputs = {
      "enter": "\r",
      "tab": "\t",
      "escape": "\x1b",
      "page-up": "\x1b[5~",
      "page-down": "\x1b[6~",
      "home": "\x1b[H",
      "end": "\x1b[F",
      "alt-left": "\x1b[1;3D",
      "alt-right": "\x1b[1;3C",
      "ctrl-left": "\x1b[1;5D",
      "ctrl-right": "\x1b[1;5C",
      "delete": "\x1b[3~",
      "insert": "\x1b[2~",
      f1: "\x1bOP",
      f2: "\x1bOQ",
      f3: "\x1bOR",
      f4: "\x1bOS",
      f5: "\x1b[15~",
      f6: "\x1b[17~",
      f7: "\x1b[18~",
      f8: "\x1b[19~",
      f9: "\x1b[20~",
      f10: "\x1b[21~",
      f11: "\x1b[23~",
      f12: "\x1b[24~",
      eof: "\x04",
      suspend: "\x1a",
      quit: "\x1c",
      "escape-control": "\x1d",
      "line-start": "\x01",
      "cursor-left-char": "\x02",
      "line-end": "\x05",
      "cursor-right-char": "\x06",
      "cancel-readline": "\x07",
      "backspace-control": "\x08",
      "clear-before-cursor": "\x15",
      "clear-after-cursor": "\x0b",
      "delete-previous-word": "\x17",
      "yank-kill-buffer": "\x19",
      "alt-backspace": "\x1b\x7f",
      "alt-b": "\x1bb",
      "alt-f": "\x1bf",
      "alt-d": "\x1bd",
      "history-search": "\x12",
      "history-previous": "\x10",
      "history-next": "\x0e",
      "clear-remote-screen": "\x0c",
      "pause-output": "\x13",
      "resume-output": "\x11",
    };
    const input = controlInputs[signal] || "";
    if (input) {
      const controlLogContext = { ...buildSshSessionLogContext(targetName, servers[targetName] || {}), sessionKey, signal };
      const result = await sendSelectedSessionInput(null, { text: input, submit: false, clearInput: false, targetName, sessionKey, finishInteractiveMode: ["eof", "suspend", "quit"].includes(signal) });
      recordTerminalControlSignalResult(result, signal, targetName, session.sessionId, controlLogContext);
    }
  }

  function clearSelectedTerminalOutput(targetName = selectedServer, options = {}) {
    const name = targetName || selectedServer;
    const terminalKey = options.sessionKey || resolveTerminalSessionKey(name);
    const appendedCount = (terminalAppends[terminalKey] || []).length;
    terminalOpenLineRef.current[terminalKey] = false;
    setTerminalClearMarkers((current) => ({ ...current, [terminalKey]: appendedCount > 0 ? appendedCount + 1 : 0 }));
    showNotice(`${name} 的终端输出已清空`);
  }
  async function writeAuditEvent(event) {
    const api = safeFileApi();
    if (!api?.write_audit_event) return;
    try {
      await api.write_audit_event(event);
    } catch {
      // 审计日志失败不能阻断 SSH 操作
    }
  }

  async function writeSessionLogEvent(event) {
    const api = safeFileApi();
    if (!api?.write_session_log_event) return;
    try {
      await api.write_session_log_event(event);
    } catch {
      // 会话日志失败不能阻断当前 SSH 操作。
    }
  }

  async function writeToolLogEvent(event) {
    const api = safeFileApi();
    if (!api?.write_tool_log_event) return;
    try {
      await api.write_tool_log_event(event);
    } catch {
      // Tool log failures must never block the desktop UI.
    }
  }

  async function openSessionLogs(initialFilters = {}) {
    const filters = { server: selectedServer, query: "", type: "", status: "", failureKind: "", ...initialFilters };
    setSessionLogFilters(filters);
    setSessionLogsOpen(true);
    await refreshSessionLogs(filters);
  }

  async function refreshSessionLogs(filters = sessionLogFilters) {
    const api = safeFileApi();
    if (!api?.list_session_log_entries) { showNotice("当前环境不支持该功能，请使用正式 exe。"); return; }
    setSessionLogsBusy(true);
    try {
      const result = await api.list_session_log_entries({ ...filters, limit: 200 });
      if (result?.ok) {
        setSessionLogEntries(Array.isArray(result.entries) ? result.entries : []);
        setSessionLogTotal(Number(result.total || 0));
        setSessionLogRoot(result.root || "");
      } else { showNotice(result?.message || "会话日志读取失败。"); }
      return result;
    } catch (error) { showNotice("会话日志读取失败：" + (error.message || error)); }
    finally { setSessionLogsBusy(false); }
  }

  async function openSessionLogDir() {
    const api = safeFileApi();
    try {
      const path = api?.get_session_log_dir ? await api.get_session_log_dir() : sessionLogRoot;
      if (path && api?.open_path) { const result = await api.open_path(path); showNotice(result?.message || ("已打开目录：" + path)); }
      else showNotice(path ? ("已打开目录：" + path) : "未找到会话日志目录。");
    } catch (error) { showNotice("打开会话日志目录失败：" + (error.message || error)); }
  }

  async function deleteOldSessionLogs() {
    const api = safeFileApi();
    if (!api?.delete_old_session_logs) { showNotice("当前环境不支持该功能，请使用正式 exe。"); return; }
    setSessionLogsBusy(true);
    try { const result = await api.delete_old_session_logs(30); showNotice(result?.message || ("已清理 " + (result?.deleted || 0) + " 条旧日志")); await refreshSessionLogs(); }
    catch (error) { showNotice("清理会话日志失败：" + (error.message || error)); }
    finally { setSessionLogsBusy(false); }
  }

  async function openToolLogDir() {
    const api = safeFileApi();
    try {
      const path = api?.get_tool_log_dir ? await api.get_tool_log_dir() : toolLogRoot;
      if (path && api?.open_path) { const result = await api.open_path(path); showNotice(result?.message || ("已打开目录：" + path)); }
      else showNotice(path ? ("已打开目录：" + path) : "未找到工具日志目录。");
    } catch (error) { showNotice("打开工具日志目录失败：" + (error.message || error)); }
  }

  async function openToolLogs(nextFilters = null) {
    const filters = nextFilters ? { ...toolLogFilters, ...nextFilters } : { ...toolLogFilters };
    setToolLogFilters(filters);
    setToolLogsOpen(true);
    await refreshToolLogs(filters);
  }

  async function refreshToolLogs(filters = toolLogFilters) {
    const api = safeFileApi();
    if (!api?.list_tool_log_entries) { showNotice("当前环境不支持该功能，请使用正式 exe。"); return; }
    setToolLogsBusy(true);
    try {
      const result = await api.list_tool_log_entries({ ...filters, limit: 300 });
      if (result?.ok) {
        setToolLogEntries(Array.isArray(result.entries) ? result.entries : []);
        setToolLogTotal(Number(result.total || 0));
        setToolLogRoot(result.root || "");
      } else { showNotice(result?.message || "工具日志读取失败。"); }
      return result;
    } catch (error) { showNotice("工具日志读取失败：" + (error.message || error)); }
    finally { setToolLogsBusy(false); }
  }

  async function exportToolLogs() {
    const api = safeFileApi();
    if (!api?.build_tool_log_export || !api?.save_text_file) { showNotice("当前环境不支持该功能，请使用正式 exe。"); return; }
    setToolLogsBusy(true);
    try {
      let exportEntries = toolLogEntries;
      let exportTotal = toolLogTotal;
      if (api?.list_tool_log_entries) {
        const fullResult = await api.list_tool_log_entries({ ...toolLogFilters, limit: Math.max(toolLogTotal, toolLogEntries.length, 200) });
        if (fullResult?.ok) {
          exportEntries = Array.isArray(fullResult.entries) ? fullResult.entries : [];
          exportTotal = Number(fullResult.total || exportEntries.length);
        }
      }
      const content = await api.build_tool_log_export(exportEntries, { filters: toolLogFilters, total: exportTotal });
      const target = await api.save_text_file("ssh-agent-tool-logs.md", content);
      showNotice(target ? `工具日志已导出：${target}` : "已取消导出工具日志");
    }
    catch (error) { showNotice("导出工具日志失败：" + (error.message || error)); }
    finally { setToolLogsBusy(false); }
  }

  async function deleteOldToolLogs() {
    const api = safeFileApi();
    if (!api?.delete_old_tool_logs) { showNotice("当前环境不支持该功能，请使用正式 exe。"); return; }
    setToolLogsBusy(true);
    try { const result = await api.delete_old_tool_logs(30); showNotice(result?.message || ("已清理 " + (result?.deleted || 0) + " 条旧日志")); await refreshToolLogs(); }
    catch (error) { showNotice("清理工具日志失败：" + (error.message || error)); }
    finally { setToolLogsBusy(false); }
  }

  async function exportDiagnosticPackage() {
    const api = safeFileApi();
    if (!api?.export_diagnostic_package) { showNotice("当前环境不支持导出诊断包，请使用正式 exe。"); return; }
    try {
      const result = await api.export_diagnostic_package();
      const diagnosticPackagePath = String(result?.path || "").trim();
      let copiedPath = false;
      if (diagnosticPackagePath && navigator?.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(diagnosticPackagePath);
          copiedPath = true;
        } catch {
          copiedPath = false;
        }
      }
      showNotice(formatDiagnosticPackageNotice(result, { copiedPath }));
    }
    catch (error) { showNotice("导出失败：" + (error.message || error)); }
  }

  async function createDesktopShortcut() { const result = await safeFileApi()?.create_desktop_shortcut?.(); showNotice(result?.message || "桌面快捷方式已创建。"); }
  async function createStartMenuShortcut() { const result = await safeFileApi()?.create_start_menu_shortcut?.(); showNotice(result?.message || "开始菜单快捷方式已创建。"); }
  async function openInstallDirectory() { const result = await safeFileApi()?.open_install_directory?.(); showNotice(result?.message || "安装目录已打开。"); }
  async function openAppDataDirectory() { const result = await safeFileApi()?.open_app_data_directory?.(); showNotice(result?.message || "数据目录已打开。"); }
  async function exportSessionLogs() {
    const api = safeFileApi();
    if (!api?.build_session_log_export || !api?.save_text_file) { showNotice("当前环境不支持该功能，请使用正式 exe。"); return; }
    setSessionLogsBusy(true);
    try {
      let exportEntries = sessionLogEntries;
      let exportTotal = sessionLogTotal;
      if (api?.list_session_log_entries) {
        const fullResult = await api.list_session_log_entries({ ...sessionLogFilters, limit: Math.max(sessionLogTotal, sessionLogEntries.length, 200) });
        if (fullResult?.ok) {
          exportEntries = Array.isArray(fullResult.entries) ? fullResult.entries : [];
          exportTotal = Number(fullResult.total || exportEntries.length);
        }
      }
      const content = await api.build_session_log_export(exportEntries, { filters: sessionLogFilters, total: exportTotal });
      const target = await api.save_text_file("ssh-agent-session-logs.md", content);
      showNotice(target ? `会话日志已导出：${target}` : "已取消导出会话日志");
    } catch (error) {
      showNotice("导出会话日志失败：" + (error.message || error));
    } finally {
      setSessionLogsBusy(false);
    }
  }
  async function copyPortForwardLocalUrl(forward) {
    const url = buildPortForwardLocalUrl(forward);
    if (!url) { showNotice("当前端口转发没有可复制的本地地址。"); return; }
    try { await navigator.clipboard.writeText(url); }
    catch {
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    showNotice("本地地址已复制：" + url);
  }

  async function refreshPortForwards() {
    const api = safeFileApi();
    if (!api?.list_port_forwards) return;
    setPortForwardOperation({ type: "list", status: "running", label: "刷新", message: "正在读取端口转发..." });
    try {
      const result = await api.list_port_forwards();
      if (result?.ok) {
        setPortForwards(Array.isArray(result.forwards) ? result.forwards : []);
        setPortForwardOperation({ type: "list", status: "success", label: "已刷新", message: result.message || "端口转发已刷新" });
      } else { setPortForwardOperation({ type: "list", status: "failed", label: "刷新失败", message: result?.message || "端口转发读取失败" }); }
    } catch (error) { setPortForwardOperation({ type: "list", status: "failed", label: "刷新失败", message: String(error.message || error) }); }
  }

  async function openPortForwardModal() {
    setPortForwardOpen(true);
    await refreshPortForwards();
  }

  async function startPortForward(config) {
    const api = safeFileApi();
    if (!api?.start_port_forward) { showNotice("当前环境不支持该功能，请使用正式 exe。"); return; }
    const server = servers[selectedServer];
    if (!server) { showNotice("请先选择要启动端口转发的服务器。"); return; }
    setPortForwardBusy(true);
    try { const result = await api.start_port_forward(server, server.credentialRef, normalizePortForwardConfig(config)); showNotice(result?.message || "操作已完成"); await refreshPortForwards(); }
    catch (error) { showNotice("端口转发启动失败：" + (error.message || error)); }
    finally { setPortForwardBusy(false); }
  }

  async function stopPortForward(forwardId) {
    const api = safeFileApi();
    if (!api?.stop_port_forward) { showNotice("当前环境不支持该功能，请使用正式 exe。"); return; }
    setPortForwardBusy(true);
    try { const result = await api.stop_port_forward(forwardId); showNotice(result?.message || "操作已完成"); await refreshPortForwards(); }
    catch (error) { showNotice("端口转发停止失败：" + (error.message || error)); }
    finally { setPortForwardBusy(false); }
  }

  function savePortForwardPreset(config) {
    const nextPresets = upsertPortForwardPreset(portForwardPresets, normalizePortForwardConfig(config));
    setPortForwardPresets(nextPresets);
    void persistAppConfig(customServers, modelConfig, customAgentCapabilities, modelProfiles, activeModelProfileId, hiddenBuiltinServers, nextPresets, customCommandSnippets);
    showNotice("端口转发预设已保存");
  }

  function deletePortForwardPreset(presetId) {
    const nextPresets = removePortForwardPreset(portForwardPresets, presetId);
    setPortForwardPresets(nextPresets);
    void persistAppConfig(customServers, modelConfig, customAgentCapabilities, modelProfiles, activeModelProfileId, hiddenBuiltinServers, nextPresets, customCommandSnippets);
    showNotice("端口转发预设已删除");
  }
  async function openCurrentWorkingDirectoryInSftp(name = selectedServer, options = {}) {
    const server = servers[name];
    if (!server) return;
    const sessionKey = options.sessionKey || resolveTerminalSessionKey(name);
    const cwd = normalizeSftpPath(sessionWorkingDirectories[sessionKey] || sessionWorkingDirectories[name] || server?.cwd || "");
    await refreshSelectedSftp(cwd || resolveShellWorkingDirectory(server.cwd || "/"), "", name);
  }

  async function copyCurrentWorkingDirectory(name = selectedServer, options = {}) {
    const server = servers[name];
    const sessionKey = options.sessionKey || resolveTerminalSessionKey(name);
    const cwd = normalizeSftpPath(sessionWorkingDirectories[sessionKey] || sessionWorkingDirectories[name] || server?.cwd || "");
    if (!cwd) {
      showNotice("当前没有可复制的远程目录");
      return false;
    }
    return await copyTextToClipboard(cwd, `当前远程目录已复制：${cwd}`);
  }

  async function refreshSelectedSftp(targetPath = currentSftpPath(), preferredSelectionPath = "", serverName = selectedServer) {
    const name = serverName || selectedServer;
    const server = servers[name];
    if (!server) return;
    const remotePath = normalizeSftpPath(targetPath);
    const api = safeFileApi();
    if (!api?.list_sftp_directory) { showNotice("当前环境不支持 SFTP 文件功能，请使用正式 exe。"); return; }
    if (!hasUsableServerAuth(server)) { showNotice("请先绑定或填写 SSH 凭据。"); return; }
    setSftpBusy((current) => ({ ...current, [name]: true }));
    setRecentSftpOperations((current) => ({ ...current, [name]: { type: "list", status: "running", label: "读取目录", message: "正在读取 " + remotePath, remotePath } }));
    try {
      const result = await api.list_sftp_directory(server, server.credentialRef, remotePath);
      if (!result?.ok) {
        const message = result?.message || "SFTP 目录读取失败";
        showNotice(message);
        setRecentSftpOperations((current) => ({ ...current, [name]: { type: "list", status: "failed", label: "读取失败", message, remotePath } }));
        return;
      }
      setSftpOverrides((current) => ({ ...current, [name]: result.items || [] }));
      setSftpPaths((current) => ({ ...current, [name]: result.path || remotePath }));
      setSelectedFile(chooseSftpSelectionAfterRefresh(result.items || [], preferredSelectionPath));
      setSftpPreview(null);
      setSftpPreviewDraft("");
      setRecentSftpOperations((current) => ({ ...current, [name]: { type: "list", status: "success", label: "目录已刷新", message: "目录已刷新", remotePath: result.path || remotePath } }));
    } catch (error) {
      const message = "SFTP 目录读取失败：" + (error.message || error);
      showNotice(message);
      setRecentSftpOperations((current) => ({ ...current, [name]: { type: "list", status: "failed", label: "读取失败", message, remotePath } }));
    } finally { setSftpBusy((current) => ({ ...current, [name]: false })); }
  }

  async function openSelectedSftpFolder(item) {
    if (!item) return;
    const targetPath = item.path || resolveSftpChildPath(currentSftpPath(), item.name);
    await refreshSelectedSftp(targetPath, "", selectedServer);
  }

  function selectSftpFile(item) {
    setSelectedFile(item || null);
  }

  async function goSelectedSftpParent() { await refreshSelectedSftp(getParentSftpPath(currentSftpPath()), "", selectedServer); }

  async function copyRecentSftpOperation(operation) {
    const text = [operation?.label, operation?.message, operation?.remotePath || operation?.localPath].filter(Boolean).join("\n");
    if (!text) return;
    await copyTextToClipboard(text, "SFTP 操作信息已复制");
  }

  async function pollSftpTransferJob(api, job, serverName, remotePath, options = {}) {
    const transferType = options.type || "download";
    const runningLabel = options.runningLabel || "下载中";
    const canceledLabel = options.canceledLabel || (transferType === "upload" ? "已取消上传" : "已取消下载");
    const runningMessage = options.runningMessage || (transferType === "upload" ? "正在上传" : "正在下载");
    const timeoutMessage = options.timeoutMessage || `SFTP ${transferType === "upload" ? "上传" : "下载"}任务超时，请打开工具日志排查。`;
    let current = job;
    for (let attempt = 0; attempt < 720; attempt += 1) {
      if (current?.done || ["success", "failed", "error", "canceled", "missing"].includes(current?.status)) return current;
      await waitForMs(500);
      current = await api.get_sftp_transfer_job(job.id);
      const progress = Number(current?.progress || 0);
      const isCanceled = current?.status === "canceled";
      const isError = current?.status === "error";
      setRecentSftpOperations((items) => ({
        ...items,
        [serverName]: {
          ...items[serverName],
          type: transferType,
          status: isCanceled ? "cancelled" : isError ? "failed" : "running",
          label: isCanceled ? canceledLabel : isError ? "传输失败" : runningLabel,
          message: isError ? current?.error || "传输失败" : progress > 0 ? `${runningMessage} ${progress}%` : runningMessage,
          remotePath,
          localPath: current?.localPath || items[serverName]?.localPath || "",
          jobId: job.id,
        },
      }));
    }
    throw new Error(timeoutMessage);
  }

  async function cancelSftpOperation(operation = recentSftpOperations[selectedServer]) {
    const api = safeFileApi();
    const jobId = operation?.jobId;
    if (!jobId || !api?.cancel_sftp_transfer_job) {
      showNotice("当前传输暂不支持取消。");
      return;
    }
    try {
      const result = await api.cancel_sftp_transfer_job(jobId);
      const message = result?.message || result?.error || "传输任务已取消";
      setRecentSftpOperations((current) => ({
        ...current,
        [selectedServer]: {
          ...operation,
          status: "cancelled",
          label: operation.type === "download" ? "已取消下载" : operation.type === "upload" ? "已取消上传" : "已取消传输",
          message,
        },
      }));
      setSftpBusy((current) => ({ ...current, [selectedServer]: false }));
      await writeSessionLogEvent({ type: "sftp_transfer_cancelled", server: selectedServer, command: operation.remotePath || operation.localPath || jobId, status: "cancelled", summary: message });
      showNotice(message);
    } catch (error) {
      showNotice("取消 SFTP 传输失败：" + (error.message || error));
    }
  }

  function requestSftpOverwriteConfirmation(result, type) {
    return new Promise((resolve) => {
      setSftpOverwriteDialog({ result, type, resolve });
    });
  }

  function closeSftpOverwriteDialog(confirmed = false) {
    setSftpOverwriteDialog((dialog) => {
      dialog?.resolve?.(Boolean(confirmed));
      return null;
    });
  }

  async function uploadSelectedSftp(serverName = selectedServer, options = {}) {
    const api = safeFileApi();
    const server = servers[serverName];
    const uploadDirectory = Boolean(options.directory);
    if (!api?.upload_sftp_file || !api?.pick_upload_files || (uploadDirectory && !api?.pick_upload_directory)) { showNotice("当前环境不支持 SFTP 文件功能，请使用正式 exe。"); return; }
    const remoteDirectory = currentSftpPath(serverName);
    let pickedFiles = [];
    if (uploadDirectory) {
      const pickedDirectory = await api.pick_upload_directory();
      pickedFiles = pickedDirectory ? [pickedDirectory] : [];
    } else {
      pickedFiles = await api.pick_upload_files();
    }
    if (!Array.isArray(pickedFiles) || pickedFiles.length === 0) {
      const message = "已取消上传";
      setRecentSftpOperations((current) => ({ ...current, [serverName]: { type: "upload", status: "cancelled", label: "已取消上传", message, remotePath: remoteDirectory } }));
      await writeSessionLogEvent({ type: "sftp_upload_cancelled", server: serverName, command: remoteDirectory, status: "cancelled", summary: message });
      showNotice(message);
      return;
    }
    setSftpBusy((current) => ({ ...current, [serverName]: true }));
    const uploadUnit = uploadDirectory ? "项目" : "文件";
    setRecentSftpOperations((current) => ({ ...current, [serverName]: { type: "upload", status: "running", label: "上传中", message: `正在上传 ${pickedFiles.length} 个${uploadUnit}`, remotePath: remoteDirectory } }));
    try {
      const results = [];
      for (const localPath of pickedFiles) {
        let result;
        if (api?.start_sftp_upload_job && api?.get_sftp_transfer_job) {
          const job = await api.start_sftp_upload_job(server, server.credentialRef, localPath, remoteDirectory);
          if (job?.id) {
            setRecentSftpOperations((current) => ({ ...current, [serverName]: { type: "upload", status: "running", label: "上传中", message: `正在上传 ${pickedFiles.length} 个${uploadUnit}`, remotePath: remoteDirectory, localPath, jobId: job.id } }));
            const completedJob = await pollSftpTransferJob(api, job, serverName, remoteDirectory, { type: "upload", runningLabel: "上传中", canceledLabel: "已取消上传", runningMessage: "正在上传" });
            result = completedJob?.result || completedJob;
          } else {
            result = job?.result || job;
          }
        } else {
          result = await api.upload_sftp_file(server, server.credentialRef, localPath, remoteDirectory);
        }
        if (isSftpOverwriteConflict(result)) {
          if (await requestSftpOverwriteConfirmation(result, "upload")) {
            if (api?.start_sftp_upload_job && api?.get_sftp_transfer_job) {
              const job = await api.start_sftp_upload_job(server, server.credentialRef, localPath, remoteDirectory, true);
              if (job?.id) {
                setRecentSftpOperations((current) => ({ ...current, [serverName]: { type: "upload", status: "running", label: "上传中", message: "正在上传", remotePath: remoteDirectory, localPath, jobId: job.id } }));
                const completedJob = await pollSftpTransferJob(api, job, serverName, remoteDirectory, { type: "upload", runningLabel: "上传中", canceledLabel: "已取消上传", runningMessage: "正在上传" });
                result = completedJob?.result || completedJob;
              } else {
                result = job?.result || job;
              }
            } else {
              result = await api.upload_sftp_file(server, server.credentialRef, localPath, remoteDirectory, true);
            }
          } else {
            result = buildSftpOverwriteCancelledResult(result, "upload");
          }
        }
        results.push({ ...result, localPath: result?.localPath || localPath });
        if (result?.cancelled && /传输任务已取消/.test(String(result?.message || ""))) break;
      }
      const succeeded = results.filter((item) => item?.ok);
      const cancelled = results.filter((item) => item?.cancelled);
      const failed = results.filter((item) => !item?.ok && !item?.cancelled);
      const lastSuccess = succeeded[succeeded.length - 1];
      const allCancelled = cancelled.length && !succeeded.length && !failed.length;
      const transferCancelled = cancelled.some((item) => /传输任务已取消/.test(String(item?.message || "")));
      const message = allCancelled
        ? transferCancelled ? "已取消上传" : `已取消覆盖：${cancelled.length} 个文件未上传`
        : failed.length
          ? `上传完成：成功 ${succeeded.length} 个，失败 ${failed.length} 个，取消 ${cancelled.length} 个`
          : cancelled.length
            ? `上传完成：成功 ${succeeded.length} 个，取消 ${cancelled.length} 个`
            : uploadDirectory
              ? `上传完成：${succeeded.length} 个项目`
              : `上传完成：${succeeded.length} 个文件`;
      setRecentSftpOperations((current) => ({
        ...current,
        [serverName]: {
          type: "upload",
          status: allCancelled ? "cancelled" : failed.length ? "failed" : "success",
          label: allCancelled ? transferCancelled ? "已取消上传" : "已取消覆盖" : failed.length ? "部分失败" : "上传完成",
          message,
          remotePath: lastSuccess?.remotePath || remoteDirectory,
          localPath: pickedFiles.join("; "),
        },
      }));
      await writeSessionLogEvent({ type: allCancelled ? "sftp_upload_cancelled" : failed.length ? "sftp_upload_failed" : "sftp_upload", server: serverName, command: pickedFiles.join("; "), status: allCancelled ? "cancelled" : failed.length ? "failed" : "ok", summary: message });
      showNotice(message);
      if (succeeded.length) await refreshSelectedSftp(undefined, lastSuccess?.remotePath || "");
    }
    catch (error) {
      const message = "上传失败：" + (error.message || error);
      setRecentSftpOperations((current) => ({ ...current, [serverName]: { type: "upload", status: "failed", label: "上传失败", message, remotePath: remoteDirectory } }));
      await writeSessionLogEvent({ type: "sftp_upload_failed", server: serverName, command: pickedFiles.join("; "), status: "failed", summary: message });
      showNotice(message);
    }
    finally { setSftpBusy((current) => ({ ...current, [serverName]: false })); }
  }

  async function uploadSelectedSftpDirectory(serverName = selectedServer) {
    return uploadSelectedSftp(serverName, { directory: true });
  }

  async function downloadSelectedSftp(targetFile = selectedFile) {
    const api = safeFileApi();
    const server = servers[selectedServer];
    if (!targetFile) { showNotice("请选择要下载的文件或目录。"); return; }
    if (!api?.download_sftp_file && !api?.start_sftp_download_job) { showNotice("当前环境不支持 SFTP 文件功能，请使用正式 exe。"); return; }
    const remotePath = targetFile.path || resolveSftpChildPath(currentSftpPath(), targetFile.name);
    setSftpBusy((current) => ({ ...current, [selectedServer]: true }));
    setRecentSftpOperations((current) => ({ ...current, [selectedServer]: { type: "download", status: "running", label: "下载中", message: "正在下载", remotePath } }));
    try {
      let result;
      if (api?.start_sftp_download_job && api?.get_sftp_transfer_job) {
        const job = await api.start_sftp_download_job(server, server.credentialRef, remotePath);
        if (job?.id) {
          setRecentSftpOperations((current) => ({ ...current, [selectedServer]: { type: "download", status: "running", label: "下载中", message: "正在下载", remotePath, localPath: job.localPath || "", jobId: job.id } }));
          const completedJob = await pollSftpTransferJob(api, job, selectedServer, remotePath);
          result = completedJob?.result || completedJob;
        } else {
          result = job?.result || job;
        }
      } else {
        result = await api.download_sftp_file(server, server.credentialRef, remotePath);
      }
      if (isSftpOverwriteConflict(result)) {
        if (await requestSftpOverwriteConfirmation(result, "download")) {
          if (api?.start_sftp_download_job && api?.get_sftp_transfer_job) {
            const job = await api.start_sftp_download_job(server, server.credentialRef, remotePath, result?.localPath || "", true);
            setRecentSftpOperations((current) => ({ ...current, [selectedServer]: { type: "download", status: "running", label: "下载中", message: "正在下载", remotePath, localPath: job.localPath || result?.localPath || "", jobId: job.id } }));
            const completedJob = await pollSftpTransferJob(api, job, selectedServer, remotePath);
            result = completedJob?.result || completedJob;
          } else {
            result = await api.download_sftp_file(server, server.credentialRef, remotePath, result?.localPath || "", true);
          }
        } else {
          result = buildSftpOverwriteCancelledResult(result, "download");
        }
      }
      if (result?.cancelled) {
        const message = result.message || "已取消覆盖，下载未执行。";
        setRecentSftpOperations((current) => ({ ...current, [selectedServer]: { type: "download", status: "cancelled", label: "已取消覆盖", message, remotePath, localPath: result?.localPath || "" } }));
        await writeSessionLogEvent({ type: "sftp_download_cancelled", server: selectedServer, command: remotePath, status: "cancelled", summary: message });
        showNotice(message);
        return;
      }
      if (!result?.ok) throw new Error(result?.message || "下载失败");
      const message = result?.message || "下载成功";
      setRecentSftpOperations((current) => ({ ...current, [selectedServer]: { type: "download", status: "success", label: "下载完成", message, remotePath, localPath: result?.localPath || "" } }));
      await writeSessionLogEvent({ type: "sftp_download", server: selectedServer, command: remotePath, status: "ok", summary: message });
      showNotice(message);
    }
    catch (error) {
      const message = "下载失败：" + (error.message || error);
      setRecentSftpOperations((current) => ({ ...current, [selectedServer]: { type: "download", status: "failed", label: "下载失败", message, remotePath } }));
      await writeSessionLogEvent({ type: "sftp_download_failed", server: selectedServer, command: remotePath, status: "failed", summary: message });
      showNotice(message);
    }
    finally { setSftpBusy((current) => ({ ...current, [selectedServer]: false })); }
  }

  async function previewSelectedSftpFile(targetFile = selectedFile) {
    const api = safeFileApi();
    const server = servers[selectedServer];
    if (!targetFile || targetFile.type === "folder") { showNotice("请选择要预览的文件。"); return; }
    if (!api?.preview_sftp_file) { showNotice("当前环境不支持 SFTP 文件功能，请使用正式 exe。"); return; }
    setSftpBusy((current) => ({ ...current, [selectedServer]: true }));
    try {
      const remotePath = targetFile.path || resolveSftpChildPath(currentSftpPath(), targetFile.name);
      const result = await api.preview_sftp_file(server, server.credentialRef, remotePath);
      if (!result?.ok) { showNotice(result?.message || "文件预览失败"); return; }
      const preview = { ...result, name: targetFile.name, path: remotePath, content: result.content || "" };
      setSftpPreview(preview);
      setSftpPreviewDraft(preview.content);
      showNotice("文件预览已加载");
    } catch (error) { showNotice("文件预览失败：" + (error.message || error)); }
    finally { setSftpBusy((current) => ({ ...current, [selectedServer]: false })); }
  }

  async function saveSftpPreviewText() {
    const api = safeFileApi();
    const server = servers[selectedServer];
    if (!sftpPreview) { showNotice("请先预览一个 SFTP 文件。"); return; }
    if (!api?.write_sftp_text_file) { showNotice("当前环境不支持 SFTP 文件功能，请使用正式 exe。"); return; }
    const remotePath = sftpPreview.path;
    const draftContent = sftpPreviewDraft ?? sftpPreview.content ?? "";
    if (draftContent === (sftpPreview.content || "")) {
      showNotice("文件没有修改，无需保存。");
      return;
    }
    setSftpBusy((current) => ({ ...current, [selectedServer]: true }));
    setRecentSftpOperations((current) => ({ ...current, [selectedServer]: { type: "save", status: "running", label: "保存中", message: "正在保存文件", remotePath } }));
    try {
      const result = await api.write_sftp_text_file(server, server.credentialRef, remotePath, draftContent, sftpPreview.encoding || "utf-8");
      if (!result?.ok) {
        const message = result?.message || "文件保存失败";
        setRecentSftpOperations((current) => ({ ...current, [selectedServer]: { type: "save", status: "failed", label: "保存失败", message, remotePath } }));
        await writeSessionLogEvent({ type: "sftp_save_failed", server: selectedServer, command: remotePath, status: "failed", summary: message });
        showNotice(message);
        return;
      }
      setSftpPreview((current) => current ? { ...current, content: draftContent, size: result.bytes ?? current.size } : current);
      const message = "文件已保存";
      setRecentSftpOperations((current) => ({ ...current, [selectedServer]: { type: "save", status: "success", label: "保存完成", message, remotePath } }));
      await writeSessionLogEvent({ type: "sftp_save", server: selectedServer, command: remotePath, status: "ok", summary: message });
      showNotice(message);
      await refreshSelectedSftp(currentSftpPath(), remotePath, selectedServer);
    } catch (error) {
      const message = "文件保存失败：" + (error.message || error);
      setRecentSftpOperations((current) => ({ ...current, [selectedServer]: { type: "save", status: "failed", label: "保存失败", message, remotePath } }));
      await writeSessionLogEvent({ type: "sftp_save_failed", server: selectedServer, command: remotePath, status: "failed", summary: message });
      showNotice(message);
    }
    finally { setSftpBusy((current) => ({ ...current, [selectedServer]: false })); }
  }

  async function createSelectedSftpDirectory() { setSftpNameDialog({ type: "mkdir", title: "新建目录", value: "", placeholder: "目录名" }); }
  async function createSelectedSftpFile() { setSftpNameDialog({ type: "touch", title: "新建文件", value: "", placeholder: "文件名" }); }

  async function submitSftpNameDialog() {
    const dialog = sftpNameDialog;
    if (!dialog?.value?.trim()) return;
    const api = safeFileApi();
    const server = servers[selectedServer];
    const targetPath = dialog.targetPath || resolveSftpChildPath(currentSftpPath(), dialog.value.trim());
    try {
      let result;
      if (dialog.type === "rename") result = await api?.rename_sftp_item?.(server, server.credentialRef, dialog.sourcePath, targetPath);
      else if (dialog.type === "mkdir") result = await api?.create_sftp_directory?.(server, server.credentialRef, targetPath);
      else result = await api?.create_sftp_file?.(server, server.credentialRef, targetPath);
      showNotice(result?.message || "SFTP 操作已完成");
      setSftpNameDialog(null);
      if (dialog.type === "rename") await refreshSelectedSftp(undefined, result.newPath);
      else await refreshSelectedSftp(undefined, result.remotePath);
    } catch (error) { showNotice("SFTP 操作失败：" + (error.message || error)); }
  }

  async function renameSelectedSftpItem(targetFile = selectedFile) {
    if (!targetFile) return;
    setSftpNameDialog({ type: "rename", title: "重命名", value: targetFile.name, sourcePath: targetFile.path || resolveSftpChildPath(currentSftpPath(), targetFile.name) });
  }

  async function deleteSelectedSftpItem(targetFile = selectedFile) {
    if (!targetFile) return;
    setSftpDeleteDialog({ file: targetFile, path: targetFile.path || resolveSftpChildPath(currentSftpPath(), targetFile.name) });
  }

  async function submitSftpDeleteDialog() {
    const dialog = sftpDeleteDialog;
    if (!dialog) return;
    const api = safeFileApi();
    const server = servers[selectedServer];
    setSftpBusy((current) => ({ ...current, [selectedServer]: true }));
    setRecentSftpOperations((current) => ({ ...current, [selectedServer]: { type: "delete", status: "running", label: "删除中", message: "正在删除项目", remotePath: dialog.path } }));
    try {
      const result = await api?.delete_sftp_item?.(server, server.credentialRef, dialog.path, dialog.file?.type === "folder");
      const message = result?.message || "删除成功";
      setRecentSftpOperations((current) => ({ ...current, [selectedServer]: { type: "delete", status: "success", label: "删除完成", message, remotePath: dialog.path } }));
      await writeSessionLogEvent({ type: "sftp_delete", server: selectedServer, command: dialog.path, status: "ok", summary: message });
      showNotice(message);
      setSftpDeleteDialog(null);
      await refreshSelectedSftp(currentSftpPath(), "", selectedServer);
    }
    catch (error) {
      const message = "删除失败：" + (error.message || error);
      setRecentSftpOperations((current) => ({ ...current, [selectedServer]: { type: "delete", status: "failed", label: "删除失败", message, remotePath: dialog.path } }));
      await writeSessionLogEvent({ type: "sftp_delete_failed", server: selectedServer, command: dialog.path, status: "failed", summary: message });
      showNotice(message);
    }
    finally { setSftpBusy((current) => ({ ...current, [selectedServer]: false })); }
  }
  async function restoreSessionWorkingDirectory(name, sessionId, server, options = {}) {
    const terminalKey = options.terminalKey || resolveTerminalSessionKey(name);
    const cwd = normalizeSftpPath(sessionWorkingDirectories[terminalKey] || sessionWorkingDirectories[name] || server?.cwd || "");
    if (!sessionId || !cwd || cwd === ".") return;
    const api = safeFileApi();
    if (!api?.send_ssh_session_command) return;
    appendTerminalLines(name, ["[" + name + "]$ # restore cwd: " + cwd], { terminalKey });
    try {
      const command = "cd " + quoteSftpPathForShell(cwd);
      const result = await api.send_ssh_session_command(sessionId, command);
      const output = result?.output || "";
      if (output) appendTerminalLines(name, formatInteractiveSessionLines(name, "cd " + cwd, output).slice(1), { terminalKey, rawOutput: output });
      const status = result?.ok ? "ok" : "failed";
      const message = result?.message || (result?.ok ? "cwd restored" : "cwd restore failed");
      writeAuditEvent({ type: "session_restore_cwd", server: name, sessionId, actor: "system", command: "cd " + cwd, message, status });
      writeSessionLogEvent({ type: "session_restore_cwd", server: name, sessionId, actor: "system", command: "cd " + cwd, message, output, status });
      if (!result?.ok) appendTerminalLines(name, ["# " + message], { terminalKey });
    } catch (error) {
      const message = "cwd restore failed: " + (error.message || error);
      appendTerminalLines(name, ["# " + message], { terminalKey });
      writeAuditEvent({ type: "session_restore_cwd", server: name, sessionId, actor: "system", command: "cd " + cwd, message, status: "failed" });
      writeSessionLogEvent({ type: "session_restore_cwd", server: name, sessionId, actor: "system", command: "cd " + cwd, message, status: "failed" });
    }
  }

  function rememberSessionWorkingDirectory(name, command, server, options = {}) {
    const sessionKey = options.sessionKey || resolveTerminalSessionKey(name);
    const currentPath = sessionWorkingDirectories[sessionKey] || sessionWorkingDirectories[name] || server?.cwd || ".";
    const nextPath = resolveShellWorkingDirectory(command, currentPath, server?.cwd || ".");
    if (!nextPath) return;
    setSessionWorkingDirectories((current) => ({ ...current, [name]: nextPath, [sessionKey]: nextPath }));
    if (name === selectedServer) setSftpPaths((current) => ({ ...current, [name]: nextPath }));
  }

  function rememberTerminalPtySize(terminalKey, cols, rows) {
    if (!terminalKey) return;
    terminalPtySizesRef.current[terminalKey] = {
      cols: Math.min(Math.max(Number.parseInt(cols, 10) || 120, 40), 500),
      rows: Math.min(Math.max(Number.parseInt(rows, 10) || 32, 10), 200),
    };
  }

  function getInitialTerminalPtySize(terminalKey) {
    return terminalPtySizesRef.current[terminalKey] || { cols: 120, rows: 32 };
  }

  async function copySelectedSessionErrorDetail(targetName = selectedServer, targetSessionKey = selectedTerminalSessionKey) {
    const name = targetName || selectedServer;
    const sessionKey = targetSessionKey || resolveTerminalSessionKey(name);
    const session = sshSessions[sessionKey] || {};
    const server = servers[name] || {};
    const sshFailure = session.sshFailure || {};
    const failureKind = String(session.failureKind || sshFailure.kind || "").trim();
    const failureSuggestions = Array.isArray(sshFailure.suggestions)
      ? sshFailure.suggestions.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const lines = sessionKey === selectedTerminalSessionKey
      ? selectedTerminalLines
      : buildVisibleTerminalLines({
        baseLines: server?.terminal || [],
        appendedLines: terminalAppends[sessionKey] ? ["", ...terminalAppends[sessionKey]] : [],
        clearMarker: terminalClearMarkers[sessionKey] || 0,
      });
    const content = [
      `服务器：${name}`,
      `主机：${server.ip || server.host || ""}:${server.port || "22"}`,
      `用户：${server.user || "root"}`,
      `错误：${session.lastError || "无"}`,
      `失败类型：${failureKind || "--"}`,
      `诊断标签：${sshFailure.label || sshFailure.title || "--"}`,
      sshFailure.summary ? `诊断摘要：${sshFailure.summary}` : "",
      failureSuggestions.length ? `处理建议：\n${failureSuggestions.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
      "",
      "最近终端输出：",
      formatTerminalClipboardText(lines, 80),
    ].filter(Boolean).join("\n");
    await copyTextToClipboard(content, "SSH 错误详情已复制");
  }

  async function copySelectedSessionDiagnosticSummary(targetName = selectedServer, targetSessionKey = selectedTerminalSessionKey) {
    const name = targetName || selectedServer;
    const sessionKey = targetSessionKey || resolveTerminalSessionKey(name);
    const server = servers[name] || {};
    const session = sshSessions[sessionKey] || {};
    const serverAuthStatus = getServerAuthStatus(server);
    const sshFailure = session.sshFailure || {};
    const failureKind = String(session.failureKind || sshFailure.kind || "").trim();
    const currentWorkingDirectory = normalizeSftpPath(sessionWorkingDirectories[sessionKey] || sessionWorkingDirectories[name] || server?.cwd || "");
    const terminalHealthText = buildTerminalHealthText(session, server);
    const recentTerminalLines = getTerminalLinesForSession(name, { sessionKey }).slice(-20);
    const recentTerminalOutput = formatTerminalClipboardText(recentTerminalLines, 20);
    const failureSuggestions = Array.isArray(sshFailure.suggestions)
      ? sshFailure.suggestions.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const content = [
      "SSH 连接排障摘要",
      `服务器：${name}`,
      `主机：${server.ip || server.host || ""}:${server.port || "22"}`,
      `用户：${server.user || "root"}`,
      `认证状态：${serverAuthStatus.label}`,
      `会话键：${sessionKey || "--"}`,
      `后端会话：${session.sessionId || "--"}`,
      `连接状态：${session.status || "unknown"}`,
      `交互模式：${isTerminalInteractiveMode(session) ? "是" : "否"}`,
      `当前远程目录：${currentWorkingDirectory || "--"}`,
      `健康检查：${terminalHealthText}`,
      session.healthMessage ? `健康消息：${session.healthMessage}` : "",
      `SSH 命令：${buildServerCopySshCommand(name, server)}`,
      session.lastError ? `最近错误：${session.lastError}` : "",
      `失败类型：${failureKind || "--"}`,
      `诊断标签：${sshFailure.label || sshFailure.title || "--"}`,
      sshFailure.summary ? `诊断摘要：${sshFailure.summary}` : "",
      failureSuggestions.length ? `处理建议：\n${failureSuggestions.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
      recentTerminalOutput ? `最近终端输出：\n${recentTerminalOutput}` : "",
      "",
      "建议：先测试网络端口，再验证认证方式、主机指纹、堡垒机/ProxyJump 和服务器 sshd 日志。",
    ].filter(Boolean).join("\n");
    await copyTextToClipboard(content, "SSH 排障摘要已复制");
  }

  function dismissTerminalSessionRecovery(targetName = selectedServer, targetSessionKey = selectedTerminalSessionKey) {
    const name = targetName || selectedServer;
    const sessionKey = targetSessionKey || resolveTerminalSessionKey(name);
    setSshSessions((state) => {
      const current = state[sessionKey] || {};
      return {
        ...state,
        [sessionKey]: {
          ...current,
          serverName: current.serverName || name,
          busy: false,
          lastError: "",
          failureKind: "",
          sshFailure: null,
          disconnectedAt: "",
          status: current.sessionId ? "connected" : "idle",
        },
      };
    });
    showNotice("已隐藏当前 SSH 会话恢复提示");
  }

  async function runTerminalSessionRecoveryAction(action) {
    const actionType = action?.type || action?.target;
    switch (actionType) {
      case "reconnect":
        return reconnectSelectedSession();
      case "reconnect-clear":
        return reconnectAndClearSelectedSession();
      case "connection-test":
        return testSelectedConnection();
      case "auth-center":
        return openAuthCenter(selectedServer);
      case "agent-diagnostic":
        return queueSelectedSshDiagnostic();
      case "copy-error-detail":
        return copySelectedSessionErrorDetail();
      case "copy-diagnostic-summary":
        return copySelectedSessionDiagnosticSummary();
      case "copy-ssh-command":
        return copyServerSshCommand(selectedServer);
      case "edit-connection":
        return openEditHost(selectedServer);
      case "session-logs":
        return openSessionLogs({ server: selectedServer, status: "failed" });
      case "dismiss-recovery":
        return dismissTerminalSessionRecovery();
      case "export-diagnostic":
        return exportDiagnosticPackage();
      default:
        if (action?.label) showNotice(action.label);
        return null;
    }
  }

  async function openSelectedSession(targetName = selectedServer, options = {}) {
    const name = targetName || selectedServer;
    const sessionKey = resolveTerminalSessionKey(name, options);
    const force = Boolean(options.force);
    const server = servers[name];
    if (!server) return "";
    const sessionLogContext = buildSshSessionLogContext(name, server);
    const openActor = options.actor || "user";
    selectServerTab(name, { sessionKey });
    const current = sshSessions[sessionKey] || {};
    if (current.sessionId && !force) { showNotice(name + " SSH 会话已连接"); return current.sessionId; }
    if (current.busy && !force) { showNotice(name + " SSH 会话正在连接"); return current.sessionId || ""; }
    const api = safeFileApi();
    if (!api?.open_ssh_session) {
      const message = "当前环境不支持 SSH 会话，请使用正式 exe。";
      setSshSessions((state) => ({
        ...state,
        [sessionKey]: {
          ...(state[sessionKey] || {}),
          serverName: name,
          busy: false,
          sessionId: "",
          lastError: message,
          failureKind: "environment",
          sshFailure: { kind: "environment", label: "环境不支持", summary: message },
        },
      }));
      appendTerminalLines(name, buildSshOpenFailureTerminalLines(message, { kind: "environment", label: "环境不支持", summary: message }, server), { terminalKey: sessionKey });
      writeAuditEvent({ type: "session_open_failed", server: name, sessionId: "", actor: openActor, message, status: "failed" });
      writeSessionLogEvent({ type: "session_open_failed", server: name, sessionId: "", actor: openActor, message, status: "failed", context: sessionLogContext });
      showNotice(message);
      return "";
    }
    if (current.sessionId && force && !options.skipExistingClose) {
      await closeSessionByName(name, "正在重新连接 SSH 会话...", { sessionKey });
    }
    const targetValidation = validateSshSessionOpenTarget(server);
    if (!targetValidation.ok && targetValidation.field !== "auth") {
      const message = targetValidation.message;
      setSshSessions((state) => ({
        ...state,
        [sessionKey]: {
          ...(state[sessionKey] || {}),
          serverName: name,
          busy: false,
          sessionId: "",
          lastError: message,
          failureKind: "config",
          sshFailure: { kind: "config", label: "连接配置", summary: message },
        },
      }));
      appendTerminalLines(name, buildSshOpenFailureTerminalLines(message, { kind: "config", label: "连接配置", summary: message }, server), { terminalKey: sessionKey });
      writeAuditEvent({ type: "session_open_failed", server: name, sessionId: "", actor: openActor, message, status: "failed" });
      writeSessionLogEvent({ type: "session_open_failed", server: name, sessionId: "", actor: openActor, message, status: "failed", context: sessionLogContext });
      showNotice(message);
      return "";
    }
    if (!hasUsableServerAuth(server)) {
      const message = "请先在认证中心绑定或填写 SSH 凭据。";
      setSshSessions((state) => ({
        ...state,
        [sessionKey]: {
          ...(state[sessionKey] || {}),
          serverName: name,
          busy: false,
          sessionId: "",
          lastError: message,
          failureKind: "auth",
          sshFailure: { kind: "auth", label: "缺少凭据", summary: message },
        },
      }));
      appendTerminalLines(name, buildSshOpenFailureTerminalLines(message, { kind: "auth", label: "缺少凭据", summary: message }, server), { terminalKey: sessionKey });
      writeAuditEvent({ type: "session_open_failed", server: name, sessionId: "", actor: openActor, message, status: "failed" });
      writeSessionLogEvent({ type: "session_open_failed", server: name, sessionId: "", actor: openActor, message, status: "failed", context: sessionLogContext });
      showNotice(message);
      return "";
    }
    const sshLogContext = {
      serverName: name,
      host: server?.ip || server?.host || "",
      port: server?.port || 22,
      user: server?.user || "",
      sessionKey,
    };
    const size = getRememberedTerminalPtySize(sessionKey);
    const openRequestId = nextSshOpenRequestId(sessionKey);
    setSshSessions((state) => ({ ...state, [sessionKey]: { ...(state[sessionKey] || {}), serverName: name, busy: true, lastError: "", failureKind: "", sshFailure: null } }));
    appendTerminalLines(name, ["[" + name + "]$ # connecting SSH..."], { terminalKey: sessionKey });
    try {
      const result = await api.open_ssh_session(server, server.credentialRef, { cols: size.cols, rows: size.rows });
      if (!isCurrentSshOpenRequest(sessionKey, openRequestId)) {
        if (result?.sessionId && api?.close_ssh_session) {
          await api.close_ssh_session(result.sessionId).catch((closeError) => {
            writeToolLogEvent({ level: "warn", component: "ssh", action: "close_stale_open_session_failed", message: String(closeError.message || closeError), context: sshLogContext });
          });
        }
        writeToolLogEvent({ level: "info", component: "ssh", action: "ignore_stale_open_session", message: "已忽略过期 SSH 连接结果。", context: sshLogContext });
        return "";
      }
      if (!result?.ok || !result.sessionId) {
        const message = result?.message || "SSH 会话连接失败";
        const failureDiagnostics = result?.sshFailure || buildSshConnectionDiagnostics({ ok: false, message, failureKind: result?.failureKind }, server);
        const hostKey = extractHostKeyFromSshResult(result);
        setSshSessions((state) => ({
          ...state,
          [sessionKey]: {
            ...(state[sessionKey] || {}),
            serverName: name,
            busy: false,
            sessionId: "",
            lastError: message,
            failureKind: failureDiagnostics?.kind || result?.failureKind || "unknown",
            sshFailure: failureDiagnostics,
          },
        }));
        if (hostKey?.sha256) {
          setConnectionOverrides((current) => ({
            ...current,
            [name]: {
              ...(current[name] || {}),
              ...buildHostKeyEvidenceOverride((current[name] || server).evidence, hostKey, server.trustedHostKey),
            },
          }));
        }
        appendTerminalLines(name, buildSshOpenFailureTerminalLines(message, failureDiagnostics, server), { terminalKey: sessionKey });
        writeToolLogEvent({
          level: "warn",
          component: "ssh",
          action: "open_session_failed",
          message,
          context: {
            ...sshLogContext,
            failureKind: failureDiagnostics?.kind || result?.failureKind || "unknown",
          },
        });
        writeAuditEvent({ type: "session_open_failed", server: name, sessionId: result?.sessionId || "", actor: openActor, message, status: "failed" });
        writeSessionLogEvent({ type: "session_open_failed", server: name, sessionId: result?.sessionId || "", actor: openActor, message, status: "failed", context: sessionLogContext });
        showNotice(message);
        return "";
      }
      setSshSessions((state) => ({
        ...state,
        [sessionKey]: {
          ...(state[sessionKey] || {}),
          serverName: name,
          busy: false,
          sessionId: result.sessionId,
          interactiveMode: false,
          lastError: "",
          failureKind: "",
          sshFailure: null,
        },
      }));
      writeAuditEvent({ type: "session_opened", server: name, sessionId: result.sessionId, actor: openActor, status: "ok" });
      writeSessionLogEvent({ type: "session_opened", server: name, sessionId: result.sessionId, actor: openActor, status: "ok", context: sessionLogContext });
      if (result.output) appendTerminalLines(name, formatInteractiveSessionLines(name, "ssh", result.output), { terminalKey: sessionKey, rawOutput: result.output });
      const autoForwardConfigs = buildAutoStartLocalForwardConfigs(server);
      const autoStartedForwardIds = [];
      for (const forwardConfig of autoForwardConfigs) {
        try {
          const forwardResult = await api.start_port_forward(server, server.credentialRef, forwardConfig);
          const forwardMessage = forwardResult?.message || `自动端口转发：127.0.0.1:${forwardConfig.localPort} -> ${forwardConfig.remoteHost}:${forwardConfig.remotePort}`;
          appendTerminalLines(name, ["# " + forwardMessage], { terminalKey: sessionKey });
          const forwardId = String(forwardResult?.forward?.id || "").trim();
          if (forwardResult?.ok && forwardId) {
            autoStartedForwardIds.push(forwardId);
          } else if (!forwardResult?.ok) {
            writeToolLogEvent({ level: "warn", component: "port-forward", action: "auto_start_failed", message: forwardMessage, context: { ...sshLogContext, localPort: forwardConfig.localPort, remoteHost: forwardConfig.remoteHost, remotePort: forwardConfig.remotePort } });
          }
        } catch (error) {
          const forwardMessage = "自动端口转发失败：" + (error.message || error);
          appendTerminalLines(name, ["# " + forwardMessage], { terminalKey: sessionKey });
          writeToolLogEvent({ level: "warn", component: "port-forward", action: "auto_start_failed", message: forwardMessage, context: { ...sshLogContext, localPort: forwardConfig.localPort, remoteHost: forwardConfig.remoteHost, remotePort: forwardConfig.remotePort } });
        }
      }
      if (autoStartedForwardIds.length) {
        setSshSessions((state) => ({
          ...state,
          [sessionKey]: {
            ...(state[sessionKey] || {}),
            autoPortForwardIds: autoStartedForwardIds,
          },
        }));
      }
      if (autoForwardConfigs.length) void refreshPortForwards();
      showNotice(name + " SSH 会话已连接");
      triggerSshOutputPoll();
      autoRefreshSftpForServer(name, { force: true });
      void restoreSessionWorkingDirectory(name, result.sessionId, server, { terminalKey: sessionKey });
      return result.sessionId;
    } catch (error) {
      if (!isCurrentSshOpenRequest(sessionKey, openRequestId)) {
        const staleSessionId = "";
        return staleSessionId;
      }
      const message = "SSH 会话连接失败：" + (error.message || error);
      const failureDiagnostics = buildSshConnectionDiagnostics({ ok: false, message, error: message }, server);
      setSshSessions((state) => ({ ...state, [sessionKey]: { ...(state[sessionKey] || {}), serverName: name, busy: false, sessionId: "", lastError: message, failureKind: failureDiagnostics?.kind || "unknown", sshFailure: failureDiagnostics } }));
      appendTerminalLines(name, buildSshOpenFailureTerminalLines(message, failureDiagnostics, server), { terminalKey: sessionKey });
      writeToolLogEvent({ level: "error", component: "ssh", action: "open_session_error", message, context: { ...sshLogContext, failureKind: failureDiagnostics?.kind || "unknown" } });
      writeAuditEvent({ type: "session_open_failed", server: name, sessionId: "", actor: openActor, message, status: "failed" });
      writeSessionLogEvent({ type: "session_open_failed", server: name, sessionId: "", actor: openActor, message, status: "failed", context: sessionLogContext });
      showNotice(message);
      return "";
    }
  }

  async function ensureCommandSession(name, options = {}) {
    const sessionKey = options.sessionKey || resolveTerminalSessionKey(name, options);
    const current = sshSessions[sessionKey] || {};
    if (current.sessionId) return current.sessionId;
    return openSelectedSession(name, { ...options, force: false });
  }

  async function closeSessionByName(name, reason = "SSH 会话已断开", options = {}) {
    const sessionKey = options.sessionKey || resolveTerminalSessionKey(name, options);
    const session = sshSessions[sessionKey] || {};
    invalidateSshOpenRequest(sessionKey);
    invalidateTerminalInputRequest(sessionKey);
    invalidateTerminalCommandRequest(sessionKey);
    const autoForwardIds = Array.isArray(session.autoPortForwardIds) ? session.autoPortForwardIds : [];
    if (!session.sessionId && autoForwardIds.length === 0) { setSshSessions((state) => ({ ...state, [sessionKey]: { ...(state[sessionKey] || {}), serverName: name, busy: false, sessionId: "", autoPortForwardIds: [] } })); return; }
    const sessionId = session.sessionId || "";
    const server = servers[name] || {};
    const sessionLogContext = buildSshSessionLogContext(name, server);
    const closeActor = options.actor || "system";
    const api = safeFileApi();
    let closeFailureMessage = "";
    try {
      if (sessionId && api?.close_ssh_session) {
        const closeResult = await api.close_ssh_session(sessionId);
        if (!closeResult?.ok) {
          closeFailureMessage = closeResult?.message || "关闭 SSH 会话失败，请查看会话日志或工具日志。";
        }
      }
    } catch (error) {
      closeFailureMessage = "关闭 SSH 会话失败：" + (error.message || error);
    }
    for (const forwardId of autoForwardIds) {
      if (!forwardId || !api?.stop_port_forward) continue;
      try {
        const stopResult = await api.stop_port_forward(forwardId);
        if (stopResult?.ok) {
          appendTerminalLines(name, [`# 自动端口转发已停止：${forwardId}`], { terminalKey: sessionKey });
        } else {
          const message = stopResult?.message || `自动端口转发停止失败：${forwardId}`;
          appendTerminalLines(name, ["# " + message], { terminalKey: sessionKey });
          writeToolLogEvent({ level: "warn", component: "port-forward", action: "auto_stop_failed", message, context: { serverName: name, sessionKey, forwardId } });
        }
      } catch (error) {
        const message = "自动端口转发停止失败：" + (error.message || error);
        appendTerminalLines(name, ["# " + message], { terminalKey: sessionKey });
        writeToolLogEvent({ level: "warn", component: "port-forward", action: "auto_stop_failed", message, context: { serverName: name, sessionKey, forwardId } });
      }
    }
    setSshSessions((state) => ({ ...state, [sessionKey]: { ...(state[sessionKey] || {}), serverName: name, busy: false, sessionId: "", interactiveMode: false, autoPortForwardIds: [], lastError: closeFailureMessage, disconnectedAt: new Date().toISOString() } }));
    writeAuditEvent({ type: closeFailureMessage ? "session_close_failed" : "session_closed", server: name, sessionId, actor: closeActor, message: closeFailureMessage || reason, status: closeFailureMessage ? "failed" : "ok" });
    writeSessionLogEvent({ type: closeFailureMessage ? "session_close_failed" : "session_closed", server: name, sessionId, actor: closeActor, message: closeFailureMessage || reason, status: closeFailureMessage ? "failed" : "ok", context: sessionLogContext });
    if (closeFailureMessage) appendTerminalLines(name, ["# " + closeFailureMessage], { terminalKey: sessionKey });
    appendTerminalLines(name, ["# " + reason], { terminalKey: sessionKey });
  }

  async function closeSelectedSession(targetName = selectedServer, options = {}) {
    const sessionKey = options.sessionKey || resolveTerminalSessionKey(targetName);
    await closeSessionByName(targetName, "SSH 会话已断开", { sessionKey, actor: "user" });
  }
  async function reconnectSelectedSession(targetName = selectedServer, options = {}) {
    const sessionKey = options.sessionKey || resolveTerminalSessionKey(targetName);
    await closeSessionByName(targetName, "正在重新连接 SSH 会话...", { sessionKey });
    return openSelectedSession(targetName, { force: true, skipExistingClose: true, sessionKey });
  }
  async function reconnectAndClearSelectedSession(targetName = selectedServer, options = {}) {
    const name = targetName || selectedServer;
    const sessionKey = options.sessionKey || resolveTerminalSessionKey(name);
    clearSelectedTerminalOutput(name, { sessionKey });
    return reconnectSelectedSession(name, { sessionKey });
  }

  async function stopSelectedCommand(targetName = selectedServer, options = {}) {
    const sessionKey = options.sessionKey || resolveTerminalSessionKey(targetName);
    const session = sshSessions[sessionKey] || {};
    const interruptLogContext = { ...buildSshSessionLogContext(targetName, servers[targetName] || {}), sessionKey };
    const api = safeFileApi();
    invalidateTerminalInputRequest(sessionKey);
    invalidateTerminalCommandRequest(sessionKey);
    if (!session.sessionId) return;
    try {
      let result = null;
      if (api?.interrupt_ssh_session_command) result = await api.interrupt_ssh_session_command(session.sessionId);
      else if (api?.send_ssh_session_input) result = await api.send_ssh_session_input(session.sessionId, "\x03");
      else throw new Error("当前环境不支持 SSH 中断，请使用正式 exe。");
      if (!result?.ok) throw new Error(result?.message || "SSH 中断请求未被远端会话接受。");
      appendTerminalLines(targetName, ["^C"], { terminalKey: sessionKey });
      writeAuditEvent({ type: "session_interrupt_sent", server: targetName, sessionId: session.sessionId, actor: "user", status: "ok" });
      writeSessionLogEvent({ type: "session_interrupt_sent", server: targetName, sessionId: session.sessionId, actor: "user", status: "ok", context: interruptLogContext });
      triggerSshOutputPoll();
      showNotice("已发送 Ctrl+C 中断当前 SSH 命令");
    } catch (error) {
      const message = "中断 SSH 命令失败：" + (error.message || error);
      writeAuditEvent({ type: "session_interrupt_failed", server: targetName, sessionId: session.sessionId, actor: "user", message, status: "failed" });
      writeSessionLogEvent({ type: "session_interrupt_failed", server: targetName, sessionId: session.sessionId, actor: "user", message, status: "failed", context: interruptLogContext });
      appendTerminalLines(targetName, ["# " + message], { terminalKey: sessionKey });
      showNotice(message);
    }
  }

  async function checkSelectedSessionHealth(targetName = selectedServer, options = {}) {
    const sessionKey = options.sessionKey || resolveTerminalSessionKey(targetName);
    const session = sshSessions[sessionKey] || {};
    const api = safeFileApi();
    const healthLogContext = { ...buildSshSessionLogContext(targetName, servers[targetName] || {}), sessionKey };
    if (!session.sessionId) {
      showNotice("当前没有已连接的 SSH 会话");
      return { ok: false, active: false, message: "当前没有已连接的 SSH 会话" };
    }
    if (!api?.check_ssh_session_health) {
      const message = "当前环境不支持 SSH 会话状态检查，请使用正式 exe。";
      showNotice(message);
      return { ok: false, active: false, message };
    }
    setSshSessions((state) => ({
      ...state,
      [sessionKey]: {
        ...(state[sessionKey] || {}),
        serverName: targetName,
        healthChecking: true,
      },
    }));
    try {
      const result = await api.check_ssh_session_health(session.sessionId);
      if (result?.active) {
        setSshSessions((state) => {
          const currentSession = state[sessionKey] || {};
          if (currentSession.sessionId !== session.sessionId) return state;
          return {
            ...state,
            [sessionKey]: {
              ...currentSession,
              serverName: targetName,
              healthChecking: false,
              healthCheckedAt: new Date().toISOString(),
              healthMessage: result?.message || "SSH 会话正常。",
              keepaliveSeconds: result?.keepaliveSeconds ?? servers[targetName]?.keepaliveSeconds ?? 30,
            },
          };
        });
        writeAuditEvent({ type: "session_health_manual", server: targetName, sessionId: session.sessionId, actor: "user", message: result?.message || "SSH 会话正常。", status: "ok" });
        writeSessionLogEvent({ type: "session_health_manual", server: targetName, sessionId: session.sessionId, actor: "user", message: result?.message || "SSH 会话正常。", status: "ok", context: healthLogContext });
        showNotice(result?.message || "SSH 会话正常。");
        return result;
      }
      const message = result?.message || "SSH 会话状态异常，请重新连接。";
      const failureDiagnostics = result?.sshFailure || buildSshConnectionDiagnostics({ ok: false, message, failureKind: result?.failureKind }, servers[targetName] || {});
      setSshSessions((state) => {
        const currentSession = state[sessionKey] || {};
        if (currentSession.sessionId !== session.sessionId) return state;
        return {
          ...state,
          [sessionKey]: {
            ...currentSession,
            serverName: targetName,
            healthChecking: false,
            sessionId: "",
            busy: false,
            interactiveMode: false,
            lastError: message,
            failureKind: failureDiagnostics?.kind || result?.failureKind || "unknown",
            sshFailure: failureDiagnostics,
            disconnectedAt: new Date().toISOString(),
          },
        };
      });
      appendTerminalLines(targetName, [`[${targetName}]$ # SSH 会话状态异常`, message, "会话已断开，可点击“重连会话”重新连接。"], { terminalKey: sessionKey });
      writeAuditEvent({ type: "session_health_manual_failed", server: targetName, sessionId: session.sessionId, actor: "user", message, status: "failed" });
      writeSessionLogEvent({ type: "session_health_manual_failed", server: targetName, sessionId: session.sessionId, actor: "user", message, status: "failed", context: healthLogContext });
      showNotice(message);
      return { ok: false, active: false, message };
    } catch (error) {
      const message = "SSH 会话状态检查失败：" + (error.message || error);
      setSshSessions((state) => {
        const currentSession = state[sessionKey] || {};
        if (currentSession.sessionId !== session.sessionId) return state;
        return {
          ...state,
          [sessionKey]: {
            ...currentSession,
            serverName: targetName,
            healthChecking: false,
            lastError: message,
          },
        };
      });
      appendTerminalLines(targetName, ["# " + message], { terminalKey: sessionKey });
      writeAuditEvent({ type: "session_health_manual_failed", server: targetName, sessionId: session.sessionId, actor: "user", message, status: "failed" });
      writeSessionLogEvent({ type: "session_health_manual_failed", server: targetName, sessionId: session.sessionId, actor: "user", message, status: "failed", context: healthLogContext });
      showNotice(message);
      return { ok: false, active: false, message };
    }
  }

  function finishSelectedInteractiveMode(targetName = selectedServer, options = {}) {
    const sessionKey = options.sessionKey || resolveTerminalSessionKey(targetName);
    setSshSessions((state) => ({ ...state, [sessionKey]: { ...(state[sessionKey] || {}), interactiveMode: false, busy: false } }));
  }

  async function resizeSelectedSession(cols, rows) {
    const session = sshSessions[selectedTerminalSessionKey] || {};
    if (!session.sessionId) return;
    try {
      const result = await safeFileApi()?.resize_ssh_session?.(session.sessionId, cols, rows);
      if (!result?.ok) {
        await writeToolLogEvent({
          level: "warn",
          component: "ssh",
          action: "resize_session",
          message: result?.message || "SSH terminal resize failed",
          context: { sessionId: session.sessionId, cols, rows, serverName: selectedServer },
        });
      }
    } catch (error) {
      await writeToolLogEvent({
        level: "warn",
        component: "ssh",
        action: "resize_session",
        message: String(error?.message || error || "resize failed"),
        context: { sessionId: session.sessionId, cols, rows, serverName: selectedServer },
      });
    }
  }

  function queueAgentCapability(capability, targetName = selectedServer) {
    const name = targetName || selectedServer;
    if (capability?.enabled === false) {
      showNotice("该 Agent 能力已停用，请先启用后再加入队列。");
      return null;
    }
    try {
      const task = buildAgentTask(capability, { serverName: name });
      setAgentTasks((current) => queueAgentTask(current, task));
      showNotice(`Agent \u5df2\u52a0\u5165\u6267\u884c\u961f\u5217：${task.title || capability.name}`);
      return task;
    } catch (error) {
      showNotice("加入 Agent 执行队列失败：" + (error.message || error));
      return null;
    }
  }

  function queueDiagnosticSkill(skill, targetName = selectedServer) {
    const name = targetName || selectedServer;
    const capability = skill || agentCapabilities.find((item) => item.type === "Skill") || {
      type: "Skill",
      name: "Linux \u57fa\u7840\u5065\u5eb7\u68c0\u67e5",
      entry: "linux-basic-health",
      permission: "\u53ea\u8bfb",
    };
    try {
      const task = buildAgentTask(capability, { serverName: name });
      setAgentTasks((current) => queueAgentTask(current, task));
      showNotice(`Agent \u5df2\u52a0\u5165\u8bca\u65ad\u961f\u5217\uff1a${task.title || capability.name}`);
      return task;
    } catch (error) {
      showNotice("\u52a0\u5165 Agent \u8bca\u65ad\u5931\u8d25\uff1a" + (error.message || error));
      return null;
    }
  }

  function queueSelectedSshDiagnostic() {
    const session = sshSessions[selectedTerminalSessionKey] || {};
    if (session.lastError) {
      const task = buildSshDiagnosticAgentTask(
        { kind: "ssh-session", title: "SSH \u4f1a\u8bdd\u8bca\u65ad", summary: session.lastError },
        { serverName: selectedServer, server: servers[selectedServer] },
      );
      setAgentTasks((current) => queueAgentTask(current, task));
      showNotice("Agent \u5df2\u52a0\u5165 SSH \u8bca\u65ad\u961f\u5217");
      return task;
    }
    return queueDiagnosticSkill(null, selectedServer);
  }

  async function openAndConnectServerInNewTerminalTab(targetName = selectedServer) {
    const name = targetName || selectedServer;
    const result = createDuplicateTerminalTab(visibleTerminalTabs, name, serverNames);
    saveTerminalTabs(result.tabs);
    setSelectedTerminalTabId(result.selectedTabId);
    setSelectedServer(name);
    return openSelectedSession(name, { sessionKey: result.selectedTabId });
  }

  function approveQueuedAgentTask(task) {
    if (!task?.id) return;
    const policy = task.command ? evaluateCommandPolicy(task.command) : {};
    const decision = buildAgentApprovalDecision(task, policy);
    const approvedTask = {
      ...task,
      headers: task.headers || [],
      status: AGENT_TASK_STATUSES[1],
      approvedAt: new Date().toISOString(),
    };
    setAgentTasks((current) => approveAgentTask(current, task.id));
    if (decision.runtimeRequest) {
      executeApprovedAgentTask(approvedTask, decision.runtimeRequest);
      showNotice(decision.notice || "已审批并执行 Agent 任务：" + (task.title || task.capabilityName || task.id));
      return;
    }
    if (decision.action === "stage_command" && decision.command) {
      const inputKey = resolveCommandInputKey(task.targetServer || selectedServer);
      updateCommandInput(inputKey, decision.command);
    }
    showNotice(decision.notice || "已审批 Agent 任务：" + (task.title || task.capabilityName || task.id));
  }

  function cancelAgentTask(task) {
    if (!task?.id) return;
    setAgentTasks((current) => markAgentTaskCancelled(current, task.id, "用户取消"));
    showNotice("已取消 Agent 任务：" + (task.title || task.capabilityName || task.id));
  }

  async function executeApprovedAgentTask(task, runtimeRequest) {
    if (!task?.id || !runtimeRequest) return;
    const api = safeFileApi();
    const serverName = runtimeRequest.server || task.targetServer || selectedServer;
    const terminalKey = resolveTerminalSessionKey(serverName);
    setRunningAgentTasks((current) => ({ ...current, [task.id]: { ...task, runtimeKind: runtimeRequest.kind, startedAt: new Date().toISOString() } }));
    try {
      if (runtimeRequest.kind === "cli") {
        const plan = buildCliRunnerPlan(runtimeRequest);
        appendTerminalLines(serverName, formatCliRunnerTerminalLines(plan), { terminalKey });
        if (!plan.ready || !api?.run_local_cli_command) throw new Error(plan.summary || "本地 CLI Runner 不可用。");
        const result = await api.run_local_cli_command(plan.command, 20, task.id);
        appendTerminalLines(serverName, formatCliRunnerResultTerminalLines(plan, result), { terminalKey });
        const resultText = result?.message || (result?.ok ? "CLI 执行完成" : "CLI 执行失败");
        setAgentTasks((current) => completeAgentTask(current, task.id, resultText));
        setAgentTaskNotice({ id: `${task.id}-${Date.now()}`, targetServer: serverName, text: `Agent 任务已完成：${task.title || task.capabilityName || task.id}\n${resultText}` });
        return;
      }

      if (runtimeRequest.kind === "mcp") {
        const plan = buildMcpRunnerPlan(runtimeRequest, servers[serverName] || {});
        appendTerminalLines(serverName, formatMcpRunnerTerminalLines(plan), { terminalKey });
        if (!plan.ready || !api?.call_mcp_http) throw new Error(plan.summary || "MCP Runner 不可用。");
        const result = await api.call_mcp_http(plan.endpoint, plan.requests, 15, plan.headers || [], task.id);
        appendTerminalLines(serverName, formatMcpHttpResultTerminalLines(plan, result), { terminalKey });
        const resultText = result?.message || (result?.ok ? "MCP 调用完成" : "MCP 调用失败");
        setAgentTasks((current) => completeAgentTask(current, task.id, resultText));
        setAgentTaskNotice({ id: `${task.id}-${Date.now()}`, targetServer: serverName, text: `Agent 任务已完成：${task.title || task.capabilityName || task.id}\n${resultText}` });
        return;
      }

      if (runtimeRequest.kind === "skill") {
        const plan = buildSkillRunnerPlan(runtimeRequest, evaluateCommandPolicy);
        appendTerminalLines(serverName, formatSkillRunnerTerminalLines(plan), { terminalKey });
        const session = sshSessions[terminalKey] || {};
        const dispatch = buildSkillRunnerDispatch(plan, { sessionId: session.sessionId, canSend: Boolean(api?.send_ssh_session_input || api?.send_ssh_session_command) });
        if (dispatch.mode === "execute") {
          for (const item of dispatch.commands) {
            const result = api?.send_ssh_session_input
              ? await api.send_ssh_session_input(dispatch.sessionId, item.command, true)
              : await api.send_ssh_session_command(dispatch.sessionId, item.command);
            if (result?.output) appendTerminalLines(serverName, formatInteractiveSessionLines(serverName, item.command, result.output).slice(1), { terminalKey, rawOutput: result.output });
            if (!result?.ok) throw new Error(result?.message || "Skill 命令发送失败。");
          }
          setAgentTasks((current) => completeAgentTask(current, task.id, "Skill 执行完成"));
          setAgentTaskNotice({ id: `${task.id}-${Date.now()}`, targetServer: serverName, text: `Agent 任务已完成：${task.title || task.capabilityName || task.id}\nSkill 执行完成` });
          return;
        }
        if (dispatch.firstCommand) {
          updateCommandInput(resolveCommandInputKey(serverName, { sessionKey: terminalKey }), dispatch.firstCommand);
          const resultText = "Skill 已写入终端输入框，等待发送。";
          setAgentTasks((current) => completeAgentTask(current, task.id, resultText));
          setAgentTaskNotice({ id: `${task.id}-${Date.now()}`, targetServer: serverName, text: `Agent 任务已完成：${task.title || task.capabilityName || task.id}\n${resultText}` });
          return;
        }
        throw new Error(plan.summary || "Skill Runner 未生成可执行命令。");
      }
    } catch (error) {
      const message = "Agent 任务执行失败：" + (error.message || error);
      appendTerminalLines(serverName, ["# " + message], { terminalKey });
      setAgentTasks((current) => completeAgentTask(current, task.id, message));
      setAgentTaskNotice({ id: `${task.id}-${Date.now()}`, targetServer: serverName, text: message });
      showNotice(message);
    } finally {
      setRunningAgentTasks((current) => { const next = { ...current }; delete next[task.id]; return next; });
    }
  }

  async function cancelRunningAgentTask(task) {
    if (!task?.id) return;
    const api = safeFileApi();
    try {
      if (api?.cancel_local_cli_command) await api.cancel_local_cli_command(task.id);
      if (api?.cancel_mcp_http_call) await api.cancel_mcp_http_call(task.id);
    }
    catch (error) { showNotice("取消 Agent 任务失败：" + (error.message || error)); return; }
    setRunningAgentTasks((current) => { const next = { ...current }; delete next[task.id]; return next; });
    setAgentTasks((current) => markAgentTaskCancelled(current, task.id, "用户取消"));
    setAgentTaskNotice({ id: `${task.id}-${Date.now()}`, targetServer: task.targetServer || selectedServer, text: `Agent 任务已取消：${task.title || task.capabilityName || task.id}` });
    showNotice("已取消 Agent 任务：" + (task.title || task.capabilityName || task.id));
  }
  function clampLayoutColumn(side, value) {
    return side === "left" ? clampNumber(value, 180, 360) : clampNumber(value, 320, 560);
  }

  function setLayoutColumn(side, value) {
    setLayoutColumns((current) => {
      const next = { ...current, [side]: clampLayoutColumn(side, value) };
      writeLocalJson("sshAgentLayoutColumns", next);
      return next;
    });
  }

  function adjustLayoutColumn(side, delta) {
    setLayoutColumns((current) => {
      const next = { ...current, [side]: clampLayoutColumn(side, current[side] + delta) };
      writeLocalJson("sshAgentLayoutColumns", next);
      return next;
    });
  }

  function setSidebarSectionHeight(section, height) {
    const fallback = DEFAULT_SIDEBAR_SECTIONS[section] || 220;
    const nextHeight = clampNumber(Math.round(Number(height) || fallback), 132, 560);
    setSidebarSections((current) => {
      const normalized = { ...DEFAULT_SIDEBAR_SECTIONS, ...current };
      if (normalized[section] === nextHeight) return current;
      const next = { ...normalized, [section]: nextHeight };
      writeLocalJson("sshAgentSidebarSections", next);
      return next;
    });
  }

  function handleLayoutResizeKeyDown(side, event) {
    const step = event.shiftKey ? 32 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      adjustLayoutColumn(side, side === "left" ? -step : step);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      adjustLayoutColumn(side, side === "left" ? step : -step);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setLayoutColumn(side, side === "left" ? 180 : 320);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setLayoutColumn(side, side === "left" ? 360 : 560);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      setLayoutColumn(side, DEFAULT_LAYOUT_COLUMNS[side]);
    }
  }

  function startLayoutResize(side, event) {
    event.preventDefault();
    const startX = event.clientX;
    const startColumns = layoutColumns;

    function applyResize(pointerEvent) {
      const delta = pointerEvent.clientX - startX;
      setLayoutColumns((current) => {
        const next = side === "left"
          ? { ...current, left: clampLayoutColumn("left", startColumns.left + delta) }
          : { ...current, right: clampLayoutColumn("right", startColumns.right - delta) };
        writeLocalJson("sshAgentLayoutColumns", next);
        return next;
      });
    }

    function stopResize() {
      window.removeEventListener("mousemove", applyResize);
      window.removeEventListener("mouseup", stopResize);
      document.body.classList.remove("is-resizing-layout");
    }

    document.body.classList.add("is-resizing-layout");
    window.addEventListener("mousemove", applyResize);
    window.addEventListener("mouseup", stopResize);
  }

  function resetLayoutColumns() {
    setLayoutColumns(DEFAULT_LAYOUT_COLUMNS);
    writeLocalJson("sshAgentLayoutColumns", DEFAULT_LAYOUT_COLUMNS);
    setSidebarSections(DEFAULT_SIDEBAR_SECTIONS);
    writeLocalJson("sshAgentSidebarSections", DEFAULT_SIDEBAR_SECTIONS);
  }

  function resetLayoutColumn(side) {
    setLayoutColumn(side, DEFAULT_LAYOUT_COLUMNS[side]);
  }

  function toggleTerminalFocusMode() {
    setTerminalFocusMode((current) => !current);
  }

  async function sendSelectedSessionInput(event, { text: inputText, submit = true, clearInput = true, sessionKey: inputSessionKey = "", commandInputKey: inputCommandInputKey = "", finishInteractiveMode = false, targetName = "", submittedCommand = "", sensitiveInput = false } = {}) {
    event?.preventDefault?.();
    const name = targetName || selectedServer;
    const sessionKey = inputSessionKey || resolveTerminalSessionKey(name);
    const inputKey = inputCommandInputKey || resolveCommandInputKey(name, { sessionKey });
    const session = sshSessions[sessionKey] || {};
    const sessionId = session.sessionId;
    const inputServer = servers[name] || {};
    const sshInputLogContext = {
      serverName: name,
      host: inputServer?.ip || inputServer?.host || "",
      port: inputServer?.port || 22,
      user: inputServer?.user || "",
      sessionKey,
    };
    if (!sessionId) {
      const message = "当前没有已连接的 SSH 会话";
      appendTerminalLines(name, ["# " + message], { terminalKey: sessionKey });
      writeToolLogEvent({ level: "warn", component: "ssh", action: "interactive_input_no_session", message, context: { ...sshInputLogContext, failureKind: "input" } });
      showNotice(message);
      return { ok: false, message: "no ssh session" };
    }
    const text = inputText ?? commandInputs[inputKey] ?? "";
    const api = safeFileApi();
    if (!api?.send_ssh_session_input && !api?.send_ssh_session_command) {
      const message = "当前环境不支持 SSH 输入，请使用正式 exe。";
      appendTerminalLines(name, ["# " + message], { terminalKey: sessionKey });
      writeToolLogEvent({ level: "error", component: "ssh", action: "interactive_input_api_unavailable", message, context: { ...sshInputLogContext, failureKind: "input" } });
      showNotice(message);
      return { ok: false, message: "api unavailable" };
    }
    const inputRequestId = nextTerminalInputRequestId(sessionKey);
    try {
      const result = api?.send_ssh_session_input
        ? await withSshApiTimeout(
          api.send_ssh_session_input(sessionId, text, submit),
          "SSH 交互输入响应超时，请检查网络或重新连接会话。",
        )
        : await withSshApiTimeout(
          api.send_ssh_session_command(sessionId, text),
          "SSH 命令响应超时，请检查网络或重新连接会话。",
        );
      if (!isCurrentTerminalInputRequest(sessionKey, inputRequestId)) {
        const staleMessage = "SSH 输入结果已忽略：会话已被取消或替换。";
        writeToolLogEvent({ level: "info", component: "ssh", action: "ignore_stale_interactive_input", message: staleMessage, context: { ...sshInputLogContext, sessionId } });
        return { ok: false, stale: true, message: staleMessage };
      }
      if (result?.output) {
        const visibleSubmittedCommand = sensitiveInput ? "" : submittedCommand || text;
        appendTerminalLines(name, formatInteractiveSessionLines(name, visibleSubmittedCommand, result.output).slice(visibleSubmittedCommand ? 1 : 0), { terminalKey: sessionKey, rawOutput: result.output });
      }
      if (!result?.ok) {
        const message = result?.message || "SSH 命令发送失败";
        const failureDiagnostics = result?.sshFailure || buildSshConnectionDiagnostics({ ok: false, message, failureKind: result?.failureKind }, inputServer);
        const disconnectedAt = new Date().toISOString();
        appendTerminalLines(name, [`# SSH 发送失败：${message}`, "会话已断开，可点击“重连会话”重新连接。"], { terminalKey: sessionKey });
        setSshSessions((current) => ({ ...current, [sessionKey]: { ...(current[sessionKey] || {}), serverName: name, sessionId: "", busy: false, interactiveMode: false, disconnectedAt, lastError: message, failureKind: failureDiagnostics?.kind || result?.failureKind || "input", sshFailure: failureDiagnostics } }));
        writeToolLogEvent({ level: "warn", component: "ssh", action: "interactive_input_failed", message, context: { ...sshInputLogContext, sessionId, failureKind: failureDiagnostics?.kind || result?.failureKind || "input" } });
        const loggedInput = formatTerminalInputForLog(text, { sensitiveInput, submit });
        writeAuditEvent({ type: "interactive_input_failed", server: name, sessionId, actor: "user", command: loggedInput, message, status: "failed" });
        writeSessionLogEvent({ type: "interactive_input_failed", server: name, sessionId, actor: "user", command: loggedInput, message, status: "failed", context: sshInputLogContext });
        showNotice(message);
        return { ok: false, message };
      }
      const loggedInput = formatTerminalInputForLog(text, { sensitiveInput, submit });
      writeAuditEvent({ type: "interactive_input_sent", server: name, sessionId, actor: "user", command: loggedInput, status: "ok" });
      writeSessionLogEvent({ type: "interactive_input_sent", server: name, sessionId, actor: "user", command: loggedInput, status: "ok", context: sshInputLogContext });
      if (clearInput) updateCommandInput(inputKey, "");
      if (finishInteractiveMode) finishSelectedInteractiveMode(name);
      triggerSshOutputPoll();
      return result;
    } catch (error) {
      if (!isCurrentTerminalInputRequest(sessionKey, inputRequestId)) {
        const staleMessage = "SSH 输入结果已忽略：会话已被取消或替换。";
        writeToolLogEvent({ level: "info", component: "ssh", action: "ignore_stale_interactive_input_error", message: staleMessage, context: { ...sshInputLogContext, sessionId } });
        return { ok: false, stale: true, message: staleMessage };
      }
      const message = "SSH 命令发送失败：" + (error.message || error);
      const failureDiagnostics = buildSshConnectionDiagnostics({ ok: false, message, error: message }, inputServer);
      const disconnectedAt = new Date().toISOString();
      appendTerminalLines(name, [`# SSH 发送失败：${message}`, "会话已断开，可点击“重连会话”重新连接。"], { terminalKey: sessionKey });
      setSshSessions((current) => ({ ...current, [sessionKey]: { ...(current[sessionKey] || {}), serverName: name, sessionId: "", busy: false, interactiveMode: false, disconnectedAt, lastError: message, failureKind: failureDiagnostics?.kind || "input", sshFailure: failureDiagnostics } }));
      writeToolLogEvent({ level: "error", component: "ssh", action: "interactive_input_error", message, context: { ...sshInputLogContext, sessionId, failureKind: failureDiagnostics?.kind || "input" } });
      const loggedInput = formatTerminalInputForLog(text, { sensitiveInput, submit });
      writeAuditEvent({ type: "interactive_input_failed", server: name, sessionId, actor: "user", command: loggedInput, message, status: "failed" });
      writeSessionLogEvent({ type: "interactive_input_failed", server: name, sessionId, actor: "user", command: loggedInput, message, status: "failed", context: sshInputLogContext });
      showNotice(message);
      return { ok: false, message };
    }
  }

  async function sendSelectedCommand(event, options = {}) {
    event?.preventDefault?.();
    const name = options.targetName || selectedServer;
    const sessionKey = resolveTerminalSessionKey(name, options);
    const commandInputKey = resolveCommandInputKey(name, { ...options, sessionKey });
    const rawCommand = String(options.command ?? commandInputs[commandInputKey] ?? "");
    const command = rawCommand.trim();
    let sessionId = sshSessions[sessionKey]?.sessionId || "";
    if (!command && sessionId) {
      return await sendSelectedSessionInput(event, { text: "", submit: true, sessionKey, commandInputKey, targetName: name });
    }
    if (!command) return null;
    if (!sessionId) appendTerminalLines(name, ["# 未连接，正在自动连接 SSH 会话"], { terminalKey: sessionKey });
    sessionId = await ensureCommandSession(name, { sessionKey });
    if (!sessionId) {
      const message = "SSH 自动连接失败，命令未发送，输入框内容已保留。";
      appendTerminalLines(name, [`# 命令未发送：${message}`, `${terminalPromptLabel(name)} ${rawCommand}`], { terminalKey: sessionKey });
      writeToolLogEvent({ level: "warn", component: "ssh", action: "auto_connect_command_not_sent", message, context: { ...buildSshSessionLogContext(name, servers[name] || {}), sessionKey, failureKind: "connect" } });
      showNotice(message);
      return { ok: false, message };
    }
    if (shouldSubmitAsSensitiveTerminalInput(terminalAppends[sessionKey] || [])) {
      return await sendSelectedSessionInput(event, { text: rawCommand, submit: true, sessionKey, commandInputKey, targetName: name, clearInput: true, sensitiveInput: true });
    }
    const interactiveMode = isLongRunningCommand(command);
    const nextHistory = addCommandToHistory(commandHistories[name] || [], command);
    const nextHistories = { ...commandHistories, [name]: nextHistory };
    setCommandHistories(nextHistories);
    writeLocalJson("sshAgentCommandHistories", nextHistories);
    appendTerminalLines(name, [`${terminalPromptLabel(name)} ${rawCommand}`], { terminalKey: sessionKey });
    setSshSessions((current) => {
      if (!interactiveMode) {
        return { ...current, [sessionKey]: { ...(current[sessionKey] || {}), serverName: name, busy: false, interactiveMode: false, lastError: "" } };
      }
      return { ...current, [sessionKey]: { ...(current[sessionKey] || {}), serverName: name, busy: true, interactiveMode: true, lastError: "" } };
    });
    const result = await sendSelectedSessionInput(event, { text: rawCommand, submit: true, sessionKey, commandInputKey, targetName: name, clearInput: false, submittedCommand: rawCommand });
    triggerSshOutputPoll();
    if (result?.stale) return result;
    if (!result?.ok) {
      const message = result?.message || "SSH 命令发送失败。";
      const commandLogContext = { ...buildSshSessionLogContext(name, servers[name] || {}), sessionKey };
      writeAuditEvent({ type: "command_failed", server: name, sessionId, actor: "user", command, message, status: "failed" });
      writeSessionLogEvent({ type: "command_failed", server: name, sessionId, actor: "user", command, message, status: "failed", context: commandLogContext });
    }
    if (result?.ok) {
      const commandLogContext = { ...buildSshSessionLogContext(name, servers[name] || {}), sessionKey };
      writeAuditEvent({ type: "command_sent", server: name, sessionId, actor: "user", command, status: "ok" });
      writeSessionLogEvent({ type: "command_sent", server: name, sessionId, actor: "user", command, status: "ok", context: commandLogContext });
      setHistoryCursors((current) => ({ ...current, [commandInputKey]: createHistoryCursor("") }));
      setCommandInputs((current) => ({ ...current, [commandInputKey]: "" }));
      rememberSessionWorkingDirectory(name, command, servers[name], { sessionKey });
    }
    if (!interactiveMode) setSshSessions((current) => ({ ...current, [sessionKey]: { ...(current[sessionKey] || {}), serverName: name, busy: false, interactiveMode: false } }));
    return result;
  }
  return (
    <div
      className="app-shell"
      style={{
        "--left-panel-width": String(layoutColumns.left) + "px",
        "--right-panel-width": String(layoutColumns.right) + "px",
        "--server-section-height": String(sidebarSections.server || DEFAULT_SIDEBAR_SECTIONS.server) + "px",
        "--sftp-section-height": String(sidebarSections.sftp || DEFAULT_SIDEBAR_SECTIONS.sftp) + "px",
      }}
    >
      <DesktopTopBar
        servers={servers}
        selectedServer={selectedServer}
        modelConfig={modelConfig}
        agentCapabilities={agentCapabilities}
        visibleServerNames={effectiveVisibleServerNames}
        latestConnectionCheck={latestConnectionCheck}
        selectedFile={selectedFile}
        sftpPath={currentSftpPath()}
        isSftpBusy={Boolean(sftpBusy[selectedServer])}
        recentSftpOperation={recentSftpOperations[selectedServer]}
        sessionState={sshSessions[selectedTerminalSessionKey] || {}}
        onOpenToolSettings={() => setToolSettingsOpen(true)}
        onOpenNewHost={openNewHost}
        onOpenModelSettings={() => setSettingsOpen(true)}
        onOpenAuthCenter={openAuthCenter}
        onOpenPortForward={openPortForwardModal}
        onOpenSessionLogs={() => openSessionLogs({ server: selectedServer })}
        onOpenToolLogs={openToolLogs}
        onOpenBackup={() => { setBackupServerName(""); setBackupOpen(true); }}
        onImportSshConfig={importSshConfig}
        onImportBackup={importBackup}
        onOpenReleaseInfo={() => setReleaseInfoOpen(true)}
        onCheckReleaseUpdate={() => {
          setReleaseInfoOpen(true);
          setReleaseInfoAutoCheckNonce((value) => value + 1);
        }}
        onExportDiagnosticPackage={exportDiagnosticPackage}
        onTestConnection={testSelectedConnection}
        isTestingConnection={Boolean(testingConnections[selectedServer])}
        onRunSshSmokeTest={runSelectedSshSmokeTest}
        isSshSmokeTesting={Boolean(sshSmokeTesting[selectedServer])}
        onExportSshSmokeTestReport={exportSshSmokeTestReport}
        latestSshSmokeTest={latestSshSmokeTest}
        onReadBasicInfo={readSelectedBasicInfo}
        isReadingBasicInfo={Boolean(readingBasicInfo[selectedServer])}
        onBatchOpenSessions={batchOpenSshSessions}
        isBatchConnecting={batchBusy.connect}
        onBatchCloseSessions={batchCloseSshSessions}
        isBatchDisconnecting={batchBusy.disconnect}
        onBatchReconnectSessions={batchReconnectSshSessions}
        isBatchReconnecting={batchBusy.reconnect}
        onBatchTestConnections={batchTestConnections}
        isBatchTesting={batchBusy.test}
        onBatchReadBasicInfo={batchReadBasicInfo}
        isBatchReading={batchBusy.basic}
        onQueueBatchAgent={queueBatchAgentInspection}
        isBatchQueuing={batchBusy.agent}
        onQueueDiagnosticSkill={queueDiagnosticSkill}
        onOpenBatchEdit={openBatchEditServers}
        onExportConnectionCheckReport={exportConnectionCheckReport}
        onExportServerProfile={exportServerProfile}
        onRunConnectionQuickFix={runConnectionQuickFix}
        onRunConnectionCheckRepair={runConnectionCheckRepair}
        onOpenSession={openSelectedSession}
        onCloseSession={closeSelectedSession}
        onReconnectSession={reconnectSelectedSession}
        onInterruptCommand={stopSelectedCommand}
        onCopyServerSshCommand={copyServerSshCommand}
        onCopyServerConnectionInfo={copyServerConnectionInfo}
        onCopyServerTroubleshootingSummary={copyServerTroubleshootingSummary}
        onCopyCurrentWorkingDirectory={copyCurrentWorkingDirectory}
        onOpenCurrentWorkingDirectoryInSftp={openCurrentWorkingDirectoryInSftp}
        onCopyTerminal={copySelectedTerminalTextOrOutput}
        onClearTerminal={clearSelectedTerminalOutput}
        onGoSftpParent={goSelectedSftpParent}
        onRefreshSftp={() => refreshSelectedSftp()}
        onUploadSftp={uploadSelectedSftp}
        onUploadSftpDirectory={uploadSelectedSftpDirectory}
        onDownloadSftp={downloadSelectedSftp}
        onPreviewSftpFile={previewSelectedSftpFile}
        onCreateSftpFile={createSelectedSftpFile}
        onCreateSftpDirectory={createSelectedSftpDirectory}
        onRenameSftpItem={renameSelectedSftpItem}
        onDeleteSftpItem={deleteSelectedSftpItem}
        onCancelSftpOperation={cancelSftpOperation}
        onNotice={showNotice}
      />
      <div className={"workspace-grid " + (terminalFocusMode ? "terminal-focus-mode" : "")}> 
        <Sidebar
          servers={servers}
          selectedServer={selectedServer}
          selectedFile={selectedFile}
          sftpPreview={sftpPreview}
          sftpPreviewDraft={sftpPreviewDraft}
          sftpPath={currentSftpPath()}
          sftpBookmarks={normalizeSftpBookmarks(servers[selectedServer]?.sftpBookmarks || [])}
          recentSftpOperation={recentSftpOperations[selectedServer]}
          onSelectServer={selectServerTab}
          onOpenServerSession={openSelectedSession}
          onToggleServerFavorite={toggleServerFavorite}
          onVisibleServerNamesChange={setVisibleServerNames}
          onSelectFile={selectSftpFile}
          onOpenSftpFolder={openSelectedSftpFolder}
          onGoSftpParent={goSelectedSftpParent}
          onAddSftpBookmark={addCurrentSftpBookmark}
          onOpenSftpBookmark={openSftpBookmark}
          onRemoveSftpBookmark={removeCurrentSftpBookmark}
          onOpenNewHost={openNewHost}
          onOpenAuthCenter={openAuthCenter}
          onRefreshSftp={() => refreshSelectedSftp()}
          onUploadSftp={uploadSelectedSftp}
          onDownloadSftp={downloadSelectedSftp}
          onPreviewSftpFile={previewSelectedSftpFile}
          onSftpPreviewDraftChange={setSftpPreviewDraft}
          onSaveSftpPreviewText={saveSftpPreviewText}
          onCreateSftpFile={createSelectedSftpFile}
          onCreateSftpDirectory={createSelectedSftpDirectory}
          onRenameSftpItem={renameSelectedSftpItem}
          onDeleteSftpItem={deleteSelectedSftpItem}
          isSftpBusy={Boolean(sftpBusy[selectedServer])}
          onBatchTestConnections={batchTestConnections}
          isBatchTesting={batchBusy.test}
          onBatchReadBasicInfo={batchReadBasicInfo}
          isBatchReading={batchBusy.basic}
          onQueueBatchAgent={queueBatchAgentInspection}
          isBatchQueuing={batchBusy.agent}
          onOpenEditHost={openEditHost}
          onOpenServerContextMenu={openServerContextMenu}
          onOpenSftpContextMenu={openSftpContextMenu}
          onCopyRecentSftpOperation={copyRecentSftpOperation}
          onCancelSftpOperation={cancelSftpOperation}
          importFollowupPrompt={importFollowupPrompt}
          onClearImportFollowup={() => setImportFollowup(null)}
          style={{
            "--server-section-height": String(sidebarSections.server || DEFAULT_SIDEBAR_SECTIONS.server) + "px",
            "--sftp-section-height": String(sidebarSections.sftp || DEFAULT_SIDEBAR_SECTIONS.sftp) + "px",
          }}
          onSidebarSectionResize={setSidebarSectionHeight}
        />
        <div
          className="layout-resizer left-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整左侧面板宽度"
          aria-valuemin={180}
          aria-valuemax={360}
          aria-valuenow={layoutColumns.left}
          title="拖动调整左侧面板宽度，双击恢复默认宽度"
          tabIndex={0}
          onMouseDown={(event) => startLayoutResize("left", event)}
          onDoubleClick={() => resetLayoutColumn("left")}
          onKeyDown={(event) => handleLayoutResizeKeyDown("left", event)}
        />
        <TerminalWorkspace
          servers={servers}
          selectedServer={selectedServer}
          selectedTerminalTabId={selectedTerminalTabId}
          terminalTabs={visibleTerminalTabs}
          terminalLines={selectedTerminalLines}
          modelConfig={modelConfig}
          terminalFontSize={terminalFontSize}
          terminalFocusMode={terminalFocusMode}
          terminalSearchFocusRequest={terminalSearchFocusRequest}
          terminalScrollLocked={terminalScrollLocked}
          onTerminalScrollLockChange={setTerminalScrollLockedFromWorkspace}
          onToggleTerminalFocusMode={toggleTerminalFocusMode}
          onOpenModelSettings={() => setSettingsOpen(true)}
          sessionState={sshSessions[selectedTerminalSessionKey] || {}}
          sshSessions={sshSessions}
          commandValue={commandInputs[selectedCommandInputKey] || ""}
          commandHistory={commandHistories[selectedServer] || []}
          commandSnippets={commandSnippets}
          onCommandChange={(value) => updateCommandInput(selectedCommandInputKey, value)}
          onCommandKeyDown={handleCommandHistoryKeyDown}
          onUseSnippet={useCommandSnippet}
          onCopySnippet={copyCommandSnippet}
          onSaveHistoryCommandSnippet={saveCommandSnippetFromText}
          onRemoveHistoryCommand={removeSelectedCommandHistoryItem}
          onUseHistoryCommand={useCommandHistoryItem}
          onSelectTerminalTab={selectServerTab}
          onRenameTerminalTab={renameSelectedTerminalTabTitle}
          onCloseTerminalTab={closeServerTab}
          onOpenTerminalTab={openNextServerTab}
          onCopyTerminal={copySelectedTerminalTextOrOutput}
          onPasteTerminal={() => pasteClipboardToCommandInput({ sendToConnectedSession: true })}
          onExportTerminal={exportSelectedTerminalOutput}
          onCopySshCommand={copyServerSshCommand}
          onClearTerminal={clearSelectedTerminalOutput}
          onSaveSnippet={saveCurrentCommandSnippet}
          onRemoveSnippet={removeSavedCommandSnippet}
          onOpenSession={openSelectedSession}
          onCloseSession={closeSelectedSession}
          onCheckSessionHealth={checkSelectedSessionHealth}
          onRunSessionRecoveryAction={runTerminalSessionRecoveryAction}
          onRunConnectionQuickFix={runConnectionQuickFix}
          onOpenTerminalContextMenu={openTerminalContextMenu}
          onOpenTerminalTabContextMenu={openTerminalTabContextMenu}
          onTerminalShortcutKeyDown={handleTerminalShortcutKeyDown}
          onSendCommand={sendSelectedCommand}
          onSendInteractiveInput={sendSelectedSessionInput}
          onStopCommand={stopSelectedCommand}
          onFinishInteractiveMode={finishSelectedInteractiveMode}
          onResizeSession={resizeSelectedSession}
          onTerminalSizeChange={rememberTerminalPtySize}
        />
        <div
          className="layout-resizer right-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整右侧 Agent 面板宽度"
          aria-valuemin={320}
          aria-valuemax={560}
          aria-valuenow={layoutColumns.right}
          title="拖动调整右侧 Agent 面板宽度，双击恢复默认宽度"
          tabIndex={0}
          onMouseDown={(event) => startLayoutResize("right", event)}
          onDoubleClick={() => resetLayoutColumn("right")}
          onKeyDown={(event) => handleLayoutResizeKeyDown("right", event)}
        />
        <AgentPanel
          servers={servers}
          selectedServer={selectedServer}
          selectedFile={selectedFile}
          sftpPreview={sftpPreview}
          terminalLines={selectedTerminalLines}
          modelConfig={modelConfig}
          agentDraftRequest={agentDraftRequest}
          agentTaskNotice={agentTaskNotice}
          capabilities={agentCapabilities}
          taskQueue={agentTasks}
          runningAgentTasks={runningAgentTasks}
          onCapabilitiesChange={saveAgentCapabilities}
          onTaskQueueChange={setAgentTasks}
          onApproveTask={approveQueuedAgentTask}
          onCancelTask={cancelAgentTask}
          onCancelRunningTask={cancelRunningAgentTask}
          onOpenModelSettings={() => setSettingsOpen(true)}
          onOpenReleaseInfo={() => setReleaseInfoOpen(true)}
          onTrustHostKey={trustSelectedHostKey}
          onRevokeHostKeyTrust={revokeSelectedHostKeyTrust}
          onNotice={showNotice}
        />
      </div>

      <ContextMenu menu={contextMenu} onClose={closeContextMenu} />

      {notice && <div className="desktop-toast">{notice}</div>}

      {renameTabDraft && (
        <RenameTerminalTabModal
          draft={renameTabDraft}
          onChange={setRenameTabDraft}
          onSubmit={submitRenameTerminalTabTitle}
          onClose={() => setRenameTabDraft(null)}
        />
      )}

      {sftpNameDialog && (
        <SftpNameModal
          dialog={sftpNameDialog}
          onChange={setSftpNameDialog}
          onSubmit={submitSftpNameDialog}
          onClose={() => setSftpNameDialog(null)}
        />
      )}

      {sftpDeleteDialog && (
        <SftpDeleteConfirmModal
          dialog={sftpDeleteDialog}
          onSubmit={submitSftpDeleteDialog}
          onClose={() => setSftpDeleteDialog(null)}
        />
      )}

      {sftpOverwriteDialog && (
        <SftpOverwriteConfirmModal
          dialog={sftpOverwriteDialog}
          onSubmit={() => closeSftpOverwriteDialog(true)}
          onClose={() => closeSftpOverwriteDialog(false)}
        />
      )}

      {pendingConfirmAction && (
        <DesktopConfirmModal
          action={pendingConfirmAction}
          onSubmit={submitPendingConfirmAction}
          onClose={() => setPendingConfirmAction(null)}
        />
      )}

      {settingsOpen && (
        <ModelSettingsModal
          initialConfig={modelConfig}
          profileOptions={modelProfiles}
          activeProfileId={activeModelProfileId}
          onSave={saveModelConfig}
          onSaveProfile={saveModelProfile}
          onCreateProfile={createModelProfile}
          onSelectProfile={selectModelProfile}
          onDeleteProfile={deleteModelProfile}
          onTestConnection={testModelConnection}
          onListModels={listModelOptions}
          onCacheModelOptions={cacheModelOptions}
          onOpenModelLogs={() => openToolLogs({ component: "model-api", level: "", query: "" })}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {toolSettingsOpen && (
        <ToolSettingsModal
          terminalFontSize={terminalFontSize}
          terminalScrollLocked={terminalScrollLocked}
          capabilities={agentCapabilities}
          selectedServer={selectedServer}
          hiddenBuiltinServerCount={(hiddenBuiltinServers || []).length}
          onTerminalZoom={applyTerminalZoom}
          onToggleTerminalScrollLock={toggleTerminalScrollLock}
          onResetLayout={resetLayoutColumns}
          onRestoreHiddenBuiltinServers={restoreHiddenBuiltinServers}
          onCapabilitiesChange={saveAgentCapabilities}
          onQueueCapability={queueAgentCapability}
          onOpenSessionLogs={() => openSessionLogs({ server: selectedServer })}
          onOpenToolLogs={openToolLogs}
          onExportDiagnosticPackage={exportDiagnosticPackage}
          onOpenReleaseInfo={() => setReleaseInfoOpen(true)}
          onCreateDesktopShortcut={createDesktopShortcut}
          onCreateStartMenuShortcut={createStartMenuShortcut}
          onOpenInstallDirectory={openInstallDirectory}
          onOpenAppDataDirectory={openAppDataDirectory}
          onNotice={showNotice}
          onClose={() => setToolSettingsOpen(false)}
        />
      )}

      {releaseInfoOpen && (
        <ReleaseInfoModal
          manifest={releaseManifest}
          runtimeDiagnostics={runtimeDiagnostics}
          autoCheckNonce={releaseInfoAutoCheckNonce}
          onClose={() => setReleaseInfoOpen(false)}
        />
      )}

      {newHostOpen && (
        <NewHostModal
          existingNames={Object.keys(servers)}
          initialForm={newHostInitialForm}
          onSave={saveNewHost}
          onTestConnection={testHostFormConnection}
          onClose={() => {
            setNewHostInitialForm(null);
            setNewHostOpen(false);
          }}
        />
      )}

      {editHostOpen && (
        <NewHostModal
          existingNames={Object.keys(servers)}
          initialForm={serverToHostForm(selectedServer, servers[selectedServer])}
          mode="edit"
          onSave={saveEditedHost}
          onDelete={deleteSelectedHost}
          onTestConnection={testHostFormConnection}
          onClose={() => setEditHostOpen(false)}
        />
      )}

      {authCenterOpen && (
        <AuthCenterModal
          serverName={selectedServer}
          server={servers[selectedServer]}
          isTesting={Boolean(testingConnections[selectedServer])}
          onTestConnection={testSelectedConnection}
          onRemoveCredential={removeSelectedCredential}
          onEdit={() => {
            setAuthCenterOpen(false);
            openEditHost();
          }}
          onClose={() => setAuthCenterOpen(false)}
        />
      )}

      {batchEditOpen && (
        <BatchEditServersModal
          targetNames={batchEditNames}
          customServers={customServers}
          onSave={saveBatchEditedServers}
          onClose={() => setBatchEditOpen(false)}
        />
      )}

      {backupOpen && (
        <BackupExportModal
          servers={backupServerName && servers[backupServerName] ? { [backupServerName]: servers[backupServerName] } : servers}
          scopeLabel={backupServerName ? `单台服务器：${backupServerName}` : ""}
          agentCapabilities={agentCapabilities}
          portForwardPresets={portForwardPresets}
          commandSnippets={customCommandSnippets}
          modelConfig={modelConfig}
          modelProfiles={modelProfiles}
          backupHistory={backupHistory}
          onBackupExported={recordBackupExport}
          onRemoveBackupHistory={removeBackupHistoryItem}
          onClearBackupHistory={clearBackupHistoryItems}
          onClose={() => { setBackupOpen(false); setBackupServerName(""); }}
          onNotice={showNotice}
        />
      )}

      {backupImportDraft && (
        <BackupImportModal
          preview={backupImportDraft.preview}
          onClose={() => setBackupImportDraft(null)}
          onConfirm={confirmBackupImport}
        />
      )}

      {portForwardOpen && (
        <PortForwardModal
          serverName={selectedServer}
          server={servers[selectedServer]}
          forwards={portForwards}
          presets={portForwardPresets}
          busy={portForwardBusy}
          operationStatus={portForwardOperation}
          onStart={startPortForward}
          onStop={stopPortForward}
          onRefresh={refreshPortForwards}
          onSavePreset={savePortForwardPreset}
          onDeletePreset={deletePortForwardPreset}
          onCopyLocalUrl={copyPortForwardLocalUrl}
          onClose={() => setPortForwardOpen(false)}
        />
      )}

      {sessionLogsOpen && (
        <SessionLogModal
          servers={servers}
          filters={sessionLogFilters}
          entries={sessionLogEntries}
          total={sessionLogTotal}
          root={sessionLogRoot}
          busy={sessionLogsBusy}
          onFiltersChange={setSessionLogFilters}
          onRefresh={refreshSessionLogs}
          onExport={exportSessionLogs}
          onOpenDir={openSessionLogDir}
          onDeleteOldLogs={deleteOldSessionLogs}
          onClose={() => setSessionLogsOpen(false)}
        />
      )}

      {toolLogsOpen && (
        <ToolLogModal
          filters={toolLogFilters}
          entries={toolLogEntries}
          total={toolLogTotal}
          root={toolLogRoot}
          busy={toolLogsBusy}
          onFiltersChange={setToolLogFilters}
          onRefresh={refreshToolLogs}
          onExport={exportToolLogs}
          onOpenDir={openToolLogDir}
          onDeleteOldLogs={deleteOldToolLogs}
          onClose={() => setToolLogsOpen(false)}
        />
      )}
    </div>
  );
}





